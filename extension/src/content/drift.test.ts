import { describe, expect, it } from "vitest";
import { decideSync, expectedHostTime, type SyncInput } from "./drift";

const base: SyncInput = {
  hostCurrentTime: 100,
  hostPaused: false,
  hostMediaTimestamp: 10_000,
  localCurrentTime: 100,
  localPaused: false,
  now: 10_000,
};

describe("expectedHostTime", () => {
  it("advances by elapsed time while playing", () => {
    expect(expectedHostTime({ ...base, now: 12_000 })).toBeCloseTo(102);
  });
  it("does not advance while paused", () => {
    expect(expectedHostTime({ ...base, hostPaused: true, now: 12_000 })).toBe(100);
  });
});

describe("decideSync", () => {
  it("ignores small drift", () => {
    expect(decideSync({ ...base, localCurrentTime: 101 }).kind).toBe("none");
  });

  it("soft-seeks on moderate drift with lead", () => {
    const a = decideSync({ ...base, localCurrentTime: 97 }); // 3s behind
    expect(a.kind).toBe("seek");
    if (a.kind === "seek") {
      expect(a.hard).toBe(false);
      expect(a.to).toBeCloseTo(100.25);
    }
  });

  it("hard-seeks on large drift", () => {
    const a = decideSync({ ...base, localCurrentTime: 50 });
    expect(a.kind).toBe("seek");
    if (a.kind === "seek") expect(a.hard).toBe(true);
  });

  it("pauses when host paused but local playing", () => {
    expect(decideSync({ ...base, hostPaused: true, localPaused: false }).kind).toBe("pause");
  });

  it("plays when host playing but local paused", () => {
    expect(decideSync({ ...base, localPaused: true }).kind).toBe("play");
  });

  it("projects host position when computing drift", () => {
    // host at 100 @ t=10s; now t=15s → expected 105; local at 105 → in sync
    const a = decideSync({ ...base, now: 15_000, localCurrentTime: 105 });
    expect(a.kind).toBe("none");
  });
});
