import type { AuthInput, ToolDraft, ToolPreview } from "@plexus/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Banner, Button, Card, Field, Spinner, Tabs, Textarea, cx } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useErrorText } from "@/lib/i18n-ui";
import { useCreateSource, usePreviewSource, useTemplatePreview } from "@/lib/queries";

type AuthType = AuthInput["type"];
type SourceKind = "http" | "openapi" | "mcp";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface MethodDraft {
  key: string;
  name: string;
  method: string;
  path: string;
  description: string;
  sideEffect: "read" | "write";
  inputSchema?: unknown;
}

function emptyMethod(): MethodDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    method: "GET",
    path: "/",
    description: "",
    sideEffect: "read",
  };
}

/** Accept `127.0.0.1:7100` as well as a full URL; strip trailing slashes. */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950/60";

function Step({
  index,
  label,
  active,
  onClick,
}: {
  index: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "step" : undefined}
      className={cx(
        "group flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition",
        active
          ? "text-zinc-900 dark:text-zinc-100"
          : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
      )}
    >
      <span
        className={cx(
          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition",
          active
            ? "bg-emerald-500 text-white"
            : "bg-zinc-200 text-zinc-600 group-hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400",
        )}
      >
        {index}
      </span>
      {label}
    </button>
  );
}

