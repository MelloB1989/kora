import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Each extension entry is built as its own self-contained bundle by
// scripts/build.mjs (which sets WT_TARGET), because content scripts and the
// MAIN-world page script must be single IIFE files with no runtime imports.
type Target = "background" | "content" | "page";

const target = (process.env.WT_TARGET ?? "content") as Target;

const entries: Record<Target, { entry: string; name: string; format: "es" | "iife" }> = {
  // Service worker: declared type:"module" in the manifest, so ESM is fine.
  background: { entry: "src/background/index.ts", name: "background", format: "es" },
  // Content script: classic script → must be a self-contained IIFE.
  content: { entry: "src/content/index.ts", name: "content", format: "iife" },
  // MAIN-world page script: injected into the page → self-contained IIFE.
  page: { entry: "src/adapters/pageScript.ts", name: "pageScript", format: "iife" },
};

const cfg = entries[target];

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // build.mjs clears dist once before the first target
    target: "chrome116",
    lib: {
      entry: cfg.entry,
      name: "wt",
      formats: [cfg.format],
      fileName: () => `${cfg.name}.js`,
    },
    rollupOptions: {
      output: { inlineDynamicImports: true, assetFileNames: `${cfg.name}.[ext]` },
    },
  },
});
