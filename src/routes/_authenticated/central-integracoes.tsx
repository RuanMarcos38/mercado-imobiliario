import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Code2,
  Copy,
  DatabaseBackup,
  ExternalLink,
  KeyRound,
  Link2,
  MessageCircle,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  backupToGoogleDriveNow,
  createMyApiToken,
  disconnectGoogle,
  getGoogleConnectUrl,
  getIntegrationHubOverview,
  revokeMyApiToken,
} from "@/lib/integrations-hub.functions";
import {
  listExternalPropertyLinks,
  registerExternalPropertyLink,
  syncExternalPropertyLinkNow,
} from "@/lib/property-links.functions";
import {
  getMetaWhatsAppBusinessProfileSettings,
  getMetaWhatsAppOfficialSettings,
  saveMetaWhatsAppBusinessProfileSettings,
  saveMetaWhatsAppOfficialSettings,
} from "@/lib/whatsapp-connection.functions";
import {
  getMetaSocialAccountSettings,
  selectMetaSocialAccountForTenant,
} from "@/lib/meta-social.functions";

export const Route = createFileRoute("/_authenticated/central-integracoes")({
  component: IntegrationsHubPage,
  head: () => ({ title: "Central de Integrações | MercadoImobi" }),
});

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

const API_TOKEN_PLACEHOLDER = "mi_live_SEU_TOKEN";

const N8N_HEADERS_EXAMPLE = `Authorization: Bearer ${API_TOKEN_PLACEHOLDER}
Content-Type: application/json`;

const N8N_LEAD_EXAMPLE = `{
  "contactName": "Maria Souza",
  "contactPhone": "+5547999999999",
  "contactEmail": "maria@email.com",
  "propertyReference": "MI-20260920-001098",
  "source": "n8n",
  "notes": "Lead importado por automacao N8N"
}`;

const N8N_APPOINTMENT_EXAMPLE = `{
  "contactName": "Maria Souza",
  "contactPhone": "+5547999999999",
  "title": "Visita ao imovel",
  "startsAt": "2026-09-21T14:00:00-03:00",
  "endsAt": "2026-09-21T14:30:00-03:00",
  "meetingType": "meet",
  "notes": "Criado pelo fluxo N8N"
}`;

const N8N_PROPERTY_WEBHOOK_EXAMPLE = `{
  "title": "Apartamento no Centro",
  "price": 450000,
  "source_url": "https://portal.com.br/anuncio/imovel",
  "location_city": "Joinville",
  "location_state": "SC",
  "property_type": "apartamento",
  "source_portal": "n8n"
}`;

function n8nWebhookUrlFromApiBase(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/api\/v1\/?$/, "/api/public/hooks/n8n-webhook");
}

