/* Manure dashboard shell: session, masthead, fragment routes and the artifact catalogue.
 * Same-origin management only; uploaded bytes never render here. Credentials and one-time
 * passwords stay transient. No HTML injection; account surfaces belong to account.js.
 */
import * as current from "./current-protocol.js";
import { ID_RE, domHelpers, errorLabel, bytes, expired, contentUrl } from "./common.js";
import { createOverlays } from "./overlays.js";
import { createDetail } from "./detail.js";
import { createUpload } from "./upload.js";
import { createAccountClient, ACCOUNT_REQUEST_TIMEOUT_MS } from "./account-client.js";
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
  var SKELETON_ROWS = 14;
  var SOON_MS = 48 * 3600 * 1000;
  var MINUTE_MS = 60 * 1000, HOUR_MS = 60 * MINUTE_MS, DAY_MS = 24 * HOUR_MS;
  var ACCOUNT_PREFIX = "#account";
  var VIEWS = { catalogue: "dashboard-section", upload: "upload-section", cli: "cli-section", detail: "detail-section" };
  var ACCESS_CHIPS = { internal: ["chip", "lock", "Internal"], external: ["chip chip-warn", "key", "External"], public: ["chip chip-info", "external", "Public"] };
  var STATES = { uploading: ["status status-run", "Uploading"], publishing: ["status status-run", "Publishing"] };
  var EVIDENCE = { name: "Name", manifestpath: "Manifest path", tag: "Tag", hostname: "Hostname", projectpath: "Project path" };
  var listGeneration = 0;
  var pendingPage = null;
  var pendingReset = false;
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
  var view = null;
  // Where the catalogue was left (rows stay cached): restored on return, keyed by the applied query.
  var listPlace = null;
  var detailFromList = false;
  var dragDepth = 0;
  var state = readRoute().state;
  var dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  var overlays = createOverlays(document, window);
  var ctx = Object.assign({ document: document, window: window, fetch: fetch, apiFetch: apiFetch, overlays: overlays,
    sessionEpoch: 0, authenticated: false, deleting: new Set(), accessMutations: new Map() }, domHelpers(document));
  var $ = ctx.$, setText = ctx.setText, element = ctx.element;
  var accountClient = createAccountClient({ fetch: fetch, requestTimeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS, signal: null });
  var detail = createDetail(ctx, { readRoute: readRoute, routeHash: routeHash, renderList: renderList, invalidateCatalogue: invalidateCatalogue,
    failVisible: failVisible, backToList: backToList, showCatalogue: function () { showView("catalogue"); }, suspendForDetail: suspendForDetail, detailFailed: detailFailed });
  var upload = createUpload(ctx, { showLoggedOut: showLoggedOut, reloadAfterUpload: reloadAfterUpload }, detail.copy);
  overlays.hydrateIcons(document);

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
    var chip = $("path-mode-warning");
    // Hosting capabilities are public, site-wide state: a concurrent session
    // check/login/logout must not discard the warning response.
    var generation = ++capabilityGeneration;
    return current.request(fetch, current.capabilities()).then(function (result) {
      if (generation !== capabilityGeneration) { return; }
      if (!Number.isInteger(result.max_list_limit) || result.max_list_limit < 1 ||
          !Array.isArray(result.search_modes) || typeof result.metadata_only_search !== "boolean") { throw new Error("bad-response"); }
      capabilities = result; capabilitiesError = false;
      chip.hidden = result.content_mode !== "path";
      chip.dataset.hosting = "path";
      setText("path-mode-label", "Path-mode hosting");
      chip.title = "Low-security path hosting: artifacts share the dashboard/API origin and can exercise your browser session permissions. Trusted content only.";
      updateDraft();
      if (ctx.authenticated && readRoute().view === "catalogue") { handleRoute(true); }
    }).catch(function () {
      if (generation !== capabilityGeneration) { return; }
      capabilities = null; capabilitiesError = true;
      chip.hidden = false;
      chip.dataset.hosting = "unknown";
      setText("path-mode-label", "Isolation unknown");
      chip.title = "Content-origin isolation could not be determined. Verify hosting configuration before opening untrusted content.";
      updateDraft();
      if (ctx.authenticated && readRoute().view === "catalogue") { handleRoute(true); }
    });
  }
  function supported(value) {
    return capabilities !== null && capabilities.search_modes.includes(value) && capabilities.metadata_only_search;
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  // #/artifacts?query=… (catalogue) · #/artifact/<id>?query=… · #/upload · #/cli; #account… belongs to account.js.
  function readRoute() {
    var hash = window.location.hash;
    var queryAt = hash.indexOf("?");
    var params = new URLSearchParams(queryAt === -1 ? "" : hash.slice(queryAt + 1));
    var match = /^#\/artifact\/([0-9a-f]{32})(?:\?|$)/.exec(hash);
    var page = /^#\/(upload|cli)(?:\?|$)/.exec(hash);
    var routeView = match ? "detail" : page ? page[1] : "catalogue";
    var parts = [];
    params.forEach(function (value,key) {
      if (["mode","access","state","expired","kind","owner","sort","direction","tag","hostname","project","q"].includes(key)) {
        parts.push((key === "q" ? "text" : key) + ":" + JSON.stringify(value));
      }
    });
    var expression = [params.get("query"),parts.join(" ")].filter(function (value) { return value; }).join(" ");
    try {
      if (params.getAll("query").length > 1) { throw new current.ExpressionError("Duplicate query URL parameter.",0,expression.length); }
      return { view: routeView, id: match ? match[1] : null, state: parseExpression(expression), error: null, expression: expression };
    }
    catch (error) { return { view: routeView, id: match ? match[1] : null, state: parseExpression(""), error: error, expression: expression }; }
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
  function showView(name) {
    view = name;
    $("main").dataset.currentView = name;
    Object.keys(VIEWS).forEach(function (key) { $(VIEWS[key]).hidden = key !== name; });
    markNav(navName(name));
  }
  function navName(name) { return name === "detail" || name === "catalogue" ? "artifacts" : name; }
  function markNav(current) {
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      if (link.dataset.nav === current) { link.setAttribute("aria-current", "page"); }
      else { link.removeAttribute("aria-current"); }
    });
  }
  // The Artifacts link and the brand return to the applied query, not to an empty catalogue.
  function updateListLinks() {
    var hash = routeHash(null);
    document.querySelectorAll('[data-nav="artifacts"], .brand').forEach(function (link) { link.setAttribute("href", hash); });
  }
  function backToList() {
    if (detailFromList) { window.history.back(); return; }
    invalidateNavigation(); window.location.hash = routeHash(null);
  }

  // ── Query bar ──────────────────────────────────────────────────────────
  function draftState() { return parseExpression($("filter-text").value); }
  function draftDiffers() {
    try { return JSON.stringify(draftState()) !== JSON.stringify(state); } catch (_error) { return true; }
  }
  function updateDraft() {
    var draft = null, diagnostic = null;
    try { draft = draftState(); } catch (error) { diagnostic = error; }
    var differs = draft === null || JSON.stringify(draft) !== JSON.stringify(state);
    var unavailable = draft !== null && draft.mode !== "catalogue" && !supported(draft.mode);
    $("query-diagnostic").hidden = diagnostic === null && !unavailable;
    $("query-diagnostic").textContent = diagnostic !== null ? diagnostic.message : unavailable ? "Retrieval mode " + draft.mode + " unavailable; no fallback will be sent." : "";
    $("filter-text").setAttribute("aria-invalid", String(diagnostic !== null));
    $("list-form").dataset.invalid = String(diagnostic !== null);
    $("refresh-button").disabled = readRoute().error !== null;
    $("clear-search-button").hidden = $("filter-text").value.length === 0;
    $("clear-search-button").disabled = composing;
    $("draft-status").hidden = !differs;
    $("search-shortcut").hidden = differs;
    setText("draft-status-text", differs ? "Draft changed — press Enter to apply" : "Draft matches applied query");
    $("draft-status").title = differs ? "Applied: " + (serializeExpression(state) || "all unexpired artifacts · created_at descending") + ". Sorting and shortcuts wait until the draft is applied or cleared." : "";
    document.querySelectorAll("[data-sort]").forEach(function (button) {
      button.disabled = state.mode !== "catalogue" || differs;
      button.title = state.mode !== "catalogue" ? "Retrieval results are ordered by relevance" : differs ? "Apply or clear the changed draft before sorting" : "Sort applied query";
    });
    document.querySelectorAll("[data-visibility-preset], [data-toggle-preset]").forEach(function (button) {
      button.disabled = differs || button.dataset.togglePreset !== undefined && state.mode !== "catalogue";
    });
    $("sort-summary").hidden = state.mode === "catalogue";
    setText("sort-summary", state.mode === "catalogue" ? "Sorted by " + document.querySelector('[data-sort="' + state.sort + '"]').getAttribute("aria-label").replace(/^Sort by /, "") + (state.direction === "asc" ? " ↑" : " ↓") : retrievalSummary());
  }
  function retrievalSummary() {
    if (searchPage === null) { return "Relevance order · not sortable"; }
    var scope = searchPage.count_scope === "exactmatches" ? searchPage.total + " exact matches" :
      searchPage.total + " candidate-window artifacts (ranked candidate window " + searchPage.ranking_limit + "; not a corpus-wide total)";
    return "Relevance order · " + scope + " · one page, up to " + Math.min(PAGE_LIMIT, capabilities.max_list_limit) + " hits";
  }
  function updateControls() {
    $("filter-text").value = serializeExpression(state);
    if (typeof queryEditor !== "undefined") { queryEditor.close(); }
    document.querySelectorAll("[data-sort]").forEach(function (button) {
      var selected = button.dataset.sort === state.sort && state.mode === "catalogue";
      // Only the sorted column carries aria-sort (the shared header style draws its arrow).
      if (selected) { button.closest("th").setAttribute("aria-sort", state.direction === "asc" ? "ascending" : "descending"); }
      else { button.closest("th").removeAttribute("aria-sort"); }
    });
    document.querySelectorAll("[data-visibility-preset]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.visibilityPreset === (state.visibility || "")));
    });
    document.querySelector('[data-toggle-preset="uploading"]').setAttribute("aria-pressed", String(state.mode === "catalogue" && state.itemState === "uploading"));
    document.querySelector('[data-toggle-preset="expired"]').setAttribute("aria-pressed", String(state.mode === "catalogue" && state.includeExpired));
    $("catalogue-table").dataset.mode = state.mode;
    updateListLinks();
    updateDraft();
  }

  // ── Navigation and list state ──────────────────────────────────────────
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
    // The rendered rows belong to the previous query until the route is handled.
    $("catalogue-table").setAttribute("aria-busy", "true");
    updateControls();
    if (window.location.hash === hash) { handleRoute(); }
    else { window.location.hash = hash; }
  }
  // Applies a shortcut to the applied query at once (catalogue reads; retrieval waits for Search).
  function applyShortcut(change) {
    if (composing || draftDiffers()) { return; }
    var next = Object.assign({}, state, change);
    try { serializeExpression(next); }
    catch (error) {
      if (!(error instanceof current.ExpressionError)) { throw error; }
      notice("danger", error.message + " Query and results unchanged.", false); return;
    }
    navigateList(next, next.mode === "catalogue");
  }
  // Leaving the catalogue keeps its rows; only pending reads are fenced. A cancelled first page reloads on return.
  function leaveCatalogue() {
    if (view === "catalogue") { listPlace = { key: loadedKey, y: window.scrollY, focus: listPlace !== null && listPlace.pendingFocus ? listPlace.pendingFocus : null }; }
    listGeneration++; pendingPage = null; queuedRead = null;
    if (observer !== null) { observer.disconnect(); }
    if (pendingReset) { loadedKey = ""; pendingReset = false; }
    if (state.mode !== "catalogue" && searchPage === null) { submittedKey = null; }
  }
  function suspendForDetail() { leaveCatalogue(); }
  function handleRoute(keepDraft) {
    if (!ctx.authenticated) { return; }
    if (window.location.hash.startsWith(ACCOUNT_PREFIX)) { markNav(null); return; }
    var route = readRoute();
    if (route.view === "upload" || route.view === "cli") {
      if (view !== route.view) {
        leaveCatalogue(); detail.leave(); detailFromList = false;
        showView(route.view); window.scrollTo(0, 0);
      }
      return;
    }
    var changed = JSON.stringify(route.state) !== JSON.stringify(state);
    var currentDraft = keepDraft === true || !changed ? $("filter-text").value : null;
    if (changed) {
      // Direct hash/history navigation bypasses navigateList. Fence both a held
      // result and any queued unsent intent before changing the owner of rows.
      invalidateNavigation(); loadedKey = ""; submittedKey = null; listPlace = null;
    }
    state = route.state;
    updateControls();
    if (!changed && currentDraft !== null) { $("filter-text").value = currentDraft; updateDraft(); }
    if (route.error !== null) {
      invalidateNavigation(); loadedKey = ""; summaries = []; searchPage = null; nextCursor = null;
      $("filter-text").value = route.expression; updateDraft(); renderList();
      detail.leave(); showView("catalogue");
      notice("warn", "Invalid URL query. Edit the visible expression and press Search; no request was sent.", false);
      setCounter("Not loaded");
      return;
    }
    if (route.id !== null) {
      if (view === "catalogue") { leaveCatalogue(); } else { detailFromList = false; }
      // The detail section replaces the list once the artifact has loaded (detail.js); other views close now.
      view = "detail"; $("main").dataset.currentView = "detail"; markNav("artifacts");
      $("upload-section").hidden = true; $("cli-section").hidden = true;
      window.scrollTo(0, 0);
      detail.showDetail(route.id); return;
    }
    detail.leave(); detailFromList = false;
    var returning = view !== "catalogue";
    showView("catalogue");
    if (loadedKey !== JSON.stringify(state)) {
      listPlace = null;
      summaries = []; searchPage = null; nextCursor = null; renderList();
      if (capabilities === null) {
        setCounter(capabilitiesError ? "Not loaded" : "Loading artifacts…");
        if (capabilitiesError) { notice("danger", "Capabilities unavailable. Retry connection; no search was sent.", true); }
        else { notice("info", "Checking search capabilities…", false); }
      } else if (state.mode !== "catalogue" && !supported(state.mode)) {
        setCounter("Not loaded");
        notice("warn", "Retrieval mode " + state.mode + " unavailable on this server. No fallback was sent.", true);
      } else if (state.mode !== "catalogue" && submittedKey !== JSON.stringify(state)) {
        setCounter("Not searched");
        notice("info", "Press Search to run retrieval. No model query has been sent.", false);
      } else { loadPage(true); }
    }
    else {
      renderList();
      if (returning) { restorePlace(); }
      watchList();
    }
  }
  // Back from a detail (or another view): same rows, same scroll position, focus on the originating row.
  function restorePlace() {
    var place = listPlace;
    listPlace = null;
    if (place === null || place.key !== loadedKey) { return; }
    window.scrollTo(0, place.y);
    if (place.focus !== null) {
      var target = document.querySelector('#catalogue-table [data-action="details"][data-artifact-id="' + place.focus + '"]');
      if (target !== null) { target.focus({ preventScroll: true }); }
    }
  }
  function openFromList(event, id) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { return; }
    event.preventDefault();
    listPlace = { pendingFocus: id };
    detailFromList = true;
    window.location.hash = routeHash(id);
  }

  // ── Session ────────────────────────────────────────────────────────────
  // The signed-out view: account.js renders the login card into main[data-account-auth].
  function removeAuthMount() {
    $("login-section").hidden = true;
    $("login-section").replaceChildren();
  }
  function removeOutlet() {
    var outlet = document.querySelector("[data-account-outlet]");
    if (outlet !== null) { outlet.remove(); }
  }
  function clearAccount() {
    // Removing the outlet tears the account area down (account.js observes it).
    removeOutlet();
    upload.clearUploads();
    var hadAccount = ctx.authenticated;
    ctx.sessionEpoch++; invalidateNavigation(); ctx.authenticated = false;
    // A URL fragment is visible to the next identity in this tab. On the
    // session boundary remove applied queries, owner filters and unsent input.
    if (hadAccount) { window.history.replaceState(null, "", "#/artifacts"); }
    state = readRoute().state;
    updateControls();
    summaries = []; searchPage = null; submittedKey = null; queuedRead = null; loadedKey = ""; nextCursor = null; listError = false;
    listPlace = null; detailFromList = false; view = null;
    if (observer !== null) { observer.disconnect(); }
    $("artifact-list").textContent = ""; $("retrieval-results").textContent = "";
    detail.clear();
    setText("whoami-text", ""); setText("whoami-label", ""); setText("whoami-avatar", "");
    setCounter(""); clearNotice();
    $("users-menu-item").hidden = true;
    Object.keys(VIEWS).forEach(function (key) { $(VIEWS[key]).hidden = true; });
    $("main-nav").hidden = true;
    $("user-menu-anchor").hidden = true;
    $("main").hidden = true;
  }
  function showLoggedOut() {
    clearAccount();
    $("session-section").hidden = true;
    if ($("login-section").children.length === 0) {
      var mount = element("main", null, null);
      mount.setAttribute("data-account-auth", "");
      $("login-section").appendChild(mount);
    }
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
      removeAuthMount();
      $("session-section").hidden = true;
      $("main").hidden = false;
      $("main-nav").hidden = false;
      $("user-menu-anchor").hidden = false;
      setText("whoami-text", body.user_id);
      setText("whoami-label", body.user_id);
      setText("whoami-avatar", Array.from(body.user_id)[0].toUpperCase());
      var outlet = element("div", null, null);
      outlet.setAttribute("data-account-outlet", "");
      outlet.dataset.accountUserId = body.user_id;
      outlet.hidden = true;
      $("main").after(outlet);
      showUsersEntry(epoch, body.user_id);
      updateControls(); handleRoute();
      if (capabilities === null) { checkHostingMode(); }
      return true;
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || error.message === "unauthorized") { return false; }
      removeAuthMount();
      $("session-section").hidden = false;
      setText("session-status", "The service is unavailable (" + errorLabel(error) + "). This does not mean your session expired.");
      $("session-retry-button").hidden = false;
      return false;
    }).finally(function () { $("session-retry-button").disabled = false; });
  }
  // The Users entry is for administrators only; servers without the account profile endpoint have none.
  function showUsersEntry(epoch, userId) {
    accountClient.profile().then(function (profile) {
      if (epoch === ctx.sessionEpoch) { $("users-menu-item").hidden = !(profile.user.id === userId && profile.manage.users); }
    }, function () {
      if (epoch === ctx.sessionEpoch) { $("users-menu-item").hidden = true; }
    });
  }

  // ── Catalogue rendering ────────────────────────────────────────────────
  function setCounter(text) { setText("list-status", text); }
  // One persistent inline notice for the list (spec §1.8); kind: info | warn | danger; title may be null.
  function notice(kind, text, retry, title) {
    var box = $("list-notice");
    box.className = "notice list-notice" + (kind === "info" ? "" : " notice-" + kind);
    box.setAttribute("role", kind === "danger" ? "alert" : "status");
    box.firstElementChild.replaceWith(overlays.iconNode(kind === "info" ? "info" : "alert", ""));
    $("list-notice-title").hidden = title === undefined || title === null;
    setText("list-notice-title", title === undefined || title === null ? "" : title);
    setText("list-notice-text", text);
    $("retry-list-button").hidden = !retry;
    box.hidden = false;
  }
  function clearNotice() { $("list-notice").hidden = true; $("retry-list-button").hidden = true; }
  function failVisible(message) {
    setText("detail-status", message);
    notice("danger", message, $("retry-list-button").hidden === false || listError);
  }
  function relative(time) {
    var delta = time - Date.now(), span = Math.abs(delta);
    var text = span < HOUR_MS ? Math.max(1, Math.round(span / MINUTE_MS)) + " min" : span < DAY_MS ? Math.round(span / HOUR_MS) + " h" : Math.round(span / DAY_MS) + " d";
    return delta < 0 ? text + " ago" : "in " + text;
  }
  function timeCell(value, className) {
    var cell = element("td", null, className);
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) { cell.textContent = "Unknown"; return cell; }
    cell.title = date.toISOString();
    cell.append(dateFormat.format(date), element("span", relative(date.getTime()), "sub"));
    return cell;
  }
  function expiryCell(item) {
    var cell = element("td", null, "hide-md");
    if (item.expires_at === null || item.expires_at === undefined) { cell.appendChild(element("span", "Never", "faint")); return cell; }
    var date = new Date(item.expires_at);
    if (!Number.isFinite(date.getTime())) { cell.textContent = "Unknown"; return cell; }
    var delta = date.getTime() - Date.now();
    cell.title = date.toISOString();
    cell.append(delta > 0 && delta < SOON_MS ? element("span", relative(date.getTime()), "status status-warn") : relative(date.getTime()),
      element("span", dateFormat.format(date), "sub"));
    return cell;
  }
  function artifactRow(item, evidence) {
    var id = item.artifact_id, label = item.name || id, isExpired = expired(item);
    var row = element("tr", null, isExpired ? "is-expired" : null);
    row.dataset.artifactId = id;
    row.dataset.visibility = item.visibility;
    var kind = element("span", null, item.kind === "dir" ? "kind kind-dir" : "kind");
    kind.title = item.kind === "dir" ? "Directory" : "File";
    kind.append(overlays.iconNode(item.kind === "dir" ? "folder" : "file", ""), element("span", kind.title, "sr-only"));
    var link = element("a", label, "cell-title");
    link.href = routeHash(id); link.title = label;
    link.dataset.action = "details"; link.dataset.artifactId = id;
    link.addEventListener("click", function (event) { openFromList(event, id); });
    var sub = element("div", null, "cell-sub");
    if (isExpired) { sub.appendChild(element("span", "Expired", "status status-danger")); }
    else if (STATES[item.state]) { sub.appendChild(element("span", STATES[item.state][1], STATES[item.state][0])); }
    if (evidence === null) { sub.appendChild(element("span", id, "hex")); }
    else {
      var matched = element("span", "Matched · " + evidence.text, "evidence");
      matched.title = evidence.source;
      sub.appendChild(matched);
    }
    var grow = element("div", null, "grow"); grow.append(link, sub);
    var nameCell = element("td", null, null);
    var nameBox = element("div", null, "name-cell"); nameBox.append(kind, grow); nameCell.appendChild(nameBox);
    var access = ACCESS_CHIPS[item.visibility];
    var chip = element("span", null, access[0]); chip.append(overlays.iconNode(access[1], "icon-sm"), access[2]);
    var accessCell = element("td", null, null); accessCell.appendChild(chip);
    row.append(nameCell, accessCell, element("td", bytes(item.total_bytes), "col-num hide-sm"), element("td", String(item.file_count), "col-num hide-md"),
      timeCell(item.created_at, "hide-sm"), expiryCell(item), element("td", item.created_by_user, "hide-md"), actionsCell(item, label));
    return row;
  }
  function linkUnavailable(item) {
    return contentUrl(item, window.location.origin) === null ? "Content link unavailable" : item.state !== "ready" ? "Upload is not ready" : expired(item) ? "Artifact expired" :
      ctx.accessMutations.has(item.artifact_id) || ctx.deleting.has(item.artifact_id) ? "Artifact update in progress" : null;
  }
  function copyLink(item, label) {
    var reason = linkUnavailable(item);
    if (reason !== null) { overlays.toast(reason + ". Content link unavailable."); return; }
    overlays.copyText("Content link · " + label, contentUrl(item, window.location.origin), "Content link copied");
  }
  function actionsCell(item, label) {
    var id = item.artifact_id;
    var cell = element("td", null, "col-actions");
    var end = element("span", null, "row-end");
    var open = element("button", "Open", "btn btn-sm btn-ghost");
    open.type = "button"; open.dataset.action = "open"; open.dataset.artifactId = id; open.dataset.visibility = item.visibility;
    open.disabled = item.state !== "ready" || expired(item) || contentUrl(item, window.location.origin) === null || ctx.accessMutations.has(id);
    open.title = contentUrl(item, window.location.origin) === null ? "Content hosting is not configured" : item.state !== "ready" ? "Upload is not ready" : expired(item) ? "Artifact expired" : "Open on its isolated content origin";
    open.addEventListener("click", function () { detail.openArtifact(id, item); });
    var hover = element("span", null, "row-actions");
    var copy = element("button", null, "btn btn-sm btn-ghost btn-icon");
    copy.type = "button"; copy.dataset.action = "copy-link"; copy.dataset.artifactId = id;
    copy.setAttribute("aria-label", "Copy content link for " + label);
    copy.title = linkUnavailable(item) || "Copy content link (no password or access grant)";
    copy.disabled = linkUnavailable(item) !== null;
    copy.appendChild(overlays.iconNode("link", ""));
    copy.addEventListener("click", function () { copyLink(item, label); });
    var anchor = element("span", null, "anchor");
    var more = element("button", null, "btn btn-sm btn-ghost btn-icon");
    more.type = "button"; more.dataset.artifactId = id; more.dataset.action = "more";
    more.setAttribute("aria-label", "More actions for " + label);
    more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", "row-menu-" + id);
    more.appendChild(overlays.iconNode("more", ""));
    var menu = element("div", null, "menu"); menu.id = "row-menu-" + id; menu.setAttribute("role", "menu"); menu.hidden = true;
    menu.setAttribute("aria-label", "Actions for " + label);
    function item_(text, iconName, action, handler) {
      var entry = element("button", null, "menu-item" + (action === "delete" ? " is-danger" : ""));
      entry.type = "button"; entry.setAttribute("role", "menuitem"); entry.dataset.action = action; entry.dataset.artifactId = id;
      entry.append(overlays.iconNode(iconName, ""), text);
      entry.addEventListener("click", handler);
      return entry;
    }
    var remove = item_("Delete…", "trash", "delete", function () { detail.deleteArtifact(id, item); });
    remove.disabled = ctx.deleting.has(id) || ctx.accessMutations.has(id);
    menu.append(
      item_("Copy ID", "copy", "copy-id", function () { overlays.copyText("Artifact ID · " + label, id, "Artifact ID copied"); }),
      item_("Copy content link", "link", "copy-link-menu", function () { copyLink(item, label); }),
      item_("Details", "info", "details-menu", function () { listPlace = { pendingFocus: id }; detailFromList = true; window.location.hash = routeHash(id); }),
      element("div", null, "menu-sep"), remove);
    anchor.append(more, menu);
    hover.append(copy, anchor);
    end.append(open, hover);
    cell.appendChild(end);
    return cell;
  }
  function hitEvidence(hit) {
    return { text: hit.evidence.map(function (entry) { return EVIDENCE[entry.field] + ": " + (entry.field === "manifestpath" ? entry.path : entry.text); }).join(" · "),
      source: "Representative metadata/path evidence, not file bytes · pinned source " + hit.source_version + " · generation " + hit.generation_id + " · policy " + hit.policy_id };
  }
  function renderList() {
    var retrieval = state.mode !== "catalogue";
    var list = retrieval ? $("retrieval-results") : $("artifact-list");
    var active = document.activeElement;
    var focused = active !== null && $("catalogue-table").contains(active) && active.dataset.artifactId ? { id: active.dataset.artifactId, action: active.dataset.action } : null;
    var fragment = document.createDocumentFragment();
    if (retrieval) { if (searchPage !== null) { searchPage.hits.forEach(function (hit) { fragment.appendChild(artifactRow(hit.artifact, hitEvidence(hit))); }); } }
    else { summaries.forEach(function (item) { fragment.appendChild(artifactRow(item, null)); }); }
    list.replaceChildren(fragment);
    (retrieval ? $("artifact-list") : $("retrieval-results")).replaceChildren();
    $("artifact-list").hidden = retrieval; $("retrieval-results").hidden = !retrieval;
    if (focused !== null) {
      var target = list.querySelector('[data-artifact-id="' + focused.id + '"][data-action="' + focused.action + '"]');
      if (target !== null) { target.focus({ preventScroll: true }); }
    }
    var count = retrieval ? searchPage === null ? 0 : searchPage.hits.length : summaries.length;
    var loading = pendingPage !== null && pendingReset;
    $("catalogue-table").setAttribute("aria-busy", String(pendingPage !== null));
    var skeleton = $("skeleton-rows");
    skeleton.hidden = !loading;
    if (loading && skeleton.children.length === 0) {
      for (var index = 0; index < SKELETON_ROWS; index++) {
        var row = element("tr", null, null);
        var name = element("td", null, null);
        name.append(element("span", null, "skeleton sk-60"), element("span", null, "skeleton sk-30"));
        row.appendChild(name);
        [null, "col-num hide-sm", "col-num hide-md", "hide-sm", "hide-md", "hide-md"].forEach(function (className) {
          var cell = element("td", null, className); cell.appendChild(element("span", null, "skeleton")); row.appendChild(cell);
        });
        row.appendChild(element("td", null, null));
        skeleton.appendChild(row);
      }
    }
    var settled = pendingPage === null && !listError && (retrieval ? searchPage !== null : loadedKey === JSON.stringify(state) && loadedKey !== "");
    var empty = settled && count === 0;
    $("empty-state").hidden = !empty;
    if (empty) {
      var applied = serializeExpression(state);
      $("empty-text").replaceChildren(applied ? "Nothing matches " : "There are no artifacts yet", applied ? element("code", applied, null) : "",
        ". Field values are exact and case-sensitive; expired artifacts are hidden unless you add ", element("code", "expired:true", null), ".");
    }
    $("catalogue-table").hidden = listError && count === 0;
    renderFoot(retrieval, count, settled);
    if (settled) {
      setCounter(retrieval ? count + " hits · " + state.mode : count === 0 ? "No matches" : nextCursor !== null ? count + " loaded · more available" : "All " + count + " artifacts loaded");
      if (!listError) { clearNotice(); }
    }
    updateDraft();
  }
  function renderFoot(retrieval, count, settled) {
    var foot = $("list-foot");
    var text;
    if (pendingPage !== null && !pendingReset) { text = "Loading more artifacts… (" + count + " loaded)"; foot.dataset.state = "loading"; }
    else if (settled && count > 0 && (retrieval || nextCursor === null)) { text = retrieval ? "End of results · " + count + " hits" : "End of list · " + count + " artifacts"; foot.dataset.state = "end"; }
    else if (settled && nextCursor !== null) { text = count + " loaded · scroll to load more"; foot.dataset.state = "more"; }
    else { text = ""; foot.dataset.state = "idle"; }
    foot.className = "list-foot" + (foot.dataset.state === "end" ? " list-end" : "");
    foot.replaceChildren();
    if (foot.dataset.state === "loading") { foot.appendChild(element("span", null, "spinner")); }
    foot.appendChild(element("span", text, null));
  }
  function watchList() {
    if (observer !== null) { observer.disconnect(); }
    if (state.mode !== "catalogue" || typeof IntersectionObserver === "undefined" || nextCursor === null || listError || pendingPage !== null || !ctx.authenticated || view !== "catalogue") { return; }
    var cursor = nextCursor;
    observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; }) && cursor === nextCursor) { loadPage(false); }
    }, { root: null, rootMargin: "0px 0px 240px 0px" });
    observer.observe($("list-foot"));
  }
  function loadPage(reset) {
    if (!ctx.authenticated || readRoute().view !== "catalogue" || readRoute().error !== null || capabilities === null ||
        (state.mode !== "catalogue" && (!supported(state.mode) || submittedKey !== JSON.stringify(state))) ||
        (!reset && (state.mode !== "catalogue" || nextCursor === null || listError || loadedKey !== JSON.stringify(state)))) { return; }
    // Capture the entire intent now. A superseding request replaces only an
    // unsent intent, never launches another physical list/Search request.
    var intent = { generation: ++listGeneration, epoch: ctx.sessionEpoch, cursor: reset ? null : nextCursor,
      reset: reset, value: Object.assign({}, state), limit: Math.min(PAGE_LIMIT, capabilities.max_list_limit) };
    pendingPage = intent.generation; pendingReset = reset; listError = false;
    if (observer !== null) { observer.disconnect(); }
    clearNotice();
    if (reset) {
      summaries = []; searchPage = null; nextCursor = null;
      loadedKey = JSON.stringify(intent.value);
      window.scrollTo(0, 0);
      setCounter(state.mode === "catalogue" ? "Loading artifacts…" : "Searching metadata and manifest paths…");
    }
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
      if (epoch !== ctx.sessionEpoch || generation !== listGeneration || readRoute().view !== "catalogue") { return; }
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
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== listGeneration || readRoute().view !== "catalogue") { return; }
      listError = true;
      var rows = value.mode === "catalogue" ? summaries.length : 0;
      if (rows === 0) { setCounter("Not loaded"); }
      notice("danger", "The request failed (" + errorLabel(error) + "). " + (rows > 0 ? "The loaded rows are kept." : "No alternate search was sent; the applied query is unchanged.") + " Retry when ready.", true,
        rows > 0 ? "More artifacts could not be loaded" : value.mode === "catalogue" ? "Artifacts could not be loaded" : "Retrieval failed");
    }).finally(function () {
      readBusy = false;
      if (epoch === ctx.sessionEpoch && generation === listGeneration) { pendingPage = null; pendingReset = false; renderList(); watchList(); }
      pumpRead();
    });
  }
  function detailFailed() {
    summaries = []; searchPage = null; nextCursor = null; loadedKey = ""; submittedKey = null; listError = true;
    showView("catalogue");
    renderList();
    setCounter("Not loaded");
    $("retry-list-button").hidden = false;
  }
  function reloadAfterUpload() {
    loadedKey = "";
    if (view === "catalogue") { if (state.mode === "catalogue") { loadPage(true); } else { invalidateCatalogue(); } }
  }
  function invalidateCatalogue() {
    listGeneration++; pendingPage = null; pendingReset = false; queuedRead = null; summaries = []; searchPage = null; nextCursor = null; loadedKey = ""; listError = false;
    listPlace = null;
    if (observer !== null) { observer.disconnect(); }
    renderList();
    if (state.mode !== "catalogue") { submittedKey = null; setCounter("Not searched"); notice("info", "Results invalidated. Press Search to run retrieval again.", false); }
    if (ctx.authenticated && readRoute().view === "catalogue" && state.mode === "catalogue") { loadPage(true); }
  }

  // ── Theme ──────────────────────────────────────────────────────────────
  function syncTheme() {
    var choice = document.documentElement.dataset.themeChoice;
    document.querySelectorAll("[data-theme-set]").forEach(function (item) { item.setAttribute("aria-checked", String(item.dataset.themeSet === choice)); });
  }
  document.querySelectorAll("[data-theme-set]").forEach(function (item) {
    item.addEventListener("click", function () {
      document.dispatchEvent(new window.CustomEvent("ui:theme-choice", { detail: item.dataset.themeSet }));
      syncTheme();
    });
  });
  new window.MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-choice"] });
  syncTheme();

  // ── Files dropped or pasted anywhere continue on the Upload page ───────
  function hasFiles(event) { return event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes("Files"); }
  function handOff(files) {
    if (!files.length) { return; }
    if (readRoute().view !== "upload") { window.location.hash = "#/upload"; }
    upload.stageFiles(files);
  }
  document.addEventListener("dragenter", function (event) {
    if (!ctx.authenticated || !hasFiles(event)) { return; }
    var files = Array.from(event.dataTransfer.items).filter(function (item) { return item.kind === "file"; }).length;
    setText("drop-summary", (files === 1 ? "1 file" : files + " files") + " · staged on the Upload page, where access can be changed");
    dragDepth++; $("drop-overlay").hidden = false;
  });
  document.addEventListener("dragleave", function (event) {
    if (!ctx.authenticated || !hasFiles(event)) { return; }
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) { $("drop-overlay").hidden = true; }
  });
  document.addEventListener("dragover", function (event) { if (ctx.authenticated && hasFiles(event)) { event.preventDefault(); } });
  document.addEventListener("drop", function (event) {
    dragDepth = 0; $("drop-overlay").hidden = true;
    if (!ctx.authenticated || event.dataTransfer === null) { return; }
    event.preventDefault(); handOff(event.dataTransfer.files);
  });
  document.addEventListener("paste", function (event) {
    if (ctx.authenticated && event.clipboardData && event.clipboardData.files.length) {
      event.preventDefault(); handOff(event.clipboardData.files);
    }
  });

  // ── Wiring ─────────────────────────────────────────────────────────────
  // The skip link moves focus only: its #main fragment must not replace the route.
  document.querySelector(".skip-link").addEventListener("click", function (event) { event.preventDefault(); $("main").focus(); });
  $("session-retry-button").addEventListener("click", checkSession);
  $("path-mode-warning").addEventListener("click", function () {
    if ($("path-mode-warning").dataset.hosting === "unknown") {
      overlays.inform("Content isolation unknown", ["The dashboard could not determine how artifacts are hosted. Verify the hosting configuration before opening untrusted content."], false);
    } else {
      overlays.inform("Path-mode hosting", ["This server hosts artifacts on the same origin as the dashboard and API. Opened content can act with your browser session, so open trusted content only. Subdomain mode isolates every artifact on its own origin."], false);
    }
  });
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
  $("empty-clear-button").addEventListener("click", function () { navigateList(parseExpression(""), true); });
  $("query-diagnostic").addEventListener("click", function () {
    try { draftState(); } catch (error) { $("filter-text").focus(); $("filter-text").setSelectionRange(error.start,error.end); }
  });
  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey &&
        !event.isComposing && !composing && ctx.authenticated && view === "catalogue" && !$("main").hidden &&
        !document.querySelector("dialog[open], [role=dialog]:not([hidden])")) {
      event.preventDefault(); $("filter-text").focus(); $("filter-text").select();
    }
  });
  $("refresh-button").addEventListener("click", function () { if (state.mode !== "catalogue") { submittedKey = JSON.stringify(state); } loadPage(true); });
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
        notice("danger", error.message + " Query and results unchanged; shorten the query before sorting.", false);
      }
    });
  });
  document.querySelectorAll("[data-visibility-preset]").forEach(function (button) {
    button.addEventListener("click", function () { applyShortcut({ visibility: button.dataset.visibilityPreset || null }); });
  });
  document.querySelector('[data-toggle-preset="uploading"]').addEventListener("click", function () {
    applyShortcut({ itemState: state.itemState === "uploading" ? null : "uploading" });
  });
  document.querySelector('[data-toggle-preset="expired"]').addEventListener("click", function () {
    applyShortcut({ includeExpired: !state.includeExpired });
  });
  // Field inserters edit the draft at the caret and open completion; they never send a request.
  document.querySelectorAll("[data-insert-field]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (composing) { return; }
      var input = $("filter-text"), text = button.dataset.insertField;
      var at = input.selectionStart === null ? input.value.length : input.selectionStart;
      var before = input.value.slice(0, at), after = input.value.slice(input.selectionEnd === null ? at : input.selectionEnd);
      var prefix = before === "" || /\s$/.test(before) ? "" : " ";
      input.value = before + prefix + text + after;
      input.focus();
      var caret = before.length + prefix.length + text.length;
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  });
  function openSyntax() {
    overlays.inform("Query syntax", [
      "Plain words match artifact names and IDs. Fields narrow the list and are combined with AND. Press Enter or Search to apply; typing and suggestions never send a request.",
      { definitions: [
        ["access:internal|external|public", "access mode"],
        ["tag:release tag:reviewed", "has every listed tag (exact, case-sensitive)"],
        ["hostname:build-host", "exact supplied hostname"],
        ["project:\"/work/repo\"", "exact supplied project path"],
        ["state:ready|uploading|publishing", "publication state (catalogue)"],
        ["expired:true", "also list expired artifacts (catalogue; hidden by default)"],
        ["sort:name direction:asc", "same as clicking a column header (catalogue; default created_at descending)"],
        ["mode:lexical|semantic|hybrid", "ranked retrieval over names, tags, supplied provenance and manifest paths, never file bytes; adds kind:file|dir and owner:\"Exact User\""],
        ["text:\"exact: text\"", "literal search text with colons, JSON escapes or retrieval syntax; not combined with bare terms"]
      ] },
      "Lexical uses English words/stems, quoted phrases, OR and -negation; semantic and hybrid call the model only on Search or Refresh. Field names ignore case; closed values are lowercase; metadata values keep their exact case and whitespace.",
      "↑↓ select · Enter insert · Escape closes suggestions, then clears the draft · Ctrl/⌘ K focuses the search field."
    ], true);
  }
  $("syntax-button").addEventListener("click", openSyntax);
  document.querySelectorAll("[data-open-syntax]").forEach(function (button) { button.addEventListener("click", openSyntax); });
  document.addEventListener("account:changed", function () { clearAccount(); checkSession(); });
  // The account page replaces the workspace view: no view is current while it is shown.
  document.addEventListener("account:route", function (event) { markNav(event.detail.section !== null || view === null ? null : navName(view)); });
  window.addEventListener("hashchange", function () { handleRoute(); });
  checkHostingMode();
  checkSession();
})(document, window, window.fetch.bind(window));
