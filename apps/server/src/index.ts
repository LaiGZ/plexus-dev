import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { applyPragmas, closeDb } from "./infra/db/client.js";
import { runMigrations } from "./infra/db/migrate.js";
import { seed } from "./infra/db/seed.js";
import { logger } from "./infra/logger.js";

async function main(): Promise<void> {
  await applyPragmas();
  await runMigrations();
  await seed();

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info(
      {
        host: config.host,
        port: info.port,
        version: config.version,
        dataDir: config.dataDir,
        database: config.databaseFile,
        web: config.webDist ? "bundled" : "dev-server",
      },
      "plexus listening",
    );
    if (config.host !== "127.0.0.1" && config.host !== "localhost") {
      logger.warn(
        { host: config.host, cookieSecure: config.cookieSecure },
        "listening on a non-loopback address — put HTTPS in front and set COOKIE_SECURE=true",
      );
    }
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
