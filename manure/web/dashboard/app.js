/* Manure dashboard: same-origin management only; uploaded bytes never render here.
 * Credentials and one-time passwords stay transient. No HTML injection or browser storage.
 */
import * as current from "./current-protocol.js";
import { FileUpload } from "./quick-upload.js";
import { parseExpression, serializeExpression, completeExpression, acceptCompletion } from "./current-protocol.js";

"use strict";

function expressionInput(input, list, change, compositionChange) {
  const document = input.ownerDocument;
  let composing = false, hints = [], choice = 0, dismissed = null;
  const stamp = () => JSON.stringify([input.value,input.selectionStart,input.selectionEnd]);
  function close() {
    hints = []; list.replaceChildren(); list.hidden = true;
    input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant');
  }
  function select(index) {
    choice = index;
    [...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i === choice)));
    if (hints.length) {
      input.setAttribute('aria-activedescendant',list.id+'-'+choice);
      list.children[choice].scrollIntoView({block:'nearest'});
    }
  }
  function refresh() {
    close();
    if (composing || document.activeElement !== input || input.selectionStart !== input.selectionEnd || dismissed === stamp()) return;
    hints = completeExpression(input.value,input.selectionStart);
    for (const [index,hint] of hints.entries()) {
      const option = document.createElement('div'); option.id = list.id+'-'+index;
      option.setAttribute('role','option');
      const label = document.createElement('span'); label.textContent = hint.label;
      const detail = document.createElement('small'); detail.textContent = hint.detail;
      option.append(label,detail);
      option.addEventListener('pointerdown',event=>{ event.preventDefault(); if (!composing) accept(index); });
      option.addEventListener('pointermove',()=>select(index));
      list.append(option);
    }
    if (hints.length) { list.hidden = false; input.setAttribute('aria-expanded','true'); select(0); }
  }
  function accept(index) {
    if (composing || !hints[index]) return;
    const next = acceptCompletion(input.value,hints[index]);
    input.value = next.expression; input.focus(); input.setSelectionRange(next.caret,next.caret);
    dismissed = input.value[next.caret-1] === ':' ? null : stamp();
    close(); change(); refresh();
  }
  input.addEventListener('input',()=>{ dismissed = null; change(); refresh(); });
  input.addEventListener('focus',()=>{ dismissed = null; refresh(); });
  input.addEventListener('click',refresh);
  input.addEventListener('select',refresh);
  input.addEventListener('keyup',event=>{ if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) refresh(); });
  input.addEventListener('blur',close);
  input.addEventListener('compositionstart',()=>{ composing = true; compositionChange(true); close(); });
  input.addEventListener('compositionend',()=>{ composing = false; compositionChange(false); dismissed = null; change(); refresh(); });
  input.addEventListener('keydown',event=>{
    if (composing || event.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (hints.length) { dismissed = stamp(); close(); }
      else reset();
    } else if (event.key === 'Tab') { dismissed = stamp(); close(); }
    else if (hints.length && ['ArrowDown','ArrowUp'].includes(event.key)) {
      event.preventDefault(); select((choice+(event.key === 'ArrowDown' ? 1 : hints.length-1))%hints.length);
    } else if (event.key === 'Enter' && hints.length) { event.preventDefault(); accept(choice); }
  });
  function reset() {
    if (composing) return;
    input.value = ''; input.focus(); input.setSelectionRange(0,0); dismissed = stamp(); close(); change();
  }
  return {reset,close};
}


