/* Helpers shared by the dashboard modules: DOM construction, formatting, content-link validation and the
 * connection state (what the dashboard can currently reach). No HTML injection: text always goes through textContent.
 */
"use strict";

export var API = "/api/current";
export var ID_RE = /^[0-9a-f]{32}$/;
// A control that opens a new tab says so in its title and ends its accessible name with this note.
export var NEW_TAB_NOTE = " (opens in a new tab)";
// Connection indicator timing. A heartbeat is sent only after IDLE_CHECK_MS without any other request while the server
// answers; after a failure (or before the first answer) the checks start at RETRY_FIRST_MS and double up to RETRY_MAX_MS.
export var CONNECTION = {
  IDLE_CHECK_MS: 30000,
  RETRY_FIRST_MS: 5000,
  RETRY_MAX_MS: 60000,
  PROBE_TIMEOUT_MS: 10000,
  // Statuses a gateway answers when the application is down; Manure's own answers in this range are told apart by their body.
  GATEWAY_STATUSES: [502, 503, 504]
};

export function domHelpers(document) {
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { $(id).textContent = text; }
  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== null) { node.textContent = text; }
    if (className !== null) { node.className = className; }
    return node;
  }
  return { $: $, setText: setText, element: element };
}
export function errorLabel(error) {
  return error && /^[a-z0-9-]+$/.test(error.message) ? error.message : "network-error";
}
export function bytes(value) {
  if (typeof value === "bigint") { value = Number(value); }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) { return "—"; }
  var units = ["B", "KiB", "MiB", "GiB", "TiB"];
  var index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return (index === 0 ? String(value) : value.toFixed(1)) + " " + units[index];
}
export function dateText(value, empty) {
  if (value === null || value === undefined) { return empty; }
  var date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}
export function expired(item) { return typeof item.expires_at === "string" && Date.parse(item.expires_at) <= Date.now(); }
// The content link of an artifact, or null unless it is its isolated subdomain root or this origin's /view/<id> path.
export function contentUrl(info, dashboardOrigin) {
  if (typeof info.content_url !== "string" || info.content_url === "") { return null; }
  try {
    var url = new URL(info.content_url);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
        !ID_RE.test(info.artifact_id) || url.search || url.hash) { return null; }
    var subdomain = url.hostname.split(".")[0] === info.artifact_id && url.pathname === "/";
    var pathMode = url.origin === dashboardOrigin &&
      (url.pathname === "/view/" + info.artifact_id || url.pathname === "/view/" + info.artifact_id + "/");
    if (!subdomain && !pathMode) { return null; }
    return url.href;
  } catch (_error) { return null; }
}

// ── Connection state ─────────────────────────────────────────────────────
// Whether the dashboard can currently reach the server, from the outcome of every request it makes (connection.fetch
// wraps the page's fetch) and from a heartbeat while nothing else is going on. Phases: "connecting" (no answer yet),
// "live" (the latest request or heartbeat was answered), "offline" (it was not: connection refused or lost, in the
// middle of the answer too, no answer in time, or a gateway's error page). Any answer counts, a 401 or an application
// error included: the server is there.
// env: { fetch, document, window, now(), probe(fetch, signal), answeredByManure(path, init, status, text) } — probe sends one
// unauthenticated heartbeat through the fetch it is given, so its outcome is recorded like every other request's;
// answeredByManure tells a gateway-status response Manure produced from a gateway's own.
export function createConnection(env) {
  var window = env.window, document = env.document;
  var phase = "connecting", failures = 0, lastAnswerAt = null, lastFailure = null, pending = 0;
  var timer = null, nextCheckAt = null, started = false, inflight = null;
  var listeners = [];

  function snapshot() {
    return { phase: phase, failures: failures, lastAnswerAt: lastAnswerAt, lastFailure: lastFailure, nextCheckAt: nextCheckAt, pending: pending };
  }
  function notify() { listeners.forEach(function (listener) { listener(snapshot()); }); }
  function hidden() { return document.visibilityState === "hidden"; }
  // One timer: every outcome re-arms it, so a heartbeat is sent only when nothing else was.
  function schedule() {
    window.clearTimeout(timer);
    timer = null; nextCheckAt = null;
    if (!started || hidden()) { return; }
    var delay = phase === "live" ? CONNECTION.IDLE_CHECK_MS
      : Math.min(CONNECTION.RETRY_FIRST_MS * Math.pow(2, Math.max(failures, 1) - 1), CONNECTION.RETRY_MAX_MS);
    nextCheckAt = env.now() + delay;
    timer = window.setTimeout(check, delay);
  }
  function answered() {
    phase = "live"; failures = 0; lastAnswerAt = env.now();
    schedule(); notify();
  }
  function failed(reason) {
    phase = "offline"; failures++; lastFailure = { reason: reason, at: env.now() };
    schedule(); notify();
  }
  // A heartbeat from the timer waits for the one in flight; a forced check (tab shown, browser online, Check now)
  // replaces it, which may be stuck on a connection that no longer exists.
  function check(forced) {
    if (inflight !== null) {
      if (forced !== true) { return; }
      inflight.controller.abort();
    }
    var heartbeat = { controller: new window.AbortController(), limit: null };
    inflight = heartbeat;
    heartbeat.limit = window.setTimeout(function () {
      heartbeat.controller.abort(new window.DOMException("No answer within " + CONNECTION.PROBE_TIMEOUT_MS + " ms", "TimeoutError"));
    }, CONNECTION.PROBE_TIMEOUT_MS);
    // observedFetch records the outcome, a failing or stalled body and the timeout included; a malformed answer is still
    // an answer, so a rejection adds nothing.
    env.probe(observedFetch, heartbeat.controller.signal).catch(function () {}).then(function () {
      window.clearTimeout(heartbeat.limit);
      if (inflight === heartbeat) { inflight = null; schedule(); }
    });
  }
  function pathOf(input) { return new window.URL(String(input), "http://dashboard.invalid").pathname; }
  function transportFailed(error) {
    // Cancelling a request on purpose says nothing about the server.
    var name = error ? error.name : "";
    if (name === "AbortError") { notify(); } else { failed(name === "TimeoutError" ? "No answer in time" : "Network error"); }
  }
  // The verdict comes when the body is complete, not with the headers: a connection that drops or stalls after them is no
  // answer. The body is read on a clone, so it is judged even when the caller does not read it (an error status).
  function observedFetch(input, init) {
    pending++;
    return env.fetch(input, init).then(function (response) {
      response.clone().text().then(function (text) {
        pending--;
        if (CONNECTION.GATEWAY_STATUSES.includes(response.status) && !env.answeredByManure(pathOf(input), init, response.status, text)) {
          failed("HTTP " + response.status + " from a gateway");
        } else { answered(); }
      }, function (error) { pending--; transportFailed(error); });
      return response;
    }, function (error) {
      pending--;
      transportFailed(error);
      throw error;
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (!started) { return; }
    if (hidden()) { schedule(); } else { check(true); }
  });
  window.addEventListener("online", function () { if (started && !hidden()) { check(true); } });
  return {
    fetch: observedFetch,
    snapshot: snapshot,
    subscribe: function (listener) { listeners.push(listener); },
    checkNow: function () { check(true); },
    start: function () { started = true; schedule(); }
  };
}
