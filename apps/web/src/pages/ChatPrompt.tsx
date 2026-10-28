import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, Banner, Button, Card, Spinner, Textarea } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useAgentPrompt, useUpdateAgentPrompt } from "@/lib/queries";

export function ChatPromptPage() {
  const { t } = useI18n();
  const prompt = useAgentPrompt();
  const updatePrompt = useUpdateAgentPrompt();

  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (prompt.data) setValue(prompt.data.systemPrompt);
  }, [prompt.data]);

  async function save(next: string) {
    setSaved(false);
    const result = await updatePrompt.mutateAsync(next);
    setValue(result.systemPrompt);
    setSaved(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/chat" className="text-xs text-zinc-500 hover:underline">
          {t("prompt.back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("prompt.title")}</h1>
          {prompt.data ? (
            <Badge tone={prompt.data.isDefault ? "neutral" : "green"}>
              {prompt.data.isDefault ? t("prompt.defaultBadge") : t("prompt.customBadge")}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("prompt.subtitle")}</p>
      </div>

      {saved ? <Banner>{t("prompt.saved")}</Banner> : null}

      <Card>
        {prompt.isLoading ? (
          <div className="flex justify-center py-8 text-zinc-400">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <Textarea
              label={t("prompt.title")}
              rows={14}
              value={value}
              placeholder={t("prompt.placeholder")}
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save(value)} disabled={updatePrompt.isPending}>
                {updatePrompt.isPending ? <Spinner /> : null}
                {t("prompt.save")}
              </Button>
              <Button variant="outline" onClick={() => void save("")} disabled={updatePrompt.isPending}>
                {t("prompt.reset")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
