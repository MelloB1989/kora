import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: api.stats });
export const useSessions = () => useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
export const useProgress = () => useQuery({ queryKey: ["progress"], queryFn: api.progress });

// Fixed platform → categorical-slot mapping (dataviz: assign hues in fixed
// order, color follows the entity, never repainted). Values are the validated
// reference palette's slots 1–4 (light/dark handled by CSS var swap).
export const PLATFORM_META: Record<string, { label: string; slot: number }> = {
  netflix: { label: "Netflix", slot: 1 },
  prime: { label: "Prime Video", slot: 2 },
  hotstar: { label: "Hotstar", slot: 3 },
  youtube: { label: "YouTube", slot: 4 },
};

export function platformLabel(id: string): string {
  return PLATFORM_META[id]?.label ?? id;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}
