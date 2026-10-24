import { JOINVILLE_PRESENTATION } from "@/lib/whatsapp-templates.core";
import { extractMetaWhatsAppMessageId, listMetaWhatsAppTemplates, sendMetaWhatsAppApprovedTemplate, testMetaWhatsAppConfig, type MetaWhatsAppConfig } from "@/lib/meta-whatsapp.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

const TEMPLATE = "ruan_joinville_mcmv_apresentacao_v1";
const PURPOSE = "joinville_mcmv_presentation";

/** Server-only primitive. No scheduler or campaign is enabled by importing this module. */
export async function sendInitialJoinvillePresentation(input: { db: any; tenantId: string; conversationId: string; config: MetaWhatsAppConfig }) {
  const { db, tenantId, conversationId, config } = input;
  const runtime = await testMetaWhatsAppConfig(config);
  if (!runtime.ok || runtime.businessAccountMatched !== true || String(runtime.displayPhoneNumber).replace(/\D/g, "") !== "5547996238649") throw new Error("Remetente oficial não validado.");
  const { data: conversation, error: conversationError } = await db.from("whatsapp_conversations").select("phone_e164,contact_name").eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle();
  if (conversationError || !conversation) throw new Error("Conversa não encontrada nesta organização.");
  const phone = normalizeWhatsAppPhone(conversation.phone_e164);
  const firstName = String(conversation.contact_name ?? "").trim().split(/\s+/)[0];
  if (!phone || !firstName || !/\p{L}/u.test(firstName)) throw new Error("Valide o telefone e o nome do destinatário.");
  const templates = await listMetaWhatsAppTemplates(config, TEMPLATE);
  const template = templates.find(t => t.name === TEMPLATE && t.language === "pt_BR" && t.status === "APPROVED");
  const components = template?.components;
  const body = Array.isArray(components) ? components.find((c: any) => c.type === "BODY")?.text : null;
  if (body !== JOINVILLE_PRESENTATION.replaceAll("{{primeiro_nome}}", "{{1}}")) throw new Error("A apresentação ainda não está aprovada pela Meta.");
  // Check all conversations sharing the number, including older duplicate conversations.
  const { data: conversations, error: scopeError } = await db.from("whatsapp_conversations").select("id").eq("tenant_id", tenantId).eq("phone_e164", phone);
  if (scopeError) throw new Error("Não foi possível conferir o histórico.");
  const { data: messages, error: historyError } = await db.from("whatsapp_messages").select("direction,body,raw_payload").eq("tenant_id", tenantId).in("conversation_id", (conversations ?? []).map((c: any) => c.id));
  if (historyError) throw new Error("Não foi possível conferir o histórico.");
  if ((messages ?? []).some((m: any) => m.direction === "inbound" && /\b(parar|pare|sair|cancelar)\b|n[aã]o (quero|desejo).*mensage/i.test(String(m.body ?? "")))) throw new Error("Há solicitação de interrupção no histórico. Revise a autorização antes de enviar.");
  if ((messages ?? []).some((m: any) => m.direction === "outbound" && (m.raw_payload?.mercadoimobi_outreach_purpose === PURPOSE || /68129F/.test(String(m.body ?? ""))))) return { status: "already_contacted" as const };
  const { data: reservation, error: reserveError } = await db.rpc("reserve_whatsapp_initial_outreach", { p_tenant_id: tenantId, p_phone: phone, p_template: TEMPLATE });
  if (reserveError) throw new Error("Destinatário sem autorização validada ou com bloqueio de contato.");
  if (!reservation) return { status: "already_reserved" as const };
  try {
    const payload = await sendMetaWhatsAppApprovedTemplate(config, phone, TEMPLATE, firstName);
    const messageId = extractMetaWhatsAppMessageId(payload);
    if (!messageId) throw new Error("A Meta não confirmou o identificador da mensagem.");
    const now = new Date().toISOString();
    const rendered = JOINVILLE_PRESENTATION.replaceAll("{{primeiro_nome}}", firstName);
    const { error: ledgerError } = await db.from("whatsapp_initial_outreach").update({ status: "sent", external_message_id: messageId, sent_at: now }).eq("tenant_id", tenantId).eq("reservation_id", reservation);
    if (ledgerError) throw new Error("Falha ao confirmar o registro do envio.");
    const { error: logError } = await db.from("whatsapp_messages").insert({ tenant_id: tenantId, conversation_id: conversationId, direction: "outbound", message_type: "text", body: rendered, status: "sent", sent_at: now, external_message_id: messageId, raw_payload: { mercadoimobi_provider: "meta", phone_number_id: config.phoneNumberId, mercadoimobi_outreach_purpose: PURPOSE, template_name: TEMPLATE } });
    if (logError) throw new Error("Falha ao registrar a mensagem no histórico.");
    return { status: "sent" as const, messageId };
  } catch {
    // A timeout may mean Meta accepted the message. Keep the reservation permanently;
    // never automatically retry an uncertain send or clear it when templates change.
    await db.from("whatsapp_initial_outreach").update({ status: "uncertain" }).eq("tenant_id", tenantId).eq("reservation_id", reservation);
    throw new Error("Envio sem confirmação completa. Reenvio bloqueado; confira o histórico antes de qualquer ação.");
  }
}
