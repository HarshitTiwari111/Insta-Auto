"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/api";
import { ErrorNote, Sheet } from "@/components/ui";
import { Avatar } from "@/components/Avatar";

export interface ViewPost {
  id: string;
  image: string | null;
  /** Plays the video instead of the image when set */
  videoUrl?: string | null;
  caption?: string | null;
  permalink?: string | null;
  likes?: number;
  comments?: number;
  timestamp?: string | null;
}

interface PostComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
  hidden: boolean;
  likes: number;
  /** Replies under this comment (our auto-replies show up here) */
  replies?: PostComment[];
}

/** Instagram-style post view inside the app: media, caption, numbers, and the post's comments with actions. */
export function PostViewer({
  accountId,
  post,
  onClose,
  ownUsername,
  ownPicture,
}: {
  accountId: string;
  post: ViewPost;
  onClose: () => void;
  /** Our Instagram username + photo, shown on our own replies */
  ownUsername?: string;
  ownPicture?: string | null;
}) {
  const qc = useQueryClient();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [text, setText] = useState("");
  /** Comment ids whose replies are expanded ("View N replies") */
  const [openReplies, setOpenReplies] = useState<string[]>([]);
  const key = ["post-comments", accountId, post.id];

  const comments = useQuery({
    queryKey: key,
    queryFn: () => api<PostComment[]>(`/accounts/${accountId}/media/${post.id}/comments`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["comments"] });
  };
  const act = useMutation({
    mutationFn: ({ id, action, hide }: { id: string; action: "hide" | "delete"; hide?: boolean }) =>
      api(`/comments/${id}/${action}`, { method: "POST", json: { accountId, hide } }),
    onSuccess: refresh,
  });
  const reply = useMutation({
    mutationFn: (id: string) => api(`/comments/${id}/reply`, { method: "POST", json: { accountId, message: text } }),
    onSuccess: () => {
      setReplyTo(null);
      setText("");
      refresh();
    },
  });

  /** Instagram-style comment: avatar, "username text" inline, then grey "time  Reply  Hide  Delete". */
  function renderComment(c: PostComment, isReply: boolean) {
    const mine = Boolean(ownUsername && c.username === ownUsername);
    return (
      <div key={c.id} className={`flex gap-3 ${isReply ? "py-2" : "py-3"} ${c.hidden ? "opacity-50" : ""}`}>
        <Avatar src={mine ? ownPicture : null} name={c.username ?? "?"} size={isReply ? 26 : 32} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-[14px] leading-snug">
            <span className="mr-1.5 font-semibold">{c.username ?? "unknown"}</span>
            {c.text}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-semibold text-muted">
            {c.timestamp && <span className="font-normal">{timeAgo(c.timestamp)}</span>}
            {c.hidden && <span className="font-normal">Hidden</span>}
            {!isReply && <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>Reply</button>}
            {!mine && (
              <button disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: "hide", hide: !c.hidden })}>
                {c.hidden ? "Unhide" : "Hide"}
              </button>
            )}
            <button
              className="text-danger/80"
              disabled={act.isPending}
              onClick={() => confirm("Delete this comment from Instagram?") && act.mutate({ id: c.id, action: "delete" })}
            >
              Delete
            </button>
          </div>
          {replyTo === c.id && (
            <form
              className="mt-2 flex items-center gap-2 rounded-full border border-line px-3 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) reply.mutate(c.id);
              }}
            >
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] outline-none placeholder:text-muted"
                placeholder={`Reply to ${c.username ?? ""}…`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" disabled={reply.isPending || !text.trim()} className="text-[14px] font-semibold text-accent disabled:opacity-40">
                {reply.isPending ? "…" : "Post"}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Post">
      <div className="mx-4 overflow-hidden rounded-xl border border-card-border bg-card">
        {post.videoUrl ? (
          <video src={post.videoUrl} poster={post.image ?? undefined} controls playsInline className="max-h-[60dvh] w-full bg-black object-contain" />
        ) : post.image ? (
          <img src={post.image} alt="" className="max-h-[60dvh] w-full bg-black object-contain" />
        ) : null}
        <div className="px-4 py-3">
          <div className="flex items-center gap-4 text-[15px] font-semibold">
            {post.likes !== undefined && <span>♥ {post.likes}</span>}
            {post.comments !== undefined && <span>💬 {post.comments}</span>}
            {post.timestamp && <span className="text-[13px] font-normal text-muted">{new Date(post.timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
          </div>
          {post.caption && <p className="mt-2 whitespace-pre-line break-words text-[15px]">{post.caption}</p>}
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[14px] font-semibold text-accent">
              Open in Instagram ↗
            </a>
          )}
        </div>
      </div>

      <h2 className="mx-4 mb-1 mt-5 text-[15px] font-semibold">Comments</h2>
      <ErrorNote error={comments.error ?? act.error ?? reply.error} />
      {comments.isLoading && <p className="py-6 text-center text-muted">Loading…</p>}
      {comments.data?.length === 0 && <p className="px-4 py-4 text-[14px] text-muted">No comments yet.</p>}
      {!!comments.data?.length && (
        <div className="px-4">
          {comments.data.map((c) => {
            const n = c.replies?.length ?? 0;
            const shown = openReplies.includes(c.id);
            return (
              <div key={c.id}>
                {renderComment(c, false)}
                {n > 0 && (
                  <div className="pl-11">
                    <button
                      className="flex items-center gap-3 py-1 text-[12px] font-semibold text-muted"
                      onClick={() => setOpenReplies((o) => (shown ? o.filter((x) => x !== c.id) : [...o, c.id]))}
                    >
                      <span className="h-px w-6 bg-muted" />
                      {shown ? "Hide replies" : `View ${n} ${n === 1 ? "reply" : "replies"}`}
                    </button>
                    {shown && c.replies!.map((r) => renderComment(r, true))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
