const SEND_BUTTON_SELECTORS = [
  'button[data-testid="compose-btn-send"]',
  'button span[data-icon="send"]',
  'button span[data-icon="send-filled"]',
  'button[aria-label="Send"]',
  'button[aria-label="Enviar"]',
  'button[title="Send"]',
  'button[title="Enviar"]',
];

const INVALID_PHONE_SELECTORS = [
  '[data-testid="alert-phone-number-invalid"]',
  '[data-testid="search-no-chats"]',
];

const ATTACH_BUTTON_SELECTORS = [
  'button[title="Attach"]',
  'button[title="Adjuntar"]',
  'button[aria-label="Attach"]',
  'button[aria-label="Adjuntar"]',
  'span[data-icon="plus"]',
  'span[data-icon="clip"]',
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"][accept*="image"]',
  'input[type="file"][accept*="video"]',
  'input[type="file"]',
];

const MEDIA_SEND_BUTTON_SELECTORS = [
  '[role="dialog"] button[data-testid="compose-btn-send"]',
  '[role="dialog"] button[aria-label="Send"]',
  '[role="dialog"] button[aria-label="Enviar"]',
  '[role="dialog"] button[title="Send"]',
  '[role="dialog"] button[title="Enviar"]',
  '[role="dialog"] button:has(span[data-icon="send"])',
  '[role="dialog"] button:has(span[data-icon="send-filled"])',
];

const CHAT_TITLE_SELECTORS = [
  'header [data-testid="conversation-info-header-chat-title"]',
  'header [data-testid="conversation-header"] span[dir="auto"]',
  'header [data-testid="conversation-header"] [title]',
  'header [role="button"] span[dir="auto"]',
  'header span[title]',
];

const CHAT_SUBTITLE_SELECTORS = [
  'header [data-testid="conversation-info-header-chat-subtitle"]',
  'header [data-testid="conversation-header"] div[dir="auto"]',
  'header div[title]',
];

const INFO_PANEL_SELECTORS = [
  '[aria-label*="Info. del contacto"]',
  '[aria-label*="Contact info"]',
  '[data-testid="drawer-right"]',
  '[data-testid="chat-info-drawer"]',
];

const OPEN_INFO_TRIGGER_SELECTORS = [
  'header [data-testid="conversation-header"]',
  'header [data-testid="conversation-info-header"]',
  '[data-testid="conversation-header"]',
  '[data-testid="conversation-info-header"]',
  'main header',
  'main [role="banner"]',
  'header [role="button"]',
  'header span[title]',
  'header span[dir="auto"]',
];

const CLOSE_INFO_BUTTON_SELECTORS = [
  '[aria-label*="Cerrar"]',
  '[aria-label*="Close"]',
  '[data-testid="x-alt"]',
  '[data-icon="x-alt"]',
];

const RUNTIME_INVALIDATED_ERROR = "Extension context invalidated";
let keepAliveTimer = null;

if (window.__wspContentScriptInitialized !== true) {
  window.__wspContentScriptInitialized = true;
  initContentScript();
}

function initContentScript() {
  const runtime = getRuntimeSafe();
  if (!runtime) {
    return;
  }

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CLICK_SEND") {
      attemptSendFromCurrentChat()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || "Error desconocido" }));
      return true;
    }

    if (message?.type === "SEND_MEDIA") {
      attemptSendMediaFromCurrentChat(message?.media, message?.caption || "")
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || "Error desconocido" }));
      return true;
    }

    if (message?.type === "GET_CHAT_PROFILE") {
      readChatProfile(message?.options || {})
        .then((profile) => sendResponse({ ok: true, profile }))
        .catch((error) => sendResponse({ ok: false, error: error.message || "No se pudo leer perfil" }));
      return true;
    }

    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  startKeepAlive();
}

function getRuntimeSafe() {
  try {
    return chrome?.runtime || null;
  } catch (_error) {
    return null;
  }
}

function isRuntimeInvalidated(error) {
  const message = String(error?.message || error || "");
  return message.includes(RUNTIME_INVALIDATED_ERROR);
}

