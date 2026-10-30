"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, timeAgo, type Activity } from "@/lib/api";
import { activityLabel } from "@/lib/labels";
import { Empty, ErrorNote, Group, Header, Row } from "@/components/ui";

export default function ActivityPage() {
  const q = useQuery({ queryKey: ["activity"], queryFn: () => api<Activity[]>("/activity?limit=200"), refetchInterval: 30_000 });
  useEffect(() => {
    try {
      localStorage.setItem("ia:activitySeen", String(Date.now()));
    } catch {
      /* storage unavailable */
    }
  }, [q.data]);
  return (
    <>
      <Header
        title="Activity"
        right={
          <Link href="/" className="text-accent">
            Done
          </Link>
        }
      />
      <ErrorNote error={q.error} />
      {q.data?.length === 0 && <Empty icon="🕊️" text="No activity yet." />}
      {!!q.data?.length && (
        <Group>
          {q.data.map((a) => {
            const d = a.detail ?? {};
            const text = String(d.reply ?? d.dm ?? d.text ?? d.message ?? d.error ?? "");
            return (
              <Row
                key={a.id}
                title={activityLabel(a.kind)}
                subtitle={[a.account ? `@${a.account.username}` : null, text].filter(Boolean).join(" · ")}
                right={<span className="text-[13px] text-muted">{timeAgo(a.createdAt)}</span>}
              />
            );
          })}
        </Group>
      )}
    </>
  );
}
