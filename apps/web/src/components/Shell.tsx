import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { Button, Mark, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { LanguageToggle } from "@/lib/i18n-ui";
import { useMe } from "@/lib/session";

const NAV: Array<{ to: string; key: MessageKey }> = [
  { to: "/", key: "nav.overview" },
  { to: "/apps", key: "nav.sources" },
  { to: "/tools", key: "nav.tools" },
  { to: "/logs", key: "nav.logs" },
  { to: "/chat", key: "nav.assistant" },
  { to: "/settings", key: "nav.settings" },
];

export function Shell() {
  const router = useRouter();
  const user = useMe();
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      await router.navigate({ to: "/login" });
    }
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-zinc-50/80 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/70">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
          <Link to="/" className="flex items-center gap-2">
            <Mark className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-semibold tracking-tight">plexus</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cx(
                    "rounded-md px-2.5 py-1.5 text-sm transition",
                    active
                      ? "bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-50"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:inline dark:text-zinc-400">
              {user?.username ?? "…"}
            </span>
            <Button variant="outline" onClick={logout}>
              {t("app.signOut")}
            </Button>
            <LanguageToggle className="-mr-1" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
