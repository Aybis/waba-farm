/* Pixel workstations: keyed DOM updates keep operators moving between data refreshes. */
(function () {
  "use strict";

  const views = new WeakMap();
  const wardrobe = ["#61bdba", "#9091d4", "#da9a65", "#769dd0", "#c17f98", "#a7b877"];
  const activity = {
    working: "PROCESSING TRAFFIC",
    idle: "AWAY FROM DESK",
    warning: "QUEUE NEEDS ATTENTION",
    error: "CONNECTION INTERRUPTED"
  };
  let manuallyPaused = false;
  let observer;

  const furniture = `
    <span class="ws-back-wall"></span><span class="ws-floor"></span>
    <span class="ws-wall-art"><i></i><i></i><i></i></span>
    <span class="ws-scene-code"></span>
    <span class="ws-divider ws-divider-left"></span><span class="ws-divider ws-divider-right"></span>
    <span class="ws-desk-shadow"></span>
    <span class="ws-desk"><i class="ws-desk-top"></i><i class="ws-desk-front"></i><i class="ws-desk-leg left"></i><i class="ws-desk-leg right"></i></span>
    <span class="ws-computer"><i class="ws-monitor"><i class="ws-monitor-screen"><i class="ws-screen-topline"></i><i class="ws-screen-code"><b></b><b></b><b></b><b></b></i><i class="ws-screen-saver"></i><i class="ws-screen-alert">!</i><i class="ws-screen-glitch"></i></i><i class="ws-monitor-led"></i></i><i class="ws-monitor-neck"></i><i class="ws-monitor-base"></i></span>
    <span class="ws-keyboard"></span><span class="ws-mouse"></span>
    <span class="ws-tower"><i></i><i></i><i></i></span>
    <span class="ws-cup"><i></i></span>
    <span class="ws-plant"><i class="ws-leaf one"></i><i class="ws-leaf two"></i><i class="ws-leaf three"></i><i class="ws-pot"></i></span>
    <span class="ws-chair"><i class="ws-chair-back"></i><i class="ws-chair-seat"></i><i class="ws-chair-stem"></i><i class="ws-chair-feet"></i></span>
    <span class="ws-operator"><i class="ws-operator-shadow"></i><i class="ws-person"><i class="ws-person-head"><i class="ws-person-hair"></i></i><i class="ws-person-neck"></i><i class="ws-person-shirt"></i><i class="ws-person-arm left"></i><i class="ws-person-arm right"></i><i class="ws-person-leg left"></i><i class="ws-person-leg right"></i><i class="ws-person-badge"></i></i><i class="ws-panic">!</i><i class="ws-worry">?</i></span>
    <span class="ws-pixel-smoke"><i></i><i></i><i></i></span>
    <span class="ws-scene-caption"><i></i><span></span></span>`;

  function hash(value) {
    let result = 0;
    for (const ch of String(value)) result = (Math.imul(result, 31) + ch.charCodeAt(0)) | 0;
    return result >>> 0;
  }

  function write(element, value) {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
  }

  function number(value) {
    return Number(value) || 0;
  }

  function percent(total, successes) {
    return total > 0 ? `${(successes / total * 100).toFixed(1)}%` : "—";
  }

  function getObserver() {
    if (!observer && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) entry.target.classList.toggle("ws-offscreen", !entry.isIntersecting);
      }, { rootMargin: "120px" });
    }
    return observer;
  }

  function createRoom(service) {
    const element = document.createElement("section");
    element.className = "office-room";
    element.innerHTML = `<header class="office-room-head"><div class="office-room-title"><span class="office-service-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div><h2></h2><p></p></div></div><div class="office-room-summary"><span><b class="office-total"></b> pesan</span><span><i class="office-summary-dot"></i><b class="office-success"></b> sukses</span><span class="office-error-summary"><b class="office-errors"></b> error</span></div></header><div class="office-workstation-grid"></div>`;
    write(element.querySelector("h2"), service);
    return {
      element,
      grid: element.querySelector(".office-workstation-grid"),
      subtitle: element.querySelector("p"),
      total: element.querySelector(".office-total"),
      success: element.querySelector(".office-success"),
      errors: element.querySelector(".office-errors"),
      cards: new Map()
    };
  }

  function createCard(row) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "workstation-card";
    card.innerHTML = `<span class="ws-card-head"><span class="ws-card-identity"><span class="ws-seat-label"></span><span class="ws-number"></span></span><span class="ws-state-badge"><i></i><span></span></span></span><span class="ws-bubble-slot"></span><span class="ws-scene" aria-hidden="true"><span class="ws-stage">${furniture}</span></span><span class="ws-metrics"><span><span class="ws-metric-value ws-messages"></span><span class="ws-metric-label">Total pesan</span></span><span><span class="ws-metric-value ws-success"></span><span class="ws-metric-label">Success rate</span></span><span><span class="ws-metric-value ws-errors"></span><span class="ws-metric-label">Error</span></span><span><span class="ws-metric-value ws-latency"></span><span class="ws-metric-label">Latency</span></span></span>`;
    const bubble = window.StatusBubble.create(row);
    card.querySelector(".ws-bubble-slot").append(bubble);
    const seed = hash(row.id);
    card.style.setProperty("--operator-shirt", wardrobe[seed % wardrobe.length]);
    card.style.setProperty("--operator-skin", seed % 3 === 0 ? "#c68d69" : seed % 3 === 1 ? "#e3af83" : "#ad735b");
    card.style.setProperty("--walk-delay", `-${seed % 140 / 10}s`);
    card.style.setProperty("--typing-delay", `-${seed % 10 / 10}s`);
    card.style.setProperty("--walk-duration", `${13 + seed % 6}s`);
    card.addEventListener("click", () => {
      if (typeof card._onSelect === "function") card._onSelect(card._row);
    });
    getObserver()?.observe(card);
    return {
      element: card,
      bubble,
      seat: card.querySelector(".ws-seat-label"),
      number: card.querySelector(".ws-number"),
      badge: card.querySelector(".ws-state-badge span"),
      code: card.querySelector(".ws-scene-code"),
      caption: card.querySelector(".ws-scene-caption span"),
      total: card.querySelector(".ws-messages"),
      success: card.querySelector(".ws-success"),
      errors: card.querySelector(".ws-errors"),
      latency: card.querySelector(".ws-latency")
    };
  }

  function updateCard(card, row, index, options, format) {
    const state = window.WorkstationState.resolve(row);
    const label = window.WorkstationState.label(state);
    const workstationIndex = row.workstationIndex || index + 1;
    const total = number(row.total);
    const successes = row.success == null ? Math.max(0, total - number(row.errors)) : number(row.success);
    card.element._row = row;
    card.element._onSelect = options.onSelect;
    if (card.element.dataset.state !== state) card.element.dataset.state = state;
    write(card.seat, `WORKSTATION ${String(workstationIndex).padStart(2, "0")}`);
    write(card.number, row.number);
    write(card.badge, label);
    write(card.code, `WS-${String(workstationIndex).padStart(2, "0")}`);
    write(card.caption, activity[state] || activity.idle);
    write(card.total, format(total));
    write(card.success, percent(total, successes));
    write(card.errors, format(number(row.errors)));
    write(card.latency, `${number(row.latency).toFixed(2)}s`);
    card.element.setAttribute("aria-label", `${row.service}, ${row.number}, ${label}. ${format(total)} pesan, ${percent(total, successes)} sukses, ${format(number(row.errors))} error, latency ${number(row.latency).toFixed(2)} detik. Buka detail workstation.`);
    window.StatusBubble.update(card.bubble, row);
  }

  function detachCard(card) {
    observer?.unobserve(card.element);
    card.element.remove();
  }

  function placeAt(parent, element, index) {
    const current = parent.children[index];
    if (current !== element) parent.insertBefore(element, current || null);
  }

  function render(container, rows, options = {}) {
    let view = views.get(container);
    if (!view) {
      view = { rooms: new Map() };
      views.set(container, view);
      container.classList.add("workstation-view");
    }
    const format = options.formatNumber || (value => new Intl.NumberFormat("id-ID").format(value));
    const groups = new Map();
    for (const row of rows) {
      const service = String(row.service || "WABA");
      if (!groups.has(service)) groups.set(service, []);
      groups.get(service).push(row);
    }
    for (const [service, room] of view.rooms) {
      if (groups.has(service)) continue;
      for (const card of room.cards.values()) detachCard(card);
      room.element.remove();
      view.rooms.delete(service);
    }
    if (!rows.length) return;
    let roomIndex = 0;
    for (const [service, members] of groups) {
      let room = view.rooms.get(service);
      if (!room) {
        room = createRoom(service);
        view.rooms.set(service, room);
      }
      placeAt(container, room.element, roomIndex++);
      const totals = members.reduce((sum, row) => {
        sum.total += number(row.total);
        sum.errors += number(row.errors);
        sum.success += row.success == null ? Math.max(0, number(row.total) - number(row.errors)) : number(row.success);
        return sum;
      }, { total: 0, success: 0, errors: 0 });
      write(room.subtitle, `OFFICE ZONE · ${members.length} workstation`);
      write(room.total, format(totals.total));
      write(room.success, percent(totals.total, totals.success));
      write(room.errors, format(totals.errors));
      const keys = new Set(members.map(row => String(row.id)));
      for (const [key, card] of room.cards) {
        if (keys.has(key)) continue;
        detachCard(card);
        room.cards.delete(key);
      }
      members.forEach((row, index) => {
        const key = String(row.id);
        let card = room.cards.get(key);
        if (!card) {
          card = createCard(row);
          room.cards.set(key, card);
        }
        updateCard(card, row, index, options, format);
        placeAt(room.grid, card.element, index);
      });
    }
  }

  function syncMotion() {
    document.documentElement.classList.toggle("workstations-paused", manuallyPaused || document.hidden);
  }

  document.addEventListener("visibilitychange", syncMotion);
  syncMotion();
  window.Workstations = {
    render,
    setPaused(paused) {
      manuallyPaused = Boolean(paused);
      syncMotion();
    }
  };
})();
