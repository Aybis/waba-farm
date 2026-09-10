/* WABA Workstation — telemetry, filters, sessions and workspace controls. */

/* ---------- Config ---------- */
const STORAGE_KEY = "waba-monitor-config-v2";
const DEFAULT_CONFIG = {
  services: [
    { name: "TSO - AWO", numbers: ["0815", "0816", "0817", "0818", "0819", "0820"] },
    { name: "DSO - AWO", numbers: ["0815", "0816", "0817", "0818", "0819", "0820"] }
  ]
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (validConfig(cfg)) return cfg;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
function saveConfig(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }

function validConfig(cfg) {
  return cfg && Array.isArray(cfg.services) && cfg.services.length > 0 &&
    cfg.services.every(svc => typeof svc.name === "string" && svc.name.trim() &&
      Array.isArray(svc.numbers) && svc.numbers.length > 0 &&
      svc.numbers.every(n => typeof n === "string" && n.trim()) &&
      new Set(svc.numbers).size === svc.numbers.length) &&
    new Set(cfg.services.map(svc => svc.name)).size === cfg.services.length;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let config = loadConfig();
let draftConfig;
let latestRows = [];
let currentView = "workstations";
let selectedService = "";
let selectedState = "";
let searchQuery = "";
let modalTrigger = null;
const resolveState = row => WorkstationState.resolve(row);
const stateLabel = state => WorkstationState.label(state);
function stateChip(row) {
  const state = resolveState(row);
  return `<span class="state-chip" data-state="${state}"><i class="state-dot"></i>${stateLabel(state)}</span>`;
}
let live = true;
let tick = 0;

/* ---------- Deterministic pseudo-random ---------- */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function rng(seed) {
  let s = seed || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Agent roles & tasks ---------- */
const TASKS = [
  "Membaca pesan masuk & klasifikasi intent",
  "Ekstrak entitas (nama, tanggal, jumlah)",
  "Menjawab customer dengan template",
  "Meneruskan ke CSO bila di luar scope",
  "Update CRM & catat percakapan",
  "Mengirim notifikasi / reminder ke customer",
  "Broadcast promo tersegmentasi",
  "Follow-up pembayaran / invoice",
  "Konfirmasi jadwal & pengingat",
  "Kirim OTP / verifikasi"
];

function taskFor(seed, r) {
  return TASKS[Math.floor(r() * TASKS.length)];
}

/* ---------- Profil kesehatan per nomor (STABIL, bukan acak tiap detik) ----------
   OK     = sukses terus (hijau)
   WARN   = warning kuning  -> error INBOUND
   ERROR  = error merah     -> error OUTBOUND
   SERVER = error di server (webhook/meta tidak merespon)
-------------------------------------------------------------------------- */
function healthProfile(id, idx) {
  // 1 nomor SERVER per service (deterministik: nomor ke-4), sisanya tersebar
  if (idx === 3) return "SERVER";
  const h = hashStr(id);
  if (h % 23 === 5) return "SERVER";
  const r = h % 10;
  if (r < 5) return "OK";
  if (r < 8) return "WARN";
  return "ERROR";
}
function errMessage(health, id) {
  const code = 1000 + (hashStr(id + "|err") % 900);
  if (health === "WARN")   return "Warn: High Latency — buffer pesan menumpuk";
  if (health === "SERVER") return `SERVER_${code}: Meta server tidak merespon — cek webhook`;
  return `ERROR_OUT_${code}: pesan KELUAR gagal terkirim (Meta API HTTP 500)`;
}

/* ---------- Telemetry: satu baris = satu agent (service + number) ---------- */
function fetchTelemetry() {
  tick++;
  const rows = [];
  for (const svc of config.services) {
    for (const num of svc.numbers) {
      const id = svc.name + "|" + num;
      const health = healthProfile(id, svc.numbers.indexOf(num));

      const base = (hashStr(id) % 18000) + 400;
      const jitter = (Math.sin(tick * 0.3 + (hashStr(num) % 7)) + 1) * 0.25 + 0.75;
      const total = Math.max(1, Math.round(base * jitter));

      // error rate stabil sesuai profil nomor
      let errRate;
      if (health === "SERVER")     errRate = 0.25 + (hashStr(id + "|s") % 30) / 1000;
      else if (health === "ERROR") errRate = 0.08 + (hashStr(id + "|e") % 50) / 1000;
      else if (health === "WARN")  errRate = 0.02 + (hashStr(id + "|w") % 20) / 1000;
      else                         errRate = (hashStr(id + "|o") % 3) / 10000;
      const errors = health === "OK" ? 0 : Math.max(1, Math.round(total * errRate));
      const success = total - errors;

      const latencyBase = (health === "WARN" ? 2.8 : 0.4) + (hashStr(id + "|lat") % 180) / 100;
      const latency = +(latencyBase + (rng(hashStr(id) + tick)() - 0.5) * 0.3).toFixed(2);

      // Aktivitas legacy dipetakan ke empat state oleh WorkstationState.
      const rnd = rng(hashStr(id) + tick * 7919);
      let status;
      if (health === "OK") {
        const r2 = rnd();
        status = r2 < 0.6 ? "ACTIVE" : r2 < 0.85 ? "IDLE" : "DONE";
      } else if (health === "WARN") {
        status = rnd() < 0.5 ? "ACTIVE" : "IDLE";
      } else {
        status = "ERROR";
      }

      rows.push({
        id, service: svc.name, number: num, workstationIndex: svc.numbers.indexOf(num) + 1,
        role: "Inbound + Outbound",
        health, status,
        total, success, errors, errRate: errors / total,
        latency,
        queueDepth: health === "WARN" ? 55 + hashStr(id) % 45 : status === "ACTIVE" ? 1 + hashStr(id + tick) % 18 : 0,
        errType: health === "SERVER" ? "SERVER" : health === "WARN" ? "INBOUND" : health === "ERROR" ? "OUTBOUND" : null,
        task: status === "IDLE" ? null : taskFor(id, rng(hashStr(id) + tick)),
        lastError: health !== "OK" ? errMessage(health, id) : null
      });
    }
  }
  return rows;
}

/* ---------- Event stream (log per agent) ---------- */
function eventsFor(r) {
  const rnd = rng(hashStr(r.id) + tick * 31);
  const t = () => {
    const d = new Date(Date.now() - Math.floor(rnd() * 55000));
    return d.toLocaleTimeString("id-ID", { hour12: false });
  };
  const evs = [];
  evs.push({ t: t(), m: `Agent "${r.number} ${r.role}" mulai sesi`, k: "info" });
  const state = resolveState(r);
  if (state === "idle") {
    evs.push({ t: t(), m: "Standby — operator istirahat, tidak ada antrean", k: "info" });
  } else if (state === "warning") {
    evs.push({ t: t(), m: `Peringatan — antrean ${r.queueDepth ?? "tidak tersedia"}, latency ${r.latency}s`, k: "warn" });
    if (r.lastError) evs.push({ t: t(), m: r.lastError, k: "warn" });
  } else if (state === "error") {
    evs.push({ t: t(), m: r.lastError || "Koneksi atau proses pengiriman gagal", k: "err" });
    evs.push({ t: t(), m: `${r.errors} pesan gagal — periksa koneksi dan kredensial`, k: "err" });
  } else {
    evs.push({ t: t(), m: `Terima pesan → pilih template (${r.total} pesan siklus ini)`, k: "ok" });
    if (r.errors > 0) {
      evs.push({ t: t(), m: `LLM call gagal — ${r.errors} error (${(r.errRate * 100).toFixed(2)}%)`, k: "err" });
      evs.push({ t: t(), m: "Retry otomatis 2x → fallback template default", k: "warn" });
    } else {
      evs.push({ t: t(), m: "Semua terkirim, tidak ada error", k: "ok" });
    }
  }
  evs.push({ t: t(), m: `Latency rata-rata ${r.latency}s`, k: "info" });
  return evs;
}

/* ---------- Session spans (waterfall ala AgentOps) ---------- */
function spansFor(r) {
  const rnd = rng(hashStr(r.id) + tick * 17);
  const base = Date.now() - 90000;
  let cursor = base;
  const mk = (name, dur, kind, extra) => {
    const s = cursor; cursor += dur;
    return { name, start: s, dur, kind, extra };
  };
  const spans = [
    mk("receive_message", 300 + rnd() * 400, "ok"),
    mk("llm.intent_classify", 900 + rnd() * 1200, r.errors > 0 && rnd() < 0.5 ? "err" : "ok",
       r.errors > 0 ? `model=meta-llm · status=timeout · retry=1` : "model=gemini-flash · topIntent=ORDER_STATUS"),
    mk("tool.get_crm_context", 400 + rnd() * 500, "ok"),
    mk("llm.generate_reply", 1100 + rnd() * 1400, "ok", "template=approved · tokens=182"),
    mk("tool.send_whatsapp", 600 + rnd() * 900, r.errors > 0 && rnd() < 0.4 ? "err" : "ok",
       r.errors > 0 ? `Meta API 500 → retry → fallback OK (${r.errors} msg gagal)` : "delivered=OK"),
    mk("log_analytics", 150 + rnd() * 200, "ok")
  ];
  return spans;
}

/* ---------- UI helpers ---------- */
function fmt(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
}
function numColor(num) {
  const colors = ["#8b5cf6", "#38bdf8", "#2dd4bf", "#fb923c", "#facc15", "#f43f5e", "#a3e635", "#22d3ee"];
  return colors[hashStr(num) % colors.length];
}
function avatarGradient(num) {
  const c = numColor(num);
  return `linear-gradient(135deg, ${c}, ${c}88)`;
}

/* ============================================================
   KPI + Table
   ============================================================ */
function renderKPIs(rows) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const errors = rows.reduce((sum, row) => sum + row.errors, 0);
  const working = rows.filter(row => resolveState(row) === "working").length;
  const idle = rows.filter(row => resolveState(row) === "idle").length;
  const avgLatency = rows.length ? (rows.reduce((sum, row) => sum + row.latency, 0) / rows.length).toFixed(2) : "—";
  document.getElementById("kpis").innerHTML = `
    <div class="kpi"><div class="label">Workstations <span class="kpi-icon">▦</span></div><div class="value">${rows.length}<span class="unit"> nomor</span></div><div class="sub"><span class="positive">${working} working</span> · ${idle} standby</div></div>
    <div class="kpi"><div class="label">Total pesan <span class="kpi-icon">▱</span></div><div class="value">${fmt(total)}</div><div class="sub">Dalam siklus saat ini</div></div>
    <div class="kpi ok"><div class="label">Success rate <span class="kpi-icon">↗</span></div><div class="value">${total ? ((total - errors) / total * 100).toFixed(2) : "—"}<span class="unit">${total ? "%" : ""}</span></div><div class="sub"><span class="positive">${fmt(total - errors)} pesan berhasil</span></div></div>
    <div class="kpi ${errors ? "err" : ""}"><div class="label">Error count <span class="kpi-icon">⊗</span></div><div class="value">${fmt(errors)}</div><div class="sub">${total ? (errors / total * 100).toFixed(2) : "0.00"}% dari total pesan</div></div>
    <div class="kpi"><div class="label">Avg. latency <span class="kpi-icon">◷</span></div><div class="value">${avgLatency}<span class="unit">${rows.length ? " s" : ""}</span></div><div class="sub">Rata-rata per sesi</div></div>`;
}

function renderTable(rows) {
  const body = document.getElementById("numBody");
  const fragment = document.createDocumentFragment();
  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="table-seat">PC ${String(row.workstationIndex).padStart(2, "0")}</span></td>
      <td><button class="table-number" aria-label="Detail nomor ${escapeHtml(row.number)} service ${escapeHtml(row.service)}">${escapeHtml(row.number)}</button></td>
      <td>${escapeHtml(row.service)}</td><td>${stateChip(row)}</td>
      <td class="num">${fmt(row.total)}</td>
      <td class="num">${row.total ? (row.success / row.total * 100).toFixed(2) + "%" : "—"}</td>
      <td class="num">${fmt(row.errors)} <span class="pct">(${(row.errRate * 100).toFixed(2)}%)</span></td>
      <td class="num">${row.latency}s</td>`;
    tr.addEventListener("click", () => openAgentModal(row));
    fragment.appendChild(tr);
  });
  body.replaceChildren(fragment);
  if (!rows.length) body.innerHTML = '<tr><td colspan="8" class="table-empty">Tidak ada nomor yang sesuai filter.</td></tr>';
}

/* ============================================================
   AGENT VIEW — chat antara INBOUND (kiri) & OUTBOUND (kanan)
   ============================================================ */
const IN_MSGS = [
  "halo, cek order?", "butuh bantuan", "mau tanya produk",
  "gimana caranya?", "pesanan saya mana?", "bisa kirim hari ini?",
  "terima kasih!", "berapa harganya?"
];
const OUT_MSGS = [
  "selamat datang!", "order kamu diproses ✅", "ini info promonya 🎉",
  "OTP kamu: 482913", "reminder besok ya!", "pesanan sudah dikirim 🚚",
  "sama-sama 😊", "harganya 250rb, ada diskon lho!"
];

function renderAgentView(rows) {
  const grid = document.getElementById("agentView");
  grid.innerHTML = "";

  for (const svc of config.services) {
    const svcRows = rows.filter(r => r.service === svc.name);
    if (!svcRows.length) continue;

    // satu "room" chat per service
    const room = document.createElement("div");
    room.className = "chat-room";
    room.innerHTML = `
      <div class="chat-room-head">
        <div class="room-title"><h2>${escapeHtml(svc.name)}</h2><p>Percakapan inbound ↔ outbound</p></div>
      </div>
      <div class="chat-grid"></div>
    `;
    grid.appendChild(room);
    const chatGrid = room.querySelector(".chat-grid");

    for (const r of svcRows) {
      const rnd = rng(hashStr(r.id) + tick * 7);
      const nIn = 2 + Math.floor(rnd() * 3);
      const nOut = 2 + Math.floor(rnd() * 3);

      const inBubbles = [];
      for (let i = 0; i < nIn; i++) {
        const err = (r.errType === "INBOUND" || r.errType === "SERVER") && i === nIn - 1;
        inBubbles.push(chatBubble("in", err ? "❌ pesan masuk gagal diproses" : IN_MSGS[Math.floor(rnd() * IN_MSGS.length)], err));
      }
      const outBubbles = [];
      for (let i = 0; i < nOut; i++) {
        const err = r.errType === "OUTBOUND" && i === nOut - 1;
        outBubbles.push(chatBubble("out", err ? "❌ pesan keluar gagal terkirim" : OUT_MSGS[Math.floor(rnd() * OUT_MSGS.length)], err));
      }

      const card = document.createElement("div");
      card.className = `agent-card status-${resolveState(r)}`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Detail ${r.number} · ${r.service}`);
      card.addEventListener("keydown", event => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openAgentModal(r); }
      });
      card.addEventListener("click", () => openAgentModal(r));
      card.innerHTML = `
        <div class="agent-head">
          <div class="agent-avatar" style="background:${avatarGradient(r.number)}">${escapeHtml(r.number.slice(-2))}</div>
          <div class="agent-title">
            <h3>${escapeHtml(r.number)}</h3>
            <p>${escapeHtml(r.service)}</p>
          </div>
          ${stateChip(r)}
        </div>
        <div class="chat-thread">
          ${inBubbles.join("")}
          ${outBubbles.join("")}
        </div>
        <div class="agent-foot">
          <span>${fmt(r.total)} pesan · ${(100 - r.errRate * 100).toFixed(1)}% sukses · ${r.latency}s</span>
          <span class="err-flag">${r.errors > 0 ? "⚠ " + fmt(r.errors) + " error" : "✓ sehat"}</span>
        </div>
      `;
      chatGrid.appendChild(card);
    }
  }
}

