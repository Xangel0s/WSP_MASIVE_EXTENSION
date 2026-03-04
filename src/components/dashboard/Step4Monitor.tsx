import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Square, Send, Clock, XCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { Contact, MessageVariation, SendingParams, ActivityEntry, CampaignState } from "@/types/campaign";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { hasExtensionRuntime, sendRuntimeMessage, subscribeRuntimeMessages } from "@/lib/extension-runtime";

interface Step4Props {
  contacts: Contact[];
  messages: MessageVariation[];
  params: SendingParams;
  onBack: () => void;
  onStatusChange?: (status: CampaignState["status"]) => void;
}

type EngineStatus = CampaignState["status"] | "stopped" | "error";

interface EngineTotals {
  total: number;
  processed: number;
  pending: number;
  sent: number;
  failed: number;
}

interface EngineLogPayload {
  id?: string;
  contactIndex?: number;
  phone?: string;
  message?: string;
  status?: string;
  attempts?: number;
  error?: string;
  timestamp?: string;
}

interface EngineStatePayload {
  status?: unknown;
  totals?: Partial<EngineTotals>;
  progress?: unknown;
  nextSendInSec?: unknown;
  error?: unknown;
  logs?: EngineLogPayload[];
}

interface EngineResponse {
  ok: boolean;
  error?: string;
  state?: EngineStatePayload;
  isReady?: boolean;
}

interface RuntimeStateUpdateMessage {
  type?: string;
  state?: EngineStatePayload;
}

const KNOWN_STATUSES: EngineStatus[] = ["idle", "running", "paused", "completed", "stopped", "error"];

const normalizeStatus = (raw: unknown): EngineStatus => {
  const value = String(raw || "idle") as EngineStatus;
  return KNOWN_STATUSES.includes(value) ? value : "idle";
};

const toActivityEntries = (logs: EngineLogPayload[]): ActivityEntry[] =>
  logs
    .slice(0, 200)
    .map((log) => ({
      id: String(log?.id || crypto.randomUUID()),
      phone: String(log?.phone || ""),
      message: String(log?.message || "").slice(0, 90),
      status: log?.status === "failed" ? "failed" : "sent",
      timestamp: new Date(log?.timestamp || Date.now()),
    }));

