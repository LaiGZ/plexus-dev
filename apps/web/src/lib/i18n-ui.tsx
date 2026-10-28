import { ApiError } from "@/lib/api";
import { isMessageKey, useI18n } from "@/lib/i18n";
import { cx } from "@/components/ui";

/**
 * Deliberately unobtrusive: a small text button in the far corner.
 * Shows the language you would switch to, not the current one.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();

  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "zh" : "en")}
      title={lang === "en" ? "切换到中文" : "Switch to English"}
      aria-label="Switch language"
      className={cx(
        "rounded px-1 py-0.5 text-[11px] font-medium tracking-wide text-zinc-400 transition",
        "hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300",
        className,
      )}
    >
      {lang === "en" ? "中文" : "EN"}
    </button>
  );
}

/** Localize a server error by its stable code, falling back to its message. */
export function useErrorText(): (err: unknown) => string {
  const { t } = useI18n();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = `error.${err.code}`;
      if (isMessageKey(key)) return t(key);
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return t("common.unknownError");
  };
}
