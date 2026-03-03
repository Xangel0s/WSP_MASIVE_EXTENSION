import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Zap, User, Timer, Hash, RotateCcw } from "lucide-react";
import { SendingParams } from "@/types/campaign";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface Step3Props {
  params: SendingParams;
  setParams: (params: SendingParams) => void;
  onNext: () => void;
  onBack: () => void;
}

const Step3Params = ({ params, setParams, onNext, onBack }: Step3Props) => {
  const isAutomaticMode = params.mode === "automatic";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div>
        <h2 className="text-xl font-semibold">Parámetros de Envío</h2>
        <p className="text-sm text-muted-foreground">Configura el comportamiento del envío</p>
      </div>

      {/* Mode Selector */}
      <Card className="border-white/80">
        <CardHeader>
          <CardTitle className="text-lg">Modo de envío</CardTitle>
          <CardDescription>Elige la velocidad y naturalidad del envío</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setParams({ ...params, mode: "automatic" })}
              className={cn(
                "p-4 rounded-lg border text-left transition-all",
                params.mode === "automatic"
                  ? "border-primary bg-primary/8"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <Zap
                className={cn(
                  "w-6 h-6 mb-2",
                  params.mode === "automatic" ? "text-primary" : "text-muted-foreground"
                )}
              />
              <p className="font-medium text-sm">Automático</p>
              <p className="text-xs text-muted-foreground mt-1">Rápido, velocidad aleatoria</p>
            </button>
            <button
              onClick={() => setParams({ ...params, mode: "human" })}
              className={cn(
                "p-4 rounded-lg border text-left transition-all",
                params.mode === "human"
                  ? "border-primary bg-primary/8"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <User
                className={cn(
                  "w-6 h-6 mb-2",
                  params.mode === "human" ? "text-primary" : "text-muted-foreground"
                )}
              />
              <p className="font-medium text-sm">Humano</p>
              <p className="text-xs text-muted-foreground mt-1">Simulado, más natural</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Delay & Limits */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-white/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary" /> Delay entre mensajes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={5}
                max={120}
                value={params.delay}
                onChange={(e) =>
                  setParams({ ...params, delay: Number(e.target.value) })
                }
                disabled={isAutomaticMode}
                className="w-24 bg-muted/35 border-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-muted-foreground">segundos</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {isAutomaticMode
                ? "Automático usa tiempo aleatorio inteligente"
                : "Recomendado: 15-45 seg"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="w-4 h-4 text-primary" /> Límite por sesión
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={1000}
                value={params.sessionLimit}
                onChange={(e) =>
                  setParams({ ...params, sessionLimit: Number(e.target.value) })
                }
                disabled={isAutomaticMode}
                className="w-24 bg-muted/35 border-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-muted-foreground">mensajes</span>
            </div>
            {isAutomaticMode && (
              <p className="text-xs text-muted-foreground mt-2">
                Automático gestiona el ritmo de envío de forma dinámica
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Auto retry */}
      <Card className="border-white/80">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RotateCcw className="w-5 h-5 text-primary" />
              <div>
                <Label className="font-medium">Reintentos automáticos</Label>
                <p className="text-xs text-muted-foreground">
                  Reintenta enviar a números que fallaron
                </p>
              </div>
            </div>
            <Switch
              checked={params.autoRetry}
              onCheckedChange={(checked) =>
                setParams({ ...params, autoRetry: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" size="lg" className="min-w-[108px]">
          ← Atrás
        </Button>
        <Button onClick={onNext} size="lg" className="min-w-[150px]">
          Continuar →
        </Button>
      </div>
    </motion.div>
  );
};

export default Step3Params;
