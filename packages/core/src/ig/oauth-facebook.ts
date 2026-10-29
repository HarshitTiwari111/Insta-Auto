/**
 * Facebook Login for the Instagram API (account linked to a Facebook Page).
 * Used while Meta's dashboard does not offer "API setup with Instagram login" for new apps.
 *  - Login + tokens:  https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 *  - IG messaging:    https://developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started
 *  - Webhooks:        https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
 */

import { FB_HOST } from "./client.js";

export const FB_SCOPES = [
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  /** Needed to subscribe the Page to the `messages` webhook field (Instagram DMs arrive through it) */
  "pages_messaging",
  "business_management",
] as const;

export function buildFacebookAuthorizeUrl(opts: { appId: string; redirectUri: string; state: string; version: string }): string {
  const u = new URL(`https://www.facebook.com/${opts.version}/dialog/oauth`);
  u.searchParams.set("client_id", opts.appId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", FB_SCOPES.join(","));
  u.searchParams.set("state", opts.state);
  return u.toString();
}

async function getJson(url: URL): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || "error" in body) {
    const msg = (body.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new Error(`Facebook OAuth error: ${msg}`);
  }
  return body;
}

/** code -> short-lived user token -> long-lived user token (~60 days). */
export async function exchangeFacebookCode(opts: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  version: string;
}): Promise<string> {
  const short = new URL(`${FB_HOST}/${opts.version}/oauth/access_token`);
  short.searchParams.set("client_id", opts.appId);
  short.searchParams.set("client_secret", opts.appSecret);
  short.searchParams.set("redirect_uri", opts.redirectUri);
  short.searchParams.set("code", opts.code);
  const s = await getJson(short);

  const long = new URL(`${FB_HOST}/${opts.version}/oauth/access_token`);
  long.searchParams.set("grant_type", "fb_exchange_token");
  long.searchParams.set("client_id", opts.appId);
  long.searchParams.set("client_secret", opts.appSecret);
  long.searchParams.set("fb_exchange_token", String(s.access_token));
  const l = await getJson(long);
  return String(l.access_token);
}

export interface LinkedInstagramPage {
  pageId: string;
  pageName: string;
  /** Page token. Taken from a long-lived user token, so it has no expiry date. */
  pageAccessToken: string;
  igUserId: string;
  username: string;
  profilePictureUrl: string | null;
}

/** Pages the user granted, keeping only those linked to an Instagram professional account. */
export async function listLinkedInstagramPages(userToken: string, version: string): Promise<LinkedInstagramPage[]> {
  const u = new URL(`${FB_HOST}/${version}/me/accounts`);
  u.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username,profile_picture_url}");
  u.searchParams.set("limit", "100");
  u.searchParams.set("access_token", userToken);
  const body = await getJson(u);
  const rows = (body.data ?? []) as {
    id: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
  }[];
  return rows
    .filter((p) => p.access_token && p.instagram_business_account?.id)
    .map((p) => ({
      pageId: p.id,
      pageName: p.name ?? p.id,
      pageAccessToken: p.access_token!,
      igUserId: p.instagram_business_account!.id,
      username: p.instagram_business_account!.username ?? "unknown",
      profilePictureUrl: p.instagram_business_account!.profile_picture_url ?? null,
    }));
}

/** Page tokens from a long-lived user token don't expire; store a far date so refresh jobs skip them. */
export const NO_EXPIRY = new Date("2100-01-01T00:00:00Z");
