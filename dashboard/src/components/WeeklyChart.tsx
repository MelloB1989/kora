// Watch time over the last 8 weeks — a single-series magnitude-over-time bar
// chart. One series ⇒ single sequential hue, no legend (the title names it),
// 4px rounded data-ends anchored to the baseline, recessive baseline.

import type { Stats } from "../api";
import { formatDuration } from "../queries";

const PLOT_H = 130; // px

export function WeeklyChart({ stats }: { stats: Stats }) {
  const data = stats.perWeek;
  const max = Math.max(1, ...data.map((d) => d.seconds));

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
        Watch time · last 8 weeks
      </figcaption>
      <div className="flex items-end gap-2" style={{ height: PLOT_H, borderBottom: "1px solid var(--baseline)" }}>
        {data.map((d) => {
          const h = d.seconds > 0 ? Math.max(3, (d.seconds / max) * PLOT_H) : 0;
          return (
            <div
              key={d.weekStart}
              className="flex-1"
              style={{ height: h, background: "var(--seq)", borderRadius: "4px 4px 0 0" }}
              title={`${label(d.weekStart)}: ${formatDuration(d.seconds)}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {data.map((d) => (
          <div key={d.weekStart} className="flex-1 text-center text-[10px]" style={{ color: "var(--muted)" }}>
            {label(d.weekStart)}
          </div>
        ))}
      </div>
    </figure>
  );
}

function label(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
