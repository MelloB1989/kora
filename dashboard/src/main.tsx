import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { Dashboard } from "./routes/Dashboard";
import { Landing } from "./routes/Landing";
import { Login } from "./routes/Login";
import { useAppStore } from "./store";
import "./index.css";

function Nav() {
  const { user, logout } = useAppStore();
  return (
    <nav
      className="flex items-center gap-4 border-b px-6 py-4 text-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <Link to="/" className="font-semibold">WatchTogether</Link>
      {user ? (
        <>
          <Link to="/dashboard" style={{ color: "var(--ink-2)" }}>Dashboard</Link>
          <button className="ml-auto" style={{ color: "var(--muted)" }} onClick={logout}>
            Log out
          </button>
        </>
      ) : (
        <Link to="/login" className="ml-auto" style={{ color: "var(--ink-2)" }}>Log in</Link>
      )}
    </nav>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <Nav />
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Landing });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  beforeLoad: () => {
    if (!useAppStore.getState().token) throw redirect({ to: "/login" });
  },
  component: Dashboard,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, loginRoute, dashboardRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
