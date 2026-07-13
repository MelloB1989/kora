// Watch time by platform — magnitude-by-identity. Categorical color assigned in
// fixed order (platform → slot), color follows the entity. Direct value labels
// on every bar satisfy the relief rule (some slots are sub-3:1 on the surface),
// so identity/magnitude never rely on color alone.

import type { Stats } from "../api";
import { formatDuration, PLATFORM_META, platformLabel } from "../queries";

export function PlatformBreakdown({ stats }: { stats: Stats }) {
  const rows = Object.entries(stats.perPlatform)
    .map(([platform, seconds]) => ({ platform, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
  const max = Math.max(1, ...rows.map((r) => r.seconds));

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
        By platform
      </figcaption>
      {rows.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No watch time recorded yet.
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const slot = PLATFORM_META[r.platform]?.slot ?? 1;
          return (
            <div key={r.platform} className="flex items-center gap-3">
              <div className="w-20 shrink-0 text-xs" style={{ color: "var(--ink-2)" }}>
                {platformLabel(r.platform)}
              </div>
              <div className="flex flex-1 items-center gap-2">
                <div
                  style={{
                    width: `${Math.max(4, (r.seconds / max) * 100)}%`,
                    height: 16,
                    background: `var(--series-${slot})`,
                    borderRadius: 4,
                  }}
                />
                <span className="text-xs tabular-nums" style={{ color: "var(--ink-2)" }}>
                  {formatDuration(r.seconds)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
