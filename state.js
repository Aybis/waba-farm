/* Shared telemetry state and reusable, text-safe workstation status bubbles. */
(function (root) {
  "use strict";

  const thresholds = Object.freeze({ latencySeconds: 2.5, queueDepth: 50 });
  const labels = Object.freeze({ working: "Working", idle: "Standby", warning: "Warning", error: "Error" });
  const bubbleParts = new WeakMap();

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function metric(value) {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function resolve(row = {}) {
    row = row || {};
    const health = text(row.health).toUpperCase();
    const status = text(row.status).toUpperCase();
    const latency = metric(row.latency);
    const queue = metric(row.queueDepth);

    // Counts and lastError can be historical: only current state indicates failure.
    if (health === "ERROR" || health === "SERVER" || status === "ERROR") return "error";
    if (health === "WARN" || health === "WARNING" || status === "WARN" || status === "WARNING" ||
        (latency !== null && latency >= thresholds.latencySeconds) ||
        (queue !== null && queue > thresholds.queueDepth)) return "warning";
    if (status === "ACTIVE" || status === "WORKING" || (queue !== null && queue > 0)) return "working";
    return "idle";
  }

  function errorTitle(message, row, fallback) {
    if (/\b500\b/.test(message)) return /\bmeta\b/i.test(message) ? "Meta API 500" : "HTTP 500";
    if (/token.{0,24}(expired|kedaluwarsa|kadaluarsa)|(expired|kedaluwarsa|kadaluarsa).{0,24}token/i.test(message)) return "Token Expired";
    if (/token.{0,24}invalid|invalid.{0,24}token/i.test(message)) return "Token Invalid";
    if (/timeout|timed out/i.test(message)) {
      if (/inbound|warn_in|pesan masuk/i.test(message)) return "Inbound Timeout";
      if (/meta/i.test(message)) return "Meta API Timeout";
    }
    if (/meta.{0,24}(tidak merespons?|unavailable|not respond)/i.test(message)) return "Meta tidak merespons";
    if (/webhook.{0,24}(timeout|tidak merespons?|unavailable|not respond)/i.test(message)) return "Webhook tidak merespons";
    if (message) return message;
    return text(row.health).toUpperCase() === "SERVER" ? "Server / webhook bermasalah" : fallback;
  }

  function content(row = {}) {
    row = row || {};
    const state = resolve(row);
    const message = text(row.lastError);
    const latency = metric(row.latency);
    const queue = metric(row.queueDepth);

    if (state === "working") {
      return {
        state, icon: "💬", title: "Memproses pesan",
        detail: text(row.task) || (text(row.number) ? "Outbound #" + text(row.number) : "Traffic aktif")
      };
    }
    if (state === "idle") {
      return { state, icon: "☕", title: "Standby", detail: "Operator sedang istirahat" };
    }
    if (state === "warning") {
      const detail = [];
      if (queue !== null) detail.push("Queue " + queue);
      if (latency !== null) detail.push("Latency " + latency + "s");
      const fallback = latency !== null && latency >= thresholds.latencySeconds ? "Warn: High Latency"
        : queue !== null && queue > thresholds.queueDepth ? "Queue > " + thresholds.queueDepth : "Perlu perhatian";
      const reportedWarning = ["WARN", "WARNING"].includes(text(row.health).toUpperCase()) ||
        ["WARN", "WARNING"].includes(text(row.status).toUpperCase());
      return { state, icon: "⚠", title: errorTitle(reportedWarning ? message : "", row, fallback), detail: detail.join(" · ") || "Periksa detail workstation" };
    }
    const title = errorTitle(message, row, "Terjadi error");
    return { state, icon: "!", title, detail: message && message !== title ? message : "Periksa detail workstation" };
  }

  function create(row) {
    const doc = root.document;
    const bubble = doc.createElement("div");
    bubble.className = "status-bubble";
    const icon = doc.createElement("span");
    icon.className = "bubble-icon";
    icon.setAttribute("aria-hidden", "true");
    const copy = doc.createElement("span");
    copy.className = "bubble-copy";
    const title = doc.createElement("span");
    title.className = "bubble-title";
    const detail = doc.createElement("span");
    detail.className = "bubble-detail";
    const dots = doc.createElement("span");
    dots.className = "typing-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) dots.appendChild(doc.createElement("i"));
    copy.append(title, detail);
    bubble.append(icon, copy, dots);
    bubbleParts.set(bubble, { icon, title, detail, dots });
    return update(bubble, row);
  }

  function update(bubble, row) {
    const parts = bubbleParts.get(bubble) || {
      icon: bubble.querySelector(".bubble-icon"),
      title: bubble.querySelector(".bubble-title"),
      detail: bubble.querySelector(".bubble-detail"),
      dots: bubble.querySelector(".typing-dots")
    };
    const value = content(row);
    bubble.dataset.state = value.state;
    for (const key of ["icon", "title", "detail"]) {
      if (parts[key].textContent !== value[key]) parts[key].textContent = value[key];
    }
    parts.dots.hidden = value.state !== "working";
    bubble.title = [value.title, value.detail].filter(Boolean).join(" — ");
    return bubble;
  }

  const WorkstationState = Object.freeze({ resolve, label: state => labels[state] || labels.idle, thresholds });
  const StatusBubble = Object.freeze({ content, create, update });
  root.WorkstationState = WorkstationState;
  root.StatusBubble = StatusBubble;
  if (typeof module !== "undefined" && module.exports) module.exports = { WorkstationState, StatusBubble };
})(typeof window !== "undefined" ? window : globalThis);
