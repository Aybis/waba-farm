"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WorkstationState, StatusBubble } = require("./state.js");

test("current errors take priority over work, queue, and latency warnings", () => {
  for (const row of [{ health: "ERROR" }, { health: "SERVER" }, { status: "ERROR" }]) {
    assert.equal(WorkstationState.resolve({ status: "ACTIVE", queueDepth: 80, latency: 4, ...row }), "error");
  }
});

test("warnings take priority over active and idle statuses", () => {
  for (const status of ["ACTIVE", "IDLE", "DONE"]) {
    assert.equal(WorkstationState.resolve({ status, health: "WARN" }), "warning");
  }
  assert.equal(WorkstationState.resolve({ status: "warning", health: "OK" }), "warning");
});

test("latency warning starts at 2.5 seconds and queue warning starts above 50", () => {
  assert.equal(WorkstationState.resolve({ status: "ACTIVE", latency: 2.49, queueDepth: 50 }), "working");
  assert.equal(WorkstationState.resolve({ status: "IDLE", latency: 2.5 }), "warning");
  assert.equal(WorkstationState.resolve({ status: "ACTIVE", queueDepth: 51 }), "warning");
  assert.equal(WorkstationState.thresholds.latencySeconds, 2.5);
  assert.equal(WorkstationState.thresholds.queueDepth, 50);
});

test("ACTIVE and WORKING are case-insensitive; a pending queue activates an idle row", () => {
  for (const status of ["ACTIVE", "working", " Working "]) {
    assert.equal(WorkstationState.resolve({ status, health: "OK", queueDepth: 0 }), "working");
  }
  assert.equal(WorkstationState.resolve({ status: "IDLE", queueDepth: 1 }), "working");
});

test("IDLE, legacy DONE, and OFFLINE without a failure signal are idle", () => {
  for (const status of ["IDLE", "DONE", "OFFLINE"]) {
    assert.equal(WorkstationState.resolve({ status, health: "OK", queueDepth: 0 }), "idle");
  }
  assert.equal(WorkstationState.resolve(null), "idle");
  assert.equal(WorkstationState.resolve(), "idle");
});

test("historical error counts and messages do not mark healthy current traffic as failed", () => {
  const history = { errors: 82, lastError: "Meta API HTTP 500", health: "OK", latency: 1 };
  assert.equal(WorkstationState.resolve({ ...history, status: "IDLE" }), "idle");
  assert.equal(WorkstationState.resolve({ ...history, status: "ACTIVE" }), "working");
  assert.equal(StatusBubble.content({ ...history, status: "ACTIVE" }).title, "Memproses pesan");
  assert.equal(StatusBubble.content({ ...history, status: "ACTIVE", latency: 3 }).title, "Warn: High Latency");
});

test("absent or invalid metrics do not cause phantom queue or latency warnings", () => {
  for (const value of [undefined, null, "", NaN, Infinity, -1, true, "unknown"]) {
    assert.equal(WorkstationState.resolve({ status: "IDLE", queueDepth: value, latency: value }), "idle");
  }
  assert.equal(WorkstationState.resolve({ status: "IDLE", queueDepth: "51" }), "warning");
});

test("state labels provide consistent workstation wording", () => {
  assert.deepEqual(["working", "idle", "warning", "error"].map(WorkstationState.label), ["Working", "Standby", "Warning", "Error"]);
});

test("working bubbles retain a task or use the WABA number and idle bubbles describe roaming", () => {
  assert.equal(StatusBubble.content({ status: "ACTIVE", task: "Kirim OTP", number: "0815" }).detail, "Kirim OTP");
  assert.equal(StatusBubble.content({ status: "ACTIVE", number: "0815" }).detail, "Outbound #0815");
  assert.deepEqual(StatusBubble.content({ status: "DONE" }), {
    state: "idle", icon: "☕", title: "Standby", detail: "Operator sedang istirahat"
  });
});

test("warning bubbles report observed metrics, including a known zero queue", () => {
  assert.deepEqual(StatusBubble.content({ latency: 2.5, queueDepth: 0 }), {
    state: "warning", icon: "⚠", title: "Warn: High Latency", detail: "Queue 0 · Latency 2.5s"
  });
  assert.equal(StatusBubble.content({ queueDepth: 72 }).title, "Queue > 50");
  assert.equal(StatusBubble.content({ latency: 3 }).detail, "Latency 3s");
  assert.equal(StatusBubble.content({ health: "WARN" }).detail.includes("Queue"), false);
});

test("error messages distinguish actual HTTP 500, server outages, token expiry, and inbound timeout", () => {
  assert.equal(StatusBubble.content({ health: "ERROR", lastError: "ERROR_OUT_1222: Meta API HTTP 500" }).title, "Meta API 500");
  assert.equal(StatusBubble.content({ health: "ERROR", lastError: "HTTP 500: upstream unavailable" }).title, "HTTP 500");
  assert.equal(StatusBubble.content({ health: "SERVER" }).title, "Server / webhook bermasalah");
  assert.equal(StatusBubble.content({ health: "SERVER", lastError: "Token Expired" }).title, "Token Expired");
  assert.equal(StatusBubble.content({ health: "WARN", lastError: "WARN_IN_1500: pesan MASUK gagal diproses (intent timeout)" }).title, "Inbound Timeout");
  const outage = "SERVER_1500: Meta server tidak merespon — cek webhook";
  assert.equal(StatusBubble.content({ health: "SERVER", lastError: outage }).title, "Meta tidak merespons");
  assert.equal(StatusBubble.content({ health: "SERVER", lastError: outage }).detail, outage);
});

test("unrecognized error details and task text are retained as plain text", () => {
  const message = '<img src=x onerror="alert(1)"> & Token revoked';
  assert.equal(StatusBubble.content({ status: "ERROR", lastError: message }).title, message);
  assert.equal(StatusBubble.content({ status: "ACTIVE", task: message }).detail, message);
});

test("bubble updates retain DOM nodes, set plain text, and toggle typing by current state", () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = ""; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); }
    setAttribute(key, value) { this.attributes[key] = value; }
    set innerHTML(value) { throw new Error("Status bubble must never interpret HTML: " + value); }
  }
  const original = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    const bubble = StatusBubble.create({ status: "ACTIVE", task: "Process #1" });
    const [icon, copy, dots] = bubble.children;
    const [title, detail] = copy.children;
    assert.equal(bubble.className, "status-bubble");
    assert.equal(bubble.dataset.state, "working");
    assert.equal(dots.children.length, 3);
    assert.equal(dots.attributes["aria-hidden"], "true");
    assert.equal(dots.hidden, false);
    assert.equal(icon.attributes["aria-hidden"], "true");
    assert.equal(detail.textContent, "Process #1");
    const message = '<script>alert("x")</script>';
    assert.equal(StatusBubble.update(bubble, { status: "ERROR", lastError: message }), bubble);
    assert.equal(bubble.dataset.state, "error");
    assert.equal(copy.children[0], title);
    assert.equal(title.textContent, message);
    assert.equal(dots.hidden, true);
    StatusBubble.update(bubble, { status: "IDLE" });
    assert.equal(bubble.dataset.state, "idle");
    assert.equal(title.textContent, "Standby");
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
