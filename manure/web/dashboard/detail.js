/* Artifact page (spec §3.3): header, overview, content manifest (tree drill-down or filtered flat list),
 * access rail with the external password, danger zone, and the content handoff.
 * One-time passwords stay transient; uploaded bytes never render here. Text always goes through textContent.
 */
import * as current from "./current-protocol.js";
import { API, ID_RE, errorLabel, bytes, contentUrl } from "./common.js";

"use strict";

var MODES = ["internal", "external", "public"];
var MODE_LABELS = { internal: "Internal", external: "External", public: "Public" };
var ACCESS_CHIPS = { internal: ["chip", "lock"], external: ["chip chip-warn", "key"], public: ["chip chip-info", "external"] };
var STATES = { ready: ["status status-ok", "Ready"], uploading: ["status status-run", "Uploading"], publishing: ["status status-run", "Publishing"] };
var EXPLANATIONS = {
  internal: "Only signed-in users can read this artifact. “Open artifact” uses a single-use grant; your dashboard session never leaves this origin.",
  external: "Anyone with the link and the external password can read it. Every signed-in user can retrieve the current password here.",
  public: "Anyone with the link can read this artifact without signing in."
};
// Who can read the artifact after a change: [before the name, after the name and its file count].
var READERS = {
  internal: ["Only signed-in users will be able to read ", "."],
  external: ["Anyone with the link and the external password will be able to read ", ". A new password is generated and shown here."],
  public: ["Anyone with the link will be able to read ", " without signing in and without a password."]
};
var PASSWORD_HINT = "Share the password separately from the link. Rotating replaces it and revokes existing grants.";
var REVEALED_HINT = "Visible until you hide it or leave this page. Rotating replaces it and revokes existing grants.";
var HASH_ONLY = "This older password was stored as a hash only. Rotate once to make the new password available.";
var PASSWORD_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
var PASSWORD_LENGTH = 43;
// The server's expiry bounds (UploadRules.ttl): one minute to 365 days from now.
var MIN_TTL_S = 60, MAX_TTL_S = 31536000;
var MINUTE_MS = 60 * 1000, HOUR_MS = 60 * MINUTE_MS, DAY_MS = 24 * HOUR_MS;
var MISSING = {
  "not-found": { icon: "search", title: "Artifact not found", retry: true, expired: false,
    text: function (id) { return ["No artifact has the ID ", { id: id }, ". It may have been deleted, or the link is incomplete."]; } },
  expired: { icon: "clock", title: "This artifact has expired", retry: false, expired: true,
    text: function (id) { return [{ id: id }, " passed its expiry time. Its content is no longer served; it can still be deleted from the list of expired artifacts."]; } },
  error: { icon: "alert", title: "Artifact could not be loaded", retry: true, expired: false,
    text: function (id, error) { return ["Reading ", { id: id }, " failed (" + errorLabel(error) + "). Nothing was changed."]; } }
};

