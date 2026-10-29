import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature: header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(rawBody, appSecret).
 * https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
 */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type NormalizedEvent =
  | {
      kind: "comment";
      igUserId: string;
      commentId: string;
      text: string;
      fromId?: string;
      fromUsername?: string;
      mediaId?: string;
      parentId?: string;
      source: "webhook" | "poll";
      dedupeKey: string;
    }
  | {
      kind: "message";
      igUserId: string;
      senderId: string;
      recipientId: string;
      mid: string;
      text?: string;
      isEcho: boolean;
      timestamp: number;
      dedupeKey: string;
    }
  | { kind: "other"; igUserId: string; field: string; dedupeKey: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

function commentFrom(igUserId: string, value: Obj): NormalizedEvent | null {
  // Business Login payload uses `id`; Facebook/Unified Login payload uses `comment_id`
  const commentId = str(value.id) ?? str(value.comment_id);
  if (!commentId) return null;
  const from = obj(value.from);
  const media = obj(value.media);
  return {
    kind: "comment",
    igUserId,
    commentId,
    text: str(value.text) ?? "",
    fromId: str(from.id),
    fromUsername: str(from.username),
    mediaId: str(media.id),
    parentId: str(value.parent_id),
    source: "webhook",
    dedupeKey: `comment:${commentId}`,
  };
}

/**
 * Turns one webhook POST body into flat events. Handles both documented shapes:
 *  - entry[].field + entry[].value   (Business Login for Instagram comment example)
 *  - entry[].changes[]               (Facebook / Unified Login)
 *  - entry[].messaging[]             (messages)
 */
export function normalizeWebhook(payload: unknown): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  const bodies = Array.isArray(payload) ? payload : [payload];

  for (const body of bodies) {
    const entries = obj(body).entry;
    if (!Array.isArray(entries)) continue;

    for (const e of entries.map(obj)) {
      const igUserId = str(e.id);
      if (!igUserId) continue;

      const changes: Obj[] = Array.isArray(e.changes)
        ? e.changes.map(obj)
        : typeof e.field === "string"
          ? [{ field: e.field, value: e.value }]
          : [];

      for (const ch of changes) {
        const field = str(ch.field) ?? "unknown";
        const value = obj(ch.value);
        if (field === "comments" || field === "live_comments") {
          const ev = commentFrom(igUserId, value);
          if (ev) out.push(ev);
        } else {
          const hash = createHash("sha256").update(JSON.stringify(ch)).digest("hex").slice(0, 32);
          out.push({ kind: "other", igUserId, field, dedupeKey: `${field}:${hash}` });
        }
      }

      if (Array.isArray(e.messaging)) {
        for (const m of e.messaging.map(obj)) {
          const message = obj(m.message);
          const mid = str(message.mid);
          if (!mid) continue; // reactions, seen, postbacks etc. are ignored for now
          out.push({
            kind: "message",
            igUserId,
            senderId: str(obj(m.sender).id) ?? "",
            recipientId: str(obj(m.recipient).id) ?? "",
            mid,
            text: str(message.text),
            isEcho: message.is_echo === true,
            timestamp: Number(m.timestamp ?? Date.now()),
            dedupeKey: `message:${mid}`,
          });
        }
      }
    }
  }
  return out;
}
