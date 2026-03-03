const els = {
  fileInput: document.getElementById("configFileInput"),
  openDashboardBtn: document.getElementById("openDashboardBtn"),
  textarea: document.getElementById("configTextarea"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  loadStoredConfigBtn: document.getElementById("loadStoredConfigBtn"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  configSummary: document.getElementById("configSummary"),
  statusBadge: document.getElementById("statusBadge"),
  kpiSent: document.getElementById("kpiSent"),
  kpiPending: document.getElementById("kpiPending"),
  kpiFailed: document.getElementById("kpiFailed"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  activityTableBody: document.getElementById("activityTableBody"),
  errorText: document.getElementById("errorText"),
  tabButtons: Array.from(document.querySelectorAll("[data-tab-target]")),
  tabPanels: Array.from(document.querySelectorAll("[data-tab-panel]")),
};

const POLL_MS = 900;

bootstrap().catch((error) => {
  showError(error.message || "No se pudo inicializar el popup");
});

async function bootstrap() {
  bindEvents();
  setActiveTab("config");
  await loadStoredConfigToTextarea();
  await refreshState();

  setInterval(() => {
    refreshState().catch(() => {
      // Evita romper la UI si el worker se reinicia.
    });
  }, POLL_MS);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "STATE_UPDATED" && message?.state) {
      renderState(message.state);
    }
  });
}

function bindEvents() {
  els.fileInput.addEventListener("change", handleConfigFile);
  els.openDashboardBtn.addEventListener("click", () => runSafely(openDashboardPage));
  els.saveConfigBtn.addEventListener("click", saveConfigFromTextarea);
  els.loadStoredConfigBtn.addEventListener("click", loadStoredConfigToTextarea);

  els.startBtn.addEventListener("click", () => runSafely(startCampaign));
  els.pauseBtn.addEventListener("click", () => runSafely(pauseCampaign));
  els.resumeBtn.addEventListener("click", () => runSafely(resumeCampaign));
  els.stopBtn.addEventListener("click", () => runSafely(stopCampaign));
  els.exportCsvBtn.addEventListener("click", () => runSafely(exportResultsCsv));

  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget || "config");
    });
  });
}

async function openDashboardPage() {
  clearError();
  const url = chrome.runtime.getURL("app/index.html");
  await chrome.tabs.create({ url, active: true });
}

async function handleConfigFile(event) {
  clearError();
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const content = await file.text();
  els.textarea.value = content;
  await saveConfigFromTextarea();
}

async function saveConfigFromTextarea() {
  clearError();
  const text = els.textarea.value.trim();
  if (!text) {
    throw new Error("Debes pegar o seleccionar un JSON");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    throw new Error("El contenido no es un JSON válido");
  }

  const result = await sendMessage({ type: "SET_CONFIG", config: parsed });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo guardar la configuración");
  }

  renderConfigSummary(result.summary);
}

async function startCampaign() {
  clearError();
  const result = await sendMessage({ type: "START_CAMPAIGN" });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo iniciar la campaña");
  }
  await refreshState();
}

async function pauseCampaign() {
  clearError();
  const result = await sendMessage({ type: "PAUSE_CAMPAIGN" });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo pausar");
  }
  await refreshState();
}

async function resumeCampaign() {
  clearError();
  const result = await sendMessage({ type: "RESUME_CAMPAIGN" });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo reanudar");
  }
  await refreshState();
}

async function stopCampaign() {
  clearError();
  const result = await sendMessage({ type: "STOP_CAMPAIGN" });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo detener");
  }
  await refreshState();
}

async function loadStoredConfigToTextarea() {
  clearError();
  const result = await sendMessage({ type: "GET_CONFIG" });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo cargar la configuración guardada");
  }

  if (!result.config) {
    els.configSummary.textContent = "Sin configuración guardada";
    return;
  }

  els.textarea.value = JSON.stringify(result.config, null, 2);
  renderConfigSummary({
    contacts: result.config.contacts?.length || 0,
    messages: result.config.messages?.length || 0,
    mode: result.config.params?.mode || "human",
    delay: result.config.params?.delay || 20,
    sessionLimit: result.config.params?.sessionLimit || 0,
    autoRetry: Boolean(result.config.params?.autoRetry),
    variationEvery: result.config.params?.variationEvery || 1,
    variationMode: result.config.params?.variationMode || "sequential",
  });
}

async function refreshState() {
  const result = await sendMessage({ type: "GET_STATE" });
  if (!result.ok) {
    throw new Error(result.error || "No se pudo consultar el estado");
  }
  renderState(result.state);
}

