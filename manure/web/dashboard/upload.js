/* Upload page and CLI view: stage files (picker, paste, drop anywhere), choose access, expiry and tags, and
 * publish each file through the resumable current protocol (quick-upload.js).
 * External passwords stay in memory only, in a panel that a re-render, Escape or a route change cannot remove:
 * it goes away after the user confirms, on sign-out (which asks first) or on a session change.
 */
import { FileUpload, parseTags } from "./quick-upload.js";
import { errorLabel, bytes, contentUrl } from "./common.js";

"use strict";

var SECONDS_PER_DAY = 86400;
var MIN_CUSTOM_DAYS = 1, MAX_CUSTOM_DAYS = 365;
var PHONE_QUERY = "(max-width: 720px)";
var VISIBLE_COLUMNS = 4, VISIBLE_COLUMNS_PHONE = 3;
var SECRET_VISIBLE_TAIL = 4;
var MASK_CHAR = "•";
var ACCESS_LABEL = { internal: "Internal", external: "External", public: "Public" };
var ACCESS_HELP = {
  internal: "Internal — only signed-in users can read the artifacts. Links work for colleagues after they sign in.",
  external: "External — readers need the link and a generated password. The password is shown after upload and stays retrievable by signed-in users; links never contain it.",
  public: "Public — anyone with the link can read the artifacts without signing in."
};
var ACCESS_FOOT = {
  internal: "Internal links open for signed-in users.",
  external: "Share each password separately from its link. Signed-in users can retrieve it later from the artifact page.",
  public: "Public links open without signing in."
};
var STATE_VIEW = {
  staged: ["status status-idle", "Staged"], waiting: ["status status-idle", "Waiting"],
  hashing: ["status status-run", "Checking file…"], initializing: ["status status-run", "Reserving artifact…"],
  uploading: ["status status-run", "Uploading"], finalizing: ["status status-run", "Publishing…"],
  ready: ["status status-ok", "Ready"], failed: ["status status-danger", "Failed"],
  stopped: ["status status-warn", "Stopped"], uncertain: ["status status-warn", "Needs a check"]
};
var FAILURE_TEXT = {
  "too-large": "The file exceeds the size the server accepts.",
  "invalid-ttl": "The expiry exceeds the longest the server accepts.",
  "quota-exceeded": "The storage quota is exhausted.",
  "session-limit": "Too many uploads are incomplete."
};
var NETWORK_FAILURE = "network-error";
var SECRET_FIRST = "Copy or reveal the password first. It stays here until you confirm.";
var SECRET_STAYS = "Stays here until you confirm. Share it separately from the link.";
var UNCERTAIN_TEXT = "Initialization could not be confirmed. Do not retry as a new upload without checking the catalogue for an incomplete artifact.";
var FILE_NAME_REJECTED = /[\\/\x00-\x1f\x7f]/;

