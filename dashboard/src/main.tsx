import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { Landing } from "./routes/Landing";
import { Login } from "./routes/Login";
import "./index.css";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex gap-4 border-b border-neutral-800 px-6 py-4 text-sm">
        <Link to="/" className="font-semibold">
          WatchTogether
        </Link>
        <Link to="/login" className="text-neutral-400 hover:text-neutral-100">
          Log in
        </Link>
      </nav>
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Landing });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });

const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, loginRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
