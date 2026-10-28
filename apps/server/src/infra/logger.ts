import { pino } from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "plexus" },
  redact: {
    paths: ["*.password", "*.passwordHash", "*.authorization", "req.headers.cookie"],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
