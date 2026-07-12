import { useState } from "react";
import { useOverlayStore, type OverlayActions } from "./store";

const connColor: Record<string, string> = {
  connected: "#3ddc84",
  connecting: "#f5a623",
  disconnected: "#e5484d",
};

export function App({ actions }: { actions: OverlayActions }) {
  const s = useOverlayStore();

  if (s.collapsed) {
    return (
      <button className="wt-fab" onClick={s.toggleCollapsed} title="WatchTogether">
        <span className="wt-dot" style={{ background: connColor[s.conn] }} /> WT
      </button>
    );
  }

  return (
    <div className="wt-panel">
      <header className="wt-head">
        <span className="wt-dot" style={{ background: connColor[s.conn] }} />
        <strong>WatchTogether</strong>
        <button className="wt-x" onClick={s.toggleCollapsed} aria-label="Collapse">
          –
        </button>
      </header>
      {!s.authed ? <AuthForm actions={actions} /> : <RoomPanel actions={actions} />}
    </div>
  );
}

function AuthForm({ actions }: { actions: OverlayActions }) {
  const authError = useOverlayStore((s) => s.authError);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const submit = () => {
    if (mode === "login") actions.login(email, password);
    else actions.signup(email, password, displayName);
  };

  return (
    <div className="wt-body">
      {mode === "signup" && (
        <input className="wt-input" placeholder="Display name" value={displayName}
          onChange={(e) => setDisplayName(e.target.value)} />
      )}
      <input className="wt-input" placeholder="Email" type="email" value={email}
        onChange={(e) => setEmail(e.target.value)} />
      <input className="wt-input" placeholder="Password" type="password" value={password}
        onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      {authError && <p className="wt-err">{authError}</p>}
      <button className="wt-btn wt-primary" onClick={submit}>
        {mode === "login" ? "Log in" : "Sign up"}
      </button>
      <button className="wt-link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
      </button>
    </div>
  );
}

function RoomPanel({ actions }: { actions: OverlayActions }) {
  const { room, members, joinUrl, roomError, sync, contentId, displayName, userId } =
    useOverlayStore();
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!joinUrl) return;
    void navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="wt-body">
      <div className="wt-row wt-muted">
        Hi {displayName} · <button className="wt-link" onClick={actions.logout}>log out</button>
      </div>

      {!room ? (
        <>
          <button className="wt-btn wt-primary" disabled={!contentId} onClick={actions.createRoom}>
            {contentId ? "Create room here" : "Open a title to host"}
          </button>
          <div className="wt-row">
            <input className="wt-input" placeholder="Room code (r_…)" value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.trim())} />
            <button className="wt-btn" disabled={!joinCode} onClick={() => actions.joinRoom(joinCode)}>
              Join
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="wt-room">
            <div className="wt-row">
              <code className="wt-code">{room.roomId}</code>
              {joinUrl && (
                <button className="wt-btn wt-sm" onClick={copy}>
                  {copied ? "Copied!" : "Copy link"}
                </button>
              )}
            </div>
            {room.title && <div className="wt-muted">{room.title}</div>}
          </div>

          <SyncBadge state={sync.state} detail={sync.detail} />

          <ul className="wt-members">
            {members.map((m) => (
              <li key={m.userId}>
                {m.displayName}
                {m.isHost && <span className="wt-host">host</span>}
                {m.userId === userId && <span className="wt-you">you</span>}
              </li>
            ))}
          </ul>

          <button className="wt-btn" onClick={actions.leaveRoom}>Leave room</button>
        </>
      )}
      {roomError && <p className="wt-err">{roomError}</p>}
    </div>
  );
}

function SyncBadge({ state, detail }: { state: string; detail?: string }) {
  const label: Record<string, string> = {
    idle: "Not syncing",
    "in-sync": "In sync",
    drifted: detail === "resyncing" ? "Resyncing…" : "Correcting drift",
    unavailable: "Sync unavailable",
  };
  return <div className={`wt-sync wt-sync-${state}`}>{label[state] ?? state}</div>;
}
