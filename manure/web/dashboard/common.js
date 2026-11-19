/* Helpers shared by the dashboard modules: DOM construction, formatting and content-link validation.
 * No HTML injection: text always goes through textContent.
 */
"use strict";

export var API = "/api/current";
export var ID_RE = /^[0-9a-f]{32}$/;
// A control that opens a new tab says so in its title and ends its accessible name with this note.
export var NEW_TAB_NOTE = " (opens in a new tab)";

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
