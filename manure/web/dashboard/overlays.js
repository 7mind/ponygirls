/* In-app overlays shared by the dashboard views: popup menus, anchored popovers, the confirmation dialog, the manual-copy
 * dialog and toasts (spec §1.8, §2.2). Never window.confirm/alert. Text always goes through textContent;
 * the only markup inserted is the constant icon SVG of ./ui/icons.js.
 */
import { icon } from "./ui/icons.js";

"use strict";

var TOAST_MS = 3500;
var MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

export function createOverlays(document, window) {
  var openMenu = null;
  var nextId = 0;
  function uniqueId(prefix) { nextId++; return prefix + nextId; }

  function iconNode(name, className) {
    var holder = document.createElement("span");
    holder.innerHTML = icon(name, className);
    return holder.firstChild;
  }
  function hydrateIcons(root) {
    root.querySelectorAll("[data-icon]").forEach(function (node) {
      node.replaceWith(iconNode(node.dataset.icon, node.dataset.iconClass || ""));
    });
  }

  // Menus: a trigger [aria-haspopup="menu"][aria-controls=<menu id>] toggles its [role="menu"] element.
  function items(menu) { return Array.from(menu.querySelectorAll(MENU_ITEMS)).filter(function (item) { return !item.hidden && !item.disabled; }); }
  function closeMenu(restoreFocus) {
    if (openMenu === null) { return; }
    var current = openMenu;
    openMenu = null;
    current.menu.hidden = true;
    current.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) { current.trigger.focus(); }
  }
  function showMenu(trigger, focusFirst) {
    var menu = document.getElementById(trigger.getAttribute("aria-controls"));
    if (menu === null) { throw new Error("menu trigger without its menu: " + trigger.getAttribute("aria-controls")); }
    closeMenu(false);
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    openMenu = { trigger: trigger, menu: menu };
    if (focusFirst && items(menu).length) { items(menu)[0].focus(); }
  }
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest('[aria-haspopup="menu"][aria-controls]');
    if (trigger !== null && !trigger.disabled) {
      var same = openMenu !== null && openMenu.trigger === trigger;
      if (same) { closeMenu(false); } else { showMenu(trigger, event.detail === 0); }
      return;
    }
    if (openMenu === null) { return; }
    var item = event.target.closest(MENU_ITEMS);
    if (!openMenu.menu.contains(event.target) || item !== null) { closeMenu(item !== null); }
  });
  document.addEventListener("keydown", function (event) {
    if (openMenu === null) { return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
    if (event.key === "Tab") { closeMenu(false); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") { return; }
    var list = items(openMenu.menu);
    if (!list.length) { return; }
    event.preventDefault();
    var index = list.indexOf(document.activeElement);
    list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1 + (index === -1 ? 1 : 0))) % list.length].focus();
  }, true);

  // Popovers: a trigger inside an .anchor toggles its panel. A pointer press or focus outside the anchor, a route change
  // and Escape close it (Escape returns focus to the trigger). Unlike a menu, its panel may hold focusable content.
  function popover(trigger, panel, opened) {
    var anchor = trigger.parentElement, open = false;
    function set(next, restoreFocus) {
      open = next;
      panel.hidden = !next;
      trigger.setAttribute("aria-expanded", String(next));
      if (next) { opened(); } else if (restoreFocus) { trigger.focus(); }
    }
    function outside(event) { return open && !anchor.contains(event.target); }
    trigger.addEventListener("click", function () { set(!open, false); });
    document.addEventListener("pointerdown", function (event) { if (outside(event)) { set(false, false); } });
    document.addEventListener("focusin", function (event) { if (outside(event)) { set(false, false); } });
    document.addEventListener("keydown", function (event) {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); set(false, true); }
    }, true);
    window.addEventListener("hashchange", function () { if (open) { set(false, false); } });
    return { isOpen: function () { return open; } };
  }

  // Dialogs: built on <dialog>; Escape cancels; focus returns to the element focused before opening.
  function dialogShell(title, wide) {
    var dialog = document.createElement("dialog");
    dialog.className = "dialog" + (wide ? " dialog-wide" : "");
    var head = document.createElement("div"); head.className = "dialog-head";
    var heading = document.createElement("h2"); heading.textContent = title;
    heading.id = uniqueId("dialog-title-");
    dialog.setAttribute("aria-labelledby", heading.id);
    var close = document.createElement("button");
    close.type = "button"; close.className = "btn btn-ghost btn-icon"; close.setAttribute("aria-label", "Close");
    close.appendChild(iconNode("x", ""));
    head.append(heading, close);
    var body = document.createElement("div"); body.className = "dialog-body";
    var foot = document.createElement("div"); foot.className = "dialog-foot";
    dialog.append(head, body, foot);
    return { dialog: dialog, body: body, foot: foot, close: close };
  }
  function present(shell, initialFocus) {
    var opener = openMenu !== null && openMenu.menu.contains(document.activeElement) ? openMenu.trigger : document.activeElement;
    closeMenu(false);
    return new Promise(function (resolve) {
      shell.dialog.addEventListener("close", function () {
        shell.dialog.remove();
        if (opener !== null && opener.isConnected && typeof opener.focus === "function") { opener.focus({ preventScroll: true }); }
        resolve(shell.dialog.returnValue === "confirm");
      }, { once: true });
      shell.close.addEventListener("click", function () { shell.dialog.close("cancel"); });
      document.body.appendChild(shell.dialog);
      shell.dialog.showModal();
      initialFocus.focus();
    });
  }
  // A dialog body block: a paragraph, or { definitions: [[code, description], …] } as a definition list.
  function paragraph(content) {
    if (content !== null && typeof content === "object" && !Array.isArray(content)) {
      var list = document.createElement("dl"); list.className = "dl";
      content.definitions.forEach(function (pair) {
        var term = document.createElement("dt"), code = document.createElement("code"), description = document.createElement("dd");
        code.textContent = pair[0]; description.textContent = pair[1];
        term.appendChild(code); list.append(term, description);
      });
      return list;
    }
    var node = document.createElement("p");
    (Array.isArray(content) ? content : [content]).forEach(function (part) {
      if (typeof part === "string") { node.append(part); }
      else if (part.strong !== undefined) { var strong = document.createElement("strong"); strong.textContent = part.strong; node.append(strong); }
      else { var sub = document.createElement("span"); sub.className = "sub hex"; sub.textContent = part.sub; node.append(sub); }
    });
    return node;
  }
  // Resolves true only when the named confirm button was pressed; Cancel has the initial focus.
  // paragraphs: strings or arrays of strings, { strong: text } and { sub: text } (a monospace second line) parts.
  function confirmAction(options) {
    var shell = dialogShell(options.title, false);
    options.paragraphs.forEach(function (content) { shell.body.appendChild(paragraph(content)); });
    var cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", function () { shell.dialog.close("cancel"); });
    var confirm = document.createElement("button");
    confirm.type = "button"; confirm.className = options.danger ? "btn btn-danger" : "btn btn-primary";
    if (options.icon !== null) { confirm.appendChild(iconNode(options.icon, "")); }
    confirm.append(options.confirmLabel);
    confirm.addEventListener("click", function () { shell.dialog.close("confirm"); });
    shell.foot.append(cancel, confirm);
    return present(shell, cancel);
  }
  // Explains a fact (no decision): one Close button.
  function inform(title, paragraphs, wide) {
    var shell = dialogShell(title, wide);
    paragraphs.forEach(function (content) { shell.body.appendChild(paragraph(content)); });
    var done = document.createElement("button");
    done.type = "button"; done.className = "btn"; done.textContent = "Close";
    done.addEventListener("click", function () { shell.dialog.close("cancel"); });
    shell.foot.append(done);
    return present(shell, done);
  }
  // Clipboard refused or unavailable: show the value selected in a read-only field to copy by hand.
  function manualCopy(label, value, reason) {
    var shell = dialogShell("Copy the link manually", true);
    shell.body.appendChild(paragraph(reason + " Select the value below and copy it yourself."));
    var field = document.createElement("div"); field.className = "field";
    var input = document.createElement("input");
    input.className = "input input-mono"; input.readOnly = true; input.value = value;
    input.id = uniqueId("manual-copy-");
    var caption = document.createElement("label"); caption.className = "label"; caption.htmlFor = input.id; caption.textContent = label;
    field.append(caption, input);
    shell.body.appendChild(field);
    var done = document.createElement("button");
    done.type = "button"; done.className = "btn"; done.textContent = "Done";
    done.addEventListener("click", function () { shell.dialog.close("cancel"); });
    shell.foot.append(done);
    var shown = present(shell, input);
    input.select();
    return shown;
  }
  // Copies text; success is a toast, a refusal opens the manual-copy dialog. Resolves true when copied.
  function copyText(label, value, success) {
    var clipboard = window.navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      return manualCopy(label, value, "Clipboard access is unavailable here.").then(function () { return false; });
    }
    var pending;
    try { pending = clipboard.writeText(value); } catch (error) { pending = Promise.reject(error); }
    return Promise.resolve(pending).then(function () { toast(success); return true; }, function () {
      return manualCopy(label, value, "The browser did not allow clipboard access.").then(function () { return false; });
    });
  }

  var toasts = null;
  function toast(text) {
    if (toasts === null) {
      toasts = document.createElement("div");
      toasts.className = "toasts"; toasts.setAttribute("role", "status");
      document.body.appendChild(toasts);
    }
    var node = document.createElement("div"); node.className = "toast";
    var label = document.createElement("span"); label.textContent = text;
    node.append(iconNode("check", ""), label);
    toasts.appendChild(node);
    window.setTimeout(function () { node.remove(); }, TOAST_MS);
  }

  return { iconNode: iconNode, hydrateIcons: hydrateIcons, closeMenu: closeMenu, popover: popover, confirmAction: confirmAction,
    inform: inform, copyText: copyText, toast: toast };
}
