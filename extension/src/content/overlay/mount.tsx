// Mounts the React overlay inside a shadow root so Netflix's page styles
// can't leak in and ours can't leak out.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { OverlayActions } from "./store";
// Vite inlines this as a string (see ?inline), injected into the shadow root.
import css from "./overlay.css?inline";

export function mountOverlay(actions: OverlayActions): void {
  const host = document.createElement("div");
  host.id = "wt-overlay-root";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(
    <StrictMode>
      <App actions={actions} />
    </StrictMode>,
  );
}
