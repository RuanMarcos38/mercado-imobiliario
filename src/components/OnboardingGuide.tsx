import { useState, useEffect } from "react";
import {
  Rocket,
  Settings,
  Search,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const steps = [
  {
    title: "Bem-vindo ao Futuro Imobiliário",
    description:
      "Sua plataforma está quase pronta. Vamos configurar os pontos essenciais para você começar a prospectar com IA.",
    icon: Rocket,
  },
  {
    title: "Conexão n8n & Automação",
    description:
      "Integramos com OLX, Marketplace e Google Ads. Copie seu endpoint no dashboard para começar a receber imóveis em tempo real.",
    icon: Zap,
  },
  {
    title: "Critérios de Busca IA",
    description:
      "Defina o perfil de imóvel que você busca. Nossa IA fará a varredura nacional e filtrará possíveis golpes automaticamente.",
    icon: Search,
  },
  {
    title: "Segurança & Multi-usuário",
    description:
      "Seus dados são isolados e protegidos. Você pode criar sub-contas e gerenciar permissões de forma independente.",
    icon: Settings,
  },
];

export function OnboardingGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("user_onboarding")
      .select("is_completed, current_step")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Error checking onboarding:", error);
      setLoading(false);
      return;
    }

    if (!data || !data.is_completed) {
      setIsOpen(true);
      if (data) setCurrentStep(data.current_step - 1);
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

      // Update DB progress
      await supabase.from("user_onboarding").upsert({
        user_id: user.id,
        current_step: nextStep + 1,
        is_completed: false,
      });
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("user_onboarding").upsert({
      user_id: user.id,
      is_completed: true,
      completed_at: new Date().toISOString(),
    });
    setIsOpen(false);
    toast.success("Onboarding concluído! Boas vendas.");
  };

  if (loading || !isOpen) return null;

  const currentStepData = steps[currentStep]!;
  const StepIcon = currentStepData.icon;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-2xl">
        <div className="bg-primary p-8 text-primary-foreground relative overflow-hidden">
          <Sparkles className="absolute top-4 right-4 h-12 w-12 opacity-20 animate-pulse" />
          <div className="relative z-10 flex flex-col items-center text-center space-y-4">
            <div className="p-4 bg-white/20 rounded-full backdrop-blur-sm">
              <StepIcon className="h-10 w-10 text-white" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">{currentStepData.title}</h2>
              <Progress
                value={((currentStep + 1) / steps.length) * 100}
                className="h-1 w-32 mx-auto bg-white/30"
              />
            </div>
          </div>
        </div>

        <div className="p-8 space-y-6 bg-background">
          <p className="text-muted-foreground text-center text-lg leading-relaxed">
            {currentStepData.description}
          </p>

          <div className="flex justify-between items-center pt-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={currentStep === 0}
              className="flex gap-2"
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>

            <div className="flex gap-2">
              {currentStep === steps.length - 1 ? (
                <Button onClick={handleComplete} className="bg-primary hover:bg-primary/90">
                  Começar Agora
                </Button>
              ) : (
                <Button onClick={handleNext} className="flex gap-2">
                  Próximo <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex justify-center gap-1.5">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentStep ? "w-8 bg-primary" : "w-2 bg-muted"}`}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