function chatBubble(side, text, isErr) {
  const time = new Date(Date.now() - Math.floor(Math.random() * 30000)).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `
    <div class="cb ${side} ${isErr ? "cb-err" : ""}">
      <div class="cb-msg">${escapeHtml(text)}</div>
      <div class="cb-time">${side === "in" ? "IN" : "OUT"} · ${time}</div>
    </div>`;
}

/* ============================================================
   FLOW VIEW (Sankey, konsep awal)
   ============================================================ */
const PALETTE = { success: "#1fa45a", error: "#d33d5c", agg: "#9b6bff" };

function drawSankey(canvas, svc, rows) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  for (let x = 4; x < W; x += 22) for (let y = 4; y < H; y += 22) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  const svcRows = rows.filter(r => r.service === svc.name);
  const X = { src: 40, mid: W * 0.47, out: W - 90 };
  const nodeW = 150, nodeH = 46;

  // number nodes right
  const nums = svcRows.map(row => row.number);
  const numY = [];
  const startY = 90;
  const gap = (H - 170 - nums.length * nodeH) / (nums.length + 1);
  nums.forEach((n, i) => { numY[i] = startY + (i + 1) * gap + i * nodeH + nodeH / 2; });
  const svcY = H / 2;

  // service node
  ctx.beginPath();
  ctx.roundRect(X.mid - nodeW / 2, svcY - nodeH / 2, nodeW, nodeH, 10);
  ctx.fillStyle = "#1a2335"; ctx.fill();
  ctx.strokeStyle = "#2a3a58"; ctx.stroke();
  ctx.fillStyle = "#e8edf5"; ctx.font = "600 14px system-ui";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(svc.name, X.mid, svcY);

  // number nodes
  nums.forEach((n, i) => {
    ctx.beginPath();
    ctx.roundRect(X.out - nodeW / 2, numY[i] - nodeH / 2, nodeW, nodeH, 10);
    ctx.fillStyle = "#1a2335"; ctx.fill();
    ctx.strokeStyle = numColor(n); ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = "#e8edf5";
    ctx.fillText(n, X.out, numY[i]);
  });

  // left lanes: success / error -> service node
  const svcTotal = svcRows.reduce((s, r) => s + r.total, 0) || 1;
  const svcErr = svcRows.reduce((s, r) => s + r.errors, 0);
  const lane = { y: svcY, vol: svcTotal, err: svcErr };

  const wOk = Math.max(4, (lane.vol - lane.err) / lane.vol * 46);
  const wErr = Math.max(2, lane.err / lane.vol * 46);
  const y = lane.y, startX = X.src + 110;
  ribbon(ctx, X.src, y - wOk / 2, startX, y - wOk / 2, wOk, PALETTE.success);
  ribbon(ctx, X.src, y + wOk / 2, startX, y + wOk / 2, wErr, PALETTE.error);
  ctx.fillStyle = "#9b6bff";
  ctx.beginPath(); ctx.arc(startX + 26, y, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "700 9px system-ui"; ctx.textAlign = "center";
  ctx.fillText("all", startX + 26, y);
  ribbon(ctx, startX + 36, y - 23, X.mid - nodeW / 2 - 20, svcY - 18, 46, PALETTE.agg);

  ctx.font = "500 11px system-ui"; ctx.textAlign = "left"; ctx.fillStyle = "#7d8ba1";
  ctx.fillText("success", X.src + 8, y - 26);
  ctx.fillText("error", X.src + 8, y + 26);

  const totalOut = svcRows.reduce((s, r) => s + r.total, 0) || 1;
  svcRows.forEach(r => {
    const i = nums.indexOf(r.number);
    if (i < 0) return;
    ribbon(ctx, X.mid + nodeW / 2, svcY, X.out - nodeW / 2 - 14, numY[i], Math.max(3, r.total / totalOut * 30), numColor(r.number));
  });

  // hover regions
  canvas._regions = [];
  svcRows.forEach(r => {
    const i = nums.indexOf(r.number);
    if (i < 0) return;
    canvas._regions.push({ x: X.out - nodeW / 2, y: numY[i] - nodeH / 2, w: nodeW, h: nodeH, data: r });
  });
}
function ribbon(ctx, x1, y1, x2, y2, w, color) {
  const grad = ctx.createLinearGradient(x1, 0, x2, 0);
  grad.addColorStop(0, color + "cc"); grad.addColorStop(1, color);
  ctx.strokeStyle = grad; ctx.lineWidth = w; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
  ctx.stroke();
}

