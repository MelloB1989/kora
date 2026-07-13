import type { ShowProgress } from "../api";
import { formatDuration, platformLabel } from "../queries";

export function ProgressList({ progress }: { progress: ShowProgress[] }) {
  if (progress.length === 0) {
    return <p className="text-sm" style={{ color: "var(--muted)" }}>No shows tracked yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {progress.map((p) => (
        <div key={`${p.platform}-${p.contentId}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-sm" style={{ color: "var(--ink-1)" }}>
              {p.title || p.contentId}
            </span>
            <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              {platformLabel(p.platform)} · {Math.round(p.percentComplete)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--grid)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, p.percentComplete)}%`, background: "var(--seq)" }}
            />
          </div>
          {p.duration > 0 && (
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {formatDuration(p.lastPosition)} / {formatDuration(p.duration)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
