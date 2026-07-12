// Thin facade over the chrome.* APIs the extension uses. This is the single
// seam for a future Firefox port (swap chrome for the webextension-polyfill
// `browser` object here — nothing else references chrome directly).

export const runtime = chrome.runtime;
export const storage = chrome.storage;
export const alarms = chrome.alarms;
export const scripting = chrome.scripting;

export function extensionUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

// Session storage: cleared when the browser closes, ideal for the room the
// service worker should rejoin after an idle-kill restart.
export const session = chrome.storage.session;

// Local storage: persists the auth token across browser restarts.
export const local = chrome.storage.local;