async function attemptSendFromCurrentChat() {
  if (isLoginScreenVisible()) {
    return { ok: false, error: "Debes iniciar sesión en WhatsApp Web" };
  }

  const result = await waitForSendOrError(15000);
  if (result === "invalid_phone") {
    return { ok: false, error: "Número inválido o chat no disponible" };
  }

  if (result !== "send_button") {
    return { ok: false, error: "No se encontró el botón de enviar" };
  }

  const button = getSendButton();
  if (!button) {
    return { ok: false, error: "El botón de enviar no está disponible" };
  }

  button.click();
  await sleep(700);

  return { ok: true };
}

async function attemptSendMediaFromCurrentChat(media, captionText) {
  if (isLoginScreenVisible()) {
    return { ok: false, error: "Debes iniciar sesión en WhatsApp Web" };
  }

  if (!media?.dataUrl) {
    return { ok: false, error: "No hay archivo adjunto para enviar" };
  }

  const fileInput = await waitForAttachmentInput(12000);
  if (!fileInput) {
    return { ok: false, error: "No se encontró el selector de adjuntos en WhatsApp Web" };
  }

  const file = await dataUrlToFile(media);
  await setFileInInput(fileInput, file);
  await sleep(1200);

  let captionUsed = false;
  if (String(captionText || "").trim()) {
    captionUsed = trySetCaptionText(String(captionText || "").trim());
  }

  const sendButton = await waitForMediaSendButton(20000);
  if (!sendButton) {
    return { ok: false, error: "Botón de enviar no disponible para adjunto" };
  }

  clickElementRobust(sendButton);
  await sleep(900);

  return { ok: true, captionUsed };
}

async function waitForMediaSendButton(timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const button = getMediaSendButton();
    if (button) {
      return button;
    }
    await sleep(200);
  }

  return getSendButton();
}

async function readChatProfile(options = {}) {
  const includeInfoPanel = Boolean(options.includeInfoPanel);
  const includeDebug = Boolean(options.debug);

  let panelOpenedByScript = false;
  let bestSnapshot = {
    titleCandidates: [],
    subtitleCandidates: [],
    infoPanelCandidates: [],
    sidebarCandidates: [],
    documentTitle: "",
    name: "",
    business: "",
    location: "",
  };

  const maxAttempts = includeInfoPanel ? 12 : 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (includeInfoPanel && !panelOpenedByScript) {
      panelOpenedByScript = await ensureInfoPanelOpen();
      if (panelOpenedByScript) {
        await sleep(220);
      }
    }

    const titleCandidates = getTextsFromSelectors(CHAT_TITLE_SELECTORS);
    const subtitleCandidates = getTextsFromSelectors(CHAT_SUBTITLE_SELECTORS);
    const infoPanelCandidates = getInfoPanelTextCandidates();
    const sidebarCandidates = getSidebarSelectedChatCandidates();
    const documentTitle = normalizeText(document.title || "");

    const name = pickBestName([
      ...titleCandidates,
      ...infoPanelCandidates,
      ...sidebarCandidates,
      documentTitle,
    ]);
    const cleanedName = cleanNameCandidate(name);

    const allCandidates = [
      ...titleCandidates,
      ...subtitleCandidates,
      ...infoPanelCandidates,
      ...sidebarCandidates,
      documentTitle,
    ];
    const isBusinessAccount = allCandidates.some((entry) => {
      const value = normalizeText(entry).toLowerCase();
      return value.includes("cuenta de empresa") || value.includes("business account");
    });

    const subtitle = pickBestSubtitle(subtitleCandidates);
    const parsed = parseBusinessAndLocation(subtitle);
    const fallbackBusiness = pickBusinessFallback(
      [...infoPanelCandidates, ...sidebarCandidates, documentTitle],
      cleanedName
    );
    const autoBusiness = isBusinessAccount
      ? parsed.business || fallbackBusiness || cleanedName
      : "";

    bestSnapshot = {
      titleCandidates,
      subtitleCandidates,
      infoPanelCandidates,
      sidebarCandidates,
      documentTitle,
      name: cleanedName || "",
      business: autoBusiness || "",
      location: parsed.location || "",
    };

    if (bestSnapshot.name || bestSnapshot.business || bestSnapshot.location) {
      break;
    }

    await sleep(220);
  }

  const result = {
    name: bestSnapshot.name,
    business: bestSnapshot.business,
    location: bestSnapshot.location,
  };

  if (includeDebug) {
    result.debug = {
      titleCandidates: bestSnapshot.titleCandidates,
      subtitleCandidates: bestSnapshot.subtitleCandidates,
      infoPanelCandidates: bestSnapshot.infoPanelCandidates,
      sidebarCandidates: bestSnapshot.sidebarCandidates,
      documentTitle: bestSnapshot.documentTitle,
      selectedName: result.name,
      selectedBusiness: result.business,
      selectedLocation: result.location,
      panelOpenedByScript,
    };
  }

  if (panelOpenedByScript) {
    closeInfoPanel();
  }

  return result;
}

