/**
 * Business Login for Instagram.
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
 */

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
  "instagram_business_content_publish",
] as const;

export function buildAuthorizeUrl(opts: { appId: string; redirectUri: string; state: string }): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", opts.appId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", opts.state);
  return u.toString();
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || "error" in body || "error_message" in body) {
    const msg =
      (body.error as { message?: string } | undefined)?.message ??
      (body.error_message as string | undefined) ??
      `HTTP ${res.status}`;
    throw new Error(`Instagram OAuth error: ${msg}`);
  }
  return body;
}

/** Step 2: code -> short-lived token (valid 1 hour). Code is single-use, valid 1 hour. */
export async function exchangeCode(opts: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ accessToken: string; userId: string; permissions: string[] }> {
  const form = new URLSearchParams({
    client_id: opts.appId,
    client_secret: opts.appSecret,
    grant_type: "authorization_code",
    redirect_uri: opts.redirectUri,
    code: opts.code.replace(/#_$/, ""), // docs: strip trailing "#_"
  });
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(res);
  // Docs describe a `data` array; handle a flat object too.
  const row = (Array.isArray(body.data) ? body.data[0] : body) as Record<string, unknown>;
  const perms = row.permissions;
  return {
    accessToken: String(row.access_token),
    userId: String(row.user_id),
    permissions: Array.isArray(perms) ? perms.map(String) : String(perms ?? "").split(",").filter(Boolean),
  };
}

export interface LongLivedToken {
  accessToken: string;
  expiresAt: Date;
}

/** Step 3: short-lived -> long-lived (~60 days). Server-side only. */
export async function exchangeLongLived(opts: { appSecret: string; shortToken: string }): Promise<LongLivedToken> {
  const u = new URL("https://graph.instagram.com/access_token");
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", opts.appSecret);
  u.searchParams.set("access_token", opts.shortToken);
  const body = await readJson(await fetch(u, { signal: AbortSignal.timeout(30_000) }));
  return { accessToken: String(body.access_token), expiresAt: new Date(Date.now() + Number(body.expires_in) * 1000) };
}

/**
 * Refresh a long-lived token. Conditions (docs): token at least 24h old, not expired,
 * and instagram_business_basic granted. Unrefreshed tokens expire after 60 days.
 */
export async function refreshLongLived(token: string): Promise<LongLivedToken> {
  const u = new URL("https://graph.instagram.com/refresh_access_token");
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  const body = await readJson(await fetch(u, { signal: AbortSignal.timeout(30_000) }));
  return { accessToken: String(body.access_token), expiresAt: new Date(Date.now() + Number(body.expires_in) * 1000) };
}
