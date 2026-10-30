/**
 * Minimal client for the Instagram API, either login type:
 *  - Instagram Login: host graph.instagram.com, IG user token, DMs via /<IG_ID>/messages
 *  - Facebook Login:  host graph.facebook.com, Page token, DMs via /<PAGE_ID>/messages
 * Media, comment and publishing endpoints are the same on both hosts.
 * Only endpoints confirmed in Meta's docs are implemented. Docs:
 *  - Comment moderation: https://developers.facebook.com/documentation/instagram-platform/comment-moderation
 *  - Private replies:    https://developers.facebook.com/documentation/instagram-platform/private-replies
 *  - Messaging:          https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api
 *  - Publishing:         https://developers.facebook.com/documentation/instagram-platform/content-publishing
 *  - Webhooks setup:     https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
 */

export const IG_HOST = "https://graph.instagram.com";
export const FB_HOST = "https://graph.facebook.com";

export class IgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "IgApiError";
  }
  /** Graph API throttling codes (4 app, 17 user, 32 page, 613 custom) or HTTP 429 */
  get isRateLimit(): boolean {
    return this.status === 429 || [4, 17, 32, 613].includes(this.code ?? -1);
  }
  /** 190 = invalid / expired access token */
  get isAuthError(): boolean {
    return this.code === 190;
  }
}

type Params = Record<string, string | number | boolean | undefined>;

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  /** FEED, REELS or STORY */
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export interface IgComment {
  id: string;
  text?: string;
  hidden?: boolean;
  like_count?: number;
  timestamp?: string;
  username?: string;
  from?: { id: string; username?: string };
  parent_id?: string;
}

export interface IgProfile {
  id: string;
  username?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export interface IgMe {
  /** Instagram professional account ID (used by media endpoints and webhooks) */
  user_id?: string;
  /** App-scoped ID */
  id?: string;
  username?: string;
  account_type?: string;
  profile_picture_url?: string;
}

export type ContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

export class IgClient {
  constructor(
    private readonly accessToken: string,
    /** Instagram professional account ID */
    readonly igUserId: string,
    private readonly version = "v26.0",
    /** Facebook Login only: the linked Page. Its presence switches host + messaging path. */
    readonly pageId?: string,
  ) {}

  private get host() {
    return this.pageId ? FB_HOST : IG_HOST;
  }