// ctx: shared session state and DOM helpers; catalogue: the list view's routing and invalidation hooks.
export function createDetail(ctx, catalogue) {
  var document = ctx.document, window = ctx.window, $ = ctx.$, setText = ctx.setText, element = ctx.element, apiFetch = ctx.apiFetch;
  var overlays = ctx.overlays, deleting = ctx.deleting, accessMutations = ctx.accessMutations;
  var readRoute = catalogue.readRoute, routeHash = catalogue.routeHash, renderList = catalogue.renderList,
    invalidateCatalogue = catalogue.invalidateCatalogue, failVisible = catalogue.failVisible;
  var dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  var section = $("detail-section");
  var modeButtons = Array.from(document.querySelectorAll("#access-mode [data-mode]"));
  var layoutButtons = Array.from(document.querySelectorAll("#manifest-tools [data-layout]"));
  var detailGeneration = 0;
  var revealGeneration = 0;
  var passwordRead = null;
  var openGeneration = 0;
  var currentDetailId = null;
  var currentDetailInfo = null;
  // The access mode chosen in the rail; it is sent only by Save after the confirmation.
  var accessDraft = null;
  // The manifest of the shown artifact ({ id, files } once loaded), the folder shown in the tree and the layout.
  var manifest = null;
  var folder = "";
  var layout = "tree";

  // ── Page state ─────────────────────────────────────────────────────────
  // loading | loaded | not-found | expired | error (section[data-state]; CSS hides what a state has no data for).
  function setPageState(state, error) {
    section.dataset.state = state;
    var missing = MISSING[state];
    $("detail-missing").hidden = missing === undefined;
    $("detail-page").hidden = missing !== undefined;
    if (missing === undefined) { return; }
    var box = document.querySelector("#detail-missing .empty");
    var previous = box.querySelector(":scope > .icon");
    if (previous !== null) { previous.remove(); }
    box.prepend(overlays.iconNode(missing.icon, ""));
    setText("detail-missing-title", missing.title);
    $("detail-missing-text").replaceChildren.apply($("detail-missing-text"), missing.text(currentRouteId(), error).map(function (part) {
      return typeof part === "string" ? part : element("span", part.id, "hex");
    }));
    $("detail-retry-button").hidden = !missing.retry;
    $("detail-expired-link").hidden = !missing.expired;
  }
  function currentRouteId() { return readRoute().id; }
  function notifier(boxId, textId, actionsId) {
    // kind: null (hide) | "info" | "warn" | "danger"; reload: show the reload action.
    return function (kind, text, reload) {
      var box = $(boxId);
      box.hidden = kind === null;
      if (kind === null) { setText(textId, ""); return; }
      box.className = "notice" + (kind === "info" ? "" : " notice-" + kind) + (boxId === "detail-notice" ? " detail-notice" : "");
      box.setAttribute("role", kind === "danger" ? "alert" : "status");
      setText(textId, text);
      $(actionsId).hidden = reload !== true;
    };
  }
  var accessNotice = notifier("access-notice", "access-status", "access-notice-actions");
  var detailNotice = notifier("detail-notice", "detail-status", "detail-notice-actions");

  // ── Rendering ──────────────────────────────────────────────────────────
  function relative(time) {
    var delta = time - Date.now(), span = Math.abs(delta);
    var text = span < HOUR_MS ? Math.max(1, Math.round(span / MINUTE_MS)) + " min" : span < DAY_MS ? Math.round(span / HOUR_MS) + " h" : Math.round(span / DAY_MS) + " d";
    return delta < 0 ? text + " ago" : "in " + text;
  }
  // A local date with its relative time; the title carries the ISO timestamp.
  function setTime(node, value, empty) {
    node.textContent = ""; node.removeAttribute("title");
    if (value === null || value === undefined) { node.appendChild(element("span", empty, "faint")); return; }
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) { node.textContent = "Unknown"; return; }
    node.title = date.toISOString();
    node.append(dateFormat.format(date) + " ", element("span", "· " + relative(date.getTime()), "muted"));
  }
  function setLiteral(id, value, empty) {
    var node = $(id);
    node.textContent = ""; node.removeAttribute("title");
    if (value === null || value === undefined) { node.appendChild(element("span", empty, "faint")); return; }
    var literal = element("span", value, "mono-val");
    literal.title = value;
    node.appendChild(literal);
  }
  function accessChip(mode) {
    var spec = ACCESS_CHIPS[mode];
    var chip = element("span", null, spec[0]);
    chip.dataset.access = mode;
    chip.append(overlays.iconNode(spec[1], "icon-sm"), MODE_LABELS[mode]);
    return chip;
  }
  function renderHeader(info, id) {
    var label = info.name || id, dir = info.kind === "dir";
    setText("detail-name", label); $("detail-name").title = label;
    $("detail-kind").className = "kind hide-sm" + (dir ? " kind-dir" : "");
    $("detail-kind").replaceChildren(overlays.iconNode(dir ? "folder" : "file", ""));
    $("detail-access").replaceChildren(accessChip(info.visibility));
    var state = element("span", STATES[info.state][1], STATES[info.state][0]);
    state.dataset.state = info.state;
    $("detail-state").replaceChildren(state);
  }
  function renderOverview(info, id) {
    setText("meta-kind", info.kind === "dir" ? "Directory" : "File");
    setText("meta-size", bytes(info.total_bytes));
    setText("meta-files", String(info.file_count));
    setText("meta-owner", info.created_by_user);
    setTime($("meta-created"), info.created_at, "Unknown");
    setTime($("meta-expires"), info.expires_at, "Never");
    setLiteral("meta-hostname", info.hostname, "Not supplied");
    setLiteral("meta-project", info.project_path, "Not supplied");
    setText("meta-id", id);
    var url = contentUrl(info, window.location.origin);
    $("meta-url").textContent = "";
    if (url === null) { $("meta-url").appendChild(element("span", "Not configured", "faint")); }
    else { $("meta-url").textContent = url; }
    $("meta-url").title = url === null ? "Content hosting is not configured" : url;
    $("meta-tags").textContent = "";
    if (info.tags.length === 0) { $("meta-tags").appendChild(element("span", "None", "faint")); }
    info.tags.forEach(function (tag) { $("meta-tags").appendChild(element("span", tag, "chip")); });
    setText("content-summary", "· " + (info.file_count === 1 ? "1 file" : info.file_count + " files") + " · " + bytes(info.total_bytes));
    $("manifest-filter").placeholder = "Filter " + info.file_count + (info.file_count === 1 ? " path" : " paths");
  }
  function renderDetail(info, id) {
    if (!info || info.artifact_id !== id || MODES.indexOf(info.visibility) === -1 || STATES[info.state] === undefined) { throw new Error("bad-response"); }
    delete info.external_password;
    currentDetailId = id; currentDetailInfo = info;
    accessDraft = info.visibility;
    renderHeader(info, id);
    renderOverview(info, id);
    if (info.visibility !== "external") { hidePassword(); }
    $("upload-pending").hidden = info.state === "ready";
    setPageState("loaded", null);
    updateDetailActions();
  }
  function updateDetailActions() {
    var id = currentDetailId, info = currentDetailInfo;
    var busy = id !== null && (accessMutations.has(id) || deleting.has(id) || passwordRead !== null && passwordRead.id === id);
    var ready = info !== null && info.state === "ready";
    var url = info === null ? null : contentUrl(info, window.location.origin);
    var draft = info === null ? null : accessDraft;
    var changed = info !== null && draft !== info.visibility;
    modeButtons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === draft));
      button.disabled = !ready || busy;
    });
    setText("access-description", draft === null ? "" : EXPLANATIONS[draft]);
    $("access-save-button").disabled = !ready || busy || !changed;
    $("access-save-button").classList.toggle("btn-primary", changed);
    $("access-discard-button").hidden = !changed;
    $("access-discard-button").disabled = busy;
    $("access-unchanged").hidden = changed || !ready;
    $("access-unsaved").hidden = !changed;
    $("access-change-notice").hidden = !changed;
    if (changed) {
      setText("access-change-title", MODE_LABELS[info.visibility] + " → " + MODE_LABELS[draft]);
      setText("access-change-text", revocation(info.visibility) + " Any signed-in user may change access.");
    }
    $("access-pending-notice").hidden = info === null || ready;
    $("password-box").hidden = info === null || info.visibility !== "external" || changed;
    $("password-divider").hidden = $("password-box").hidden;
    ["password-reveal-button", "password-copy-button", "rotate-button"].forEach(function (key) { $(key).disabled = info === null || busy; });
    $("delete-button").disabled = info === null || busy;
    $("open-button").disabled = !ready || busy || url === null;
    $("copy-link-button").disabled = url === null;
    $("meta-copy-link-button").hidden = url === null;
    $("copy-id-button").disabled = info === null;
    $("copy-fetch-button").disabled = info === null;
    $("access-actions").hidden = info !== null && !ready;
    // Metadata edits of unfinished uploads are reserved to their uploader; the page offers them once the upload is ready.
    $("rename-button").hidden = info !== null && !ready;
    $("expiry-change-button").hidden = info !== null && !ready;
    $("rename-button").disabled = info === null || busy;
    $("expiry-change-button").disabled = info === null || busy;
    $("reload-button").disabled = id === null || accessMutations.has(id) || deleting.has(id);
  }
  function revocation(from) {
    return from === "external" ? "Saving revokes the external password and every existing content grant." : "Saving revokes every existing content grant.";
  }

  // ── Loading ────────────────────────────────────────────────────────────
  function routeFolder() {
    var hash = window.location.hash, at = hash.indexOf("?");
    return new URLSearchParams(at === -1 ? "" : hash.slice(at + 1)).get("path") || "";
  }
  function resetView() {
    currentDetailId = null; currentDetailInfo = null; accessDraft = null; manifest = null;
    stopRename(false); stopExpiry(false);
    detailNotice(null); accessNotice(null);
    setText("detail-name", "Artifact"); $("detail-name").removeAttribute("title");
    $("detail-kind").replaceChildren(); $("detail-access").replaceChildren(); $("detail-state").replaceChildren();
    $("file-list").textContent = "";
    $("manifest-filter").value = "";
    renderManifest();
  }
  function showDetail(id) {
    var generation = ++detailGeneration;
    var epoch = ctx.sessionEpoch;
    catalogue.suspendForDetail();
    openGeneration++; hidePassword();
    resetView();
    folder = routeFolder();
    setText("detail-name", "Loading artifact…");
    $("detail-back-button").href = routeHash(null);
    $("detail-missing-back").href = routeHash(null);
    setPageState("loading", null);
    updateDetailActions();
    $("dashboard-section").hidden = true; section.hidden = false;
    apiFetch(current.artifact(id)).then(function (info) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration) { return; }
      renderDetail(info, id);
      if (accessMutations.has(id)) { accessNotice("info", "An access or password update is still in progress. Wait for its status to be refreshed.", false); }
      loadFiles();
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration) { return; }
      currentDetailId = null; currentDetailInfo = null;
      var label = errorLabel(error);
      // The artifact is gone: no list may keep showing it (or the retrieval evidence that matched it).
      if (label === "not-found" || label === "expired") { invalidateCatalogue(); }
      setText("detail-name", "Artifact");
      setPageState(label === "not-found" || label === "expired" ? label : "error", error);
      updateDetailActions();
    });
  }
  function loadFiles() {
    var id = currentDetailId;
    if (id === null || currentDetailInfo === null) { return; }
    var generation = detailGeneration;
    var epoch = ctx.sessionEpoch;
    manifest = null; renderManifest();
    apiFetch(current.manifest(id)).then(function (body) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || id !== currentDetailId) { return; }
      if (!Array.isArray(body.files) || !body.files.every(function (file) { return typeof file.path === "string" && (file.kind === "file" || file.kind === "dir"); })) { throw new Error("bad-response"); }
      manifest = { id: id, files: body.files.slice().sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }) };
      if (!folderExists(folder)) { folder = ""; replaceFolderRoute(); }
      renderManifest();
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || id !== currentDetailId) { return; }
      renderManifest();
      $("manifest-skeleton").hidden = true;
      $("manifest-foot").dataset.state = "error";
      setText("files-status", "Files could not be loaded (" + errorLabel(error) + ").");
      $("files-retry-button").hidden = false;
    });
  }

  // ── Manifest: tree with drill-down, or a flat list with a path filter ──
  function folderExists(path) {
    return path === "" || manifest.files.some(function (file) { return file.path.startsWith(path + "/") || file.kind === "dir" && file.path === path; });
  }
  // Direct children of a folder: sub-folders (with their recursive file count and size) and files.
  function listing(path) {
    var prefix = path === "" ? "" : path + "/";
    var folders = new Map(), files = [];
    manifest.files.forEach(function (file) {
      if (!file.path.startsWith(prefix) || file.path === path) { return; }
      var rest = file.path.slice(prefix.length), cut = rest.indexOf("/");
      var name = cut === -1 ? rest : rest.slice(0, cut);
      if (cut === -1 && file.kind === "file") { files.push(file); return; }
      if (!folders.has(name)) { folders.set(name, { path: prefix + name, files: 0, size: 0 }); }
      if (file.kind === "file") { var entry = folders.get(name); entry.files++; entry.size += Number(file.size); }
    });
    return { folders: Array.from(folders.values()), files: files };
  }
  function folderHash(path) {
    var hash = routeHash(currentDetailId);
    return path === "" ? hash : hash + (hash.indexOf("?") === -1 ? "?" : "&") + "path=" + encodeURIComponent(path);
  }
  // The open folder is part of the address but replaces the entry, so Back still leaves the artifact in one step.
  function replaceFolderRoute() { window.history.replaceState(null, "", folderHash(folder)); }
  function folderLink(text, path) {
    var link = element("a", text, null);
    link.href = folderHash(path); link.dataset.folder = path;
    return link;
  }
  function folderRow(entry, label) {
    var row = element("tr", null, null);
    row.dataset.path = entry.path;
    var box = element("div", null, "path-cell is-dir");
    box.append(overlays.iconNode("folder", ""), folderLink(label + "/", entry.path),
      element("span", entry.files === 1 ? "1 file" : entry.files + " files", "xs muted"), overlays.iconNode("chevron-right", "icon-sm"));
    var cell = element("td", null, null); cell.appendChild(box);
    row.append(cell, element("td", entry.files === 0 ? "—" : bytes(entry.size), "col-num"), element("td", null, null));
    return row;
  }
  function fileRow(file, label) {
    var row = element("tr", null, null);
    row.dataset.path = file.path;
    var name = element("span", null, "path-name");
    name.title = file.path;
    if (label !== null) { name.textContent = label; }
    else {
      var cut = file.path.lastIndexOf("/") + 1;
      if (cut > 0) { name.appendChild(element("span", file.path.slice(0, cut), "path-dir")); }
      name.append(file.path.slice(cut));
    }
    var box = element("div", null, "path-cell");
    box.append(overlays.iconNode("file", ""), name);
    var cell = element("td", null, null); cell.appendChild(box);
    var action = element("td", null, "col-actions");
    if (currentDetailInfo.state === "ready") {
      var link = element("a", null, "btn btn-sm btn-ghost");
      link.href = API + "/artifacts/" + manifest.id + "/files/" + file.path.split("/").map(encodeURIComponent).join("/") + "/content";
      link.setAttribute("aria-label", "Download " + file.path);
      link.append(overlays.iconNode("download", "icon-sm"), element("span", "Download", "hide-sm"));
      action.appendChild(link);
    }
    row.append(cell, element("td", bytes(file.size), "col-num"), action);
    return row;
  }
  function renderCrumbs() {
    var crumbs = $("manifest-crumbs"), parts = folder === "" ? [] : folder.split("/");
    var rootLabel = currentDetailInfo.name || currentDetailId;
    crumbs.textContent = "";
    [rootLabel].concat(parts).forEach(function (part, index) {
      if (index > 0) { crumbs.appendChild(element("span", "/", "crumb-sep")); }
      if (index === parts.length) {
        var here = element("span", part, "crumb-here"); here.setAttribute("aria-current", "location"); crumbs.appendChild(here);
      } else { crumbs.appendChild(folderLink(part, parts.slice(0, index).join("/"))); }
    });
    crumbs.appendChild(element("span", "/", "crumb-sep"));
  }
  function renderManifest() {
    var loaded = manifest !== null && manifest.id === currentDetailId && currentDetailInfo !== null;
    var flat = layout === "flat";
    layoutButtons.forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.layout === layout)); });
    $("manifest-tools").hidden = !loaded;
    $("manifest-table").hidden = !loaded;
    $("manifest-skeleton").hidden = loaded;
    $("manifest-path").hidden = !loaded || flat;
    $("files-retry-button").hidden = true;
    var foot = $("manifest-foot");
    foot.className = "list-foot";
    foot.hidden = !loaded && currentDetailInfo === null;
    if (!loaded) {
      $("file-list").textContent = "";
      foot.dataset.state = "loading";
      setText("files-status", currentDetailInfo === null ? "" : "Loading file manifest…");
      return;
    }
    var rows = document.createDocumentFragment();
    if (flat) {
      var needle = $("manifest-filter").value.toLowerCase();
      var shown = manifest.files.filter(function (file) { return needle === "" || file.path.toLowerCase().includes(needle); });
      shown.forEach(function (file) { rows.appendChild(file.kind === "dir" ? folderRow({ path: file.path, files: 0, size: 0 }, file.path) : fileRow(file, null)); });
      foot.dataset.state = "end";
      if (needle === "") { foot.classList.add("list-end"); }
      setText("files-status", needle === "" ? "End of manifest · " + paths(manifest.files.length) : shown.length === 0 ? "No path contains “" + $("manifest-filter").value + "”" :
        shown.length + " of " + paths(manifest.files.length) + " match");
    } else {
      var content = listing(folder);
      if (folder !== "") {
        var up = element("tr", null, null);
        var box = element("div", null, "path-cell");
        box.append(overlays.iconNode("arrow-up", ""), folderLink("..", folder.slice(0, Math.max(0, folder.lastIndexOf("/")))), element("span", "Parent folder", "xs muted"));
        var cell = element("td", null, null); cell.appendChild(box);
        up.append(cell, element("td", null, null), element("td", null, null));
        rows.appendChild(up);
      }
      content.folders.forEach(function (entry) { rows.appendChild(folderRow(entry, entry.path.slice(entry.path.lastIndexOf("/") + 1))); });
      content.files.forEach(function (file) { rows.appendChild(fileRow(file, file.path.slice(file.path.lastIndexOf("/") + 1))); });
      renderCrumbs();
      var size = manifest.files.reduce(function (sum, file) { return file.kind === "file" && file.path.startsWith(folder === "" ? "" : folder + "/") ? sum + Number(file.size) : sum; }, 0);
      setText("manifest-folder-summary", "This folder: " + (content.folders.length === 0 ? "" : count(content.folders.length, "folder") + " · ") +
        count(content.files.length, "file") + " · " + bytes(size));
      foot.dataset.state = content.folders.length + content.files.length === 0 ? "empty" : "tree";
      setText("files-status", content.folders.length + content.files.length === 0 ? "This folder is empty." : "");
    }
    $("file-list").replaceChildren(rows);
  }
  function paths(n) { return n === 1 ? "1 path" : n + " paths"; }
  function count(n, noun) { return n + " " + noun + (n === 1 ? "" : "s"); }
  function openFolder(path, focusList) {
    if (manifest === null || !folderExists(path)) { return; }
    layout = "tree"; folder = path; $("manifest-filter").value = "";
    replaceFolderRoute();
    renderManifest();
    if (focusList) {
      var first = document.querySelector("#file-list a");
      if (first !== null) { first.focus({ preventScroll: true }); }
    }
  }
  function setLayout(next) {
    if (manifest === null || next === layout) { return; }
    layout = next;
    if (next === "tree") { $("manifest-filter").value = ""; }
    renderManifest();
  }

  // ── Content handoff ────────────────────────────────────────────────────
  // Internal artifacts use a single-use form POST to their content endpoint.
  function openArtifact(id, knownInfo) {
    if (!ID_RE.test(id) || accessMutations.has(id)) { return; }
    var epoch = ctx.sessionEpoch;
    var generation = ++openGeneration;
    var infoRequest = knownInfo === null ? apiFetch(current.artifact(id)) : Promise.resolve(knownInfo);
    infoRequest.then(function (info) {
      if (epoch !== ctx.sessionEpoch || generation !== openGeneration) { return; }
      var url = contentUrl(info, window.location.origin);
      if (url === null) { throw new Error("content-unavailable"); }
      if (info.visibility !== "internal") { window.location.assign(url); return; }
      return apiFetch(current.grant(id)).then(function (body) {
        if (epoch === ctx.sessionEpoch && generation === openGeneration) { postGrantHandoff(url, body.grant); }
      });
    }).catch(function (error) {
      if (epoch === ctx.sessionEpoch && generation === openGeneration) { fail(id, "Open failed (" + errorLabel(error) + ")."); }
    });
  }
  function postGrantHandoff(content, grant) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = content.replace(/\/$/, "") + "/__manure/grant";
    form.enctype = "application/x-www-form-urlencoded";
    var field = document.createElement("input");
    field.type = "hidden";
    field.name = "grant";
    field.value = grant;
    form.appendChild(field); document.body.appendChild(form);
    form.submit(); form.remove();
  }
  // Failures of an action started on this page show on this page; actions started from the list report there.
  function fail(id, message) {
    if (currentDetailId === id && !section.hidden) { detailNotice("danger", message, false); }
    else { failVisible(message); }
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  // info: the artifact as last observed (catalogue row or detail), named in the confirmation.
  function deleteArtifact(id, info) {
    if (!ID_RE.test(id) || deleting.has(id) || accessMutations.has(id)) { return; }
    var epoch = ctx.sessionEpoch;
    overlays.confirmAction({ title: "Delete artifact?", danger: true, icon: "trash", confirmLabel: "Delete artifact", paragraphs: [
      [{ strong: info.name || id }, { sub: id }],
      "The artifact, its " + (info.file_count === 1 ? "1 file" : info.file_count + " files") + " (" + bytes(info.total_bytes) + ") and every link to it stop working immediately. This cannot be undone."
    ] }).then(function (confirmed) {
      if (confirmed && epoch === ctx.sessionEpoch && !deleting.has(id) && !accessMutations.has(id)) { removeArtifact(id, epoch); }
    });
  }
  function removeArtifact(id, epoch) {
    deleting.add(id);
    document.querySelectorAll('button[data-action="delete"][data-artifact-id="' + id + '"]').forEach(function (button) { button.disabled = true; });
    if (currentDetailId === id) { updateDetailActions(); detailNotice("info", "Deleting artifact…", false); }
    apiFetch(current.remove(id)).then(function () {
      if (epoch !== ctx.sessionEpoch) { return; }
      overlays.toast("Artifact deleted");
      if (currentDetailId === id) {
        detailGeneration++; openGeneration++; hidePassword();
        currentDetailId = null; currentDetailInfo = null;
        catalogue.showCatalogue();
        window.history.replaceState(null, "", routeHash(null));
      }
      invalidateCatalogue();
    }).catch(function (error) {
      if (epoch === ctx.sessionEpoch) { fail(id, "Delete failed (" + errorLabel(error) + "). The artifact is unchanged unless the request reached the server; reload to check."); }
    }).finally(function () {
      deleting.delete(id);
      if (epoch === ctx.sessionEpoch) {
        document.querySelectorAll('button[data-action="delete"][data-artifact-id="' + id + '"]').forEach(function (button) { button.disabled = false; });
        if (currentDetailId === id) { updateDetailActions(); }
      }
    });
  }

  // ── External password ──────────────────────────────────────────────────
  function hidePassword() {
    revealGeneration++;
    passwordRead = null;
    $("external-password").textContent = "";
    $("password-mask").hidden = false;
    $("password-box").dataset.revealed = "false";
    setText("password-reveal-text", "Reveal");
    $("password-reveal-button").setAttribute("aria-label", "Reveal password");
    setText("password-hint", PASSWORD_HINT);
  }
  function revealPassword(password) {
    $("external-password").textContent = password;
    $("password-mask").hidden = true;
    $("password-box").dataset.revealed = "true";
    setText("password-reveal-text", "Hide");
    $("password-reveal-button").setAttribute("aria-label", "Hide password");
    setText("password-hint", REVEALED_HINT);
  }
  function revealed() { return $("password-box").dataset.revealed === "true"; }
  function takeExternalPassword(body, required) {
    if (!body || typeof body !== "object" || Array.isArray(body)) { throw new Error("bad-response"); }
    var password = body.external_password;
    delete body.external_password;
    if (!required) { return null; }
    if (typeof password !== "string" || password.length !== PASSWORD_LENGTH || !PASSWORD_PATTERN.test(password)) { throw new Error("bad-response"); }
    return password;
  }
  function passwordAvailable(id) {
    return id !== null && currentDetailInfo !== null && currentDetailInfo.visibility === "external" &&
      !accessMutations.has(id) && !deleting.has(id) && passwordRead === null;
  }
  // Reads the current password (no rotation, no revocation) and hands it to use() while this view still asked for it.
  function readPassword(id, use) {
    accessNotice(null);
    var request = { id: id, epoch: ctx.sessionEpoch, generation: detailGeneration, reveal: revealGeneration };
    passwordRead = request; updateDetailActions();
    apiFetch(current.externalPassword(id)).then(function (body) {
      var password = takeExternalPassword(body, body.external_password !== null);
      if (!canReveal(id, request)) { return; }
      if (password === null) { accessNotice("warn", HASH_ONLY, false); return; }
      use(password);
      password = null;
    }).catch(function (error) {
      if (canReveal(id, request)) { accessNotice("danger", "The current password could not be loaded (" + errorLabel(error) + "). No password was rotated.", false); }
    }).finally(function () {
      if (passwordRead === request) { passwordRead = null; updateDetailActions(); }
    });
  }
  function onReveal() {
    var id = currentDetailId;
    if (revealed()) { hidePassword(); updateDetailActions(); return; }
    if (!passwordAvailable(id)) { return; }
    readPassword(id, revealPassword);
  }
  function onCopyPassword() {
    var id = currentDetailId;
    if (revealed()) { overlays.copyText("External password", $("external-password").textContent, "External password copied"); return; }
    if (!passwordAvailable(id)) { return; }
    readPassword(id, function (password) { overlays.copyText("External password", password, "External password copied"); });
  }

  // ── Mutations (access mode, rotation, name, expiry) ────────────────────
  // clearPassword: access changes and rotation replace the password, so a shown one is hidden first.
  function beginMutation(id, message, notify, clearPassword) {
    openGeneration++;
    if (clearPassword) { hidePassword(); }
    var mutation = { epoch: ctx.sessionEpoch, generation: detailGeneration, reveal: revealGeneration, refreshNeeded: true };
    accessMutations.set(id, mutation);
    invalidateCatalogue(); updateDetailActions();
    notify("info", message, false);
    return mutation;
  }
  function isMutationView(id, mutation) {
    return mutation.epoch === ctx.sessionEpoch && mutation.generation === detailGeneration &&
      id === currentDetailId && readRoute().id === id;
  }
  function canReveal(id, mutation) {
    return isMutationView(id, mutation) && mutation.reveal === revealGeneration;
  }
  // outcome: { failed, text }. A failed or unconfirmed change re-reads the artifact, so the page shows the
  // server's state; when that read fails too, the controls stay disabled until an explicit reload.
  function settleMutation(id, mutation, outcome, notify) {
    invalidateCatalogue();
    if (!ctx.authenticated || readRoute().id !== id) { return Promise.resolve(); }
    var epoch = ctx.sessionEpoch;
    if (!mutation.refreshNeeded && epoch === mutation.epoch && currentDetailId === id) {
      notify(null); overlays.toast(outcome.text);
      return Promise.resolve();
    }
    var generation = ++detailGeneration;
    var text = epoch !== mutation.epoch ? "A previous change finished. Reveal the external password if it is needed." : outcome.text;
    var failed = outcome.failed || epoch !== mutation.epoch;
    notify("info", text + " Refreshing current metadata…", false);
    return apiFetch(current.artifact(id)).then(function (info) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || readRoute().id !== id) { return; }
      renderDetail(info, id); loadFiles();
      if (failed) { notify("danger", text, false); } else { notify(null); overlays.toast(text); }
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || readRoute().id !== id) { return; }
      currentDetailInfo = null; accessDraft = null;
      $("detail-access").replaceChildren(element("span", "Access unknown", "chip chip-outline"));
      updateDetailActions();
      notify("danger", text + " Current metadata could not be refreshed (" + errorLabel(error) + "). Reload before changing the artifact again; if External is enabled, reveal its password after reloading.", true);
    });
  }
  function releaseMutation(id, mutation) {
    if (accessMutations.get(id) === mutation) { accessMutations.delete(id); }
    if (currentDetailId === id) { updateDetailActions(); }
    if (ctx.authenticated && readRoute().id === null) { renderList(); }
  }
  function selectAccess(mode) {
    var info = currentDetailInfo;
    if (info === null || info.state !== "ready" || currentDetailId === null || accessMutations.has(currentDetailId) || deleting.has(currentDetailId)) { return; }
    accessDraft = mode;
    if (mode !== info.visibility) { hidePassword(); }
    accessNotice(null);
    updateDetailActions();
  }
  // Every access change revokes grants: it is sent only after the in-app confirmation, for the same session and view.
  function onAccessSubmit(event) {
    event.preventDefault();
    var id = currentDetailId, info = currentDetailInfo, visibility = accessDraft;
    if (id === null || info === null || info.state !== "ready" || accessMutations.has(id) || deleting.has(id) ||
        MODES.indexOf(visibility) === -1 || visibility === info.visibility) { return; }
    var epoch = ctx.sessionEpoch, generation = detailGeneration;
    overlays.confirmAction({
      title: visibility === "public" ? "Make this artifact public?" : "Change access to " + MODE_LABELS[visibility] + "?",
      danger: false, icon: null, confirmLabel: "Make " + visibility, paragraphs: [
        [READERS[visibility][0], { strong: info.name || id }, " (" + (info.file_count === 1 ? "1 file" : info.file_count + " files") + ")" + READERS[visibility][1]],
        "Changing the access mode revokes " + (info.visibility === "external" ? "the external password and " : "") + "every existing content grant."
      ] }).then(function (confirmed) {
      if (confirmed && epoch === ctx.sessionEpoch && generation === detailGeneration && currentDetailId === id &&
          accessDraft === visibility && !accessMutations.has(id) && !deleting.has(id)) { saveAccess(id, visibility); }
    });
  }
  function saveAccess(id, visibility) {
    var mutation = beginMutation(id, "Saving access mode…", accessNotice, true);
    apiFetch(current.access(id, visibility)).then(function (body) {
      var password = takeExternalPassword(body, visibility === "external");
      if (body.artifact_id !== id || body.visibility !== visibility || body.state !== "ready") { throw new Error("bad-response"); }
      var sameView = isMutationView(id, mutation);
      var showPassword = canReveal(id, mutation);
      if (sameView) {
        renderDetail(body, id);
        if (password !== null && showPassword) { revealPassword(password); $("password-reveal-button").focus(); }
      }
      password = null;
      mutation.refreshNeeded = !sameView;
      return { failed: false, text: visibility === "external" && showPassword ? "Access mode saved · External · password revealed" : "Access mode saved · " + MODE_LABELS[visibility] };
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return { failed: true, text: "Access change could not be confirmed (" + errorLabel(error) + "). It may have been applied; no change was retried." };
    }).then(function (outcome) {
      return settleMutation(id, mutation, outcome, accessNotice);
    }).finally(function () { releaseMutation(id, mutation); });
  }
  function rotatable(id) {
    return id !== null && currentDetailId === id && currentDetailInfo !== null && currentDetailInfo.visibility === "external" &&
      !accessMutations.has(id) && !deleting.has(id);
  }
  // Rotation revokes the current password and every grant made with it: it runs only after the in-app confirmation,
  // and only for the same session and the same artifact view that asked.
  function onRotate() {
    var id = currentDetailId;
    if (!rotatable(id)) { return; }
    var info = currentDetailInfo, epoch = ctx.sessionEpoch, generation = detailGeneration;
    overlays.confirmAction({ title: "Rotate the external password?", danger: true, icon: "refresh", confirmLabel: "Rotate password", paragraphs: [
      ["A new password is generated for ", { strong: info.name || id }, "."],
      "The current password stops working immediately and every existing content grant is revoked: readers who already unlocked the artifact must enter the new password."
    ] }).then(function (confirmed) {
      if (confirmed && epoch === ctx.sessionEpoch && generation === detailGeneration && rotatable(id)) { rotate(id); }
    });
  }
  function rotate(id) {
    var mutation = beginMutation(id, "Rotating the external password…", accessNotice, true);
    apiFetch(current.rotate(id)).then(function (body) {
      var password = takeExternalPassword(body, true);
      var showPassword = canReveal(id, mutation);
      if (showPassword) { revealPassword(password); }
      password = null;
      mutation.refreshNeeded = !isMutationView(id, mutation);
      return { failed: false, text: showPassword ? "Password rotated · new password revealed" : "Password rotated. Reveal it to share it." };
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return { failed: true, text: "Rotation could not be confirmed (" + errorLabel(error) + "). The old password may have been revoked; reveal the password to see the current value." };
    }).then(function (outcome) {
      return settleMutation(id, mutation, outcome, accessNotice);
    }).finally(function () { releaseMutation(id, mutation); });
  }
  // Name and expiry: one PatchArtifact each; the response is the new metadata.
  function patchMetadata(id, descriptor, what) {
    var mutation = beginMutation(id, "Saving " + what.toLowerCase() + "…", detailNotice, false);
    apiFetch(descriptor).then(function (body) {
      if (!body || body.artifact_id !== id) { throw new Error("bad-response"); }
      var sameView = isMutationView(id, mutation);
      if (sameView) { renderDetail(body, id); }
      mutation.refreshNeeded = !sameView;
      return { failed: false, text: what + " saved" };
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return { failed: true, text: what + " could not be confirmed (" + errorLabel(error) + "). It may have been applied; no change was retried." };
    }).then(function (outcome) {
      return settleMutation(id, mutation, outcome, detailNotice);
    }).finally(function () { releaseMutation(id, mutation); });
  }
  function editable(id) {
    return id !== null && currentDetailId === id && currentDetailInfo !== null && !accessMutations.has(id) && !deleting.has(id);
  }
  function startRename() {
    if (!editable(currentDetailId)) { return; }
    section.dataset.editing = "name";
    $("rename-form").hidden = false;
    $("rename-input").value = currentDetailInfo.name;
    $("rename-input").removeAttribute("aria-invalid");
    $("rename-input").focus(); $("rename-input").select();
  }
  function stopRename(restoreFocus) {
    if (section.dataset.editing !== "name") { return; }
    delete section.dataset.editing;
    $("rename-form").hidden = true;
    if (restoreFocus) { $("rename-button").focus(); }
  }
  function onRenameSubmit(event) {
    event.preventDefault();
    var id = currentDetailId, name = $("rename-input").value;
    if (!editable(id)) { return; }
    if (name.length === 0) { $("rename-input").setAttribute("aria-invalid", "true"); $("rename-input").focus(); return; }
    var unchanged = name === currentDetailInfo.name;
    stopRename(true);
    if (!unchanged) { patchMetadata(id, current.rename(id, name), "Name"); }
  }
  function localInput(date) {
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }
  // Seconds from now for the chosen expiry: null clears it; NaN marks an unusable custom time.
  function chosenExpiry() {
    var choice = $("expiry-select").value;
    if (choice === "never") { return null; }
    if (choice !== "custom") { return Number(choice); }
    var seconds = Math.round((Date.parse($("expiry-custom").value) - Date.now()) / 1000);
    return Number.isFinite(seconds) && seconds >= MIN_TTL_S && seconds <= MAX_TTL_S ? seconds : NaN;
  }
  function updateExpiryNote() {
    var custom = $("expiry-select").value === "custom", seconds = chosenExpiry();
    $("expiry-custom").hidden = !custom;
    $("expiry-custom").setAttribute("aria-invalid", String(custom && Number.isNaN(seconds)));
    setText("expiry-note", seconds === null ? "Never expires · readers keep access until it is deleted" : Number.isNaN(seconds) ?
      "Choose a time between one minute and 365 days from now." : dateFormat.format(new Date(Date.now() + seconds * 1000)) + " · access ends at that moment for every reader");
  }
  function startExpiry() {
    if (!editable(currentDetailId)) { return; }
    var expires = currentDetailInfo.expires_at;
    section.dataset.editing = "expiry";
    $("meta-expires-view").hidden = true; $("meta-expires-edit").hidden = false; $("expiry-note").hidden = false; $("expiry-note-term").hidden = false;
    $("expiry-select").value = expires === null || expires === undefined ? "never" : "custom";
    $("expiry-custom").value = expires === null || expires === undefined ? "" : localInput(new Date(expires));
    updateExpiryNote();
    $("expiry-select").focus();
  }
  function stopExpiry(restoreFocus) {
    if (section.dataset.editing !== "expiry") { return; }
    delete section.dataset.editing;
    $("meta-expires-view").hidden = false; $("meta-expires-edit").hidden = true; $("expiry-note").hidden = true; $("expiry-note-term").hidden = true;
    if (restoreFocus) { $("expiry-change-button").focus(); }
  }
  function onExpirySubmit(event) {
    event.preventDefault();
    var id = currentDetailId, seconds = chosenExpiry();
    if (!editable(id)) { return; }
    if (Number.isNaN(seconds)) { updateExpiryNote(); $("expiry-custom").focus(); return; }
    stopExpiry(true);
    patchMetadata(id, current.expiry(id, seconds), "Expiry");
  }

  // Legacy status-line copy helper, kept for the upload view (upload.js).
  function copy(value, statusId, message) {
    if (!value) { return; }
    if (!window.navigator.clipboard || typeof window.navigator.clipboard.writeText !== "function") {
      setText(statusId, "Clipboard is unavailable here. Select the value and copy it manually."); return;
    }
    var epoch = ctx.sessionEpoch;
    var generation = detailGeneration;
    window.navigator.clipboard.writeText(value).then(function () {
      if (epoch === ctx.sessionEpoch && generation === detailGeneration) { setText(statusId, message); }
    }).catch(function () {
      if (epoch === ctx.sessionEpoch && generation === detailGeneration) { setText(statusId, "Clipboard access was denied. Select the value and copy it manually."); }
    });
  }
  function copyLink() {
    var url = currentDetailInfo === null ? null : contentUrl(currentDetailInfo, window.location.origin);
    if (url !== null) { overlays.copyText("Content link", url, "Content link copied"); }
  }
  function copyId() { if (currentDetailInfo !== null) { overlays.copyText("Artifact ID", currentDetailId, "Artifact ID copied"); } }
  function reload() {
    var id = readRoute().id;
    if (id !== null && !accessMutations.has(id) && !deleting.has(id)) { showDetail(id); }
  }
  // Plain left clicks stay in the app; modified clicks keep the link's own behaviour.
  function plainClick(event) { return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey; }
  function back(event) { if (plainClick(event)) { event.preventDefault(); catalogue.backToList(); } }

  $("detail-back-button").addEventListener("click", back);
  $("detail-missing-back").addEventListener("click", back);
  $("detail-retry-button").addEventListener("click", reload);
  $("reload-button").addEventListener("click", reload);
  $("detail-reload-action").addEventListener("click", reload);
  $("access-refresh-button").addEventListener("click", reload);
  $("detail-notice-close").addEventListener("click", function () { detailNotice(null); });
  $("open-button").addEventListener("click", function () { if (currentDetailId !== null) { openArtifact(currentDetailId, currentDetailInfo); } });
  $("delete-button").addEventListener("click", function () { if (currentDetailId !== null && currentDetailInfo !== null) { deleteArtifact(currentDetailId, currentDetailInfo); } });
  $("copy-link-button").addEventListener("click", copyLink);
  $("meta-copy-link-button").addEventListener("click", copyLink);
  $("copy-id-button").addEventListener("click", copyId);
  $("meta-copy-id-button").addEventListener("click", copyId);
  $("copy-fetch-button").addEventListener("click", function () {
    if (currentDetailInfo !== null) { overlays.copyText("CLI download command", "manure fetch " + currentDetailId + " ./" + currentDetailId, "Command copied"); }
  });
  modeButtons.forEach(function (button) { button.addEventListener("click", function () { selectAccess(button.dataset.mode); }); });
  $("access-discard-button").addEventListener("click", function () { if (currentDetailInfo !== null) { selectAccess(currentDetailInfo.visibility); } });
  $("access-form").addEventListener("submit", onAccessSubmit);
  $("password-reveal-button").addEventListener("click", onReveal);
  $("password-copy-button").addEventListener("click", onCopyPassword);
  $("rotate-button").addEventListener("click", onRotate);
  $("rename-button").addEventListener("click", startRename);
  $("rename-form").addEventListener("submit", onRenameSubmit);
  $("rename-cancel-button").addEventListener("click", function () { stopRename(true); });
  $("rename-input").addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); stopRename(true); } });
  $("rename-input").addEventListener("input", function () { $("rename-input").removeAttribute("aria-invalid"); });
  $("expiry-change-button").addEventListener("click", startExpiry);
  $("expiry-form").addEventListener("submit", onExpirySubmit);
  $("expiry-cancel-button").addEventListener("click", function () { stopExpiry(true); });
  $("expiry-select").addEventListener("change", updateExpiryNote);
  $("expiry-custom").addEventListener("input", updateExpiryNote);
  $("expiry-form").addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); stopExpiry(true); } });
  layoutButtons.forEach(function (button) { button.addEventListener("click", function () { setLayout(button.dataset.layout); }); });
  $("manifest-filter").addEventListener("input", function () {
    if ($("manifest-filter").value !== "") { layout = "flat"; }
    renderManifest();
  });
  $("files-retry-button").addEventListener("click", loadFiles);
  document.addEventListener("click", function (event) {
    var link = event.target.closest("#detail-section a[data-folder]");
    if (link === null || !plainClick(event)) { return; }
    event.preventDefault();
    openFolder(link.dataset.folder, link.closest("#file-list") !== null);
  });

  // Fences every in-flight detail, open and reveal result (navigation, sign-out).
  function invalidate() { detailGeneration++; openGeneration++; hidePassword(); }
  function leave() {
    invalidate();
    resetView();
    section.hidden = true;
  }
  function clear() {
    resetView();
    setPageState("loading", null);
    updateDetailActions();
  }
  function cancelOpen() { openGeneration++; hidePassword(); }

  return { showDetail: showDetail, openArtifact: openArtifact, deleteArtifact: deleteArtifact, copy: copy,
    invalidate: invalidate, leave: leave, clear: clear, cancelOpen: cancelOpen };
}
