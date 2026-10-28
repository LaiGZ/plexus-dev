import { useState } from "react";
import { Card, CodeBlock, Tabs } from "./ui";
import { useI18n } from "@/lib/i18n";

type Client = "claude" | "cursor" | "vscode" | "curl";

export function ClientConfig({ endpoint }: { endpoint: string }) {
  const { t } = useI18n();
  const [client, setClient] = useState<Client>("claude");

  const headers = { Authorization: "Bearer <YOUR_TOKEN>" };
  const server = {
    claude: JSON.stringify(
      { mcpServers: { plexus: { type: "http", url: endpoint, headers } } },
      null,
      2,
    ),
    cursor: JSON.stringify(
      { mcpServers: { plexus: { type: "http", url: endpoint, headers } } },
      null,
      2,
    ),
    vscode: JSON.stringify(
      { servers: { plexus: { type: "http", url: endpoint, headers } } },
      null,
      2,
    ),
    curl: [
      `curl -sS ${endpoint} \\`,
      `  -H 'content-type: application/json' \\`,
      `  -H 'accept: application/json, text/event-stream' \\`,
      `  -H 'authorization: Bearer <YOUR_TOKEN>' \\`,
      `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    ].join("\n"),
  } as const;

  const fileNames: Record<Client, string> = {
    claude: "claude_desktop_config.json",
    cursor: ".cursor/mcp.json",
    vscode: ".vscode/mcp.json",
    curl: t("common.shell"),
  };

  return (
    <Card title={t("overview.clientTitle")} description={t("overview.clientDescription")}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={client}
            onChange={setClient}
            tabs={[
              { value: "claude", label: t("client.claude") },
              { value: "cursor", label: t("client.cursor") },
              { value: "vscode", label: t("client.vscode") },
              { value: "curl", label: t("client.curl") },
            ]}
          />
          <code className="text-xs text-zinc-500">{fileNames[client]}</code>
        </div>
        <CodeBlock code={server[client]} />
      </div>
    </Card>
  );
}
