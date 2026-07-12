// Client state store (Phase 5 will hold auth + UI state). Wired now, unused.
import { create } from "zustand";

interface AppState {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  setToken: (token) => set({ token }),
}));
