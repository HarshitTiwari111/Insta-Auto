"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, timeAgo, type Activity } from "@/lib/api";
import { Badge, Button, Empty, ErrorNote, Group, Header, Row } from "@/components/ui";
import { InstallHint } from "@/components/InstallHint";
import { activityLabel } from "@/lib/labels";

interface Dashboard {
  accounts: { id: string; username: string; paused: boolean; dailyActionLimit: number; actionsToday: number }[];
  activeRules: number;
  pendingPosts: number;
  failedPosts: number;
  recent: Activity[];
}

export default function Home() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard"), refetchInterval: 30_000 });
  const stopAll = useMutation({
    mutationFn: () => api("/accounts/stop-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const d = dash.data;
  const anyRunning = d?.accounts.some((a) => !a.paused);

  return (
    <>
      <Header title="Home" />
      <InstallHint />
      <ErrorNote error={dash.error} />

      <div className="mx-4 mb-6 grid grid-cols-3 gap-3">
        <Stat label="Active rules" value={d?.activeRules} href="/rules" />
        <Stat label="Scheduled" value={d?.pendingPosts} href="/posts" />
        <Stat label="Failed posts" value={d?.failedPosts} href="/posts" tone={d?.failedPosts ? "danger" : undefined} />
      </div>

      <div className="mx-4 mb-3">
        <Link href="/comments" className="press flex items-center justify-between rounded-xl bg-card px-4 py-3.5 text-[17px]">
          <span>💬 Comments</span>
          <span className="text-muted">Moderate, reply, sentiment ›</span>
        </Link>
      </div>
      <div className="mx-4 mb-6">
        <Link href="/analytics" className="press flex items-center justify-between rounded-xl bg-card px-4 py-3.5 text-[17px]">
          <span>📊 Analytics</span>
          <span className="text-muted">Followers, engagement, best posts ›</span>
        </Link>
      </div>

      <Group title="Accounts">
        {d && d.accounts.length === 0 && <Row title="Connect an Instagram account" subtitle="Settings → Connect" />}
        {d?.accounts.map((a) => (
          <Row
            key={a.id}
            title={`@${a.username}`}
            subtitle={`${a.actionsToday} / ${a.dailyActionLimit} actions today`}
            right={<Badge tone={a.paused ? "danger" : "ok"}>{a.paused ? "Paused" : "Running"}</Badge>}
          />
        ))}
      </Group>

      {anyRunning && (
        <div className="mx-4 mb-6">
          <Button
            variant="danger"
            disabled={stopAll.isPending}
            onClick={() => {
              if (confirm("Pause automation on ALL accounts?")) stopAll.mutate();
            }}
          >
            Emergency stop
          </Button>
        </div>
      )}

      <Group title="Recent activity">
        {d && d.recent.length === 0 && <Empty icon="🕊️" text="Nothing yet. Activity shows here once rules start firing." />}
        {d?.recent.map((a) => (
          <Row
            key={a.id}
            title={activityLabel(a.kind)}
            subtitle={[a.account ? `@${a.account.username}` : null, summary(a)].filter(Boolean).join(" · ")}
            right={<span className="text-[13px] text-muted">{timeAgo(a.createdAt)}</span>}
          />
        ))}
        {d && d.recent.length > 0 && (
          <Link href="/activity" className="block px-4 py-3 text-[17px] text-accent">
            See all activity
          </Link>
        )}
      </Group>
    </>
  );
}

function summary(a: Activity): string {
  const d = a.detail ?? {};
  return String(d.reply ?? d.dm ?? d.text ?? d.message ?? d.error ?? "");
}

function Stat({ label, value, href, tone }: { label: string; value?: number; href: string; tone?: "danger" }) {
  return (
    <Link href={href} className="press rounded-xl bg-card p-3">
      <div className={`text-[26px] font-bold ${tone === "danger" ? "text-danger" : ""}`}>{value ?? "–"}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </Link>
  );
}
