import type { ImportDiff } from "@plexus/contracts";
import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, Button, Spinner, Textarea } from "./ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useApplyImport, useImportPreview } from "@/lib/queries";

export function ImportConfigModal({
  appId,
  onClose,
}: {
  appId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const preview = useImportPreview(appId);
  const apply = useApplyImport(appId);

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [removeMissing, setRemoveMissing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function describe(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.message === "app_id_mismatch") {
        const details = err.body?.details as { actual?: string } | undefined;
        return details?.actual
          ? `${t("importCfg.mismatch")} (${t("importCfg.appId")}: ${details.actual})`
          : t("importCfg.mismatch");
      }
      return err.code === "invalid_request"
        ? `${err.message}${err.body?.hint ? ` — ${err.body.hint}` : ""}`
        : err.message;
    }
    return t("common.unknownError");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
    setDiff(null);
    setError(null);
  }

  async function parse() {
    setBusy(true);
    setError(null);
    try {
      setDiff(await preview.mutateAsync(text));
      setRemoveMissing(true);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apply.mutateAsync({ text, removeMissing });
      onClose();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  const hasChanges = Boolean(
    diff &&
      (diff.nameChange ||
        diff.baseUrlChange ||
        diff.added.length ||
        diff.updated.length ||
        diff.removed.length),
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{t("importCfg.title")}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <p className="text-sm text-zinc-500">{t("importCfg.hint")}</p>

          {!diff ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="config-file" className="block text-sm font-medium">
                  {t("importCfg.file")}
                </label>
                <input
                  id="config-file"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void onFile(event.target.files?.[0])}
                  className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-zinc-200 dark:text-zinc-300 dark:file:bg-zinc-800"
                />
                {fileName ? <p className="text-xs text-zinc-500">{fileName}</p> : null}
              </div>

              <Textarea
                label={t("importCfg.paste")}
                rows={10}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setDiff(null);
                }}
                placeholder='{ "format": "plexus.app.v1", ... }'
              />

              <div className="flex justify-end">
                <Button onClick={() => void parse()} disabled={busy || !text.trim()}>
                  {busy ? <Spinner /> : null}
                  {busy ? t("importCfg.parsing") : t("importCfg.parse")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                {diff.nameChange ? (
                  <Row
                    label={t("importCfg.nameChange")}
                    from={diff.nameChange.from}
                    to={diff.nameChange.to}
                  />
                ) : null}
                {diff.baseUrlChange ? (
                  <Row
                    label={t("importCfg.urlChange")}
                    from={diff.baseUrlChange.from}
                    to={diff.baseUrlChange.to}
                  />
                ) : null}
              </div>

              {diff.added.length ? (
                <Section title={`${t("importCfg.added")} · ${diff.added.length}`}>
                  {diff.added.map((tool) => (
                    <li key={tool.name} className="flex items-center gap-2">
                      <Badge tone={tool.sideEffect === "write" ? "amber" : "green"}>
                        {tool.sideEffect === "write" ? "write" : "read"}
                      </Badge>
                      <span className="font-mono text-xs">{tool.name}</span>
                    </li>
                  ))}
                </Section>
              ) : null}

              {diff.updated.length ? (
                <Section title={`${t("importCfg.updated")} · ${diff.updated.length}`}>
                  {diff.updated.map((tool) => (
                    <li key={tool.id}>
                      <span className="font-mono text-xs">{tool.name}</span>
                      <span className="ml-2 text-xs text-zinc-500">{tool.fields.join(", ")}</span>
                    </li>
                  ))}
                </Section>
              ) : null}

              {diff.removed.length ? (
                <Section title={`${t("importCfg.removed")} · ${diff.removed.length}`}>
                  {diff.removed.map((tool) => (
                    <li key={tool.id} className="font-mono text-xs">
                      {tool.name}
                    </li>
                  ))}
                </Section>
              ) : null}

              {diff.warnings.map((warning) => (
                <p key={warning} className="text-xs text-amber-600">
                  {warning}
                </p>
              ))}

              {!hasChanges ? <p className="text-sm text-zinc-500">{t("importCfg.noChanges")}</p> : null}

              {diff.removed.length ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={removeMissing}
                    onChange={(event) => setRemoveMissing(event.target.checked)}
                  />
                  <span>{t("importCfg.removeMissing")}</span>
                </label>
              ) : null}

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDiff(null);
                    setError(null);
                  }}
                >
                  {t("importCfg.back")}
                </Button>
                <Button onClick={() => void confirm()} disabled={busy || !hasChanges}>
                  {busy ? <Spinner /> : null}
                  {t("importCfg.confirm")}
                </Button>
              </div>
            </>
          )}

          {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-24 text-zinc-500">{label}</span>
      <span className="text-zinc-500 line-through">{from}</span>
      <span>→</span>
      <span className="font-medium">{to}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-1 space-y-1">{children}</ul>
    </div>
  );
}
