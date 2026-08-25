from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} marker not found")
    return text.replace(old, new, 1)


attendance = Path("src/routes/_authenticated/atendimento.tsx")
text = attendance.read_text()
marker = 'import { AttendanceDecisionDashboard } from "@/components/attendance/AttendanceDecisionDashboard";\n'
addition = marker + 'import { AttendanceDistributionPanel } from "@/components/attendance/AttendanceDistributionPanel";\n'
if "AttendanceDistributionPanel" not in text:
    text = replace_once(text, marker, addition, "attendance import")

button = "\n".join(
    [
        '            <Button',
        '              variant="outline"',
        '              onClick={() => window.location.assign("/fluxos")}',
        '              className="mt-2 h-10 w-full rounded-xl border-[var(--mi-border)] font-black"',
        '            >',
        '              <Bot className="mr-2 h-4 w-4" /> Configurar agente de IA e automático',
        '            </Button>',
        "",
    ]
)
if "<AttendanceDistributionPanel />" not in text:
    text = replace_once(
        text,
        button,
        button + '            <div className="mt-2">\n              <AttendanceDistributionPanel />\n            </div>\n',
        "attendance distribution button",
    )

list_marker = '                  <span className="mt-0.5 flex items-center gap-2">\n'
if "conversation.protocol_code" not in text:
    text = replace_once(
        text,
        list_marker,
        '                  <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.08em] text-blue-600">\n                    {conversation.protocol_code}\n                  </span>\n'
        + list_marker,
        "conversation protocol list",
    )

phone_block = "\n".join(
    [
        '                  <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--mi-text-soft)]">',
        '                    {selected.phone_masked && <LockKeyhole className="h-3 w-3" />}',
        '                    {selected.phone_e164}',
        '                  </p>',
        "",
    ]
)
if "Protocolo {selected.protocol_code}" not in text:
    text = replace_once(
        text,
        phone_block,
        phone_block
        + '                  <p className="mt-1 text-[10px] font-black uppercase tracking-[0.08em] text-blue-600">\n                    Protocolo {selected.protocol_code}\n                  </p>\n',
        "selected protocol",
    )
attendance.write_text(text)


center = Path("src/lib/attendance-center.functions.ts")
text = center.read_text()
if "protocol_code: string;" not in text:
    text = replace_once(
        text,
        "export interface AttendanceConversation {\n  id: string;\n",
        "export interface AttendanceConversation {\n  id: string;\n  protocol_code: string;\n",
        "attendance protocol type",
    )
text = text.replace(
    '"id,phone_e164,contact_name,avatar_url,last_message,last_message_at,unread_count,assigned_user_id",',
    '"id,protocol_code,phone_e164,contact_name,avatar_url,last_message,last_message_at,unread_count,assigned_user_id",',
    1,
)
if 'protocol_code: String(row.protocol_code' not in text:
    text = replace_once(
        text,
        "        id: String(row.id),\n        phone_e164:",
        '        id: String(row.id),\n        protocol_code: String(row.protocol_code ?? ""),\n        phone_e164:',
        "attendance protocol mapping",
    )

queue_tail = "\n".join(
    [
        '      "Conversa enviada para fila humana",',
        "    );",
        "    return { success: true, waitingSince: now };",
        "",
    ]
)
if "p_force: true" not in text:
    queue_replacement = "\n".join(
        [
            '      "Conversa enviada para fila humana",',
            "    );",
            '    const distributed = await db.rpc("attendance_distribute_conversation", {',
            "      p_tenant_id: tenantId,",
            "      p_conversation_id: data.conversationId,",
            "      p_force: true,",
            "    });",
            "    if (distributed.error) throw new Error(distributed.error.message);",
            "    return { success: true, waitingSince: now, assignedUserId: distributed.data ?? null };",
            "",
        ]
    )
    text = replace_once(text, queue_tail, queue_replacement, "attendance queue distribution")

claim_guard = "\n".join(
    [
        "    if (",
        '      state.state === "in_service" &&',
        "      state.assignedUserId &&",
        "      state.assignedUserId !== context.userId",
        "    ) {",
        '      throw new Error("Esta conversa já está em atendimento por outro usuário.");',
        "    }",
        "",
    ]
)
if "Esta conversa foi distribuída para outro usuário." not in text:
    extra_guard = claim_guard + "\n".join(
        [
            "    if (",
            '      state.state === "waiting" &&',
            "      state.assignedUserId &&",
            "      state.assignedUserId !== context.userId",
            "    ) {",
            '      throw new Error("Esta conversa foi distribuída para outro usuário.");',
            "    }",
            "",
        ]
    )
    text = replace_once(text, claim_guard, extra_guard, "attendance claim guard")