export function SourceNewPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const errorText = useErrorText();
  const previewMutation = usePreviewSource();
  const templateMutation = useTemplatePreview();
  const createSource = useCreateSource();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [headerName, setHeaderName] = useState("x-api-key");
  const [headerValue, setHeaderValue] = useState("");

  const [methods, setMethods] = useState<MethodDraft[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>("http");
  const [importOpen, setImportOpen] = useState(false);
  const [specMode, setSpecMode] = useState<"url" | "text">("url");
  const [specUrl, setSpecUrl] = useState("");
  const [specText, setSpecText] = useState("");

  const [exposeAll, setExposeAll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const isMcp = sourceKind === "mcp";

  function buildAuth(): AuthInput {
    if (authType === "bearer") return { type: "bearer", token: bearerToken };
    if (authType === "basic") return { type: "basic", username, password };
    if (authType === "header") return { type: "header", headerName, headerValue };
    return { type: "none" };
  }

  function describe(err: unknown, fallback: string): string {
    if (err instanceof ApiError && err.code === "invalid_request") return err.message;
    return errorText(err) || fallback;
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const baseUrlValid = !normalizedBaseUrl || /^https?:\/\/[^\s]+$/.test(normalizedBaseUrl);
  const namedMethods = methods.filter((method) => method.name.trim());
  const duplicateNames =
    new Set(namedMethods.map((method) => method.name.trim())).size !== namedMethods.length;
  const methodsValid =
    methods.length > 0 &&
    !duplicateNames &&
    methods.every((method) => method.name.trim() && method.path.trim());

  function updateMethod(key: string, patch: Partial<MethodDraft>) {
    setMethods((current) =>
      current.map((method) => (method.key === key ? { ...method, ...patch } : method)),
    );
  }

  function goToStep(target: 1 | 2 | 3) {
    if (target === 1) {
      setError(null);
      setStep(1);
      return;
    }
    if (!name.trim()) {
      setError(t("sourceNew.nameRequired"));
      setStep(1);
      return;
    }
    if (!baseUrlValid) {
      setError(t("sourceNew.baseUrlInvalid"));
      setStep(1);
      return;
    }
    if (target === 2) {
      setError(null);
      setBaseUrl(normalizedBaseUrl);
      setStep(2);
      return;
    }
    if (methods.length === 0) {
      setError(t("sourceNew.noMethods"));
      setStep(2);
      return;
    }
    if (!methodsValid) {
      setError(t("sourceNew.incompleteMethods"));
      setStep(2);
      return;
    }
    if (!normalizedBaseUrl) {
      setError(t("sourceNew.baseUrlMissing"));
      setStep(2);
      return;
    }
    setError(null);
    setBaseUrl(normalizedBaseUrl);
    setStep(3);
  }

  function toDraft(tool: ToolPreview): MethodDraft {
    return {
      key: crypto.randomUUID(),
      name: tool.name,
      method: tool.method,
      path: tool.path || "/",
      description: tool.description,
      sideEffect: tool.sideEffect,
      inputSchema: tool.inputSchema,
    };
  }

  async function importFromOpenApi() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await previewMutation.mutateAsync({
        kind: "openapi",
        name: name || undefined,
        ...(specMode === "url" ? { specUrl } : { specText }),
        ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
        auth: buildAuth(),
        headers: {},
      });

      const existing = new Set(methods.map((method) => method.name));
      const additions = result.tools.filter((tool) => !existing.has(tool.name)).map(toDraft);
      setMethods((current) => [...current, ...additions]);
      setSourceKind("openapi");
      if (!normalizedBaseUrl) setBaseUrl(result.baseUrl);
      setImportOpen(false);
      setNotice(t("sourceNew.imported", { count: additions.length }));
    } catch (err) {
      setError(describe(err, t("sourceNew.readFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function importTemplate(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setTemplateBusy(true);
    try {
      const text = await file.text();
      const preview = await templateMutation.mutateAsync(text);

      setName(preview.app.name);
      setBaseUrl(preview.app.baseUrl);
      setSourceKind("http");
      setMethods(preview.tools.map(toDraft));

      const auth = preview.app.auth;
      setAuthType(auth?.type ?? "none");
      if (auth?.type === "bearer") setBearerToken(auth.token);
      if (auth?.type === "basic") {
        setUsername(auth.username);
        setPassword(auth.password);
      }
      if (auth?.type === "header") {
        setHeaderName(auth.headerName);
        setHeaderValue(auth.headerValue);
      }

      setStep(2);
      setNotice(t("sourceNew.templateImported", { count: preview.tools.length }));
    } catch (err) {
      setError(describe(err, t("sourceNew.readFailed")));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function downloadTemplate() {
    const res = await fetch("/api/templates/app", { credentials: "include" });
    if (!res.ok) {
      setError(t("common.unknownError"));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "plexus-app-template.yaml";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importFromMcp() {    setError(null);
    setNotice(null);
    if (!normalizedBaseUrl) {
      setError(t("sourceNew.mcpNeedsUrl"));
      return;
    }
    setBusy(true);
    try {
      const result = await previewMutation.mutateAsync({
        kind: "mcp",
        name: name || undefined,
        baseUrl: normalizedBaseUrl,
        auth: buildAuth(),
        headers: {},
      });
      setMethods(result.tools.map(toDraft));
      setSourceKind("mcp");
      setNotice(t("sourceNew.imported", { count: result.tools.length }));
    } catch (err) {
      setError(describe(err, t("sourceNew.readFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    setError(null);
    setBusy(true);
    try {
      const tools: ToolDraft[] = methods.map((method) => ({
        name: method.name.trim(),
        description: method.description.trim(),
        method: method.method,
        path: method.path.trim(),
        sideEffect: method.sideEffect,
        ...(method.inputSchema ? { inputSchema: method.inputSchema } : {}),
      }));

      const created = await createSource.mutateAsync({
        name: name.trim(),
        kind: sourceKind,
        baseUrl: normalizedBaseUrl,
        auth: buildAuth(),
        headers: {},
        tools,
        exposeAll,
      });

      await navigate({ to: "/apps/$sourceId", params: { sourceId: created.source.id } });
    } catch (err) {
      setError(describe(err, t("sourceNew.createFailed")));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("sourceNew.title")}</h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("sourceNew.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Step index={1} label={t("sourceNew.stepApp")} active={step === 1} onClick={() => goToStep(1)} />
        <Step
          index={2}
          label={t("sourceNew.stepMethods")}
          active={step === 2}
          onClick={() => goToStep(2)}
        />
        <Step
          index={3}
          label={t("sourceNew.stepReview")}
          active={step === 3}
          onClick={() => goToStep(3)}
        />
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner>{notice}</Banner> : null}

      {step === 1 ? (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            <div>
              <p className="text-sm font-medium">{t("sourceNew.templateTitle")}</p>
              <p className="mt-1 max-w-md text-xs text-zinc-500">
                {t("sourceNew.templateHint")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void downloadTemplate()}>
                {t("sourceNew.downloadTemplate")}
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {templateBusy ? <Spinner /> : null}
                {t("sourceNew.importTemplate")}
                <input
                  type="file"
                  accept=".yaml,.yml,.json"
                  className="hidden"
                  onChange={(event) => {
                    void importTemplate(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">{t("sourceNew.appTitle")}</p>
            <p className="mt-1 text-sm text-zinc-500">{t("sourceNew.appHint")}</p>
          </div>

          <Field
            label={t("sourceNew.nameLabel")}
            name="name"
            placeholder={t("sourceNew.namePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint={t("sourceNew.nameHint")}
          />

          <Field
            label={t("sourceNew.baseUrl")}
            name="baseUrl"
            placeholder={t("sourceNew.baseUrlPlaceholder")}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            error={baseUrl.trim() && !baseUrlValid ? t("sourceNew.baseUrlInvalid") : undefined}
            hint={t("sourceNew.baseUrlHint")}
          />

          <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium">{t("sourceNew.authTitle")}</p>
            <select
              value={authType}
              onChange={(event) => setAuthType(event.target.value as AuthType)}
              className={inputClass}
            >
              <option value="none">{t("sourceNew.authNone")}</option>
              <option value="bearer">{t("sourceNew.authBearer")}</option>
              <option value="basic">{t("sourceNew.authBasic")}</option>
              <option value="header">{t("sourceNew.authHeader")}</option>
            </select>

            {authType === "bearer" ? (
              <Field
                label={t("sourceNew.token")}
                type="password"
                value={bearerToken}
                onChange={(event) => setBearerToken(event.target.value)}
                hint={t("sourceNew.credentialHint")}
              />
            ) : null}
            {authType === "basic" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t("sourceNew.username")}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <Field
                  label={t("sourceNew.password")}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            ) : null}
            {authType === "header" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t("sourceNew.headerName")}
                  value={headerName}
                  onChange={(event) => setHeaderName(event.target.value)}
                />
                <Field
                  label={t("sourceNew.headerValue")}
                  type="password"
                  value={headerValue}
                  onChange={(event) => setHeaderValue(event.target.value)}
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (!name.trim()) {
                  setError(t("sourceNew.nameRequired"));
                  return;
                }
                if (!baseUrlValid) {
                  setError(t("sourceNew.baseUrlInvalid"));
                  return;
                }
                setError(null);
                setBaseUrl(normalizedBaseUrl);
                setStep(2);
              }}
            >
              {t("common.next")}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("sourceNew.methodsTitle")}</p>
              <p className="mt-1 text-sm text-zinc-500">
                {isMcp ? t("sourceNew.mcpMethodsHint") : t("sourceNew.methodsHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isMcp ? (
                <Button variant="outline" size="sm" onClick={() => void importFromMcp()} disabled={busy}>
                  {busy ? <Spinner /> : null}
                  {t("sourceNew.reimport")}
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => void importFromMcp()} disabled={busy}>
                    {busy ? <Spinner /> : null}
                    {t("sourceNew.importMcp")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setImportOpen((open) => !open)}
                  >
                    {t("sourceNew.importOpenapi")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSourceKind("http");
                      setMethods((current) => [...current, emptyMethod()]);
                    }}
                  >
                    {t("sourceNew.addMethod")}
                  </Button>
                </>
              )}
            </div>
          </div>

          {importOpen && !isMcp ? (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <Tabs
                value={specMode}
                onChange={setSpecMode}
                tabs={[
                  { value: "url", label: t("sourceNew.specFromUrl") },
                  { value: "text", label: t("sourceNew.specPaste") },
                ]}
              />
              {specMode === "url" ? (
                <Field
                  label={t("sourceNew.specUrl")}
                  placeholder="https://api.example.com/openapi.json"
                  value={specUrl}
                  onChange={(event) => setSpecUrl(event.target.value)}
                />
              ) : (
                <Textarea
                  label={t("sourceNew.specText")}
                  rows={8}
                  placeholder="openapi: 3.0.3 ..."
                  value={specText}
                  onChange={(event) => setSpecText(event.target.value)}
                />
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void importFromOpenApi()}
                  disabled={busy || (specMode === "url" ? !specUrl.trim() : !specText.trim())}
                >
                  {busy ? <Spinner /> : null}
                  {busy ? t("sourceNew.reading") : t("sourceNew.importAction")}
                </Button>
              </div>
            </div>
          ) : null}

          {methods.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
              <p className="text-sm text-zinc-500">{t("sourceNew.manualNote")}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => setMethods([emptyMethod()])}>
                  {t("sourceNew.addMethod")}
                </Button>
                <Button variant="outline" onClick={() => void importFromMcp()} disabled={busy}>
                  {t("sourceNew.importMcp")}
                </Button>
              </div>
            </div>
          ) : isMcp ? (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {methods.map((method) => (
                <li key={method.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{method.name}</span>
                  <Badge tone={method.sideEffect === "write" ? "amber" : "green"}>
                    {t(method.sideEffect === "write" ? "common.write" : "common.read")}
                  </Badge>
                  <span className="truncate text-xs text-zinc-500">{method.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              {methods.map((method) => (
                <div
                  key={method.key}
                  className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label={t("sourceNew.toolName")}
                      placeholder="listTodos"
                      value={method.name}
                      onChange={(event) => updateMethod(method.key, { name: event.target.value })}
                      className={cx(inputClass, "min-w-40 flex-1")}
                    />
                    <select
                      aria-label={t("sourceNew.method")}
                      value={method.method}
                      onChange={(event) => updateMethod(method.key, { method: event.target.value })}
                      className={cx(inputClass, "w-28")}
                    >
                      {METHODS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("sourceNew.sideEffect")}
                      value={method.sideEffect}
                      onChange={(event) =>
                        updateMethod(method.key, {
                          sideEffect: event.target.value as "read" | "write",
                        })
                      }
                      className={cx(
                        inputClass,
                        "w-28",
                        method.sideEffect === "write"
                          ? "border-amber-400 text-amber-700 dark:border-amber-500/60 dark:text-amber-300"
                          : "",
                      )}
                    >
                      <option value="read">{t("common.read")}</option>
                      <option value="write">{t("common.write")}</option>
                    </select>
                    <button
                      type="button"
                      aria-label={t("sourceNew.removeMethod")}
                      onClick={() =>
                        setMethods((current) => current.filter((item) => item.key !== method.key))
                      }
                      className="px-2 text-zinc-400 hover:text-rose-500"
                    >
                      ×
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      aria-label={t("sourceNew.path")}
                      placeholder="/todos/{id}"
                      value={method.path}
                      onChange={(event) => updateMethod(method.key, { path: event.target.value })}
                      className={cx(inputClass, "font-mono text-xs")}
                    />
                    <input
                      aria-label={t("sourceNew.descriptionPlaceholder")}
                      placeholder={t("sourceNew.descriptionPlaceholder")}
                      value={method.description}
                      onChange={(event) =>
                        updateMethod(method.key, { description: event.target.value })
                      }
                      className={inputClass}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {duplicateNames ? (
            <p className="text-sm text-rose-500">{t("sourceNew.duplicateName")}</p>
          ) : null}
          {!isMcp &&
          methods.length > 0 &&
          methods.some((method) => !method.name.trim() || !method.path.trim()) ? (
            <p className="text-sm text-rose-500">{t("sourceNew.incompleteMethods")}</p>
          ) : null}
          {!normalizedBaseUrl ? (
            <p className="text-sm text-rose-500">{t("sourceNew.baseUrlMissing")}</p>
          ) : null}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              {t("common.back")}
            </Button>
            <Button onClick={() => setStep(3)} disabled={!methodsValid || !normalizedBaseUrl}>
              {t("sourceNew.review", { count: methods.length })}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="space-y-4">
          <div>
            <p className="text-sm font-medium">{t("sourceNew.readyTitle")}</p>
            <p className="mt-1 text-sm text-zinc-500">
              {t("sourceNew.readyMeta", {
                name: name.trim(),
                count: methods.length,
                url: normalizedBaseUrl,
              })}
            </p>
          </div>

          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {methods.map((method) => (
              <li key={method.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium">{method.name}</span>
                {isMcp ? null : <Badge tone="neutral">{method.method}</Badge>}
                <Badge tone={method.sideEffect === "write" ? "amber" : "green"}>
                  {t(method.sideEffect === "write" ? "common.write" : "common.read")}
                </Badge>
                {isMcp ? null : (
                  <span className="truncate font-mono text-xs text-zinc-500">{method.path}</span>
                )}
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={exposeAll}
              onChange={(event) => setExposeAll(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t("sourceNew.exposeAll")}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                {t("sourceNew.exposeAllHint")}
              </span>
            </span>
          </label>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              {t("common.back")}
            </Button>
            <Button onClick={onCreate} disabled={busy || !methodsValid || !normalizedBaseUrl}>
              {busy ? <Spinner /> : null}
              {busy ? t("sourceNew.creating") : t("sourceNew.create")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
