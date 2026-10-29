import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Never log tokens / secrets
  redact: {
    paths: ["accessToken", "access_token", "token", "*.accessToken", "*.access_token", "req.headers.cookie"],
    censor: "[redacted]",
  },
});
