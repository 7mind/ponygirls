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
 * field is always cleared after the attempt. Only the trusted shared icon
 * set is inserted as markup; no response text reaches the DOM.
 */
import { icon } from "./__manure/ui/icons.js";

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

function hydrateIcons(root) {
  for (const slot of root.querySelectorAll("span[data-icon]")) {
    const extra = [...slot.classList].filter((name) => name !== "icon");
    slot.outerHTML = icon(slot.dataset.icon, ...extra);
  }
}

function fieldError(message) {
  error.replaceChildren();
  error.insertAdjacentHTML("afterbegin", icon("alert", "icon-sm"));
  error.append(message);
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

function themeMenu() {
  const control = document.querySelector("[data-theme-control]");
  const root = document.documentElement;
  // theme-init.js is the only writer of the theme attributes; without it there is nothing to choose.
  if (!root.dataset.themeChoice) return;
  control.hidden = false;
  const button = control.querySelector("button[aria-haspopup]");
  const menu = control.querySelector("[role=menu]");
  const items = [...menu.querySelectorAll("[data-theme-set]")];
  const close = (refocus) => { menu.hidden = true; button.setAttribute("aria-expanded", "false"); if (refocus) button.focus(); };
  const sync = () => {
    for (const item of items) item.setAttribute("aria-checked", String(item.dataset.themeSet === root.dataset.themeChoice));
    button.replaceChildren();
    button.insertAdjacentHTML("afterbegin", icon(root.dataset.theme === "dark" ? "moon" : "sun"));
  };
  button.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) (items.find((item) => item.getAttribute("aria-checked") === "true") || items[0]).focus();
  });
  for (const item of items) item.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("ui:theme-choice", { detail: item.dataset.themeSet }));
    close(true);
  });
  document.addEventListener("click", (event) => { if (!menu.hidden && !control.contains(event.target)) close(false); });
  control.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) close(true); });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-theme-choice"] });
  sync();
}

hydrateIcons(document);
themeMenu();