function pickBestName(candidates) {
  for (const candidate of candidates) {
    if (isMeaningfulProfileText(candidate) && !looksLikePhone(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (isMeaningfulProfileText(candidate)) {
      return candidate;
    }
  }

  return "";
}

function pickBestSubtitle(candidates) {
  for (const candidate of candidates) {
    if (!isMeaningfulProfileText(candidate)) continue;
    if (looksLikePhone(candidate)) continue;
    return candidate;
  }
  return "";
}

function pickBusinessFallback(candidates, name) {
  const normalizedName = normalizeText(name).toLowerCase();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) continue;
    if (!isMeaningfulProfileText(normalizedCandidate)) continue;
    if (looksLikePhone(normalizedCandidate)) continue;
    if (normalizedName && normalizedCandidate.toLowerCase() === normalizedName) continue;
    return normalizedCandidate;
  }

  return "";
}

function parseBusinessAndLocation(subtitle) {
  const value = String(subtitle || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return { business: "", location: "" };
  }

  const normalized = value.toLowerCase();
  const genericSubtitlePatterns = [
    "en línea",
    "en linea",
    "nuevo chat",
    "new chat",
    "detalles del perfil",
    "profile details",
    "info. del contacto",
    "contact info",
    "escribiendo",
    "grabando audio",
    "últ. vez",
    "ult. vez",
    "visto",
    "cuenta de empresa",
    "info.",
  ];

  if (genericSubtitlePatterns.some((pattern) => normalized.includes(pattern))) {
    return { business: "", location: "" };
  }

  const separators = ["·", "|", "—", "-", ","];
  for (const separator of separators) {
    if (!value.includes(separator)) continue;
    const parts = value.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        business: parts[0] || "",
        location: parts.slice(1).join(" ").trim(),
      };
    }
  }

  return {
    business: value,
    location: "",
  };
}

function getTextsFromSelectors(selectors) {
  const results = [];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    for (const element of elements) {
      const text = normalizeText(String(element.getAttribute("title") || element.textContent || ""));
      if (!text) continue;
      results.push(text);
    }
  }

  return results;
}

function getInfoPanelTextCandidates() {
  for (const selector of INFO_PANEL_SELECTORS) {
    const panel = document.querySelector(selector);
    if (!panel) continue;

    const elements = Array.from(panel.querySelectorAll('[title], h1, h2, h3, span[dir="auto"], div[dir="auto"], p'));
    const candidates = [];

    for (const element of elements) {
      const text = normalizeText(String(element.getAttribute("title") || element.textContent || ""));
      if (!text) continue;
      candidates.push(text);
    }

    if (candidates.length > 0) {
      return candidates;
    }
  }

  return [];
}

