/* manure dashboard shell (plain external JS, no build step).
 *
 * Security rules (CONTRACT.md sections 4-5):
 * - The login token lives only in the password input; it is POSTed once
 *   as JSON in the login request body and the field is cleared right
 *   after. It is never written to storage, URLs, or logs.
 * - Auth after login relies on the HttpOnly session cookie, which JS
 *   cannot read by construction.
 * - Internal artifact views use a one-time grant (POST grants API, then
 *   a top-level urlencoded form POST to the artifact's own content
 *   host). The long-term credential never leaves the API origin.
 * - All artifact-controlled strings are rendered with textContent only;
 *   this file contains no innerHTML/outerHTML/insertAdjacentHTML.
 */
"use strict";

(function () {
  var API = "/api/v1";
  var ID_RE = /^[0-9a-f]{32}$/;

  function $(id) { return document.getElementById(id); }

  function setText(id, value) {
    var el = $(id);
    el.textContent = value;
    return el;
  }

  function apiFetch(path, options) {
    var opts = options || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    return fetch(API + path, opts);
  }

  /* Generic status/error rendering: static text plus the server's
   * machine-readable code only. Never reflects request bodies. */
  function errorCodeOf(res, body) {
    if (body && typeof body === "object" && body.error && body.error.code) {
      return String(body.error.code);
    }
    return "http-" + res.status;
  }

  function readJsonSafe(res) {
    return res.json().catch(function () { return null; });
  }

  /* -- session ------------------------------------------------------ */

  var loginSection = $("login-section");
  var dashboardSection = $("dashboard-section");
  var detailSection = $("detail-section");

  function showLoggedOut() {
    loginSection.hidden = false;
    dashboardSection.hidden = true;
    detailSection.hidden = true;
    $("whoami").hidden = true;
    /* A1: leaving the session must not leave secret DOM behind. */
    hideRotateOutput();
    currentDetailId = null;
    setText("detail-status", "");
  }

  function showLoggedIn(user) {
    loginSection.hidden = true;
    dashboardSection.hidden = false;
    $("whoami").hidden = false;
    setText("whoami-text", "signed in as " + user);
  }

  function checkSession() {
    return apiFetch("/whoami", { method: "GET" }).then(function (res) {
      if (!res.ok) {
        showLoggedOut();
        return false;
      }
      return res.json().then(function (body) {
        showLoggedIn(body.user_id || body.user || "unknown");
        return true;
      }).catch(function () {
        showLoggedIn("unknown");
        return true;
      });
    }).catch(function () {
      showLoggedOut();
      return false;
    });
  }

  function onLoginSubmit(ev) {
    ev.preventDefault();
    var input = $("token-input");
    var token = input.value;
    var err = $("login-error");
    err.hidden = true;
    err.textContent = "";
    apiFetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    }).then(function (res) {
      if (!res.ok) {
        return readJsonSafe(res).then(function (body) {
          throw new Error(errorCodeOf(res, body));
        });
      }
      return null;
    }).then(function () {
      return checkSession();
    }).then(function (ok) {
      if (ok) { loadPage(true); }
    }).catch(function (e) {
      err.textContent = "Login failed (" + e.message + ").";
      err.hidden = false;
    }).then(function () {
      /* Transient credential: always clear, success or failure. */
      input.value = "";
      token = "";
    });
  }

  function onLogout() {
    apiFetch("/logout", { method: "POST" }).catch(function () {}).then(function () {
      hideRotateOutput();
      currentDetailId = null;
      setText("detail-status", "");
      showLoggedOut();
      setText("list-status", "");
      $("artifact-list").textContent = "";
    });
  }

  /* -- artifact list -------------------------------------------------- */

  var PAGE_LIMIT = 50;
  var pageStarts = [null]; /* start cursor of each visited page */
  var pageIndex = 0;
  var currentCursor = null;

  function listQuery(cursor) {
    var params = new URLSearchParams();
    params.set("limit", String(PAGE_LIMIT));
    if (cursor) { params.set("cursor", cursor); }
    if ($("include-expired").checked) { params.set("include_expired", "true"); }
    return "/artifacts?" + params.toString();
  }

  function filteredSummaries(summaries) {
    var text = $("filter-text").value.trim().toLowerCase();
    var vis = $("filter-visibility").value;
    var state = $("filter-state").value;
    return summaries.filter(function (a) {
      if (vis && a.visibility !== vis) { return false; }
      if (state && a.state !== state) { return false; }
      if (text) {
        var name = String(a.name || "").toLowerCase();
        var id = String(a.artifact_id || "").toLowerCase();
        if (name.indexOf(text) === -1 && id.indexOf(text) === -1) { return false; }
      }
      return true;
    });
  }

  function metaLine(a) {
    return "access=" + a.visibility + " state=" + a.state +
      " kind=" + a.kind + " bytes=" + a.total_bytes +
      " files=" + a.file_count +
      " expires=" + (a.expires_at === null || a.expires_at === undefined ? "never" : a.expires_at);
  }

  function renderList(summaries, nextCursor) {
    var list = $("artifact-list");
    list.textContent = "";
    var shown = filteredSummaries(summaries);
    setText("list-status", shown.length + " of " + summaries.length + " artifacts shown");
    shown.forEach(function (a) {
      var li = document.createElement("li");
      var title = document.createElement("strong");
      title.textContent = a.name || a.artifact_id;
      li.appendChild(title);
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = a.artifact_id + " — " + metaLine(a);
      li.appendChild(meta);
      var actions = document.createElement("div");
      actions.className = "row-actions";
      var view = document.createElement("button");
      view.type = "button";
      view.textContent = "Details";
      view.setAttribute("data-artifact-id", a.artifact_id);
      view.setAttribute("data-action", "details");
      view.addEventListener("click", function () { showDetail(a.artifact_id); });
      actions.appendChild(view);
      var open = document.createElement("button");
      open.type = "button";
      open.textContent = "Open";
      open.setAttribute("data-artifact-id", a.artifact_id);
      open.setAttribute("data-action", "open");
      open.setAttribute("data-visibility", a.visibility || "");
      open.addEventListener("click", function () {
        openArtifact(a.artifact_id, a.visibility || "");
      });
      actions.appendChild(open);
      /* A2: row-level delete works without opening detail, including
       * for expired artifacts whose info reads 410. */
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete";
      del.setAttribute("data-artifact-id", a.artifact_id);
      del.setAttribute("data-action", "delete");
      del.addEventListener("click", function () {
        deleteArtifact(a.artifact_id);
      });
      actions.appendChild(del);
      li.appendChild(actions);
      list.appendChild(li);
    });
    $("prev-button").disabled = pageIndex === 0;
    var knownNext = pageIndex + 1 < pageStarts.length;
    $("next-button").disabled = !nextCursor && !knownNext;
  }

  function loadPage(reset) {
    if (reset) {
      pageStarts = [null];
      pageIndex = 0;
    }
    currentCursor = pageStarts[pageIndex];
    setText("list-status", "Loading…");
    apiFetch(listQuery(currentCursor), { method: "GET" }).then(function (res) {
      if (res.status === 401) {
        showLoggedOut();
        throw new Error("unauthorized");
      }
      if (!res.ok) {
        return readJsonSafe(res).then(function (body) {
          throw new Error(errorCodeOf(res, body));
        });
      }
      return res.json();
    }).then(function (body) {
      var next = body.next_cursor || null;
      /* Drop forward history after filter changes, then record the
       * next page start (if any) exactly once. */
      pageStarts = pageStarts.slice(0, pageIndex + 1);
      if (next) {
        pageStarts.push(next);
      }
      renderList(body.artifacts || [], next);
    }).catch(function (e) {
      if (e.message !== "unauthorized") {
        setText("list-status", "List failed (" + e.message + ").");
      }
    });
  }

  /* Failures from list-origin actions go to the VISIBLE list status
   * (A2); detail-status mirrors for the detail view. */
  function failVisible(msg) {
    setText("detail-status", msg);
    setText("list-status", msg);
  }

  /* -- detail --------------------------------------------------------- */

  var currentDetailId = null;
  var currentDetailVisibility = "";
  var currentDetailContentUrl = "";

  function addDetailRow(dl, term, value) {
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function showDetail(artifactId) {
    if (!ID_RE.test(artifactId)) { return; }
    hideRotateOutput();
    setText("detail-status", "Loading…");
    apiFetch("/artifacts/" + artifactId, { method: "GET" }).then(function (res) {
      if (!res.ok) {
        return readJsonSafe(res).then(function (body) {
          throw new Error(errorCodeOf(res, body));
        });
      }
      return res.json();
    }).then(function (info) {
      currentDetailId = info.artifact_id || artifactId;
      currentDetailVisibility = info.visibility || "";
      currentDetailContentUrl = info.content_url || "";
      var dl = $("detail-list");
      dl.textContent = "";
      addDetailRow(dl, "name", info.name || "");
      addDetailRow(dl, "artifact_id", info.artifact_id || "");
      addDetailRow(dl, "kind", info.kind || "");
      addDetailRow(dl, "access", info.visibility || "");
      addDetailRow(dl, "state", info.state || "");
      addDetailRow(dl, "created_by", info.created_by_user || "");
      addDetailRow(dl, "created_at", info.created_at || "");
      addDetailRow(dl, "expires_at",
        info.expires_at === null || info.expires_at === undefined ? "never" : info.expires_at);
      addDetailRow(dl, "total_bytes", String(info.total_bytes));
      addDetailRow(dl, "file_count", String(info.file_count));
      addDetailRow(dl, "content_url", info.content_url || "");
      setText("detail-status", "");
      dashboardSection.hidden = true;
      detailSection.hidden = false;
      $("rotate-button").hidden = info.visibility !== "external";
      return apiFetch("/artifacts/" + currentDetailId + "/files", { method: "GET" });
    }).then(function (res) {
      if (!res || !res.ok) { return; }
      return res.json();
    }).then(function (filesBody) {
      if (!filesBody || !filesBody.files) { return; }
      var dl = $("detail-list");
      var paths = filesBody.files.map(function (f) {
        return f.path + (f.kind === "dir" ? "/" : "");
      });
      addDetailRow(dl, "files", paths.join(", ") || "(empty)");
    }).catch(function (e) {
      failVisible("Detail failed (" + e.message + ").");
    });
  }

  /* Internal artifacts: one-time grant handoff. The grant is single-use
   * and bound to the artifact; it is POSTed as urlencoded form data to
   * the artifact's own content host, which answers 303. The session
   * credential is never sent to the content origin. Public/external
   * artifacts open with a plain navigation to their content URL. */
  function openArtifact(artifactId, visibility) {
    if (!ID_RE.test(artifactId)) { return; }
    setText("detail-status", visibility === "internal" ? "Requesting one-time grant…" : "Opening…");
    var needInfo = currentDetailId === artifactId && currentDetailContentUrl ?
      Promise.resolve({ visibility: currentDetailVisibility, content_url: currentDetailContentUrl }) :
      apiFetch("/artifacts/" + artifactId, { method: "GET" }).then(function (res) {
        if (!res.ok) {
          return readJsonSafe(res).then(function (body) {
            throw new Error(errorCodeOf(res, body));
          });
        }
        return res.json();
      });
    needInfo.then(function (info) {
      if ((info.visibility || visibility) !== "internal") {
        window.location.assign(info.content_url);
        return;
      }
      return apiFetch("/artifacts/" + artifactId + "/grants", { method: "POST" }).then(function (res) {
        if (!res.ok) {
          return readJsonSafe(res).then(function (body) {
            throw new Error(errorCodeOf(res, body));
          });
        }
        return res.json();
      }).then(function (grantBody) {
        postGrantHandoff(info.content_url, grantBody.grant);
      });
    }).catch(function (e) {
      failVisible("Open failed (" + e.message + ").");
    });
  }

  function postGrantHandoff(contentUrl, grant) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = contentUrl.replace(/\/$/, "") + "/__manure/grant";
    form.enctype = "application/x-www-form-urlencoded";
    var field = document.createElement("input");
    field.type = "hidden";
    field.name = "grant";
    field.value = grant;
    form.appendChild(field);
    document.body.appendChild(form);
    form.submit();
  }

  function onDelete() {
    if (!currentDetailId || !ID_RE.test(currentDetailId)) { return; }
    deleteArtifact(currentDetailId).then(function (deleted) {
      if (deleted) {
        hideRotateOutput();
        currentDetailId = null;
        setText("detail-status", "");
        detailSection.hidden = true;
        dashboardSection.hidden = false;
      }
    });
  }

  /* A2: list-origin delete shared by the row button and detail view. */
  function deleteArtifact(artifactId) {
    if (!ID_RE.test(artifactId)) { return Promise.resolve(false); }
    if (!window.confirm("Delete artifact " + artifactId + "? This cannot be undone.")) {
      return Promise.resolve(false);
    }
    setText("list-status", "Deleting…");
    return apiFetch("/artifacts/" + artifactId, { method: "DELETE" }).then(function (res) {
      if (!res.ok) {
        return readJsonSafe(res).then(function (body) {
          throw new Error(errorCodeOf(res, body));
        });
      }
      return true;
    }).then(function () {
      loadPage(false);
      return true;
    }).catch(function (e) {
      failVisible("Delete failed (" + e.message + ").");
      return false;
    });
  }

  /* Rotation returns the new password exactly once. It is shown in a
   * transient reveal element: never logged, never stored, cleared on
   * dismiss or on leaving the detail view. */
  function onRotate() {
    if (!currentDetailId || !ID_RE.test(currentDetailId)) { return; }
    setText("detail-status", "Rotating password…");
    apiFetch("/artifacts/" + currentDetailId + "/external-password:rotate", {
      method: "POST"
    }).then(function (res) {
      if (!res.ok) {
        return readJsonSafe(res).then(function (body) {
          throw new Error(errorCodeOf(res, body));
        });
      }
      return res.json();
    }).then(function (body) {
      var out = $("rotate-output");
      setText("rotate-password", body.external_password || "");
      out.hidden = false;
      setText("detail-status", "Password rotated. Copy it now; it will not be shown again.");
      $("rotate-dismiss-button").focus();
    }).catch(function (e) {
      setText("detail-status", "Rotate failed (" + e.message + ").");
    });
  }

  function hideRotateOutput() {
    $("rotate-output").hidden = true;
    setText("rotate-password", "");
  }

  /* -- wiring ----------------------------------------------------------- */

  $("login-form").addEventListener("submit", onLoginSubmit);
  $("logout-button").addEventListener("click", onLogout);
  $("refresh-button").addEventListener("click", function () { loadPage(true); });
  $("filter-text").addEventListener("input", function () { loadPage(true); });
  $("filter-visibility").addEventListener("change", function () { loadPage(true); });
  $("filter-state").addEventListener("change", function () { loadPage(true); });
  $("include-expired").addEventListener("change", function () { loadPage(true); });
  $("prev-button").addEventListener("click", function () {
    if (pageIndex > 0) {
      pageIndex -= 1;
      loadPage(false);
    }
  });
  $("next-button").addEventListener("click", function () {
    if (pageIndex + 1 < pageStarts.length) {
      pageIndex += 1;
      loadPage(false);
    }
  });
  $("open-button").addEventListener("click", function () {
    if (currentDetailId) { openArtifact(currentDetailId, currentDetailVisibility); }
  });
  $("delete-button").addEventListener("click", onDelete);
  $("rotate-button").addEventListener("click", onRotate);
  $("rotate-dismiss-button").addEventListener("click", function () {
    hideRotateOutput();
    setText("detail-status", "");
  });
  $("detail-back-button").addEventListener("click", function () {
    hideRotateOutput();
    currentDetailId = null;
    setText("detail-status", "");
    detailSection.hidden = true;
    dashboardSection.hidden = false;
  });

  checkSession().then(function (ok) {
    if (ok) { loadPage(true); }
  });
})();
