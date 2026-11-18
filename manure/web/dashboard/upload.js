/* Quick upload: stage files (picker, paste, drop) and publish each through the resumable current protocol.
 * External passwords stay transient in this page and are cleared on dismissal and on session changes.
 */
import { FileUpload } from "./quick-upload.js";
import { errorLabel, bytes, contentUrl } from "./common.js";

"use strict";

// ctx: shared session state and DOM helpers; catalogue: list refresh after an upload; copy: clipboard helper.
export function createUpload(ctx, catalogue, copy) {
  var document = ctx.document, window = ctx.window, fetch = ctx.fetch, $ = ctx.$, setText = ctx.setText, element = ctx.element, apiFetch = ctx.apiFetch;
  var showLoggedOut = catalogue.showLoggedOut;
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
        var url = contentUrl({ artifact_id: item.id, content_url: item.link }, window.location.origin);
        if (url !== null) {
          var link = element("input", null, null); link.type = "text"; link.readOnly = true; link.value = url;
          link.setAttribute("aria-label", "Content link for " + item.file.name);
          link.addEventListener("click", function () { link.select(); }); row.appendChild(link);
          var button = element("button", "Copy content link", null); button.type = "button";
          button.addEventListener("click", function () { copy(url, "upload-status", "Content link copied."); }); row.appendChild(button);
        } else { row.appendChild(element("p", "Ready, but no validated content link is configured. Open the artifact in the catalogue.", null)); }
      }
      if (item.password !== null) {
        row.appendChild(element("p", "External password — share securely; signed-in users can retrieve it later:", null));
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
    if (!ctx.authenticated || uploadBusy || $("logout-button").disabled) { return; }
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
    if (ctx.authenticated && event.clipboardData && event.clipboardData.files.length) {
      event.preventDefault(); stageFiles(event.clipboardData.files);
    }
  });
  $("quick-upload").addEventListener("dragover", function (event) { if (ctx.authenticated) { event.preventDefault(); } });
  $("quick-upload").addEventListener("drop", function (event) {
    if (ctx.authenticated) { event.preventDefault(); stageFiles(event.dataTransfer.files); }
  });
  $("upload-clear").addEventListener("click", clearUploads);
  $("upload-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!ctx.authenticated || uploadBusy || $("logout-button").disabled) { return; }
    var generation = uploadGeneration, epoch = ctx.sessionEpoch;
    uploads.forEach(function (item) {
      if (item.id === null && item.phase !== "init-uncertain") { item.visibility = uploadVisibility(); }
    });
    var controller = new AbortController(); uploadAbort = controller; uploadBusy = true;
    function check() { if (!ctx.authenticated || generation !== uploadGeneration || epoch !== ctx.sessionEpoch) { throw new Error("cancelled"); } }
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
      check(); setText("upload-status", "Finished this upload attempt. Ready links are shown below. Internal links require ctx.authenticated readers.");
      catalogue.reloadAfterUpload();
    } catch (_error) {
      // Logout/dismiss invalidates this operation; never restore its secrets or UI.
    } finally {
      if (generation === uploadGeneration && epoch === ctx.sessionEpoch) { uploadBusy = false; uploadAbort = null; renderUploads(); }
    }
  });

  return { clearUploads: clearUploads };
}
