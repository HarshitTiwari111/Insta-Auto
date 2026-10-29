import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_URL: z.string().url(),
  API_PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().int().default(4000),
  /**
   * instagram = Business Login for Instagram (Instagram app ID/secret).
   * facebook  = Facebook Login (Facebook app ID/secret, account must be linked to a Facebook Page).
   */
  IG_LOGIN_MODE: z.enum(["instagram", "facebook"]).default("instagram"),
  IG_APP_ID: z.string().min(1),
  IG_APP_SECRET: z.string().min(1),
  IG_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  IG_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  TOKEN_ENC_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "TOKEN_ENC_KEY must be 32 bytes, base64"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:admin@example.com"),
  COMMENT_POLL_MINUTES: z.coerce.number().int().min(0).default(0),
  /** Google Gemini, for AI replies. Empty = AI replies off. */
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().min(1).default("gemini-flash-lite-latest"),
  /** Where uploaded media is stored. Empty = <repo>/uploads */
  UPLOAD_DIR: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validates process.env once. Fails fast with a readable list of what's missing. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