function renderFlowView(rows) {
  const cards = document.getElementById("flowView");
  cards.innerHTML = "";
  for (const svc of config.services) {
    const svcRows = rows.filter(row => row.service === svc.name);
    if (!svcRows.length) continue;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head"><h2>WABA · ${escapeHtml(svc.name)}</h2><div class="badges"></div></div>
      <div class="canvas-wrap"><canvas aria-label="Alur pesan ${escapeHtml(svc.name)}" role="img"></canvas></div>
    `;
    cards.appendChild(card);
    const canvas = card.querySelector("canvas");
    canvas.width = 1100; canvas.height = Math.max(440, svcRows.length * 64 + 150);
    drawSankey(canvas, svc, rows);

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      let hit = null;
      for (const reg of canvas._regions) {
        if (mx >= reg.x && mx <= reg.x + reg.w && my >= reg.y && my <= reg.y + reg.h) { hit = reg.data; break; }
      }
      canvas.style.cursor = hit ? "pointer" : "default";
      hit ? showTooltip(e, hit) : hideTooltip();
    });
    canvas.addEventListener("mouseleave", hideTooltip);

    const errRate = svcRows.reduce((s, r) => s + r.errors, 0) / Math.max(1, svcRows.reduce((s, r) => s + r.total, 0));
    const cls = errRate >= 0.05 ? "err" : errRate >= 0.01 ? "warn" : "ok";
    card.querySelector(".badges").innerHTML =
      `<span class="badge ${cls}">${cls.toUpperCase()}</span><span class="badge">error ${(errRate * 100).toFixed(2)}%</span>`;
  }
}

/* ---------- Tooltip ---------- */
const tooltip = document.getElementById("tooltip");
function showTooltip(e, r) {
  const pctOk = r.total ? (r.success / r.total) * 100 : 100;
  const pctErr = 100 - pctOk;
  tooltip.innerHTML = `
    <h4>🤖 ${escapeHtml(r.number)} · ${escapeHtml(r.role)} <span style="color:var(--text-dim);font-weight:500">(${stateLabel(resolveState(r))})</span></h4>
    <div class="row"><span>Total</span><b>${fmt(r.total)}</b></div>
    <div class="row"><span>Sukses</span><b>${fmt(r.success)}</b></div>
    <div class="row"><span>Error</span><b style="color:var(--red)">${fmt(r.errors)}</b></div>
    <div class="bar"><div class="seg-ok" style="width:${pctOk}%"></div><div class="seg-err" style="width:${pctErr}%"></div></div>
    <div class="bar-label"><span>${pctOk.toFixed(2)}% success</span><span>${pctErr.toFixed(2)}% error</span></div>
  `;
  tooltip.classList.remove("hidden");
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > innerWidth - 8) x = e.clientX - rect.width - pad;
  if (y + rect.height > innerHeight - 8) y = e.clientY - rect.height - pad;
  tooltip.style.left = x + "px"; tooltip.style.top = y + "px";
}
function hideTooltip() { tooltip.classList.add("hidden"); }

/* ---------- Agent detail modal ---------- */
function openAgentModal(r) {
  const fresh = latestRows.find(x => x.id === r.id) || r;
  document.getElementById("amTitle").textContent = `Workstation ${fresh.number} — ${fresh.service}`;
  document.getElementById("amStats").innerHTML = `
    <div class="stat"><div class="v" style="color:${numColor(fresh.number)}">${escapeHtml(fresh.number)}</div><div class="l">Nomor WABA</div></div>
    <div class="stat"><div class="v">${escapeHtml(fresh.service)}</div><div class="l">Service</div></div>
    <div class="stat"><div class="v">${stateLabel(resolveState(fresh))}</div><div class="l">Status</div></div>
    <div class="stat"><div class="v">${fmt(fresh.total)}</div><div class="l">Pesan</div></div>
    <div class="stat"><div class="v ${fresh.errors ? "red" : "green"}">${fmt(fresh.errors)} error</div><div class="l">${(fresh.errRate * 100).toFixed(2)}%</div></div>
    <div class="stat"><div class="v">${fresh.latency}s</div><div class="l">Latency</div></div>
    <div class="stat"><div class="v">${fresh.queueDepth ?? "—"}</div><div class="l">Antrean pesan</div></div>
    <div class="stat"><div class="v">${fresh.total ? (fresh.success / fresh.total * 100).toFixed(2) + "%" : "—"}</div><div class="l">Success rate</div></div>
  `;
  const spans = spansFor(fresh);
  const spanMax = Math.max(...spans.map(s => s.start + s.dur));
  const spanMin = Math.min(...spans.map(s => s.start));
  document.getElementById("amSpans").innerHTML = spans.map(s => {
    const left = ((s.start - spanMin) / (spanMax - spanMin) * 100).toFixed(1);
    const w = (s.dur / (spanMax - spanMin) * 100).toFixed(1);
    const errBox = s.kind === "err" && s.extra ? `<div class="span-error">${s.extra}</div>` : "";
    const okBox = s.kind === "ok" && s.extra ? `<div class="span-ok">✓ ${s.extra}</div>` : "";
    return `
      <div class="span-item">
        <div class="span-head">
          <span class="s-name">${s.kind === "err" ? "❌" : "✓"} ${s.name}</span>
          <span class="span-dur">${Math.round(s.dur)}ms</span>
        </div>
        <div class="timeline-bar" style="margin-left:${left}%;width:${w}%">
          <div class="seg ${s.kind}"></div>
        </div>
        ${errBox}${okBox}
      </div>`;
  }).join("");
  document.getElementById("amEvents").innerHTML =
    eventsFor(fresh).map(e => `<div class="ev ${e.k}"><span class="t">${e.t}</span><span class="m">${escapeHtml(e.m)}</span></div>`).join("");
  openModal("agentModal", "amClose");
}

/* ---------- Dialogs: cancelable draft, focus return and keyboard access ---------- */
function openModal(id, focusId) {
  modalTrigger = document.activeElement;
  document.getElementById(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
  document.getElementById(focusId).focus();
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  document.body.style.overflow = "";
  if (modalTrigger?.isConnected) modalTrigger.focus();
}
document.getElementById("amClose").addEventListener("click", () => closeModal("agentModal"));
for (const id of ["agentModal", "settingsModal"]) {
  const modal = document.getElementById(id);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(id); });
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") { closeModal(id); return; }
    if (event.key !== "Tab") return;
    const items = [...modal.querySelectorAll('button, input, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}

/* ---------- Views and filters always share one telemetry snapshot ---------- */
function switchView(which) {
  currentView = which;
  for (const [name, buttonId, viewId] of [["workstations", "viewWorkstations", "workstationView"], ["agents", "viewAgents", "agentView"], ["flow", "viewFlow", "flowView"]]) {
    document.getElementById(buttonId).classList.toggle("active", name === which);
    document.getElementById(buttonId).setAttribute("aria-pressed", String(name === which));
    document.getElementById(viewId).classList.toggle("hidden", name !== which);
  }
  document.getElementById("pageName").textContent = { workstations: "Workstations", agents: "Agent View", flow: "Traffic Flow" }[which];
  hideTooltip();
  renderDashboard();
}
document.getElementById("viewWorkstations").addEventListener("click", () => switchView("workstations"));
document.getElementById("viewAgents").addEventListener("click", () => switchView("agents"));
document.getElementById("viewFlow").addEventListener("click", () => switchView("flow"));

function renderServiceControls() {
  const filter = document.getElementById("serviceFilter");
  const nav = document.getElementById("serviceNav");
  filter.replaceChildren(new Option("Semua service", ""));
  nav.replaceChildren();
  for (const svc of config.services) {
    filter.appendChild(new Option(svc.name, svc.name));
    const button = document.createElement("button");
    button.className = "service-link";
    button.dataset.service = svc.name;
    button.innerHTML = `<span class="service-dot"></span><span>${escapeHtml(svc.name)}</span><small>${svc.numbers.length}</small>`;
    button.addEventListener("click", () => selectService(selectedService === svc.name ? "" : svc.name));
    nav.appendChild(button);
  }
  document.getElementById("serviceCount").textContent = config.services.length;
  if (!config.services.some(svc => svc.name === selectedService)) selectedService = "";
  filter.value = selectedService;
}
function selectService(service) {
  selectedService = service;
  document.getElementById("serviceFilter").value = service;
  renderDashboard();
}
document.getElementById("serviceFilter").addEventListener("change", event => selectService(event.target.value));
document.getElementById("stateFilter").addEventListener("change", event => { selectedState = event.target.value; renderDashboard(); });
document.getElementById("searchInput").addEventListener("input", event => { searchQuery = event.target.value.trim().toLocaleLowerCase(); renderDashboard(); });
document.getElementById("clearFilters").addEventListener("click", () => {
  selectedService = selectedState = searchQuery = "";
  document.getElementById("searchInput").value = "";
  document.getElementById("stateFilter").value = "";
  document.getElementById("serviceFilter").value = "";
  renderDashboard();
});

/* ---------- Settings ---------- */
function renderCfgForms() {
  const wrap = document.getElementById("svcForms");
  wrap.replaceChildren();
  draftConfig.services.forEach((svc, i) => {
    const div = document.createElement("div");
    div.className = "svc-row";
    div.innerHTML = `
      <label for="svc-name-${i}">Nama service</label>
      <input id="svc-name-${i}" data-idx="${i}" data-field="name" value="${escapeHtml(svc.name)}" />
      <label for="svc-numbers-${i}">Nomor WABA (pisahkan dengan koma)</label>
      <input id="svc-numbers-${i}" data-idx="${i}" data-field="numbers" value="${escapeHtml(svc.numbers.join(", "))}" />
      <div style="text-align:right;margin-top:8px"><button class="btn ghost" data-del="${i}" aria-label="Hapus service ${escapeHtml(svc.name)}">Hapus service</button></div>`;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll("input").forEach(input => input.addEventListener("input", event => {
    const { idx, field } = event.target.dataset;
    draftConfig.services[idx][field] = field === "numbers" ? event.target.value.split(",").map(s => s.trim()).filter(Boolean) : event.target.value;
  }));
  wrap.querySelectorAll("[data-del]").forEach(button => button.addEventListener("click", () => {
    draftConfig.services.splice(Number(button.dataset.del), 1);
    renderCfgForms();
    document.getElementById("addSvc").focus();
  }));
}
function openSettings() {
  draftConfig = structuredClone(config);
  document.getElementById("configError").textContent = "";
  renderCfgForms();
  openModal("settingsModal", "svc-name-0");
}
document.getElementById("settingsBtn").addEventListener("click", openSettings);
const mobileSettings = document.createElement("button");
mobileSettings.className = "mobile-settings-button";
mobileSettings.textContent = "⚙ Konfigurasi";
mobileSettings.addEventListener("click", openSettings);
document.querySelector(".sidebar").appendChild(mobileSettings);
document.getElementById("closeCfg").addEventListener("click", () => closeModal("settingsModal"));
document.getElementById("addSvc").addEventListener("click", () => {
  draftConfig.services.push({ name: "Service baru", numbers: [] });
  renderCfgForms();
  document.getElementById(`svc-name-${draftConfig.services.length - 1}`).focus();
});
document.getElementById("saveCfg").addEventListener("click", () => {
  const next = { services: draftConfig.services.map(svc => ({ name: svc.name.trim(), numbers: [...new Set(svc.numbers)] })) };
  if (!validConfig(next)) {
    document.getElementById("configError").textContent = "Isi minimal satu service dengan nama unik dan minimal satu nomor WABA per service.";
    return;
  }
  try { saveConfig(next); }
  catch (_) { document.getElementById("configError").textContent = "Konfigurasi belum tersimpan. Penyimpanan browser tidak tersedia."; return; }
  config = next;
  closeModal("settingsModal");
  renderServiceControls();
  render();
});
document.getElementById("resetCfg").addEventListener("click", () => {
  draftConfig = structuredClone(DEFAULT_CONFIG);
  renderCfgForms();
});

/* ---------- Live telemetry and notification controls ---------- */
function syncMotion() {
  const paused = !live || document.hidden || currentView !== "workstations";
  document.body.classList.toggle("motion-paused", paused);
  Workstations.setPaused(paused);
}
document.getElementById("liveBtn").addEventListener("click", () => {
  live = !live;
  const button = document.getElementById("liveBtn");
  button.classList.toggle("active", live);
  button.setAttribute("aria-pressed", String(live));
  button.textContent = live ? "Ⅱ Live aktif" : "▷ Lanjutkan live";
  syncMotion();
});
const bubbleBtn = document.getElementById("bubbleBtn");
bubbleBtn.addEventListener("click", () => {
  const show = bubbleBtn.classList.toggle("active");
  bubbleBtn.setAttribute("aria-pressed", String(show));
  bubbleBtn.innerHTML = `<span aria-hidden="true">▱</span> Bubble ${show ? "on" : "off"}`;
  document.body.classList.toggle("bubbles-hidden", !show);
});
document.getElementById("refreshBtn").addEventListener("click", render);
document.addEventListener("visibilitychange", syncMotion);
setInterval(() => { if (live && !document.hidden) render(); }, 15000);

/* Render only the active visualization; keep workstation nodes across telemetry updates. */
function renderDashboard() {
  const rows = latestRows.filter(row => (!selectedService || row.service === selectedService) &&
    (!selectedState || resolveState(row) === selectedState) &&
    (!searchQuery || `${row.number} ${row.service}`.toLocaleLowerCase().includes(searchQuery)));
  renderKPIs(rows);
  renderTable(rows);
  document.getElementById("visibleCount").textContent = rows.length;
  document.getElementById("scopeLabel").textContent = selectedService || "Semua service";
  document.getElementById("emptyState").classList.toggle("hidden", rows.length > 0);
  document.querySelectorAll(".service-link").forEach(button => {
    button.classList.toggle("active", button.dataset.service === selectedService);
    button.setAttribute("aria-pressed", String(button.dataset.service === selectedService));
  });
  document.getElementById("stateLegend").innerHTML = ["working", "idle", "warning", "error"].map(state =>
    `<span class="legend-item" data-state="${state}"><i></i>${stateLabel(state)} <b>${rows.filter(row => resolveState(row) === state).length}</b></span>`).join("");
  if (currentView === "workstations") Workstations.render(document.getElementById("workstationView"), rows, { onSelect: openAgentModal, formatNumber: fmt });
  else if (currentView === "agents") renderAgentView(rows);
  else renderFlowView(rows);
  syncMotion();
}
function render() {
  latestRows = fetchTelemetry();
  renderDashboard();
  document.getElementById("updated").textContent = "Diperbarui " + new Date().toLocaleTimeString("id-ID");
}
renderServiceControls();
render();
