/* Manure dashboard: same-origin management only; uploaded bytes never render here.
 * Credentials and one-time passwords stay transient. No HTML injection or browser storage.
 */
"use strict";

(function (document, window, fetch) {
  var API = "/api/v1";
  var ID_RE = /^[0-9a-f]{32}$/;
  var PAGE_LIMIT = 25;
  var SORTS = ["name", "kind", "visibility", "state", "total_bytes", "file_count", "created_at", "expires_at", "created_by_user"];
  var sessionEpoch = 0;
  var authenticated = false;
  var listGeneration = 0;
  var detailGeneration = 0;
  var revealGeneration = 0;
  var openGeneration = 0;
  var pendingPage = null;
  var nextCursor = null;
  var loadedKey = "";
  var summaries = [];
  var listError = false;
  var observer = null;
  var currentDetailId = null;
  var currentDetailInfo = null;
  var state = readRoute().state;
  var deleting = new Set();
  var accessMutations = new Map();

  function $(id) { return document.getElementById(id); }
  function setText(id, text) { $(id).textContent = text; }
  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== null) { node.textContent = text; }
    if (className !== null) { node.className = className; }
    return node;
  }
  function errorLabel(error) {
    return error && /^[a-z0-9-]+$/.test(error.message) ? error.message : "network-error";
  }
  function errorCodeOf(res, body) {
    var code = body && body.error && body.error.code;
    return typeof code === "string" && /^[a-z0-9-]+$/.test(code) ? code : "http-" + res.status;
  }
  function apiFetch(path, options) {
    var epoch = sessionEpoch;
    var opts = Object.assign({}, options, { credentials: "same-origin" });
    opts.headers = Object.assign({ Accept: "application/json" }, options.headers);
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401 && path !== "/login") {
        if (epoch === sessionEpoch) { showLoggedOut(); }
        throw new Error("unauthorized");
      }
      return res;
    });
  }
  function jsonResponse(res) {
    return res.json().catch(function () { throw new Error("bad-response"); }).then(function (body) {
      if (!res.ok) { throw new Error(errorCodeOf(res, body)); }
      return body;
    });
  }
  function bytes(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) { return "—"; }
    var units = ["B", "KiB", "MiB", "GiB", "TiB"];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
    return (index === 0 ? String(value) : value.toFixed(1)) + " " + units[index];
  }
  function dateText(value, empty) {
    if (value === null || value === undefined) { return empty; }
    var date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
  }
  function expired(item) { return typeof item.expires_at === "string" && Date.parse(item.expires_at) <= Date.now(); }
  function contentUrl(info) {
    if (typeof info.content_url !== "string" || info.content_url === "") { return null; }
    try {
      var url = new URL(info.content_url);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
          !ID_RE.test(info.artifact_id) || url.search || url.hash) { return null; }
      var subdomain = url.hostname.split(".")[0] === info.artifact_id && url.pathname === "/";
      var pathMode = url.origin === window.location.origin &&
        (url.pathname === "/view/" + info.artifact_id || url.pathname === "/view/" + info.artifact_id + "/");
      if (!subdomain && !pathMode) { return null; }
      return url.href;
    } catch (_error) { return null; }
  }

  function readRoute() {
    var hash = window.location.hash;
    var queryAt = hash.indexOf("?");
    var params = new URLSearchParams(queryAt === -1 ? "" : hash.slice(queryAt + 1));
    var sort = params.get("sort");
    var visibility = params.get("access");
    var itemState = params.get("state");
    var direction = params.get("direction");
    var match = /^#\/artifact\/([0-9a-f]{32})(?:\?|$)/.exec(hash);
    return { id: match ? match[1] : null, state: {
      q: params.get("q") || "",
      visibility: ["internal", "external", "public"].indexOf(visibility) !== -1 ? visibility : "",
      itemState: ["ready", "uploading", "publishing"].indexOf(itemState) !== -1 ? itemState : "",
      includeExpired: params.get("expired") === "true",
      sort: SORTS.indexOf(sort) !== -1 ? sort : "created_at",
      direction: direction === "asc" || direction === "desc" ? direction : "desc"
    } };
  }
  function stateParams(value) {
    var params = new URLSearchParams();
    if (value.q) { params.set("q", value.q); }
    if (value.visibility) { params.set("access", value.visibility); }
    if (value.itemState) { params.set("state", value.itemState); }
    if (value.includeExpired) { params.set("expired", "true"); }
    if (value.sort !== "created_at" || value.direction !== "desc") {
      params.set("sort", value.sort); params.set("direction", value.direction);
    }
    return params;
  }
  function routeHash(id) {
    var query = stateParams(state).toString();
    return (id ? "#/artifact/" + id : "#/artifacts") + (query ? "?" + query : "");
  }
  function updateControls() {
    $("filter-text").value = state.q;
    $("filter-visibility").value = state.visibility;
    $("filter-state").value = state.itemState;
    $("include-expired").checked = state.includeExpired;
    document.querySelectorAll("[data-sort]").forEach(function (button) {
      var selected = button.dataset.sort === state.sort;
      button.closest("th").setAttribute("aria-sort", selected ? state.direction === "asc" ? "ascending" : "descending" : "none");
      var arrow = button.querySelector(".sort-indicator");
      if (arrow !== null) { arrow.textContent = selected ? state.direction === "asc" ? "↑" : "↓" : "↕"; }
    });
    document.querySelectorAll("[data-visibility-preset]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.visibilityPreset === state.visibility));
    });
    var selected = document.querySelector('[data-sort="' + state.sort + '"]');
    setText("sort-summary", "Sorted by " + selected.getAttribute("aria-label").replace(/^Sort by /, "") + (state.direction === "asc" ? " ↑" : " ↓"));
  }
  function invalidateNavigation() {
    listGeneration++; pendingPage = null; detailGeneration++; openGeneration++;
    if (observer !== null) { observer.disconnect(); }
    hideRotateOutput();
  }
  function navigateList(next) {
    invalidateNavigation();
    loadedKey = "";
    state = next;
    var hash = routeHash(null);
    if (window.location.hash === hash) { handleRoute(); }
    else { window.location.hash = hash; }
  }
  function handleRoute() {
    if (!authenticated) { return; }
    var route = readRoute();
    var changed = JSON.stringify(route.state) !== JSON.stringify(state);
    state = route.state;
    if (changed) { updateControls(); }
    else {
      var draft = $("filter-text").value;
      updateControls();
      $("filter-text").value = draft;
    }
    if (route.id !== null) { showDetail(route.id); return; }
    detailGeneration++; openGeneration++; hideRotateOutput();
    currentDetailId = null; currentDetailInfo = null;
    $("detail-section").hidden = true;
    $("dashboard-section").hidden = false;
    if (loadedKey !== JSON.stringify(state)) { loadPage(true); }
    else {
      renderList();
      if (!listError) { setText("list-status", summaries.length + " artifacts shown" + (nextCursor !== null ? " · scroll to load more" : " · all matching artifacts loaded")); }
      watchList();
    }
  }

  function clearAccount() {
    sessionEpoch++; invalidateNavigation(); authenticated = false;
    summaries = []; loadedKey = ""; nextCursor = null; listError = false;
    currentDetailId = null; currentDetailInfo = null;
    if (observer !== null) { observer.disconnect(); }
    $("artifact-list").textContent = "";
    $("detail-list").textContent = "";
    $("file-list").textContent = "";
    setText("detail-name", "Artifact"); setText("detail-subtitle", "");
    setText("whoami-text", ""); setText("detail-status", ""); setText("list-status", "");
    setText("access-status", ""); $("access-refresh-button").hidden = true; updateDetailActions();
    $("list-error").hidden = true;
    $("detail-section").hidden = true;
    $("dashboard-section").hidden = true;
    $("whoami").hidden = true;
    $("workspace-shell").hidden = true;
  }
  function showLoggedOut() {
    clearAccount();
    $("session-section").hidden = true;
    $("login-section").hidden = false;
  }
  function checkSession() {
    var epoch = sessionEpoch;
    $("session-section").hidden = false;
    $("session-retry-button").disabled = true;
    $("session-retry-button").hidden = true;
    setText("session-status", "Checking dashboard session…");
    return apiFetch("/whoami", { method: "GET" }).then(jsonResponse).then(function (body) {
      if (epoch !== sessionEpoch) { return false; }
      if (typeof body.user_id !== "string" || !body.user_id) { throw new Error("bad-response"); }
      authenticated = true;
      $("session-section").hidden = true;
      $("login-section").hidden = true;
      $("workspace-shell").hidden = false;
      $("whoami").hidden = false;
      $("dashboard-section").hidden = false;
      setText("whoami-text", body.user_id);
      updateControls(); handleRoute();
      return true;
    }).catch(function (error) {
      if (epoch !== sessionEpoch || error.message === "unauthorized") { return false; }
      $("login-section").hidden = true;
      $("session-section").hidden = false;
      setText("session-status", "The service is unavailable (" + errorLabel(error) + "). This does not mean your session expired.");
      $("session-retry-button").hidden = false;
      return false;
    }).finally(function () { $("session-retry-button").disabled = false; });
  }
  function onLoginSubmit(event) {
    event.preventDefault();
    sessionEpoch++;
    var epoch = sessionEpoch;
    var token = $("token-input").value;
    $("token-input").value = "";
    $("login-error").hidden = true;
    var button = $("login-form").querySelector("button[type=submit]");
    button.disabled = true;
    var request = apiFetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token }) });
    token = "";
    request.then(jsonResponse).then(function () {
      if (epoch === sessionEpoch) { return checkSession(); }
    }).catch(function (error) {
      if (epoch !== sessionEpoch) { return; }
      setText("login-error", "Login failed (" + errorLabel(error) + ").");
      $("login-error").hidden = false;
    }).finally(function () { button.disabled = false; });
  }
  function onLogout() {
    openGeneration++;
    hideRotateOutput();
    var epoch = sessionEpoch;
    $("logout-button").disabled = true;
    apiFetch("/logout", { method: "POST" }).then(jsonResponse).then(function () {
      if (epoch === sessionEpoch) { showLoggedOut(); }
    }).catch(function (error) {
      if (epoch === sessionEpoch) { failVisible("Sign out could not be confirmed (" + errorLabel(error) + "). Retry to confirm sign out."); }
    }).finally(function () { $("logout-button").disabled = false; });
  }

  function listQuery(cursor, value) {
    var params = new URLSearchParams();
    params.set("limit", String(PAGE_LIMIT));
    params.set("sort_by", value.sort); params.set("direction", value.direction);
    if (cursor !== null) { params.set("cursor", cursor); }
    if (value.q) { params.set("q", value.q); }
    if (value.visibility) { params.set("visibility", value.visibility); }
    if (value.itemState) { params.set("state", value.itemState); }
    if (value.includeExpired) { params.set("include_expired", "true"); }
    return "/artifacts?" + params.toString();
  }
  function rowAction(label, action, item, handler) {
    var button = element("button", label, action === "delete" ? "danger" : null);
    button.type = "button"; button.dataset.action = action; button.dataset.artifactId = item.artifact_id;
    button.addEventListener("click", handler);
    return button;
  }
  function renderList() {
    var list = $("artifact-list");
    var active = document.activeElement;
    var focused = active !== null && list.contains(active) ? { id: active.dataset.artifactId, action: active.dataset.action } : null;
    var fragment = document.createDocumentFragment();
    summaries.forEach(function (item) {
      var row = element("tr", null, null);
      row.dataset.artifactId = item.artifact_id;
      var name = element("td", null, null);
      var details = rowAction("", "details", item, function () {
        invalidateNavigation(); window.location.hash = routeHash(item.artifact_id);
      });
      details.className = "record-open";
      var icon = element("span", item.kind === "dir" ? "▤" : "◇", "record-icon");
      icon.setAttribute("aria-hidden", "true");
      details.appendChild(icon);
      var title = element("span", null, null);
      title.appendChild(element("strong", item.name || item.artifact_id, null));
      title.appendChild(element("small", item.artifact_id, null));
      details.appendChild(title); name.appendChild(details); row.appendChild(name);
      [[item.kind, "type-badge"], [item.visibility, "type-badge"], [item.state, "status-badge " + item.state]].forEach(function (cell) {
        var td = element("td", null, null); td.appendChild(element("span", cell[0], cell[1])); row.appendChild(td);
      });
      row.appendChild(element("td", bytes(item.total_bytes), "numeric-cell"));
      row.appendChild(element("td", String(item.file_count), "numeric-cell"));
      row.appendChild(element("td", dateText(item.created_at, "Unknown"), "date-cell"));
      var expiry = element("td", dateText(item.expires_at, "Never"), "date-cell");
      if (expired(item)) { expiry.appendChild(element("span", "Expired", "status-badge expired")); }
      row.appendChild(expiry);
      row.appendChild(element("td", item.created_by_user, "owner-cell"));
      var actions = element("td", null, null);
      var group = element("div", null, "row-actions");
      var open = rowAction("Open", "open", item, function () { openArtifact(item.artifact_id, item); });
      open.dataset.visibility = item.visibility;
      open.disabled = item.state !== "ready" || expired(item) || contentUrl(item) === null || accessMutations.has(item.artifact_id);
      open.title = contentUrl(item) === null ? "Content hosting is not configured" : item.state !== "ready" ? "Upload is not ready" : expired(item) ? "Artifact expired" : "Open on its isolated content origin";
      group.appendChild(open);
      var remove = rowAction("Delete", "delete", item, function () { deleteArtifact(item.artifact_id); });
      remove.disabled = deleting.has(item.artifact_id) || accessMutations.has(item.artifact_id);
      group.appendChild(remove);
      actions.appendChild(group); row.appendChild(actions); fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
    if (focused !== null && focused.id) {
      var target = list.querySelector('button[data-artifact-id="' + focused.id + '"][data-action="' + focused.action + '"]');
      (target || $("results-panel")).focus({ preventScroll: true });
    }
    setText("loaded-count", String(summaries.length) + (nextCursor !== null ? "+" : ""));
    $("empty-state").hidden = summaries.length !== 0 || pendingPage !== null || listError;
    $("load-more-button").hidden = nextCursor === null || listError;
    $("load-more-button").disabled = pendingPage !== null;
  }
  function watchList() {
    if (observer !== null) { observer.disconnect(); }
    if (typeof IntersectionObserver === "undefined" || nextCursor === null || listError || pendingPage !== null || !authenticated || $("dashboard-section").hidden) { return; }
    var cursor = nextCursor;
    observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; }) && cursor === nextCursor) { loadPage(false); }
    }, { root: $("results-panel"), rootMargin: "200px" });
    observer.observe($("list-sentinel"));
  }
  function loadPage(reset) {
    if (!authenticated || (!reset && (pendingPage !== null || nextCursor === null || listError || loadedKey !== JSON.stringify(state)))) { return; }
    var generation = ++listGeneration;
    var epoch = sessionEpoch;
    var cursor = reset ? null : nextCursor;
    var value = Object.assign({}, state);
    pendingPage = generation; listError = false;
    $("list-error").hidden = true;
    $("retry-list-button").hidden = true;
    if (reset) { summaries = []; nextCursor = null; loadedKey = JSON.stringify(value); $("results-panel").scrollTop = 0; }
    setText("list-status", reset ? "Loading artifacts…" : "Loading more artifacts…");
    renderList();
    apiFetch(listQuery(cursor, value), { method: "GET" }).then(jsonResponse).then(function (body) {
      if (epoch !== sessionEpoch || generation !== listGeneration) { return; }
      if (!Array.isArray(body.artifacts) || (body.next_cursor !== null && body.next_cursor !== undefined && typeof body.next_cursor !== "string")) { throw new Error("bad-response"); }
      var next = body.next_cursor || null;
      if (cursor !== null && next === cursor) { throw new Error("repeated-cursor"); }
      var merged = new Map(summaries.map(function (item) { return [item.artifact_id, item]; }));
      body.artifacts.forEach(function (item) {
        if (!item || !ID_RE.test(item.artifact_id)) { throw new Error("bad-response"); }
        delete item.external_password;
        merged.set(item.artifact_id, item);
      });
      summaries = Array.from(merged.values()); nextCursor = next;
      setText("list-status", summaries.length + " artifacts shown" + (next !== null ? " · scroll to load more" : " · all matching artifacts loaded"));
    }).catch(function (error) {
      if (epoch !== sessionEpoch || generation !== listGeneration) { return; }
      listError = true;
      setText("list-status", "List failed (" + errorLabel(error) + ").");
      setText("list-error", "Could not load artifacts (" + errorLabel(error) + "). Loaded rows are preserved; retry when ready.");
      $("list-error").hidden = false;
      $("retry-list-button").hidden = false;
    }).finally(function () {
      if (epoch === sessionEpoch && generation === listGeneration) { pendingPage = null; renderList(); watchList(); }
    });
  }
  function failVisible(message) {
    setText("detail-status", message); setText("list-status", message);
    setText("list-error", message); $("list-error").hidden = false;
  }

  function addDetailRow(term, value) {
    $("detail-list").appendChild(element("dt", term, null));
    $("detail-list").appendChild(element("dd", value, null));
  }
  function updateDetailActions() {
    var info = currentDetailInfo;
    var busy = currentDetailId !== null && (accessMutations.has(currentDetailId) || deleting.has(currentDetailId));
    var ready = info !== null && info.state === "ready";
    var selected = $("access-mode").value;
    $("access-mode").disabled = info === null || !ready || busy;
    $("access-save-button").disabled = info === null || !ready || busy || selected === info.visibility;
    $("rotate-button").hidden = info === null || info.visibility !== "external";
    $("rotate-button").disabled = info === null || busy;
    $("delete-button").disabled = info === null || busy;
    $("open-button").disabled = info === null || !ready || busy || contentUrl(info) === null;
    var description = selected === "internal" ? "Only authenticated users can read this artifact, through the API or an internal access grant." : selected === "external" ? "Readers need the external password. Changing to External generates a password shown once. If it is lost, rotate to issue another." : "No Manure authentication is required for anyone who can reach the content URL.";
    setText("access-description", info !== null && !ready ? "Access changes are available after the upload is ready. " + description : description);
  }
  function renderDetail(info, id) {
    if (!info || info.artifact_id !== id || ["internal", "external", "public"].indexOf(info.visibility) === -1 ||
        ["uploading", "publishing", "ready"].indexOf(info.state) === -1) { throw new Error("bad-response"); }
    delete info.external_password;
    currentDetailId = id; currentDetailInfo = info;
    $("copy-id-button").disabled = false;
    $("detail-list").textContent = "";
    setText("detail-name", info.name || id);
    setText("detail-subtitle", id);
    [["Artifact ID", id], ["Kind", info.kind], ["Access", info.visibility], ["State", info.state], ["Created by", info.created_by_user],
      ["Created", dateText(info.created_at, "Unknown")], ["Expires", dateText(info.expires_at, "Never")], ["Size", bytes(info.total_bytes)], ["Files", String(info.file_count)]].forEach(function (pair) { addDetailRow(pair[0], pair[1]); });
    var url = contentUrl(info);
    if (url !== null) { addDetailRow("Content URL", url); }
    $("copy-link-button").disabled = url === null;
    $("access-mode").value = info.visibility;
    if (info.visibility !== "external") { hideRotateOutput(); }
    updateDetailActions();
    setText("content-note", url === null ? "Content hosting is not configured. Use the file downloads below or the CLI; no content link is available." : info.visibility === "internal" ? "Internal content opens through a single-use grant. The dashboard credential never leaves this origin." : info.visibility === "external" ? "This link requires its external password. Rotation revokes the old password and existing grants." : "No Manure authentication is required for anyone who can reach this content URL.");
    $("dashboard-section").hidden = true; $("detail-section").hidden = false;
  }
  function showDetail(id) {
    var generation = ++detailGeneration;
    var epoch = sessionEpoch;
    listGeneration++; pendingPage = null;
    if (observer !== null) { observer.disconnect(); }
    openGeneration++; hideRotateOutput();
    currentDetailId = null; currentDetailInfo = null;
    setText("detail-name", "Loading artifact…");
    setText("detail-subtitle", id);
    $("detail-list").textContent = ""; $("file-list").textContent = "";
    ["delete-button", "open-button", "copy-id-button", "copy-link-button"].forEach(function (key) { $(key).disabled = true; });
    updateDetailActions();
    setText("access-status", "Loading access settings…");
    $("access-refresh-button").hidden = true;
    $("files-retry-button").hidden = true;
    setText("files-status", "Waiting for artifact metadata…");
    setText("detail-status", "Loading artifact details…");
    setText("list-status", "Loading artifact details…");
    apiFetch("/artifacts/" + id, { method: "GET" }).then(jsonResponse).then(function (info) {
      if (epoch !== sessionEpoch || generation !== detailGeneration) { return; }
      renderDetail(info, id);
      setText("access-status", accessMutations.has(id) ? "An access or password update is still in progress. Wait for its status to be refreshed." : "");
      setText("detail-status", "");
      loadFiles();
    }).catch(function (error) {
      if (epoch !== sessionEpoch || generation !== detailGeneration) { return; }
      currentDetailId = null; currentDetailInfo = null;
      $("detail-section").hidden = true; $("dashboard-section").hidden = false;
      window.history.replaceState(null, "", routeHash(null));
      if (loadedKey !== JSON.stringify(state)) {
        summaries = []; nextCursor = null; loadedKey = ""; listError = true;
        renderList();
        $("retry-list-button").hidden = false;
      }
      failVisible("Detail failed (" + errorLabel(error) + "). The artifact may have expired or been deleted. Retry loading to return to the catalogue.");
    });
  }
  function loadFiles() {
    var id = currentDetailId;
    if (id === null || currentDetailInfo === null) { return; }
    var generation = detailGeneration;
    var epoch = sessionEpoch;
    $("file-list").textContent = "";
    $("files-retry-button").hidden = true;
    setText("files-status", "Loading file manifest…");
    apiFetch("/artifacts/" + id + "/files", { method: "GET" }).then(jsonResponse).then(function (body) {
      if (epoch !== sessionEpoch || generation !== detailGeneration || id !== currentDetailId) { return; }
      if (!Array.isArray(body.files)) { throw new Error("bad-response"); }
      var fragment = document.createDocumentFragment();
      body.files.forEach(function (file) {
        var row = element("tr", null, null);
        row.appendChild(element("td", file.path + (file.kind === "dir" ? "/" : ""), "path-cell"));
        row.appendChild(element("td", file.kind, null));
        row.appendChild(element("td", file.kind === "dir" ? "—" : bytes(file.size), "numeric-cell"));
        var action = element("td", "—", null);
        if (file.kind === "file" && currentDetailInfo.state === "ready") {
          var link = element("a", "Download", null);
          link.href = API + "/artifacts/" + id + "/files/" + file.path.split("/").map(encodeURIComponent).join("/") + "/content";
          action.replaceChildren(link);
        }
        row.appendChild(action); fragment.appendChild(row);
      });
      $("file-list").replaceChildren(fragment);
      setText("files-status", body.files.length + " manifest entries. Downloads use the authenticated API and are served as attachments.");
    }).catch(function (error) {
      if (epoch !== sessionEpoch || generation !== detailGeneration || id !== currentDetailId) { return; }
      setText("files-status", "Files could not be loaded (" + errorLabel(error) + ").");
      $("files-retry-button").hidden = false;
    });
  }

  /* Internal artifacts use a single-use form POST to their content endpoint. */
  function openArtifact(id, knownInfo) {
    if (!ID_RE.test(id) || accessMutations.has(id)) { return; }
    var epoch = sessionEpoch;
    var generation = ++openGeneration;
    var infoRequest = knownInfo === null ? apiFetch("/artifacts/" + id, { method: "GET" }).then(jsonResponse) : Promise.resolve(knownInfo);
    setText("detail-status", "Opening content…");
    infoRequest.then(function (info) {
      if (epoch !== sessionEpoch || generation !== openGeneration) { return; }
      var url = contentUrl(info);
      if (url === null) { throw new Error("content-unavailable"); }
      if (info.visibility !== "internal") { window.location.assign(url); return; }
      return apiFetch("/artifacts/" + id + "/grants", { method: "POST" }).then(jsonResponse).then(function (body) {
        if (epoch === sessionEpoch && generation === openGeneration) { postGrantHandoff(url, body.grant); }
      });
    }).catch(function (error) {
      if (epoch === sessionEpoch && generation === openGeneration) { failVisible("Open failed (" + errorLabel(error) + ")."); }
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
  function deleteArtifact(id) {
    if (!ID_RE.test(id) || deleting.has(id) || accessMutations.has(id) || !window.confirm("Delete artifact " + id + "? This cannot be undone.")) { return; }
    var epoch = sessionEpoch;
    deleting.add(id);
    document.querySelectorAll('button[data-action="delete"][data-artifact-id="' + id + '"]').forEach(function (button) { button.disabled = true; });
    if (currentDetailId === id) { updateDetailActions(); setText("detail-status", "Deleting artifact…"); }
    setText("list-status", "Deleting artifact…");
    apiFetch("/artifacts/" + id, { method: "DELETE" }).then(jsonResponse).then(function () {
      if (epoch !== sessionEpoch) { return; }
      if (currentDetailId === id) {
        detailGeneration++; openGeneration++; hideRotateOutput();
        currentDetailId = null; currentDetailInfo = null;
        $("detail-section").hidden = true; $("dashboard-section").hidden = false;
        window.history.replaceState(null, "", routeHash(null));
      }
      loadPage(true);
    }).catch(function (error) {
      if (epoch === sessionEpoch) { failVisible("Delete failed (" + errorLabel(error) + ")."); }
    }).finally(function () {
      deleting.delete(id);
      if (epoch === sessionEpoch) {
        document.querySelectorAll('button[data-action="delete"][data-artifact-id="' + id + '"]').forEach(function (button) { button.disabled = false; });
        if (currentDetailId === id) { updateDetailActions(); }
      }
    });
  }
  function hideRotateOutput() {
    revealGeneration++;
    $("rotate-output").hidden = true;
    setText("rotate-password", "");
    $("rotate-copy-button").disabled = true;
  }
  function invalidateCatalogue() {
    listGeneration++; pendingPage = null; summaries = []; nextCursor = null; loadedKey = ""; listError = false;
    if (observer !== null) { observer.disconnect(); }
    renderList();
    if (authenticated && readRoute().id === null) { loadPage(true); }
  }
  function beginAccessMutation(id, message) {
    openGeneration++; hideRotateOutput();
    var mutation = { epoch: sessionEpoch, generation: detailGeneration, reveal: revealGeneration, refreshNeeded: true };
    accessMutations.set(id, mutation);
    invalidateCatalogue(); updateDetailActions();
    setText("access-status", message); setText("detail-status", message);
    return mutation;
  }
  function isMutationView(id, mutation) {
    return mutation.epoch === sessionEpoch && mutation.generation === detailGeneration &&
      id === currentDetailId && readRoute().id === id;
  }
  function canReveal(id, mutation) {
    return isMutationView(id, mutation) && mutation.reveal === revealGeneration;
  }
  function takeExternalPassword(body, required) {
    if (!body || typeof body !== "object" || Array.isArray(body)) { throw new Error("bad-response"); }
    var password = body.external_password;
    delete body.external_password;
    if (!required) { return null; }
    if (typeof password !== "string" || password.length !== 43 || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(password)) { throw new Error("bad-response"); }
    return password;
  }
  function revealPassword(password) {
    setText("rotate-password", password);
    $("rotate-output").hidden = false; $("rotate-copy-button").disabled = false;
    $("rotate-dismiss-button").focus();
  }
  function settleAccessMutation(id, mutation, message) {
    invalidateCatalogue();
    if (!authenticated || readRoute().id !== id) { return Promise.resolve(); }
    var epoch = sessionEpoch;
    if (!mutation.refreshNeeded && epoch === mutation.epoch && currentDetailId === id) {
      setText("access-status", message); setText("detail-status", message);
      return Promise.resolve();
    }
    var generation = ++detailGeneration;
    if (epoch !== mutation.epoch) { message = "A previous access request finished. If an external password was not shown, rotate to issue another."; }
    $("access-refresh-button").hidden = true;
    setText("access-status", message + " Refreshing current metadata…");
    return apiFetch("/artifacts/" + id, { method: "GET" }).then(jsonResponse).then(function (info) {
      if (epoch !== sessionEpoch || generation !== detailGeneration || readRoute().id !== id) { return; }
      renderDetail(info, id); loadFiles();
      setText("access-status", message); setText("detail-status", message);
    }).catch(function (error) {
      if (epoch !== sessionEpoch || generation !== detailGeneration || readRoute().id !== id) { return; }
      currentDetailInfo = null; updateDetailActions();
      $("access-refresh-button").hidden = false;
      var failure = message + " Current metadata could not be refreshed (" + errorLabel(error) + "). Reload access status before changing access again. If External is enabled and its password was not saved, rotate to recover access.";
      setText("access-status", failure); setText("detail-status", failure);
    });
  }
  function releaseAccessMutation(id, mutation) {
    if (accessMutations.get(id) === mutation) { accessMutations.delete(id); }
    if (currentDetailId === id) { updateDetailActions(); }
    if (authenticated && readRoute().id === null) { renderList(); }
  }
  function onAccessSubmit(event) {
    event.preventDefault();
    var id = currentDetailId;
    var info = currentDetailInfo;
    var visibility = $("access-mode").value;
    if (id === null || info === null || info.state !== "ready" || accessMutations.has(id) || deleting.has(id) ||
        ["internal", "external", "public"].indexOf(visibility) === -1 || visibility === info.visibility) { return; }
    if (visibility === "public" && !window.confirm("Make artifact " + id + " public? No Manure authentication will be required for anyone who can reach its content URL. Existing content grants will be revoked.")) { return; }
    var mutation = beginAccessMutation(id, "Saving access mode… If you leave before a generated password appears, rotate it to issue another.");
    apiFetch("/artifacts/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: visibility }) }).then(jsonResponse).then(function (body) {
      var password = takeExternalPassword(body, visibility === "external");
      if (body.artifact_id !== id || body.visibility !== visibility || body.state !== "ready") { throw new Error("bad-response"); }
      var sameView = isMutationView(id, mutation);
      var showPassword = canReveal(id, mutation);
      if (sameView) {
        renderDetail(body, id);
        if (password !== null && showPassword) { revealPassword(password); }
      }
      password = null;
      mutation.refreshNeeded = !sameView;
      return visibility === "external" ? showPassword ? "Access changed to External. Save the shown password; it cannot be retrieved again. If it is no longer displayed, rotate to issue another." : "Access changed to External. The password was not displayed in this view; rotate to issue another." : "Access changed to " + visibility + ". Existing content grants were revoked.";
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return "Access change could not be confirmed (" + errorLabel(error) + "). It may have been applied; no change was retried. If External is enabled and its password was not shown, rotate to issue another.";
    }).then(function (message) {
      return settleAccessMutation(id, mutation, message);
    }).finally(function () { releaseAccessMutation(id, mutation); });
  }
  function onRotate() {
    if (currentDetailId === null || currentDetailInfo === null || currentDetailInfo.visibility !== "external" ||
        accessMutations.has(currentDetailId) || deleting.has(currentDetailId)) { return; }
    var id = currentDetailId;
    var mutation = beginAccessMutation(id, "Rotating external password…");
    apiFetch("/artifacts/" + id + "/external-password:rotate", { method: "POST" }).then(jsonResponse).then(function (body) {
      var password = takeExternalPassword(body, true);
      var showPassword = canReveal(id, mutation);
      if (showPassword) { revealPassword(password); }
      password = null;
      mutation.refreshNeeded = !isMutationView(id, mutation);
      return showPassword ? "Password rotated. Save the shown password; it cannot be retrieved again. If it is no longer displayed, rotate again to issue another." : "Password rotated, but it was not displayed in this view. Rotate again to issue another.";
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return "Rotation could not be confirmed (" + errorLabel(error) + "). The old password may have been revoked. Refresh status, then rotate again if the new password was not saved.";
    }).then(function (message) {
      return settleAccessMutation(id, mutation, message);
    }).finally(function () { releaseAccessMutation(id, mutation); });
  }
  function copy(value, statusId, message) {
    if (!value) { return; }
    if (!window.navigator.clipboard || typeof window.navigator.clipboard.writeText !== "function") {
      setText(statusId, "Clipboard is unavailable here. Select the value and copy it manually."); return;
    }
    var epoch = sessionEpoch;
    var generation = detailGeneration;
    window.navigator.clipboard.writeText(value).then(function () {
      if (epoch === sessionEpoch && generation === detailGeneration) { setText(statusId, message); }
    }).catch(function () {
      if (epoch === sessionEpoch && generation === detailGeneration) { setText(statusId, "Clipboard access was denied. Select the value and copy it manually."); }
    });
  }

  $("login-form").addEventListener("submit", onLoginSubmit);
  $("logout-button").addEventListener("click", onLogout);
  $("session-retry-button").addEventListener("click", checkSession);
  $("list-form").addEventListener("submit", function (event) {
    event.preventDefault();
    navigateList(Object.assign({}, state, { q: $("filter-text").value.trim(), visibility: $("filter-visibility").value,
      itemState: $("filter-state").value, includeExpired: $("include-expired").checked }));
  });
  ["filter-visibility", "filter-state", "include-expired"].forEach(function (id) {
    $(id).addEventListener("change", function () { $("list-form").requestSubmit(); });
  });
  $("refresh-button").addEventListener("click", function () { loadPage(true); });
  $("load-more-button").addEventListener("click", function () { loadPage(false); });
  $("retry-list-button").addEventListener("click", function () { var reset = nextCursor === null; listError = false; loadPage(reset); });
  document.querySelectorAll("[data-sort]").forEach(function (button) {
    button.addEventListener("click", function () {
      var sort = button.dataset.sort;
      navigateList(Object.assign({}, state, { sort: sort, direction: state.sort === sort ? state.direction === "asc" ? "desc" : "asc" : ["created_at", "total_bytes", "file_count"].indexOf(sort) !== -1 ? "desc" : "asc" }));
    });
  });
  document.querySelectorAll("[data-visibility-preset]").forEach(function (button) {
    button.addEventListener("click", function () {
      navigateList({ q: "", visibility: button.dataset.visibilityPreset, itemState: "", includeExpired: false, sort: "created_at", direction: "desc" });
    });
  });
  $("open-button").addEventListener("click", function () { if (currentDetailId !== null) { openArtifact(currentDetailId, currentDetailInfo); } });
  $("delete-button").addEventListener("click", function () { if (currentDetailId !== null) { deleteArtifact(currentDetailId); } });
  $("access-form").addEventListener("submit", onAccessSubmit);
  $("access-mode").addEventListener("change", function () { setText("access-status", ""); updateDetailActions(); });
  $("access-refresh-button").addEventListener("click", function () {
    var id = readRoute().id;
    if (id !== null && !accessMutations.has(id) && !deleting.has(id)) { showDetail(id); }
  });
  $("rotate-button").addEventListener("click", onRotate);
  $("rotate-dismiss-button").addEventListener("click", function () { hideRotateOutput(); setText("detail-status", ""); });
  $("rotate-copy-button").addEventListener("click", function () { copy($("rotate-password").textContent, "detail-status", "Password copied. Dismiss the reveal when finished."); });
  $("copy-id-button").addEventListener("click", function () { copy(currentDetailId, "detail-status", "Artifact ID copied."); });
  $("copy-link-button").addEventListener("click", function () { if (currentDetailInfo !== null) { copy(contentUrl(currentDetailInfo), "detail-status", "Content link copied."); } });
  $("files-retry-button").addEventListener("click", loadFiles);
  $("detail-back-button").addEventListener("click", function () { invalidateNavigation(); window.location.hash = routeHash(null); });
  window.addEventListener("hashchange", handleRoute);
  checkSession();
})(document, window, window.fetch.bind(window));
