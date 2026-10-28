import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddToolInput,
  AgentHistory,
  AgentModelConfig,
  AgentPrompt,
  AgentStatus,
  ConversationList,
  ConversationResult,
  CreateSourceInput,
  CreateTokenInput,
  CreateTokenResult,
  ImportDiff,
  InvocationPage,
  InvocationQuery,
  PreviewResult,
  PreviewSourceInput,
  SourceDetail,
  SourceList,
  StatsResponse,
  TemplatePreview,
  TestModelResult,
  TokenList,
  ToolList,
  ToolSummary,
  ToolUsage,
  UpdateAgentModelInput,
  UpdateToolInput,
} from "@plexus/contracts";
import { api } from "./api";

export const keys = {
  sources: ["sources"] as const,
  source: (id: string) => ["sources", id] as const,
  tools: ["tools"] as const,
  tokens: ["tokens"] as const,
  stats: ["stats"] as const,
  invocations: (filter: Record<string, unknown>) => ["invocations", filter] as const,
};

export function useSources() {
  return useQuery({
    queryKey: keys.sources,
    queryFn: () => api<SourceList>("/api/sources"),
  });
}

export function useSource(id: string | undefined) {
  return useQuery({
    queryKey: keys.source(id ?? ""),
    queryFn: () => api<SourceDetail>(`/api/sources/${id}`),
    enabled: Boolean(id),
  });
}

export function useStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: () => api<StatsResponse>("/api/stats"),
  });
}

export function useTokens() {
  return useQuery({
    queryKey: keys.tokens,
    queryFn: () => api<TokenList>("/api/tokens"),
  });
}

export function useInvocations(filter: InvocationQuery) {
  const params = new URLSearchParams();
  params.set("limit", String(filter.limit));
  if (filter.toolId) params.set("toolId", filter.toolId);
  if (filter.sourceId) params.set("sourceId", filter.sourceId);
  if (filter.status) params.set("status", filter.status);
  if (filter.actorType) params.set("actorType", filter.actorType);

  return useQuery({
    queryKey: keys.invocations({ ...filter }),
    queryFn: () => api<InvocationPage>(`/api/invocations?${params.toString()}`),
    refetchInterval: 10_000,
  });
}

export function usePreviewSource() {
  return useMutation({
    mutationFn: (input: PreviewSourceInput) =>
      api<PreviewResult>("/api/sources/preview", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useTemplatePreview() {
  return useMutation({
    mutationFn: (text: string) =>
      api<TemplatePreview>("/api/templates/app/preview", {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSourceInput) =>
      api<{ source: SourceDetail["source"]; tools: ToolSummary[] }>("/api/sources", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
      void queryClient.invalidateQueries({ queryKey: keys.tools });
    },
  });
}

export function useUpdateTool(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateToolInput }) =>
      api<{ tool: ToolSummary }>(`/api/tools/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.source(sourceId) });
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useAddTool(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddToolInput) =>
      api<{ tool: ToolSummary }>(`/api/sources/${sourceId}/tools`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.source(sourceId) });
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.tools });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTokenInput) =>
      api<CreateTokenResult>("/api/tokens", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tokens });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tokens });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useTools(sourceId?: string) {
  const params = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";
  return useQuery({
    queryKey: [...keys.tools, sourceId ?? "all"],
    queryFn: () => api<ToolList>(`/api/tools${params}`),
  });
}

// ── Assistant ───────────────────────────────────────────────────────────

export const agentKeys = {
  status: ["agent", "status"] as const,
  conversations: ["agent", "conversations"] as const,
  history: (id: string) => ["agent", "history", id] as const,
  prompt: ["agent", "prompt"] as const,
  model: ["agent", "model"] as const,
};

export function useAgentStatus() {
  return useQuery({
    queryKey: agentKeys.status,
    queryFn: () => api<AgentStatus>("/api/agent/status"),
  });
}

export function useConversations() {
  return useQuery({
    queryKey: agentKeys.conversations,
    queryFn: () => api<ConversationList>("/api/agent/conversations"),
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<ConversationResult>("/api/agent/conversations", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.conversations });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/agent/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.conversations });
    },
  });
}

export function useAgentHistory(conversationId: string | null) {
  return useQuery({
    queryKey: agentKeys.history(conversationId ?? "none"),
    queryFn: () => api<AgentHistory>(`/api/agent/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
  });
}

export function useAgentPrompt() {
  return useQuery({
    queryKey: agentKeys.prompt,
    queryFn: () => api<AgentPrompt>("/api/agent/prompt"),
  });
}

export function useUpdateAgentPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (systemPrompt: string) =>
      api<AgentPrompt>("/api/agent/prompt", {
        method: "PUT",
        body: JSON.stringify({ systemPrompt }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.prompt });
    },
  });
}

export function useModelConfig() {
  return useQuery({
    queryKey: agentKeys.model,
    queryFn: () => api<AgentModelConfig>("/api/agent/model"),
  });
}

export function useUpdateModelConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentModelInput) =>
      api<AgentModelConfig>("/api/agent/model", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.model });
      void queryClient.invalidateQueries({ queryKey: agentKeys.status });
    },
  });
}

export function useTestModel() {
  return useMutation({
    mutationFn: () => api<TestModelResult>("/api/agent/model/test", { method: "POST" }),
  });
}

export function useIssueAppSecret() {
  return useMutation({
    mutationFn: (appId: string) =>
      api<{ appId: string; secret: string; prefix: string }>(
        `/api/gateway/apps/${appId}/secret`,
        { method: "POST" },
      ),
  });
}

export function useAppGrants(appId: string | undefined) {
  return useQuery({
    queryKey: ["app-grants", appId ?? ""],
    queryFn: () => api<{ toolIds: string[] }>(`/api/sources/${appId}/grants`),
    enabled: Boolean(appId),
  });
}

export function useUpdateAppGrants(appId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toolIds: string[]) =>
      api<{ toolIds: string[] }>(`/api/sources/${appId}/grants`, {
        method: "PUT",
        body: JSON.stringify({ toolIds }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app-grants", appId] });
    },
  });
}

export function useImportPreview(appId: string) {
  return useMutation({
    mutationFn: (text: string) =>
      api<ImportDiff>(`/api/sources/${appId}/import/preview`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
  });
}

export function useApplyImport(appId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; removeMissing: boolean }) =>
      api<{ created: number; updated: number; removed: number }>(
        `/api/sources/${appId}/import`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.source(appId) });
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.tools });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useSyncMcp(appId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ created: unknown[]; skipped: string[] }>(`/api/sources/${appId}/sync`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.source(appId) });
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.tools });
    },
  });
}

export function useToolUsage(toolId: string | null) {
  return useQuery({
    queryKey: ["tool-usage", toolId ?? ""],
    queryFn: () => api<ToolUsage>(`/api/tools/${toolId}/usage`),
    enabled: Boolean(toolId),
  });
}

export function useDeleteTool(appId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => api<void>(`/api/tools/${toolId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.source(appId) });
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.tools });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useUpdateSource(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; baseUrl?: string; enabled?: boolean }) =>
      api<{ source: SourceDetail["source"] }>(`/api/sources/${sourceId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.source(sourceId) });
      void queryClient.invalidateQueries({ queryKey: keys.sources });
    },
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.sources });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}
