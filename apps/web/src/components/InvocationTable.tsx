import type { InvocationSummary } from "@plexus/contracts";
import { Badge, EmptyState } from "./ui";
import { useI18n } from "@/lib/i18n";

function time(iso: string, lang: string): string {
  const date = new Date(iso);
  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function InvocationTable({ invocations }: { invocations: InvocationSummary[] }) {
  const { t, lang } = useI18n();

  if (invocations.length === 0) {
    return <EmptyState title={t("inv.emptyTitle")} description={t("inv.emptyDescription")} />;
  }

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {invocations.map((invocation) => (
        <li key={invocation.id}>
          <details className="group py-2.5">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Badge
                tone={
                  invocation.status === "ok"
                    ? "green"
                    : invocation.status === "replayed"
                      ? "blue"
                      : "red"
                }
              >
                {invocation.status}
              </Badge>
              <span className="font-medium">
                {invocation.toolName ?? invocation.toolId ?? "unknown"}
              </span>
              <span className="text-xs text-zinc-500">
                {invocation.via}
                {invocation.actorType ? ` · ${invocation.actorType}` : ""}
              </span>
              <span className="ml-auto text-xs text-zinc-500">
                {invocation.latencyMs ?? 0} ms · {time(invocation.ts, lang)}
              </span>
            </summary>
            <div className="mt-2 space-y-2 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900/60">
              {invocation.errorCode ? (
                <p className="text-rose-500">
                  {t("inv.error")}: {invocation.errorCode}
                </p>
              ) : null}
              <div>
                <p className="mb-1 font-medium text-zinc-500">{t("inv.arguments")}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                  {invocation.requestPreview ?? "—"}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-medium text-zinc-500">{t("inv.result")}</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                  {invocation.responsePreview ?? "—"}
                </pre>
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
