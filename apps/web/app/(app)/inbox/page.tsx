"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, timeAgo, type DmMessage } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Empty, ErrorNote, Group, Header, Row, Sheet } from "@/components/ui";
import { Avatar } from "@/components/Avatar";

/** Best name for a conversation: any message in it that knows the @username, else the short ID. */
const nameOf = (list: DmMessage[], igsid: string) => {
  const u = list.find((m) => m.username)?.username;
  return u ? `@${u}` : `Instagram user …${igsid.slice(-6)}`;
};

/** Meta: a reply is allowed only within 24h of the person's last message. */
const WINDOW_MS = 24 * 3600 * 1000;

export default function InboxPage() {
  const { accounts, selected, select } = useAccounts();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const qc = useQueryClient();

  const msgs = useQuery({
    queryKey: ["messages", selected?.id],
    queryFn: () => api<DmMessage[]>(`/accounts/${selected!.id}/messages`),
    enabled: Boolean(selected),
    refetchInterval: 20_000,
  });

  // newest-first list -> conversations keyed by the other person's IGSID
  const threads = useMemo(() => {
    const map = new Map<string, DmMessage[]>();
    for (const m of msgs.data ?? []) {
      const list = map.get(m.igsid) ?? [];
      list.push(m);
      map.set(m.igsid, list);
    }
    return [...map.entries()];
  }, [msgs.data]);

  const send = useMutation({
    mutationFn: () => api<DmMessage>(`/accounts/${selected!.id}/messages`, { method: "POST", json: { igsid: open, text: draft } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["messages", selected?.id] });
    },
  });

  if (!selected) {
    return (
      <>
        <Header title="Inbox" />
        <Empty icon="🔌" text="Connect an Instagram account in Settings first." />
      </>
    );
  }

  const thread = open ? threads.find(([id]) => id === open)?.[1] ?? [] : [];
  const lastIn = thread.find((m) => m.direction === "IN");
  const windowLeft = lastIn ? WINDOW_MS - (Date.now() - new Date(lastIn.createdAt).getTime()) : 0;

  return (
    <>
      <Header title="Inbox" />
      <AccountSwitcher accounts={accounts} selected={selected} onSelect={select} />
      <ErrorNote error={msgs.error} />
      {msgs.data?.length === 0 && (
        <Empty icon="📭" text="No DMs yet. Private DMs sent to commenters by your rules, and messages that reach the app, show up here." />
      )}
      {threads.length > 0 && (
        <Group footer="Tap a conversation to read it. You can reply here within 24h of their last message to you (Instagram's rule).">
          {threads.map(([igsid, list]) => {
            const last = list[0]!;
            return (
              <Row
                key={igsid}
                onClick={() => setOpen(igsid)}
                left={<Avatar name={(list.find((m) => m.username)?.username ?? "?")} size={40} />}
                title={nameOf(list, igsid)}
                subtitle={`${last.direction === "OUT" ? "You: " : ""}${last.text ?? "(attachment)"}`}
                right={<span className="text-[13px] text-muted">{timeAgo(last.createdAt)}</span>}
              />
            );
          })}
        </Group>
      )}

      <Sheet
        open={Boolean(open)}
        onClose={() => {
          setOpen(null);
          send.reset();
        }}
        title={open ? nameOf(thread, open) : "Conversation"}
      >
        <div className="flex flex-col gap-2 px-4">
          {[...thread].reverse().map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[16px] ${
                m.direction === "OUT" ? "self-end bg-accent text-white" : "self-start bg-card"
              }`}
            >
              {m.text ?? "(attachment)"}
              <div className={`mt-0.5 text-[11px] ${m.direction === "OUT" ? "text-white/70" : "text-muted"}`}>
                {new Date(m.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="mx-4 mt-4">
          <ErrorNote error={send.error} />
          {windowLeft > 0 ? (
            <form
              className="flex items-end gap-2 rounded-2xl border border-card-border bg-card p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() && !send.isPending) send.mutate();
              }}
            >
              <textarea
                className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[16px] outline-none placeholder:text-muted"
                rows={1}
                maxLength={1000}
                value={draft}
                placeholder="Message…"
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                disabled={!draft.trim() || send.isPending}
                className="press shrink-0 rounded-full bg-accent px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-40"
              >
                {send.isPending ? "…" : "Send"}
              </button>
            </form>
          ) : (
            <p className="px-2 text-center text-[13px] text-muted">
              24h reply window closed. You can reply again after they send a new message.
            </p>
          )}
          {windowLeft > 0 && (
            <p className="mt-1.5 px-2 text-[12px] text-muted">Reply window closes in {formatLeft(windowLeft)}</p>
          )}
        </div>
      </Sheet>
    </>
  );
}

function formatLeft(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
