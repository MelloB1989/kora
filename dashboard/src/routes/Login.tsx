import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api";
import { useAppStore } from "../store";

export function Login() {
  const navigate = useNavigate();
  const setAuth = useAppStore((s) => s.setAuth);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login" ? await api.login(email, password) : await api.signup(email, password, displayName);
      setAuth(res.token, res.user);
      void navigate({ to: "/dashboard" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = { background: "var(--surface-1)", borderColor: "var(--border)", color: "var(--ink-1)" };

  return (
    <main className="mx-auto max-w-sm px-6 py-20">
      <h2 className="text-2xl font-semibold">{mode === "login" ? "Log in" : "Create account"}</h2>
      <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
        {mode === "signup" && (
          <input className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} placeholder="Display name"
            value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        )}
        <input className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <p className="text-sm" style={{ color: "#d03b3b" }}>{error}</p>}
        <button type="submit" disabled={busy}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--series-1)" }}>
          {busy ? "…" : mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <button className="mt-4 text-sm" style={{ color: "var(--series-1)" }}
        onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}>
        {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
      </button>
    </main>
  );
}
