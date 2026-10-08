import { useCallback, useEffect, useState } from "react";
import { api, AuthError, NetworkError, type Principal } from "./api";
import { Login } from "./Login";
import { Browse, type BrowseState } from "./Browse";
import { Detail } from "./Detail";
import { LiveProvider } from "./Live";
import { Icon, type IconName } from "./Icon";

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
    } catch (error) {
      if (!(error instanceof AuthError)) {
        setNotice(error instanceof NetworkError ? "Server unreachable — Sign out did not complete. Your session is unchanged." : "Sign out did not complete.");
        return;
      }
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

  if (boot === "loading") return <main className="auth-screen"><p role="status">Loading…</p></main>;
  if (boot === "unreachable") {
    return (
      <main className="auth-screen">
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

  const nav: Array<{ label: string; icon: IconName; hash: string }> = [
    { label: "Browse", icon: "grid", hash: "#/browse" },
    { label: "Attention inbox", icon: "inbox", hash: "#/inbox" },
    { label: "Upstream activity", icon: "branch", hash: "#/browse?q=type%3Agithub-issue%20OR%20type%3Agithub-pr" },
    { label: "Skill candidates", icon: "spark", hash: "#/browse?q=type%3Askill-draft" },
    { label: "Archive", icon: "archive", hash: "#/browse?archive=only" },
  ];

  return (
    <LiveProvider key={`${principal.userId}:${principal.tokenId}`} onAuthLost={handleAuthLost}>
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/browse"><span className="brand-mark"><Icon name="stack" /></span><span>haystack</span></a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Workspace">{nav.map((entry) => {
          const active = route.name === "inbox" ? entry.hash === "#/inbox" : route.name === "browse" &&
            (route.state.archive === "only" ? entry.label === "Archive" : route.state.query === "type:skill-draft" ? entry.label === "Skill candidates" :
              route.state.query === "type:github-issue OR type:github-pr" ? entry.label === "Upstream activity" : entry.label === "Browse");
          return <button key={entry.label} type="button" className={`nav-entry ${active ? "selected" : ""}`} aria-current={active ? "page" : undefined}
            onClick={() => { location.hash = entry.hash; }}><Icon name={entry.icon} />{entry.label}</button>;
        })}</nav>
        <div className="activity-namespace"><small>Activity namespace</small><strong>{principal.activityProjectId}</strong></div>
        <div className="identity"><span className="avatar">{principal.userId.slice(0, 1).toUpperCase()}</span><div><strong>{principal.userId}</strong><small>{principal.type} account</small></div>
          <button type="button" className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><Icon name="logout" /></button></div>
      </aside>
      <main className="workspace-main">
      <header className="topbar"><span>Workspace <span className="breadcrumb-separator">/</span> {route.name === "item" ? "Record" : route.name === "inbox" ? "Attention inbox" : "Records"}</span></header>
      <div className="workspace-content">
      {notice !== "" && <p role="status" className="notice">{notice}</p>}
      {route.name === "browse" && (
        <Browse
          key="browse"
          initial={route.state}
          inbox={false}
          onOpen={(key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }}
          onAuthLost={handleAuthLost}
        />
      )}
      {route.name === "item" && (
        <Detail key={route.key} itemKey={route.key} onBack={goBrowse} onAuthLost={handleAuthLost} />
      )}
      {route.name === "inbox" && (
        <Browse
          key="inbox"
          initial={{ query: "human-attention:required", project: "", archive: "hide" }}
          inbox={true}
          onOpen={(key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }}
          onAuthLost={handleAuthLost}
        />
      )}
      </div>
      </main>
    </div>
    </LiveProvider>
  );
}
