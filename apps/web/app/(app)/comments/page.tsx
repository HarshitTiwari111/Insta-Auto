"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Button, Empty, ErrorNote, Group, Header, Segmented } from "@/components/ui";
import { PostViewer, type ViewPost } from "@/components/PostViewer";

interface ModComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
  hidden: boolean;
  likes: number;
  mediaId: string;
  mediaCaption: string;
  mediaThumb: string | null;
  permalink: string | null;
}

type Sentiment = "positive" | "neutral" | "negative" | "spam";
const TONE: Record<Sentiment, string> = {
  positive: "bg-ok/15 text-ok",
  neutral: "bg-fill text-muted",
  negative: "bg-danger/15 text-danger",
  spam: "bg-[#ff9f0a]/15 text-[#ff9f0a]",
};

export default function CommentsPage() {
  const qc = useQueryClient();
  const { accounts, selected, select } = useAccounts();
  const [filter, setFilter] = useState<"all" | "visible" | "hidden">("all");
  const [labels, setLabels] = useState<Record<string, Sentiment>>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [viewing, setViewing] = useState<ViewPost | null>(null);

  const comments = useQuery({
    queryKey: ["comments", selected?.id],
    queryFn: () => api<ModComment[]>(`/accounts/${selected!.id}/comments`),
    enabled: Boolean(selected),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["comments"] });

  const act = useMutation({
    mutationFn: ({ id, action, hide }: { id: string; action: "hide" | "delete"; hide?: boolean }) =>
      api(`/comments/${id}/${action}`, { method: "POST", json: { accountId: selected!.id, hide } }),
    onSuccess: refresh,
  });
  const reply = useMutation({
    mutationFn: (id: string) => api(`/comments/${id}/reply`, { method: "POST", json: { accountId: selected!.id, message: replyText } }),
    onSuccess: () => {
      setReplyTo(null);
      setReplyText("");
      refresh();
    },
  });
  const block = useMutation({
    mutationFn: (username: string) => api<{ blocklist: string[] }>(`/accounts/${selected!.id}/block`, { method: "POST", json: { username } }),
    onSuccess: (_r, username) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      alert(`@${username} blocked. The app won't auto-reply to them any more.`);
    },
  });
  const analyze = useMutation({
    mutationFn: (list: ModComment[]) => api<{ labels: Sentiment[] }>("/ai/sentiment", { method: "POST", json: { texts: list.map((c) => c.text || "(empty)") } }),
    onSuccess: (r, list) => setLabels((old) => ({ ...old, ...Object.fromEntries(list.map((c, i) => [c.id, r.labels[i] ?? "neutral"])) })),
  });

  if (!selected) {
    return (
      <>
        <Header title="Comments" />
        <Empty icon="🔌" text="Connect an Instagram account in Settings first." />
      </>
    );
  }

  const all = comments.data ?? [];
  const list = all.filter((c) => (filter === "all" ? true : filter === "hidden" ? c.hidden : !c.hidden));
  const counts = Object.values(labels).reduce<Record<string, number>>((m, l) => ({ ...m, [l]: (m[l] ?? 0) + 1 }), {});

  return (
    <>
      <Header
        title="Comments"
        right={
          <Link href="/" className="text-[17px] text-accent">
            Done
          </Link>
        }
      />
      <AccountSwitcher accounts={accounts} selected={selected} onSelect={select} />
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `All (${all.length})` },
          { value: "visible", label: "Visible" },
          { value: "hidden", label: "Hidden" },
        ]}
      />
      <ErrorNote error={comments.error ?? act.error ?? reply.error ?? analyze.error ?? block.error} />

      {all.length > 0 && (
        <div className="mx-4 mb-4">
          <Button variant="plain" disabled={analyze.isPending} onClick={() => analyze.mutate(all.slice(0, 100))}>
            {analyze.isPending ? "Analyzing…" : "🧠 Analyze sentiment with AI"}
          </Button>
          {Object.keys(counts).length > 0 && (
            <p className="mt-2 text-center text-[14px] text-muted">
              {(["positive", "neutral", "negative", "spam"] as Sentiment[])
                .filter((l) => counts[l])
                .map((l) => `${counts[l]} ${l}`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      {comments.isLoading && <p className="py-8 text-center text-muted">Loading…</p>}
      {comments.data && list.length === 0 && <Empty icon="💬" text="No comments here. Comments on your latest 10 posts show up in this list." />}

      {list.length > 0 && (
        <Group footer="Latest comments on your latest 10 posts. Updates every minute.">
          {list.map((c) => (
            <div key={c.id} className={`px-4 py-3 ${c.hidden ? "opacity-60" : ""}`}>
              <div className="flex gap-3">
                <button
                  aria-label="Open post"
                  onClick={() => setViewing({ id: c.mediaId, image: c.mediaThumb, caption: c.mediaCaption, permalink: c.permalink })}
                  className="press h-10 w-10 shrink-0 overflow-hidden rounded-md bg-fill"
                >
                  {c.mediaThumb && <img src={c.mediaThumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="font-semibold">@{c.username ?? "unknown"}</span>
                    {c.timestamp && <span className="text-muted">{timeAgo(c.timestamp)}</span>}
                    {c.hidden && <span className="text-muted">· hidden</span>}
                    {labels[c.id] && <span className={`rounded-full px-2 py-0.5 text-[12px] ${TONE[labels[c.id]!]}`}>{labels[c.id]}</span>}
                  </div>
                  <p className="break-words text-[16px]">{c.text}</p>
                  <div className="mt-1 flex gap-4 text-[14px]">
                    <button className="text-accent" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                      Reply
                    </button>
                    <button className="text-accent" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: "hide", hide: !c.hidden })}>
                      {c.hidden ? "Unhide" : "Hide"}
                    </button>
                    <button
                      className="text-danger"
                      disabled={act.isPending}
                      onClick={() => confirm("Delete this comment from Instagram?") && act.mutate({ id: c.id, action: "delete" })}
                    >
                      Delete
                    </button>
                    {c.username && (
                      <button
                        className="text-muted"
                        disabled={block.isPending}
                        onClick={() => confirm(`Block @${c.username}? The app will never auto-reply to them.`) && block.mutate(c.username!)}
                      >
                        Block
                      </button>
                    )}
                  </div>
                  {replyTo === c.id && (
                    <form
                      className="mt-2 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (replyText.trim()) reply.mutate(c.id);
                      }}
                    >
                      <input
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg bg-fill px-3 py-2 text-[15px] outline-none"
                        placeholder={`Reply to @${c.username ?? ""}`}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <button type="submit" disabled={reply.isPending || !replyText.trim()} className="rounded-lg bg-accent px-3 text-[15px] font-semibold text-white disabled:opacity-40">
                        {reply.isPending ? "…" : "Send"}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Group>
      )}
      {viewing && <PostViewer accountId={selected.id} ownUsername={selected.username} ownPicture={selected.profilePictureUrl} post={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
