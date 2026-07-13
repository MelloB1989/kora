import { Link } from "@tanstack/react-router";
import { useAppStore } from "../store";

export function Landing() {
  const user = useAppStore((s) => s.user);
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Watch together, in sync.</h1>
      <p className="mt-4 text-lg" style={{ color: "var(--ink-2)" }}>
        Sync playback with friends on Netflix, Prime Video, Hotstar, and YouTube — everyone on their
        own account, their own player — with chat, reactions, and voice.
      </p>
      <div className="mt-10">
        <Link
          to={user ? "/dashboard" : "/login"}
          className="inline-block rounded-lg px-5 py-3 text-sm font-semibold text-white"
          style={{ background: "var(--series-1)" }}
        >
          {user ? "Go to your dashboard" : "Log in to see your stats"}
        </Link>
      </div>
    </main>
  );
}
