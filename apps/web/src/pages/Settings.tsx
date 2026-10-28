import type { ModelProvider } from "@plexus/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { Badge, Banner, Button, Card, CodeBlock, Field, Spinner, useCopy } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useErrorText } from "@/lib/i18n-ui";
import {
  useCreateToken,
  useModelConfig,
  useRevokeToken,
  useSources,
  useTestModel,
  useTokens,
  useUpdateModelConfig,
} from "@/lib/queries";
import { useMe } from "@/lib/session";

export function SettingsPage() {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const user = useMe();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);
  const [changing, setChanging] = useState(false);

  const tokens = useTokens();
  const sources = useSources();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();
  const [tokenName, setTokenName] = useState("Claude Desktop");
  const [tokenScope, setTokenScope] = useState<"read" | "write">("read");
  const [allowedApps, setAllowedApps] = useState<Set<string>>(new Set());
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [, copy] = useCopy();

  const model = useModelConfig();
  const saveModel = useUpdateModelConfig();
  const testModel = useTestModel();
  const [provider, setProvider] = useState<ModelProvider>("deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(120_000);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!model.data) return;
    setProvider(model.data.provider);
    setBaseUrl(model.data.baseUrl);
    setModelName(model.data.model);
    setTimeoutMs(model.data.timeoutMs);
  }, [model.data]);

  async function onSaveModel() {
    setTestResult(null);
    await saveModel.mutateAsync({
      provider,
      baseUrl: baseUrl.trim() || undefined,
      model: modelName.trim(),
      timeoutMs,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    setApiKey("");
  }

  async function onTestModel() {
    setTestResult(null);
    const result = await testModel.mutateAsync();
    setTestResult({
      ok: result.ok,
      text: result.ok
        ? t("settings.testOk", { ms: result.latencyMs })
        : `${t("settings.testFailed")}: ${result.message ?? ""}`,
    });
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US");

  const modelSource =
    model.data?.source === "db"
      ? t("settings.sourceDb")
      : model.data?.source === "env"
        ? t("settings.sourceEnv")
        : t("settings.sourceDefault");

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordDone(false);
    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.passwordMismatch"));
      return;
    }
    setChanging(true);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(errorText(err));
    } finally {
      setChanging(false);
    }
  }

  async function onCreateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTokenError(null);
    try {
      const result = await createToken.mutateAsync({
        name: tokenName,
        scope: tokenScope,
        sourceIds: [...allowedApps],
      });
      setCreatedToken(result.token);
      setAllowedApps(new Set());
    } catch (err) {
      setTokenError(errorText(err));
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("settings.subtitle")}</p>
      </header>

      <Card title={t("settings.account")}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">{t("settings.username")}</dt>
            <dd className="mt-0.5 font-medium">{user?.username ?? "…"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">{t("settings.role")}</dt>
            <dd className="mt-0.5 font-medium">{user?.role.name ?? "…"}</dd>
          </div>
        </dl>
      </Card>

      <Card
        title={t("settings.modelTitle")}
        description={t("settings.modelDescription")}
        actions={
          model.data ? (
            <Badge tone={model.data.enabled ? "green" : "red"}>
              {model.data.enabled ? t("settings.modelEnabled") : t("settings.modelDisabled")}
            </Badge>
          ) : null
        }
      >
        {model.isLoading ? (
          <div className="flex justify-center py-6 text-zinc-400">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-provider" className="block text-sm font-medium">
                  {t("settings.provider")}
                </label>
                <select
                  id="model-provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as ModelProvider)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950/60"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI compatible</option>
                  <option value="stub">Stub (offline)</option>
                </select>
              </div>
              <Field
                label={t("settings.modelName")}
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="deepseek-flash"
              />
            </div>

            <Field
              label={t("settings.baseUrl")}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("settings.apiKey")}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={model.data?.keyHint ?? "sk-…"}
                hint={t("settings.apiKeyHint")}
              />
              <Field
                label={t("settings.timeout")}
                type="number"
                min={1000}
                max={600000}
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(Number(event.target.value))}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void onSaveModel()} disabled={saveModel.isPending}>
                {saveModel.isPending ? <Spinner /> : null}
                {t("settings.saveModel")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void onTestModel()}
                disabled={testModel.isPending}
              >
                {testModel.isPending ? <Spinner /> : null}
                {testModel.isPending ? t("settings.testing") : t("settings.testModel")}
              </Button>
              {testResult ? (
                <span className={testResult.ok ? "text-xs text-emerald-600" : "text-xs text-rose-500"}>
                  {testResult.text}
                </span>
              ) : null}
            </div>

            <p className="text-xs text-zinc-500">
              {model.data?.keyHint
                ? t("settings.keyStored", { hint: model.data.keyHint })
                : t("settings.modelDisabled")}
              {" · "}
              {modelSource}
            </p>
          </div>
        )}
      </Card>

      <Card
        title={t("settings.passwordTitle")}
        description={t("settings.passwordDescription")}
      >
        {passwordDone ? <Banner>{t("settings.passwordUpdated")}</Banner> : null}
        <form onSubmit={onChangePassword} className="mt-4 space-y-4">
          <Field
            label={t("settings.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("settings.newPassword")}
              type="password"
              autoComplete="new-password"
              hint={t("settings.passwordHint")}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={10}
            />
            <Field
              label={t("settings.confirmPassword")}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={10}
            />
          </div>
          {passwordError ? <p className="text-sm text-rose-500">{passwordError}</p> : null}
          <Button type="submit" disabled={changing}>
            {changing ? <Spinner /> : null}
            {changing ? t("common.saving") : t("settings.updatePassword")}
          </Button>
        </form>
      </Card>

      <Card title={t("settings.tokensTitle")} description={t("settings.tokensDescription")}>
        {createdToken ? (
          <div className="mb-4 space-y-2">
            <Banner>
              {t("settings.tokenOnce")}
              <Button size="sm" variant="ghost" className="ml-2" onClick={() => copy(createdToken)}>
                {t("common.copy")}
              </Button>
            </Banner>
            <CodeBlock code={createdToken} />
          </div>
        ) : null}

        <form onSubmit={onCreateToken} className="mb-6 flex flex-wrap items-end gap-3">
          <Field
            label={t("settings.tokenName")}
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            required
            className="min-w-48"
          />
          <div className="space-y-1.5">
            <label htmlFor="scope" className="block text-sm font-medium">
              {t("settings.scope")}
            </label>
            <select
              id="scope"
              value={tokenScope}
              onChange={(event) => setTokenScope(event.target.value as "read" | "write")}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950/60"
            >
              <option value="read">{t("common.read")}</option>
              <option value="write">{t("common.write")}</option>
            </select>
          </div>
          <Button type="submit" disabled={createToken.isPending}>
            {createToken.isPending ? <Spinner /> : null}
            {t("settings.createToken")}
          </Button>
        </form>

        {sources.data && sources.data.sources.length > 0 ? (
          <div className="-mt-3 mb-6 space-y-1">
            <p className="text-sm font-medium">{t("settings.tokenApps")}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {sources.data.sources.map((source) => (
                <label key={source.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={allowedApps.has(source.id)}
                    onChange={(event) => {
                      const next = new Set(allowedApps);
                      if (event.target.checked) next.add(source.id);
                      else next.delete(source.id);
                      setAllowedApps(next);
                    }}
                  />
                  {source.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-zinc-500">{t("settings.tokenAppsHint")}</p>
          </div>
        ) : null}
        {tokenError ? <p className="mb-3 text-sm text-rose-500">{tokenError}</p> : null}

        {tokens.data && tokens.data.tokens.length > 0 ? (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {tokens.data.tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{token.name}</span>
                    <Badge tone={token.scope === "write" ? "amber" : "green"}>
                      {t(token.scope === "write" ? "common.write" : "common.read")}
                    </Badge>
                    <span className="text-xs text-zinc-500">
                      {token.sourceIds.length === 0
                        ? t("settings.allApps")
                        : t("settings.tokenAppsCount", { count: token.sourceIds.length })}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500">{token.prefix}…</p>
                </div>
                <span className="text-xs text-zinc-500">
                  {token.lastUsedAt
                    ? t("settings.usedOn", { date: date(token.lastUsedAt) })
                    : t("settings.neverUsed")}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => revokeToken.mutate(token.id)}
                  disabled={revokeToken.isPending}
                >
                  {t("settings.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">{t("settings.noTokens")}</p>
        )}
      </Card>

      <Card title={t("settings.dataTitle")} description={t("settings.dataDescription")}>
        <ul className="space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>· {t("settings.dataDb")}</li>
          <li>· {t("settings.dataSecret")}</li>
          <li>· {t("settings.dataBackup")}</li>
        </ul>
      </Card>
    </div>
  );
}