  /** Messaging goes through the Page with Facebook Login, through the IG account otherwise. */
  private get messagesPath() {
    return `${this.pageId ?? this.igUserId}/messages`;
  }

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, json?: unknown): Promise<T> {
    const url = new URL(`${this.host}/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    const body = text ? safeJson(text) : {};
    if (!res.ok || (body && typeof body === "object" && "error" in body)) {
      const e = (body as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } }).error;
      throw new IgApiError(e?.message ?? `HTTP ${res.status}`, res.status, e?.code, e?.error_subcode, e?.fbtrace_id);
    }
    return body as T;
  }

  // ---------- Account ----------

  async me(): Promise<IgMe> {
    const raw = await this.request<IgMe & { data?: IgMe[] }>("GET", "me", {
      fields: "user_id,username,account_type,profile_picture_url",
    });
    // Docs example wraps the result in a `data` array; handle both shapes.
    return Array.isArray(raw.data) && raw.data[0] ? raw.data[0] : raw;
  }

  /**
   * Enable webhook notifications for this account.
   * Facebook Login: the subscription is on the linked Page and takes Page field names, not the
   * Instagram ones: `messages` (Instagram DMs, needs pages_messaging) + `feed`. Without
   * pages_messaging the Page can only take `feed`: comments still work through polling, DMs don't.
   */
  async subscribeWebhooks(fields: string[]) {
    if (!this.pageId) {
      return this.request<{ success: boolean }>("POST", `${this.igUserId}/subscribed_apps`, {
        subscribed_fields: fields.join(","),
      });
    }
    try {
      return await this.request<{ success: boolean }>("POST", `${this.pageId}/subscribed_apps`, {
        subscribed_fields: "feed,messages",
      });
    } catch (err) {
      if (!(err instanceof IgApiError) || err.isAuthError) throw err;
      return this.request<{ success: boolean }>("POST", `${this.pageId}/subscribed_apps`, { subscribed_fields: "feed" });
    }
  }

  /** Public profile counters (works with both login types and basic permission). */
  profile() {
    return this.request<IgProfile>("GET", this.igUserId, { fields: "id,username,followers_count,follows_count,media_count" });
  }

  // ---------- Media & comments ----------

  listMedia(limit = 25) {
    return this.request<{ data: IgMedia[] }>("GET", `${this.igUserId}/media`, {
      fields: MEDIA_FIELDS,
      limit,
    });
  }

  /** Every post/reel on the account (follows cursor paging; capped so a huge account can't run forever). */
  async listAllMedia(max = 1000): Promise<IgMedia[]> {
    const out: IgMedia[] = [];
    let after: string | undefined;
    do {
      const page = await this.request<{ data: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        "GET",
        `${this.igUserId}/media`,
        { fields: MEDIA_FIELDS, limit: 100, after },
      );
      out.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
    } while (after && out.length < max);
    return out.slice(0, max);
  }

  /** Comment counts for specific posts in one request (`?ids=`). */
  commentCounts(mediaIds: string[]) {
    return this.request<Record<string, { id: string; comments_count?: number }>>("GET", "", {
      ids: mediaIds.join(","),
      fields: "id,comments_count",
    });
  }

  listComments(mediaId: string, limit = 50) {
    return this.request<{ data: IgComment[] }>("GET", `${mediaId}/comments`, {
      fields: "id,text,timestamp,username,from,parent_id,hidden,like_count",
      limit,
    });
  }

  /** Top-level comments plus their replies (our own auto-replies live there). */
  listCommentsWithReplies(mediaId: string, limit = 50) {
    return this.request<{ data: (IgComment & { replies?: { data: IgComment[] } })[] }>("GET", `${mediaId}/comments`, {
      fields: "id,text,timestamp,username,from,hidden,like_count,replies{id,text,timestamp,username,from,hidden,like_count}",
      limit,
    });
  }

  replyToComment(commentId: string, message: string) {
    return this.request<{ id: string }>("POST", `${commentId}/replies`, { message });
  }

  setCommentHidden(commentId: string, hide: boolean) {
    return this.request<{ success: boolean }>("POST", commentId, { hide });
  }

  /** Comment on our own media (used for the "first comment" with hashtags). */
  commentOnMedia(mediaId: string, message: string) {
    return this.request<{ id: string }>("POST", `${mediaId}/comments`, { message });
  }

  deleteComment(commentId: string) {
    return this.request<{ success: boolean }>("DELETE", commentId);
  }

  /**
   * Remove a published post / reel / story / whole carousel from Instagram.
   * Facebook Login only, needs the instagram_manage_contents permission (Meta, Dec 2025).
   */
  deleteMedia(mediaId: string) {
    return this.request<{ success: boolean }>("DELETE", mediaId);
  }

  // ---------- Messaging ----------

  /**
   * Text DM. Only allowed inside the messaging window opened by the user. Max 1000 bytes.
   * Optional quick reply buttons (max 13, title max 20 chars); a tap comes back as a message with that text.
   */
  sendText(igsid: string, text: string, quickReplies: string[] = []) {
    const buttons = quickReplies
      .map((t) => t.trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 13)
      .map((title) => ({ content_type: "text", title, payload: title }));
    return this.request<{ recipient_id: string; message_id: string }>("POST", this.messagesPath, {}, {
      recipient: { id: igsid },
      message: buttons.length ? { text, quick_replies: buttons } : { text },
    });
  }

  /** Username of someone who messaged us (User Profile API; only works for people in a conversation). */
  userProfile(igsid: string) {
    return this.request<{ id: string; username?: string; name?: string }>("GET", igsid, { fields: "username,name" });
  }

  /** Photo or video DM (sent as its own message, after the text). The URL must be public. */
  sendMedia(igsid: string, url: string, kind: "image" | "video") {
    return this.request<{ recipient_id: string; message_id: string }>("POST", this.messagesPath, {}, {
      recipient: { id: igsid },
      message: { attachment: { type: kind, payload: { url } } },
    });
  }

  /**
   * Public numbers of another Business/Creator account (Business Discovery).
   * Facebook Login only (graph.facebook.com).
   */
  businessDiscovery(username: string) {
    const u = username.replace(/^@/, "").trim();
    return this.request<{
      business_discovery?: {
        username: string;
        name?: string;
        followers_count?: number;
        media_count?: number;
        profile_picture_url?: string;
        media?: { data: IgMedia[] };
      };
    }>("GET", this.igUserId, {
      fields: `business_discovery.username(${u}){username,name,followers_count,media_count,profile_picture_url,media.limit(12){id,caption,media_type,like_count,comments_count,timestamp,permalink}}`,
    });
  }

  /** One private DM to the author of a comment (within 7 days of the comment). */
  privateReply(commentId: string, text: string) {
    return this.request<{ recipient_id: string; message_id: string }>("POST", this.messagesPath, {}, {
      recipient: { comment_id: commentId },
      message: { text },
    });
  }

  // ---------- Publishing ----------

  createContainer(params: Params) {
    return this.request<{ id: string }>("POST", `${this.igUserId}/media`, params);
  }

  containerStatus(containerId: string) {
    return this.request<{ status_code: ContainerStatus; id: string }>("GET", containerId, { fields: "status_code" });
  }

  publishContainer(creationId: string) {
    return this.request<{ id: string }>("POST", `${this.igUserId}/media_publish`, { creation_id: creationId });
  }

  /** Current publishing quota. Docs mention 100 and 50 in different places, so read it live. */
  publishingLimit() {
    return this.request<{ data: { quota_usage: number; config?: { quota_total: number; quota_duration: number } }[] }>(
      "GET",
      `${this.igUserId}/content_publishing_limit`,
      { fields: "config,quota_usage" },
    );
  }
}

/** Client for a stored account row (token already decrypted by the caller). */
export function clientForAccount(
  acc: { igUserId: string; authType: "INSTAGRAM" | "FACEBOOK"; pageId: string | null },
  accessToken: string,
  version: string,
): IgClient {
  return new IgClient(accessToken, acc.igUserId, version, acc.authType === "FACEBOOK" ? acc.pageId ?? undefined : undefined);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Meta limits DM text to 1000 bytes (UTF-8). Trim safely at a character boundary. */
export function clampUtf8(text: string, maxBytes = 1000): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  let out = "";
  for (const ch of text) {
    if (enc.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}
