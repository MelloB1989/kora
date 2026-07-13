// Hero-number stat tile (dataviz: a single magnitude is a number, not a chart).
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
    >
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold" style={{ color: "var(--ink-1)" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
