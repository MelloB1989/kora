// Builds each extension entry as its own bundle, then copies static assets
// into dist/. Run via `npm run build` (after tsc) or directly with node.
import { build } from "vite";
import { rmSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const configFile = join(root, "vite.config.ts");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const target of ["background", "content", "page"]) {
  console.log(`\n▶ building ${target}`);
  process.env.WT_TARGET = target;
  await build({ configFile, root, logLevel: "warn" });
}

// Copy static assets (manifest + icons) from public/ into dist/.
const publicDir = join(root, "public");
if (existsSync(publicDir)) {
  for (const name of readdirSync(publicDir)) {
    copyFileSync(join(publicDir, name), join(dist, name));
  }
}

console.log("\n✓ extension built to dist/");