function getSidebarSelectedChatCandidates() {
  const selectors = [
    '[aria-selected="true"] span[dir="auto"]',
    '[data-testid="cell-frame-container"][aria-selected="true"] span[dir="auto"]',
    '[data-testid="cell-frame-title"]',
    '[data-testid*="cell-frame"] span[dir="auto"]',
  ];

  const candidates = [];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    for (const element of elements) {
      const text = normalizeText(String(element.getAttribute("title") || element.textContent || ""));
      if (!text) continue;
      candidates.push(text);
    }
  }

  return candidates;
}

async function ensureInfoPanelOpen() {
  const existingPanel = getInfoPanelElement();
  if (existingPanel) {
    return false;
  }

  for (const selector of OPEN_INFO_TRIGGER_SELECTORS) {
    const trigger = document.querySelector(selector);
    if (!trigger) continue;

    try {
      clickElementRobust(trigger);
    } catch (_error) {
      // Ignorar y continuar con otros triggers
    }

    const opened = await waitForCondition(() => Boolean(getInfoPanelElement()), 8, 160);
    if (opened) {
      return true;
    }
  }

  return false;
}

function clickElementRobust(target) {
  if (!target) return;

  const element = target instanceof Element ? target : null;
  if (!element) return;

  const interactive = element.closest('button,[role="button"],a') || element;

  interactive.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  interactive.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  interactive.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function closeInfoPanel() {
  for (const selector of CLOSE_INFO_BUTTON_SELECTORS) {
    const target = document.querySelector(selector);
    if (!target) continue;

    const button = target.tagName === "BUTTON" ? target : target.closest("button");
    if (button && !button.disabled) {
      button.click();
      return;
    }

    try {
      target.click();
      return;
    } catch (_error) {
      // Ignorar
    }
  }
}

function getInfoPanelElement() {
  for (const selector of INFO_PANEL_SELECTORS) {
    const panel = document.querySelector(selector);
    if (panel) return panel;
  }
  return null;
}

async function waitForCondition(predicate, retries, waitMs) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (predicate()) return true;
    await sleep(waitMs);
  }
  return false;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function cleanNameCandidate(value) {
  const text = normalizeText(value);
  if (!text) return "";

  const parts = text
    .split("|")
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .filter((part) => {
      const lower = part.toLowerCase();
      if (
        lower.includes("cuenta de empresa") ||
        lower.includes("business account") ||
        lower.includes("(tú)") ||
        lower === "tú" ||
        lower === "(tu)" ||
        lower === "tu" ||
        lower.includes("envía mensajes") ||
        lower.includes("send messages") ||
        looksLikeDuration(part)
      ) {
        return false;
      }
      return true;
    });

  return parts[0] || text;
}

function looksLikePhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function looksLikeDuration(value) {
  const text = normalizeText(value).toLowerCase();
  return /^\d{1,2}:\d{2}$/.test(text) || /^\d{1,2}:\d{2}:\d{2}$/.test(text);
}

function isMeaningfulProfileText(value) {
  const text = normalizeText(value);
  if (!text) return false;

  const lower = text.toLowerCase();
  const blocked = [
    "llamar",
    "call",
    "buscar",
    "search",
    "cerrar",
    "close",
    "info. del contacto",
    "contact info",
    "catálogo",
    "catalog",
    "compartir",
    "share",
    "mensajes destacados",
    "starred messages",
    "silenciar notificaciones",
    "mute notifications",
    "archivos, enlaces y documentos",
    "media, links and docs",
    "detalles del perfil",
    "profile details",
    "en línea",
    "en linea",
    "online",
    "(tú)",
    "tú",
    "(tu)",
    "tu",
    "escribiendo",
    "typing",
    "cuenta de empresa",
    "abierto ahora",
    "open now",
    "nuevo chat",
    "new chat",
    "whatsapp",
  ];

  if (blocked.some((token) => lower.includes(token))) {
    return false;
  }

  if (looksLikeDuration(text)) {
    return false;
  }

  return true;
}

function isLoginScreenVisible() {
  const qrCanvas = document.querySelector("canvas[aria-label*='Scan'], canvas[aria-label*='Escanear']");
  const qrWrapper = document.querySelector('[data-testid="qrcode"]');
  return Boolean(qrCanvas || qrWrapper);
}

