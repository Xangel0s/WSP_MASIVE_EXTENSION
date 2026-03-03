import { cn } from "@/lib/utils";
import { Database, MessageSquare, Settings, Monitor } from "lucide-react";

interface StepperProps {
  currentStep: number;
  onStepClick: (step: number) => void;
  locked?: boolean;
}

const steps = [
  { label: "Base de Datos", icon: Database },
  { label: "Mensajes", icon: MessageSquare },
  { label: "Parámetros", icon: Settings },
  { label: "Monitor", icon: Monitor },
];

const Stepper = ({ currentStep, onStepClick, locked = false }: StepperProps) => {
  return (
    <div className="flex items-center justify-center gap-0 w-full max-w-4xl mx-auto mb-10">
      {steps.map((step, index) => {
        const isCurrent = currentStep === index;
        const isDisabledByLock = locked && index !== 3;
        const Icon = step.icon;

        return (
          <div key={index} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => onStepClick(index)}
              disabled={isDisabledByLock}
              className={cn(
                "flex flex-col items-center gap-2 group transition-all rounded-md px-2 py-1 border",
                isDisabledByLock ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                isCurrent
                  ? "border-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
                  : "border-transparent"
              )}
            >
              <div
                className={cn(
                  "w-11 h-11 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                  isCurrent
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/35 bg-muted/20"
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5",
                    isCurrent ? "text-primary" : "text-muted-foreground/55"
                  )}
                />
              </div>
              <span
                className={cn(
                  "text-[15px] leading-none font-medium hidden sm:block",
                  isCurrent
                    ? "text-primary"
                    : "text-muted-foreground/55"
                )}
              >
                {step.label}
              </span>
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2 rounded-full transition-all duration-500",
                  "bg-muted/70"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default Stepper;