const Step4Monitor = ({ contacts, messages, params, onBack, onStatusChange }: Step4Props) => {
  const isExtension = useMemo(() => hasExtensionRuntime(), []);
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [rawLogs, setRawLogs] = useState<EngineLogPayload[]>([]);
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<EngineTotals>({
    total: contacts.length,
    processed: 0,
    pending: contacts.length,
    sent: 0,
    failed: 0,
  });
  const [actionBusy, setActionBusy] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [nextSendInSec, setNextSendInSec] = useState<number | null>(null);
  const [isWhatsAppReady, setIsWhatsAppReady] = useState(true);

  const sent = totals.sent;
  const failed = totals.failed;
  const pending = status === "idle" && totals.total === 0 ? contacts.length : totals.pending;
  const variationLabel =
    params.variationMode === "random"
      ? "Aleatorio"
      : `Secuencial (cada ${Math.max(1, params.variationEvery)} msg)`;
  const isCampaignBusy = status === "running" || status === "paused";

  const applyEngineState = useCallback(
    (rawState?: EngineStatePayload) => {
      if (!rawState || typeof rawState !== "object") return;

      const nextStatus = normalizeStatus(rawState.status);
      const rawTotals = rawState.totals || {};
      const total = Math.max(0, Number(rawTotals.total) || 0);
      const processed = Math.max(0, Number(rawTotals.processed) || 0);
      const nextTotals: EngineTotals = {
        total,
        processed,
        pending: Math.max(0, Number(rawTotals.pending) || 0),
        sent: Math.max(0, Number(rawTotals.sent) || 0),
        failed: Math.max(0, Number(rawTotals.failed) || 0),
      };

      setStatus(nextStatus);
      setTotals(nextTotals);
      setProgress(Math.max(0, Math.min(100, Number(rawState.progress) || 0)));
      setNextSendInSec(
        Number.isFinite(Number(rawState.nextSendInSec))
          ? Math.max(0, Math.floor(Number(rawState.nextSendInSec)))
          : null
      );
      setEngineError(rawState.error ? String(rawState.error) : null);
      const parsedLogs = Array.isArray(rawState.logs) ? rawState.logs : [];
      setRawLogs(parsedLogs);
      setActivity(toActivityEntries(parsedLogs));
    },
    []
  );

  const callEngine = useCallback(async (payload: unknown) => {
    const response = await sendRuntimeMessage<EngineResponse>(payload);
    if (!response?.ok) {
      throw new Error(response?.error || "No se pudo comunicar con el background");
    }
    return response;
  }, []);

  const refreshState = useCallback(async () => {
    if (!isExtension) return;
    const result = await callEngine({ type: "GET_STATE" });
    applyEngineState(result.state);
  }, [isExtension, callEngine, applyEngineState]);

  const checkWhatsAppReady = useCallback(async () => {
    if (!isExtension) return;
    const result = await callEngine({ type: "CHECK_WHATSAPP_TAB" });
    setIsWhatsAppReady(Boolean(result.isReady));
  }, [isExtension, callEngine]);

  useEffect(() => {
    const normalizedForLock: CampaignState["status"] =
      status === "running" || status === "paused" ? status : "idle";
    onStatusChange?.(normalizedForLock);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (!isExtension) {
      return;
    }

    refreshState().catch(() => {
      // Si falla la lectura inicial, la UI sigue operativa.
    });

    checkWhatsAppReady().catch(() => {
      // Silenciar en validación inicial.
    });

    const interval = setInterval(() => {
      refreshState().catch(() => {
        // Silenciar en polling.
      });
    }, 1200);

    const unsubscribe = subscribeRuntimeMessages((message: unknown) => {
      const payload = message as RuntimeStateUpdateMessage;
      if (payload?.type === "STATE_UPDATED" && payload.state) {
        applyEngineState(payload.state);
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [isExtension, refreshState, applyEngineState]);

  const buildCampaignConfig = useCallback(() => {
    const normalizedContacts = contacts
      .map((c) => ({
        phone: (c.phone || "").replace(/[^\d]/g, ""),
        name: c.name || "",
        business: c.business || "",
        location: c.location || "",
      }))
      .filter((c) => c.phone.length >= 8);

    const validMessages = messages
      .map((m) => ({
        label: m.label,
        content: m.content.trim(),
        media: null,
      }))
      .filter((m) => m.content.length > 0);

    return {
      normalizedContacts,
      validMessages,
      config: {
        schemaVersion: 1,
        source: "wsp-dashboard",
        contacts: normalizedContacts,
        messages: validMessages,
        params: {
          mode: params.mode,
          delay: params.delay,
          sessionLimit: params.sessionLimit,
          autoRetry: params.autoRetry,
          variationEvery: params.variationEvery,
          variationMode: params.variationMode,
        },
        exportedAt: new Date().toISOString(),
      },
    };
  }, [contacts, messages, params]);

  const runAction = async (action: () => Promise<void>) => {
    try {
      setActionBusy(true);
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      toast({
        title: "No se pudo ejecutar la acción",
        description: message,
        variant: "destructive",
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleStart = () =>
    runAction(async () => {
      if (!isExtension) {
        throw new Error("El envío real solo funciona dentro de la extensión cargada en Chrome");
      }

      const readiness = await callEngine({ type: "CHECK_WHATSAPP_TAB" });
      const ready = Boolean(readiness.isReady);
      setIsWhatsAppReady(ready);
      if (!ready) {
        throw new Error("Debes abrir WhatsApp Web (web.whatsapp.com) para iniciar la campaña");
      }

      const { normalizedContacts, validMessages, config } = buildCampaignConfig();

      if (normalizedContacts.length === 0) {
        throw new Error("No hay contactos válidos");
      }

      if (validMessages.length === 0) {
        throw new Error("No hay mensajes válidos");
      }

      const result = await callEngine({ type: "START_CAMPAIGN", config });
      if (result.state) {
        applyEngineState(result.state);
      } else {
        await refreshState();
      }
    });

  const handlePause = () =>
    runAction(async () => {
      const result = await callEngine({ type: "PAUSE_CAMPAIGN" });
      if (result.state) {
        applyEngineState(result.state);
      }
    });

  const handleResume = () =>
    runAction(async () => {
      const result = await callEngine({ type: "RESUME_CAMPAIGN" });
      if (result.state) {
        applyEngineState(result.state);
      }
    });

  const handleStop = () =>
    runAction(async () => {
      const result = await callEngine({ type: "STOP_CAMPAIGN" });
      if (result.state) {
        applyEngineState(result.state);
      } else {
        await refreshState();
      }
    });

  const exportResultsCsv = () => {
    const normalizedContacts = contacts
      .map((c) => ({
        phone: (c.phone || "").replace(/[^\d]/g, ""),
        name: c.name || "",
        business: c.business || "",
        location: c.location || "",
      }))
      .filter((c) => c.phone.length >= 8);

    if (normalizedContacts.length === 0) {
      toast({
        title: "No hay contactos válidos",
        description: "Asegúrate de usar números con código de país",
      });
      return;
    }

    const sessionLimit = Math.max(1, Number(params.sessionLimit) || normalizedContacts.length);
    const selectedContacts = normalizedContacts.slice(0, sessionLimit);

    const logsByContactIndex = new Map<number, EngineLogPayload>();
    rawLogs.forEach((entry) => {
      const idx = Number(entry.contactIndex);
      if (Number.isInteger(idx) && !logsByContactIndex.has(idx)) {
        logsByContactIndex.set(idx, entry);
      }
    });

    const csvEscape = (value: unknown) => {
      const text = String(value ?? "");
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const header = [
      "index",
      "phone",
      "name",
      "business",
      "location",
      "status",
      "attempts",
      "sent_at",
      "error",
      "message",
    ];

    const rows = selectedContacts.map((contact, index) => {
      const contactIndex = index + 1;
      const log = logsByContactIndex.get(contactIndex);
      return {
        index: contactIndex,
        phone: contact.phone,
        name: contact.name,
        business: contact.business,
        location: contact.location,
        status: log?.status || "pending",
        attempts: Number(log?.attempts ?? 0),
        sentAt: log?.timestamp || "",
        error: log?.error || "",
        message: log?.message || "",
      };
    });

    const csvContent = [header.join(",")]
      .concat(
        rows.map((row) =>
          [
            row.index,
            row.phone,
            row.name,
            row.business,
            row.location,
            row.status,
            row.attempts,
            row.sentAt,
            row.error,
            row.message,
          ]
            .map(csvEscape)
            .join(",")
        )
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wsp-resultados-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: "CSV exportado", description: "Resultados de envío descargados" });
  };

  const totalForSendingLabel = totals.total || Math.min(params.sessionLimit, contacts.length);
  const sendingIndex = Math.min(totals.processed + 1, Math.max(totalForSendingLabel, 1));
  const controlsDisabled = actionBusy;
  const relevantActivity = useMemo(() => {
    const failedEntries = activity.filter((entry) => entry.status === "failed").slice(0, 20);
    const recentEntries = activity.filter((entry) => entry.status === "sent").slice(0, 20);

    return [...failedEntries, ...recentEntries]
      .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 30);
  }, [activity]);

  const attemptsSummary = useMemo(() => {
    const attemptsLogs = rawLogs.filter((entry) => entry.status === "sent" || entry.status === "failed");
    const totalAttemptedContacts = attemptsLogs.length;
    const totalAttempts = attemptsLogs.reduce((acc, entry) => {
      const attempts = Math.max(1, Number(entry.attempts) || 1);
      return acc + attempts;
    }, 0);

    const retriedContacts = attemptsLogs.filter((entry) => Math.max(1, Number(entry.attempts) || 1) > 1).length;
    const firstTrySuccess = attemptsLogs.filter(
      (entry) => entry.status === "sent" && Math.max(1, Number(entry.attempts) || 1) === 1
    ).length;
    const failedAfterRetries = attemptsLogs.filter(
      (entry) => entry.status === "failed" && Math.max(1, Number(entry.attempts) || 1) > 1
    ).length;

    return {
      totalAttemptedContacts,
      totalAttempts,
      retriedContacts,
      firstTrySuccess,
      failedAfterRetries,
      averageAttempts: totalAttemptedContacts > 0 ? (totalAttempts / totalAttemptedContacts).toFixed(2) : "0.00",
    };
  }, [rawLogs]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-white/80">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Send className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{sent}</p>
              <p className="text-xs text-muted-foreground">Enviados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-white/80">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent">
              <Clock className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pending}</p>
              <p className="text-xs text-muted-foreground">Pendientes</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-white/80">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{failed}</p>
              <p className="text-xs text-muted-foreground">Fallidos</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/80">
        <CardContent className="py-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progreso de envío</span>
            <span className="font-medium text-primary">{Math.round(progress)}%</span>
          </div>
          <p className="text-xs text-muted-foreground">Modo de variación: {variationLabel}</p>
          <Progress value={progress} className="h-3" />
          {status === "running" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-ping" />
              <p className="animate-pulse">
                Enviando mensaje {sendingIndex} de {totalForSendingLabel || contacts.length}...
              </p>
            </div>
          )}
          {status === "running" && typeof nextSendInSec === "number" && nextSendInSec > 0 && (
            <p className="text-xs text-muted-foreground">
              Siguiente envío en <span className="text-primary font-medium">{nextSendInSec}s</span>
            </p>
          )}
          {status === "completed" && (
            <p className="text-xs text-primary font-medium">
              ✅ Campaña completada — {sent} enviados, {failed} fallidos
            </p>
          )}
          {engineError && (
            <p className="text-xs text-destructive font-medium">⚠️ {engineError}</p>
          )}
          {!isWhatsAppReady && (
            <p className="text-xs text-amber-400 font-medium">
              Abre WhatsApp Web (web.whatsapp.com) para usar los envíos desde esta interfaz.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/80">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Intentos de envío</CardTitle>
            {status === "running" ? (
              <div className="flex items-center gap-2 text-xs text-primary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="animate-pulse">Procesando intentos...</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Estado: {status}</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-white/15 p-3 bg-muted/10">
              <p className="text-muted-foreground text-xs">Intentos totales</p>
              <p className="text-xl font-semibold">{attemptsSummary.totalAttempts}</p>
            </div>
            <div className="rounded-md border border-white/15 p-3 bg-muted/10">
              <p className="text-muted-foreground text-xs">Contactos intentados</p>
              <p className="text-xl font-semibold">{attemptsSummary.totalAttemptedContacts}</p>
            </div>
            <div className="rounded-md border border-white/15 p-3 bg-muted/10">
              <p className="text-muted-foreground text-xs">Promedio por contacto</p>
              <p className="text-xl font-semibold">{attemptsSummary.averageAttempts}</p>
            </div>
            <div className="rounded-md border border-white/15 p-3 bg-muted/10">
              <p className="text-muted-foreground text-xs">Éxito al primer intento</p>
              <p className="text-xl font-semibold text-primary">{attemptsSummary.firstTrySuccess}</p>
            </div>
            <div className="rounded-md border border-white/15 p-3 bg-muted/10">
              <p className="text-muted-foreground text-xs">Con reintento</p>
              <p className="text-xl font-semibold">{attemptsSummary.retriedContacts}</p>
            </div>
            <div className="rounded-md border border-white/15 p-3 bg-muted/10">
              <p className="text-muted-foreground text-xs">Fallidos tras reintentos</p>
              <p className="text-xl font-semibold text-destructive">{attemptsSummary.failedAfterRetries}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {status !== "running" ? (
          <Button onClick={handleStart} disabled={controlsDisabled} size="lg" className="gap-2 min-w-[178px]">
            <Play className="w-4 h-4" />
            {status === "completed" ? "Reiniciar" : "Iniciar Campaña"}
          </Button>
        ) : (
          <Button onClick={handlePause} disabled={controlsDisabled} variant="secondary" size="lg" className="gap-2">
            <Pause className="w-4 h-4" /> Pausar
          </Button>
        )}
        {status === "paused" && (
          <Button onClick={handleResume} disabled={controlsDisabled} size="lg" className="gap-2">
            <Play className="w-4 h-4" /> Reanudar
          </Button>
        )}
        {(status === "running" || status === "paused") && (
          <Button onClick={handleStop} disabled={controlsDisabled} variant="destructive" size="lg" className="gap-2">
            <Square className="w-4 h-4" /> Detener
          </Button>
        )}
        <Button onClick={exportResultsCsv} variant="outline" size="lg" className="gap-2 ml-auto min-w-[176px]">
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      {activity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Feed de Actividad (relevante)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Mensaje</TableHead>
                    <TableHead className="text-right">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relevantActivity.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm">{entry.phone}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">
                        {entry.message}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.status === "sent" ? (
                          <Badge variant="outline" className="border-primary/30 text-primary">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Enviado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-destructive/30 text-destructive">
                            <XCircle className="w-3 h-3 mr-1" /> Fallido
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Mostrando {relevantActivity.length} registros clave (fallidos y recientes)
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-start">
        <Button
          onClick={onBack}
          disabled={isCampaignBusy || controlsDisabled}
          variant="outline"
          size="lg"
          className="min-w-[108px] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          ← Atrás
        </Button>
      </div>
    </motion.div>
  );
};

export default Step4Monitor;
