/* ============================================================
   WABA Agents — setiap nomor WABA = satu AI agent
   Agent View: kartu per agent (status, task, event stream, error)
   Flow View: Sankey ala konsep awal
   ============================================================ */

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
      if (cfg && Array.isArray(cfg.services) && cfg.services.length) return cfg;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
function saveConfig(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }

let config = loadConfig();
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
const STATUSES = ["ACTIVE", "ACTIVE", "IDLE", "DONE"];

function taskFor(seed, r) {
  return TASKS[Math.floor(r() * TASKS.length)];
}

/* ---------- Telemetry: satu baris = satu agent (service + number) ---------- */
function fetchTelemetry() {
  tick++;
  const rows = [];
  for (const svc of config.services) {
    for (const num of svc.numbers) {
      const id = svc.name + "|" + num;
      const base = (hashStr(id) % 18000) + 400;
      const jitter = (Math.sin(tick * 0.7 + (hashStr(num) % 7)) + 1) * 0.35 + 0.6;
      const total = Math.max(1, Math.round(base * jitter));

      // error rate: kebanyakan sehat, beberapa agent error (1-3%), sesekali spike
      const errBase = (hashStr(id + "|err") % 100) / 100;
      let errRate = Math.min(0.25, Math.max(0.0005, errBase * 0.015));
      if (errRate > 0.008 && (hashStr(num) % 5) === 0) {
        errRate += Math.max(0, Math.sin(tick * 0.5 + (hashStr(num) % 13)) * 0.03);
      }
      const errors = Math.max(0, Math.round(total * errRate));
      const success = total - errors;

      const latencyBase = 0.4 + (hashStr(id + "|lat") % 200) / 100; // 0.4 - 2.4 s
      const latency = +(latencyBase + (rng(hashStr(id) + tick)() - 0.5) * 0.3).toFixed(2);

      // status: error -> ERROR, active jika ada traffic, else IDLE
      const rnd = rng(hashStr(id) + tick * 7919);
      let status;
      if (errors > 0 && errRate > 0.05) status = "ERROR";
      else if (rnd() < 0.55) status = "ACTIVE";
      else if (rnd() < 0.8) status = "IDLE";
      else status = "DONE";

      rows.push({
        id, service: svc.name, number: num,
        role: "Inbound + Outbound",
        status,
        total, success, errors, errRate: errors / total,
        latency,
        task: status === "IDLE" ? null : taskFor(id, rng(hashStr(id) + tick)),
        lastError: errors > 0 ? `ERROR_${1000 + (hashStr(id + "|err") % 900)}: timeout menunggu respons Meta (HTTP 500)` : null
      });
    }
  }

  // Pastikan ada 3 agent ERROR tiap siklus (bergilir) — biar kandang merah
  // + bubble hewan panik selalu terlihat, seperti alert nyata.
  const total = rows.length;
  for (let k = 0; k < 3; k++) {
    const idx = (tick * 3 + k * 5) % total;
    const rr = rows[idx];
    rr.status = "ERROR";
    rr.errRate = 0.08 + (hashStr(rr.id + "|spike") % 60) / 1000; // 8-14%
    rr.errors = Math.max(3, Math.round(rr.total * rr.errRate));
    rr.success = rr.total - rr.errors;
    rr.lastError = `ERROR_${1000 + (hashStr(rr.id + "|err") % 900)}: timeout menunggu respons Meta (HTTP 500)`;
    rr.task = "Mencoba kirim ulang pesan gagal… (retry)";
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
  if (r.status === "IDLE") {
    evs.push({ t: t(), m: "Menunggu pesan masuk… (idle)", k: "info" });
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
function cssId(s) { return s.replace(/[^a-zA-Z0-9]/g, "_"); }
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
  const total = rows.reduce((s, r) => s + r.total, 0);
  const err = rows.reduce((s, r) => s + r.errors, 0);
  const rate = total ? err / total : 0;
  const active = rows.filter(r => r.status === "ACTIVE").length;
  const idle = rows.filter(r => r.status === "IDLE").length;
  const errAgents = rows.filter(r => r.status === "ERROR").length;
  const avgLat = (rows.reduce((s, r) => s + r.latency, 0) / rows.length).toFixed(2);

  document.getElementById("kpis").innerHTML = `
    <div class="kpi"><div class="label">Agent Aktif</div><div class="value">${active}<span style="font-size:14px;color:var(--text-dim)">/${rows.length}</span></div><div class="sub">${idle} idle · ${errAgents} error</div></div>
    <div class="kpi"><div class="label">Total Pesan (siklus)</div><div class="value">${fmt(total)}</div><div class="sub">${rows.length} nomor</div></div>
    <div class="kpi ok"><div class="label">Success Rate</div><div class="value">${(100 - rate * 100).toFixed(3)}%</div><div class="sub">${fmt(total - err)} sukses</div></div>
    <div class="kpi ${rate > 0.01 ? "err" : ""}"><div class="label">Error Rate</div><div class="value">${(rate * 100).toFixed(3)}%</div><div class="sub">${fmt(err)} error</div></div>
    <div class="kpi"><div class="label">Latency Rata-rata</div><div class="value">${avgLat}s</div><div class="sub">per sesi</div></div>
  `;
}

function renderTable(rows) {
  const body = document.getElementById("numBody");
  body.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openAgentModal(r));
    tr.innerHTML = `
      <td style="font-size:18px">${animalFor(r.id)}</td>
      <td><b style="color:${numColor(r.number)}">${r.number}</b></td>
      <td>${r.service}</td>
      <td><span class="chip-mini ${r.status}">${r.status}</span></td>
      <td class="num">${fmt(r.total)}</td>
      <td class="num">${fmt(r.success)}</td>
      <td class="num">${fmt(r.errors)} <span class="pct">(${(r.errRate * 100).toFixed(2)}%)</span></td>
      <td class="num">${r.latency}s</td>
    `;
    body.appendChild(tr);
  }
}

