import type { ToolSummary } from "@plexus/contracts";
import { useEffect, useState } from "react";
import { Button, Field, Spinner, Textarea } from "./ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAddTool, useUpdateTool } from "@/lib/queries";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950/60 disabled:opacity-60";

export function ToolEditModal({
  appId,
  appKind,
  tool,
  creating = false,
  onClose,
}: {
  appId: string;
  appKind: string;
  tool: ToolSummary | null;
  creating?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const update = useUpdateTool(appId);
  const add = useAddTool(appId);

  const [name, setName] = useState("");
  const [method, setMethod] = useState("POST");
  const [path, setPath] = useState("/");
  const [sideEffect, setSideEffect] = useState<"read" | "write">("read");
  const [description, setDescription] = useState("");
  const [schema, setSchema] = useState("{}");
  const [exposed, setExposed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tool) {
      setName(tool.name);
      setMethod(tool.method);
      setPath(tool.path);
      setSideEffect(tool.sideEffect);
      setDescription(tool.description);
      setSchema(JSON.stringify(tool.inputSchema ?? { type: "object", properties: {} }, null, 2));
      setExposed(tool.exposed);
      setEnabled(tool.enabled);
    } else if (creating) {
      setName("");
      setMethod("POST");
      setPath("/");
      setSideEffect("read");
      setDescription("");
      setSchema(JSON.stringify({ type: "object", properties: {} }, null, 2));
      setExposed(true);
      setEnabled(true);
    }
    setError(null);
  }, [tool, creating]);

  if (!tool && !creating) return null;
  const readonly = appKind === "mcp";

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(schema);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
    } catch {
      setError(t("toolEdit.invalidSchema"));
      return;
    }

    try {
      if (creating && !tool) {
        await add.mutateAsync({
          name,
          method,
          path,
          description,
          sideEffect,
          inputSchema: parsed,
          exposed,
          enabled,
        });
      } else if (tool) {
        await update.mutateAsync({
          id: tool.id,
          patch: {
            sideEffect,
            description,
            exposed,
            enabled,
            ...(readonly ? {} : { name, method, path, inputSchema: parsed }),
          },
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.unknownError"));
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">
            {creating ? t("toolEdit.createTitle") : t("toolEdit.title")}
            {tool ? (
              <>
                {" · "}
                <span className="font-mono">{tool.mcpName}</span>
              </>
            ) : null}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {readonly ? <p className="text-xs text-zinc-500">{t("toolEdit.mcpReadonly")}</p> : null}

          <Field
            label={t("toolEdit.name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={readonly}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="tool-method" className="block text-sm font-medium">
                {t("toolEdit.method")}
              </label>
              <select
                id="tool-method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                disabled={readonly}
                className={inputClass}
              >
                {METHODS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label={t("toolEdit.path")}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              disabled={readonly}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tool-side" className="block text-sm font-medium">
              {t("toolEdit.sideEffect")}
            </label>
            <select
              id="tool-side"
              value={sideEffect}
              onChange={(event) => setSideEffect(event.target.value as "read" | "write")}
              className={inputClass}
            >
              <option value="read">{t("common.read")}</option>
              <option value="write">{t("common.write")}</option>
            </select>
          </div>

          <Field
            label={t("toolEdit.description")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <Textarea
            label={t("toolEdit.schema")}
            rows={8}
            value={schema}
            onChange={(event) => setSchema(event.target.value)}
            disabled={readonly}
          />

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exposed}
                onChange={(event) => setExposed(event.target.checked)}
              />
              {t("toolEdit.exposed")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {t("toolEdit.enabled")}
            </label>
          </div>

          {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={update.isPending || add.isPending}>
            {update.isPending || add.isPending ? <Spinner /> : null}
            {creating ? t("toolEdit.create") : t("toolEdit.save")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