(function (document, window, fetch) {
  var API = "/api/current";
  var ID_RE = /^[0-9a-f]{32}$/;
  var PAGE_LIMIT = 25;
  var sessionEpoch = 0;
  var authenticated = false;
  var listGeneration = 0;
  var detailGeneration = 0;
  var revealGeneration = 0;
  var openGeneration = 0;
  var pendingPage = null;
  var readBusy = false;
  var queuedRead = null;
  var capabilities = null;
  var capabilitiesError = false;
  var capabilityGeneration = 0;
  var searchPage = null;
  var submittedKey = null;
  var composing = false;
  var pointerCompositionBlocked = false;
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
  function apiFetch(descriptor) {
    var epoch = sessionEpoch;
    return current.request(fetch, descriptor).catch(function (error) {
      if (error.status === 401 && !(descriptor[0].constructor.name === "Command_Login")) {
        if (epoch === sessionEpoch) { showLoggedOut(); }
        throw new Error("unauthorized");
      }
      throw error;
    });
  }
  function bytes(value) {
    if (typeof value === "bigint") { value = Number(value); }
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

  function checkHostingMode() {
    var notice = $("path-mode-warning");
    // Hosting capabilities are public, site-wide state: a concurrent session
    // check/login/logout must not discard the warning response.
    var generation = ++capabilityGeneration;
    return current.request(fetch, current.capabilities()).then(function (result) {
      if (generation !== capabilityGeneration) { return; }
      if (!Number.isInteger(result.max_list_limit) || result.max_list_limit < 1 ||
          !Array.isArray(result.search_modes) || typeof result.metadata_only_search !== "boolean") { throw new Error("bad-response"); }
      capabilities = result; capabilitiesError = false;
      notice.hidden = result.content_mode !== "path";
      updateDraft();
      if (authenticated && readRoute().id === null) { handleRoute(true); }
    }).catch(function () {
      if (generation !== capabilityGeneration) { return; }
      capabilities = null; capabilitiesError = true;
      notice.hidden = false;
      notice.title = "Content-origin isolation could not be determined. Verify hosting configuration before opening untrusted content.";
      notice.setAttribute("aria-label", notice.title);
      updateDraft();
      if (authenticated && readRoute().id === null) { handleRoute(true); }
    });
  }
  function supported(value) {
    return capabilities !== null && capabilities.search_modes.includes(value) && capabilities.metadata_only_search;
  }
  function resultStatus() {
    if (state.mode === "catalogue") {
      return summaries.length + " artifacts shown" + (nextCursor !== null ? " · scroll to load more" : " · all matching artifacts loaded");
    }
    if (searchPage === null) { return "Press Search to run retrieval. No model query has been sent."; }
    var scope = searchPage.count_scope === "exactmatches" ? "matching artifacts" : "candidate-window artifacts";
    return searchPage.hits.length + " hits shown · " + searchPage.total + " " + scope +
      (searchPage.count_scope === "candidatewindow" ? " (ranked candidate window " + searchPage.ranking_limit + "; not a corpus-wide total)" : " (exact matches)") +
      " · one page, up to " + Math.min(PAGE_LIMIT,capabilities.max_list_limit) + " hits";
  }

  function readRoute() {
    var hash = window.location.hash;
    var queryAt = hash.indexOf("?");
    var params = new URLSearchParams(queryAt === -1 ? "" : hash.slice(queryAt + 1));
    var match = /^#\/artifact\/([0-9a-f]{32})(?:\?|$)/.exec(hash);
    var parts = [];
    params.forEach(function (value,key) {
      if (["mode","access","state","expired","kind","owner","sort","direction","q"].includes(key)) {
        parts.push((key === "q" ? "text" : key) + ":" + JSON.stringify(value));
      }
    });
    var expression = [params.get("query"),parts.join(" ")].filter(function (value) { return value; }).join(" ");
    try {
      if (params.getAll("query").length > 1) { throw new current.ExpressionError("Duplicate query URL parameter.",0,expression.length); }
      return { id: match ? match[1] : null, state: parseExpression(expression), error: null, expression: expression };
    }
    catch (error) { return { id: match ? match[1] : null, state: parseExpression(""), error: error, expression: expression }; }
  }

  function stateParams(value) {
    var params = new URLSearchParams();
    var expression = serializeExpression(value);
    if (expression) { params.set("query",expression); }
    return params;
  }
  function routeHash(id) {
    var query = stateParams(state).toString();
    return (id ? "#/artifact/" + id : "#/artifacts") + (query ? "?" + query : "");
  }
  function draftState() { return parseExpression($("filter-text").value); }
  function updateDraft() {
    var draft = null, diagnostic = null;
    try { draft = draftState(); } catch (error) { diagnostic = error; }
    var differs = draft === null || JSON.stringify(draft) !== JSON.stringify(state);
    var unavailable = draft !== null && draft.mode !== "catalogue" && !supported(draft.mode);
    $("query-diagnostic").hidden = diagnostic === null && !unavailable;
    $("query-diagnostic").textContent = diagnostic !== null ? diagnostic.message : unavailable ? "Retrieval mode " + draft.mode + " unavailable; no fallback will be sent." : "";
    $("filter-text").setAttribute("aria-invalid", String(diagnostic !== null));
    $("refresh-button").disabled = readRoute().error !== null;
    $("clear-search-button").disabled = composing || $("filter-text").value.length === 0;
    setText("draft-status", differs ? "Draft changed · press Search to apply. Sort is disabled. Applied: " + (serializeExpression(state) || "all unexpired artifacts · created_at descending") : "Draft matches applied query · Search to run. Typing never sends a request.");
    document.querySelectorAll("[data-sort]").forEach(function (button) {
      button.disabled = state.mode !== "catalogue" || differs;
      button.title = differs ? "Apply or clear the changed draft before sorting" : "Sort applied query";
    });
    setText("sort-summary", state.mode !== "catalogue" ? "Relevance order · not sortable" : "Sorted by " + document.querySelector('[data-sort="' + state.sort + '"]').getAttribute("aria-label").replace(/^Sort by /, "") + (state.direction === "asc" ? " ↑" : " ↓"));
    setText("results-help", state.mode === "catalogue" ? "Sort all matching artifacts by any column. Scroll down within results to load more. All metadata and actions fit the available width." : "One bounded page in relevance order. Evidence is a pinned name or manifest path, not file contents; opening details fetches fresh metadata.");
    $("catalogue-table").hidden = state.mode !== "catalogue";
    $("retrieval-results").hidden = state.mode === "catalogue";
  }
  function updateControls() {
    $("filter-text").value = serializeExpression(state);
    if (typeof queryEditor !== "undefined") { queryEditor.close(); }
    document.querySelectorAll("[data-sort]").forEach(function (button) {
      var selected = button.dataset.sort === state.sort && state.mode === "catalogue";
      button.disabled = state.mode !== "catalogue";
      button.closest("th").setAttribute("aria-sort", selected ? state.direction === "asc" ? "ascending" : "descending" : "none");
      var arrow = button.querySelector(".sort-indicator");
      if (arrow !== null) { arrow.textContent = selected ? state.direction === "asc" ? "↑" : "↓" : "↕"; }
    });
    document.querySelectorAll("[data-visibility-preset]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.visibilityPreset === (state.visibility || "")));
    });
    updateDraft();
  }

  function invalidateNavigation() {
    listGeneration++; pendingPage = null; queuedRead = null; detailGeneration++; openGeneration++;
    if (observer !== null) { observer.disconnect(); }
    hideRotateOutput();
  }
  function navigateList(next, submitted) {
    var query = stateParams(next).toString();
    var hash = "#/artifacts" + (query ? "?" + query : "");
    invalidateNavigation();
    loadedKey = "";
    submittedKey = submitted ? JSON.stringify(next) : null;
    state = next;
    updateControls();
    if (window.location.hash === hash) { handleRoute(); }
    else { window.location.hash = hash; }
  }
  function handleRoute(keepDraft) {
    if (!authenticated) { return; }
    var route = readRoute();
    var changed = JSON.stringify(route.state) !== JSON.stringify(state);
    var currentDraft = keepDraft === true || !changed ? $("filter-text").value : null;
    if (changed) {
      // Direct hash/history navigation bypasses navigateList. Fence both a held
      // result and any queued unsent intent before changing the owner of rows.
      invalidateNavigation(); loadedKey = ""; submittedKey = null;
    }
    state = route.state;
    updateControls();
    if (!changed && currentDraft !== null) { $("filter-text").value = currentDraft; updateDraft(); }
    if (route.error !== null) {
      invalidateNavigation(); loadedKey = ""; summaries = []; searchPage = null; nextCursor = null;
      $("filter-text").value = route.expression; updateDraft(); renderList();
      $("detail-section").hidden = true; $("dashboard-section").hidden = false;
      $("retry-list-button").hidden = true;
      setText("list-status", "Invalid URL query. Edit the visible expression and press Search; no request was sent.");
      return;
    }
    if (route.id !== null) { showDetail(route.id); return; }
    detailGeneration++; openGeneration++; hideRotateOutput();
    currentDetailId = null; currentDetailInfo = null;
    $("detail-section").hidden = true;
    $("dashboard-section").hidden = false;
    if (loadedKey !== JSON.stringify(state)) {
      summaries = []; searchPage = null; nextCursor = null; renderList();
      if (capabilities === null) {
        setText("list-status", capabilitiesError ? "Capabilities unavailable. Retry connection; no search was sent." : "Checking search capabilities…");
        $("retry-list-button").hidden = !capabilitiesError;
      } else if (state.mode !== "catalogue" && !supported(state.mode)) {
        setText("list-status", "Retrieval mode " + state.mode + " unavailable on this server. No fallback was sent.");
        $("retry-list-button").hidden = false;
      } else if (state.mode !== "catalogue" && submittedKey !== JSON.stringify(state)) {
        setText("list-status", resultStatus());
      } else { loadPage(true); }
    }
    else {
      renderList();
      if (!listError) { setText("list-status", resultStatus()); }
      watchList();
    }
  }

  function clearAccount() {
    clearUploads();
    var hadAccount = authenticated;
    sessionEpoch++; invalidateNavigation(); authenticated = false;
    // A URL fragment is visible to the next identity in this tab. On the
    // session boundary remove applied queries, owner filters and unsent input.
    if (hadAccount) { window.history.replaceState(null, "", "#/artifacts"); }
    state = readRoute().state;
    updateControls();
    summaries = []; searchPage = null; submittedKey = null; queuedRead = null; loadedKey = ""; nextCursor = null; listError = false;
    currentDetailId = null; currentDetailInfo = null;
    if (observer !== null) { observer.disconnect(); }
    $("artifact-list").textContent = ""; $("retrieval-results").textContent = "";
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
    return apiFetch(current.whoami()).then(function (body) {
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
      if (capabilities === null) { checkHostingMode(); }
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
    var request = apiFetch(current.login(token));
    token = "";
    request.then(function () {
      if (epoch === sessionEpoch) { return checkSession(); }
    }).catch(function (error) {
      if (epoch !== sessionEpoch) { return; }
      setText("login-error", "Login failed (" + errorLabel(error) + ").");
      $("login-error").hidden = false;
    }).finally(function () { button.disabled = false; });
  }
  function onLogout() {
    clearUploads();
    openGeneration++;
    hideRotateOutput();
    var epoch = sessionEpoch;
    $("logout-button").disabled = true;
    apiFetch(current.logout()).then(function () {
      if (epoch === sessionEpoch) { showLoggedOut(); }
    }).catch(function (error) {
      if (epoch === sessionEpoch) { failVisible("Sign out could not be confirmed (" + errorLabel(error) + "). Retry to confirm sign out."); }
    }).finally(function () { $("logout-button").disabled = false; });
  }

  function rowAction(label, action, item, handler) {
    var button = element("button", label, action === "delete" ? "danger" : null);
    button.type = "button"; button.dataset.action = action; button.dataset.artifactId = item.artifact_id;
    button.addEventListener("click", handler);
    return button;
  }
  function renderRetrieval() {
    var list = $("retrieval-results");
    var fragment = document.createDocumentFragment();
    if (searchPage !== null) { searchPage.hits.forEach(function (hit) {
      var item = hit.artifact;
      var card = element("article", null, "retrieval-hit");
      var heading = element("h3", null, null);
      heading.appendChild(rowAction(item.name || item.artifact_id, "details", item, function () {
        invalidateNavigation(); window.location.hash = routeHash(item.artifact_id);
      }));
      card.appendChild(heading);
      card.appendChild(element("p", item.artifact_id + " · " + item.kind + " · " + item.visibility + " · created by " + item.created_by_user, null));
      card.appendChild(element("p", "Pinned source " + hit.source_version + " · generation " + hit.generation_id + " · policy " + hit.policy_id, "source-note"));
      var evidence = element("ul", null, "evidence-list");
      hit.evidence.forEach(function (entry) {
        evidence.appendChild(element("li", entry.field === "manifestpath" ? "Manifest path: " + entry.path : "Name: " + entry.text, null));
      });
      card.appendChild(evidence);
      card.appendChild(element("p", "Representative name/path evidence only; not file bytes. Details fetch current artifact metadata.", "source-note"));
      fragment.appendChild(card);
    }); }
    list.replaceChildren(fragment);
  }
  function renderList() {
    renderRetrieval();
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
      actions.appendChild(group); row.appendChild(actions);
      ["Name", "Kind", "Access", "State", "Size", "Files", "Created", "Expires", "Owner", "Actions"].forEach(function (label, index) {
        row.children[index].dataset.label = label;
      });
      fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
    if (focused !== null && focused.id) {
      var target = list.querySelector('button[data-artifact-id="' + focused.id + '"][data-action="' + focused.action + '"]');
      (target || $("results-panel")).focus({ preventScroll: true });
    }
    setText("loaded-count", state.mode === "catalogue" ? String(summaries.length) + (nextCursor !== null ? "+" : "") : String(searchPage === null ? 0 : searchPage.hits.length));
    $("empty-state").hidden = (state.mode === "catalogue" ? summaries.length !== 0 : searchPage === null || searchPage.hits.length !== 0) || pendingPage !== null || listError;
    $("load-more-button").hidden = state.mode !== "catalogue" || nextCursor === null || listError;
    $("load-more-button").disabled = pendingPage !== null;
  }
  function watchList() {
    if (observer !== null) { observer.disconnect(); }
    if (state.mode !== "catalogue" || typeof IntersectionObserver === "undefined" || nextCursor === null || listError || pendingPage !== null || !authenticated || $("dashboard-section").hidden) { return; }
    var cursor = nextCursor;
    observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; }) && cursor === nextCursor) { loadPage(false); }
    }, { root: $("results-panel"), rootMargin: "200px" });
    observer.observe($("list-sentinel"));
  }
  function loadPage(reset) {
    if (!authenticated || readRoute().id !== null || readRoute().error !== null || capabilities === null ||
        (state.mode !== "catalogue" && (!supported(state.mode) || submittedKey !== JSON.stringify(state))) ||
        (!reset && (state.mode !== "catalogue" || nextCursor === null || listError || loadedKey !== JSON.stringify(state)))) { return; }
    // Capture the entire intent now. A superseding request replaces only an
    // unsent intent, never launches another physical list/Search request.
    var intent = { generation: ++listGeneration, epoch: sessionEpoch, cursor: reset ? null : nextCursor,
      reset: reset, value: Object.assign({}, state), limit: Math.min(PAGE_LIMIT, capabilities.max_list_limit) };
    pendingPage = intent.generation; listError = false;
    $("list-error").hidden = true; $("retry-list-button").hidden = true;
    if (reset) {
      summaries = []; searchPage = null; nextCursor = null;
      loadedKey = JSON.stringify(intent.value);
      $("results-panel").scrollTop = 0;
    }
    setText("list-status", reset ? state.mode === "catalogue" ? "Loading artifacts…" : "Searching metadata and manifest paths…" : "Loading more artifacts…");
    renderList();
    queuedRead = intent;
    pumpRead();
  }
  function pumpRead() {
    if (readBusy || queuedRead === null) { return; }
    var intent = queuedRead;
    queuedRead = null; readBusy = true;
    var generation = intent.generation, epoch = intent.epoch, value = intent.value, cursor = intent.cursor;
    var descriptor = value.mode === "catalogue" ? current.catalogue(cursor,value,intent.limit) : current.search(value,intent.limit);
    apiFetch(descriptor).then(function (body) {
      if (epoch !== sessionEpoch || generation !== listGeneration || readRoute().id !== null) { return; }
      if (value.mode !== "catalogue") {
        if (!Array.isArray(body.hits) || (body.next_cursor !== null && body.next_cursor !== undefined) ||
            !["exactmatches", "candidatewindow"].includes(body.count_scope) ||
            (body.count_scope === "candidatewindow" && (!Number.isInteger(body.ranking_limit) || body.ranking_limit < 1)) ||
            body.hits.some(function (hit) { return !hit.artifact || !ID_RE.test(hit.artifact.artifact_id) || !Array.isArray(hit.evidence) ||
              hit.evidence.some(function (entry) { return entry.field === "manifestpath" && typeof entry.path !== "string" ||
                entry.field === "name" && entry.path !== null && entry.path !== undefined; }); })) { throw new Error("bad-response"); }
        body.hits.forEach(function (hit) { delete hit.artifact.external_password; });
        searchPage = body;
        nextCursor = null;
      } else {
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
      }
      setText("list-status", resultStatus());
    }).catch(function (error) {
      if (epoch !== sessionEpoch || generation !== listGeneration || readRoute().id !== null) { return; }
      listError = true;
      setText("list-status", (value.mode === "catalogue" ? "List" : "Retrieval") + " failed (" + errorLabel(error) + "). No alternate search was sent.");
      setText("list-error", "Could not load " + (value.mode === "catalogue" ? "artifacts" : "retrieval") + " (" + errorLabel(error) + "). Retry when ready.");
      $("list-error").hidden = false; $("retry-list-button").hidden = false;
    }).finally(function () {
      readBusy = false;
      if (epoch === sessionEpoch && generation === listGeneration) { pendingPage = null; renderList(); watchList(); }
      pumpRead();
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
    listGeneration++; pendingPage = null; queuedRead = null;
    if (state.mode === "catalogue") { loadedKey = ""; }
    else if (searchPage === null) { submittedKey = null; }
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
    apiFetch(current.artifact(id)).then(function (info) {
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
      summaries = []; searchPage = null; nextCursor = null; loadedKey = ""; submittedKey = null; listError = true;
      renderList();
      $("retry-list-button").hidden = false;
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
    apiFetch(current.manifest(id)).then(function (body) {
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
    var infoRequest = knownInfo === null ? apiFetch(current.artifact(id)) : Promise.resolve(knownInfo);
    setText("detail-status", "Opening content…");
    infoRequest.then(function (info) {
      if (epoch !== sessionEpoch || generation !== openGeneration) { return; }
      var url = contentUrl(info);
      if (url === null) { throw new Error("content-unavailable"); }
      if (info.visibility !== "internal") { window.location.assign(url); return; }
      return apiFetch(current.grant(id)).then(function (body) {
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
    apiFetch(current.remove(id)).then(function () {
      if (epoch !== sessionEpoch) { return; }
      if (currentDetailId === id) {
        detailGeneration++; openGeneration++; hideRotateOutput();
        currentDetailId = null; currentDetailInfo = null;
        $("detail-section").hidden = true; $("dashboard-section").hidden = false;
        window.history.replaceState(null, "", routeHash(null));
      }
      invalidateCatalogue();
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
    listGeneration++; pendingPage = null; queuedRead = null; summaries = []; searchPage = null; nextCursor = null; loadedKey = ""; listError = false;
    if (state.mode !== "catalogue") { submittedKey = null; setText("list-status", "Results invalidated. Press Search to run retrieval again."); }
    if (observer !== null) { observer.disconnect(); }
    renderList();
    if (authenticated && readRoute().id === null && state.mode === "catalogue") { loadPage(true); }
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
    return apiFetch(current.artifact(id)).then(function (info) {
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
    apiFetch(current.access(id, visibility)).then(function (body) {
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
    apiFetch(current.rotate(id)).then(function (body) {
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

  var uploads = [];
  var uploadGeneration = 0;
  var uploadBusy = false;
  var uploadAbort = null;
  function uploadVisibility() { return document.querySelector('input[name="upload-access"]:checked').value; }
  function clearUploads() {
    uploadGeneration++;
    if (uploadAbort !== null) { uploadAbort.abort(); uploadAbort = null; }
    uploads.forEach(function (item) { item.clear(); });
    uploads = []; uploadBusy = false;
    $("upload-files").value = "";
    $("upload-internal").checked = true;
    setText("upload-status", ""); renderUploads();
  }
  function renderUploads() {
    var list = $("upload-list"); list.textContent = "";
    uploads.forEach(function (item) {
      var row = element("li", null, "upload-result");
      row.appendChild(element("strong", item.file.name + " · " + bytes(item.file.size) + " · " + item.visibility, null));
      var phase = item.phase === "init-uncertain" ? "Initialization could not be confirmed. Do not retry as a new upload without checking the catalogue for an incomplete artifact." : item.phase;
      row.appendChild(element("p", phase + " · " + bytes(item.offset) + " sent" + (item.id ? " · ID " + item.id : ""), null));
      if (item.error) { row.appendChild(element("p", item.error, "error")); }
      if (item.phase === "ready") {
        var url = contentUrl({ artifact_id: item.id, content_url: item.link });
        if (url !== null) {
          var link = element("input", null, null); link.type = "text"; link.readOnly = true; link.value = url;
          link.setAttribute("aria-label", "Content link for " + item.file.name);
          link.addEventListener("click", function () { link.select(); }); row.appendChild(link);
          var button = element("button", "Copy content link", null); button.type = "button";
          button.addEventListener("click", function () { copy(url, "upload-status", "Content link copied."); }); row.appendChild(button);
        } else { row.appendChild(element("p", "Ready, but no validated content link is configured. Open the artifact in the catalogue.", null)); }
      }
      if (item.password !== null) {
        row.appendChild(element("p", "External password — shown once; save securely before dismissing:", null));
        row.appendChild(element("code", item.password, "password-value"));
        var copyPassword = element("button", "Copy password", null); copyPassword.type = "button";
        copyPassword.addEventListener("click", function () { copy(item.password, "upload-status", "Password copied. Dismiss the reveal when finished."); }); row.appendChild(copyPassword);
        var dismiss = element("button", "Dismiss password", null); dismiss.type = "button";
        dismiss.addEventListener("click", function () { item.password = null; renderUploads(); }); row.appendChild(dismiss);
      }
      list.appendChild(row);
    });
    $("upload-submit").disabled = uploadBusy || !uploads.some(function (item) { return item.phase !== "ready" && item.phase !== "init-uncertain"; });
    $("upload-files").disabled = uploadBusy;
    $("upload-visibility").disabled = uploadBusy;
    $("upload-access-help").hidden = uploadVisibility() !== "external";
  }
  function stageFiles(files) {
    if (!authenticated || uploadBusy || $("logout-button").disabled) { return; }
    Array.from(files).forEach(function (file) {
      if (!file.name || /[\\/\x00-\x1f\x7f]/.test(file.name) || file.name === "." || file.name === "..") {
        setText("upload-status", "Rejected an unsupported file name. Rename it before uploading."); return;
      }
      uploads.push(new FileUpload(file, uploadVisibility()));
    });
    $("upload-files").value = ""; renderUploads();
  }
  $("upload-visibility").addEventListener("change", renderUploads);
  $("upload-files").addEventListener("change", function (event) { stageFiles(event.target.files); });
  document.addEventListener("paste", function (event) {
    if (authenticated && event.clipboardData && event.clipboardData.files.length) {
      event.preventDefault(); stageFiles(event.clipboardData.files);
    }
  });
  $("quick-upload").addEventListener("dragover", function (event) { if (authenticated) { event.preventDefault(); } });
  $("quick-upload").addEventListener("drop", function (event) {
    if (authenticated) { event.preventDefault(); stageFiles(event.dataTransfer.files); }
  });
  $("upload-clear").addEventListener("click", clearUploads);
  $("upload-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!authenticated || uploadBusy || $("logout-button").disabled) { return; }
    var generation = uploadGeneration, epoch = sessionEpoch;
    uploads.forEach(function (item) {
      if (item.id === null && item.phase !== "init-uncertain") { item.visibility = uploadVisibility(); }
    });
    var controller = new AbortController(); uploadAbort = controller; uploadBusy = true;
    function check() { if (!authenticated || generation !== uploadGeneration || epoch !== sessionEpoch) { throw new Error("cancelled"); } }
    renderUploads();
    try {
      for (var item of uploads) {
        check(); item.error = null;
        try {
          await item.run(apiFetch, fetch, check, controller.signal, renderUploads);
        } catch (error) {
          check();
          if (error.status === 401) { showLoggedOut(); return; }
          item.error = "Upload failed (" + errorLabel(error) + "). " +
            (item.phase === "finalizing" ? "Publication is uncertain. Retry checks the same artifact; do not start a duplicate." :
              item.id ? "Retry continues the same artifact. Dismissing does not delete the incomplete upload." : "Check the status above before retrying.");
          renderUploads(); break;
        }
      }
      check(); setText("upload-status", "Finished this upload attempt. Ready links are shown below. Internal links require authenticated readers.");
      loadedKey = "";
      if (!$("dashboard-section").hidden) { if (state.mode === "catalogue") { loadPage(true); } else { invalidateCatalogue(); } }
    } catch (_error) {
      // Logout/dismiss invalidates this operation; never restore its secrets or UI.
    } finally {
      if (generation === uploadGeneration && epoch === sessionEpoch) { uploadBusy = false; uploadAbort = null; renderUploads(); }
    }
  });

  $("login-form").addEventListener("submit", onLoginSubmit);
  $("logout-button").addEventListener("click", onLogout);
  $("session-retry-button").addEventListener("click", checkSession);
  $("list-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (composing || event.isComposing || pointerCompositionBlocked) { return; }
    try { navigateList(draftState(), true); }
    catch (error) { updateDraft(); $("filter-text").focus(); $("filter-text").setSelectionRange(error.start,error.end); }
  });
  var queryEditor = expressionInput($("filter-text"), $("query-suggestions"), updateDraft, function (active) { composing = active; updateDraft(); });
  $("search-submit").addEventListener("pointerdown", function (event) {
    pointerCompositionBlocked = composing;
    if (composing) { event.preventDefault(); }
  });
  $("search-submit").addEventListener("click", function (event) {
    if (pointerCompositionBlocked || composing) {
      event.preventDefault(); event.stopPropagation();
    }
    pointerCompositionBlocked = false;
  }, true);
  $("search-submit").addEventListener("pointercancel", function () { pointerCompositionBlocked = false; });
  document.addEventListener("pointerup", function (event) {
    if (!event.composedPath().includes($("search-submit"))) { pointerCompositionBlocked = false; }
  });
  document.addEventListener("pointerdown", function (event) {
    if (!event.composedPath().includes($("search-submit"))) { pointerCompositionBlocked = false; }
  });
  $("clear-search-button").addEventListener("click", queryEditor.reset);
  $("query-diagnostic").addEventListener("click", function () {
    try { draftState(); } catch (error) { $("filter-text").focus(); $("filter-text").setSelectionRange(error.start,error.end); }
  });
  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey &&
        !event.isComposing && !composing && authenticated && !$("workspace-shell").hidden &&
        $("detail-section").hidden && !document.querySelector("dialog[open], [role=dialog]:not([hidden])")) {
      event.preventDefault(); $("filter-text").focus(); $("filter-text").select();
    }
  });
  $("refresh-button").addEventListener("click", function () { if (state.mode !== "catalogue") { submittedKey = JSON.stringify(state); } loadPage(true); });
  $("load-more-button").addEventListener("click", function () { loadPage(false); });
  $("retry-list-button").addEventListener("click", function () {
    if (capabilities === null || state.mode !== "catalogue" && !supported(state.mode)) { checkHostingMode(); return; }
    var reset = nextCursor === null; listError = false;
    if (state.mode !== "catalogue") { submittedKey = JSON.stringify(state); }
    loadPage(reset);
  });
  document.querySelectorAll("[data-sort]").forEach(function (button) {
    button.addEventListener("click", function () {
      var sort = button.dataset.sort;
      if (button.disabled) { return; }
      try {
        navigateList(Object.assign({}, state, { sort: sort, direction: state.sort === sort ? state.direction === "asc" ? "desc" : "asc" : ["created_at", "total_bytes", "file_count"].indexOf(sort) !== -1 ? "desc" : "asc" }), false);
      } catch (error) {
        if (!(error instanceof current.ExpressionError)) { throw error; }
        setText("draft-status", error.message + " Query and results unchanged; shorten the query before sorting.");
      }
    });
  });
  document.querySelectorAll("[data-visibility-preset]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (composing) { return; }
      $("filter-text").value = button.dataset.visibilityPreset ? "access:" + button.dataset.visibilityPreset + " " : "";
      $("filter-text").focus(); $("filter-text").setSelectionRange($("filter-text").value.length,$("filter-text").value.length);
      queryEditor.close(); updateDraft();
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
  checkHostingMode();
  checkSession();
})(document, window, window.fetch.bind(window));
