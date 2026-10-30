/** All calls go through Next's /api rewrite -> API server (same-origin cookie). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login";
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

// ---------- Types (mirror of API responses) ----------

export interface Account {
  id: string;
  igUserId: string;
  username: string;
  accountType: string | null;
  authType: "INSTAGRAM" | "FACEBOOK";
  profilePictureUrl: string | null;
  tokenExpiresAt: string;
  paused: boolean;
  dailyActionLimit: number;
  hourlyActionLimit: number;
  workStartHour: number | null;
  workEndHour: number | null;
  timezone: string;
  aiSpamFilter: boolean;
  replySpeed: "fast" | "medium" | "slow";
  blocklist: string[];
  blocklistHide: boolean;
  webhooksSubscribed: boolean;
  actionsToday: number;
}

export interface Rule {
  id: string;
  accountId: string;
  name: string;
  enabled: boolean;
  trigger: "COMMENT" | "DM";
  matchType: "ANY" | "KEYWORD";
  keywords: string[];
  mediaIds: string[];
  replyTemplates: string[];
  privateReplyTemplates: string[];
  hideComment: boolean;
  deleteComment: boolean;
  quickReplies: string[];
  replyMediaUrl: string | null;
  aiReply: boolean;
  aiInstructions: string | null;
  priority: number;
}

export interface Post {
  id: string;
  accountId: string;
  type: "IMAGE" | "REELS" | "STORY" | "CAROUSEL";
  mediaUrls: string[];
  caption: string | null;
  firstComment: string | null;
  scheduledAt: string;
  status: "DRAFT" | "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";
  igMediaId: string | null;
  error: string | null;
}

export interface Activity {
  id: string;
  accountId: string | null;
  kind: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  account: { username: string } | null;
}

export interface DmMessage {
  id: string;
  igsid: string;
  username: string | null;
  direction: "IN" | "OUT";
  text: string | null;
  createdAt: string;
}

export interface Media {
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

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
