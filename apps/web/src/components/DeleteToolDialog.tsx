import type { ToolSummary } from "@plexus/contracts";
import { useState } from "react";
import { Banner, Button, Spinner } from "./ui";
import { useI18n } from "@/lib/i18n";
import { useDeleteTool, useToolUsage } from "@/lib/queries";

export function DeleteToolDialog({
  appId,
  tool,
  onClose,
}: {
  appId: string;
  tool: ToolSummary | null;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const usage = useToolUsage(tool?.id ?? null);
  const remove = useDeleteTool(appId);
  const [ack, setAck] = useState(false);

  if (!tool) return null;

  const granted = usage.data?.grantedApps ?? [];
  const needsAck = granted.length > 0 || Boolean(usage.data?.exposed);
  const when = usage.data?.lastInvokedAt
    ? new Date(usage.data.lastInvokedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")
    : null;

  async function confirm() {
    await remove.mutateAsync(tool!.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{t("toolDelete.title")}</h2>
        </header>

        <div className="space-y-4 p-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("toolDelete.description")}
          </p>
          <p className="font-mono text-xs text-zinc-500">
            {tool.displayName} · {tool.mcpName}
          </p>

          {usage.isLoading ? (
            <div className="flex justify-center py-4 text-zinc-400">
              <Spinner />
            </div>
          ) : (
            <div className="space-y-3">
              {granted.length > 0 ? (
                <Banner tone="warn">
                  {t("toolDelete.granted", {
                    count: granted.length,
                    apps: granted.map((app) => app.name).join(", "),
                  })}
                </Banner>
              ) : null}

              {usage.data?.exposed ? (
                <Banner tone="warn">{t("toolDelete.exposed")}</Banner>
              ) : null}

              {usage.data && usage.data.invocationCount > 0 ? (
                <p className="text-xs text-zinc-500">
                  {t("toolDelete.calls", {
                    count: usage.data.invocationCount,
                    date: when ?? "—",
                  })}
                </p>
              ) : null}

              {needsAck ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                  />
                  <span>{t("toolDelete.ack")}</span>
                </label>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            disabled={remove.isPending || !usage.data || (needsAck && !ack)}
          >
            {remove.isPending ? <Spinner /> : null}
            {t("toolDelete.confirm")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
