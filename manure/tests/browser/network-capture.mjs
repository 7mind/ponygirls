// Test-only CDP network evidence capture.
export function captureNetwork(cdp, ctx) {
  const redact = (headers) => {
    const safe = {};
    for (const [k, v] of Object.entries(headers || {})) {
      const lk = k.toLowerCase();
      if (lk === "cookie") {
        safe[k] = String(v).split(/;\s*/).filter(Boolean)
          .map((pair) => pair.split("=", 1)[0]).sort().join(";");
      } else if (lk === "set-cookie") {
        const names = [];
        const re = /(?:^|,)\s*([^=;,\s]+)=/g;
        let m;
        while ((m = re.exec(String(v))) !== null) names.push(m[1]);
        safe[k] = names.join(";");
      } else {
        safe[k] = v;
      }
    }
    return safe;
  };
  const cookieNamesOf = (headers) => {
    const out = [];
    for (const [k, v] of Object.entries(headers || {})) {
      if (k.toLowerCase() === "cookie") {
        for (const pair of String(v).split(/;\s*/).filter(Boolean)) {
          out.push(pair.split("=", 1)[0]);
        }
      }
    }
    return out.sort();
  };
  // IDs are scoped to this CDP session. Redirects reuse an ID, so retain
  // ordered hops and ExtraInfo queues instead of overwriting a single entry.
  const ids = new Map();
  const lowKey = (headers, name) => Object.entries(headers || {})
    .find(([key]) => key.toLowerCase() === name)?.[1];
  const state = id => {
    if (!ids.has(id)) ids.set(id, {hops: [], requestExtras: [], responseExtras: []});
    return ids.get(id);
  };
  const setCookieNames = headers => {
    const names = [];
    for (const [key, value] of Object.entries(headers || {})) {
      if (key.toLowerCase() !== "set-cookie") continue;
      for (const match of String(value).matchAll(/(?:^|,)\s*([^=;,\s]+)=/g)) names.push(match[1]);
    }
    return names;
  };
  const reconcile = s => {
    let rq = 0, rs = 0;
    for (const hop of s.hops) {
      const req = hop.request;
      const entry = hop.entry;
      entry.origin = lowKey(req.headers, "origin") || null;
      entry.cookieNames = cookieNamesOf(req.headers);
      entry.headers = redact(req.headers);
      delete entry.blockedCookieNames;
      // CDP flags identify redirect/cache hops without ExtraInfo. Queues
      // preserve protocol order even when extras precede the main events.
      const re = hop.hasExtraInfo === false ? undefined : s.requestExtras[rq++];
      if (re) {
        const cookies = re.associatedCookies || [];
        // Only empty blockedReasons means dispatched, not merely associated.
        // Otherwise a withheld-cookie 401 could masquerade as an
        // authenticated 403 proof. Cookie values are never recorded.
        if (cookies.length) {
          entry.cookieNames = cookies.filter(c => !c.blockedReasons?.length)
            .map(c => c.cookie?.name || "?").sort();
          entry.blockedCookieNames = cookies.filter(c => c.blockedReasons?.length)
            .map(c => c.cookie?.name || "?").sort();
        }
        const origin = lowKey(re.headers, "origin");
        if (origin !== undefined) entry.origin = origin;
        entry.headers = redact(Object.assign({}, entry.headers, re.headers));
      }
      const extra = hop.hasExtraInfo === false ? undefined : s.responseExtras[rs++];
      const main = hop.response;
      if (!main && !extra?.statusCode) {
        if (hop.responseEntry) {
          ctx.responses.splice(ctx.responses.indexOf(hop.responseEntry), 1);
          hop.responseEntry = undefined;
        }
        continue;
      }
      if (!hop.responseEntry) {
        hop.responseEntry = {};
        ctx.responses.push(hop.responseEntry);
      }
      Object.assign(hop.responseEntry, {
        url: main?.url || req.url || "",
        status: main?.status || extra?.statusCode || 0,
        setCookieNames: setCookieNames(main?.headers),
      });
      if (!hop.responseEntry.setCookieNames.length && extra) {
        hop.responseEntry.setCookieNames = setCookieNames(extra.headers);
      }
      if (extra && !main) hop.responseEntry.viaExtraInfo = true;
      else delete hop.responseEntry.viaExtraInfo;
    }
  };
  const on = (name, handler) => cdp.on(`Network.${name}`, ev => {
    try { handler(ev); } catch (e) { /* diagnostics only */ }
  });
  on("requestWillBeSent", ev => {
    const s = state(ev.requestId);
    if (ev.redirectResponse && s.hops.length) {
      const previous = s.hops.at(-1);
      previous.response = ev.redirectResponse;
      previous.hasExtraInfo = ev.redirectHasExtraInfo;
    }
    const request = ev.request || {};
    const entry = {url: request.url || "", method: request.method || ""};
    s.hops.push({request, entry});
    ctx.requests.push(entry);
    reconcile(s);
  });
  on("requestWillBeSentExtraInfo", ev => {
    const s = state(ev.requestId);
    s.requestExtras.push(ev);
    reconcile(s);
  });
  on("responseReceived", ev => {
    const s = state(ev.requestId), hop = s.hops.at(-1);
    if (!hop) return;
    hop.response = ev.response || {};
    if (ev.hasExtraInfo !== undefined) hop.hasExtraInfo = ev.hasExtraInfo;
    reconcile(s);
  });
  // CORS rejection can omit responseReceived entirely. ExtraInfo still
  // proves server status; join its URL when requestWillBeSent arrives later.
  on("responseReceivedExtraInfo", ev => {
    const s = state(ev.requestId);
    s.responseExtras.push(ev);
    reconcile(s);
  });
  on("loadingFailed", ev => {
    const hop = state(ev.requestId).hops.at(-1);
    if (!hop) return;
    // ERR_FAILED after a CORS-rejected 403 does not erase server evidence.
    hop.entry.loadFailed = {errorText: ev.errorText || "", blockedReason: ev.blockedReason || ""};
  });
}
