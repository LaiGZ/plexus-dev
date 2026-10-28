import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_FILE: ":memory:",
      DATA_DIR: "./.tmp/test",
      LOG_LEVEL: "silent",
      PLEXUS_ADMIN_USERNAME: "plexus",
      PLEXUS_ADMIN_PASSWORD: "test-password-123",
      SESSION_TTL_HOURS: "1",
      EGRESS_ALLOW_HOSTS: "127.0.0.1,localhost",
      RATE_LIMIT_PER_SEC: "1000",
      UPSTREAM_TIMEOUT_MS: "1500",
      MODEL_PROVIDER: "stub",
      AGENT_MAX_STEPS: "4",
      ADMIN_MCP_TOKEN: "test-admin-token-123456",
    },
  },
});
