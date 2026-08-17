import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Headphones, Phone, PhoneCall, RefreshCw, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDialerStatus, startDialerCall } from "@/lib/dialer.functions";
import { listCrmLeads } from "@/lib/crm.functions";

export const Route = createFileRoute("/_authenticated/discador")({
  component: DialerPage,
  head: () => ({ title: "Discador | MercadoImobi" }),
});

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"];

function DialerPage() {
  const statusFn = useServerFn(getDialerStatus);
  const callFn = useServerFn(startDialerCall);
  const leadsFn = useServerFn(listCrmLeads);
  const status = useQuery({ queryKey: ["dialer-status"], queryFn: () => statusFn() });
  const leads = useQuery({ queryKey: ["dialer-leads"], queryFn: () => leadsFn() });

  const [agentPhone, setAgentPhone] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [calling, setCalling] = useState(false);
  const [lastCall, setLastCall] = useState<{ callSid: string | null; customerPhone: string; status: string } | null>(null);

  useEffect(() => {
    setAgentPhone(localStorage.getItem("mercadoimobi:dialer-agent-phone") ?? "");
  }, []);

  useEffect(() => {
    if (agentPhone.trim()) localStorage.setItem("mercadoimobi:dialer-agent-phone", agentPhone.trim());
  }, [agentPhone]);

  const selectedLead = useMemo(
    () => (leads.data ?? []).find((lead) => lead.id === selectedLeadId) ?? null,
    [leads.data, selectedLeadId],
  );

  useEffect(() => {
    if (selectedLead?.client_phone) setCustomerPhone(selectedLead.client_phone);
  }, [selectedLead]);

  const pressKey = (key: string) => {
    if (key === "⌫") return setCustomerPhone((value) => value.slice(0, -1));
    setCustomerPhone((value) => `${value}${key}`.slice(0, 24));
  };

  const call = async () => {
    if (!status.data?.configured) {
      toast.info("Configure a conta Twilio no servidor para liberar o discador.");
      return;
    }
    if (!agentPhone.trim() || !customerPhone.trim()) {
      toast.info("Informe seu telefone e o telefone do cliente.");
      return;
    }
    setCalling(true);
    try {
      const result = await callFn({
        data: {
          agentPhone: agentPhone.trim(),
          customerPhone: customerPhone.trim(),
          leadId: selectedLeadId || undefined,
        },
      });
      setLastCall({ callSid: result.callSid, customerPhone: result.customerPhone, status: result.status });
      toast.success("Chamada iniciada. Atenda seu telefone para o MercadoImobi ligar ao cliente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A chamada não foi iniciada.");
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Telefonia comercial</p>
            <h1 className="mt-2 text-3xl font-black">Discador imobiliário</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Ligue para leads do CRM sem copiar números. O sistema chama seu telefone primeiro e, depois que você atende, conecta a ligação ao cliente.
            </p>
          </div>
          <span className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-black ${status.data?.configured ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
            <Headphones className="h-4 w-4" /> {status.data?.configured ? `Telefonia pronta ${status.data.callerNumber ?? ""}` : "Telefonia não configurada"}
          </span>
        </div>

        {!status.isLoading && !status.data?.configured && (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-6 text-[var(--mi-text-muted)]">
            Configure <strong>TWILIO_ACCOUNT_SID</strong>, <strong>TWILIO_AUTH_TOKEN</strong> e <strong>TWILIO_PHONE_NUMBER</strong> no EasyPanel. Em produção, também é possível usar <strong>TWILIO_API_KEY_SID</strong> e <strong>TWILIO_API_KEY_SECRET</strong>.
          </div>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">Leads</p>
                <h2 className="mt-1 text-lg font-black">CRM para ligar</h2>
              </div>
              <Button size="icon" variant="outline" onClick={() => void leads.refetch()} className="rounded-xl border-[var(--mi-border)]"><RefreshCw className={`h-4 w-4 ${leads.isFetching ? "animate-spin" : ""}`} /></Button>
            </div>
            <div className="mt-4 max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {(leads.data ?? []).filter((lead) => lead.client_phone).map((lead) => (
                <button key={lead.id} type="button" onClick={() => setSelectedLeadId(lead.id)} className={`w-full rounded-2xl border p-4 text-left transition ${selectedLeadId === lead.id ? "border-blue-500/40 bg-blue-500/[0.08]" : "border-[var(--mi-border)] bg-[var(--mi-surface-soft)] hover:border-blue-500/25"}`}>
                  <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-500/10 text-blue-600"><UserRound className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{lead.client_name}</span><span className="mt-1 block text-xs text-[var(--mi-text-soft)]">{lead.client_phone}</span><span className="mt-2 inline-flex rounded-full bg-[var(--mi-bg)] px-2 py-1 text-[10px] font-black uppercase text-[var(--mi-text-muted)]">{lead.status || "novo"}</span></span></div>
                </button>
              ))}
              {(leads.data ?? []).filter((lead) => lead.client_phone).length === 0 && !leads.isFetching && <div className="rounded-2xl border border-dashed border-[var(--mi-border)] p-6 text-center text-sm text-[var(--mi-text-soft)]">Cadastre telefone nos leads do CRM para usar o discador.</div>}
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-7">
            <div className="mx-auto max-w-md">
              <div className="text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-blue-500/10 text-blue-600"><PhoneCall className="h-7 w-7" /></span><h2 className="mt-3 text-xl font-black">Nova chamada</h2><p className="mt-1 text-xs text-[var(--mi-text-soft)]">Chamadas comerciais com origem identificada pelo número de telefonia configurado.</p></div>

              <label className="mt-6 block"><span className="mb-1.5 block text-xs font-black text-[var(--mi-text-muted)]">Seu telefone para receber a ponte</span><input value={agentPhone} onChange={(event) => setAgentPhone(event.target.value)} placeholder="47 99999-9999" className="h-12 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 text-center text-lg font-black tracking-wide outline-none focus:border-blue-500" /></label>
              <label className="mt-4 block"><span className="mb-1.5 block text-xs font-black text-[var(--mi-text-muted)]">Telefone do cliente</span><input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="47 98888-8888" className="h-14 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 text-center text-2xl font-black tracking-wide outline-none focus:border-blue-500" /></label>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {KEYS.map((key) => <button key={key} type="button" onClick={() => pressKey(key)} className="h-14 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-lg font-black transition hover:border-blue-500/30 hover:bg-blue-500/[0.05]">{key}</button>)}
              </div>

              <Button onClick={() => void call()} disabled={calling || !status.data?.configured} className="mt-5 h-14 w-full rounded-2xl bg-emerald-600 text-base font-black text-white hover:bg-emerald-700"><Phone className="mr-2 h-5 w-5" /> {calling ? "Iniciando chamada..." : "Ligar para o cliente"}</Button>

              {lastCall && <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 text-sm"><p className="font-black text-emerald-700">Chamada solicitada</p><p className="mt-1 text-[var(--mi-text-muted)]">Cliente: {lastCall.customerPhone}</p><p className="text-[var(--mi-text-muted)]">Status inicial: {lastCall.status}</p></div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
