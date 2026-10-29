"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Button, Empty, ErrorNote, Group, Header, Row, Segmented } from "@/components/ui";
import { PostViewer, type ViewPost } from "@/components/PostViewer";

interface PostStat {
  id: string;
  type: string;
  caption: string;
  permalink: string | null;
  thumbnail: string | null;
  timestamp: string | null;
  likes: number;
  comments: number;
  engagementRate: number;
}

interface Analytics {
  days: number;
  summary: {
    followers: number;
    followerChange: number | null;
    posts: number;
    totalLikes: number;
    totalComments: number;
    avgEngagementRate: number;
  };
  history: { day: string; followers: number; mediaCount: number }[];
  best: PostStat[];
  bestTimes: { weekday: number; hour: number; posts: number; avgInteractions: number; avgEngagementRate: number }[];
  timezone: string;
  hashtags: { tag: string; posts: number; avgInteractions: number; avgEngagementRate: number }[];
  dm: { received: number; sent: number; people: number; replied: number; replyRate: number; medianResponseMinutes: number | null };
  posts: PostStat[];
}

export default function AnalyticsPage() {
  const { accounts, selected, select } = useAccounts();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [viewing, setViewing] = useState<ViewPost | null>(null);
  const data = useQuery({
    queryKey: ["analytics", selected?.id, days],
    queryFn: () => api<Analytics>(`/accounts/${selected!.id}/analytics?days=${days}`),
    enabled: Boolean(selected),
  });

  if (!selected) {
    return (
      <>
        <Header title="Analytics" />
        <Empty icon="🔌" text="Connect an Instagram account in Settings first." />
      </>
    );
  }

  const a = data.data;
  const s = a?.summary;

  return (
    <>
      <Header
        title="Analytics"
        right={
          <Link href="/" className="text-[17px] text-accent">
            Done
          </Link>
        }
      />
      <AccountSwitcher accounts={accounts} selected={selected} onSelect={select} />
      <Segmented
        value={days}
        onChange={setDays}
        options={[
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
        ]}
      />
      <ErrorNote error={data.error} />
      {data.isLoading && <p className="py-8 text-center text-muted">Loading…</p>}

      {s && a && (
        <>
          <div className="mx-4 mb-6 grid grid-cols-2 gap-3">
            <Stat label="Followers" value={s.followers.toLocaleString()} />
            <Stat
              label={`Change (${a.days}d)`}
              value={s.followerChange === null ? "–" : `${s.followerChange > 0 ? "+" : ""}${s.followerChange}`}
              tone={s.followerChange && s.followerChange < 0 ? "danger" : s.followerChange ? "ok" : undefined}
            />
            <Stat label="Avg engagement" value={`${s.avgEngagementRate}%`} />
            <Stat label={`Likes · comments (${s.posts} posts)`} value={`${s.totalLikes} · ${s.totalComments}`} />
          </div>

          <Group
            title="Follower growth"
            footer={
              a.history.length < 2
                ? "The app saves your follower count every hour. The graph fills in from tomorrow."
                : `${a.history[0]!.day} → ${a.history.at(-1)!.day}`
            }
          >
            <div className="px-4 py-3">
              <Sparkline values={a.history.map((h) => h.followers)} />
            </div>
          </Group>

          <Group title="Direct messages" footer={`Last ${a.days} days, from DMs the app has seen. Response time = median wait until our reply.`}>
            <Row title="Received" right={<span className="text-muted">{a.dm.received} from {a.dm.people} people</span>} />
            <Row title="Replied" right={<span className="text-muted">{a.dm.replied} ({a.dm.replyRate}%)</span>} />
            <Row
              title="Response time"
              right={<span className="text-muted">{a.dm.medianResponseMinutes === null ? "–" : formatMinutes(a.dm.medianResponseMinutes)}</span>}
            />
            <Row title="Messages sent" right={<span className="text-muted">{a.dm.sent}</span>} />
          </Group>

          <Group title="Hashtag performance" footer="Hashtags in captions of your latest 25 posts, ranked by average likes + comments.">
            {a.hashtags.length === 0 && <Row title="No hashtags in your captions yet" />}
            {a.hashtags.map((h) => (
              <Row
                key={h.tag}
                title={h.tag}
                subtitle={`${h.posts} post${h.posts === 1 ? "" : "s"}`}
                right={<span className="text-[15px] text-muted">avg {h.avgInteractions}</span>}
              />
            ))}
          </Group>

          <Competitor accountId={selected.id} />

          <Group
            title="Best time to post"
            footer={`From your own posts so far (${a.timezone}). Gets more reliable as you post more, at different times.`}
          >
            <AiBestTime accountId={selected.id} />
            {a.bestTimes.length === 0 && <Row title="Not enough posts yet" />}
            {a.bestTimes.map((t, i) => (
              <Row
                key={`${t.weekday}-${t.hour}`}
                title={`${i + 1}. ${WEEKDAY[t.weekday]} · ${slot(t.hour)}`}
                subtitle={`${t.posts} post${t.posts === 1 ? "" : "s"} · avg ${t.avgInteractions} likes+comments`}
              />
            ))}
          </Group>

          <Group title="Best performing posts" footer="Engagement rate = (likes + comments) ÷ followers. Latest 25 posts.">
            {a.best.length === 0 && <Row title="No posts yet" />}
            {a.best.map((p, i) => (
              <button
                key={p.id}
                onClick={() =>
                  setViewing({ id: p.id, image: p.thumbnail, caption: p.caption, permalink: p.permalink, likes: p.likes, comments: p.comments, timestamp: p.timestamp })
                }
                className="press flex w-full items-center gap-3 px-4 py-2.5 text-left"
              >
                <span className="w-4 text-[15px] text-muted">{i + 1}</span>
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-fill">
                  {p.thumbnail && <img src={p.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px]">{p.caption || p.type.toLowerCase()}</div>
                  <div className="text-[13px] text-muted">
                    ♥ {p.likes} · 💬 {p.comments}
                    {p.timestamp ? ` · ${new Date(p.timestamp).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <span className="text-[15px] font-semibold text-accent">{p.engagementRate}%</span>
              </button>
            ))}
          </Group>

          <div className="mx-4 mb-8">
            <div className="space-y-3 print:hidden">
              <Button variant="plain" onClick={() => downloadCsv(selected.username, a)}>
                Export report (CSV)
              </Button>
              <Button variant="plain" onClick={() => window.print()}>
                Save report as PDF
              </Button>
              <p className="text-center text-[13px] text-muted">PDF: in the print window choose “Save as PDF”. 7 days = weekly report, 30 days = monthly.</p>
            </div>
          </div>
        </>
      )}
      {viewing && <PostViewer accountId={selected.id} post={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function formatMinutes(m: number): string {
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.round((m / 60) * 10) / 10} h`;
}

interface CompetitorData {
  username: string;
  name: string | null;
  picture: string | null;
  followers: number;
  mediaCount: number;
  avgLikes: number;
  avgComments: number;
  avgEngagementRate: number;
  mine: { followers: number; mediaCount: number };
}

/** Business Discovery: public numbers of another Business/Creator account, next to ours. */
function Competitor({ accountId }: { accountId: string }) {
  const [username, setUsername] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ["competitor", accountId, query],
    queryFn: () => api<CompetitorData>(`/accounts/${accountId}/competitor?username=${encodeURIComponent(query!)}`),
    enabled: Boolean(query),
    retry: false,
  });
  const c = data.data;
  return (
    <Group title="Competitor analysis" footer="Works for public Business/Creator accounts. Numbers from their latest 12 posts.">
      <form
        className="flex gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim()) setQuery(username.trim().replace(/^@/, ""));
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg bg-fill px-3 py-2 text-[16px] outline-none"
          placeholder="@competitor_username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit" className="rounded-lg bg-accent px-4 text-[15px] font-semibold text-white">
          {data.isFetching ? "…" : "Check"}
        </button>
      </form>
      {data.error && <p className="px-4 pb-3 text-[14px] text-danger">{(data.error as Error).message}</p>}
      {c && (
        <>
          <Row title={`@${c.username}`} subtitle={c.name ?? undefined} />
          <Row title="Followers" right={<span className="text-muted">{c.followers.toLocaleString()} (you: {c.mine.followers.toLocaleString()})</span>} />
          <Row title="Posts" right={<span className="text-muted">{c.mediaCount} (you: {c.mine.mediaCount})</span>} />
          <Row title="Avg likes · comments" right={<span className="text-muted">{c.avgLikes} · {c.avgComments}</span>} />
          <Row title="Avg engagement" right={<span className="text-muted">{c.avgEngagementRate}%</span>} />
        </>
      )}
    </Group>
  );
}

/** Asks Gemini for the 3 best slots, using this account's own post results. */
function AiBestTime({ accountId }: { accountId: string }) {
  const ai = useMutation({
    mutationFn: () => api<{ slots: { day: string; time: string; reason: string }[]; tip: string }>("/ai/best-time", { method: "POST", json: { accountId } }),
  });
  return (
    <div className="px-4 py-3">
      <button className="text-[16px] text-accent disabled:opacity-40" disabled={ai.isPending} onClick={() => ai.mutate()}>
        {ai.isPending ? "✨ Thinking…" : ai.data ? "✨ Ask AI again" : "✨ Ask AI for the best time"}
      </button>
      {ai.error && <p className="mt-1 text-[14px] text-danger">{(ai.error as Error).message}</p>}
      {ai.data && (
        <div className="mt-2 space-y-2">
          {ai.data.slots.map((s, i) => (
            <div key={i}>
              <div className="text-[16px] font-semibold">
                {i + 1}. {s.day} · {s.time}
              </div>
              <div className="text-[14px] text-muted">{s.reason}</div>
            </div>
          ))}
          {ai.data.tip && <p className="text-[14px]">💡 {ai.data.tip}</p>}
        </div>
      )}
    </div>
  );
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const slot = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  const c = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className={`text-[24px] font-bold ${c}`}>{value}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}

/** Small dependency-free line chart. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-24 rounded-lg bg-fill" />;
  const w = 300;
  const h = 96;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 8 - ((v - min) / span) * (h - 16)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Follower growth">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function downloadCsv(username: string, a: Analytics) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = [
    ["Date", "Type", "Caption", "Likes", "Comments", "Engagement %", "Link"],
    ...a.posts.map((p) => [p.timestamp ?? "", p.type, p.caption, p.likes, p.comments, p.engagementRate, p.permalink ?? ""]),
    [],
    ["Day", "Followers", "Posts"],
    ...a.history.map((h) => [h.day, h.followers, h.mediaCount]),
  ];
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `instagram-${username}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
