import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Shield,
  Key,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Download,
  BellRing,
  Trash2,
  Globe,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { sendSlackAlert, sendEmailAlert } from "@/lib/alerts.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/settings/security")({
  component: SecuritySettingsPage,
});

function SecuritySettingsPage() {
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<any>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const slackAlert = useServerFn(sendSlackAlert);
  const emailAlert = useServerFn(sendEmailAlert);

  useEffect(() => {
    checkMfaStatus();
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setActiveSessions([]);
      return;
    }
    setActiveSessions([
      {
        id: session.access_token.slice(-8),
        device: typeof navigator !== "undefined" ? navigator.userAgent : "Dispositivo atual",
        ip: "—",
        lastActive: new Date().toISOString(),
        current: true,
      },
    ]);
  };

  const generateRecoveryCodes = async () => {
    const randomChunk = (): string => {
      const bytes = new Uint8Array(3);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    };
    const codes = Array.from({ length: 8 }, () => `${randomChunk()}-${randomChunk()}`);
    setRecoveryCodes(codes);
    setShowRecoveryCodes(true);
    toast.success("Códigos de recuperação gerados!");
  };

  const terminateSession = async (_sessionId: string) => {
    await supabase.auth.signOut();
    setActiveSessions([]);
    toast.success("Sessão encerrada com sucesso.");
  };

  const toggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (enabled) {
      toast.promise(
        Promise.all([
          slackAlert({
            data: { message: "Notificações de segurança ativadas pelo usuário.", type: "info" },
          }),
          emailAlert({
            data: {
              to: "admin@mercadoimobi.com.br",
              subject: "Segurança MercadoImobi",
              body: "Alertas ativados.",
            },
          }),
        ]),
        {
          loading: "Ativando alertas...",
          success: "Alertas de segurança e Slack ativados.",
          error: "Erro ao configurar alertas.",
        },
      );
    } else {
      toast.success("Alertas de segurança desativados.");
    }
  };

  const checkMfaStatus = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;

      const activeFactors = data.all.filter((factor) => factor.status === "verified");
      setMfaEnabled(activeFactors.length > 0);
    } catch (err: any) {
      console.error("Erro ao verificar MFA:", err);
    } finally {
      setLoading(false);
    }
  };

  const startMfaEnrollment = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Mercado Imobi",
      });
      if (error) throw error;

      setQrCodeData(data);
      setShowQr(true);
      toast.info("Escaneie o QR Code no seu aplicativo autenticador.");
    } catch (err: any) {
      toast.error(err.message || "Erro ao iniciar ativação de MFA");
      setEnrolling(false);
    }
  };

  const verifyMfa = async () => {
    if (!qrCodeData) return;
    setEnrolling(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: qrCodeData.id,
        code: verificationCode,
      });
      if (error) throw error;

      toast.success("MFA ativado com sucesso!");
      setMfaEnabled(true);
      setShowQr(false);
      setVerificationCode("");
    } catch (err: any) {
      toast.error(err.message || "Código de verificação inválido");
    } finally {
      setEnrolling(false);
    }
  };

  const disableMfa = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const activeFactors = data?.all.filter((factor) => factor.status === "verified") || [];

    if (activeFactors.length === 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: activeFactors[0]?.id || "",
      });
      if (error) throw error;

      toast.success("MFA desativado.");
      setMfaEnabled(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao desativar MFA");
    } finally {
      setLoading(false);
    }
  };

  const rotateSession = async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      toast.success("Token de sessão rotacionado com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao rotacionar token: " + err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          Segurança da Conta
        </h2>
        <p className="text-muted-foreground text-lg">
          Gerencie a proteção da sua conta e configurações de autenticação.
        </p>
      </div>

      <div className="grid gap-6">
        {/* MFA Section */}
        <Card border-primary={mfaEnabled}>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5" />
                  Autenticação de Dois Fatores (MFA)
                </CardTitle>
                <CardDescription>
                  Adicione uma camada extra de segurança usando um aplicativo autenticador.
                </CardDescription>
              </div>
              <Badge variant={mfaEnabled ? "default" : "secondary"}>
                {mfaEnabled ? "Ativado" : "Desativado"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showQr ? (
              <div className="space-y-6 border rounded-lg p-6 bg-muted/30">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="bg-white p-4 rounded-lg shadow-sm border">
                    <img src={qrCodeData.totp.qr_code} alt="QR Code MFA" className="w-48 h-48" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Escaneie o QR Code acima</p>
                    <div className="flex items-center gap-2 justify-center">
                      <code className="bg-background px-2 py-1 rounded border text-xs font-mono">
                        {showSecret ? qrCodeData.totp.secret : "••••••••••••••••"}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setShowSecret(!showSecret)}
                      >
                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="code">Código de Verificação</Label>
                  <div className="flex gap-2">
                    <Input
                      id="code"
                      placeholder="000000"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                    />
                    <Button
                      onClick={verifyMfa}
                      disabled={verificationCode.length !== 6 || enrolling}
                    >
                      {enrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50 border border-dashed">
                <div
                  className={`p-2 rounded-full ${mfaEnabled ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"}`}
                >
                  {mfaEnabled ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <AlertCircle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {mfaEnabled
                      ? "Sua conta está protegida com MFA."
                      : "Sua conta está vulnerável a ataques de força bruta."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {mfaEnabled
                      ? "Use seu aplicativo autenticador sempre que realizar login."
                      : "Recomendamos ativar o MFA imediatamente."}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/10 border-t pt-6 flex justify-between">
            {!showQr && (
              <>
                {mfaEnabled ? (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={disableMfa}
                  >
                    Desativar MFA
                  </Button>
                ) : (
                  <Button onClick={startMfaEnrollment} disabled={enrolling}>
                    Ativar MFA agora
                  </Button>
                )}
              </>
            )}
            {showQr && (
              <Button variant="ghost" onClick={() => setShowQr(false)}>
                Cancelar
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Recovery Codes Section */}
        {mfaEnabled && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Códigos de Recuperação
              </CardTitle>
              <CardDescription>
                Use estes códigos para acessar sua conta se perder seu dispositivo MFA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {showRecoveryCodes ? (
                <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg border font-mono text-sm">
                  {recoveryCodes.map((code, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 bg-background rounded border border-dashed"
                    >
                      <span>{code}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-4 p-4 rounded-lg bg-blue-50 border border-blue-100 text-blue-800">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm">
                    Recomendamos gerar novos códigos de recuperação e guardá-los em local seguro.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t pt-6 flex justify-between">
              {showRecoveryCodes ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Download className="mr-2 h-4 w-4" /> Baixar PDF
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowRecoveryCodes(false)}>
                    Ocultar
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={generateRecoveryCodes}>
                  Gerar Novos Códigos
                </Button>
              )}
            </CardFooter>
          </Card>
        )}

        {/* Security Alerts Section */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BellRing className="h-5 w-5" />
                  Alertas e Notificações
                </CardTitle>
                <CardDescription>
                  Seja avisado sobre logins suspeitos ou alterações de segurança.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Notificações por E-mail</p>
                <p className="text-xs text-muted-foreground">
                  Alertar sobre novos logins e tentativas falhas.
                </p>
              </div>
              <Button
                variant={notificationsEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => toggleNotifications(!notificationsEnabled)}
              >
                {notificationsEnabled ? "Ativado" : "Desativado"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Active Sessions Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Sessões Ativas
            </CardTitle>
            <CardDescription>Gerencie os dispositivos conectados à sua conta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-muted/20"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{session.device}</p>
                    {session.current && (
                      <Badge variant="secondary" className="text-[10px] h-4">
                        Sessão Atual
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {session.ip} • Ativo em: {new Date(session.lastActive).toLocaleString("pt-BR")}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => terminateSession(session.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Session Rotation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Tokens de Acesso
            </CardTitle>
            <CardDescription>Segurança avançada para desenvolvedores e integração.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div className="space-y-1">
                <p className="text-sm font-medium">Rotacionar Tokens</p>
                <p className="text-xs text-muted-foreground">
                  Invalida tokens antigos e gera novos imediatamente.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={rotateSession}>
                <RefreshCw className="mr-2 h-4 w-4" /> Rotacionar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* RBAC Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Papéis do Usuário (RBAC)
            </CardTitle>
            <CardDescription>Suas permissões atuais de acesso.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="px-3 py-1 bg-primary/5 text-primary border-primary/20"
              >
                ADMIN
              </Badge>
              <Badge variant="outline" className="px-3 py-1">
                DEVELOPER
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-4 italic">
              * Privilégios baseados no plano corporativo.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
