/* Manure dashboard: same-origin management only; uploaded bytes never render here.
 * Credentials and one-time passwords stay transient. No HTML injection or browser storage.
 */
import * as current from "./current-protocol.js";
import { ID_RE, domHelpers, errorLabel, bytes, dateText, expired, contentUrl } from "./common.js";
import { createDetail } from "./detail.js";
import { createUpload } from "./upload.js";
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
  var PAGE_LIMIT = 25;
  var listGeneration = 0;
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
  var state = readRoute().state;
  var ctx = Object.assign({ document: document, window: window, fetch: fetch, apiFetch: apiFetch,
    sessionEpoch: 0, authenticated: false, deleting: new Set(), accessMutations: new Map() }, domHelpers(document));
  var $ = ctx.$, setText = ctx.setText, element = ctx.element;
  var detail = createDetail(ctx, { readRoute: readRoute, routeHash: routeHash, renderList: renderList, invalidateCatalogue: invalidateCatalogue,
    failVisible: failVisible, invalidateNavigation: invalidateNavigation, suspendForDetail: suspendForDetail, detailFailed: detailFailed });
  var upload = createUpload(ctx, { showLoggedOut: showLoggedOut, reloadAfterUpload: reloadAfterUpload }, detail.copy);

  function apiFetch(descriptor) {
    var epoch = ctx.sessionEpoch;
    return current.request(fetch, descriptor).catch(function (error) {
      if (error.status === 401) {
        if (epoch === ctx.sessionEpoch) { showLoggedOut(); }
        throw new Error("unauthorized");
      }
      throw error;
    });
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
      if (ctx.authenticated && readRoute().id === null) { handleRoute(true); }
    }).catch(function () {
      if (generation !== capabilityGeneration) { return; }
      capabilities = null; capabilitiesError = true;
      notice.hidden = false;
      notice.title = "Content-origin isolation could not be determined. Verify hosting configuration before opening untrusted content.";
      notice.setAttribute("aria-label", notice.title);
      updateDraft();
      if (ctx.authenticated && readRoute().id === null) { handleRoute(true); }
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
      if (["mode","access","state","expired","kind","owner","sort","direction","tag","hostname","project","q"].includes(key)) {
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
    setText("results-help", state.mode === "catalogue" ? "Sort all matching artifacts by any column. Scroll down within results to load more. All metadata and actions fit the available width." : "One bounded page in relevance order. Evidence is pinned artifact metadata or a manifest path, not file contents; opening details fetches fresh metadata.");
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
    listGeneration++; pendingPage = null; queuedRead = null;
    if (observer !== null) { observer.disconnect(); }
    detail.invalidate();
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
    if (!ctx.authenticated) { return; }
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
    if (route.id !== null) { detail.showDetail(route.id); return; }
    detail.leave();
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
    document.dispatchEvent(new window.Event('account:invalidate'));
    delete $("account-settings").dataset.accountUserId;
    upload.clearUploads();
    var hadAccount = ctx.authenticated;
    ctx.sessionEpoch++; invalidateNavigation(); ctx.authenticated = false;
    // A URL fragment is visible to the next identity in this tab. On the
    // session boundary remove applied queries, owner filters and unsent input.
    if (hadAccount) { window.history.replaceState(null, "", "#/artifacts"); }
    state = readRoute().state;
    updateControls();
    summaries = []; searchPage = null; submittedKey = null; queuedRead = null; loadedKey = ""; nextCursor = null; listError = false;
    if (observer !== null) { observer.disconnect(); }
    $("artifact-list").textContent = ""; $("retrieval-results").textContent = "";
    detail.clear();
    setText("whoami-text", ""); setText("list-status", "");
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
    var epoch = ctx.sessionEpoch;
    $("session-section").hidden = false;
    $("session-retry-button").disabled = true;
    $("session-retry-button").hidden = true;
    setText("session-status", "Checking dashboard session…");
    return apiFetch(current.whoami()).then(function (body) {
      if (epoch !== ctx.sessionEpoch) { return false; }
      if (typeof body.user_id !== "string" || !body.user_id) { throw new Error("bad-response"); }
      ctx.authenticated = true;
      $("session-section").hidden = true;
      $("login-section").hidden = true;
      $("workspace-shell").hidden = false;
      $("whoami").hidden = false;
      $("dashboard-section").hidden = false;
      setText("whoami-text", body.user_id);
      $("account-settings").dataset.accountUserId = body.user_id;
      updateControls(); handleRoute();
      if (capabilities === null) { checkHostingMode(); }
      return true;
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || error.message === "unauthorized") { return false; }
      $("login-section").hidden = true;
      $("session-section").hidden = false;
      setText("session-status", "The service is unavailable (" + errorLabel(error) + "). This does not mean your session expired.");
      $("session-retry-button").hidden = false;
      return false;
    }).finally(function () { $("session-retry-button").disabled = false; });
  }
  function onLogout() {
    document.dispatchEvent(new window.Event('account:invalidate'));
    upload.clearUploads();
    detail.cancelOpen();
    var epoch = ctx.sessionEpoch;
    $("logout-button").disabled = true;
    apiFetch(current.logout()).then(function () {
      if (epoch === ctx.sessionEpoch) { showLoggedOut(); }
    }).catch(function (error) {
      if (epoch === ctx.sessionEpoch) { failVisible("Sign out could not be confirmed (" + errorLabel(error) + "). Retry to confirm sign out."); }
    }).finally(function () { $("logout-button").disabled = false; });
  }

  function rowAction(label, action, item, handler) {
    var button = element("button", label, action === "delete" ? "danger" : null);
    button.type = "button"; button.dataset.action = action; button.dataset.artifactId = item.artifact_id;
    button.addEventListener("click", handler);
    return button;
  }
  function appendCopyLink(container, item) {
    var url = contentUrl(item, window.location.origin);
    var label = item.name || item.artifact_id;
    function unavailable() {
      return contentUrl(item, window.location.origin) === null ? "Content link unavailable" : item.state !== "ready" ? "Upload is not ready" : expired(item) ? "Artifact expired" :
        ctx.accessMutations.has(item.artifact_id) || ctx.deleting.has(item.artifact_id) ? "Artifact update in progress" : null;
    }
    var button = rowAction("", "copy-link", item, function (event) {
      event.preventDefault(); event.stopPropagation();
      if (button.disabled) { return; }
      var reason = unavailable();
      if (reason !== null) {
        button.disabled = true; button.title = reason;
        status.textContent = reason + ". Content link unavailable."; fallback.hidden = true; return;
      }
      var epoch = ctx.sessionEpoch, generation = listGeneration;
      function active() { return epoch === ctx.sessionEpoch && generation === listGeneration && button.isConnected; }
      function manual(message) {
        if (!active()) { return; }
        var reason = unavailable();
        if (reason !== null) { status.textContent = reason + ". Content link unavailable."; fallback.hidden = true; return; }
        status.textContent = message + " Select the content link and copy it manually.";
        fallback.hidden = false; field.focus(); field.select();
      }
      fallback.hidden = true;
      button.setAttribute("aria-label", "Copy content link for " + label);
      button.title = "Copy content link (no password or access grant)";
      if (!window.navigator.clipboard || typeof window.navigator.clipboard.writeText !== "function") {
        manual("Clipboard is unavailable."); return;
      }
      button.disabled = true;
      status.textContent = "Copying content link…";
      var pending;
      try { pending = window.navigator.clipboard.writeText(url); }
      catch (_error) { pending = Promise.reject(_error); }
      Promise.resolve(pending).then(function () {
        if (!active()) { return; }
        status.textContent = "Content link copied.";
        button.setAttribute("aria-label", "Content link copied for " + label);
        button.title = "Content link copied";
      }).catch(function () { manual("Clipboard access was denied."); }).finally(function () {
        if (active()) { button.disabled = unavailable() !== null; if (button.disabled) { button.title = unavailable(); } }
      });
    });
    button.className = "record-copy";
    button.setAttribute("aria-label", "Copy content link for " + label);
    button.title = unavailable() || "Copy content link (no password or access grant)";
    button.disabled = unavailable() !== null;
    var icon = element("span", "⧉", null); icon.setAttribute("aria-hidden", "true"); button.appendChild(icon);
    container.appendChild(button);
    var status = element("span", "", "record-copy-status"); status.setAttribute("role", "status");
    var fallback = element("span", null, "record-copy-fallback"); fallback.hidden = true;
    var field = element("input", null, null); field.type = "text"; field.readOnly = true; field.value = url || "";
    field.setAttribute("aria-label", "Content link for " + label);
    var dismiss = element("button", "Dismiss link", null); dismiss.type = "button";
    dismiss.addEventListener("click", function () { fallback.hidden = true; status.textContent = ""; button.focus(); });
    fallback.append(field, dismiss);
    container.append(status, fallback);
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
      heading.className = "record-heading"; appendCopyLink(heading, item);
      card.appendChild(heading);
      card.appendChild(element("p", item.artifact_id + " · " + item.kind + " · " + item.visibility + " · created by " + item.created_by_user, null));
      card.appendChild(element("p", "Pinned source " + hit.source_version + " · generation " + hit.generation_id + " · policy " + hit.policy_id, "source-note"));
      var evidence = element("ul", null, "evidence-list");
      hit.evidence.forEach(function (entry) {
        evidence.appendChild(element("li", ({name:"Name", manifestpath:"Manifest path", tag:"Tag", hostname:"Hostname", projectpath:"Project path"})[entry.field] + ": " + (entry.field === "manifestpath" ? entry.path : entry.text), null));
      });
      card.appendChild(evidence);
      card.appendChild(element("p", "Representative metadata/path evidence only; not file bytes. Details fetch current artifact metadata.", "source-note"));
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
      details.appendChild(title);
      var nameLine = element("div", null, "record-heading"); nameLine.appendChild(details); appendCopyLink(nameLine, item);
      name.appendChild(nameLine); row.appendChild(name);
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
      var open = rowAction("Open", "open", item, function () { detail.openArtifact(item.artifact_id, item); });
      open.dataset.visibility = item.visibility;
      open.disabled = item.state !== "ready" || expired(item) || contentUrl(item, window.location.origin) === null || ctx.accessMutations.has(item.artifact_id);
      open.title = contentUrl(item, window.location.origin) === null ? "Content hosting is not configured" : item.state !== "ready" ? "Upload is not ready" : expired(item) ? "Artifact expired" : "Open on its isolated content origin";
      group.appendChild(open);
      var remove = rowAction("Delete", "delete", item, function () { detail.deleteArtifact(item.artifact_id); });
      remove.disabled = ctx.deleting.has(item.artifact_id) || ctx.accessMutations.has(item.artifact_id);
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
    if (state.mode !== "catalogue" || typeof IntersectionObserver === "undefined" || nextCursor === null || listError || pendingPage !== null || !ctx.authenticated || $("dashboard-section").hidden) { return; }
    var cursor = nextCursor;
    observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; }) && cursor === nextCursor) { loadPage(false); }
    }, { root: $("results-panel"), rootMargin: "200px" });
    observer.observe($("list-sentinel"));
  }
  function loadPage(reset) {
    if (!ctx.authenticated || readRoute().id !== null || readRoute().error !== null || capabilities === null ||
        (state.mode !== "catalogue" && (!supported(state.mode) || submittedKey !== JSON.stringify(state))) ||
        (!reset && (state.mode !== "catalogue" || nextCursor === null || listError || loadedKey !== JSON.stringify(state)))) { return; }
    // Capture the entire intent now. A superseding request replaces only an
    // unsent intent, never launches another physical list/Search request.
    var intent = { generation: ++listGeneration, epoch: ctx.sessionEpoch, cursor: reset ? null : nextCursor,
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
      if (epoch !== ctx.sessionEpoch || generation !== listGeneration || readRoute().id !== null) { return; }
      if (value.mode !== "catalogue") {
        if (!Array.isArray(body.hits) || (body.next_cursor !== null && body.next_cursor !== undefined) ||
            !["exactmatches", "candidatewindow"].includes(body.count_scope) ||
            (body.count_scope === "candidatewindow" && (!Number.isInteger(body.ranking_limit) || body.ranking_limit < 1)) ||
            body.hits.some(function (hit) { return !hit.artifact || !ID_RE.test(hit.artifact.artifact_id) || !Array.isArray(hit.evidence) ||
              hit.evidence.some(function (entry) { return entry.field === "manifestpath" && typeof entry.path !== "string" ||
                entry.field !== "manifestpath" && entry.path !== null && entry.path !== undefined; }); })) { throw new Error("bad-response"); }
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
      if (epoch !== ctx.sessionEpoch || generation !== listGeneration || readRoute().id !== null) { return; }
      listError = true;
      setText("list-status", (value.mode === "catalogue" ? "List" : "Retrieval") + " failed (" + errorLabel(error) + "). No alternate search was sent.");
      setText("list-error", "Could not load " + (value.mode === "catalogue" ? "artifacts" : "retrieval") + " (" + errorLabel(error) + "). Retry when ready.");
      $("list-error").hidden = false; $("retry-list-button").hidden = false;
    }).finally(function () {
      readBusy = false;
      if (epoch === ctx.sessionEpoch && generation === listGeneration) { pendingPage = null; renderList(); watchList(); }
      pumpRead();
    });
  }

  function failVisible(message) {
    setText("detail-status", message); setText("list-status", message);
    setText("list-error", message); $("list-error").hidden = false;
  }

  // Opening a detail cancels pending list reads; a catalogue reloads on return.
  function suspendForDetail() {
    listGeneration++; pendingPage = null; queuedRead = null;
    if (state.mode === "catalogue") { loadedKey = ""; }
    else if (searchPage === null) { submittedKey = null; }
    if (observer !== null) { observer.disconnect(); }
  }
  function detailFailed() {
    summaries = []; searchPage = null; nextCursor = null; loadedKey = ""; submittedKey = null; listError = true;
    renderList();
    $("retry-list-button").hidden = false;
  }
  function reloadAfterUpload() {
    loadedKey = "";
    if (!$("dashboard-section").hidden) { if (state.mode === "catalogue") { loadPage(true); } else { invalidateCatalogue(); } }
  }
  function invalidateCatalogue() {
    listGeneration++; pendingPage = null; queuedRead = null; summaries = []; searchPage = null; nextCursor = null; loadedKey = ""; listError = false;
    if (state.mode !== "catalogue") { submittedKey = null; setText("list-status", "Results invalidated. Press Search to run retrieval again."); }
    if (observer !== null) { observer.disconnect(); }
    renderList();
    if (ctx.authenticated && readRoute().id === null && state.mode === "catalogue") { loadPage(true); }
  }

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
        !event.isComposing && !composing && ctx.authenticated && !$("workspace-shell").hidden &&
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
  document.addEventListener('account:changed', function () { clearAccount(); checkSession(); });
  window.addEventListener("hashchange", handleRoute);
  checkHostingMode();
  checkSession();
})(document, window, window.fetch.bind(window));