async function waitForSendOrError(timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (hasInvalidPhoneError()) {
      return "invalid_phone";
    }

    if (getSendButton()) {
      return "send_button";
    }

    await sleep(250);
  }

  return "timeout";
}

async function waitForAttachmentInput(timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const input = getAttachmentInput();
    if (input) {
      return input;
    }

    const attachButton = getAttachButton();
    if (attachButton) {
      attachButton.click();
    }

    await sleep(250);
  }

  return null;
}

function getAttachmentInput() {
  for (const selector of FILE_INPUT_SELECTORS) {
    const input = document.querySelector(selector);
    if (!input || input.disabled) continue;
    return input;
  }
  return null;
}

function getAttachButton() {
  for (const selector of ATTACH_BUTTON_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (!candidate) continue;
    const button = candidate.tagName === "BUTTON" ? candidate : candidate.closest("button");
    if (button && !button.disabled) {
      return button;
    }
  }
  return null;
}

async function dataUrlToFile(media) {
  const response = await fetch(media.dataUrl);
  const blob = await response.blob();
  const mimeType = media.mimeType || blob.type || "application/octet-stream";
  const fileName = media.fileName || `adjunto.${mimeType.split("/")[1] || "bin"}`;
  return new File([blob], fileName, { type: mimeType });
}

async function setFileInInput(fileInput, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(100);
}

function trySetCaptionText(text) {
  const editor = getCaptionEditor();
  if (!editor) {
    return false;
  }

  editor.focus();
  editor.textContent = "";
  document.execCommand("insertText", false, text);

  if (normalizeText(editor.textContent || "") !== normalizeText(text)) {
    editor.textContent = text;
  }

  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    })
  );

  const finalText = String(editor.textContent || "").trim();
  return finalText.length > 0;
}

function getMediaSendButton() {
  for (const selector of MEDIA_SEND_BUTTON_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (!candidate) continue;

    const button = candidate.tagName === "BUTTON" ? candidate : candidate.closest("button");
    if (button && !button.disabled && button.offsetParent !== null) {
      return button;
    }
  }

  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return null;
  }

  const fallbackButtons = Array.from(dialog.querySelectorAll("button"));
  for (const button of fallbackButtons) {
    if (button.disabled) continue;
    if (button.offsetParent === null) continue;

    const icon = button.querySelector('span[data-icon="send"], span[data-icon="send-filled"]');
    if (icon) {
      return button;
    }

    const aria = String(button.getAttribute("aria-label") || "").toLowerCase();
    const title = String(button.getAttribute("title") || "").toLowerCase();
    if (aria.includes("send") || aria.includes("enviar") || title.includes("send") || title.includes("enviar")) {
      return button;
    }
  }

  return null;
}

function getCaptionEditor() {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return null;
  }

  const candidates = Array.from(dialog.querySelectorAll('[contenteditable="true"]'));
  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const label = String(candidate.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("caption") || label.includes("descripción") || label.includes("mensaje")) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

function hasInvalidPhoneError() {
  if (INVALID_PHONE_SELECTORS.some((selector) => document.querySelector(selector))) {
    return true;
  }

  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return false;
  }

  const text = (dialog.textContent || "").toLowerCase();
  return (
    text.includes("invalid") ||
    text.includes("inválido") ||
    text.includes("número no válido") ||
    text.includes("phone number shared via url is invalid")
  );
}

function getSendButton() {
  for (const selector of SEND_BUTTON_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (!candidate) {
      continue;
    }
    const button = candidate.tagName === "BUTTON" ? candidate : candidate.closest("button");
    if (button && !button.disabled) {
      return button;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }

  keepAliveTimer = setInterval(() => {
    try {
      const runtime = getRuntimeSafe();
      if (!runtime) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
        return;
      }

      const maybePromise = runtime.sendMessage({ type: "CONTENT_PING" });
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch((error) => {
          if (isRuntimeInvalidated(error)) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        });
      }
    } catch (error) {
      if (isRuntimeInvalidated(error)) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    }
  }, 20000);
}

