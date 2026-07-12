// Pure drift-correction math, extracted for unit testing. See docs/ws-protocol.md.

export interface SyncInput {
  hostCurrentTime: number; // seconds, from the host heartbeat
  hostPaused: boolean;
  hostMediaTimestamp: number; // epoch ms when host read its position
  localCurrentTime: number; // seconds, local player now
  localPaused: boolean;
  now: number; // epoch ms
}

export type SyncAction =
  | { kind: "none" }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "seek"; to: number; hard: boolean };

export const DRIFT_IGNORE_S = 1.5;
export const DRIFT_HARD_S = 4;
export const SEEK_LEAD_S = 0.25;

// expectedHostTime projects the host's reported position to `now`, accounting
// for the time elapsed since the host read it (only advances while playing).
export function expectedHostTime(i: SyncInput): number {
  if (i.hostPaused) return i.hostCurrentTime;
  const elapsedS = Math.max(0, (i.now - i.hostMediaTimestamp) / 1000);
  return i.hostCurrentTime + elapsedS;
}

// decideSync returns the correction to apply to the local player. Play/pause
// mismatch is resolved first; otherwise position drift drives a seek.
export function decideSync(i: SyncInput): SyncAction {
  if (i.hostPaused && !i.localPaused) return { kind: "pause" };
  if (!i.hostPaused && i.localPaused) return { kind: "play" };

  const expected = expectedHostTime(i);
  const drift = Math.abs(expected - i.localCurrentTime);
  if (drift <= DRIFT_IGNORE_S) return { kind: "none" };

  const hard = drift > DRIFT_HARD_S;
  const to = i.hostPaused ? expected : expected + SEEK_LEAD_S;
  return { kind: "seek", to, hard };
}
