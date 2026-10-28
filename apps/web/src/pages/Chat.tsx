import type { AgentEvent, PendingConfirmation } from "@plexus/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, Spinner, cx } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useErrorText } from "@/lib/i18n-ui";
import {
  agentKeys,
  useAgentHistory,
  useAgentStatus,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from "@/lib/queries";

interface ChatItem {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  toolName?: string | null;
}

const SELECTED_KEY = "plexus.chat.conversation";

async function streamAgent(
  path: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-requested-with": "plexus" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError(payload?.error?.message ?? "Request failed", res.status, "request_failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as AgentEvent);
      } catch {
        // ignore malformed frames
      }
    }
  }
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const { t, lang } = useI18n();
  const errorText = useErrorText();

  const status = useAgentStatus();
  const conversations = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem(SELECTED_KEY),
  );
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoCreated = useRef(false);

  const list = conversations.data?.conversations ?? [];
  const active = useMemo(
    () => list.find((conversation) => conversation.id === selectedId) ?? null,
    [list, selectedId],
  );

  const history = useAgentHistory(selectedId);

  // Pick a conversation (or create the first one).
  useEffect(() => {
    if (!conversations.data) return;
    if (selectedId && list.some((conversation) => conversation.id === selectedId)) return;
    if (list[0]) {
      setSelectedId(list[0].id);
      return;
    }
    if (!autoCreated.current && !createConversation.isPending) {
      autoCreated.current = true;
      void createConversation.mutateAsync().then((result) => {
        setSelectedId(result.conversation.id);
      });
    }
  }, [conversations.data, list, selectedId, createConversation]);

  useEffect(() => {
    if (!selectedId) return;
    window.localStorage.setItem(SELECTED_KEY, selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!history.data) return;
    setItems(
      history.data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        toolName: message.toolName,
      })),
    );
    setPending(history.data.pending);
    setStreamingText("");
  }, [history.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, streamingText, streaming]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  function applyEvent(event: AgentEvent) {
    if (event.type === "assistant_delta") {
      setStreamingText((prev) => prev + event.text);
    } else if (event.type === "assistant") {
      setItems((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: event.text }]);
      setStreamingText("");
    } else if (event.type === "tool_result") {
      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "tool", text: event.preview, toolName: event.name },
      ]);
    } else if (event.type === "confirm_request") {
      setPending({
        pendingId: event.pendingId,
        name: event.name,
        args: event.args,
        createdAt: new Date().toISOString(),
      });
    } else if (event.type === "error") {
      setItems((prev) => [...prev, { id: crypto.randomUUID(), role: "error", text: event.message }]);
      setStreaming(false);
      setStreamingText("");
    } else if (event.type === "done") {
      setStreaming(false);
      setStreamingText("");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming || pending || !selectedId) return;
    setInput("");
    setItems((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);
    setStreaming(true);
    setStreamingText("");
    try {
      await streamAgent(
        "/api/agent/chat",
        { conversationId: selectedId, message: text },
        applyEvent,
      );
    } catch (err) {
      setItems((prev) => [...prev, { id: crypto.randomUUID(), role: "error", text: errorText(err) }]);
    } finally {
      setStreaming(false);
      void queryClient.invalidateQueries({ queryKey: agentKeys.conversations });
    }
  }

  async function resolve(approved: boolean) {
    if (!pending || streaming) return;
    const current = pending;
    setPending(null);
    setStreaming(true);
    setStreamingText("");
    try {
      await streamAgent("/api/agent/confirm", { pendingId: current.pendingId, approved }, applyEvent);
    } catch (err) {
      setItems((prev) => [...prev, { id: crypto.randomUUID(), role: "error", text: errorText(err) }]);
    } finally {
      setStreaming(false);
      void queryClient.invalidateQueries({ queryKey: agentKeys.conversations });
    }
  }

  async function newConversation() {
    const result = await createConversation.mutateAsync();
    setSelectedId(result.conversation.id);
  }

  async function removeConversation(id: string) {
    setConfirmingDelete(null);
    await deleteConversation.mutateAsync(id);
    if (id === selectedId) {
      setSelectedId(null);
      setItems([]);
      setPending(null);
    }
  }

  if (status.data && !status.data.enabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("chat.title")}</h1>
        <Card title={t("chat.notConfigured")} description={status.data.reason}>
          <p className="text-sm text-zinc-500">{t("chat.restart")}</p>
          <Link to="/settings" className="mt-4 inline-block">
            <Button>{t("settings.openSettings")}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="hidden w-56 shrink-0 flex-col md:flex">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t("chat.conversations")}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void newConversation()}>
            {t("chat.new")}
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {list.map((conversation) => {
            const isActive = conversation.id === selectedId;
            return (
              <div
                key={conversation.id}
                className={cx(
                  "group rounded-lg px-2 py-1.5 text-sm transition",
                  isActive
                    ? "bg-zinc-200/70 dark:bg-zinc-800/70"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-900/60",
                )}
              >
                {confirmingDelete === conversation.id ? (
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-500">{t("chat.confirmDelete")}</p>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void removeConversation(conversation.id)}
                      >
                        {t("chat.delete")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedId(conversation.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate font-medium">{conversation.title}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {conversation.messageCount} · {when(conversation.updatedAt)}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={t("chat.delete")}
                      onClick={() => setConfirmingDelete(conversation.id)}
                      className="opacity-0 transition group-hover:opacity-100"
                    >
                      <span className="px-1 text-zinc-400 hover:text-rose-500">×</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {active?.title ?? t("chat.title")}
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              {status.data
                ? t("chat.meta", { provider: status.data.provider, model: status.data.model })
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedId ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              className="max-w-40 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs md:hidden dark:border-zinc-700 dark:bg-zinc-950/60"
              aria-label={t("chat.select")}
            >
              {list.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                </option>
              ))}
            </select>
            <Link to="/chat/prompt">
              <Button variant="outline" size="sm">
                {t("chat.prompt")}
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => void newConversation()}
            >
              {t("chat.new")}
            </Button>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800/80 dark:bg-zinc-900/30"
        >
          {items.length === 0 && !streamingText ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm font-medium">{t("chat.emptyTitle")}</p>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">{t("chat.emptyDescription")}</p>
            </div>
          ) : null}

          {items.map((item) => {
            if (item.role === "tool") {
              return (
                <div
                  key={item.id}
                  className="rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900/60"
                >
                  <span className="font-mono text-zinc-500">{item.toolName ?? "tool"}</span>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-zinc-600 dark:text-zinc-300">
                    {item.text}
                  </pre>
                </div>
              );
            }
            if (item.role === "error") {
              return (
                <div
                  key={item.id}
                  className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  {item.text}
                </div>
              );
            }
            const mine = item.role === "user";
            return (
              <div key={item.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    mine
                      ? "max-w-[85%] rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm text-white"
                      : "max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm dark:bg-zinc-800"
                  }
                >
                  {mine ? (
                    <p className="whitespace-pre-wrap">{item.text}</p>
                  ) : (
                    <Markdown>{item.text}</Markdown>
                  )}
                </div>
              </div>
            );
          })}

          {streamingText ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm dark:bg-zinc-800">
                <Markdown>{streamingText}</Markdown>
              </div>
            </div>
          ) : null}

          {pending ? (
            <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                <Badge tone="amber">{t("common.write")}</Badge>
                {pending.name}
              </p>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-white/60 p-2 text-xs dark:bg-zinc-950/40">
                {JSON.stringify(pending.args, null, 2)}
              </pre>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void resolve(true)} disabled={streaming}>
                  {t("chat.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void resolve(false)}
                  disabled={streaming}
                >
                  {t("chat.reject")}
                </Button>
              </div>
            </div>
          ) : null}

          {streaming ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Spinner /> {t("chat.working")}
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("chat.placeholder")}
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950/60"
            disabled={streaming || Boolean(pending)}
          />
          <Button type="submit" disabled={streaming || Boolean(pending) || !input.trim()}>
            {t("chat.send")}
          </Button>
        </form>
      </section>
    </div>
  );
}
