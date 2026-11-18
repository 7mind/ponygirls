/* manure unlock shell (plain external ES module, no build step).
 *
 * Progressive enhancement over the native form post: submits the
 * password as application/x-www-form-urlencoded to /__manure/unlock
 * on THIS content origin (same-origin by construction; fetch carries
 * the real Origin for the server's CSRF check). On success the server
 * sets the grant cookie and redirects to the artifact root, which fetch
 * follows; the page then navigates to that root. A wrong password is a
 * field error, throttling pauses the form for the server's rate window,
 * and a deleted or expired artifact replaces the card.
 * The password is never placed in URLs, storage, or logs, and the
 * field is always cleared after the attempt. No response text reaches the
 * DOM. Icons and the theme menu come from the content shell's chrome.js; this
 * script works without it.
 */

const WRONG_PASSWORD = 401;
const THROTTLED = 429;
const GONE = [404, 410];
// The server counts unlock attempts per artifact and address over a sliding minute.
const THROTTLE_WINDOW_MS = 60000;

const form = document.getElementById("unlock-form");
const input = document.getElementById("password-input");
const error = document.getElementById("unlock-error");
const throttled = document.getElementById("unlock-throttled");
const show = document.getElementById("show-password");
const submit = form.querySelector("button[type=submit]");

function fieldError(message) {
  const glyph = document.createElement("span");
  glyph.className = "icon icon-sm";
  glyph.dataset.icon = "alert";
  glyph.setAttribute("aria-hidden", "true");
  error.replaceChildren(glyph, message);
  error.hidden = false;
  input.setAttribute("aria-invalid", "true");
}

function clearError() {
  error.hidden = true;
  error.replaceChildren();
  input.removeAttribute("aria-invalid");
}

function pause() {
  throttled.hidden = false;
  for (const control of [input, show, submit]) control.disabled = true;
  setTimeout(() => {
    throttled.hidden = true;
    for (const control of [input, show, submit]) control.disabled = false;
    input.focus();
  }, THROTTLE_WINDOW_MS);
}

function gone() {
  document.getElementById("unlock-card").hidden = true;
  document.getElementById("unlock-gone").hidden = false;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearError();
  const body = new URLSearchParams();
  body.set("password", input.value);
  submit.disabled = true;
  fetch(form.action, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).then((res) => {
    if (res.ok || res.redirected) {
      window.location.assign(new URL("../", form.action).href);
    } else if (res.status === WRONG_PASSWORD) {
      fieldError("That password is not correct. Check it and try again.");
    } else if (res.status === THROTTLED) {
      pause();
    } else if (GONE.includes(res.status)) {
      gone();
    } else {
      throw new Error(String(res.status));
    }
  }).catch(() => {
    /* Generic error: no secret, no server echo, no status detail. */
    fieldError("Unlock failed. Try again in a moment.");
  }).finally(() => {
    input.value = "";
    if (throttled.hidden) submit.disabled = false;
  });
});

show.hidden = false;
show.addEventListener("click", () => {
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  show.setAttribute("aria-pressed", String(visible));
  show.lastChild.textContent = visible ? "Hide" : "Show";
});
