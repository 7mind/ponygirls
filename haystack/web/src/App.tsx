import { useCallback, useEffect, useState } from "react";
import { api, AuthError, NetworkError, type Principal } from "./api";
import { Login } from "./Login";
import { Browse, type BrowseState } from "./Browse";
import { Detail } from "./Detail";

type Route = { name: "browse"; state: BrowseState } | { name: "item"; key: string } | { name: "inbox" };

function routeFromHash(): Route {
  const hash = location.hash;
  if (hash.startsWith("#/item/")) return { name: "item", key: decodeURIComponent(hash.slice("#/item/".length)) };
  if (hash.startsWith("#/inbox")) return { name: "inbox" };
  const query = hash.startsWith("#/browse?") ? new URLSearchParams(hash.slice("#/browse?".length)) : new URLSearchParams();
  const archive = query.get("archive");
  return {
    name: "browse",
    state: {
      query: query.get("q") ?? "",
      project: query.get("project") ?? "",
      archive: archive === "show" || archive === "only" ? archive : "hide",
    },
  };
}

export function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [boot, setBoot] = useState<"loading" | "login" | "ready" | "unreachable">("loading");
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const who = await api.whoami();
      // In-memory identity only; clear stale UI state on identity change.
      setPrincipal((prev) => {
        if (prev !== null && (prev.userId !== who.userId || prev.tokenId !== who.tokenId)) setNotice("Signed-in identity changed — views reloaded.");
        return who;
      });
      setBoot("ready");
    } catch (err) {
      if (err instanceof AuthError) {
        setPrincipal(null);
        setBoot("login");
      } else {
        setBoot("unreachable");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      // Cookie may already be dead; continue to the login screen anyway.
    }
    setPrincipal(null);
    setBoot("login");
  }

  // Stable identity: Detail's data effect depends on this. An inline closure
  // would remount item data (and wipe save outcomes) on every App render.
  const handleAuthLost = useCallback(() => {
    setPrincipal(null);
    setBoot("login");
  }, []);

  if (boot === "loading") return <p role="status">Loading…</p>;
  if (boot === "unreachable") {
    return (
      <main>
        <h1>haystack</h1>
        <p role="alert">Server unreachable — the service may be down. This is a connection failure, not an authentication failure.</p>
        <button type="button" onClick={() => void refresh()}>Retry</button>
      </main>
    );
  }
  if (boot === "login" || principal === null) {
    return <Login onLogin={() => void refresh()} />;
  }

  const goBrowse = () => {
    location.hash = "#/browse";
  };

  return (
    <div>
      <header>
        <h1>haystack</h1>
        <p>
          Signed in as {principal.userId} ({principal.type}) ·{" "}
          <button type="button" onClick={goBrowse}>Browse</button>{" "}
          <button type="button" onClick={() => { location.hash = "#/inbox"; }}>Attention inbox</button>{" "}
          <button type="button" onClick={() => void logout()}>Sign out</button>
        </p>
        {notice !== "" && <p role="status">{notice}</p>}
      </header>
      {route.name === "browse" && (
        <Browse
          key={`${route.state.query}|${route.state.project}|${route.state.archive}`}
          initial={route.state}
          onOpen={(key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }}
          onAuthLost={handleAuthLost}
        />
      )}
      {route.name === "item" && (
        <Detail itemKey={route.key} onBack={goBrowse} onAuthLost={handleAuthLost} />
      )}
      {route.name === "inbox" && (
        <Browse
          key="inbox"
          initial={{ query: "human-attention:required", project: "", archive: "hide" }}
          onOpen={(key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }}
          onAuthLost={handleAuthLost}
        />
      )}
    </div>
  );
}
