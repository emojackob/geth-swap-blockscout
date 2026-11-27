import { QueryClient } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { Shell } from "./components/Shell";
import { api } from "./lib/api";
import { Contracts } from "./pages/Contracts";
import { Faucet } from "./pages/Faucet";
import { Logs } from "./pages/Logs";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { Swap } from "./pages/Swap";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SignIn,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

async function requireSession() {
  const me = await api.me();
  if (!me) throw redirect({ to: "/" });
}

const overviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/overview",
  beforeLoad: requireSession,
  component: Overview,
});

const faucetRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/faucet",
  component: Faucet,
});

const swapRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/swap",
  beforeLoad: requireSession,
  component: Swap,
});

const contractsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/contracts",
  beforeLoad: requireSession,
  component: Contracts,
});

const logsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/logs",
  beforeLoad: requireSession,
  component: Logs,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  beforeLoad: requireSession,
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  shellRoute.addChildren([overviewRoute, faucetRoute, swapRoute, contractsRoute, logsRoute, settingsRoute]),
]);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
