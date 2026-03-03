import { useEffect, useRef, useState } from "react";
import Stepper from "@/components/dashboard/Stepper";
import Step1Contacts from "@/components/dashboard/Step1Contacts";
import Step2Messages from "@/components/dashboard/Step2Messages";
import Step3Params from "@/components/dashboard/Step3Params";
import Step4Monitor from "@/components/dashboard/Step4Monitor";
import { Contact, MessageVariation, SendingParams } from "@/types/campaign";
import { MessageSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { hasExtensionRuntime, sendRuntimeMessage, subscribeRuntimeMessages } from "@/lib/extension-runtime";

const DRAFT_STORAGE_KEY = "wsp_dashboard_draft_v1";

const DEFAULT_MESSAGES: MessageVariation[] = [
  { id: crypto.randomUUID(), label: "Variación A", content: "" },
];

const DEFAULT_PARAMS: SendingParams = {
  mode: "human",
  delay: 25,
  sessionLimit: 100,
  autoRetry: true,
  variationEvery: 1,
  variationMode: "sequential",
};

type MinimalEngineState = {
  status?: string;
};

type GetStateResponse = {
  ok?: boolean;
  state?: MinimalEngineState;
};

type RuntimeStateUpdateMessage = {
  type?: string;
  state?: MinimalEngineState;
};

const isQuotaExceededError = (error: unknown): boolean => {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
};

const toLightweightDraftMessages = (variations: MessageVariation[]): MessageVariation[] => {
  return variations.map(({ media, ...variation }) => variation);
};

type StorageLocalLike = {
  get: (key: string, callback: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
};

type ChromeStorageLike = {
  storage?: {
    local?: StorageLocalLike;
  };
};

const getExtensionStorageLocal = (): StorageLocalLike | null => {
  const chromeLike = (globalThis as { chrome?: ChromeStorageLike }).chrome;
  return chromeLike?.storage?.local ?? null;
};

const getChromeRuntimeLastErrorMessage = (): string | null => {
  const chromeLike = (globalThis as {
    chrome?: {
      runtime?: {
        lastError?: { message?: string };
      };
    };
  }).chrome;

  return chromeLike?.runtime?.lastError?.message || null;
};

const readDraftFromStorage = async (): Promise<unknown | null> => {
  const extensionStorage = getExtensionStorageLocal();
  if (extensionStorage) {
    const value = await new Promise<unknown | null>((resolve, reject) => {
      extensionStorage.get(DRAFT_STORAGE_KEY, (items) => {
        const errorMessage = getChromeRuntimeLastErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        resolve((items?.[DRAFT_STORAGE_KEY] as unknown) ?? null);
      });
    });
    if (value) {
      return value;
    }
  }

  const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  return JSON.parse(raw);
};

const writeDraftToStorage = async (draft: unknown) => {
  const extensionStorage = getExtensionStorageLocal();
  if (extensionStorage) {
    await new Promise<void>((resolve, reject) => {
      extensionStorage.set({ [DRAFT_STORAGE_KEY]: draft }, () => {
        const errorMessage = getChromeRuntimeLastErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        resolve();
      });
    });
    return;
  }

  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
};

const Index = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [campaignLocked, setCampaignLocked] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsDraftText, setContactsDraftText] = useState("");
  const [messages, setMessages] = useState<MessageVariation[]>(DEFAULT_MESSAGES);
  const [params, setParams] = useState<SendingParams>(DEFAULT_PARAMS);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftSaveState, setDraftSaveState] = useState<"saved" | "lightweight" | "error">("saved");
  const quotaToastShownRef = useRef(false);

  const goNext = (fromStep: number) => {
    setCurrentStep(fromStep + 1);
  };

  const handleStepChange = (step: number) => {
    if (campaignLocked && step !== 3) {
      setCurrentStep(3);
      toast({
        title: "Campaña en proceso",
        description: "Detén o finaliza el envío para cambiar de pestaña.",
      });
      return;
    }
    setCurrentStep(step);
  };

  useEffect(() => {
    (async () => {
      try {
        const draft = await readDraftFromStorage();
        if (!draft || typeof draft !== "object") {
          return;
        }

        const parsedDraft = draft as {
          contacts?: Contact[];
          contactsDraftText?: string;
          messages?: MessageVariation[];
          params?: Partial<SendingParams>;
          currentStep?: number;
        };

        if (Array.isArray(parsedDraft.contacts)) {
          setContacts(parsedDraft.contacts);
        }

        if (typeof parsedDraft.contactsDraftText === "string") {
          setContactsDraftText(parsedDraft.contactsDraftText);
        }

        if (Array.isArray(parsedDraft.messages) && parsedDraft.messages.length > 0) {
          setMessages(parsedDraft.messages);
        }

        if (parsedDraft.params && typeof parsedDraft.params === "object") {
          const loadedParams = parsedDraft.params;
          setParams({
            mode: loadedParams.mode === "automatic" ? "automatic" : "human",
            delay: Math.max(5, Number(loadedParams.delay) || DEFAULT_PARAMS.delay),
            sessionLimit: Math.max(1, Number(loadedParams.sessionLimit) || DEFAULT_PARAMS.sessionLimit),
            autoRetry: Boolean(loadedParams.autoRetry),
            variationEvery: Math.max(1, Number(loadedParams.variationEvery) || DEFAULT_PARAMS.variationEvery),
            variationMode: loadedParams.variationMode === "random" ? "random" : "sequential",
          });
        }

        if (Number.isInteger(parsedDraft.currentStep)) {
          const clampedStep = Math.max(0, Math.min(3, Number(parsedDraft.currentStep)));
          setCurrentStep(clampedStep);
        }
      } catch {
        // Ignorar borradores corruptos
      } finally {
        setDraftHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }

    const draft = { currentStep, contacts, contactsDraftText, messages, params };
    (async () => {
      try {
        await writeDraftToStorage(draft);
        setDraftSaveState("saved");
      } catch (error) {
        if (isQuotaExceededError(error)) {
          const lightweightDraft = {
            currentStep,
            contacts,
            contactsDraftText,
            messages: toLightweightDraftMessages(messages),
            params,
          };

          try {
            await writeDraftToStorage(lightweightDraft);
            setDraftSaveState("lightweight");
            if (!quotaToastShownRef.current) {
              quotaToastShownRef.current = true;
              toast({
                title: "Borrador optimizado",
                description: "Se omitió el adjunto pesado del guardado local para evitar límite de almacenamiento.",
              });
            }
          } catch {
            setDraftSaveState("error");
            // Si falla incluso en modo liviano, no bloquear la UI.
          }
        } else {
          setDraftSaveState("error");
        }
      }
    })();
  }, [currentStep, contacts, contactsDraftText, messages, params, draftHydrated]);

  useEffect(() => {
    if (!hasExtensionRuntime()) {
      return;
    }

    const syncLockFromState = (state?: MinimalEngineState) => {
      const engineStatus = state?.status;
      const locked = engineStatus === "running" || engineStatus === "paused";
      setCampaignLocked(locked);
      if (locked) {
        setCurrentStep(3);
      }
    };

    sendRuntimeMessage<GetStateResponse>({ type: "GET_STATE" })
      .then((result) => syncLockFromState(result?.state))
      .catch(() => {
        // Si el worker está dormido, no bloquear la UI.
      });

    const unsubscribe = subscribeRuntimeMessages((message: unknown) => {
      const payload = message as RuntimeStateUpdateMessage;
      if (payload?.type === "STATE_UPDATED") {
        syncLockFromState(payload.state);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-tight">WhatsApp Prospecting</h1>
            <p className="text-xs text-muted-foreground">Dashboard de gestión de campañas</p>
          </div>
          {draftSaveState !== "saved" && (
            <p className="ml-auto text-[11px] text-muted-foreground/80">
              {draftSaveState === "lightweight"
                ? "Guardado local sin adjunto pesado"
                : "Guardado local con limitaciones"}
            </p>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-5xl mx-auto px-4 py-8">
        <Stepper
          currentStep={currentStep}
          onStepClick={handleStepChange}
          locked={campaignLocked}
        />

        {currentStep === 0 && (
          <Step1Contacts
            contacts={contacts}
            setContacts={setContacts}
            manualInput={contactsDraftText}
            setManualInput={setContactsDraftText}
            onNext={() => goNext(0)}
          />
        )}
        {currentStep === 1 && (
          <Step2Messages
            messages={messages}
            setMessages={setMessages}
            contacts={contacts}
            params={params}
            setParams={setParams}
            onNext={() => goNext(1)}
            onBack={() => handleStepChange(0)}
          />
        )}
        {currentStep === 2 && (
          <Step3Params
            params={params}
            setParams={setParams}
            onNext={() => goNext(2)}
            onBack={() => handleStepChange(1)}
          />
        )}
        {currentStep === 3 && (
          <Step4Monitor
            contacts={contacts}
            messages={messages}
            params={params}
            onBack={() => handleStepChange(2)}
            onStatusChange={(status) => {
              const locked = status === "running" || status === "paused";
              setCampaignLocked(locked);
              if (locked) {
                setCurrentStep(3);
              }
            }}
          />
        )}
      </main>
    </div>
  );
};

export default Index;
