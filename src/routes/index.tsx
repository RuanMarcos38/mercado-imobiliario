import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Heart,
  Home,
  MapPin,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "MercadoImobi | Encontre imóveis com mais agilidade",
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content:
          "Pesquise imóveis, compare opções e acesse o anúncio original em uma experiência rápida e organizada.",
      },
      {
        property: "og:title",
        content: "MercadoImobi | Pesquisa imobiliária simples e inteligente",
      },
      {
        property: "og:description",
        content:
          "Encontre imóveis, compare características e siga direto para a fonte original do anúncio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-[#06101c] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#06101c]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="text-lg">
              Mercado<span className="text-cyan-300">Imobi</span>
            </span>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#como-funciona" className="transition hover:text-white">
              Como funciona
            </a>
            <a href="#recursos" className="transition hover:text-white">
              Recursos
            </a>
            <a href="#para-quem" className="transition hover:text-white">
              Para quem é
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              Entrar
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-[#06101c] transition hover:bg-cyan-200"
            >
              Buscar imóveis
            </Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 opacity-90 [background-image:linear-gradient(rgba(54,225,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(54,225,255,.045)_1px,transparent_1px)] [background-size:52px_52px]" />
          <div className="absolute left-[8%] top-[-180px] h-[520px] w-[520px] rounded-full bg-cyan-400/12 blur-[130px]" />
          <div className="absolute right-[-8%] top-[80px] h-[520px] w-[520px] rounded-full bg-blue-600/10 blur-[150px]" />

          <div className="relative mx-auto grid max-w-[1440px] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:py-28">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.055] px-3 py-1.5 text-xs font-semibold text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" /> Sua pesquisa imobiliária em um só lugar
              </div>
              <h1 className="max-w-3xl text-4xl font-black tracking-tight sm:text-6xl lg:text-7xl">
                Encontre o imóvel certo,
                <span className="block bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-400 bg-clip-text text-transparent">
                  sem perder tempo.
                </span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                Pesquise opções reais, filtre o que importa, compare imóveis e siga direto para o
                anúncio original quando encontrar a melhor oportunidade.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/auth"
                  className="inline-flex h-13 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-6 text-sm font-bold text-[#06101c] shadow-xl shadow-cyan-950/30 transition hover:bg-cyan-200"
                >
                  <Search className="h-4 w-4" /> Começar uma pesquisa
                </Link>
                <a
                  href="#como-funciona"
                  className="inline-flex h-13 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.035] px-6 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.07]"
                >
                  Ver como funciona <ArrowRight className="h-4 w-4" />
                </a>
              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-cyan-300" /> Sem anúncios inventados
                </span>
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-cyan-300" /> Comparação lado a lado
                </span>
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-cyan-300" /> Acesso à fonte original
                </span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -inset-8 rounded-[44px] bg-cyan-300/[0.05] blur-2xl" />
              <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-7">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                      Pesquisa rápida
                    </p>
                    <h2 className="mt-1 text-xl font-bold">O que você procura?</h2>
                  </div>
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-200">
                    <Home className="h-5 w-5" />
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3.5">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                      Localização
                    </span>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-300">
                      <MapPin className="h-4 w-4 text-cyan-300" /> Cidade ou região
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3.5">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                        Tipo
                      </span>
                      <span className="mt-1 block text-sm text-slate-300">
                        Casa, apartamento...
                      </span>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3.5">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                        Faixa de preço
                      </span>
                      <span className="mt-1 block text-sm text-slate-300">
                        Defina seu orçamento
                      </span>
                    </div>
                  </div>
                  <Link
                    to="/auth"
                    className="mt-2 inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 text-sm font-black text-[#06101c] transition hover:bg-cyan-200"
                  >
                    <Search className="h-4 w-4" /> Buscar imóveis
                  </Link>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
                  <MiniBenefit icon={<Search className="h-4 w-4" />} label="Filtre" />
                  <MiniBenefit icon={<Scale className="h-4 w-4" />} label="Compare" />
                  <MiniBenefit icon={<Heart className="h-4 w-4" />} label="Favorite" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="como-funciona"
          className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24"
        >
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
              Simples por design
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              Da pesquisa ao anúncio em poucos passos
            </h2>
            <p className="mt-4 text-slate-400">
              A ferramenta organiza a busca para você focar apenas nas opções que realmente fazem
              sentido.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <StepCard
              number="01"
              icon={<Search className="h-5 w-5" />}
              title="Pesquise"
              text="Escolha cidade, tipo, preço e características do imóvel que você procura."
            />
            <StepCard
              number="02"
              icon={<Scale className="h-5 w-5" />}
              title="Compare"
              text="Analise preço, localização, área e outros detalhes lado a lado."
            />
            <StepCard
              number="03"
              icon={<ArrowRight className="h-5 w-5" />}
              title="Acesse a fonte"
              text="Ao encontrar a melhor opção, siga para o anúncio original e continue o contato."
            />
          </div>
        </section>

        <section id="recursos" className="border-y border-white/10 bg-white/[0.018]">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-24">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                Pesquisa com clareza
              </p>
              <h2 className="mt-3 max-w-xl text-3xl font-black tracking-tight sm:text-4xl">
                Menos ruído. Mais imóveis relevantes.
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-slate-400">
                O MercadoImobi foi desenhado para facilitar a pesquisa de quem compra e de quem
                trabalha todos os dias encontrando imóveis para clientes.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FeatureCard
                icon={<ShieldCheck className="h-5 w-5" />}
                title="Informação transparente"
                text="A plataforma não cria imóveis ou valores apenas para preencher resultados."
              />
              <FeatureCard
                icon={<Scale className="h-5 w-5" />}
                title="Comparador"
                text="Selecione até três imóveis e veja os principais pontos lado a lado."
              />
              <FeatureCard
                icon={<Heart className="h-5 w-5" />}
                title="Favoritos"
                text="Guarde rapidamente as opções que merecem uma segunda análise."
              />
              <FeatureCard
                icon={<Search className="h-5 w-5" />}
                title="Pesquisas salvas"
                text="Repita combinações de filtros sem precisar preencher tudo novamente."
              />
            </div>
          </div>
        </section>

        <section
          id="para-quem"
          className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24"
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <AudienceCard
              label="Para clientes"
              title="Escolha com mais segurança e menos confusão."
              text="Pesquise, filtre, compare e organize suas opções antes de falar com o anunciante."
            />
            <AudienceCard
              label="Para corretores"
              title="Encontre opções com mais agilidade para cada perfil."
              text="Salve pesquisas, compare imóveis e mantenha as melhores alternativas à mão durante o atendimento."
            />
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-24">
          <div className="mx-auto max-w-[1440px] overflow-hidden rounded-[34px] border border-cyan-300/15 bg-gradient-to-br from-cyan-300/12 via-sky-500/8 to-transparent px-6 py-12 text-center shadow-2xl shadow-cyan-950/20 sm:px-10 lg:py-16">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
              Comece sua pesquisa
            </p>
            <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
              O próximo imóvel pode estar a uma pesquisa de distância.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-slate-300">
              Entre, defina seus filtros e compare as opções disponíveis para o seu perfil.
            </p>
            <Link
              to="/auth"
              className="mt-8 inline-flex h-13 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-7 text-sm font-black text-[#06101c] transition hover:bg-cyan-200"
            >
              Pesquisar imóveis <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-6 px-4 py-10 text-sm text-slate-500 sm:px-6 md:flex-row md:items-center lg:px-8">
          <div className="flex items-center gap-2 font-semibold text-slate-300">
            <Building2 className="h-4 w-4 text-cyan-300" /> MercadoImobi
          </div>
          <p>Pesquisa imobiliária organizada para clientes e corretores.</p>
        </div>
      </footer>
    </div>
  );
}

function MiniBenefit({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.035] px-3 py-2.5 text-xs font-semibold text-slate-300">
      <span className="text-cyan-300">{icon}</span>
      {label}
    </div>
  );
}

function StepCard({
  number,
  icon,
  title,
  text,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-white/[0.028] p-6 transition hover:border-cyan-300/20 hover:bg-white/[0.04]">
      <div className="flex items-center justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-200">
          {icon}
        </span>
        <span className="text-sm font-black text-white/15">{number}</span>
      </div>
      <h3 className="mt-6 text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200">
        {icon}
      </span>
      <h3 className="mt-4 font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function AudienceCard({ label, title, text }: { label: string; title: string; text: string }) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-gradient-to-br from-white/[0.055] to-white/[0.015] p-7 sm:p-9">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">{label}</p>
      <h3 className="mt-3 max-w-xl text-2xl font-black tracking-tight sm:text-3xl">{title}</h3>
      <p className="mt-4 max-w-xl leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}
