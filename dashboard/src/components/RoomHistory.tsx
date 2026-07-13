import type { WatchSession } from "../api";
import { formatDuration, platformLabel } from "../queries";

export function RoomHistory({ sessions }: { sessions: WatchSession[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm" style={{ color: "var(--muted)" }}>No rooms yet — start a watch party from the extension.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--muted)" }} className="text-left text-xs uppercase tracking-wide">
            <th className="py-1.5 pr-3 font-medium">Title</th>
            <th className="py-1.5 pr-3 font-medium">Platform</th>
            <th className="py-1.5 pr-3 font-medium">Watched</th>
            <th className="py-1.5 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId} style={{ borderTop: "1px solid var(--grid)" }}>
              <td className="max-w-[240px] truncate py-2 pr-3" style={{ color: "var(--ink-1)" }}>
                {s.title || s.contentId}
              </td>
              <td className="py-2 pr-3" style={{ color: "var(--ink-2)" }}>{platformLabel(s.platform)}</td>
              <td className="py-2 pr-3 tabular-nums" style={{ color: "var(--ink-2)" }}>
                {formatDuration(s.secondsWatched)}
              </td>
              <td className="py-2 tabular-nums" style={{ color: "var(--muted)" }}>
                {new Date(s.endedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
