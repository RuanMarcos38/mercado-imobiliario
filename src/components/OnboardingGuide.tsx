import { useEffect, useState } from "react";
import {
  Rocket,
  Search,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Heart,
  ExternalLink,
} from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const steps = [
  {
    title: "Bem-vindo ao MercadoImobi",
    description:
      "Pesquise imóveis reais em uma experiência simples, compare opções e acesse a fonte original de cada anúncio.",
    icon: Rocket,
  },
  {
    title: "Defina sua pesquisa",
    description:
      "Use localização, tipo de imóvel, preço, quartos, banheiros, área e fonte para encontrar opções compatíveis com o que você procura.",
    icon: Search,
  },
  {
    title: "Salve o que interessa",
    description:
      "Favorite imóveis e salve combinações de filtros para retomar suas pesquisas com rapidez quando quiser.",
    icon: Heart,
  },
  {
    title: "Consulte a origem",
    description:
      "Analise os detalhes disponíveis e abra o anúncio original para conferir as informações diretamente na fonte.",
    icon: ExternalLink,
  },
];

export function OnboardingGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("user_onboarding")
      .select("is_completed, current_step")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      setLoading(false);
      return;
    }

    if (!data || !data.is_completed) {
      setIsOpen(true);
      if (data) setCurrentStep(Math.max(0, Math.min(steps.length - 1, data.current_step - 1)));
    }
    setLoading(false);
  };

  const handleNext = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    if (currentStep < steps.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      await supabase.from("user_onboarding").upsert({
        user_id: user.id,
        current_step: nextStep + 1,
        is_completed: false,
      });
      return;
    }

    await handleComplete();
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep((step) => step - 1);
  };

  const handleComplete = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("user_onboarding").upsert({
      user_id: user.id,
      is_completed: true,
      current_step: steps.length,
      completed_at: new Date().toISOString(),
    });
    setIsOpen(false);
    toast.success("Tudo pronto. Boa pesquisa!");
  };

  if (loading || !isOpen) return null;

  const currentStepData = steps[currentStep]!;
  const StepIcon = currentStepData.icon;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="overflow-hidden border-none p-0 shadow-2xl sm:max-w-[500px]">
        <div className="relative overflow-hidden bg-primary p-8 text-primary-foreground">
          <Sparkles className="absolute right-4 top-4 h-12 w-12 animate-pulse opacity-20" />
          <div className="relative z-10 flex flex-col items-center space-y-4 text-center">
            <div className="rounded-full bg-white/20 p-4 backdrop-blur-sm">
              <StepIcon className="h-10 w-10 text-white" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">{currentStepData.title}</h2>
              <Progress
                value={((currentStep + 1) / steps.length) * 100}
                className="mx-auto h-1 w-32 bg-white/30"
              />
            </div>
          </div>
        </div>

        <div className="space-y-6 bg-background p-8">
          <p className="text-center text-lg leading-relaxed text-muted-foreground">
            {currentStepData.description}
          </p>

          <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={currentStep === 0}
              className="flex gap-2"
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>

            {currentStep === steps.length - 1 ? (
              <Button onClick={() => void handleComplete()}>Começar a pesquisar</Button>
            ) : (
              <Button onClick={() => void handleNext()} className="flex gap-2">
                Próximo <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </DialogFooter>

          <div className="flex justify-center gap-1.5">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className={`h-1.5 rounded-full transition-all duration-300 ${index === currentStep ? "w-8 bg-primary" : "w-2 bg-muted"}`}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
