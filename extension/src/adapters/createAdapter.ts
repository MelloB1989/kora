import { detectPlatform } from "../shared/platforms";
import { BridgeAdapter } from "./BridgeAdapter";
import type { PlatformAdapter } from "./PlatformAdapter";

// Returns an adapter for the current page, or null if this isn't a supported
// streaming site (the content script then stays dormant).
export function createAdapter(url: string = location.href): PlatformAdapter | null {
  const spec = detectPlatform(url);
  return spec ? new BridgeAdapter(spec) : null;
}
