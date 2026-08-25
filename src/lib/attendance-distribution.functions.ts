import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantId } from "@/lib/tenant.server";

const algorithmSchema = z.enum(["alphabetical", "balanced", "round_robin"]);
const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  algorithm: algorithmSchema,
  autoQueue: z.boolean().default(true),
});
const updateSchema = z.object({
  listId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  algorithm: algorithmSchema,
  autoQueue: z.boolean(),
  isActive: z.boolean(),
});
const memberSchema = z.object({
  listId: z.string().uuid(),
  userId: z.string().uuid(),
  enabled: z.boolean(),
});
const listIdSchema = z.object({ listId: z.string().uuid() });

export type DistributionAlgorithm = z.infer<typeof algorithmSchema>;

export interface AttendanceDistributionList {
  id: string;
  name: string;
  algorithm: DistributionAlgorithm;
  auto_queue: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AttendanceDistributionMember {
  id: string;
  list_id: string;
  user_id: string;
  name: string;
  role: string;
  is_active: boolean;
  assigned_count: number;
  last_assigned_at: string | null;
  position: number;
}

export interface AttendanceDistributionWorkspace {
  lists: AttendanceDistributionList[];
  members: AttendanceDistributionMember[];
  users: Array<{ userId: string; name: string; role: string; active: boolean }>;
  canManage: boolean;
}

function db() {
  return supabaseAdmin as any;
}

async function access(tenantId: string, userId: string) {
  const { data, error } = await db()
    .from("tenant_members")
    .select("member_role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("TENANT_MEMBERSHIP_REQUIRED");
  const role = String(data.member_role ?? "").toLowerCase();
  return { role, canManage: ["owner", "admin", "administrator"].includes(role) };
}

async function requireManager(tenantId: string, userId: string) {
  const current = await access(tenantId, userId);
  if (!current.canManage) throw new Error("Somente administradores podem alterar a distribuição.");
}

async function assertList(tenantId: string, listId: string) {
  const { data, error } = await db()
    .from("attendance_distribution_lists")
    .select("id,is_default")
    .eq("tenant_id", tenantId)
    .eq("id", listId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lista de distribuição não encontrada.");
  return data as { id: string; is_default: boolean };
}

export const getAttendanceDistributionWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttendanceDistributionWorkspace> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const current = await access(tenantId, context.userId);
    const admin = db();
    const [listsResult, membersResult, tenantMembersResult] = await Promise.all([
      admin
        .from("attendance_distribution_lists")
        .select("id,name,algorithm,auto_queue,is_default,is_active,created_at")
        .eq("tenant_id", tenantId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true }),
      admin
        .from("attendance_distribution_members")
        .select("id,list_id,user_id,is_active,assigned_count,last_assigned_at,position")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      admin.from("tenant_members").select("user_id,member_role").eq("tenant_id", tenantId),
    ]);
    const failure = [listsResult, membersResult, tenantMembersResult].find((result) => result.error);
    if (failure?.error) throw new Error(failure.error.message);

    const userIds = [...new Set((tenantMembersResult.data ?? []).map((item: any) => String(item.user_id)))];
    const profilesResult = userIds.length
      ? await admin.from("profiles").select("id,full_name,is_active").in("id", userIds)
      : { data: [], error: null };
    if (profilesResult.error) throw new Error(profilesResult.error.message);

    const profileMap = new Map(
      (profilesResult.data ?? []).map((profile: any) => [String(profile.id), profile]),
    );
    const roleMap = new Map(
      (tenantMembersResult.data ?? []).map((member: any) => [
        String(member.user_id),
        String(member.member_role ?? "member"),
      ]),
    );
    const users = userIds
      .map((userId) => {
        const profile = profileMap.get(userId) as any;
        return {
          userId,
          name: String(profile?.full_name || "Usuário"),
          role: roleMap.get(userId) || "member",
          active: profile?.is_active !== false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const members = (membersResult.data ?? []).map((member: any) => {
      const user = users.find((item) => item.userId === String(member.user_id));
      return {
        id: String(member.id),
        list_id: String(member.list_id),
        user_id: String(member.user_id),
        name: user?.name || "Usuário",
        role: user?.role || "member",
        is_active: Boolean(member.is_active),
        assigned_count: Number(member.assigned_count ?? 0),
        last_assigned_at: member.last_assigned_at ?? null,
        position: Number(member.position ?? 0),
      } satisfies AttendanceDistributionMember;
    });

    return {
      lists: (listsResult.data ?? []) as AttendanceDistributionList[],
      members,
      users,
      canManage: current.canManage,
    };
  });

export const createAttendanceDistributionList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    await requireManager(tenantId, context.userId);
    const admin = db();
    const { data: existingDefault } = await admin
      .from("attendance_distribution_lists")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle();
    const inserted = await admin
      .from("attendance_distribution_lists")
      .insert({
        tenant_id: tenantId,
        name: data.name,
        algorithm: data.algorithm,
        auto_queue: data.autoQueue,
        is_default: !existingDefault,
        is_active: true,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    return { success: true, id: inserted.data.id };
  });

export const updateAttendanceDistributionList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    await requireManager(tenantId, context.userId);
    await assertList(tenantId, data.listId);
    const result = await db()
      .from("attendance_distribution_lists")
      .update({
        name: data.name,
        algorithm: data.algorithm,
        auto_queue: data.autoQueue,
        is_active: data.isActive,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.listId);
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });

export const setDefaultAttendanceDistributionList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    await requireManager(tenantId, context.userId);
    await assertList(tenantId, data.listId);
    const admin = db();
    const cleared = await admin
      .from("attendance_distribution_lists")
      .update({ is_default: false })
      .eq("tenant_id", tenantId)
      .neq("id", data.listId);
    if (cleared.error) throw new Error(cleared.error.message);
    const chosen = await admin
      .from("attendance_distribution_lists")
      .update({ is_default: true, is_active: true })
      .eq("tenant_id", tenantId)
      .eq("id", data.listId);
    if (chosen.error) throw new Error(chosen.error.message);
    return { success: true };
  });

export const setAttendanceDistributionMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    await requireManager(tenantId, context.userId);
    await assertList(tenantId, data.listId);
    const admin = db();
    const membershipResult = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (membershipResult.error) throw new Error(membershipResult.error.message);
    if (!membershipResult.data) throw new Error("Usuário não pertence a esta organização.");

    const existing = await admin
      .from("attendance_distribution_members")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("list_id", data.listId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      const updated = await admin
        .from("attendance_distribution_members")
        .update({ is_active: data.enabled })
        .eq("id", existing.data.id);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const { count } = await admin
        .from("attendance_distribution_members")
        .select("id", { count: "exact", head: true })
        .eq("list_id", data.listId);
      const inserted = await admin.from("attendance_distribution_members").insert({
        tenant_id: tenantId,
        list_id: data.listId,
        user_id: data.userId,
        position: Number(count ?? 0) + 1,
        is_active: data.enabled,
      });
      if (inserted.error) throw new Error(inserted.error.message);
    }
    return { success: true };
  });

export const deleteAttendanceDistributionList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    await requireManager(tenantId, context.userId);
    const list = await assertList(tenantId, data.listId);
    if (list.is_default) throw new Error("Defina outra lista como padrão antes de excluir esta lista.");
    const result = await db()
      .from("attendance_distribution_lists")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", data.listId);
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });