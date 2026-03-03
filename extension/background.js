const STORAGE_KEYS = {
  config: "wsp_campaign_config",
  state: "wsp_campaign_state",
};

const STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  STOPPED: "stopped",
  ERROR: "error",
};

const STOP_ERROR = "__CAMPAIGN_STOPPED__";

let runner = null;
let campaignState = createInitialState();

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEYS.state]: saved } = await chrome.storage.local.get(STORAGE_KEYS.state);
  if (!saved) {
    await persistState(campaignState);
  } else {
    campaignState = saved;
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { [STORAGE_KEYS.state]: saved } = await chrome.storage.local.get(STORAGE_KEYS.state);
  if (saved) {
    campaignState = saved;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Unknown error" }));
  return true;
});

async function handleMessage(message) {
  const type = message?.type;

  if (type === "CONTENT_PING") {
    return { pong: true };
  }

  if (type === "SET_CONFIG") {
    const config = normalizeConfig(message.config);
    await chrome.storage.local.set({ [STORAGE_KEYS.config]: config });
    return {
      config,
      summary: {
        contacts: config.contacts.length,
        messages: config.messages.length,
        mode: config.params.mode,
        delay: config.params.delay,
        sessionLimit: config.params.sessionLimit,
        autoRetry: config.params.autoRetry,
        variationEvery: config.params.variationEvery,
        variationMode: config.params.variationMode,
      },
    };
  }

  if (type === "GET_CONFIG") {
    const { [STORAGE_KEYS.config]: config } = await chrome.storage.local.get(STORAGE_KEYS.config);
    return { config: config || null };
  }

  if (type === "GET_STATE") {
    return { state: campaignState };
  }

  if (type === "CHECK_WHATSAPP_TAB") {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    return { isReady: tabs.some((tab) => Boolean(tab.id)) };
  }

  if (type === "START_CAMPAIGN") {
    if (runner && runner.isActive()) {
      throw new Error("Ya hay una campaña en ejecución");
    }

    let config = null;
    if (message?.config) {
      config = normalizeConfig(message.config);
      await chrome.storage.local.set({ [STORAGE_KEYS.config]: config });
    } else {
      const { [STORAGE_KEYS.config]: storedConfig } = await chrome.storage.local.get(STORAGE_KEYS.config);
      if (!storedConfig) {
        throw new Error("No hay configuración cargada");
      }
      config = normalizeConfig(storedConfig);
    }

    const tabId = await ensureWhatsAppTab();

    runner = new CampaignRunner(config, tabId);
    runner.start().catch(async (error) => {
      if (error.message === STOP_ERROR) {
        return;
      }
      await patchState({
        status: STATUS.ERROR,
        error: error.message || "Error inesperado al ejecutar campaña",
        finishedAt: new Date().toISOString(),
        nextSendInSec: null,
      });
      runner = null;
    });

    return { state: campaignState };
  }

  if (type === "PAUSE_CAMPAIGN") {
    if (!runner || !runner.isActive()) {
      throw new Error("No hay campaña en ejecución");
    }
    await runner.pause();
    return { state: campaignState };
  }

  if (type === "RESUME_CAMPAIGN") {
    if (!runner || !runner.canResume()) {
      throw new Error("No hay campaña en pausa");
    }
    await runner.resume();
    return { state: campaignState };
  }

  if (type === "STOP_CAMPAIGN") {
    if (!runner) {
      throw new Error("No hay campaña activa");
    }
    await runner.stop();
    runner = null;
    return { state: campaignState };
  }

  throw new Error("Mensaje no soportado");
}

class CampaignRunner {
  constructor(config, tabId) {
    this.config = config;
    this.tabId = tabId;
    this.stopped = false;
  }

  isActive() {
    return campaignState.status === STATUS.RUNNING || campaignState.status === STATUS.PAUSED;
  }

  canResume() {
    return campaignState.status === STATUS.PAUSED;
  }

  async start() {
    const now = new Date().toISOString();
    const contacts = this.config.contacts.slice(0, this.config.params.sessionLimit);

    await patchState({
      status: STATUS.RUNNING,
      error: null,
      startedAt: now,
      finishedAt: null,
      currentContact: null,
      progress: 0,
      nextSendInSec: null,
      totals: {
        total: contacts.length,
        processed: 0,
        pending: contacts.length,
        sent: 0,
        failed: 0,
      },
      logs: [],
      configSummary: {
        contacts: contacts.length,
        messages: this.config.messages.length,
        mode: this.config.params.mode,
        delay: this.config.params.delay,
        sessionLimit: this.config.params.sessionLimit,
        autoRetry: this.config.params.autoRetry,
        variationEvery: this.config.params.variationEvery,
        variationMode: this.config.params.variationMode,
      },
    });

    for (let index = 0; index < contacts.length; index += 1) {
      await this.guardPauseOrStop();

      const contact = contacts[index];
      const variation = getMessageVariationForIndex(
        this.config.messages,
        index,
        this.config.params.variationEvery,
        this.config.params.variationMode
      );
      const sendResult = await this.sendWithRetry(contact, variation);

      const currentTotals = campaignState.totals;
      const sent = sendResult.ok ? currentTotals.sent + 1 : currentTotals.sent;
      const failed = sendResult.ok ? currentTotals.failed : currentTotals.failed + 1;
      const processed = currentTotals.processed + 1;
      const pending = Math.max(currentTotals.total - processed, 0);

      const logEntry = {
        id: crypto.randomUUID(),
        contactIndex: index + 1,
        timestamp: new Date().toISOString(),
        phone: contact.phone,
        name: sendResult.resolvedContact?.name || contact.name || "",
        message: sendResult.previewMessage || sendResult.renderedMessage || "[Sin texto]",
        status: sendResult.ok ? "sent" : "failed",
        attempts: sendResult.attempts,
        error: sendResult.error || null,
      };

      await patchState({
        currentContact: contact.phone,
        progress: currentTotals.total === 0 ? 0 : Math.round((processed / currentTotals.total) * 100),
        totals: {
          ...currentTotals,
          processed,
          pending,
          sent,
          failed,
        },
        logs: [logEntry, ...campaignState.logs].slice(0, 500),
      });

      if (index < contacts.length - 1) {
        await this.waitDelay();
      }
    }

    await patchState({
      status: STATUS.COMPLETED,
      currentContact: null,
      finishedAt: new Date().toISOString(),
      progress: 100,
      nextSendInSec: null,
    });

    runner = null;
  }

  async pause() {
    if (campaignState.status !== STATUS.RUNNING) {
      return;
    }
    await patchState({ status: STATUS.PAUSED });
  }

  async resume() {
    if (campaignState.status !== STATUS.PAUSED) {
      return;
    }
    await patchState({ status: STATUS.RUNNING });
  }

  async stop() {
    this.stopped = true;
    await patchState({
      status: STATUS.STOPPED,
      currentContact: null,
      finishedAt: new Date().toISOString(),
      error: null,
      nextSendInSec: null,
    });
  }

  async sendWithRetry(contact, variation) {
    const maxAttempts = this.config.params.autoRetry ? 2 : 1;
    let lastError = null;
    let lastRenderedMessage = "";
    let lastPreviewMessage = "";
    let lastResolvedContact = contact;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.guardPauseOrStop();

      try {
        const sendPayload = await sendVariationToContact(this.tabId, contact, variation);
        lastRenderedMessage = sendPayload.renderedMessage || "";
        lastPreviewMessage = sendPayload.previewMessage || "";
        lastResolvedContact = sendPayload.resolvedContact || contact;
        return {
          ok: true,
          attempts: attempt,
          renderedMessage: lastRenderedMessage,
          previewMessage: lastPreviewMessage,
          resolvedContact: lastResolvedContact,
        };
      } catch (error) {
        lastError = error.message || "No se pudo enviar";
      }

      if (attempt < maxAttempts) {
        await sleep(2500);
      }
    }

    return {
      ok: false,
      attempts: maxAttempts,
      error: lastError,
      renderedMessage: lastRenderedMessage,
      previewMessage: lastPreviewMessage,
      resolvedContact: lastResolvedContact,
    };
  }

  async waitDelay() {
    const delayMs = getDelayMs(this.config.params.mode, this.config.params.delay);
    let remainingMs = delayMs;
    const chunk = 250;
    let lastReportedSec = -1;
    await patchState({ nextSendInSec: Math.max(1, Math.ceil(remainingMs / 1000)) });

    while (remainingMs > 0) {
      await this.guardPauseOrStop();
      const stepMs = Math.min(chunk, remainingMs);
      await sleep(stepMs);
      remainingMs -= stepMs;

      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      if (remainingSec !== lastReportedSec) {
        lastReportedSec = remainingSec;
        await patchState({ nextSendInSec: remainingSec });
      }
    }

    await patchState({ nextSendInSec: null });
  }

  async guardPauseOrStop() {
    if (this.stopped) {
      throw new Error(STOP_ERROR);
    }

    while (campaignState.status === STATUS.PAUSED) {
      if (this.stopped) {
        throw new Error(STOP_ERROR);
      }
      await sleep(250);
    }

    if (campaignState.status === STATUS.STOPPED || this.stopped) {
      throw new Error(STOP_ERROR);
    }
  }
}

async function ensureWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const targetTab = tabs.find((tab) => Boolean(tab.id));

  if (!targetTab?.id) {
    throw new Error("Debes abrir WhatsApp Web (web.whatsapp.com) para iniciar la campaña");
  }

  await chrome.tabs.update(targetTab.id, { active: true });

  if (targetTab.status !== "complete") {
    await waitForTabComplete(targetTab.id, 60000);
  }

  return targetTab.id;
}

async function sendVariationToContact(tabId, contact, variation) {
  await openChat(tabId, contact.phone);
  const profile = await readChatProfile(tabId);
  const resolvedContact = mergeContactAndProfile(contact, profile);
  const renderedMessage = applyTemplate(variation.content || "", resolvedContact);
  let previewMessage = renderedMessage;

  if (variation.media) {
    const mediaResponse = await sendMediaFromCurrentChat(tabId, variation.media, renderedMessage);
    previewMessage = renderedMessage
      ? `[Media + Texto] ${variation.media.fileName || "archivo"}`
      : `[Media] ${variation.media.fileName || "archivo"}`;

    if (renderedMessage && !mediaResponse?.captionUsed) {
      await sendTextInCurrentChat(tabId, renderedMessage);
    }

    return { renderedMessage, previewMessage, resolvedContact };
  }

  if (!renderedMessage.trim()) {
    throw new Error("La variación no tiene texto ni adjunto");
  }

  await sendTextMessage(tabId, contact.phone, renderedMessage);
  return { renderedMessage, previewMessage, resolvedContact };
}

async function openChat(tabId, phone, options = {}) {
  const chatUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
  await updateTabAndWait(tabId, chatUrl, 45000, options);
  await sleep(1200);
}

async function sendTextMessage(tabId, phone, message) {
  const chatUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(
    message
  )}`;

  await updateTabAndWait(tabId, chatUrl, 45000);
  await sleep(1200);

  const response = await sendTabMessageWithRetry(tabId, { type: "CLICK_SEND" }, 15, 300);
  if (!response?.ok) {
    throw new Error(response?.error || "No se pudo enviar texto desde WhatsApp Web");
  }
}

async function sendMediaFromCurrentChat(tabId, media, caption) {
  const response = await sendTabMessageWithRetry(
    tabId,
    {
      type: "SEND_MEDIA",
      media,
      caption: caption || "",
    },
    15,
    300
  );

  if (!response?.ok) {
    throw new Error(response?.error || "No se pudo enviar adjunto desde WhatsApp Web");
  }

  return response;
}

async function sendTextInCurrentChat(tabId, message) {
  const response = await sendTabMessageWithRetry(
    tabId,
    {
      type: "SEND_TEXT_IN_CURRENT_CHAT",
      text: message,
    },
    10,
    250
  );

  if (!response?.ok) {
    throw new Error(response?.error || "No se pudo enviar texto en el chat actual");
  }
}

async function readChatProfile(tabId, options = {}) {
  const strict = Boolean(options.strict);

  try {
    const response = await sendTabMessageWithRetry(
      tabId,
      { type: "GET_CHAT_PROFILE", options },
      6,
      250
    );
    if (!response?.ok || !response.profile) {
      if (strict) {
        throw new Error(response?.error || "Perfil no disponible");
      }
      return {};
    }

    return response.profile;
  } catch (error) {
    if (strict) {
      throw error;
    }
    return {};
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timeout cargando WhatsApp Web"));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function updateTabAndWait(tabId, url, timeoutMs, options = {}) {
  const activateTab = options.activateTab !== false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timeout al abrir el chat"));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url, active: activateTab }, () => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });
  });
}

async function sendTabMessageWithRetry(tabId, message, retries, waitMs) {
  let lastErrorMessage = "No se pudo contactar el content script de WhatsApp";

  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response == null) {
        throw new Error("Sin respuesta del content script");
      }
      return response;
    } catch (error) {
      const runtimeMessage = chrome.runtime?.lastError?.message;
      lastErrorMessage = String(error?.message || runtimeMessage || lastErrorMessage);

      if (i === retries - 1) {
        throw new Error(lastErrorMessage);
      }
      await sleep(waitMs);
    }
  }
  return null;
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Configuración inválida");
  }

  const rawContacts = Array.isArray(rawConfig.contacts) ? rawConfig.contacts : [];
  const contacts = rawContacts
    .map((entry) => normalizeContact(entry))
    .filter((entry) => entry.phone.length >= 8);

  if (contacts.length === 0) {
    throw new Error("No hay contactos válidos en la configuración");
  }

  const rawMessages = Array.isArray(rawConfig.messages) ? rawConfig.messages : [];
  const messages = rawMessages
    .map((entry, index) => normalizeMessage(entry, index))
    .filter((entry) => entry.content.length > 0 || Boolean(entry.media));

  if (messages.length === 0) {
    throw new Error("No hay mensajes válidos en la configuración");
  }

  const params = normalizeParams(rawConfig.params || {}, contacts.length);

  return {
    schemaVersion: Number(rawConfig.schemaVersion) || 1,
    source: rawConfig.source || "unknown",
    exportedAt: rawConfig.exportedAt || null,
    contacts,
    messages,
    params,
  };
}

function normalizeContact(entry) {
  if (typeof entry === "string") {
    return { phone: sanitizePhone(entry), name: "", business: "", location: "" };
  }

  return {
    phone: sanitizePhone(entry?.phone || ""),
    name: String(entry?.name || "").trim(),
    business: String(entry?.business || "").trim(),
    location: String(entry?.location || "").trim(),
  };
}

function normalizeMessage(entry, index) {
  if (typeof entry === "string") {
    return { label: `Variación ${index + 1}`, content: entry.trim(), media: null };
  }

  const label = String(entry?.label || `Variación ${index + 1}`).trim();
  const mediaCheck = normalizeMedia(entry?.media);
  if (entry?.media && !mediaCheck.ok) {
    throw new Error(`Adjunto inválido en \"${label}\": ${mediaCheck.error}`);
  }

  return {
    label,
    content: String(entry?.content || "").trim(),
    media: mediaCheck.value,
  };
}

function normalizeMedia(media) {
  if (!media || typeof media !== "object") {
    return { ok: true, value: null };
  }

  const dataUrl = String(media.dataUrl || "").trim();
  if (!dataUrl.startsWith("data:")) {
    return {
      ok: false,
      value: null,
      error: "el archivo no tiene formato data URL válido",
    };
  }

  if (dataUrl.length > 12 * 1024 * 1024) {
    return {
      ok: false,
      value: null,
      error: "el archivo es demasiado grande para enviarse por la extensión",
    };
  }

  const fileName = String(media.fileName || "adjunto").trim() || "adjunto";
  const mimeType = String(media.mimeType || "").trim();

  return {
    ok: true,
    value: {
      dataUrl,
      fileName,
      mimeType,
    },
  };
}

function normalizeParams(rawParams, maxContacts) {
  const mode = rawParams.mode === "automatic" ? "automatic" : "human";
  const delay = clamp(Number(rawParams.delay) || 20, 3, 180);
  const sessionLimit = clamp(Number(rawParams.sessionLimit) || maxContacts, 1, maxContacts);
  const variationEvery = clamp(Number(rawParams.variationEvery) || 1, 1, 500);
  const variationMode = rawParams.variationMode === "random" ? "random" : "sequential";

  return {
    mode,
    delay,
    sessionLimit,
    autoRetry: Boolean(rawParams.autoRetry),
    variationEvery,
    variationMode,
  };
}

function getMessageVariationForIndex(messages, contactIndex, variationEvery, variationMode) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { label: "Variación", content: "", media: null };
  }

  if (variationMode === "random") {
    const randomIndex = randomInt(0, messages.length - 1);
    return messages[randomIndex];
  }

  const chunk = Math.max(1, Number(variationEvery) || 1);
  const rotationIndex = Math.floor(contactIndex / chunk) % messages.length;
  return messages[rotationIndex];
}

function mergeContactAndProfile(contact, profile) {
  const sanitize = (value) => String(value || "").trim();
  const isPhoneLike = (value) => sanitizePhone(value).length >= 8 && !/[a-zA-Z]/.test(String(value || ""));

  const rawProfileName = sanitize(profile?.name);
  const profileName = isPhoneLike(rawProfileName) ? "" : rawProfileName;
  const profileBusiness = sanitize(profile?.business);
  const profileLocation = sanitize(profile?.location);

  const csvName = sanitize(contact?.name);
  const csvBusiness = sanitize(contact?.business);
  const csvLocation = sanitize(contact?.location);

  return {
    ...contact,
    name: profileName || csvName,
    business: profileBusiness || csvBusiness || profileName || csvName,
    location: profileLocation || csvLocation,
  };
}

function applyTemplate(template, contact) {
  return template
    .replace(/\[Nombre\]/g, contact.name || "Cliente")
    .replace(/\[Negocio\]/g, contact.business || "tu negocio")
    .replace(/\[Ubicación\]/g, contact.location || "tu zona")
    .replace(/\[Telefono\]/g, contact.phone);
}

function getDelayMs(mode, baseDelaySec) {
  const base = Math.max(Number(baseDelaySec) || 1, 1);

  if (mode === "automatic") {
    const min = Math.max(800, Math.floor(base * 550));
    const max = Math.max(min + 300, Math.floor(base * 1300));
    const baseRandom = randomInt(min, max);
    const extraPause = Math.random() < 0.18 ? randomInt(400, Math.floor(base * 900)) : 0;
    return baseRandom + extraPause;
  }

  return Math.max(base * 1000, 1000);
}

function sanitizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInitialState() {
  return {
    status: STATUS.IDLE,
    error: null,
    startedAt: null,
    finishedAt: null,
    currentContact: null,
    progress: 0,
    nextSendInSec: null,
    totals: {
      total: 0,
      processed: 0,
      pending: 0,
      sent: 0,
      failed: 0,
    },
    configSummary: null,
    logs: [],
    updatedAt: new Date().toISOString(),
  };
}

async function patchState(partial) {
  campaignState = {
    ...campaignState,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  await persistState(campaignState);
  broadcastState(campaignState);
}

async function persistState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.state]: state });
}

function broadcastState(state) {
  chrome.runtime.sendMessage({ type: "STATE_UPDATED", state }).catch(() => {
    // No hay popup escuchando, no es un error real para la campaña.
  });
}
