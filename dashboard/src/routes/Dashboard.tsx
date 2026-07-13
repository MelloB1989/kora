import { PlatformBreakdown } from "../components/PlatformBreakdown";
import { ProgressList } from "../components/ProgressList";
import { RoomHistory } from "../components/RoomHistory";
import { StatTile } from "../components/StatTile";
import { WeeklyChart } from "../components/WeeklyChart";
import { formatDuration, useProgress, useSessions, useStats } from "../queries";
import { useAppStore } from "../store";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-5" style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}>
      {children}
    </section>
  );
}

export function Dashboard() {
  const user = useAppStore((s) => s.user);
  const stats = useStats();
  const sessions = useSessions();
  const progress = useProgress();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">Welcome back, {user?.displayName}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Your watch-party activity across every platform.
      </p>

      {stats.isLoading ? (
        <p className="mt-8" style={{ color: "var(--muted)" }}>Loading…</p>
      ) : stats.isError ? (
        <p className="mt-8" style={{ color: "var(--muted)" }}>Couldn’t load stats: {(stats.error as Error).message}</p>
      ) : (
        stats.data && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Total watch time" value={formatDuration(stats.data.totalSeconds)} />
              <StatTile label="Watch parties" value={String(stats.data.sessionCount)} />
              <StatTile label="Titles" value={String(stats.data.distinctTitles)} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <WeeklyChart stats={stats.data} />
              </Card>
              <Card>
                <PlatformBreakdown stats={stats.data} />
              </Card>
            </div>
          </>
        )
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Show progress</h2>
          {progress.isLoading ? (
            <p style={{ color: "var(--muted)" }}>Loading…</p>
          ) : (
            <ProgressList progress={progress.data?.progress ?? []} />
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Room history</h2>
          {sessions.isLoading ? (
            <p style={{ color: "var(--muted)" }}>Loading…</p>
          ) : (
            <RoomHistory sessions={sessions.data?.sessions ?? []} />
          )}
        </Card>
      </div>
    </main>
  );
}
