"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Activity, type Rule } from "@/lib/api";
import { describeRule } from "@/lib/rules";
import { Badge, Button, ErrorNote, Group, Header, Row, Toggle } from "@/components/ui";
import { InstallHint } from "@/components/InstallHint";
import { Avatar } from "@/components/Avatar";

interface Dashboard {
  accounts: { id: string; username: string; profilePictureUrl: string | null; paused: boolean; dailyActionLimit: number; actionsToday: number }[];
  activeRules: number;
  pendingPosts: number;
  failedPosts: number;
  recent: Activity[];
}

export default function Home() {
  const qc = useQueryClient();
  const router = useRouter();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard"), refetchInterval: 30_000 });
  const stopAll = useMutation({
    mutationFn: () => api("/accounts/stop-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const d = dash.data;
  // Every account's rules (same cache as the Rules page)
  const ruleLists = useQueries({
    queries: (d?.accounts ?? []).map((a) => ({ queryKey: ["rules", a.id], queryFn: () => api<Rule[]>(`/accounts/${a.id}/rules`) })),
  });
  const allRules = ruleLists.flatMap((q, i) => (q.data ?? []).map((r) => ({ r, username: d!.accounts[i].username })));
  const toggle = useMutation({
    mutationFn: (id: string) => api(`/rules/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const openRules = (accountId: string) => {
    try {
      localStorage.setItem("ia:selectedAccount", accountId);
    } catch {
      /* ignore */
    }
    router.push("/rules");
  };
  const anyRunning = d?.accounts.some((a) => !a.paused);
  // Red dot on the heart only for activity newer than the last visit to /activity (per device)
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    try {
      setSeenAt(Number(localStorage.getItem("ia:activitySeen") ?? 0));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const hasNew = Boolean(d?.recent.some((a) => new Date(a.createdAt).getTime() > seenAt));

  return (
    <>
      <Header
        title="Instaauto"
        brand
        right={
          <Link href="/activity" aria-label="Activity" className="press relative block p-1">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.9 1.2-1.8 2.8-2.9 4.8-2.9 3.6 0 5.5 3.5 4.4 6.7-1.7 4.7-9.2 9.3-9.2 9.3z" />
            </svg>
            {hasNew && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-danger" />}
          </Link>
        }
      />
      <InstallHint />
      <ErrorNote error={dash.error} />

      <div className="mx-4 mb-6 grid grid-cols-3 gap-3">
        <Stat label="Active rules" value={d?.activeRules} href="/rules" />
        <Stat label="Scheduled" value={d?.pendingPosts} href="/posts" />
        <Stat label="Failed posts" value={d?.failedPosts} href="/posts" tone={d?.failedPosts ? "danger" : undefined} />
      </div>

      <div className="mx-4 mb-6 grid grid-cols-2 gap-3">
        <Shortcut href="/comments" icon="💬" title="Comments" subtitle="Reply & hide" />
        <Shortcut href="/analytics" icon="📊" title="Analytics" subtitle="Growth & posts" />
      </div>

      <section className="mx-4 mb-6">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[15px] font-semibold">Your rules</h2>
          <Link href="/rules" className="text-[14px] font-semibold text-accent">
            See all ›
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border border-card-border bg-card [&>*+*]:border-t [&>*+*]:border-line">
          {d && allRules.length === 0 && !ruleLists.some((q) => q.isLoading) && (
            <Row title="No rules yet" subtitle="Tap to make your first auto reply" onClick={() => router.push("/rules")} right={<span className="text-accent">＋</span>} />
          )}
          {allRules.slice(0, 6).map(({ r, username }) => (
            <Row
              key={r.id}
              onClick={() => openRules(r.accountId)}
              left={<span className="text-[20px]">{r.trigger === "DM" ? "📩" : "💬"}</span>}
              title={r.name}
              subtitle={<span className="line-clamp-2 whitespace-normal">{`@${username} · ${describeRule(r)}`}</span>}
              right={<Toggle label={`Enable ${r.name}`} on={r.enabled} onChange={() => toggle.mutate(r.id)} />}
            />
          ))}
        </div>
      </section>

      <Group title="Accounts">
        {d && d.accounts.length === 0 && <Row title="Connect an Instagram account" subtitle="Settings → Connect" />}
        {d?.accounts.map((a) => (
          <Row
            key={a.id}
            left={<Avatar src={a.profilePictureUrl} name={a.username} size={36} />}
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
    </>
  );
}

function Shortcut({ href, icon, title, subtitle }: { href: string; icon: string; title: string; subtitle: string }) {
  return (
    <Link href={href} className="press flex items-center gap-3 rounded-xl border border-card-border bg-card p-3">
      <span className="ig-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[20px]">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        <span className="block truncate text-[12px] text-muted">{subtitle}</span>
      </span>
    </Link>
  );
}

function Stat({ label, value, href, tone }: { label: string; value?: number; href: string; tone?: "danger" }) {
  return (
    <Link href={href} className="press rounded-xl border border-card-border bg-card p-3">
      <div className={`text-[26px] font-bold ${tone === "danger" ? "text-danger" : ""}`}>{value ?? "–"}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </Link>
  );
}