/* ============================================================
   AGENT VIEW (kartu per agent)
   ============================================================ */
function renderAgentView(rows) {
  const grid = document.getElementById("agentView");
  grid.innerHTML = "";
  for (const r of rows) {
    const evs = eventsFor(r);
    const card = document.createElement("div");
    card.className = `agent-card status-${r.status.toLowerCase()}`;
    card.addEventListener("click", () => openAgentModal(r));
    card.innerHTML = `
      <div class="agent-head">
        <div class="agent-avatar" style="background:${avatarGradient(r.number)}">🤖</div>
        <div class="agent-title">
          <h3>${r.number} — ${r.role}</h3>
          <p>${r.service}</p>
        </div>
        <span class="status-chip ${r.status}">${r.status}</span>
      </div>
      <div class="agent-body">
        <div class="current-task">
          <div class="task-label">${r.status === "IDLE" ? "Status" : "Sedang dikerjakan"}</div>
          <div class="task-text ${r.status === "IDLE" ? "idle" : ""}">${r.task || "Menunggu tugas baru…"}</div>
        </div>
        <div class="agent-stats">
          <div class="stat"><div class="v">${fmt(r.total)}</div><div class="l">Pesan</div></div>
          <div class="stat"><div class="v green">${(100 - r.errRate * 100).toFixed(2)}%</div><div class="l">Sukses</div></div>
          <div class="stat"><div class="v ${r.errors > 0 ? "red" : ""}">${fmt(r.errors)}</div><div class="l">Error</div></div>
          <div class="stat"><div class="v">${r.latency}s</div><div class="l">Latency</div></div>
        </div>
        <div class="agent-events">
          <div class="events-label">Live log</div>
          ${evs.map(e => `<div class="ev ${e.k}"><span class="t">${e.t}</span><span class="m">${e.m}</span></div>`).join("")}
        </div>
      </div>
      <div class="agent-foot">
        <span>👀 klik untuk detail session</span>
        <span class="err-flag">${r.errors > 0 ? "⚠ " + r.errors + " error" : "✓ sehat"}</span>
      </div>
    `;
    grid.appendChild(card);
  }
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
  const X = { src: 70, mid: W * 0.42, out: W - 70 };
  const nodeW = 150, nodeH = 46;

  // number nodes right
  const nums = svc.numbers;
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
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head"><h2>WABA · ${svc.name}</h2><div class="badges" id="badges-${cssId(svc.name)}"></div></div>
      <div class="canvas-wrap"><canvas id="canvas-${cssId(svc.name)}"></canvas></div>
    `;
    cards.appendChild(card);
    const canvas = card.querySelector("canvas");
    canvas.width = 1100 * 2; canvas.height = 560 * 2;
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

    const svcRows = rows.filter(r => r.service === svc.name);
    const errRate = svcRows.reduce((s, r) => s + r.errors, 0) / Math.max(1, svcRows.reduce((s, r) => s + r.total, 0));
    const cls = errRate >= 0.05 ? "err" : errRate >= 0.01 ? "warn" : "ok";
    document.getElementById("badges-" + cssId(svc.name)).innerHTML =
      `<span class="badge ${cls}">${cls.toUpperCase()}</span><span class="badge">error ${(errRate * 100).toFixed(2)}%</span>`;
  }
}

/* ---------- Farm animals ---------- */
const ANIMALS = ["🐄", "🐐", "🐔", "🐑", "🐖", "🐓", "🐇", "🦆", "🐎", "🦙"];
function animalFor(seedStr) { return ANIMALS[hashStr(seedStr) % ANIMALS.length]; }

/* ============================================================
   FARM VIEW (default) — setiap nomor = kandang + hewan
   ============================================================ */
function renderFarmView(rows) {
  const grid = document.getElementById("farmView");
  grid.innerHTML = "";

  // Kamar besar per service — hewan langsung di dalamnya (1 hewan = 1 nomor)
  for (const svc of config.services) {
    const svcRows = rows.filter(r => r.service === svc.name);
    if (!svcRows.length) continue;

    const barn = document.createElement("div");
    const svcErrRate = svcRows.reduce((s, r) => s + r.errors, 0) /
                       Math.max(1, svcRows.reduce((s, r) => s + r.total, 0));
    const svcHasError = svcRows.some(r => r.status === "ERROR");
    barn.className = "barn" + (svcHasError ? " barn-err" : svcErrRate > 0.01 ? " barn-warn" : "");

    const svcTotal = svcRows.reduce((s, r) => s + r.total, 0);
    const svcErr = svcRows.reduce((s, r) => s + r.errors, 0);

    barn.innerHTML = `
      <div class="barn-head">
        <span class="barn-icon">🏠</span>
        <div class="barn-title">
          <h2>${svc.name}</h2>
          <p>WABA ${svc.name} · ${svc.numbers.length} hewan</p>
        </div>
        <div class="barn-stats">
          <div class="bstat"><div class="v">${fmt(svcTotal)}</div><div class="l">Pesan</div></div>
          <div class="bstat"><div class="v green">${(100 - svcErrRate * 100).toFixed(2)}%</div><div class="l">Sukses</div></div>
          <div class="bstat"><div class="v ${svcErr ? "red" : ""}">${fmt(svcErr)}</div><div class="l">Error</div></div>
        </div>
      </div>
      <div class="pasture">
        <div class="fence"></div>
        <div class="grass"></div>
        <div class="ground"></div>
        <div class="herd"></div>
      </div>
    `;
    grid.appendChild(barn);
    const herd = barn.querySelector(".herd");

    for (const r of svcRows) {
      const animal = animalFor(r.id);
      const isError = r.status === "ERROR";
      const isIdle = r.status === "IDLE";
      const isActive = r.status === "ACTIVE";

      const actionClass = isError ? "zombie" : isIdle ? "sleeping" : "eating";

      // pesan singkat untuk bubble chat kiri (inbound) & kanan (outbound)
      const msgIn = isError
        ? "❌ masuk gagal…"
        : isIdle
          ? "menunggu pesan…"
          : ["halo, cek order?", "butuh bantuan", "mau tanya produk", "gimana caranya?", "pesanan saya mana?"][hashStr(r.id + "|inmsg") % 5];
      const msgOut = isError
        ? "❌ keluar gagal…"
        : isIdle
          ? "tidak ada kiriman"
          : ["selamat datang!", "order kamu diproses ✅", "ini info promonya 🎉", "OTP kamu: 482913", "reminder besok ya!"][hashStr(r.id + "|outmsg") % 5];

      // bubble error (muncul dari hewan, bisa di-show/hide via tombol Bubble)
      let errPop = "";
      if (isError) {
        errPop = `
          <div class="error-pop">
            <div class="b-title">🐾 ${animal} LAPORAN</div>
            ${r.lastError || "Ada yang salah!"}<br/>
            ❌ ${r.errors} pesan gagal (${(r.errRate * 100).toFixed(2)}%)
          </div>`;
      } else if (r.errRate > 0.01) {
        errPop = `
          <div class="error-pop" style="border-color:var(--amber);background:#2a2414;color:#ffe0ae">
            <div class="b-title" style="color:var(--amber)">🐾 ${animal} CATATAN</div>
            ⚠ ${r.errors} error kecil — sudah diretry
          </div>`;
      }

      const zzz = isIdle ? `<div class="zztag">z Z z</div>` : "";

      const slot = document.createElement("div");
      slot.className = `herd-slot status-${r.status.toLowerCase()}`;
      slot.addEventListener("click", () => openAgentModal(r));
      slot.innerHTML = `
        <span class="animal-status ${r.status}">${r.status}</span>
        ${zzz}
        ${errPop}
        <div class="chat-in"><span class="ci">IN</span>${msgIn}</div>
        <div class="chat-out"><span class="ci">OUT</span>${msgOut}</div>
        <div class="animal ${actionClass}">${animal}</div>
        <span class="animal-tag">${r.number}</span>
        <div class="slot-stats">
          <span class="ss">${fmt(r.total)}</span>
          <span class="ss green">${(100 - r.errRate * 100).toFixed(1)}%</span>
          <span class="ss ${r.errors > 0 ? "red" : ""}">${fmt(r.errors)}✕</span>
          <span class="ss">${r.latency}s</span>
        </div>
      `;
      herd.appendChild(slot);
    }
  }
}

/* ---------- Tooltip ---------- */
const tooltip = document.getElementById("tooltip");
function showTooltip(e, r) {
  const pctOk = r.total ? (r.success / r.total) * 100 : 100;
  const pctErr = 100 - pctOk;
  tooltip.innerHTML = `
    <h4>🤖 ${r.number} · ${r.role} <span style="color:var(--text-dim);font-weight:500">(${r.status})</span></h4>
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
  const rows = fetchTelemetry();
  const fresh = rows.find(x => x.id === r.id) || r;
  document.getElementById("amTitle").textContent = `🤖 Agent ${fresh.number} — ${fresh.role}`;
  document.getElementById("amStats").innerHTML = `
    <div class="stat"><div class="v" style="color:${numColor(fresh.number)}">${fresh.number}</div><div class="l">Agent</div></div>
    <div class="stat"><div class="v">${fresh.service}</div><div class="l">Service</div></div>
    <div class="stat"><div class="v">${fresh.status}</div><div class="l">Status</div></div>
    <div class="stat"><div class="v">${fmt(fresh.total)}</div><div class="l">Pesan</div></div>
    <div class="stat"><div class="v ${fresh.errors ? "red" : "green"}">${fmt(fresh.errors)} error</div><div class="l">${(fresh.errRate * 100).toFixed(2)}%</div></div>
    <div class="stat"><div class="v">${fresh.latency}s</div><div class="l">Latency</div></div>
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
          <span class="span-dur">${s.dur}ms</span>
        </div>
        <div class="timeline-bar" style="margin-left:${left}%;width:${w}%">
          <div class="seg ${s.kind}"></div>
        </div>
        ${errBox}${okBox}
      </div>`;
  }).join("");
  document.getElementById("amEvents").innerHTML =
    eventsFor(fresh).map(e => `<div class="ev ${e.k}"><span class="t">${e.t}</span><span class="m">${e.m}</span></div>`).join("");
  document.getElementById("agentModal").classList.remove("hidden");
}

