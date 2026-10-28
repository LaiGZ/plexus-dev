import type { InvocationStatus } from "@plexus/contracts";
import { useState } from "react";
import { InvocationTable } from "@/components/InvocationTable";
import { Card, Spinner } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useInvocations, useSources } from "@/lib/queries";

type Actor = "user" | "mcp" | "app" | "agent";

const selectClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950/60";

export function LogsPage() {
  const { t } = useI18n();
  const sources = useSources();
  const [sourceId, setSourceId] = useState("");
  const [status, setStatus] = useState<InvocationStatus | "">("");
  const [actor, setActor] = useState<Actor | "">("");

  const logs = useInvocations({
    limit: 100,
    ...(sourceId ? { sourceId } : {}),
    ...(status ? { status } : {}),
    ...(actor ? { actorType: actor } : {}),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("logs.title")}</h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("logs.subtitle")}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <select
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          className={selectClass}
          aria-label={t("sources.title")}
        >
          <option value="">{t("logs.allApps")}</option>
          {(sources.data?.sources ?? []).map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>

        <select
          value={actor}
          onChange={(event) => setActor(event.target.value as Actor | "")}
          className={selectClass}
          aria-label={t("logs.allActors")}
        >
          <option value="">{t("logs.allActors")}</option>
          <option value="user">{t("logs.actor.user")}</option>
          <option value="mcp">{t("logs.actor.mcp")}</option>
          <option value="app">{t("logs.actor.app")}</option>
          <option value="agent">{t("logs.actor.agent")}</option>
        </select>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as InvocationStatus | "")}
          className={selectClass}
          aria-label={t("logs.allStatuses")}
        >
          <option value="">{t("logs.allStatuses")}</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
          <option value="replayed">replayed</option>
        </select>
      </div>

      <Card>
        {logs.isLoading ? (
          <div className="flex justify-center py-10 text-zinc-400">
            <Spinner />
          </div>
        ) : (
          <InvocationTable invocations={logs.data?.invocations ?? []} />
        )}
      </Card>
    </div>
  );
}
