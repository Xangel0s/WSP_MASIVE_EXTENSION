import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Plus, Trash2, Eye, Shuffle, ListOrdered } from "lucide-react";
import { MessageVariation, Contact, SendingParams } from "@/types/campaign";
import { motion } from "framer-motion";

interface Step2Props {
  messages: MessageVariation[];
  setMessages: (msgs: MessageVariation[]) => void;
  contacts: Contact[];
  params: SendingParams;
  setParams: (params: SendingParams) => void;
  onNext: () => void;
  onBack: () => void;
}

const SPEECH_NOTES_STORAGE_KEY = "wsp_speech_notes";

const Step2Messages = ({ messages, setMessages, contacts, params, setParams, onNext, onBack }: Step2Props) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [speechNotes, setSpeechNotes] = useState(() => {
    try {
      return localStorage.getItem(SPEECH_NOTES_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SPEECH_NOTES_STORAGE_KEY, speechNotes);
    } catch {
      void 0;
    }
  }, [speechNotes]);

  const addVariation = () => {
    setMessages([
      ...messages,
      {
        id: crypto.randomUUID(),
        label: `Variación ${String.fromCharCode(65 + messages.length)}`,
        content: "",
      },
    ]);
  };

  const updateMessage = (id: string, content: string) => {
    setMessages(messages.map((m) => (m.id === id ? { ...m, content } : m)));
  };

  const updateLabel = (id: string, label: string) => {
    setMessages(messages.map((m) => (m.id === id ? { ...m, label } : m)));
  };

  const removeVariation = (id: string) => {
    setMessages(messages.filter((m) => m.id !== id));
  };

  const replaceVariables = (text: string) => {
    const sample = contacts[0] || { name: "Juan", business: "TechCorp", location: "CDMX" };
    return text
      .replace(/\[Nombre\]/g, sample.name || "Juan")
      .replace(/\[Negocio\]/g, sample.business || "TechCorp")
      .replace(/\[Ubicación\]/g, sample.location || "CDMX");
  };

  const hasValidMessages = messages.some((m) => m.content.trim().length > 0);
  const variationEvery = Math.max(1, params.variationEvery || 1);
  const isRandomMode = params.variationMode === "random";
  const sequencePreview = messages
    .slice(0, 3)
    .map((m) => `${m.label} x${variationEvery}`)
    .join(" · ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-7"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Personalización de Mensajes</h2>
          <p className="text-sm text-muted-foreground">
            Crea variaciones de mensajes para A/B Testing
          </p>
        </div>
        <Button onClick={addVariation} variant="outline" size="sm">
          <Plus className="w-4 h-4 mr-1" /> Agregar variación
        </Button>
      </div>

      <Card className="border-white/40 bg-muted/10">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground mr-1">Modo de variación</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={
                isRandomMode
                  ? "h-8 border-white/20 text-muted-foreground hover:text-foreground"
                  : "h-8 border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
              }
              onClick={() => setParams({ ...params, variationMode: "sequential" })}
            >
              <ListOrdered className="w-3.5 h-3.5 mr-1.5" />
              Secuencial
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={
                isRandomMode
                  ? "h-8 border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                  : "h-8 border-white/20 text-muted-foreground hover:text-foreground"
              }
              onClick={() => setParams({ ...params, variationMode: "random" })}
            >
              <Shuffle className="w-3.5 h-3.5 mr-1.5" />
              Aleatorio
            </Button>
            <Badge variant="outline" className="ml-auto border-white/30 text-muted-foreground">
              {isRandomMode
                ? `Aleatorio entre ${Math.max(messages.length, 1)} variación(es)`
                : `Secuencia: ${sequencePreview || "Variación A x1"}`}
            </Badge>
          </div>

          {!isRandomMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Cambiar variación cada</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={variationEvery}
                onChange={(e) =>
                  setParams({
                    ...params,
                    variationEvery: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="h-8 w-20 bg-muted/35 border-white/20 text-sm"
              />
              <span className="text-sm text-muted-foreground">mensaje(s)</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Se elige una variación al azar en cada envío.
            </p>
          )}
        </CardContent>
      </Card>

      {messages.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay variaciones de mensaje</p>
            <Button onClick={addVariation} variant="outline" className="mt-4">
              <Plus className="w-4 h-4 mr-1" /> Crear primera variación
            </Button>
          </CardContent>
        </Card>
      )}

      {messages.map((msg, index) => (
        <Card key={msg.id} className="border-white/80">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Input
                  value={msg.label}
                  onChange={(e) => updateLabel(msg.id, e.target.value)}
                  className="w-44 h-8 text-sm bg-muted/40 border-white/15"
                />
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setPreviewIndex(previewIndex === index ? null : index)
                  }
                >
                  <Eye className="w-4 h-4" />
                </Button>
                {messages.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => removeVariation(msg.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <Textarea
              placeholder="Hola [Nombre], soy de [Negocio]. Nos encantaría hablar contigo sobre..."
              value={msg.content}
              onChange={(e) => updateMessage(msg.id, e.target.value)}
              rows={4}
              className="resize-none bg-muted/25 border-white/10 min-h-[92px]"
            />
            {previewIndex === index && msg.content && (
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-xs text-primary font-medium mb-2">Vista previa:</p>
                <p className="text-sm">{replaceVariables(msg.content)}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="border-white/50 bg-muted/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Notas de speech</CardTitle>
              <CardDescription>Notas rápidas guardadas localmente en este navegador</CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setSpeechNotes("")}
              disabled={!speechNotes.trim()}
            >
              Limpiar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={speechNotes}
            onChange={(e) => setSpeechNotes(e.target.value)}
            placeholder="Guion, objeciones, respuestas rápidas, tono de conversación..."
            rows={4}
            className="resize-y bg-muted/25 border-white/10"
          />
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" size="lg" className="min-w-[108px]">
          ← Atrás
        </Button>
        <Button onClick={onNext} disabled={!hasValidMessages} size="lg" className="min-w-[150px]">
          Continuar →
        </Button>
      </div>
    </motion.div>
  );
};

export default Step2Messages;
