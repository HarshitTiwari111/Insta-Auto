"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, timeAgo, type DmMessage } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Empty, ErrorNote, Group, Header, Row } from "@/components/ui";
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

      {open && (
        <Chat
          title={nameOf(thread, open)}
          username={thread.find((m) => m.username)?.username ?? null}
          thread={thread}
          windowLeft={windowLeft}
          draft={draft}
          setDraft={setDraft}
          sending={send.isPending}
          error={send.error}
          onSend={() => send.mutate()}
          onClose={() => {
            setOpen(null);
            send.reset();
          }}
        />
      )}
    </>
  );
}

function formatLeft(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Show a centred time label when the next message is from another hour (like Instagram). */
const GAP_MS = 60 * 60_000;
const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Full-screen Instagram-style DM thread. */
function Chat({
  title,
  username,
  thread,
  windowLeft,
  draft,
  setDraft,
  sending,
  error,
  onSend,
  onClose,
}: {
  title: string;
  username: string | null;
  thread: DmMessage[];
  windowLeft: number;
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  error: unknown;
  onSend: () => void;
  onClose: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const oldestFirst = [...thread].reverse();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread.length]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-bg">
      <div className="pt-safe pb-safe flex h-dvh w-full max-w-xl flex-col">
        {/* top bar */}
        <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
          <button onClick={onClose} aria-label="Back" className="press p-1">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <Avatar name={username ?? "?"} size={34} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold">{title}</div>
            <div className="text-[12px] text-muted">Instagram</div>
          </div>
        </div>

        {/* messages */}
        <div className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          <div className="mb-4 flex flex-col items-center gap-2 pt-4 text-center">
            <Avatar name={username ?? "?"} size={84} />
            <div className="text-[18px] font-semibold">{title}</div>
            <div className="text-[13px] text-muted">Instagram</div>
          </div>
          {oldestFirst.map((m, i) => {
            const prev = oldestFirst[i - 1];
            const showTime = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GAP_MS;
            const out = m.direction === "OUT";
            return (
              <div key={m.id} className="flex flex-col">
                {showTime && <div className="my-3 text-center text-[12px] text-muted">{stamp(m.createdAt)}</div>}
                <div
                  title={stamp(m.createdAt)}
                  className={`max-w-[75%] whitespace-pre-line break-words rounded-[22px] px-3.5 py-2 text-[15px] leading-snug ${
                    out ? "ig-bubble self-end text-white" : "self-start bg-fill"
                  }`}
                >
                  {m.text ?? "(attachment)"}
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>

        {/* composer */}
        <div className="border-t border-line px-3 py-2.5">
          <ErrorNote error={error} />
          {windowLeft > 0 ? (
            <>
              <form
                className="flex items-end gap-2 rounded-full border border-line px-4 py-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim() && !sending) onSend();
                }}
              >
                <textarea
                  className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted"
                  rows={1}
                  maxLength={1000}
                  value={draft}
                  placeholder="Message…"
                  onChange={(e) => setDraft(e.target.value)}
                />
                {draft.trim() && (
                  <button type="submit" disabled={sending} className="shrink-0 py-1.5 text-[15px] font-semibold text-accent disabled:opacity-40">
                    {sending ? "…" : "Send"}
                  </button>
                )}
              </form>
              <p className="mt-1.5 text-center text-[12px] text-muted">Reply window closes in {formatLeft(windowLeft)}</p>
            </>
          ) : (
            <p className="py-1.5 text-center text-[13px] text-muted">
              You can reply once they message you again (Instagram allows replies within 24h of their last message).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
