import type { Rule } from "@/lib/api";

/** One plain sentence for a rule, e.g. Comments with “price” → AI reply + private DM */
export function describeRule(r: Rule): string {
  const what = r.trigger === "DM" ? "DMs" : "Comments";
  const where = r.trigger === "COMMENT" ? (r.mediaIds?.length ? ` on ${r.mediaIds.length} chosen post${r.mediaIds.length === 1 ? "" : "s"}` : "") : "";
  const when = r.matchType === "ANY" ? (r.trigger === "DM" ? "All DMs" : "All comments") : `${what} with ${r.keywords.map((k) => `“${k}”`).join(", ")}`;
  const acts = [
    r.deleteComment && "delete it",
    r.hideComment && "hide it",
    r.likeComment && "like",
    r.aiReply && "AI reply",
    !r.aiReply && !r.hideComment && !r.deleteComment && r.replyTemplates.length && "reply",
    r.privateReplyTemplates.length && "private DM",
    r.quickReplies?.length && "buttons",
  ].filter(Boolean);
  return `${when}${where} → ${acts.join(" + ")}`;
}