function IntegrationsHubPage() {
  const overviewFn = useServerFn(getIntegrationHubOverview);
  const googleUrlFn = useServerFn(getGoogleConnectUrl);
  const disconnectGoogleFn = useServerFn(disconnectGoogle);
  const driveBackupFn = useServerFn(backupToGoogleDriveNow);
  const createTokenFn = useServerFn(createMyApiToken);
  const revokeTokenFn = useServerFn(revokeMyApiToken);
  const listLinksFn = useServerFn(listExternalPropertyLinks);
  const registerLinkFn = useServerFn(registerExternalPropertyLink);
  const syncLinkFn = useServerFn(syncExternalPropertyLinkNow);
  const whatsappOfficialFn = useServerFn(getMetaWhatsAppOfficialSettings);
  const saveWhatsappOfficialFn = useServerFn(saveMetaWhatsAppOfficialSettings);
  const whatsappProfileFn = useServerFn(getMetaWhatsAppBusinessProfileSettings);
  const saveWhatsappProfileFn = useServerFn(saveMetaWhatsAppBusinessProfileSettings);
  const metaSocialSettingsFn = useServerFn(getMetaSocialAccountSettings);
  const selectMetaSocialAccountFn = useServerFn(selectMetaSocialAccountForTenant);

  const overview = useQuery({
    queryKey: ["integration-hub"],
    queryFn: () => overviewFn(),
    refetchInterval: 60_000,
  });
  const links = useQuery({
    queryKey: ["external-property-links"],
    queryFn: () => listLinksFn(),
    refetchInterval: 60_000,
  });
  const whatsappOfficial = useQuery({
    queryKey: ["meta-whatsapp-official-settings"],
    queryFn: () => whatsappOfficialFn(),
    refetchInterval: 60_000,
  });
  const whatsappProfile = useQuery({
    queryKey: ["meta-whatsapp-business-profile"],
    queryFn: () => whatsappProfileFn(),
    refetchInterval: 60_000,
  });
  const metaSocial = useQuery({
    queryKey: ["meta-social-account-settings"],
    queryFn: () => metaSocialSettingsFn(),
    refetchInterval: 60_000,
  });
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("Minha integração");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [propertyUrl, setPropertyUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingMetaWhatsApp, setSavingMetaWhatsApp] = useState(false);
  const [savingMetaSocial, setSavingMetaSocial] = useState(false);
  const [selectedMetaPageId, setSelectedMetaPageId] = useState("");
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState("");
  const [metaBusinessAccountId, setMetaBusinessAccountId] = useState("");
  const [metaDisplayPhoneNumber, setMetaDisplayPhoneNumber] = useState("");
  const [metaGraphVersion, setMetaGraphVersion] = useState("v26.0");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaFieldNonce, setMetaFieldNonce] = useState(0);
  const [savingMetaProfile, setSavingMetaProfile] = useState(false);
  const [metaProfileAbout, setMetaProfileAbout] = useState("");
  const [metaProfileDescription, setMetaProfileDescription] = useState("");
  const [metaProfileAddress, setMetaProfileAddress] = useState("");
  const [metaProfileEmail, setMetaProfileEmail] = useState("");
  const [metaProfileWebsite1, setMetaProfileWebsite1] = useState("");
  const [metaProfileWebsite2, setMetaProfileWebsite2] = useState("");
  const [metaProfileVertical, setMetaProfileVertical] = useState("UNDEFINED");
  const [metaCatalogVisible, setMetaCatalogVisible] = useState(false);
  const [metaCartEnabled, setMetaCartEnabled] = useState(false);
  const [metaProfilePictureBase64, setMetaProfilePictureBase64] = useState("");
  const [metaProfilePictureMimeType, setMetaProfilePictureMimeType] = useState<
    "" | "image/jpeg" | "image/png"
  >("");
  const [metaProfilePictureFileName, setMetaProfilePictureFileName] = useState("");
  const [metaProfilePicturePreview, setMetaProfilePicturePreview] = useState("");

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of overview.data?.catalog ?? []) map.set(item.categoryKey, item.categoryLabel);
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [overview.data?.catalog]);
  const selectedCategory = activeCategory || categories[0]?.key || null;
  const providers = (overview.data?.catalog ?? []).filter(
    (item) => !selectedCategory || item.categoryKey === selectedCategory,
  );
  const whatsappSettings = whatsappOfficial.data;
  const whatsappSourceLabel =
    whatsappSettings?.source === "platform"
      ? "Plataforma"
      : whatsappSettings?.source === "server_env"
        ? "Servidor"
        : "Não configurado";
  const resolvedMetaPhoneNumberId = metaPhoneNumberId || whatsappSettings?.phoneNumberId || "";
  const resolvedMetaBusinessAccountId =
    metaBusinessAccountId || whatsappSettings?.businessAccountId || "";
  const resolvedMetaDisplayPhoneNumber =
    metaDisplayPhoneNumber || whatsappSettings?.displayPhoneNumber || "";
  const resolvedMetaGraphVersion = metaGraphVersion || whatsappSettings?.graphVersion || "v26.0";
  const metaSocialSettings = metaSocial.data;
  const metaSocialAccounts = metaSocialSettings?.accounts ?? [];
  const activeMetaAccount =
    metaSocialAccounts.find((account) => account.isActive) ??
    metaSocialAccounts.find((account) => account.pageId === selectedMetaPageId) ??
    null;
  const selectedMetaAccount =
    metaSocialAccounts.find((account) => account.pageId === selectedMetaPageId) ??
    activeMetaAccount;
  const apiBaseUrl = overview.data?.apiBaseUrl ?? "";
  const n8nWebhookUrl = apiBaseUrl ? n8nWebhookUrlFromApiBase(apiBaseUrl) : "";
  const n8nEndpoints = useMemo(() => {
    if (!apiBaseUrl) return [];
    const baseUrl = apiBaseUrl.replace(/\/$/, "");
    const endpoints = [
      {
        label: "Buscar imoveis",
        method: "GET",
        value: `${baseUrl}/properties?q=apartamento&city=Joinville&limit=20`,
      },
      { label: "Listar leads", method: "GET", value: `${baseUrl}/leads?limit=50` },
      { label: "Criar lead", method: "POST", value: `${baseUrl}/leads` },
      { label: "Criar agenda", method: "POST", value: `${baseUrl}/appointments` },
    ];
    if (n8nWebhookUrl) {
      endpoints.push({
        label: "Importar imovel",
        method: "POST",
        value: n8nWebhookUrl,
      });
    }
    return endpoints;
  }, [apiBaseUrl, n8nWebhookUrl]);

  useEffect(() => {
    if (!whatsappSettings) return;
    const syncOfficialFields = () => {
      setMetaPhoneNumberId(whatsappSettings.phoneNumberId || "");
      setMetaBusinessAccountId(whatsappSettings.businessAccountId || "");
      setMetaDisplayPhoneNumber(whatsappSettings.displayPhoneNumber || "");
      setMetaGraphVersion(whatsappSettings.graphVersion || "v26.0");
      setMetaFieldNonce((current) => current + 1);
    };
    syncOfficialFields();
    const firstTimer = window.setTimeout(syncOfficialFields, 250);
    const secondTimer = window.setTimeout(syncOfficialFields, 1200);
    return () => {
      window.clearTimeout(firstTimer);
      window.clearTimeout(secondTimer);
    };
  }, [
    whatsappSettings?.businessAccountId,
    whatsappSettings?.displayPhoneNumber,
    whatsappSettings?.graphVersion,
    whatsappSettings?.phoneNumberId,
  ]);

  useEffect(() => {
    const profile = whatsappProfile.data?.profile;
    if (!profile) return;
    setMetaProfileAbout(profile.about || "");
    setMetaProfileDescription(profile.description || "");
    setMetaProfileAddress(profile.address || "");
    setMetaProfileEmail(profile.email || "");
    setMetaProfileWebsite1(profile.websites?.[0] || "");
    setMetaProfileWebsite2(profile.websites?.[1] || "");
    setMetaProfileVertical(profile.vertical || "UNDEFINED");
    setMetaProfilePicturePreview(profile.profilePictureUrl || "");
    setMetaCatalogVisible(Boolean(whatsappProfile.data?.commerce?.isCatalogVisible));
    setMetaCartEnabled(Boolean(whatsappProfile.data?.commerce?.isCartEnabled));
  }, [
    whatsappProfile.data?.commerce?.isCartEnabled,
    whatsappProfile.data?.commerce?.isCatalogVisible,
    whatsappProfile.data?.profile?.about,
    whatsappProfile.data?.profile?.address,
    whatsappProfile.data?.profile?.description,
    whatsappProfile.data?.profile?.email,
    whatsappProfile.data?.profile?.profilePictureUrl,
    whatsappProfile.data?.profile?.vertical,
    whatsappProfile.data?.profile?.websites,
  ]);

  useEffect(() => {
    const accounts = metaSocialSettings?.accounts ?? [];
    if (!accounts.length) {
      setSelectedMetaPageId("");
      return;
    }
    const preferred = metaSocialSettings?.activePageId || accounts[0]?.pageId || "";
    if (!selectedMetaPageId || !accounts.some((account) => account.pageId === selectedMetaPageId)) {
      setSelectedMetaPageId(preferred);
    }
  }, [metaSocialSettings?.accounts, metaSocialSettings?.activePageId, selectedMetaPageId]);

  const connectGoogle = async () => {
    try {
      const result = await googleUrlFn();
      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google ainda não está configurado.");
    }
  };

  const createToken = async () => {
    if (tokenName.trim().length < 2) return;
    try {
      const result = await createTokenFn({ data: { name: tokenName.trim() } });
      setRevealedToken(result.token);
      await overview.refetch();
      toast.success("Token individual criado. Copie agora: ele não será exibido novamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar token.");
    }
  };

  const copyText = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Nao foi possivel copiar automaticamente.");
    }
  };

  const importProperty = async () => {
    if (!propertyUrl.trim() || busy) return;
    setBusy(true);
    try {
      const result = await registerLinkFn({ data: { url: propertyUrl.trim() } });
      setPropertyUrl("");
      await links.refetch();
      if (result.syncStatus === "active") {
        toast.success("Anúncio reconhecido e incluído na base de imóveis.");
      } else if (result.syncStatus === "partner_required") {
        toast.info(
          "O portal exige integração oficial. O link foi salvo para monitoramento sem contornar o bloqueio.",
        );
      } else {
        toast.info("Link registrado. A plataforma continuará tentando a atualização horária.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar o anúncio.");
    } finally {
      setBusy(false);
    }
  };

  const saveMetaWhatsApp = async () => {
    if (savingMetaWhatsApp) return;
    if (!resolvedMetaPhoneNumberId.trim()) {
      toast.error("Informe o Phone Number ID da WhatsApp Cloud API.");
      return;
    }
    setSavingMetaWhatsApp(true);
    try {
      await saveWhatsappOfficialFn({
        data: {
          accessToken: metaAccessToken.trim() || undefined,
          phoneNumberId: resolvedMetaPhoneNumberId.trim(),
          businessAccountId: resolvedMetaBusinessAccountId.trim() || undefined,
          displayPhoneNumber: resolvedMetaDisplayPhoneNumber.trim() || undefined,
          graphVersion: resolvedMetaGraphVersion.trim() || undefined,
        },
      });
      setMetaAccessToken("");
      await Promise.all([
        whatsappOfficial.refetch(),
        whatsappProfile.refetch(),
        overview.refetch(),
      ]);
      toast.success("WhatsApp API Oficial validada e salva para esta organização.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a configuração oficial da Meta.",
      );
    } finally {
      setSavingMetaWhatsApp(false);
    }
  };

  const selectMetaProfilePicture = (file: File | null) => {
    if (!file) return;
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      toast.error("A foto de perfil deve ser JPEG ou PNG.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A foto de perfil deve ter no máximo 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setMetaProfilePictureBase64(result);
      setMetaProfilePicturePreview(result);
      setMetaProfilePictureMimeType(file.type as "image/jpeg" | "image/png");
      setMetaProfilePictureFileName(file.name);
    };
    reader.onerror = () => toast.error("Não foi possível ler a imagem selecionada.");
    reader.readAsDataURL(file);
  };

  const saveMetaProfile = async () => {
    if (savingMetaProfile) return;
    if (!whatsappSettings?.configured) {
      toast.error("Valide primeiro a WhatsApp Cloud API desta organização.");
      return;
    }
    setSavingMetaProfile(true);
    try {
      const currentProfileLoaded = Boolean(whatsappProfile.data?.profile);
      const result = await saveWhatsappProfileFn({
        data: {
          ...(currentProfileLoaded
            ? {
                about: metaProfileAbout,
                description: metaProfileDescription,
                address: metaProfileAddress,
                email: metaProfileEmail,
                websites: [metaProfileWebsite1, metaProfileWebsite2],
                vertical: metaProfileVertical as
                  | "UNDEFINED"
                  | "OTHER"
                  | "AUTO"
                  | "BEAUTY"
                  | "APPAREL"
                  | "EDU"
                  | "ENTERTAIN"
                  | "EVENT_PLAN"
                  | "FINANCE"
                  | "GROCERY"
                  | "GOVT"
                  | "HOTEL"
                  | "HEALTH"
                  | "NONPROFIT"
                  | "PROF_SERVICES"
                  | "RETAIL"
                  | "TRAVEL"
                  | "RESTAURANT"
                  | "NOT_A_BIZ",
              }
            : {}),
          ...(metaProfilePictureBase64 && metaProfilePictureMimeType && metaProfilePictureFileName
            ? {
                profilePictureBase64: metaProfilePictureBase64,
                profilePictureMimeType: metaProfilePictureMimeType,
                profilePictureFileName: metaProfilePictureFileName,
              }
            : {}),
          ...(whatsappProfile.data?.commerceAvailable
            ? {
                isCatalogVisible: metaCatalogVisible,
                isCartEnabled: metaCartEnabled,
              }
            : {}),
        },
      });
      setMetaProfilePictureBase64("");
      setMetaProfilePictureMimeType("");
      setMetaProfilePictureFileName("");
      await whatsappProfile.refetch();
      if (result.warning) {
        toast.info("Perfil salvo. A Meta não liberou os controles de catálogo para este número.");
      } else {
        toast.success("Perfil comercial do WhatsApp atualizado pela API oficial da Meta.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o perfil comercial do WhatsApp.",
      );
    } finally {
      setSavingMetaProfile(false);
    }
  };

  const connectMetaSocial = (forceAccountSelection = false) => {
    const targetUrl = forceAccountSelection
      ? metaSocialSettings?.switchAccountUrl || metaSocialSettings?.connectUrl
      : metaSocialSettings?.connectUrl;
    if (!metaSocialSettings?.configured || !targetUrl) {
      toast.info("Configure META_APP_ID e META_APP_SECRET no servidor para liberar a conexão.");
      return;
    }
    window.location.assign(targetUrl);
  };

  const saveMetaSocialAccount = async () => {
    if (savingMetaSocial) return;
    if (!selectedMetaPageId) {
      toast.error("Escolha a conta Meta de atendimento deste cliente.");
      return;
    }
    setSavingMetaSocial(true);
    try {
      await selectMetaSocialAccountFn({ data: { pageId: selectedMetaPageId } });
      await Promise.all([metaSocial.refetch(), overview.refetch()]);
      toast.success("Conta Direct/Messenger salva para este cliente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a conta Meta.");
    } finally {
      setSavingMetaSocial(false);
    }
  };

  if (overview.isLoading) {
    return <div className="p-8 text-sm text-[var(--mi-text-muted)]">Carregando integrações...</div>;
  }
  if (overview.error || !overview.data) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar a Central de Integrações.{" "}
        {String((overview.error as Error)?.message ?? "")}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
              Ecossistema
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Central de Integrações</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Conecte agenda, Google Meet, Drive, automações, APIs e fontes imobiliárias sem
              misturar dados entre usuários. Cada token e conexão pertence ao usuário e à
              organização autenticada.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Integrações
              isoladas por usuário
            </span>
            <Button
              variant="outline"
              onClick={() =>
                void Promise.all([
                  overview.refetch(),
                  links.refetch(),
                  whatsappOfficial.refetch(),
                  whatsappProfile.refetch(),
                  metaSocial.refetch(),
                ])
              }
            >
              <RefreshCw className="h-4 w-4" /> Atualizar
            </Button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <aside className="h-fit rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-2 xl:sticky xl:top-20">
            <p className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
              Categorias
            </p>
            <div className="space-y-1">
              {categories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold transition ${
                    selectedCategory === category.key
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "text-[var(--mi-text-muted)] hover:bg-[var(--mi-bg)]"
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </aside>

          <main className="space-y-6">
            <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {providers.map((item) => (
                <div
                  key={item.key}
                  className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                      <Plug className="h-5 w-5" />
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <h2 className="mt-4 font-black">{item.name}</h2>
                  <p className="mt-2 text-xs leading-5 text-[var(--mi-text-muted)]">
                    {item.description}
                  </p>
                </div>
              ))}
            </section>

            <section className="grid gap-6 2xl:grid-cols-2">
              <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700">
                      <MessageCircle className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-black">WhatsApp API Oficial da Meta</h2>
                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                        Cloud API por organização, sem QR Code e sem alterar o OpenAI.
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={
                      whatsappSettings?.connected
                        ? "configured"
                        : whatsappSettings?.configured
                          ? "error"
                          : "available"
                    }
                  />
                </div>

                <div className="mt-4 grid gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3 text-xs">
                  <IntegrationRow
                    label="Status"
                    value={
                      whatsappOfficial.isLoading
                        ? "Validando..."
                        : whatsappSettings?.detail || "Aguardando configuração."
                    }
                  />
                  <IntegrationRow label="Origem" value={whatsappSourceLabel} />
                  <IntegrationRow
                    label="Phone Number ID"
                    value={whatsappSettings?.phoneNumberId || "—"}
                  />
                  <IntegrationRow
                    label="Número"
                    value={whatsappSettings?.displayPhoneNumber || "—"}
                  />
                  <IntegrationRow label="Webhook" value={whatsappSettings?.callbackUrl || "—"} />
                </div>

                {whatsappOfficial.error && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-500/[0.06] p-3 text-xs text-amber-800">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {whatsappOfficial.error instanceof Error
                        ? whatsappOfficial.error.message
                        : "Não foi possível carregar a configuração da Meta."}
                    </span>
                  </div>
                )}

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-xs font-bold">
                    <span>Phone Number ID</span>
                    <Input
                      key={`meta-phone-number-id-${metaFieldNonce}`}
                      name={`meta_phone_number_id_${metaFieldNonce}`}
                      value={resolvedMetaPhoneNumberId}
                      onChange={(event) => setMetaPhoneNumberId(event.target.value)}
                      placeholder="1234567890"
                      autoComplete="off"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-bold">
                    <span>ID da conta WhatsApp</span>
                    <Input
                      key={`meta-business-account-id-${metaFieldNonce}`}
                      name={`meta_whatsapp_account_id_${metaFieldNonce}`}
                      value={resolvedMetaBusinessAccountId}
                      onChange={(event) => setMetaBusinessAccountId(event.target.value)}
                      placeholder="Opcional"
                      autoComplete="off"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-bold">
                    <span>Número exibido</span>
                    <Input
                      key={`meta-display-phone-number-${metaFieldNonce}`}
                      name={`meta_display_phone_number_${metaFieldNonce}`}
                      value={resolvedMetaDisplayPhoneNumber}
                      onChange={(event) => setMetaDisplayPhoneNumber(event.target.value)}
                      placeholder="+55..."
                      autoComplete="off"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-bold">
                    <span>Versão Graph</span>
                    <Input
                      key={`meta-graph-version-${metaFieldNonce}`}
                      name={`meta_graph_version_${metaFieldNonce}`}
                      value={resolvedMetaGraphVersion}
                      onChange={(event) => setMetaGraphVersion(event.target.value)}
                      placeholder="v26.0"
                      autoComplete="off"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-bold md:col-span-2">
                    <span>Token permanente</span>
                    <Input
                      key={`meta-access-token-${metaFieldNonce}`}
                      name={`meta_access_token_${metaFieldNonce}`}
                      type="password"
                      value={metaAccessToken}
                      onChange={(event) => setMetaAccessToken(event.target.value)}
                      placeholder={
                        whatsappSettings?.hasToken
                          ? "Deixe vazio para manter o token salvo"
                          : "Cole o token oficial da WhatsApp Cloud API"
                      }
                      autoComplete="off"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => void saveMetaWhatsApp()}
                    disabled={savingMetaWhatsApp || whatsappOfficial.isLoading}
                    className="rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700"
                  >
                    {savingMetaWhatsApp ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Salvar e validar API Oficial
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void whatsappOfficial.refetch()}
                    disabled={whatsappOfficial.isFetching}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${whatsappOfficial.isFetching ? "animate-spin" : ""}`}
                    />
                    Atualizar status
                  </Button>
                </div>

                <div
                  id="whatsapp-profile"
                  className="mt-6 scroll-mt-24 border-t border-[var(--mi-border)] pt-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black">Perfil Comercial e Catálogo</h3>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--mi-text-muted)]">
                        Atualiza foto, descrição e dados públicos usando a mesma conexão oficial já
                        salva. Token, Phone Number ID e demais credenciais não são alterados.
                      </p>
                    </div>
                    <StatusBadge
                      status={
                        whatsappSettings?.configured
                          ? whatsappProfile.error
                            ? "error"
                            : "configured"
                          : "available"
                      }
                    />
                  </div>

                  {!whatsappSettings?.configured ? (
                    <div className="mt-4 rounded-xl border border-amber-300/50 bg-amber-500/[0.06] p-3 text-xs text-amber-800">
                      Valide a API Oficial acima para liberar a edição do perfil comercial.
                    </div>
                  ) : (
                    <>
                      {whatsappProfile.error && (
                        <div className="mt-4 rounded-xl border border-amber-300/50 bg-amber-500/[0.06] p-3 text-xs leading-5 text-amber-800">
                          O perfil atual não pôde ser carregado pela Meta. A opção de foto continua
                          disponível abaixo. Se a Meta recusar ao salvar, confirme que o token possui
                          a permissão whatsapp_business_management.
                        </div>
                      )}
                      <div className="mt-4 grid gap-4 lg:grid-cols-[160px_1fr]">
                        <div>
                          <div className="grid h-36 w-36 place-items-center overflow-hidden rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)]">
                            {metaProfilePicturePreview ? (
                              <img
                                src={metaProfilePicturePreview}
                                alt="Foto de perfil do WhatsApp"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <MessageCircle className="h-10 w-10 text-[var(--mi-text-soft)]" />
                            )}
                          </div>
                          <label className="mt-3 block cursor-pointer text-xs font-black text-blue-600">
                            Alterar foto
                            <input
                              type="file"
                              accept="image/jpeg,image/png"
                              className="hidden"
                              onChange={(event) =>
                                selectMetaProfilePicture(event.target.files?.[0] ?? null)
                              }
                            />
                          </label>
                          <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                            JPEG ou PNG, até 5 MB.
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-xs font-bold md:col-span-2">
                            <span>Descrição</span>
                            <textarea
                              value={metaProfileDescription}
                              onChange={(event) => setMetaProfileDescription(event.target.value)}
                              maxLength={256}
                              rows={3}
                              className="w-full rounded-lg border border-[var(--mi-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500"
                              placeholder="Descrição pública da empresa"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-bold md:col-span-2">
                            <span>Sobre</span>
                            <Input
                              value={metaProfileAbout}
                              onChange={(event) => setMetaProfileAbout(event.target.value)}
                              maxLength={139}
                              placeholder="Texto curto exibido no perfil"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-bold">
                            <span>E-mail</span>
                            <Input
                              type="email"
                              value={metaProfileEmail}
                              onChange={(event) => setMetaProfileEmail(event.target.value)}
                              placeholder="contato@empresa.com.br"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-bold">
                            <span>Segmento</span>
                            <select
                              value={metaProfileVertical}
                              onChange={(event) => setMetaProfileVertical(event.target.value)}
                              className="h-10 w-full rounded-lg border border-[var(--mi-border)] bg-transparent px-3 text-sm"
                            >
                              <option value="PROF_SERVICES">Serviços profissionais</option>
                              <option value="OTHER">Outros</option>
                              <option value="RETAIL">Varejo</option>
                              <option value="FINANCE">Finanças</option>
                              <option value="HOTEL">Hotelaria</option>
                              <option value="TRAVEL">Viagens</option>
                              <option value="RESTAURANT">Restaurante</option>
                              <option value="HEALTH">Saúde</option>
                              <option value="EDU">Educação</option>
                              <option value="ENTERTAIN">Entretenimento</option>
                              <option value="EVENT_PLAN">Eventos</option>
                              <option value="APPAREL">Moda</option>
                              <option value="BEAUTY">Beleza</option>
                              <option value="AUTO">Automotivo</option>
                              <option value="GROCERY">Alimentação</option>
                              <option value="NONPROFIT">Sem fins lucrativos</option>
                              <option value="GOVT">Governo</option>
                              <option value="UNDEFINED">Não definido</option>
                            </select>
                          </label>
                          <label className="space-y-1 text-xs font-bold md:col-span-2">
                            <span>Endereço</span>
                            <Input
                              value={metaProfileAddress}
                              onChange={(event) => setMetaProfileAddress(event.target.value)}
                              maxLength={256}
                              placeholder="Endereço comercial"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-bold">
                            <span>Site 1</span>
                            <Input
                              type="url"
                              value={metaProfileWebsite1}
                              onChange={(event) => setMetaProfileWebsite1(event.target.value)}
                              placeholder="https://..."
                            />
                          </label>
                          <label className="space-y-1 text-xs font-bold">
                            <span>Site 2</span>
                            <Input
                              type="url"
                              value={metaProfileWebsite2}
                              onChange={(event) => setMetaProfileWebsite2(event.target.value)}
                              placeholder="https://..."
                            />
                          </label>
                        </div>
                      </div>

                      <div className="mt-4 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black">Catálogo do WhatsApp</p>
                            <p className="mt-1 max-w-xl text-[11px] leading-5 text-[var(--mi-text-soft)]">
                              Se um catálogo já estiver associado a este número na Meta, controle
                              aqui a exibição do catálogo e do carrinho.
                            </p>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--mi-text-soft)]">
                            {whatsappProfile.data?.commerceAvailable
                              ? "Disponível"
                              : "Catálogo não associado"}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-5">
                          <label className="flex items-center gap-2 text-xs font-bold">
                            <input
                              type="checkbox"
                              checked={metaCatalogVisible}
                              disabled={!whatsappProfile.data?.commerceAvailable}
                              onChange={(event) => setMetaCatalogVisible(event.target.checked)}
                            />
                            Exibir catálogo
                          </label>
                          <label className="flex items-center gap-2 text-xs font-bold">
                            <input
                              type="checkbox"
                              checked={metaCartEnabled}
                              disabled={!whatsappProfile.data?.commerceAvailable}
                              onChange={(event) => setMetaCartEnabled(event.target.checked)}
                            />
                            Habilitar carrinho
                          </label>
                        </div>
                        {whatsappProfile.data?.warning && (
                          <p className="mt-3 text-[11px] leading-5 text-amber-700">
                            O perfil pode ser editado normalmente. Para usar catálogo, associe um
                            catálogo compatível ao número no ambiente da Meta.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          onClick={() => void saveMetaProfile()}
                          disabled={savingMetaProfile || whatsappProfile.isFetching}
                          className="rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
                        >
                          {savingMetaProfile ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-4 w-4" />
                          )}
                          Salvar perfil comercial
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void whatsappProfile.refetch()}
                          disabled={whatsappProfile.isFetching}
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${whatsappProfile.isFetching ? "animate-spin" : ""}`}
                          />
                          Recarregar perfil
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                      <MessageCircle className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-black">Direct e Messenger da Meta</h2>
                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                        Escolha a conta de atendimento deste cliente. A caixa de conversas não exibe
                        estruturas empresariais nem lista de páginas.
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={
                      metaSocialSettings?.connected
                        ? "configured"
                        : metaSocialSettings?.configured
                          ? "available"
                          : "error"
                    }
                  />
                </div>

                <div className="mt-4 grid gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3 text-xs">
                  <IntegrationRow
                    label="Status"
                    value={
                      metaSocial.isLoading
                        ? "Carregando..."
                        : metaSocialSettings?.connected
                          ? "Conta ativa definida para este cliente."
                          : "Aguardando conexão Meta."
                    }
                  />
                  <IntegrationRow label="Conta ativa" value={activeMetaAccount?.label || "—"} />
                  <IntegrationRow
                    label="Canais"
                    value={
                      metaSocialSettings?.connected
                        ? [
                            metaSocialSettings.channels.messenger ? "Messenger" : null,
                            metaSocialSettings.channels.instagramDirect ? "Instagram Direct" : null,
                          ]
                            .filter(Boolean)
                            .join(" + ") || "Messenger"
                        : "—"
                    }
                  />
                </div>

                {metaSocial.error && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-500/[0.06] p-3 text-xs text-amber-800">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {metaSocial.error instanceof Error
                        ? metaSocial.error.message
                        : "Não foi possível carregar a conexão Meta."}
                    </span>
                  </div>
                )}

                {metaSocialAccounts.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <label className="space-y-1 text-xs font-bold">
                      <span>Conta deste cliente</span>
                      <select
                        value={selectedMetaPageId}
                        onChange={(event) => setSelectedMetaPageId(event.target.value)}
                        className="h-11 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3 text-sm font-bold outline-none focus:border-blue-500"
                      >
                        {metaSocialAccounts.map((account) => (
                          <option key={account.pageId} value={account.pageId}>
                            {account.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid gap-2 text-[11px] text-[var(--mi-text-muted)] sm:grid-cols-2">
                      <div className="rounded-xl bg-[var(--mi-bg)] p-3">
                        <strong className="text-[var(--mi-text)]">Messenger:</strong>{" "}
                        {selectedMetaAccount?.hasMessenger ? "Disponível" : "Não conectado"}
                      </div>
                      <div className="rounded-xl bg-[var(--mi-bg)] p-3">
                        <strong className="text-[var(--mi-text)]">Instagram Direct:</strong>{" "}
                        {selectedMetaAccount?.hasInstagramDirect ? "Disponível" : "Não conectado"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-[var(--mi-text-muted)]">
                    Conecte o login Meta do cliente para liberar Direct e Messenger oficiais.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {metaSocialAccounts.length > 0 && (
                    <Button
                      onClick={() => void saveMetaSocialAccount()}
                      disabled={savingMetaSocial || metaSocial.isLoading}
                      className="rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
                    >
                      {savingMetaSocial ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      Salvar conta do cliente
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => connectMetaSocial(true)}
                    disabled={metaSocial.isLoading || metaSocialSettings?.configured === false}
                  >
                    <Link2 className="h-4 w-4" /> Escolher login Meta
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void metaSocial.refetch()}
                    disabled={metaSocial.isFetching}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${metaSocial.isFetching ? "animate-spin" : ""}`}
                    />
                    Atualizar status
                  </Button>
                </div>
              </div>

              <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                      <CalendarClock className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-black">Google Agenda + Meet + Drive</h2>
                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                        OAuth individual, agendamentos do CRM e backup automático diário.
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={overview.data.google.connected ? "configured" : "available"}
                  />
                </div>
                {overview.data.google.connected ? (
                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl bg-emerald-500/[0.06] p-3 text-xs">
                      <strong className="text-emerald-700">Conectado:</strong>{" "}
                      {overview.data.google.email || "Conta Google"}
                      <br />
                      <span className="text-[var(--mi-text-muted)]">
                        Desde {dateTime(overview.data.google.connectedAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const result = await driveBackupFn();
                            toast.success(`${result.name} salvo no Google Drive.`);
                            await overview.refetch();
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Falha no backup.",
                            );
                          }
                        }}
                      >
                        <DatabaseBackup className="h-4 w-4" /> Fazer backup agora
                      </Button>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await disconnectGoogleFn();
                          await overview.refetch();
                          toast.success("Google desconectado desta conta.");
                        }}
                      >
                        Desconectar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5">
                    <Button
                      onClick={() => void connectGoogle()}
                      disabled={!overview.data.google.configured}
                    >
                      <Cloud className="h-4 w-4" /> Conectar Google
                    </Button>
                    {!overview.data.google.configured && (
                      <p className="mt-3 text-xs leading-5 text-amber-700">
                        A interface está pronta. Para ativar o OAuth em produção, o servidor precisa
                        das credenciais GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET do projeto Google
                        Cloud.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/10 text-violet-700">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-black">API Token individual</h2>
                    <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                      Token exclusivo por usuário para N8N, Make, Zapier, BI ou integrações
                      próprias.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Input value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
                  <Button onClick={() => void createToken()}>
                    <Code2 className="h-4 w-4" /> Gerar token
                  </Button>
                </div>
                {revealedToken && (
                  <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/[0.06] p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] text-amber-700">
                      Copie agora — exibido uma única vez
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Input readOnly value={revealedToken} className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await navigator.clipboard.writeText(revealedToken);
                          toast.success("Token copiado.");
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  {overview.data.apiTokens.map((token) => (
                    <div
                      key={token.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-[var(--mi-bg)] p-3 text-xs"
                    >
                      <div>
                        <p className="font-black">{token.name}</p>
                        <p className="mt-1 font-mono text-[10px] text-[var(--mi-text-soft)]">
                          {token.prefix}•••• · último uso {dateTime(token.lastUsedAt)}
                        </p>
                      </div>
                      {!token.revokedAt && (
                        <Button
                          size="icon"
                          variant="outline"
                          title="Revogar token"
                          onClick={async () => {
                            await revokeTokenFn({ data: { tokenId: token.id } });
                            await overview.refetch();
                            toast.success("Token revogado.");
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-[var(--mi-border)] p-3 text-[11px] text-[var(--mi-text-muted)]">
                  <strong className="text-[var(--mi-text)]">Base API:</strong>{" "}
                  {overview.data.apiBaseUrl}
                  <br />
                  Endpoints iniciais: <code>/properties</code>, <code>/leads</code> e{" "}
                  <code>/appointments</code>.
                </div>

                <div className="mt-4 rounded-2xl border border-blue-200/70 bg-blue-500/[0.04] p-4">
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600/10 text-blue-700">
                          <Plug className="h-4 w-4" />
                        </span>
                        <div>
                          <h3 className="text-sm font-black">N8N pronto por usuario</h3>
                          <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">
                            Use o token individual deste usuario no node HTTP Request. O webhook
                            tambem aceita o mesmo token, sem trocar credenciais globais.
                          </p>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void copyText(N8N_HEADERS_EXAMPLE, "Cabecalho N8N")}
                    >
                      <Copy className="h-4 w-4" /> Copiar cabecalho
                    </Button>
                  </div>

                  <div className="mt-4 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                      Headers no N8N
                    </p>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--mi-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--mi-text-muted)]">
                      {N8N_HEADERS_EXAMPLE}
                    </pre>
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {n8nEndpoints.map((endpoint) => (
                      <button
                        key={`${endpoint.method}-${endpoint.value}`}
                        type="button"
                        onClick={() => void copyText(endpoint.value, endpoint.label)}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 py-2 text-left transition hover:border-blue-300"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-[var(--mi-text)]">
                            {endpoint.label}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-[var(--mi-text-soft)]">
                            {endpoint.method} {endpoint.value}
                          </span>
                        </span>
                        <Copy className="h-4 w-4 shrink-0 text-blue-700" />
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    {[
                      ["Lead", N8N_LEAD_EXAMPLE],
                      ["Agenda", N8N_APPOINTMENT_EXAMPLE],
                      ["Imovel por webhook", N8N_PROPERTY_WEBHOOK_EXAMPLE],
                    ].map(([label, payload]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                            {label}
                          </p>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            title={`Copiar exemplo ${label}`}
                            onClick={() => void copyText(payload, `Exemplo ${label}`)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--mi-bg)] p-3 font-mono text-[10px] leading-5 text-[var(--mi-text-muted)]">
                          {payload}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-blue-600" />
                    <h2 className="font-black">Consulta inteligente de anúncio por link</h2>
                  </div>
                  <p className="mt-2 max-w-4xl text-xs leading-5 text-[var(--mi-text-muted)]">
                    Cole um link público de imóvel. A plataforma lê metadados estruturados e, quando
                    a IA está disponível, ajuda a classificar o anúncio sem inventar dados. O
                    registro é revisitado no máximo a cada 1 hora; se a origem retornar remoção, o
                    imóvel importado deixa a base.
                  </p>
                </div>
                <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-700">
                  Atualização horária
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-2 lg:flex-row">
                <Input
                  value={propertyUrl}
                  onChange={(event) => setPropertyUrl(event.target.value)}
                  placeholder="https://portal.com.br/anuncio/imovel..."
                  className="flex-1"
                />
                <Button
                  onClick={() => void importProperty()}
                  disabled={busy || !propertyUrl.trim()}
                >
                  <Link2 className="h-4 w-4" /> {busy ? "Consultando..." : "Consultar e acompanhar"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--mi-text-soft)]">
                Portais que exigem autenticação, parceria ou proteção anti-bot não são contornados:
                nesses casos o sistema sinaliza que é necessária uma integração oficial.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {(links.data ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">{item.title || item.host}</p>
                        <p className="mt-1 truncate text-[10px] text-[var(--mi-text-soft)]">
                          {item.url}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-3 text-[11px] text-[var(--mi-text-muted)]">
                      Última consulta: {dateTime(item.lastCheckedAt)}
                    </p>
                    {item.lastError && (
                      <p className="mt-2 text-[11px] text-amber-700">{item.lastError}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await syncLinkFn({ data: { id: item.id } });
                          await links.refetch();
                          toast.success("Link verificado novamente.");
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Verificar
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> Origem
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500/10 text-amber-700">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-black">Rauzee / CCA</h2>
                    <StatusBadge status="partner_required" />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--mi-text-muted)]">
                    O conector está reservado na arquitetura, porém o endereço de cadastro de
                    corretor não é uma API. A integração automática de documentos deve usar a
                    API/homologação oficial da Rauzee para evitar automação frágil de login, mistura
                    de dados ou quebra quando o portal mudar. Assim que a credencial e o contrato
                    técnico forem liberados, o adaptador pode usar os documentos já registrados no
                    CRM.
                  </p>
                  <a
                    href="https://rauzee.com/recursos/integracoes/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-black text-blue-600"
                  >
                    Abrir página oficial de integrações Rauzee{" "}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status === "connected" ? "configured" : status;
  const style =
    normalized === "configured" || normalized === "active"
      ? "bg-emerald-500/10 text-emerald-700"
      : normalized === "partner_required"
        ? "bg-amber-500/10 text-amber-700"
        : normalized === "removed" || normalized === "error"
          ? "bg-rose-500/10 text-rose-700"
          : "bg-blue-500/10 text-blue-700";
  const label =
    normalized === "configured"
      ? "Conectado"
      : normalized === "partner_required"
        ? "Requer parceria/API"
        : normalized === "planned"
          ? "Planejado"
          : normalized === "active"
            ? "Ativo"
            : normalized === "removed"
              ? "Removido"
              : normalized === "error"
                ? "Erro"
                : normalized === "unavailable"
                  ? "Indisponível"
                  : "Disponível";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.06em] ${style}`}
    >
      {normalized === "configured" && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
      {label}
    </span>
  );
}

function IntegrationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[var(--mi-text-soft)]">{label}</span>
      <span className="min-w-0 break-words text-right font-bold">{value}</span>
    </div>
  );
}