// ctx: shared session state and DOM helpers; catalogue: list refresh after an upload.
export function createUpload(ctx, catalogue) {
  var document = ctx.document, window = ctx.window, fetch = ctx.fetch, $ = ctx.$, setText = ctx.setText, apiFetch = ctx.apiFetch;
  var overlays = ctx.overlays;
  var showLoggedOut = catalogue.showLoggedOut;
  var uploads = [];
  var rows = new Map();
  var uploadGeneration = 0;
  var uploadBusy = false;
  var uploadAbort = null;
  var cancelRequested = false;
  var logoutConfirmed = false;

  // ── Settings (apply to the files that start next) ───────────────────────
  function accessValue() { return document.querySelector("#upload-access [aria-pressed=true]").dataset.access; }
  function expiryDays() {
    var choice = $("upload-expiry").value;
    if (choice === "never") { return { seconds: null, error: null }; }
    if (choice !== "custom") { return { seconds: Number(choice) * SECONDS_PER_DAY, error: null }; }
    var text = $("upload-days").value.trim();
    var days = Number(text);
    if (text === "" || !Number.isInteger(days) || days < MIN_CUSTOM_DAYS || days > MAX_CUSTOM_DAYS) {
      return { seconds: null, error: "Enter a whole number of days from " + MIN_CUSTOM_DAYS + " to " + MAX_CUSTOM_DAYS + "." };
    }
    return { seconds: days * SECONDS_PER_DAY, error: null };
  }
  function currentSettings() {
    var expiry = expiryDays(), tags = parseTags($("upload-tags").value);
    return { access: accessValue(), expiresInSeconds: expiry.seconds, expiryError: expiry.error, tags: tags.tags, tagError: tags.error };
  }
  function settingsSummary(settings) {
    var parts = [ACCESS_LABEL[settings.access]];
    var choice = $("upload-expiry").value;
    if (choice === "never") { parts.push("no expiry"); }
    else if (settings.expiresInSeconds === null) { parts.push("expiry not set"); }
    else { parts.push("expires in " + settings.expiresInSeconds / SECONDS_PER_DAY + (settings.expiresInSeconds === SECONDS_PER_DAY ? " day" : " days")); }
    if (settings.tags.length > 0) { parts.push("tags " + settings.tags.join(", ")); }
    return parts.join(" · ");
  }
  function applySettings(item, settings) {
    item.visibility = settings.access; item.expiresInSeconds = settings.expiresInSeconds; item.tags = settings.tags;
  }
  function resetSettings() {
    document.querySelectorAll("#upload-access button").forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.access === "internal")); });
    $("upload-expiry").value = "never"; $("upload-days").value = ""; $("upload-tags").value = "";
  }

  // ── Item state ──────────────────────────────────────────────────────────
  function stateOf(item) {
    if (item.phase === "ready") { return "ready"; }
    if (item.busy) { return item.phase === "init-uncertain" ? "initializing" : item.phase; }
    if (item.phase === "init-uncertain") { return "uncertain"; }
    if (item.error !== null) { return item.stopped ? "stopped" : "failed"; }
    return uploadBusy ? "waiting" : "staged";
  }
  function runnable(item) { return item.phase !== "ready" && item.phase !== "init-uncertain"; }
  function partial(item) { return item.phase === "init-uncertain" || item.id !== null && item.phase !== "ready"; }
  function unacknowledged() { return uploads.filter(function (item) { return item.password !== null; }); }
  function failureText(item, error) {
    var code = errorLabel(error);
    var label = code === NETWORK_FAILURE ? "The connection was interrupted" + (item.offset > 0 ? " after " + bytes(item.offset) : "") + "." :
      FAILURE_TEXT[code] || "Upload failed (" + code + ").";
    if (item.phase === "init-uncertain") { return label + " " + UNCERTAIN_TEXT; }
    if (item.phase === "finalizing") { return label + " Publication is uncertain. Retry checks the same artifact; do not start a duplicate."; }
    if (item.id !== null) { return label + " Retry continues the same artifact at the same offset; no second artifact is created."; }
    return label + " Nothing was reserved; Retry starts the upload again.";
  }
  function stoppedText(item) {
    if (item.phase === "finalizing") { return "Cancelled while publishing. Publication is uncertain. Retry checks the same artifact; do not start a duplicate."; }
    if (item.id !== null) { return "Cancelled. Retry continues the same artifact at the same offset; no second artifact is created."; }
    return "Cancelled before anything was reserved. Retry starts the upload again.";
  }

  // ── Rows: built once per item and updated in place, so focus and the password panel survive every update ──
  function button(label, className, iconName) {
    var node = document.createElement("button");
    node.type = "button"; node.className = className;
    if (iconName !== null) { node.appendChild(overlays.iconNode(iconName, "icon-sm")); }
    if (label !== null) { node.append(label); }
    return node;
  }
  function node(tag, className, text) {
    var created = document.createElement(tag);
    if (className !== null) { created.className = className; }
    if (text !== null) { created.textContent = text; }
    return created;
  }
  function maskedSecret(secret) { return MASK_CHAR.repeat(Math.max(0, secret.length - SECRET_VISIBLE_TAIL)) + secret.slice(-SECRET_VISIBLE_TAIL); }

  function linkBlock(item) {
    var url = contentUrl({ artifact_id: item.id, content_url: item.link }, window.location.origin);
    var wrap = node("div", "up-link", null);
    if (url === null) {
      wrap.appendChild(node("span", "up-note grow", "Ready, but no validated content link is configured. Open the artifact page."));
    } else {
      var input = node("input", "input input-mono", null);
      input.type = "text"; input.readOnly = true; input.value = url;
      input.setAttribute("aria-label", "Content link for " + item.file.name);
      input.addEventListener("click", function () { input.select(); });
      var copy = button("Copy link", "btn btn-sm", "link");
      copy.setAttribute("aria-label", "Copy link for " + item.file.name);
      copy.addEventListener("click", function () { overlays.copyText("Content link", url, "Content link copied."); });
      wrap.append(input, copy);
    }
    var details = node("a", "btn btn-sm btn-ghost", "Details");
    details.href = "#/artifact/" + item.id;
    details.setAttribute("aria-label", "Details of " + item.file.name);
    wrap.appendChild(details);
    return wrap;
  }

  // The one-time password: masked, copied or revealed before it may be dismissed, and dismissed only on confirmation.
  function secretPanel(item, release) {
    var name = item.file.name;
    var state = { revealed: false, copied: false, seen: false, failure: null };
    var panel = node("div", "up-secret", null);
    panel.setAttribute("role", "group"); panel.setAttribute("aria-label", "External password for " + name); panel.dataset.uploadSecret = "";
    var value = node("input", "input input-mono", null);
    value.type = "text"; value.readOnly = true; value.spellcheck = false; value.autocomplete = "off";
    value.setAttribute("aria-label", "External password for " + name + " (shown once here)");
    var reveal = button("Reveal", "btn btn-sm", "eye"); reveal.setAttribute("aria-pressed", "false");
    var copy = button("Copy", "btn btn-sm", "copy"); copy.setAttribute("aria-label", "Copy password for " + name);
    var chip = node("span", "chip chip-outline", "Not copied yet");
    var status = node("span", null, null);
    status.setAttribute("role", "status");
    var saved = button("I have saved it", "btn btn-sm", null); saved.disabled = true;
    function update() {
      value.value = state.revealed ? item.password : maskedSecret(item.password);
      reveal.setAttribute("aria-pressed", String(state.revealed));
      chip.className = state.copied ? "chip chip-ok" : "chip chip-outline";
      chip.textContent = state.copied ? "Copied" : "Not copied yet";
      saved.disabled = !(state.copied || state.seen);
      status.textContent = state.failure !== null ? state.failure : saved.disabled ? SECRET_FIRST : SECRET_STAYS;
    }
    reveal.addEventListener("click", function () { state.revealed = !state.revealed; state.seen = true; update(); });
    copy.addEventListener("click", function () {
      var clipboard = window.navigator.clipboard, pending;
      try { pending = clipboard.writeText(item.password); } catch (_error) { pending = Promise.reject(new Error("unavailable")); }
      Promise.resolve(pending).then(function () {
        if (item.password === null) { return; }
        state.copied = true; state.failure = null; overlays.toast("Password copied."); update();
      }, function () { state.failure = "Clipboard unavailable. Reveal the password and copy it manually."; update(); });
    });
    saved.addEventListener("click", function () { confirmHide([item], function () { release(); }); });
    var line = node("div", "up-secret-line", null);
    line.append(overlays.iconNode("key", ""), node("span", "up-secret-label", "External password"), value, reveal, copy);
    var foot = node("div", "up-secret-foot", null);
    foot.append(chip, status, saved);
    panel.append(line, foot);
    update();
    return panel;
  }
  function confirmHide(items, proceed) {
    var names = items.map(function (item) { return item.file.name; });
    var subject = items.length === 1 ? [{ strong: names[0] }] : [items.length + " artifacts"];
    return overlays.confirmAction({ title: "Hide the password for good?", danger: false, icon: null, confirmLabel: "Yes, I have saved it",
      paragraphs: [["After this, the external password of "].concat(subject, [" is no longer shown here. Signed-in users can still retrieve it from the artifact page; continue only if it is stored in your client or password manager."])]
    }).then(function (confirmed) { if (confirmed) { proceed(); } });
  }

  // The Size column is hidden on phones; the extras row spans the columns that are left.
  var narrow = window.matchMedia(PHONE_QUERY);
  function columnCount() { return narrow.matches ? VISIBLE_COLUMNS_PHONE : VISIBLE_COLUMNS; }
  narrow.addEventListener("change", function () { rows.forEach(function (view) { view.extraCell.colSpan = columnCount(); }); });

  function createRow(item) {
    var body = node("tbody", null, null); body.dataset.uploadRow = "";
    var main = node("tr", null, null), extraRow = node("tr", "up-extra-row", null);
    var name = node("td", null, null), size = node("td", "col-num hide-sm", null), status = node("td", null, null), actions = node("td", "col-actions", null);
    var title = node("span", "cell-title truncate grow", item.file.name); title.title = item.file.name;
    var kind = node("span", "kind kind-sm", null); kind.appendChild(overlays.iconNode("file", ""));
    var nameLine = node("div", "up-line", null), nameCell = node("div", "name-cell", null);
    nameCell.append(kind, title); nameLine.appendChild(nameCell); name.append(nameLine, node("span", "up-sub up-size-inline", bytes(item.file.size)));
    var sizeLine = node("div", "up-line", bytes(item.file.size)); size.appendChild(sizeLine);
    var statusLine = node("div", "up-line", null), statusLabel = node("span", null, null);
    var bar = node("span", "up-bar", null), fill = node("span", null, null), sub = node("span", "up-sub", null);
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "Upload progress of " + item.file.name);
    bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100"); bar.appendChild(fill);
    statusLine.appendChild(statusLabel); status.append(statusLine, bar, sub);
    var actionLine = node("div", "up-line", null);
    var retry = button("Retry", "btn btn-sm", "refresh"); retry.setAttribute("aria-label", "Retry " + item.file.name);
    var stop = button("Cancel", "btn btn-sm btn-ghost", null); stop.setAttribute("aria-label", "Cancel " + item.file.name);
    var remove = button(null, "btn btn-sm btn-ghost btn-icon", "x"); remove.setAttribute("aria-label", "Remove " + item.file.name + " from the list");
    actionLine.append(retry, stop, remove); actions.appendChild(actionLine);
    main.append(name, size, status, actions);
    var extraCell = node("td", null, null); extraCell.colSpan = columnCount();
    var extra = node("div", "up-extra", null);
    var error = node("p", "field-error", null); error.setAttribute("role", "alert");
    var catalogueLink = node("a", "link-button", "Check the catalogue for incomplete uploads"); catalogueLink.href = "#/artifacts?query=state%3Auploading";
    var note = node("p", "up-note", null);
    extraCell.appendChild(extra); extraRow.appendChild(extraCell); body.append(main, extraRow);
    var link = null, secret = null, noted = false;
    retry.addEventListener("click", function () { start(item); });
    remove.addEventListener("click", function () { removeItem(item); });
    stop.addEventListener("click", cancel);

    function update() {
      var state = stateOf(item), view = STATE_VIEW[state];
      body.dataset.state = state; body.dataset.access = item.visibility;
      if (item.id !== null) { body.dataset.artifactId = item.id; }
      statusLabel.className = view[0];
      var percent = item.file.size === 0 ? null : Math.min(100, Math.floor(item.offset * 100 / item.file.size));
      statusLabel.textContent = state === "uploading" && percent !== null ? view[1] + " · " + percent + " %" : view[1];
      bar.hidden = state !== "uploading";
      if (state === "uploading") {
        fill.style.setProperty("width", (percent === null ? 0 : percent) + "%");
        bar.setAttribute("aria-valuenow", String(percent === null ? 0 : percent));
      }
      sub.hidden = state !== "uploading";
      sub.textContent = bytes(item.offset) + " of " + bytes(item.file.size);
      retry.hidden = !(state === "failed" || state === "stopped");
      retry.disabled = uploadBusy;
      stop.hidden = !item.busy; stop.disabled = cancelRequested;
      remove.hidden = item.busy;
      var message = state === "uncertain" ? (item.error !== null ? item.error : UNCERTAIN_TEXT) : item.error;
      error.hidden = message === null || state === "ready"; error.textContent = message === null ? "" : message;
      if (!error.hidden) { error.prepend(overlays.iconNode("alert", "icon-sm")); }
      catalogueLink.hidden = state !== "uncertain";
      if (state === "ready" && link === null) { link = linkBlock(item); }
      if (item.password !== null && secret === null && state === "ready") {
        secret = secretPanel(item, function () { item.password = null; renderAll(); });
      }
      if (item.password === null && secret !== null) {
        secret.remove(); secret = null;
        note.textContent = "Password hidden. Signed-in users can retrieve it from the artifact page."; noted = true;
      }
      var wanted = [error, catalogueLink].concat(link === null ? [] : [link], secret === null ? [] : [secret], noted ? [note] : []);
      // Re-parenting would drop the focus from a control inside the password panel; touch the list only when it changed.
      if (wanted.length !== extra.children.length || wanted.some(function (child, at) { return extra.children[at] !== child; })) { extra.replaceChildren.apply(extra, wanted); }
      extraRow.hidden = extra.querySelector(":scope > :not([hidden])") === null;
    }
    return { body: body, extraCell: extraCell, update: update };
  }

  // ── Page rendering ──────────────────────────────────────────────────────
  function renderAll() {
    var table = $("upload-table");
    var settings = currentSettings();
    var locked = uploadBusy || uploads.some(partial);
    uploads.forEach(function (item) {
      if (!rows.has(item)) { rows.set(item, createRow(item)); }
    });
    Array.from(rows.keys()).forEach(function (item) {
      if (!uploads.includes(item)) { rows.get(item).body.remove(); rows.delete(item); }
    });
    uploads.forEach(function (item, index) {
      var view = rows.get(item);
      if (table.tBodies[index] !== view.body) { table.insertBefore(view.body, table.tBodies[index] || null); }
      view.update();
    });
    $("upload-files-card").hidden = uploads.length === 0;
    $("upload-clear").hidden = uploadBusy;
    $("upload-drop-title").textContent = uploads.length === 0 ? "Drop or paste files here" : "Drop or paste more files";
    $("upload-choose").className = uploads.length === 0 ? "btn btn-primary" : "btn";
    $("upload-choose").disabled = uploadBusy;
    document.querySelectorAll("#upload-access button").forEach(function (choice) {
      choice.setAttribute("aria-pressed", String(choice.dataset.access === settings.access)); choice.disabled = locked;
    });
    $("upload-expiry").disabled = locked; $("upload-days").disabled = locked; $("upload-tags").disabled = locked;
    $("upload-days-field").hidden = $("upload-expiry").value !== "custom";
    showFieldError("upload-days", "upload-days-error", $("upload-expiry").value === "custom" ? settings.expiryError : null);
    showFieldError("upload-tags", "upload-tags-error", settings.tagError);
    setText("upload-access-help", ACCESS_HELP[settings.access]);
    $("upload-lock").hidden = !locked;
    setText("upload-lock-text", uploadBusy ? "Locked while uploading" : "Locked until the failed upload is retried or removed");
    $("upload-next").hidden = locked || !uploads.some(function (item) { return item.phase === "ready"; });
    renderFooter(settings);
  }
  function showFieldError(inputId, errorId, message) {
    $(errorId).hidden = message === null; $(errorId).textContent = message === null ? "" : message;
    $(inputId).setAttribute("aria-invalid", String(message !== null));
    if (message !== null) { $(inputId).setAttribute("aria-describedby", errorId); } else { $(inputId).removeAttribute("aria-describedby"); }
  }
  function renderFooter(settings) {
    var pending = uploads.filter(runnable), ready = uploads.filter(function (item) { return item.phase === "ready"; });
    var failed = pending.filter(function (item) { return item.error !== null; }).length;
    var staged = pending.length - failed, uncertain = uploads.filter(function (item) { return item.phase === "init-uncertain"; }).length;
    var total = uploads.length;
    var parts = [];
    if (ready.length > 0) { parts.push(ready.length === total ? total + " ready" : ready.length + " of " + total + " ready"); }
    if (failed + uncertain > 0) { parts.push(failed + uncertain + " failed"); }
    if (staged > 0 && ready.length === 0 && failed + uncertain === 0) { parts.push(staged + " staged · " + bytes(uploads.reduce(function (sum, item) { return sum + item.file.size; }, 0))); }
    setText("upload-summary", parts.length === 0 ? "" : "· " + parts.join(" · "));
    var foot;
    if (uploadBusy) {
      var position = Math.max(1, uploads.findIndex(function (item) { return item.busy; }) + 1);
      foot = "Uploading file " + position + " of " + total + " · keep this tab open until it finishes";
    } else if (failed + uncertain > 0) {
      foot = (ready.length > 0 ? ready.length + (ready.length === 1 ? " artifact is" : " artifacts are") + " ready. " : "") + "A failed upload keeps its reserved artifact until you retry or remove it.";
    } else if (staged > 0) {
      foot = settingsSummary(settings);
    } else {
      var shared = Array.from(new Set(ready.map(function (item) { return item.visibility; })));
      foot = shared.map(function (access) { return ACCESS_FOOT[access]; }).join(" ");
    }
    $("upload-status").textContent = foot;
    $("upload-cancel").hidden = !uploadBusy; $("upload-cancel").disabled = cancelRequested;
    $("upload-submit").hidden = uploadBusy || pending.length === 0;
    $("upload-submit").disabled = settings.tagError !== null || settings.expiryError !== null && $("upload-expiry").value === "custom";
    setText("upload-submit-label", failed > 0 && staged === 0 ? "Retry " + failed + " failed" : "Upload " + pending.length + (pending.length === 1 ? " file" : " files"));
    var viewLink = $("upload-view-link");
    viewLink.hidden = uploadBusy || ready.length === 0;
    viewLink.className = pending.length === 0 ? "btn btn-primary" : "btn";
  }

  // ── Staging ─────────────────────────────────────────────────────────────
  function showNotice(text) { setText("upload-notice-text", text); $("upload-notice").hidden = false; }
  function stageFiles(files) {
    if (!ctx.authenticated) { return; }
    if (uploadBusy) { showNotice("Files can be added once the current upload has finished."); return; }
    $("upload-notice").hidden = true;
    Array.from(files).forEach(function (file) {
      if (!file.name || FILE_NAME_REJECTED.test(file.name) || file.name === "." || file.name === "..") {
        showNotice("Rejected an unsupported file name. Rename it before uploading."); return;
      }
      uploads.push(new FileUpload(file, accessValue()));
    });
    $("upload-files").value = ""; renderAll();
  }
  function removeItem(item) {
    if (item.busy) { return; }
    var drop = function () { var at = uploads.indexOf(item); if (at !== -1) { uploads.splice(at, 1); item.clear(); renderAll(); } };
    if (item.password !== null) { confirmHide([item], drop); } else { drop(); }
  }
  function clearList() {
    if (uploadBusy) { return; }
    var drop = function () { uploads.forEach(function (item) { item.clear(); }); uploads = []; $("upload-notice").hidden = true; renderAll(); };
    var held = unacknowledged();
    if (held.length > 0) { confirmHide(held, drop); } else { drop(); }
  }
  // Session boundary (sign-out, session change): everything goes, including the settings and any shown password.
  function clearUploads() {
    uploadGeneration++;
    if (uploadAbort !== null) { uploadAbort.abort(); uploadAbort = null; }
    uploads.forEach(function (item) { item.clear(); });
    uploads = []; uploadBusy = false; cancelRequested = false;
    $("upload-files").value = ""; $("upload-notice").hidden = true;
    resetSettings(); renderAll();
  }

  // ── Publishing ──────────────────────────────────────────────────────────
  async function start(only) {
    var settings = currentSettings();
    if (!ctx.authenticated || uploadBusy || settings.tagError !== null || settings.expiryError !== null && $("upload-expiry").value === "custom") { return; }
    var queue = only === null ? uploads.slice() : [only];
    queue.forEach(function (item) { if (item.id === null && item.phase !== "init-uncertain") { applySettings(item, settings); } });
    var generation = uploadGeneration, epoch = ctx.sessionEpoch;
    var controller = new AbortController(); uploadAbort = controller; cancelRequested = false; uploadBusy = true;
    function stale() { return !ctx.authenticated || generation !== uploadGeneration || epoch !== ctx.sessionEpoch; }
    function check() { if (stale()) { throw new Error("cancelled"); } }
    renderAll();
    try {
      for (var item of queue) {
        if (cancelRequested) { break; }
        if (!runnable(item) || !uploads.includes(item)) { continue; }
        check(); item.error = null; item.stopped = false;
        try {
          await item.run(apiFetch, fetch, check, controller.signal, renderAll);
        } catch (error) {
          if (stale()) { return; }
          if (error.status === 401) { showLoggedOut(); return; }
          item.stopped = cancelRequested;
          item.error = cancelRequested ? stoppedText(item) : failureText(item, error);
          renderAll(); break;
        }
      }
      if (stale()) { return; }
      catalogue.reloadAfterUpload();
    } finally {
      if (generation === uploadGeneration && epoch === ctx.sessionEpoch) { uploadBusy = false; uploadAbort = null; cancelRequested = false; renderAll(); }
    }
  }
  function cancel() {
    if (!uploadBusy || cancelRequested) { return; }
    cancelRequested = true; uploadAbort.abort(); renderAll();
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  $("upload-choose").addEventListener("click", function () { $("upload-files").click(); });
  $("upload-files").addEventListener("change", function (event) { stageFiles(event.target.files); });
  document.querySelectorAll("#upload-access button").forEach(function (choice) {
    choice.addEventListener("click", function () {
      document.querySelectorAll("#upload-access button").forEach(function (other) { other.setAttribute("aria-pressed", String(other === choice)); });
      renderAll();
    });
  });
  ["upload-expiry", "upload-days", "upload-tags"].forEach(function (id) { $(id).addEventListener("input", renderAll); });
  $("upload-clear").addEventListener("click", clearList);
  $("upload-submit").addEventListener("click", function () { start(null); });
  $("upload-cancel").addEventListener("click", cancel);

  // Sign-out with a password still shown asks first (account.js performs the sign-out once this lets the click through).
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-account-logout]");
    var held = unacknowledged();
    if (trigger === null || trigger.disabled || logoutConfirmed || held.length === 0) { return; }
    event.preventDefault(); event.stopImmediatePropagation();
    confirmHide(held, function () {
      if (!trigger.isConnected) { return; }
      logoutConfirmed = true; trigger.click(); logoutConfirmed = false;
    });
  }, true);
  window.addEventListener("beforeunload", function (event) {
    if (ctx.authenticated && (uploadBusy || unacknowledged().length > 0)) { event.preventDefault(); event.returnValue = ""; }
  });

  // CLI view: this server's address, and copy buttons for each command block.
  setText("cli-origin", window.location.origin);
  $("cli-section").addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-copy-from]");
    if (trigger !== null) { overlays.copyText("Command", $(trigger.dataset.copyFrom).textContent, "Command copied."); }
  });

  renderAll();
  // Files dropped or pasted anywhere in the dashboard arrive here (the shell routes to the upload view).
  return { clearUploads: clearUploads, stageFiles: stageFiles };
}
