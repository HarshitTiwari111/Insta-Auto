/** Weekly / monthly summary: pure counting + text, shared by the worker and tests. No I/O here. */

export interface ReportCounts {
  followersStart: number | null;
  followersEnd: number | null;
  postsPublished: number;
  postsFailed: number;
  commentReplies: number;
  dmReplies: number;
  hiddenOrDeleted: number;
  dmsReceived: number;
}

const REPLY_KINDS = new Set(["comment.reply", "comment.manual_reply"]);
const DM_REPLY_KINDS = new Set(["dm.reply", "dm.manual", "dm.flow", "comment.private_reply"]);
const MODERATION_KINDS = new Set(["comment.hide", "comment.delete", "comment.ai_spam", "comment.blocked_hide"]);

export function countActivity(kinds: string[]): Pick<ReportCounts, "postsPublished" | "postsFailed" | "commentReplies" | "dmReplies" | "hiddenOrDeleted"> {
  let postsPublished = 0;
  let postsFailed = 0;
  let commentReplies = 0;
  let dmReplies = 0;
  let hiddenOrDeleted = 0;
  for (const k of kinds) {
    if (k === "post.published") postsPublished++;
    else if (k === "post.failed") postsFailed++;
    else if (REPLY_KINDS.has(k)) commentReplies++;
    else if (DM_REPLY_KINDS.has(k)) dmReplies++;
    else if (MODERATION_KINDS.has(k)) hiddenOrDeleted++;
  }
  return { postsPublished, postsFailed, commentReplies, dmReplies, hiddenOrDeleted };
}

/** One short line for a push notification / activity log. */
export function reportText(period: "weekly" | "monthly", c: ReportCounts): string {
  const parts: string[] = [];
  if (c.followersEnd !== null) {
    const diff = c.followersStart === null ? null : c.followersEnd - c.followersStart;
    parts.push(`${c.followersEnd} followers${diff === null ? "" : ` (${diff >= 0 ? "+" : ""}${diff})`}`);
  }
  parts.push(`${c.postsPublished} posts${c.postsFailed ? ` (${c.postsFailed} failed)` : ""}`);
  parts.push(`${c.commentReplies} comment replies`);
  parts.push(`${c.dmReplies} DM replies`);
  if (c.dmsReceived) parts.push(`${c.dmsReceived} DMs received`);
  if (c.hiddenOrDeleted) parts.push(`${c.hiddenOrDeleted} spam hidden/deleted`);
  return `${period === "weekly" ? "Last 7 days" : "Last month"}: ${parts.join(" · ")}`;
}
