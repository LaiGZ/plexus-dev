import { useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, Field, Mark } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "@/lib/i18n-ui";

export function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [username, setUsername] = useState("plexus");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await router.navigate({ to: "/" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t("login.invalid"));
      } else {
        setError(err instanceof ApiError ? err.message : t("common.unknownError"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="backdrop-grid relative flex min-h-full items-center justify-center px-6 py-16">
      <div className="absolute right-5 top-5">
        <LanguageToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-2.5">
          <Mark className="h-6 w-6 text-emerald-500" />
          <span className="text-lg font-semibold tracking-tight">plexus</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("login.subtitle")}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field
            label={t("login.username")}
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Field
            label={t("login.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            error={error ?? undefined}
          />

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("login.submitting") : t("login.submit")}
          </Button>
        </form>

        <p className="mt-8 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
          {t("login.hint")}
        </p>
      </div>
    </main>
  );
}
