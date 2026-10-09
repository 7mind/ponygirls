/* manure unlock shell (plain external JS, no build step).
 *
 * Progressive enhancement over the native form post: submits the
 * password as application/x-www-form-urlencoded to /__manure/unlock
 * on THIS content origin (same-origin by construction; fetch carries
 * the real Origin for the server's CSRF check). On success the server
 * sets the grant cookie and answers 303 to /, which fetch follows;
 * the page then navigates to /. On failure a generic error is shown.
 * The password is never placed in URLs, storage, or logs, and the
 * field is always cleared after the attempt. This file contains no
 * innerHTML/outerHTML/insertAdjacentHTML and touches no storage.
 */
"use strict";

(function () {
  var form = document.getElementById("unlock-form");
  var input = document.getElementById("password-input");
  var err = document.getElementById("unlock-error");

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    err.hidden = true;
    err.textContent = "";
    var body = new URLSearchParams();
    body.set("password", input.value);
    fetch(form.getAttribute("action") || "/__manure/unlock", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    }).then(function (res) {
      if (res.ok || res.redirected) {
        window.location.assign("/");
        return;
      }
      throw new Error(String(res.status));
    }).catch(function () {
      /* Generic error: no secret, no server echo, no status detail. */
      err.textContent = "Unlock failed. Check the password and try again.";
      err.hidden = false;
    }).then(function () {
      input.value = "";
    });
  });
})();
