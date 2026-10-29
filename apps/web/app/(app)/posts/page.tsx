"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadMedia } from "@/lib/upload";
import { api, type Media, type Post } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Badge, Button, Empty, ErrorNote, Field, Group, Header, Row, Segmented, Sheet } from "@/components/ui";

const STATUS_TONE = { DRAFT: "muted", PENDING: "accent", PUBLISHING: "accent", PUBLISHED: "ok", FAILED: "danger", CANCELLED: "muted" } as const;

export default function PostsPage() {
  const qc = useQueryClient();
  const { accounts, selected, select } = useAccounts();
  /** null = closed, "new" = new post, Post = edit that draft / scheduled post */
  const [editing, setEditing] = useState<Post | "new" | null>(null);
  const [ideaCaption, setIdeaCaption] = useState<string | undefined>(undefined);
  const [showIdeas, setShowIdeas] = useState(false);
  const [view, setView] = useState<"scheduled" | "calendar" | "drafts" | "live">("scheduled");

  const posts = useQuery({
    queryKey: ["posts", selected?.id],
    queryFn: () => api<Post[]>(`/posts?accountId=${selected!.id}`),
    enabled: Boolean(selected),
    refetchInterval: 30_000,
  });
  const media = useQuery({
    queryKey: ["media", selected?.id],
    queryFn: () => api<Media[]>(`/accounts/${selected!.id}/media`),
    enabled: Boolean(selected) && view === "live",
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "retry" }) => api(`/posts/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["posts"] }),
  });

  const drafts = (posts.data ?? []).filter((p) => p.status === "DRAFT");
  const scheduled = (posts.data ?? []).filter((p) => p.status !== "DRAFT");

  if (!selected) {
    return (
      <>
        <Header title="Posts" />
        <Empty icon="🔌" text="Connect an Instagram account in Settings first." />
      </>
    );
  }

  return (
    <>
      <Header
        title="Posts"
        right={
          <button className="text-[17px] text-accent" onClick={() => setEditing("new")}>
            New
          </button>
        }
      />
      <AccountSwitcher accounts={accounts} selected={selected} onSelect={select} />
      <div className="mx-4 mb-3">
        <button className="press w-full rounded-xl bg-card px-4 py-3 text-left text-[17px] text-accent" onClick={() => setShowIdeas(true)}>
          💡 Content ideas with AI
        </button>
      </div>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "scheduled", label: "Scheduled" },
          { value: "calendar", label: "Calendar" },
          { value: "drafts", label: "Drafts" },
          { value: "live", label: "On Instagram" },
        ]}
      />
      <ErrorNote error={posts.error ?? act.error ?? (view === "live" ? media.error : null)} />

      {view === "scheduled" && (
        <>
          {scheduled.length === 0 && posts.data && (
            <Empty icon="🗓️" text="Nothing scheduled. Tap New to plan a post, reel, story or carousel." />
          )}
          {scheduled.length > 0 && (
            <Group>
              {scheduled.map((p) => (
                <PostRow key={p.id} post={p} onEdit={setEditing} onAction={(action) => act.mutate({ id: p.id, action })} />
              ))}
            </Group>
          )}
        </>
      )}

      {view === "calendar" && <Calendar accountId={selected.id} onEdit={setEditing} />}

      {view === "drafts" && (
        <>
          {drafts.length === 0 && posts.data && <Empty icon="📝" text="No drafts. In New, tap Save as draft to keep an idea for later." />}
          {drafts.length > 0 && (
            <Group footer="Drafts are never published until you schedule them.">
              {drafts.map((p) => (
                <PostRow key={p.id} post={p} onEdit={setEditing} onAction={() => undefined} />
              ))}
            </Group>
          )}
        </>
      )}

      {view === "live" && (
        <div className="mx-4 grid grid-cols-3 gap-1">
          {media.data?.map((m) => (
            <a key={m.id} href={m.permalink} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-md bg-card">
              {(m.thumbnail_url ?? m.media_url) && (
                <img src={m.thumbnail_url ?? m.media_url} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1.5 py-0.5 text-[11px] text-white">
                ♥ {m.like_count ?? 0} · 💬 {m.comments_count ?? 0}
              </span>
            </a>
          ))}
          {media.isLoading && <p className="col-span-3 py-8 text-center text-muted">Loading…</p>}
        </div>
      )}

      {editing && (
        <PostEditor
          accountId={selected.id}
          post={editing === "new" ? undefined : editing}
          initialCaption={editing === "new" ? ideaCaption : undefined}
          onClose={() => {
            setEditing(null);
            setIdeaCaption(undefined);
          }}
        />
      )}
      {showIdeas && (
        <IdeasSheet
          accountId={selected.id}
          onClose={() => setShowIdeas(false)}
          onUse={(caption) => {
            setShowIdeas(false);
            setIdeaCaption(caption);
            setEditing("new");
          }}
        />
      )}
    </>
  );
}

function localInputValue(d: Date) {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

interface HashtagSet {
  id: string;
  name: string;
  tags: string;
}

const typeLabel = (t: Post["type"]) => `${t.charAt(0)}${t.slice(1).toLowerCase()}`;

function PostRow({
  post: p,
  onEdit,
  onAction,
}: {
  post: Post;
  onEdit: (p: Post) => void;
  onAction: (action: "cancel" | "retry") => void;
}) {
  const editable = p.status === "DRAFT" || p.status === "PENDING";
  return (
    <Row
      title={`${typeLabel(p.type)} · ${new Date(p.scheduledAt).toLocaleString()}`}
      subtitle={p.error ?? p.caption ?? p.mediaUrls[0] ?? "No media yet"}
      right={
        <div className="flex flex-col items-end gap-1">
          <Badge tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Badge>
          <div className="flex gap-3">
            {editable && (
              <button className="text-[13px] text-accent" onClick={() => onEdit(p)}>
                Edit
              </button>
            )}
            {p.status === "PENDING" && (
              <button className="text-[13px] text-danger" onClick={() => onAction("cancel")}>
                Cancel
              </button>
            )}
            {p.status === "FAILED" && (
              <button className="text-[13px] text-accent" onClick={() => onAction("retry")}>
                Retry now
              </button>
            )}
          </div>
        </div>
      }
    />
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DOT = {
  DRAFT: "bg-muted",
  PENDING: "bg-accent",
  PUBLISHING: "bg-accent",
  PUBLISHED: "bg-ok",
  FAILED: "bg-danger",
  CANCELLED: "bg-line",
} as const;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Month grid (local time). Tap a day to see its posts. */
function Calendar({ accountId, onEdit }: { accountId: string; onEdit: (p: Post) => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState(() => dayKey(new Date()));
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const posts = useQuery({
    queryKey: ["posts", accountId, "month", month.toISOString()],
    queryFn: () => api<Post[]>(`/posts?accountId=${accountId}&from=${month.toISOString()}&to=${next.toISOString()}`),
    refetchInterval: 30_000,
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "retry" }) => api(`/posts/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["posts"] }),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts.data ?? []) {
      const k = dayKey(new Date(p.scheduledAt));
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return map;
  }, [posts.data]);

  const daysInMonth = new Date(next.getTime() - 1).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: month.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  const today = dayKey(new Date());
  const selectedPosts = byDay.get(day) ?? [];
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <>
      <ErrorNote error={posts.error ?? act.error} />
      <section className="mx-4 mb-4 rounded-xl bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <button className="press px-3 text-[22px] text-accent" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="text-[17px] font-semibold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button className="press px-3 text-[22px] text-accent" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="text-[12px] text-muted">
              {w}
            </span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} />;
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const isSel = k === day;
            return (
              <button
                key={k}
                onClick={() => setDay(k)}
                className={`press mx-auto flex h-11 w-11 flex-col items-center justify-center rounded-full text-[16px] ${
                  isSel ? "bg-accent text-white" : k === today ? "font-semibold text-accent" : ""
                }`}
              >
                {d.getDate()}
                <span className="flex h-1.5 gap-0.5">
                  {list.slice(0, 3).map((p) => (
                    <span key={p.id} className={`h-1.5 w-1.5 rounded-full ${isSel ? "bg-white" : DOT[p.status]}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedPosts.length === 0 ? (
        <p className="px-8 pb-6 text-center text-[15px] text-muted">{posts.isLoading ? "Loading…" : "Nothing on this day."}</p>
      ) : (
        <Group>
          {selectedPosts.map((p) => (
            <PostRow key={p.id} post={p} onEdit={onEdit} onAction={(action) => act.mutate({ id: p.id, action })} />
          ))}
        </Group>
      )}
    </>
  );
}

function IdeasSheet({ accountId, onClose, onUse }: { accountId: string; onClose: () => void; onUse: (caption: string) => void }) {
  const ideas = useQuery({
    queryKey: ["ideas", accountId],
    queryFn: () => api<{ ideas: { title: string; format: string; caption: string }[] }>("/ai/ideas", { method: "POST", json: { accountId } }),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <Sheet open onClose={onClose} title="Content ideas">
      <ErrorNote error={ideas.error} />
      {ideas.isFetching && <p className="py-8 text-center text-muted">💡 Thinking of ideas…</p>}
      {ideas.data && !ideas.isFetching && (
        <Group footer="From your business info (AI rules) and your best posts. Tap Use to start a post with that caption.">
          {ideas.data.ideas.map((i, n) => (
            <div key={n} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold">{i.title}</div>
                  <div className="text-[13px] text-muted">{i.format}</div>
                </div>
                <button className="shrink-0 text-[15px] font-semibold text-accent" onClick={() => onUse(i.caption)}>
                  Use
                </button>
              </div>
              <p className="mt-1 whitespace-pre-line text-[14px] text-muted">{i.caption}</p>
            </div>
          ))}
        </Group>
      )}
      <div className="mx-4">
        <Button variant="plain" disabled={ideas.isFetching} onClick={() => ideas.refetch()}>
          New ideas
        </Button>
      </div>
    </Sheet>
  );
}

function PostEditor({
  accountId,
  post,
  initialCaption,
  onClose,
}: {
  accountId: string;
  post?: Post;
  initialCaption?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<Post["type"]>(post?.type ?? "IMAGE");
  const [urls, setUrls] = useState(post?.mediaUrls.join("\n") ?? "");
  const [caption, setCaption] = useState(post?.caption ?? initialCaption ?? "");
  const [firstComment, setFirstComment] = useState(post?.firstComment ?? "");
  const [when, setWhen] = useState(localInputValue(post ? new Date(post.scheduledAt) : new Date(Date.now() + 30 * 60_000)));
  const done = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    onClose();
  };

  const save = useMutation({
    mutationFn: (draft: boolean) =>
      api(post ? `/posts/${post.id}` : "/posts", {
        method: post ? "PUT" : "POST",
        json: {
          accountId,
          type,
          mediaUrls: urls.split("\n").map((u) => u.trim()).filter(Boolean),
          caption: type === "STORY" ? undefined : caption || undefined,
          firstComment: type === "STORY" ? undefined : firstComment.trim() || undefined,
          scheduledAt: new Date(when).toISOString(),
          draft,
        },
      }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api(`/posts/${post!.id}`, { method: "DELETE" }),
    onSuccess: done,
  });
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Error | null>(null);
  const ai = useMutation({
    mutationFn: () =>
      api<{ caption: string }>("/ai/caption", {
        method: "POST",
        json: { accountId, notes: caption, imageUrl: urls.split("\n").map((u) => u.trim()).find(Boolean) },
      }),
    onSuccess: (r) => setCaption(r.caption),
  });
  const sets = useQuery({ queryKey: ["hashtag-sets"], queryFn: () => api<HashtagSet[]>("/hashtag-sets") });
  const saveSet = useMutation({
    mutationFn: (body: { name: string; tags: string }) => api("/hashtag-sets", { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hashtag-sets"] }),
  });
  const dropSet = useMutation({
    mutationFn: (id: string) => api(`/hashtag-sets/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hashtag-sets"] }),
  });
  /** Hashtags go to the first comment when it has text, else to the caption. */
  const addTags = (tags: string) => {
    if (firstComment.trim()) setFirstComment(`${firstComment.trim()} ${tags}`);
    else setCaption(caption.trim() ? `${caption.trim()}\n\n${tags}` : tags);
  };
  const busy = save.isPending || remove.isPending || Boolean(uploading) || ai.isPending;
  const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);

  /** Upload picked files one by one; each returned public URL is added to the list. */
  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    try {
      const added: string[] = [];
      for (const [i, f] of [...files].entries()) {
        setUploading(`Uploading ${i + 1}/${files.length}…`);
        added.push((await uploadMedia(f)).url);
      }
      const keep = type === "CAROUSEL" ? urlList : [];
      setUrls([...keep, ...added].join("\n"));
    } catch (err) {
      setUploadError(err as Error);
    } finally {
      setUploading(null);
    }
  }

  return (
    <Sheet open onClose={onClose} title={post?.status === "DRAFT" ? "Draft" : post ? "Edit post" : "New post"}>
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: "IMAGE", label: "Photo" },
          { value: "REELS", label: "Reel" },
          { value: "STORY", label: "Story" },
          { value: "CAROUSEL", label: "Carousel" },
        ]}
      />
      <Group
        footer={
          type === "CAROUSEL"
            ? "2 to 20 photos/videos. Uploaded photos are converted to JPEG automatically."
            : type === "IMAGE"
              ? "One photo. Uploaded photos are converted to JPEG (Meta only accepts JPEG)."
              : type === "REELS"
                ? "One video (MP4 or MOV)."
                : "One photo or video."
        }
      >
        <label className={`press flex items-center gap-2 px-4 py-3 text-[17px] text-accent ${busy ? "opacity-40" : ""}`}>
          <span>📷</span>
          <span>{uploading ?? (type === "CAROUSEL" ? "Upload photos / videos from device" : "Upload from device")}</span>
          <input
            type="file"
            className="hidden"
            accept={type === "REELS" ? "video/mp4,video/quicktime" : "image/*,video/mp4,video/quicktime"}
            multiple={type === "CAROUSEL"}
            disabled={busy}
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {urlList.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2">
            {urlList.map((u) => (
              <div key={u} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-line">
                {/\.(mp4|mov)(\?|$)/i.test(u) ? (
                  <video src={u} className="h-full w-full object-cover" muted preload="metadata" />
                ) : (
                  <img src={u} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  className="absolute right-0.5 top-0.5 h-6 w-6 rounded-full bg-black/60 text-[13px] text-white"
                  aria-label="Remove"
                  onClick={() => setUrls(urlList.filter((x) => x !== u).join("\n"))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <Field label="Or paste public https URL(s)" value={urls} onChange={setUrls} multiline placeholder="https://…/photo.jpg" />
      </Group>
      <ErrorNote error={uploadError} />
      {type !== "STORY" && (
        <>
          <Group footer="AI uses your notes above + the uploaded photo + the business info from your AI rules.">
            <Field label="Caption" value={caption} onChange={setCaption} multiline placeholder="Write a caption… or a few notes and tap ✨" />
            <button className="press block w-full px-4 py-3 text-left text-[17px] text-accent disabled:opacity-40" disabled={busy} onClick={() => ai.mutate()}>
              {ai.isPending ? "✨ Writing…" : "✨ Write caption with AI"}
            </button>
          </Group>
          <ErrorNote error={ai.error} />
          <Group
            title="Hashtag sets"
            footer="Tap a set to add it (to the first comment if it has text, else to the caption). ✕ deletes a set."
          >
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {sets.data?.map((s) => (
                <span key={s.id} className="flex items-center gap-1 rounded-full bg-line px-3 py-1.5 text-[14px]">
                  <button onClick={() => addTags(s.tags)}>#{s.name}</button>
                  <button aria-label={`Delete ${s.name}`} className="text-muted" onClick={() => confirm(`Delete set “${s.name}”?`) && dropSet.mutate(s.id)}>
                    ✕
                  </button>
                </span>
              ))}
              <button
                className="rounded-full border border-line px-3 py-1.5 text-[14px] text-accent"
                onClick={() => {
                  const tags = (`${caption} ${firstComment}`.match(/#[\p{L}\p{N}_]+/gu) ?? []).join(" ");
                  if (!tags) return alert("Write some #hashtags in the caption or first comment first.");
                  const name = prompt("Name for this hashtag set:", "")?.trim();
                  if (name) saveSet.mutate({ name, tags });
                }}
              >
                ＋ Save current hashtags
              </button>
            </div>
          </Group>
          <Group footer="Posted as a comment right after publishing. Keeps the caption clean.">
            <Field label="First comment (optional, e.g. hashtags)" value={firstComment} onChange={setFirstComment} multiline placeholder="#marketing #lucknow …" />
          </Group>
        </>
      )}
      <Group>
        <Field label="Publish at" type="datetime-local" value={when} onChange={setWhen} />
      </Group>
      <ErrorNote error={save.error ?? remove.error} />
      <div className="mx-4 flex flex-col gap-2">
        <Button onClick={() => save.mutate(false)} disabled={busy || !urls.trim()}>
          {save.isPending && save.variables === false ? "Scheduling…" : post?.status === "PENDING" ? "Update schedule" : "Schedule"}
        </Button>
        <Button variant="plain" onClick={() => save.mutate(true)} disabled={busy}>
          {save.isPending && save.variables === true ? "Saving…" : post?.status === "PENDING" ? "Move to drafts" : "Save as draft"}
        </Button>
        {post?.status === "DRAFT" && (
          <Button variant="danger" onClick={() => remove.mutate()} disabled={busy}>
            {remove.isPending ? "Deleting…" : "Delete draft"}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
