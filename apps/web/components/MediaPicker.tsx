"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Media } from "@/lib/api";
import { Button, ErrorNote, Segmented, Sheet } from "@/components/ui";

/** Every post/reel on the account (paged on the server). Shared with the Posts > Instagram grid. */
export function useAllMedia(accountId: string, enabled = true) {
  return useQuery({
    queryKey: ["media-all", accountId],
    queryFn: () => api<Media[]>(`/accounts/${accountId}/media?all=1`),
    enabled,
    staleTime: 300_000,
  });
}

export const isReel = (m: Media) => m.media_product_type === "REELS";

/** Instagram-style grid to pick the posts/reels a rule runs on. Empty selection = all posts. */
export function MediaPicker({
  accountId,
  selected,
  onDone,
  onClose,
}: {
  accountId: string;
  selected: string[];
  onDone: (ids: string[]) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const media = useAllMedia(accountId);
  const [picked, setPicked] = useState<string[]>(selected);
  const [filter, setFilter] = useState<"reels" | "all">("reels");
  const list = (media.data ?? []).filter((m) => (filter === "reels" ? isReel(m) : true));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const refresh = async () => {
    await api(`/accounts/${accountId}/media?all=1&fresh=1`);
    qc.invalidateQueries({ queryKey: ["media-all", accountId] });
  };

  return (
    <Sheet open onClose={onClose} title="Choose posts">
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "reels", label: `Reels (${(media.data ?? []).filter(isReel).length})` },
          { value: "all", label: `All posts (${media.data?.length ?? 0})` },
        ]}
      />
      <ErrorNote error={media.error} />
      {media.isLoading && <p className="py-8 text-center text-muted">Loading your Instagram posts…</p>}
      {media.data && list.length === 0 && (
        <p className="px-5 py-8 text-center text-[15px] text-muted">{filter === "reels" ? "No reels on this account yet." : "No posts yet."}</p>
      )}
      <div className="mx-4 grid grid-cols-3 gap-1">
        {list.map((m) => {
          const on = picked.includes(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              aria-pressed={on}
              aria-label={m.caption?.slice(0, 40) || m.id}
              className="relative aspect-[3/4] overflow-hidden rounded-md bg-fill"
            >
              {(m.thumbnail_url ?? m.media_url) && <img src={m.thumbnail_url ?? m.media_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
              {isReel(m) && <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1 text-[11px] font-semibold text-white">▶ Reel</span>}
              <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1.5 py-0.5 text-left text-[11px] text-white">💬 {m.comments_count ?? 0}</span>
              <span
                className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[13px] font-bold text-white ${on ? "bg-accent" : "bg-black/30"}`}
              >
                {on ? "✓" : ""}
              </span>
              {on && <span className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-accent" />}
            </button>
          );
        })}
      </div>
      <div className="mx-4 mt-4 space-y-3">
        <Button onClick={() => onDone(picked)}>{picked.length ? `Use ${picked.length} selected` : "Use on all posts"}</Button>
        <div className="flex justify-between px-1 text-[15px] font-semibold">
          <button className="text-accent" onClick={() => setPicked(list.map((m) => m.id))}>
            Select all {filter === "reels" ? "reels" : "posts"}
          </button>
          <button className="text-muted" onClick={() => setPicked([])}>
            Clear
          </button>
          <button className="text-accent" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>
    </Sheet>
  );
}
