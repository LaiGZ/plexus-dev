import type { ToolSummary } from "@plexus/contracts";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InvocationTable } from "@/components/InvocationTable";
import { DeleteToolDialog } from "@/components/DeleteToolDialog";
import { ImportConfigModal } from "@/components/ImportConfigModal";
import { ToolEditModal } from "@/components/ToolEditModal";
import { TryItDrawer } from "@/components/TryItDrawer";
import { Badge, Banner, Button, Card, CodeBlock, EmptyState, Field, Spinner, Toggle } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import {
  useAppGrants,
  useDeleteSource,
  useInvocations,
  useIssueAppSecret,
  useSource,
  useSyncMcp,
  useTools,
  useUpdateAppGrants,
  useUpdateSource,
  useUpdateTool,
} from "@/lib/queries";

export function SourceDetailPage() {
  const { sourceId } = useParams({ strict: false });
  const navigate = useNavigate();
  const { t } = useI18n();
  const id = sourceId ?? "";

  const source = useSource(sourceId);
  const updateTool = useUpdateTool(id);
  const updateSource = useUpdateSource(id);
  const deleteSource = useDeleteSource();
  const issueSecret = useIssueAppSecret();
  const grants = useAppGrants(id);
  const updateGrants = useUpdateAppGrants(id);
  const allTools = useTools();
  const invocations = useInvocations({ limit: 20, sourceId: id });

  const [tryTool, setTryTool] = useState<ToolSummary | null>(null);
  const [editTool, setEditTool] = useState<ToolSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ToolSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const syncMcp = useSyncMcp(id);
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [appSecret, setAppSecret] = useState<string | null>(null);
  const [selectedGrants, setSelectedGrants] = useState<Set<string>>(new Set());
  const [grantsSaved, setGrantsSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [infoSaved, setInfoSaved] = useState(false);

  useEffect(() => {
    if (!source.data) return;
    setEditName(source.data.source.name);
    setEditBaseUrl(source.data.source.baseUrl);
    setEditEnabled(source.data.source.enabled);
  }, [source.data]);

  useEffect(() => {
    if (grants.data) setSelectedGrants(new Set(grants.data.toolIds));
  }, [grants.data]);

  if (source.isLoading) {
    return (
      <div className="flex justify-center py-16 text-zinc-400">
        <Spinner />
      </div>
    );
  }

  if (!source.data) {
    return (
      <EmptyState
        title={t("sourceDetail.notFound")}
        description={t("sourceDetail.notFoundDescription")}
        action={
          <Link to="/apps">
            <Button variant="outline">{t("sourceDetail.backToSources")}</Button>
          </Link>
        }
      />
    );
  }

  const { source: summary, tools } = source.data;

  const grantable = (allTools.data?.tools ?? []).filter(
    (tool) => tool.exposed && tool.sourceId !== id,
  );
  const grouped = new Map<string, ToolSummary[]>();
  for (const tool of grantable) {
    grouped.set(tool.sourceName, [...(grouped.get(tool.sourceName) ?? []), tool]);
  }

  async function onSaveGrants() {
    await updateGrants.mutateAsync([...selectedGrants]);
    setGrantsSaved(true);
  }

  async function onSaveInfo() {
    await updateSource.mutateAsync({
      name: editName.trim(),
      baseUrl: editBaseUrl.trim(),
      enabled: editEnabled,
    });
    setEditing(false);
    setInfoSaved(true);
  }

  async function onSyncMcp() {
    const result = await syncMcp.mutateAsync();
    setSyncResult(
      t("sourceDetail.syncDone", {
        created: result.created.length,
        skipped: result.skipped.length,
      }),
    );
  }

  function onExport() {
    const payload = {
      format: "plexus.app.v1",
      exportedAt: new Date().toISOString(),
      app: {
        id: summary.id,
        name: summary.name,
        kind: summary.kind,
        baseUrl: summary.baseUrl,
      },
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        sideEffect: tool.sideEffect,
        inputSchema: tool.inputSchema,
        exposed: tool.exposed,
        enabled: tool.enabled,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${summary.slug}.plexus.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function onDelete() {
    await deleteSource.mutateAsync(id);
    await navigate({ to: "/apps" });
  }

  async function onIssueSecret() {
    const result = await issueSecret.mutateAsync(id);
    setAppSecret(result.secret);
  }

  const sampleTool = tools.find((tool) => tool.exposed)?.mcpName ?? "your_tool";  const curlSample = appSecret
    ? [
        "BASE=http://127.0.0.1:3000",
        `TOKEN=$(curl -sS $BASE/api/gateway/token -H 'content-type: application/json' \\`,
        `  -d '{"appId":"${summary.id}","appSecret":"${appSecret}"}' | jq -r .accessToken)`,
        "curl -sS $BASE/api/gateway/invoke \\",
        `  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \\`,
        `  -d '{"tool":"${sampleTool}","args":{}}'`,
      ].join("\n")
    : "";

  return (
    <div className="space-y-6">
      <div>
        <Link to="/apps" className="text-xs text-zinc-500 hover:underline">
          {t("sourceDetail.back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{summary.name}</h1>
            <p className="mt-1 font-mono text-xs text-zinc-500">{summary.baseUrl}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="neutral">{summary.kind}</Badge>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500">{t("sourceDetail.enabled")}</span>
              <Toggle
                label={t("sourceDetail.enabled")}
                checked={summary.enabled}
                onChange={(enabled) => updateSource.mutate({ enabled })}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing((value) => !value);
                setInfoSaved(false);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button variant="outline" size="sm" onClick={onExport}>
              {t("sourceDetail.exportConfig")}
            </Button>
            {summary.kind === "mcp" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onSyncMcp()}
                disabled={syncMcp.isPending}
              >
                {syncMcp.isPending ? <Spinner /> : null}
                {t("sourceDetail.syncMcp")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                {t("sourceDetail.importConfig")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <Card title={t("sourceDetail.editInfo")}>
          <div className="space-y-4">
            <Field
              label={t("sourceNew.nameLabel")}
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
            <Field
              label={t("sourceNew.baseUrl")}
              value={editBaseUrl}
              onChange={(event) => setEditBaseUrl(event.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-3 text-sm">
              <span className="text-zinc-500">{t("sourceDetail.enabled")}</span>
              <Toggle
                label={t("sourceDetail.enabled")}
                checked={editEnabled}
                onChange={setEditEnabled}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void onSaveInfo()} disabled={updateSource.isPending}>
                {updateSource.isPending ? <Spinner /> : null}
                {t("sourceDetail.saveInfo")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </Card>
      ) : infoSaved ? (
        <p className="text-xs text-emerald-600">{t("sourceDetail.infoSaved")}</p>
      ) : null}

      {!summary.enabled ? <Banner tone="warn">{t("sourceDetail.disabledBanner")}</Banner> : null}
      {syncResult ? <p className="text-xs text-emerald-600">{syncResult}</p> : null}

      <Card
        title={t("sourceDetail.toolsTitle")}
        description={t("sourceDetail.toolsDescription")}
        actions={
          summary.kind === "mcp" ? null : (
            <Button size="sm" onClick={() => setCreating(true)}>
              {t("sourceNew.addMethod")}
            </Button>
          )
        }
      >
        {tools.length === 0 ? (
          <EmptyState title={t("sourceDetail.toolsTitle")} description="" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="pb-2 font-medium">{t("sourceDetail.colTool")}</th>
                  <th className="pb-2 font-medium">{t("sourceDetail.colSideEffect")}</th>
                  <th className="pb-2 font-medium">{t("sourceDetail.colExposed")}</th>
                  <th className="pb-2 font-medium">{t("sourceDetail.colEnabled")}</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {tools.map((tool) => (
                  <tr key={tool.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium">{tool.displayName}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {summary.kind === "mcp" ? "MCP" : `${tool.method} ${tool.path}`}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={tool.sideEffect}
                        onChange={(event) =>
                          updateTool.mutate({
                            id: tool.id,
                            patch: { sideEffect: event.target.value as "read" | "write" },
                          })
                        }
                        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                      >
                        <option value="read">{t("common.read")}</option>
                        <option value="write">{t("common.write")}</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4">
                      <Toggle
                        label={`${t("sourceDetail.colExposed")} ${tool.mcpName}`}
                        checked={tool.exposed}
                        onChange={(exposed) => updateTool.mutate({ id: tool.id, patch: { exposed } })}
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <Toggle
                        label={`${t("sourceDetail.colEnabled")} ${tool.mcpName}`}
                        checked={tool.enabled}
                        onChange={(enabled) => updateTool.mutate({ id: tool.id, patch: { enabled } })}
                      />
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditTool(tool)}>
                          {t("sourceDetail.editTool")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setTryTool(tool)}>
                          {t("sourceDetail.try")}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(tool)}>
                          {t("sourceDetail.deleteTool")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t("sourceDetail.recentTitle")} description={t("sourceDetail.recentDescription")}>
        {invocations.isLoading ? (
          <div className="flex justify-center py-8 text-zinc-400">
            <Spinner />
          </div>
        ) : (
          <InvocationTable invocations={invocations.data?.invocations ?? []} />
        )}
      </Card>

      <Card
        title={t("sourceDetail.credentialTitle")}
        description={t("sourceDetail.credentialDescription")}
      >        {appSecret ? (
          <div className="space-y-3">
            <Banner>{t("sourceDetail.secretOnce")}</Banner>
            <CodeBlock code={appSecret} />
            <p className="text-xs text-zinc-500">{t("sourceDetail.curlHint")}</p>
            <CodeBlock code={curlSample} />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{t("sourceDetail.secretHint")}</p>
        )}
        <div className="mt-4">
          <Button variant="outline" onClick={() => void onIssueSecret()} disabled={issueSecret.isPending}>
            {issueSecret.isPending ? <Spinner /> : null}
            {appSecret ? t("sourceDetail.rotateSecret") : t("sourceDetail.issueSecret")}
          </Button>
        </div>
      </Card>

      <Card
        title={t("sourceDetail.grantsTitle")}
        description={t("sourceDetail.grantsDescription")}
      >
        {grantable.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("sourceDetail.grantsEmpty")}</p>
        ) : (
          <div className="space-y-4">
            {[...grouped.entries()].map(([appName, list]) => (
              <div key={appName}>
                <p className="text-xs font-medium text-zinc-500">{appName}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                  {list.map((tool) => (
                    <label key={tool.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedGrants.has(tool.id)}
                        onChange={(event) => {
                          const next = new Set(selectedGrants);
                          if (event.target.checked) next.add(tool.id);
                          else next.delete(tool.id);
                          setSelectedGrants(next);
                          setGrantsSaved(false);
                        }}
                      />
                      {tool.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button onClick={() => void onSaveGrants()} disabled={updateGrants.isPending}>
                {updateGrants.isPending ? <Spinner /> : null}
                {t("sourceDetail.saveGrants")}
              </Button>
              {grantsSaved ? (
                <span className="text-xs text-emerald-600">{t("sourceDetail.grantsSaved")}</span>
              ) : null}
            </div>
          </div>
        )}
      </Card>

      <Card title={t("sourceDetail.dangerTitle")} description={t("sourceDetail.dangerDescription")}>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t("sourceDetail.deleteSource")}
          </Button>
        ) : (
          <div className="space-y-3">
            <Field
              label={t("sourceDetail.confirmType", { name: summary.name })}
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={confirmName !== summary.name}
                onClick={() => void onDelete()}
              >
                {t("sourceDetail.deleteForever")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <TryItDrawer tool={tryTool} onClose={() => setTryTool(null)} />
      {importing ? (
        <ImportConfigModal appId={summary.id} onClose={() => setImporting(false)} />
      ) : null}
      <DeleteToolDialog
        appId={summary.id}
        tool={deleting}
        onClose={() => setDeleting(null)}
      />
      <ToolEditModal
        appId={summary.id}
        appKind={summary.kind}
        tool={editTool}
        creating={creating}
        onClose={() => {
          setEditTool(null);
          setCreating(false);
        }}
      />
    </div>
  );
}
