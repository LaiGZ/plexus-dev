import type { ToolSummary } from "@plexus/contracts";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useErrorText } from "@/lib/i18n-ui";
import { Badge, Button, Drawer, Field, Spinner, Tabs, Textarea } from "./ui";

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
}

interface InputSchema {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

interface TryResult {
  ok: boolean;
  data?: unknown;
  latencyMs: number;
  replayed?: boolean;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function TryItDrawer({ tool, onClose }: { tool: ToolSummary | null; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const schema = useMemo(() => (tool?.inputSchema ?? {}) as InputSchema, [tool]);
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  const [mode, setMode] = useState<"form" | "json">("form");
  const [values, setValues] = useState<Record<string, string>>({});
  const [jsonText, setJsonText] = useState("{}");
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setValues({});
    setResult(null);
    setError(null);
    setJsonText("{}");
    setMode("form");
  }, [tool?.id]);

  if (!tool) return null;

  function collectArgs(): Record<string, unknown> | null {
    if (mode === "json") {
      try {
        const parsed: unknown = JSON.parse(jsonText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setError(t("try.needObject"));
          return null;
        }
        return parsed as Record<string, unknown>;
      } catch {
        setError(t("try.invalidJson"));
        return null;
      }
    }

    const args: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(properties)) {
      const raw = values[key];
      if (raw === undefined || raw === "") {
        if (required.includes(key)) args[key] = null;
        continue;
      }
      if (property.type === "number" || property.type === "integer") {
        args[key] = Number(raw);
      } else if (property.type === "boolean") {
        args[key] = raw === "true";
      } else if (property.type === "object" || property.type === "array") {
        try {
          args[key] = JSON.parse(raw);
        } catch {
          setError(t("try.fieldJson", { field: key }));
          return null;
        }
      } else {
        args[key] = raw;
      }
    }
    return args;
  }

  async function run() {
    setError(null);
    setResult(null);
    const args = collectArgs();
    if (!args) return;

    setRunning(true);
    try {
      const response = await api<TryResult>(`/api/tools/${tool?.id}/try`, {
        method: "POST",
        body: JSON.stringify({
          args,
          // Writes need a key; a fresh one per click means every click is a new intent.
          ...(tool?.sideEffect === "write" ? { idempotencyKey: crypto.randomUUID() } : {}),
        }),
      });
      setResult(response);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Drawer
      open={Boolean(tool)}
      title={t("try.title", { name: tool.displayName })}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            {tool.sideEffect === "write" ? t("try.writeNote") : t("try.readOnly")}
          </p>
          <Button onClick={run} disabled={running}>
            {running ? <Spinner /> : null}
            {running ? t("try.calling") : t("try.sendRequest")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-zinc-500">{t("try.method")}</dt>
            <dd className="font-mono">{tool.method}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">{t("try.path")}</dt>
            <dd className="truncate font-mono">{tool.path}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">{t("try.mcpName")}</dt>
            <dd className="truncate font-mono">{tool.mcpName}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">{t("try.sideEffect")}</dt>
            <dd>
              <Badge tone={tool.sideEffect === "write" ? "amber" : "green"}>
                {t(tool.sideEffect === "write" ? "common.write" : "common.read")}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">{t("try.exposed")}</dt>
            <dd>{tool.exposed ? "yes" : "no"}</dd>
          </div>
        </dl>

        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t("try.arguments")}</p>
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "form", label: t("try.form") },
              { value: "json", label: t("try.json") },
            ]}
          />
        </div>

        {mode === "form" ? (
          Object.keys(properties).length === 0 ? (
            <p className="text-sm text-zinc-500">{t("try.noArgs")}</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(properties).map(([key, property]) => (
                <Field
                  key={key}
                  label={`${key}${required.includes(key) ? " *" : ""}`}
                  name={key}
                  type={property.type === "number" || property.type === "integer" ? "number" : "text"}
                  hint={property.description}
                  placeholder={property.type === "boolean" ? "true / false" : undefined}
                  value={values[key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              ))}
            </div>
          )
        ) : (
          <Textarea
            label={t("try.rawJson")}
            rows={10}
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
          />
        )}

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        {result ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Badge tone="green">ok</Badge>
              <span>{result.latencyMs} ms</span>
              {result.replayed ? <Badge tone="blue">replayed</Badge> : null}
            </div>
            <pre className="max-h-80 overflow-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-200">
              {pretty(result.data)}
            </pre>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
