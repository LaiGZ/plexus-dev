import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClientConfig } from "@/components/ClientConfig";
import { InvocationTable } from "@/components/InvocationTable";
import { Banner, Card, Spinner } from "@/components/ui";
import { api, type MetaResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useInvocations, useStats, useTokens } from "@/lib/queries";
import { useMe } from "@/lib/session";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export function OverviewPage() {
  const { t } = useI18n();
  const user = useMe();
  const stats = useStats();
  const tokens = useTokens();
  const invocations = useInvocations({ limit: 8 });
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api<MetaResponse>("/api/meta"),
  });

  const endpoint =
    meta.data?.mcpEndpoint ??
    (typeof window === "undefined" ? "http://127.0.0.1:3000/mcp" : `${window.location.origin}/mcp`);
  const activeTokens = tokens.data?.tokens.length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user ? t("overview.greeting", { name: user.username }) : "plexus"}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("overview.subtitle")}</p>
      </header>

      {user?.mustChangePassword ? (
        <Banner tone="warn">
          {t("overview.bannerPassword")}{" "}
          <Link to="/settings" className="font-medium underline">
            {t("overview.changeIt")}
          </Link>{" "}
          {t("overview.beforeExpose")}
        </Banner>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("overview.callsToday")} value={stats.data?.invocationsToday ?? "—"} />
        <Stat label={t("overview.errorsToday")} value={stats.data?.errorsToday ?? "—"} />
        <Stat label={t("overview.exposedTools")} value={stats.data?.exposedTools ?? "—"} />
        <Stat label={t("overview.tokens")} value={activeTokens} />
      </div>

      {activeTokens === 0 ? (
        <Banner tone="warn">
          {t("overview.noToken")}{" "}
          <Link to="/settings" className="font-medium underline">
            {t("overview.createOne")}
          </Link>{" "}
          {t("overview.toConnect")}
        </Banner>
      ) : null}

      <ClientConfig endpoint={endpoint} />

      <Card
        title={t("overview.recentTitle")}
        description={t("overview.recentDescription")}
        actions={
          <Link
            to="/apps"
            className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            {t("overview.sourcesLink")}
          </Link>
        }
      >
        {invocations.isLoading ? (
          <div className="flex justify-center py-8 text-zinc-400">
            <Spinner />
          </div>
        ) : (
          <InvocationTable invocations={invocations.data?.invocations ?? []} />
        )}
      </Card>
    </div>
  );
}
