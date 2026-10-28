import { Link, useNavigate } from "@tanstack/react-router";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useSources } from "@/lib/queries";

export function SourcesPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const sources = useSources();

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US");

  const open = (id: string) =>
    void navigate({ to: "/apps/$sourceId", params: { sourceId: id } });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("sources.title")}</h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("sources.subtitle")}</p>
        </div>
        <Link to="/apps/new">
          <Button>{t("sources.add")}</Button>
        </Link>
      </header>

      {sources.isLoading ? (
        <div className="flex justify-center py-16 text-zinc-400">
          <Spinner />
        </div>
      ) : sources.data && sources.data.sources.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("sources.colName")}</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                  {t("sources.colKind")}
                </th>
                <th className="px-4 py-2.5 font-medium">{t("sources.colTools")}</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                  {t("sources.colLastCall")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">{t("sources.colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
              {sources.data.sources.map((source) => (
                <tr
                  key={source.id}
                  onClick={() => open(source.id)}
                  className="cursor-pointer bg-white hover:bg-zinc-50 dark:bg-transparent dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/apps/$sourceId"
                      params={{ sourceId: source.id }}
                      onClick={(event) => event.stopPropagation()}
                      className="font-medium hover:text-emerald-600 dark:hover:text-emerald-400"
                    >
                      {source.name}
                    </Link>
                    <p className="mt-0.5 max-w-xs truncate text-xs text-zinc-500">
                      {source.baseUrl}
                    </p>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge tone="neutral">{source.kind}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="tabular-nums">{source.toolCount}</span>
                    <span className="ml-1 text-xs text-zinc-500">
                      ({t("sources.exposedCount", { count: source.exposedCount })})
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-zinc-500 md:table-cell">
                    {source.lastInvokedAt ? when(source.lastInvokedAt) : t("common.never")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {source.enabled ? (
                      <Badge tone="green">{t("common.enabled")}</Badge>
                    ) : (
                      <Badge tone="red">{t("common.disabled")}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={t("sources.emptyTitle")}
          description={t("sources.emptyDescription")}
          action={
            <Link to="/apps/new">
              <Button>{t("sources.emptyAction")}</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