function renderConfigSummary(summary) {
  if (!summary) {
    els.configSummary.textContent = "Sin configuración cargada";
    return;
  }

  const variationSummary =
    summary.variationMode === "random"
      ? "variación aleatoria"
      : `variación cada ${summary.variationEvery || 1}`;

  els.configSummary.textContent = [
    `${summary.contacts} contactos`,
    `${summary.messages} mensajes`,
    `modo ${summary.mode}`,
    variationSummary,
    `delay ${summary.delay}s`,
    `límite ${summary.sessionLimit}`,
    summary.autoRetry ? "reintento ON" : "reintento OFF",
  ].join(" · ");
}

function renderState(state) {
  const status = state?.status || "idle";
  const totals = state?.totals || {
    sent: 0,
    pending: 0,
    failed: 0,
  };
  const progress = Number(state?.progress || 0);
  const logs = Array.isArray(state?.logs) ? state.logs : [];

  els.statusBadge.textContent = status;
  els.statusBadge.style.borderColor = statusColor(status);
  els.statusBadge.style.color = statusColor(status);

  els.kpiSent.textContent = String(totals.sent || 0);
  els.kpiPending.textContent = String(totals.pending || 0);
  els.kpiFailed.textContent = String(totals.failed || 0);

  els.progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
  els.progressText.textContent = `${Math.round(progress)}%`;

  renderLogs(logs.slice(0, 50));
  renderButtonsByStatus(status);

  if (state?.error) {
    showError(state.error);
  } else {
    clearError();
  }
}

function renderLogs(logs) {
  if (logs.length === 0) {
    els.activityTableBody.innerHTML = '<tr><td colspan="3" class="empty">Sin actividad</td></tr>';
    return;
  }

  els.activityTableBody.innerHTML = logs
    .map((entry) => {
      const when = new Date(entry.timestamp).toLocaleTimeString();
      const statusClass = entry.status === "sent" ? "status-sent" : "status-failed";
      const statusText = entry.status === "sent" ? "Enviado" : "Fallido";
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(entry.phone || "")}</td>
          <td class="${statusClass}">${statusText}</td>
        </tr>
      `;
    })
    .join("");
}

function renderButtonsByStatus(status) {
  const running = status === "running";
  const paused = status === "paused";

  els.startBtn.disabled = running || paused;
  els.pauseBtn.disabled = !running;
  els.resumeBtn.disabled = !paused;
  els.stopBtn.disabled = !(running || paused);
}

function statusColor(status) {
  if (status === "running") return "#86efac";
  if (status === "paused") return "#fcd34d";
  if (status === "completed") return "#4ade80";
  if (status === "error") return "#fca5a5";
  if (status === "stopped") return "#fda4af";
  return "#93c5fd";
}

function showError(message) {
  els.errorText.hidden = false;
  els.errorText.textContent = message;
}

function clearError() {
  els.errorText.hidden = true;
  els.errorText.textContent = "";
}

function setActiveTab(tabName) {
  els.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTarget === tabName);
  });

  els.tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.tabPanel === tabName);
  });
}

async function exportResultsCsv() {
  clearError();
  const stateResponse = await sendMessage({ type: "GET_STATE" });
  const configResponse = await sendMessage({ type: "GET_CONFIG" });

  if (!stateResponse.ok) {
    throw new Error(stateResponse.error || "No se pudo leer estado de campaña");
  }

  if (!configResponse.ok) {
    throw new Error(configResponse.error || "No se pudo leer configuración");
  }

  const state = stateResponse.state || {};
  const config = configResponse.config;

  if (!config?.contacts?.length) {
    throw new Error("No hay contactos configurados para exportar");
  }

  const sessionLimit = Math.max(1, Number(config?.params?.sessionLimit) || config.contacts.length);
  const contacts = config.contacts.slice(0, sessionLimit);
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const logsByIndex = new Map();

  logs.forEach((entry) => {
    if (Number.isInteger(entry.contactIndex) && !logsByIndex.has(entry.contactIndex)) {
      logsByIndex.set(entry.contactIndex, entry);
    }
  });

  const rows = contacts.map((contact, i) => {
    const idx = i + 1;
    const log = logsByIndex.get(idx);
    return {
      index: idx,
      phone: contact.phone || "",
      name: contact.name || "",
      status: log?.status || "pending",
      attempts: log?.attempts ?? 0,
      sentAt: log?.timestamp || "",
      error: log?.error || "",
      message: log?.message || "",
    };
  });

  const header = ["index", "phone", "name", "status", "attempts", "sent_at", "error", "message"];
  const csvContent = [header.join(",")]
    .concat(
      rows.map((row) =>
        [
          row.index,
          row.phone,
          row.name,
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
  const link = document.createElement("a");
  link.href = url;
  link.download = `wsp-resultados-${timestampForFile()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function runSafely(fn) {
  fn().catch((error) => {
    showError(error.message || "Ocurrió un error");
  });
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "Sin respuesta del background" });
    });
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function timestampForFile() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