center.write_text(text)


advanced = Path("src/lib/crm-advanced.functions.ts")
text = advanced.read_text()
if "  protocol_code: string;\n" not in text:
    text = replace_once(
        text,
        "export type CrmOpportunity = {\n  id: string;\n",
        "export type CrmOpportunity = {\n  id: string;\n  protocol_code: string;\n",
        "CRM protocol type",
    )
text = text.replace(
    '"id,pipeline_id,stage_id,owner_user_id,conversation_id,contact_name,contact_phone,contact_email,property_reference,source,value,probability,status,loss_reason_id,notes,tags,custom_values,expected_close_date,next_action_at,last_activity_at,created_at,updated_at",',
    '"id,protocol_code,pipeline_id,stage_id,owner_user_id,conversation_id,contact_name,contact_phone,contact_email,property_reference,source,value,probability,status,loss_reason_id,notes,tags,custom_values,expected_close_date,next_action_at,last_activity_at,created_at,updated_at",',
    1,
)
advanced.write_text(text)


pipeline = Path("src/components/crm/CrmPipelineWorkspace.tsx")
text = pipeline.read_text()
marker = 'import { Textarea } from "@/components/ui/textarea";\n'
addition = marker + 'import { CrmContactProfilePanel } from "@/components/crm/CrmContactProfilePanel";\n'
if "CrmContactProfilePanel" not in text:
    text = replace_once(text, marker, addition, "CRM contact import")
card = '<p className="truncate font-black">{item.contact_name}</p>\n'
if "{item.protocol_code}" not in text:
    text = replace_once(
        text,
        card,
        card
        + '                              <p className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.08em] text-blue-600">\n                                {item.protocol_code}\n                              </p>\n',
        "CRM card protocol",
    )
activities_marker = "          {editing && (activitiesByOpportunity.get(editing.id)?.length ?? 0) > 0 && (\n"
if "<CrmContactProfilePanel opportunityId={editing.id} />" not in text:
    text = replace_once(
        text,
        activities_marker,
        "          {editing && <CrmContactProfilePanel opportunityId={editing.id} />}\n\n"
        + activities_marker,
        "CRM contact profile panel",
    )
pipeline.write_text(text)


operations = Path("src/lib/crm-operations.functions.ts")
text = operations.read_text()
old_phone = "\n".join(
    [
        "    } else if (payload.phone_e164) {",
        "      const upserted = await admin",
        '        .from("crm_contacts")',
        '        .upsert(payload, { onConflict: "tenant_id,phone_e164" })',
        '        .select("id")',
        "        .single();",
        "      if (upserted.error) throw new Error(upserted.error.message);",
        "      contactId = upserted.data.id;",
        "    } else {",
    ]
)
new_phone = "\n".join(
    [
        "    } else if (payload.phone_e164) {",
        "      const existing = await admin",
        '        .from("crm_contacts")',
        '        .select("id")',
        '        .eq("tenant_id", tenantId)',
        '        .eq("phone_e164", payload.phone_e164)',
        "        .maybeSingle();",
        "      if (existing.error) throw new Error(existing.error.message);",
        "      if (existing.data) {",
        "        contactId = existing.data.id;",
        "        const updated = await admin",
        '          .from("crm_contacts")',
        "          .update(payload)",
        '          .eq("tenant_id", tenantId)',
        '          .eq("id", contactId);',
        "        if (updated.error) throw new Error(updated.error.message);",
        "      } else {",
        '        const inserted = await admin.from("crm_contacts").insert(payload).select("id").single();',
        "        if (inserted.error) throw new Error(inserted.error.message);",
        "        contactId = inserted.data.id;",
        "      }",
        "    } else {",
    ]
)
if old_phone in text:
    text = text.replace(old_phone, new_phone, 1)
operations.write_text(text)


tests = Path("tests/platform-buttons.test.ts")
text = tests.read_text()
if "keeps the CRM process enhancements visible" not in text:
    text += """

it("keeps the CRM process enhancements visible without renaming the existing application structure", () => {
  const shell = read("src/components/crm/CrmWorkspaceShell.tsx");
  expect(shell).toContain('label: "Pipeline"');
  expect(shell).toContain('label: "Propostas"');
  expect(shell).toContain('label: "E-mails"');
  expect(shell).toContain('label: "Documentos"');
  expect(shell).toContain('label: "Assinaturas"');
  expect(shell).toContain('label: "Relatórios"');
  expect(shell).not.toContain("Kanban");
  const attendance = read("src/routes/_authenticated/atendimento.tsx");
  expect(attendance).toContain("AttendanceDistributionPanel");
  expect(attendance).toContain("protocol_code");
});
"""
tests.write_text(text)
