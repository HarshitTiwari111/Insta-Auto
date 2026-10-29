"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/api";
import { ErrorNote, Sheet } from "@/components/ui";

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
}

/** Instagram-style post view inside the app: media, caption, numbers, and the post's comments with actions. */
export function PostViewer({ accountId, post, onClose }: { accountId: string; post: ViewPost; onClose: () => void }) {
  const qc = useQueryClient();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [text, setText] = useState("");
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

      <h2 className="mx-5 mb-2 mt-5 text-[15px] font-semibold">Comments</h2>
      <ErrorNote error={comments.error ?? act.error ?? reply.error} />
      {comments.isLoading && <p className="py-6 text-center text-muted">Loading…</p>}
      {comments.data?.length === 0 && <p className="px-5 py-4 text-[15px] text-muted">No comments yet.</p>}
      {!!comments.data?.length && (
        <div className="mx-4 overflow-hidden rounded-xl border border-card-border bg-card [&>*+*]:border-t [&>*+*]:border-line">
          {comments.data.map((c) => (
            <div key={c.id} className={`px-4 py-3 ${c.hidden ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 text-[14px]">
                <span className="font-semibold">@{c.username ?? "unknown"}</span>
                {c.timestamp && <span className="text-muted">{timeAgo(c.timestamp)}</span>}
                {c.hidden && <span className="text-muted">· hidden</span>}
              </div>
              <p className="break-words text-[15px]">{c.text}</p>
              <div className="mt-1 flex gap-4 text-[14px] font-semibold">
                <button className="text-accent" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                  Reply
                </button>
                <button className="text-muted" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: "hide", hide: !c.hidden })}>
                  {c.hidden ? "Unhide" : "Hide"}
                </button>
                <button
                  className="text-danger"
                  disabled={act.isPending}
                  onClick={() => confirm("Delete this comment from Instagram?") && act.mutate({ id: c.id, action: "delete" })}
                >
                  Delete
                </button>
              </div>
              {replyTo === c.id && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim()) reply.mutate(c.id);
                  }}
                >
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg bg-fill px-3 py-2 text-[15px] outline-none"
                    placeholder={`Reply to @${c.username ?? ""}`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button type="submit" disabled={reply.isPending || !text.trim()} className="rounded-lg bg-accent px-3 text-[15px] font-semibold text-white disabled:opacity-40">
                    {reply.isPending ? "…" : "Post"}
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