document.getElementById("amClose").addEventListener("click", () =>
  document.getElementById("agentModal").classList.add("hidden"));

/* ---------- View switch ---------- */
const viewFarm = document.getElementById("viewFarm");
const viewAgents = document.getElementById("viewAgents");
const viewFlow = document.getElementById("viewFlow");
const farmView = document.getElementById("farmView");
const agentView = document.getElementById("agentView");
const flowView = document.getElementById("flowView");

function switchView(which) {
  viewFarm.classList.toggle("active", which === "farm");
  viewAgents.classList.toggle("active", which === "agents");
  viewFlow.classList.toggle("active", which === "flow");
  farmView.classList.toggle("hidden", which !== "farm");
  agentView.classList.toggle("hidden", which !== "agents");
  flowView.classList.toggle("hidden", which !== "flow");
}
viewFarm.addEventListener("click", () => switchView("farm"));
viewAgents.addEventListener("click", () => switchView("agents"));
viewFlow.addEventListener("click", () => switchView("flow"));

/* ---------- Settings modal ---------- */
function renderCfgForms() {
  const wrap = document.getElementById("svcForms");
  wrap.innerHTML = "";
  config.services.forEach((svc, i) => {
    const div = document.createElement("div");
    div.className = "svc-row";
    div.innerHTML = `
      <label>Nama Service</label>
      <input data-idx="${i}" data-field="name" value="${svc.name}" />
      <label>Nomor WABA — setiap nomor jadi 1 agent (pisahkan koma)</label>
      <input data-idx="${i}" data-field="numbers" value="${svc.numbers.join(", ")}" />
      <div style="text-align:right;margin-top:8px"><button class="btn ghost" data-del="${i}">🗑 Hapus</button></div>
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = +e.target.dataset.idx;
      const field = e.target.dataset.field;
      if (field === "numbers") config.services[idx].numbers = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
      else config.services[idx].name = e.target.value;
    });
  });
  wrap.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => { config.services.splice(+btn.dataset.del, 1); renderCfgForms(); });
  });
}
document.getElementById("settingsBtn").addEventListener("click", () => {
  renderCfgForms();
  document.getElementById("settingsModal").classList.remove("hidden");
});
document.getElementById("closeCfg").addEventListener("click", () =>
  document.getElementById("settingsModal").classList.add("hidden"));
document.getElementById("addSvc").addEventListener("click", () => {
  config.services.push({ name: "SVC BARU", numbers: ["08xx"] });
  renderCfgForms();
});
document.getElementById("saveCfg").addEventListener("click", () => {
  saveConfig(config);
  document.getElementById("settingsModal").classList.add("hidden");
  render();
});
document.getElementById("resetCfg").addEventListener("click", () => {
  config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  renderCfgForms();
});

/* ---------- Live ---------- */
document.getElementById("liveBtn").addEventListener("click", () => {
  live = !live;
  document.getElementById("liveBtn").classList.toggle("active", live);
  document.getElementById("liveBtn").textContent = live ? "⏸ Pause" : "▶ Live";
});

/* Toggle bubble error & chat (show/hide) */
const bubbleBtn = document.getElementById("bubbleBtn");
bubbleBtn.addEventListener("click", () => {
  const show = bubbleBtn.classList.toggle("active");
  bubbleBtn.textContent = show ? "💬 Bubble" : "💬 Bubble Off";
  document.getElementById("farmView").classList.toggle("bubbles-hidden", !show);
});
document.getElementById("refreshBtn").addEventListener("click", render);
setInterval(() => { if (live) render(); }, 5000);

/* ---------- Main ---------- */
function render() {
  const rows = fetchTelemetry();
  renderKPIs(rows);
  renderTable(rows);
  renderFarmView(rows);
  renderAgentView(rows);
  renderFlowView(rows);
  document.getElementById("updated").textContent = "Update: " + new Date().toLocaleTimeString("id-ID");
}
render();
