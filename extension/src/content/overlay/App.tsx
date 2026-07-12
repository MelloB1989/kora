import { useEffect, useRef, useState } from "react";
import { SOUNDS } from "../soundbox";
import { useOverlayStore, type OverlayActions } from "./store";

const REACTIONS = ["👍", "❤️", "😂", "😮", "🔥", "🎉"];

const connColor: Record<string, string> = {
  connected: "#3ddc84",
  connecting: "#f5a623",
  disconnected: "#e5484d",
};

export function App({ actions }: { actions: OverlayActions }) {
  const s = useOverlayStore();

  return (
    <>
      <ReactionsLayer />
      {s.collapsed ? (
        <button className="wt-fab" onClick={s.toggleCollapsed} title="WatchTogether">
          <span className="wt-dot" style={{ background: connColor[s.conn] }} /> WT
        </button>
      ) : (
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
      )}
    </>
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
  const { room, tab, setTab } = useOverlayStore();
  if (!room) return <RoomLobby actions={actions} />;
  return (
    <div className="wt-room-wrap">
      <div className="wt-tabs">
        <button className={tab === "room" ? "wt-tab wt-tab-on" : "wt-tab"} onClick={() => setTab("room")}>
          Room
        </button>
        <button className={tab === "chat" ? "wt-tab wt-tab-on" : "wt-tab"} onClick={() => setTab("chat")}>
          Chat
        </button>
      </div>
      {tab === "room" ? <RoomTab actions={actions} /> : <ChatTab actions={actions} />}
      <SocialTray actions={actions} />
    </div>
  );
}

function RoomLobby({ actions }: { actions: OverlayActions }) {
  const { contentId, displayName, roomError } = useOverlayStore();
  const [joinCode, setJoinCode] = useState("");
  return (
    <div className="wt-body">
      <div className="wt-row wt-muted">
        Hi {displayName} · <button className="wt-link" onClick={actions.logout}>log out</button>
      </div>
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
      {roomError && <p className="wt-err">{roomError}</p>}
    </div>
  );
}

function RoomTab({ actions }: { actions: OverlayActions }) {
  const { room, members, joinUrl, sync, userId } = useOverlayStore();
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
      <div className="wt-room">
        <div className="wt-row">
          <code className="wt-code">{room!.roomId}</code>
          {joinUrl && (
            <button className="wt-btn wt-sm" onClick={copy}>
              {copied ? "Copied!" : "Copy link"}
            </button>
          )}
        </div>
        {room!.title && <div className="wt-muted">{room!.title}</div>}
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
    </div>
  );
}

function ChatTab({ actions }: { actions: OverlayActions }) {
  const messages = useOverlayStore((s) => s.messages);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = () => {
    actions.sendChat(text);
    setText("");
  };
  return (
    <div className="wt-chat">
      <div className="wt-messages">
        {messages.length === 0 && <div className="wt-muted wt-center">No messages yet — say hi 👋</div>}
        {messages.map((m) => (
          <div key={m.id} className={m.mine ? "wt-msg wt-msg-mine" : "wt-msg"}>
            {!m.mine && <span className="wt-msg-name">{m.senderName}</span>}
            <span className="wt-msg-text">{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="wt-row">
        <input className="wt-input" placeholder="Message…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="wt-btn wt-sm" onClick={send}>Send</button>
      </div>
    </div>
  );
}

function SocialTray({ actions }: { actions: OverlayActions }) {
  return (
    <div className="wt-tray">
      <div className="wt-tray-row">
        {REACTIONS.map((e) => (
          <button key={e} className="wt-emoji" onClick={() => actions.sendReaction(e)} title="React">
            {e}
          </button>
        ))}
      </div>
      <div className="wt-tray-row">
        {SOUNDS.map((s) => (
          <button key={s.id} className="wt-sound" onClick={() => actions.sendSoundbox(s.id)} title={s.label}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>
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

// Floating emoji bursts that rise and fade over the whole page.
function ReactionsLayer() {
  const bursts = useOverlayStore((s) => s.bursts);
  const removeBurst = useOverlayStore((s) => s.removeBurst);
  return (
    <div className="wt-bursts">
      {bursts.map((b) => (
        <BurstEmoji key={b.id} id={b.id} emoji={b.emoji} onDone={removeBurst} />
      ))}
    </div>
  );
}

function BurstEmoji({ id, emoji, onDone }: { id: string; emoji: string; onDone: (id: string) => void }) {
  const left = useRef(10 + Math.random() * 80).current;
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 2200);
    return () => clearTimeout(t);
  }, [id, onDone]);
  return (
    <span className="wt-burst" style={{ left: `${left}%` }}>
      {emoji}
    </span>
  );
}
