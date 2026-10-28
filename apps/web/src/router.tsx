import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { LoginPage } from "@/pages/Login";
import { LogsPage } from "@/pages/Logs";
import { OverviewPage } from "@/pages/Overview";
import { SettingsPage } from "@/pages/Settings";
import { SourceDetailPage } from "@/pages/SourceDetail";
import { SourceNewPage } from "@/pages/SourceNew";
import { SourcesPage } from "@/pages/Sources";
import { ToolsPage } from "@/pages/Tools";

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: Shell,
  beforeLoad: async () => {
    try {
      await api("/api/auth/me");
    } catch {
      throw redirect({ to: "/login" });
    }
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: OverviewPage,
});

const sourcesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/apps",
  component: SourcesPage,
});

const sourceNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/apps/new",
  component: SourceNewPage,
});

const sourceDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/apps/$sourceId",
  component: SourceDetailPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

const toolsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tools",
  component: ToolsPage,
});

const logsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/logs",
  component: LogsPage,
});

const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chat",
  component: lazyRouteComponent(() => import("@/pages/Chat"), "ChatPage"),
});

const chatPromptRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chat/prompt",
  component: lazyRouteComponent(() => import("@/pages/ChatPrompt"), "ChatPromptPage"),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    overviewRoute,
    sourcesRoute,
    sourceNewRoute,
    sourceDetailRoute,
    chatRoute,
    chatPromptRoute,
    toolsRoute,
    logsRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultErrorComponent: ({ error }) => (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-xl border border-rose-300/60 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <p className="font-semibold">Something went wrong</p>
        <pre className="mt-2 whitespace-pre-wrap text-xs">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </div>
    </main>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
