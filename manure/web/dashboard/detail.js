/* Artifact detail view: metadata, manifest, access mode, external passwords, delete and content handoff.
 * One-time passwords stay transient; uploaded bytes never render here.
 */
import * as current from "./current-protocol.js";
import { API, ID_RE, errorLabel, bytes, dateText, contentUrl } from "./common.js";

"use strict";

// ctx: shared session state and DOM helpers; catalogue: the list view's routing and invalidation hooks.
export function createDetail(ctx, catalogue) {
  var document = ctx.document, window = ctx.window, $ = ctx.$, setText = ctx.setText, element = ctx.element, apiFetch = ctx.apiFetch;
  var deleting = ctx.deleting, accessMutations = ctx.accessMutations;
  var readRoute = catalogue.readRoute, routeHash = catalogue.routeHash, renderList = catalogue.renderList,
    invalidateCatalogue = catalogue.invalidateCatalogue, failVisible = catalogue.failVisible;
  var detailGeneration = 0;
  var revealGeneration = 0;
  var passwordRead = null;
  var openGeneration = 0;
  var currentDetailId = null;
  var currentDetailInfo = null;

  function addDetailRow(term, value) {
    $("detail-list").appendChild(element("dt", term, null));
    $("detail-list").appendChild(element("dd", value, null));
  }
  function updateDetailActions() {
    var info = currentDetailInfo;
    var busy = currentDetailId !== null && (accessMutations.has(currentDetailId) || deleting.has(currentDetailId) ||
      passwordRead !== null && passwordRead.id === currentDetailId);
    var ready = info !== null && info.state === "ready";
    var selected = $("access-mode").value;
    $("access-mode").disabled = info === null || !ready || busy;
    $("access-save-button").disabled = info === null || !ready || busy || selected === info.visibility;
    $("rotate-button").hidden = info === null || info.visibility !== "external";
    $("rotate-button").disabled = info === null || busy;
    $("get-password-button").hidden = info === null || info.visibility !== "external";
    $("get-password-button").disabled = info === null || busy;
    $("delete-button").disabled = info === null || busy;
    $("open-button").disabled = info === null || !ready || busy || contentUrl(info, window.location.origin) === null;
    var description = selected === "internal" ? "Only ctx.authenticated users can read this artifact, through the API or an internal access grant." : selected === "external" ? "Readers need the external password. All signed-in users can copy the current password. Older hash-only passwords require one rotation first." : "No Manure authentication is required for anyone who can reach the content URL.";
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
    addDetailRow("Tags", info.tags.length === 0 ? "None supplied" : "");
    if (info.tags.length !== 0) {
      var tags = $("detail-list").lastElementChild; tags.className = "metadata-tags";
      info.tags.forEach(function (tag) { tags.appendChild(element("span", tag, "type-badge")); });
    }
    addDetailRow("Hostname (supplied)", info.hostname === null || info.hostname === undefined ? "Not supplied" : info.hostname);
    $("detail-list").lastElementChild.className = "metadata-literal";
    addDetailRow("Project path (supplied)", info.project_path === null || info.project_path === undefined ? "Not supplied" : info.project_path);
    $("detail-list").lastElementChild.className = "metadata-literal";
    var url = contentUrl(info, window.location.origin);
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
    var epoch = ctx.sessionEpoch;
    catalogue.suspendForDetail();
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
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration) { return; }
      renderDetail(info, id);
      setText("access-status", accessMutations.has(id) ? "An access or password update is still in progress. Wait for its status to be refreshed." : "");
      setText("detail-status", "");
      loadFiles();
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration) { return; }
      currentDetailId = null; currentDetailInfo = null;
      $("detail-section").hidden = true; $("dashboard-section").hidden = false;
      window.history.replaceState(null, "", routeHash(null));
      catalogue.detailFailed();
      failVisible("Detail failed (" + errorLabel(error) + "). The artifact may have expired or been deleted. Retry loading to return to the catalogue.");
    });
  }
  function loadFiles() {
    var id = currentDetailId;
    if (id === null || currentDetailInfo === null) { return; }
    var generation = detailGeneration;
    var epoch = ctx.sessionEpoch;
    $("file-list").textContent = "";
    $("files-retry-button").hidden = true;
    setText("files-status", "Loading file manifest…");
    apiFetch(current.manifest(id)).then(function (body) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || id !== currentDetailId) { return; }
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
      setText("files-status", body.files.length + " manifest entries. Downloads use the ctx.authenticated API and are served as attachments.");
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || id !== currentDetailId) { return; }
      setText("files-status", "Files could not be loaded (" + errorLabel(error) + ").");
      $("files-retry-button").hidden = false;
    });
  }

  /* Internal artifacts use a single-use form POST to their content endpoint. */
  function openArtifact(id, knownInfo) {
    if (!ID_RE.test(id) || accessMutations.has(id)) { return; }
    var epoch = ctx.sessionEpoch;
    var generation = ++openGeneration;
    var infoRequest = knownInfo === null ? apiFetch(current.artifact(id)) : Promise.resolve(knownInfo);
    setText("detail-status", "Opening content…");
    infoRequest.then(function (info) {
      if (epoch !== ctx.sessionEpoch || generation !== openGeneration) { return; }
      var url = contentUrl(info, window.location.origin);
      if (url === null) { throw new Error("content-unavailable"); }
      if (info.visibility !== "internal") { window.location.assign(url); return; }
      return apiFetch(current.grant(id)).then(function (body) {
        if (epoch === ctx.sessionEpoch && generation === openGeneration) { postGrantHandoff(url, body.grant); }
      });
    }).catch(function (error) {
      if (epoch === ctx.sessionEpoch && generation === openGeneration) { failVisible("Open failed (" + errorLabel(error) + ")."); }
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
    var epoch = ctx.sessionEpoch;
    deleting.add(id);
    document.querySelectorAll('button[data-action="delete"][data-artifact-id="' + id + '"]').forEach(function (button) { button.disabled = true; });
    if (currentDetailId === id) { updateDetailActions(); setText("detail-status", "Deleting artifact…"); }
    setText("list-status", "Deleting artifact…");
    apiFetch(current.remove(id)).then(function () {
      if (epoch !== ctx.sessionEpoch) { return; }
      if (currentDetailId === id) {
        detailGeneration++; openGeneration++; hideRotateOutput();
        currentDetailId = null; currentDetailInfo = null;
        $("detail-section").hidden = true; $("dashboard-section").hidden = false;
        window.history.replaceState(null, "", routeHash(null));
      }
      invalidateCatalogue();
    }).catch(function (error) {
      if (epoch === ctx.sessionEpoch) { failVisible("Delete failed (" + errorLabel(error) + ")."); }
    }).finally(function () {
      deleting.delete(id);
      if (epoch === ctx.sessionEpoch) {
        document.querySelectorAll('button[data-action="delete"][data-artifact-id="' + id + '"]').forEach(function (button) { button.disabled = false; });
        if (currentDetailId === id) { updateDetailActions(); }
      }
    });
  }
  function hideRotateOutput() {
    revealGeneration++;
    passwordRead = null;
    $("rotate-output").hidden = true;
    setText("rotate-password", "");
    $("rotate-copy-button").disabled = true;
  }
  function beginAccessMutation(id, message) {
    openGeneration++; hideRotateOutput();
    var mutation = { epoch: ctx.sessionEpoch, generation: detailGeneration, reveal: revealGeneration, refreshNeeded: true };
    accessMutations.set(id, mutation);
    invalidateCatalogue(); updateDetailActions();
    setText("access-status", message); setText("detail-status", message);
    return mutation;
  }
  function isMutationView(id, mutation) {
    return mutation.epoch === ctx.sessionEpoch && mutation.generation === detailGeneration &&
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
    if (!ctx.authenticated || readRoute().id !== id) { return Promise.resolve(); }
    var epoch = ctx.sessionEpoch;
    if (!mutation.refreshNeeded && epoch === mutation.epoch && currentDetailId === id) {
      setText("access-status", message); setText("detail-status", message);
      return Promise.resolve();
    }
    var generation = ++detailGeneration;
    if (epoch !== mutation.epoch) { message = "A previous access request finished. Use Copy current password if the external password was not shown."; }
    $("access-refresh-button").hidden = true;
    setText("access-status", message + " Refreshing current metadata…");
    return apiFetch(current.artifact(id)).then(function (info) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || readRoute().id !== id) { return; }
      renderDetail(info, id); loadFiles();
      setText("access-status", message); setText("detail-status", message);
    }).catch(function (error) {
      if (epoch !== ctx.sessionEpoch || generation !== detailGeneration || readRoute().id !== id) { return; }
      currentDetailInfo = null; updateDetailActions();
      $("access-refresh-button").hidden = false;
      var failure = message + " Current metadata could not be refreshed (" + errorLabel(error) + "). Reload access status before changing access again. If External is enabled, use Copy current password to retrieve it.";
      setText("access-status", failure); setText("detail-status", failure);
    });
  }
  function releaseAccessMutation(id, mutation) {
    if (accessMutations.get(id) === mutation) { accessMutations.delete(id); }
    if (currentDetailId === id) { updateDetailActions(); }
    if (ctx.authenticated && readRoute().id === null) { renderList(); }
  }
  function onAccessSubmit(event) {
    event.preventDefault();
    var id = currentDetailId;
    var info = currentDetailInfo;
    var visibility = $("access-mode").value;
    if (id === null || info === null || info.state !== "ready" || accessMutations.has(id) || deleting.has(id) ||
        ["internal", "external", "public"].indexOf(visibility) === -1 || visibility === info.visibility) { return; }
    if (visibility === "public" && !window.confirm("Make artifact " + id + " public? No Manure authentication will be required for anyone who can reach its content URL. Existing content grants will be revoked.")) { return; }
    var mutation = beginAccessMutation(id, "Saving access mode… You can retrieve the generated password later with Copy current password.");
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
      return visibility === "external" ? showPassword ? "Access changed to External. Share the password securely; all signed-in users can retrieve it later." : "Access changed to External. Use Copy current password to retrieve its password." : "Access changed to " + visibility + ". Existing content grants were revoked.";
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return "Access change could not be confirmed (" + errorLabel(error) + "). It may have been applied; no change was retried. If External is enabled, use Copy current password to retrieve it.";
    }).then(function (message) {
      return settleAccessMutation(id, mutation, message);
    }).finally(function () { releaseAccessMutation(id, mutation); });
  }
  function onCopyCurrentPassword() {
    var id = currentDetailId;
    if (id === null || currentDetailInfo === null || currentDetailInfo.visibility !== "external" ||
        accessMutations.has(id) || deleting.has(id) || passwordRead !== null) { return; }
    hideRotateOutput();
    var request = { id: id, epoch: ctx.sessionEpoch, generation: detailGeneration, reveal: revealGeneration };
    passwordRead = request; updateDetailActions();
    setText("detail-status", "Loading current external password…");
    apiFetch(current.externalPassword(id)).then(function (body) {
      var password = takeExternalPassword(body, body.external_password !== null);
      if (!canReveal(id, request)) { return; }
      if (password === null) {
        setText("detail-status", "This older password was stored as a hash only. Rotate once to make the new password available for copying.");
        return;
      }
      revealPassword(password);
      setText("detail-status", "Current password loaded. Copying does not rotate it or revoke existing grants.");
      copy(password, "detail-status", "Password copied. Dismiss the reveal when finished.");
      password = null;
    }).catch(function (error) {
      if (canReveal(id, request)) { setText("detail-status", "Current password could not be loaded (" + errorLabel(error) + "). No password was rotated."); }
    }).finally(function () {
      if (passwordRead === request) { passwordRead = null; updateDetailActions(); }
    });
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
      return showPassword ? "Password rotated. Share it securely; all signed-in users can retrieve it later." : "Password rotated, but it was not displayed in this view. Use Copy current password to retrieve it.";
    }).catch(function (error) {
      mutation.refreshNeeded = true;
      return "Rotation could not be confirmed (" + errorLabel(error) + "). The old password may have been revoked. Refresh status, then use Copy current password to retrieve the current value.";
    }).then(function (message) {
      return settleAccessMutation(id, mutation, message);
    }).finally(function () { releaseAccessMutation(id, mutation); });
  }
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
  $("get-password-button").addEventListener("click", onCopyCurrentPassword);
  $("rotate-copy-button").addEventListener("click", function () { copy($("rotate-password").textContent, "detail-status", "Password copied. Dismiss the reveal when finished."); });
  $("copy-id-button").addEventListener("click", function () { copy(currentDetailId, "detail-status", "Artifact ID copied."); });
  $("copy-link-button").addEventListener("click", function () { if (currentDetailInfo !== null) { copy(contentUrl(currentDetailInfo, window.location.origin), "detail-status", "Content link copied."); } });
  $("files-retry-button").addEventListener("click", loadFiles);
  $("detail-back-button").addEventListener("click", function () { catalogue.invalidateNavigation(); window.location.hash = routeHash(null); });

  // Fences every in-flight detail, open and reveal result (navigation, sign-out).
  function invalidate() { detailGeneration++; openGeneration++; hideRotateOutput(); }
  function leave() {
    invalidate();
    currentDetailId = null; currentDetailInfo = null;
    $("detail-section").hidden = true;
  }
  function clear() {
    currentDetailId = null; currentDetailInfo = null;
    $("detail-list").textContent = "";
    $("file-list").textContent = "";
    setText("detail-name", "Artifact"); setText("detail-subtitle", "");
    setText("detail-status", "");
    setText("access-status", ""); $("access-refresh-button").hidden = true; updateDetailActions();
  }
  function cancelOpen() { openGeneration++; hideRotateOutput(); }

  return { showDetail: showDetail, openArtifact: openArtifact, deleteArtifact: deleteArtifact, copy: copy,
    invalidate: invalidate, leave: leave, clear: clear, cancelOpen: cancelOpen };
}
