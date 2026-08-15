import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Home,
  Search,
  TrendingUp,
  Users,
  MapPin,
  ShieldCheck,
  Zap,
  ArrowRight,
  Building2,
  CheckCircle2,
  Shield,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "Mercado Imobiliário | Ponte Inteligente entre Clientes, Corretores e Construtoras",
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content:
          "Busca nacional de imóveis, score anti-fraude, leads qualificados por IA e dashboard de KPIs em tempo real.",
      },
      {
        property: "og:title",
        content:
          "Mercado Imobiliário | Ponte Inteligente entre Clientes, Corretores e Construtoras",
      },
      {
        property: "og:description",
        content:
          "Busca nacional de imóveis, score anti-fraude, leads qualificados por IA e dashboard de KPIs em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Index() {
  return (
    <div className="flex flex-col min-h-screen bg-background relative">
      {/* Implementar login multi-tenant */}

      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-2 font-bold text-2xl tracking-tighter text-primary">
            <Building2 className="h-6 w-6" />
            <span>
              MERCADO<span className="text-muted-foreground font-light">IMOBI</span>
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <Link to="/" className="transition-colors hover:text-primary">
              Início
            </Link>
            <a href="#funcionalidades" className="transition-colors hover:text-primary">
              Funcionalidades
            </a>
            <a href="#dashboard" className="transition-colors hover:text-primary">
              Dashboard
            </a>
            <a href="#contato" className="transition-colors hover:text-primary">
              Contato
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/auth" className="text-sm font-medium transition-colors hover:text-primary">
              Entrar
            </Link>
            <Link
              to="/auth"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              7 Dias Grátis
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 md:py-32">
        <div className="container relative z-10 px-4 sm:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary text-primary-foreground mb-6">
              Lançamento Nacional
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl mb-6">
              A Ponte Inteligente do <span className="text-primary">Mercado Imobiliário</span>
            </h1>
            <p className="mx-auto max-w-[700px] text-lg text-muted-foreground mb-10">
              Conectamos clientes, corretores e construtoras em todo o Brasil. Busca nacional,
              qualificação anti-fraude por IA e leads gratuitos em um único painel.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/auth"
                className="inline-flex h-12 w-full sm:w-auto items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 group"
              >
                Começar agora
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="#dashboard"
                className="inline-flex h-12 w-full sm:w-auto items-center justify-center rounded-md border border-input bg-background px-8 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Ver Demonstração
              </a>
            </div>
          </div>
        </div>
        {/* Background Decorative */}
        <div className="absolute top-0 -left-1/4 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 -right-1/4 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[120px]" />
      </section>

      {/* Stats Section */}
      <section className="border-y bg-muted/30 py-12">
        <div className="container px-4 sm:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="flex flex-col items-center text-center">
              <div className="text-3xl font-bold tracking-tighter">500k+</div>
              <div className="text-sm text-muted-foreground uppercase tracking-widest font-semibold mt-1">
                Imóveis no Brasil
              </div>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="text-3xl font-bold tracking-tighter">100%</div>
              <div className="text-sm text-muted-foreground uppercase tracking-widest font-semibold mt-1">
                Qualificados por IA
              </div>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="text-3xl font-bold tracking-tighter">24/7</div>
              <div className="text-sm text-muted-foreground uppercase tracking-widest font-semibold mt-1">
                Varredura Google/OLX
              </div>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="text-3xl font-bold tracking-tighter">7 Dias</div>
              <div className="text-sm text-muted-foreground uppercase tracking-widest font-semibold mt-1">
                Teste Gratuito
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="funcionalidades" className="py-24">
        <div className="container px-4 sm:px-8">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-foreground">
              Inovação para o seu dia a dia
            </h2>
            <p className="text-muted-foreground">
              Tecnologia de ponta para quem quer vender mais e melhor.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: "Busca Nacional Sem Exceção",
                description:
                  "Varredura completa em portais, redes sociais e Google. Todo o Brasil em uma única tela.",
                icon: Search,
              },
              {
                title: "IA Anti-Fraude",
                description:
                  "Algoritmo exclusivo que qualifica anúncios e identifica golpes antes mesmo de você ver.",
                icon: ShieldCheck,
              },
              {
                title: "Leads Gratuitos por IA",
                description:
                  "Agente inteligente que prospecta clientes no perfil ideal do seu imóvel automaticamente.",
                icon: Zap,
              },
              {
                title: "Integração N8N & Portais",
                description:
                  "Conectado diretamente ao n8n, OLX e Marketplace para fluxo de dados em tempo real.",
                icon: TrendingUp,
              },
              {
                title: "Isolamento Total de Dados",
                description:
                  "Sistema Multi-tenant onde sua informação é sua. Ninguém mais tem acesso aos seus dados.",
                icon: Users,
              },
              {
                title: "Cobertura de Construtoras",
                description:
                  "Base integrada com todas as construtoras do Brasil, atualizada constantemente.",
                icon: MapPin,
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="relative overflow-hidden rounded-lg border bg-background p-8 transition-all hover:shadow-lg group"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 font-bold text-xl">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard Preview Section */}
      <section id="dashboard" className="py-24 bg-muted/50">
        <div className="container px-4 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6 text-foreground">
                Painel Visual de KPIs <br />
                <span className="text-primary">Dados reais, decisões rápidas.</span>
              </h2>
              <ul className="space-y-4 mb-8">
                {[
                  "Monitoramento de resultados em tempo real",
                  "Métricas de conversão por canal (Google, OLX, Marketplace)",
                  "Indicadores de performance (KPIs) estratégicos",
                  "Interface intuitiva voltada para conversão",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm font-medium">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Explorar Painel
              </Link>
            </div>
            <div className="relative rounded-2xl border bg-background p-4 shadow-2xl overflow-hidden group">
              {/* Mock Dashboard Illustration */}
              <div className="aspect-[4/3] w-full rounded-xl bg-muted/20 p-6 flex flex-col gap-4 overflow-hidden">
                <div className="flex justify-between items-center">
                  <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="h-24 rounded-lg bg-primary/10 animate-pulse" />
                  <div className="h-24 rounded-lg bg-primary/10 animate-pulse" />
                  <div className="h-24 rounded-lg bg-primary/10 animate-pulse" />
                </div>
                <div className="flex-1 rounded-lg bg-muted/40 animate-pulse" />
                <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 border-t">
        <div className="container px-4 sm:px-8">
          <div className="rounded-3xl bg-primary px-8 py-16 text-center text-primary-foreground shadow-xl md:px-16 overflow-hidden relative">
            <div className="relative z-10">
              <h2 className="text-3xl font-bold tracking-tight sm:text-5xl mb-6">
                Pronto para inovar no mercado?
              </h2>
              <p className="mx-auto max-w-[600px] text-primary-foreground/80 mb-10 text-lg">
                Junte-se a milhares de corretores e imobiliárias que já estão usando a IA para
                vender mais imóveis.
              </p>
              <Link
                to="/auth"
                className="inline-flex h-14 items-center justify-center rounded-md bg-background px-10 text-base font-bold text-foreground shadow-lg transition-all hover:scale-105 active:scale-95"
              >
                Começar 7 Dias Grátis
              </Link>
            </div>
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contato" className="bg-background border-t py-12 md:py-24">
        <div className="container px-4 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 font-bold text-2xl tracking-tighter text-primary mb-6">
                <Building2 className="h-6 w-6" />
                <span>
                  MERCADO<span className="text-muted-foreground font-light">IMOBI</span>
                </span>
              </div>
              <p className="text-muted-foreground max-w-sm mb-6">
                Plataforma de alta performance para o mercado imobiliário brasileiro. Tecnologia,
                inteligência e conexão.
              </p>
              <div className="text-sm font-medium">
                GitHub: <span className="text-primary">RuanMarcos38</span>
              </div>
            </div>
            <div>
              <h4 className="font-bold mb-6 text-foreground uppercase tracking-widest text-xs">
                Produto
              </h4>
              <ul className="space-y-4 text-sm text-muted-foreground">
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    Funcionalidades
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    Preços
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    Trial 7 Dias
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    IA Agente
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-6 text-foreground uppercase tracking-widest text-xs">
                Suporte
              </h4>
              <ul className="space-y-4 text-sm text-muted-foreground">
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    Central de Ajuda
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    API Docs
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    Privacidade
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-primary transition-colors">
                    Termos de Uso
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-16 pt-8 border-t text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Mercado Imobi. Todos os direitos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
