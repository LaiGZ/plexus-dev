import type { ToolSummary } from "@plexus/contracts";
import { useState } from "react";
import { TryItDrawer } from "@/components/TryItDrawer";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useTools } from "@/lib/queries";

export function ToolsPage() {
  const { t } = useI18n();
  const tools = useTools();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ToolSummary | null>(null);

  const exposed = (tools.data?.tools ?? []).filter((tool) => tool.exposed && tool.enabled);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? exposed.filter((tool) =>
        `${tool.sourceName} ${tool.displayName} ${tool.mcpName} ${tool.description}`
          .toLowerCase()
          .includes(needle),
      )
    : exposed;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("tools.title")}</h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("tools.subtitle")}</p>
        </div>
        <span className="text-xs text-zinc-500">{t("tools.count", { count: exposed.length })}</span>
      </header>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("tools.search")}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950/60"
      />

      {tools.isLoading ? (
        <div className="flex justify-center py-16 text-zinc-400">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t("tools.emptyTitle")} description={t("tools.emptyDescription")} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("tools.title")}</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t("tools.app")}</th>
                <th className="px-4 py-2.5 font-medium">{t("try.sideEffect")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
              {filtered.map((tool) => (
                <tr key={tool.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{tool.displayName}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{tool.mcpName}</p>
                    <p className="mt-0.5 max-w-md truncate text-xs text-zinc-500">
                      {tool.description}
                    </p>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-zinc-500 sm:table-cell">
                    {tool.sourceName}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tool.sideEffect === "write" ? "amber" : "green"}>
                      {t(tool.sideEffect === "write" ? "common.write" : "common.read")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(tool)}>
                      {t("tools.try")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TryItDrawer tool={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
