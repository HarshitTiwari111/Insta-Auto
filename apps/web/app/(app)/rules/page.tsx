"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadMedia } from "@/lib/upload";
import { api, type Rule } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Button, Empty, ErrorNote, Group, Header, Row, Segmented, Sheet, Toggle } from "@/components/ui";
import { MediaPicker, useAllMedia } from "@/components/MediaPicker";

type Draft = Omit<Rule, "id" | "accountId">;

const blank = (trigger: Rule["trigger"]): Draft => ({
  name: "",
  enabled: true,
  trigger,
  matchType: "KEYWORD",
  keywords: [],
  mediaIds: [],
  replyTemplates: [],
  privateReplyTemplates: [],
  hideComment: false,
  deleteComment: false,
  quickReplies: [],
  replyMediaUrl: null,
  aiReply: false,
  aiInstructions: null,
  priority: 100,
});

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export default function RulesPage() {
  const qc = useQueryClient();
  const { accounts, selected, select } = useAccounts();
  const [tab, setTab] = useState<Rule["trigger"]>("COMMENT");
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);

  const rules = useQuery({
    queryKey: ["rules", selected?.id],
    queryFn: () => api<Rule[]>(`/accounts/${selected!.id}/rules`),
    enabled: Boolean(selected),
  });
  const toggle = useMutation({
    mutationFn: (id: string) => api(`/rules/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  if (!selected) {
    return (
      <>
        <Header title="Rules" />
        <Empty icon="🔌" text="Connect an Instagram account in Settings first." />
      </>
    );
  }

  const list = (rules.data ?? []).filter((r) => r.trigger === tab);

  return (
    <>
      <Header
        title={<AccountSwitcher accounts={accounts} selected={selected} onSelect={select} inHeader />}
        right={
          <button className="text-[16px] font-semibold text-accent" onClick={() => setEditing({ draft: blank(tab) })}>
            ＋ New rule
          </button>
        }
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "COMMENT", label: "💬 Comment replies" },
          { value: "DM", label: "📩 DM replies" },
        ]}
      />
      <ErrorNote error={rules.error} />
      {tab === "DM" && (
        <div className="mx-4 mb-4">
          <Link href="/flows" className="press flex items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
            <span className="text-[18px]">🤖</span>
            <span className="min-w-0 flex-1 truncate text-[15px]">
              <span className="font-semibold">Chatbot flows</span>
              <span className="text-muted"> · DM menus</span>
            </span>
            <span className="text-muted">›</span>
          </Link>
        </div>
      )}

      {rules.data && list.length === 0 && (
        <Empty
          icon={tab === "COMMENT" ? "💬" : "📩"}
          text={
            tab === "COMMENT"
              ? "No rules yet. A rule replies for you automatically. Example: when someone comments “price”, reply “Check your DM 📩” and send them the price in a private DM. Tap ＋ New rule."
              : "No rules yet. Example: when someone DMs “hi”, reply with your price list. Tap ＋ New rule."
          }
        />
      )}

      {list.length > 0 && (
        <Group>
          {list.map((r) => (
            <Row
              key={r.id}
              onClick={() => {
                const { id, accountId: _a, ...draft } = r;
                setEditing({ id, draft });
              }}
              title={r.name}
              subtitle={<span className="line-clamp-2 whitespace-normal">{describe(r)}</span>}
              right={<Toggle label={`Enable ${r.name}`} on={r.enabled} onChange={() => toggle.mutate(r.id)} />}
            />
          ))}
        </Group>
      )}

      {editing && (
        <RuleEditor
          accountId={selected.id}
          id={editing.id}
          initial={editing.draft}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function describe(r: Rule): string {
  const what = r.trigger === "DM" ? "DMs" : "Comments";
  const where = r.trigger === "COMMENT" ? (r.mediaIds?.length ? ` on ${r.mediaIds.length} chosen post${r.mediaIds.length === 1 ? "" : "s"}` : "") : "";
  const when = r.matchType === "ANY" ? (r.trigger === "DM" ? "All DMs" : "All comments") : `${what} with ${r.keywords.map((k) => `“${k}”`).join(", ")}`;
  const acts = [
    r.deleteComment && "delete it",
    r.hideComment && "hide it",
    r.aiReply && "AI reply",
    !r.aiReply && !r.hideComment && !r.deleteComment && r.replyTemplates.length && "reply",
    r.privateReplyTemplates.length && "private DM",
    r.quickReplies?.length && "buttons",
  ].filter(Boolean);
  return `${when}${where} → ${acts.join(" + ")}`;
}

type Action = "reply" | "ai" | "hide" | "delete";

function RuleEditor({ accountId, id, initial, onClose }: { accountId: string; id?: string; initial: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [replies, setReplies] = useState(initial.replyTemplates.join("\n"));
  const [privateReplies, setPrivateReplies] = useState(initial.privateReplyTemplates.join("\n"));
  const [sendDm, setSendDm] = useState(initial.privateReplyTemplates.length > 0);
  const [buttons, setButtons] = useState<string[]>(initial.quickReplies ?? []);
  const [action, setAction] = useState<Action>(initial.deleteComment ? "delete" : initial.hideComment ? "hide" : initial.aiReply ? "ai" : "reply");
  const isComment = d.trigger === "COMMENT";
  const act: Action = !isComment && (action === "hide" || action === "delete") ? "reply" : action;
  const replying = act === "reply" || act === "ai";

  const media = useAllMedia(accountId, isComment);
  const [picking, setPicking] = useState(false);
  const chosen = (media.data ?? []).filter((m) => d.mediaIds.includes(m.id));

  // What is still missing, in plain words (Save stays off until it's empty)
  const missing =
    d.matchType === "KEYWORD" && keywords.length === 0
      ? "Add at least one word in step 3"
      : act === "reply" && !lines(replies).length
        ? "Write the reply in step 4"
        : act === "ai" && !d.aiInstructions?.trim()
          ? "Tell the AI about your business in step 4"
          : isComment && replying && sendDm && !lines(privateReplies).length
            ? "Write the private DM in step 5, or switch it off"
            : null;

  const save = useMutation({
    mutationFn: async () => {
      const name = d.name.trim() || (d.matchType === "ANY" ? (isComment ? "Every comment" : "Every DM") : `Reply to: ${keywords.join(", ")}`).slice(0, 100);
      const body: Draft = {
        ...d,
        name,
        keywords: d.matchType === "KEYWORD" ? keywords : [],
        aiReply: act === "ai",
        aiInstructions: act === "ai" ? d.aiInstructions?.trim() || null : d.aiInstructions,
        hideComment: isComment && act === "hide",
        deleteComment: isComment && act === "delete",
        replyTemplates: replying ? lines(replies) : [],
        privateReplyTemplates: isComment && replying && sendDm ? lines(privateReplies) : [],
        quickReplies: isComment ? [] : buttons,
        replyMediaUrl: isComment ? null : d.replyMediaUrl?.trim() || null,
        mediaIds: isComment ? d.mediaIds : [],
      };
      const saved = await (id ? api(`/rules/${id}`, { method: "PUT", json: body }) : api(`/accounts/${accountId}/rules`, { method: "POST", json: body }));
      // Every reply is also kept as a "saved reply" for reuse in other rules (no separate save step)
      try {
        const have = new Set((await api<MessageTemplate[]>("/templates")).map((t) => t.text.trim()));
        for (const text of [...body.replyTemplates, ...body.privateReplyTemplates].map((t) => t.trim().slice(0, 1000))) {
          if (!text || have.has(text)) continue;
          have.add(text);
          await api("/templates", { method: "POST", json: { name: text.slice(0, 30), text } });
        }
      } catch {
        /* saved replies are a convenience; the rule itself is saved */
      }
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["templates"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
  });

  let step = 0;
  const n = () => ++step;

  return (
    <Sheet open onClose={onClose} title={id ? "Edit rule" : "New rule"}>
      <Step n={n()} title="When someone…">
        <div className="overflow-hidden rounded-xl border border-card-border bg-card [&>*+*]:border-t [&>*+*]:border-line">
          <Choice on={isComment} onClick={() => setD({ ...d, trigger: "COMMENT" })} icon="💬" title="Comments" text="on my posts" />
          <Choice on={!isComment} onClick={() => setD({ ...d, trigger: "DM" })} icon="📩" title="Sends a DM" text="to my account" />
        </div>
      </Step>

      {isComment && (
        <Step n={n()} title="On which posts?">
          <button className="press flex w-full items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3 text-left" onClick={() => setPicking(true)}>
            {d.mediaIds.length === 0 ? (
              <span className="text-[16px]">All my posts &amp; reels</span>
            ) : (
              <>
                <span className="flex -space-x-2">
                  {chosen.slice(0, 4).map((m) => (
                    <img key={m.id} src={m.thumbnail_url ?? m.media_url} alt="" className="h-9 w-9 rounded-md border-2 border-card object-cover" />
                  ))}
                </span>
                <span className="text-[16px]">
                  {d.mediaIds.length} chosen post{d.mediaIds.length === 1 ? "" : "s"}
                </span>
              </>
            )}
            <span className="ml-auto text-[15px] font-semibold text-accent">Change ›</span>
          </button>
        </Step>
      )}
      {picking && (
        <MediaPicker
          accountId={accountId}
          selected={d.mediaIds}
          onClose={() => setPicking(false)}
          onDone={(mediaIds) => {
            setD({ ...d, mediaIds });
            setPicking(false);
          }}
        />
      )}

      <Step n={n()} title={isComment ? "Which comments?" : "Which messages?"}>
        <div className="overflow-hidden rounded-xl border border-card-border bg-card [&>*+*]:border-t [&>*+*]:border-line">
          <Choice on={d.matchType === "KEYWORD"} onClick={() => setD({ ...d, matchType: "KEYWORD" })} icon="🔑" title="With certain words" text="e.g. price, kitna" />
          <Choice on={d.matchType === "ANY"} onClick={() => setD({ ...d, matchType: "ANY" })} icon="🌐" title={isComment ? "Every comment" : "Every message"} text="no words needed" />
        </div>
        {d.matchType === "KEYWORD" && (
          <div className="mt-3">
            <ChipInput values={keywords} onChange={setKeywords} placeholder="Type a word and press Enter" more="Add another word…" />
          </div>
        )}
      </Step>

      <Step n={n()} title="What should happen?">
        <div className="overflow-hidden rounded-xl border border-card-border bg-card [&>*+*]:border-t [&>*+*]:border-line">
          <Choice on={act === "reply"} onClick={() => setAction("reply")} icon="✍️" title="My own reply" text="you write it" />
          <Choice on={act === "ai"} onClick={() => setAction("ai")} icon="✨" title="AI writes the reply" text="smart" />
          {isComment && <Choice on={act === "hide"} onClick={() => setAction("hide")} icon="🙈" title="Hide the comment" text="for spam" />}
          {isComment && <Choice on={act === "delete"} onClick={() => setAction("delete")} icon="🗑️" title="Delete the comment" text="for spam" />}
        </div>

        {act === "ai" && (
          <div className="mt-3">
            <Box
              label="About your business (AI uses only this)"
              value={d.aiInstructions ?? ""}
              onChange={(aiInstructions) => setD({ ...d, aiInstructions })}
              placeholder="e.g. Launchigo: Google Ads services in Lucknow. Prices are shared in DM. Reply politely in Hinglish."
            />
          </div>
        )}
        {replying && (
          <div className="mt-3">
            <Box
              label={act === "ai" ? "Backup reply (used only if AI is busy)" : isComment ? "Your reply (shown under their comment)" : "Your reply"}
              value={replies}
              onChange={setReplies}
              placeholder={isComment ? "Thanks {username}! Check your DMs 📩" : "Hi! Here is our price list: …"}
            />
            <TemplatePicker current={replies} onInsert={(t) => setReplies(replies.trim() ? `${replies.trim()}\n${t}` : t)} />
          </div>
        )}
      </Step>

      {isComment && replying && (
        <Step n={n()} title="Also send them a private DM?">
          <div className="flex items-center justify-between rounded-xl border border-card-border bg-card px-4 py-3">
            <span className="text-[15px]">Send a private message to the person who commented</span>
            <Toggle label="Send private DM" on={sendDm} onChange={setSendDm} />
          </div>
          {sendDm && (
            <div className="mt-3">
              <Box label="Private DM" value={privateReplies} onChange={setPrivateReplies} placeholder="Hi! Here are the details you asked for: …" />
              <TemplatePicker current={privateReplies} onInsert={(t) => setPrivateReplies(privateReplies.trim() ? `${privateReplies.trim()}\n${t}` : t)} />
            </div>
          )}
        </Step>
      )}

      {!isComment && replying && (
        <Step n={n()} title="Extras (optional)">
          <ChipInput values={buttons} onChange={setButtons} placeholder="Buttons (optional), e.g. Price, Services" more="Add another button…" max={13} maxLen={20} />
          <div className="mt-3 rounded-xl border border-card-border bg-card">
            <DmMedia url={d.replyMediaUrl} onChange={(replyMediaUrl) => setD({ ...d, replyMediaUrl })} />
          </div>
        </Step>
      )}

      <Step n={n()} title="Name & order (optional)">
        <Box
          single
          label="Rule name"
          value={d.name}
          onChange={(name) => setD({ ...d, name })}
          placeholder={d.matchType === "ANY" ? (isComment ? "Every comment" : "Every DM") : keywords.length ? `Reply to: ${keywords.join(", ")}` : "e.g. Price questions"}
        />
        <div className="mt-2">
          <Box
            single
            label="Order (1 = checked first)"
            value={String(d.priority)}
            onChange={(v) => setD({ ...d, priority: Number(v.replace(/\D/g, "")) || 0 })}
            placeholder="100"
          />
        </div>
      </Step>

      <ErrorNote error={save.error ?? remove.error} />
      <div className="mx-4 space-y-3">
        {missing && <p className="text-center text-[13px] text-muted">{missing}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || Boolean(missing)}>
          {save.isPending ? "Saving…" : "Save rule"}
        </Button>
        {id && (
          <Button variant="plain" onClick={() => confirm("Delete this rule?") && remove.mutate()}>
            <span className="text-danger">Delete rule</span>
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Numbered step: "1  When someone…" */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-[16px] font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One-line option row: icon, title, hint, radio circle on the right */
function Choice({ on, onClick, icon, title, text }: { on: boolean; onClick: () => void; icon: string; title: string; text: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className="press flex w-full items-center gap-3 px-4 py-3 text-left active:bg-fill">
      <span className="w-6 shrink-0 text-center text-[18px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[15px]">
        <span className="font-semibold">{title}</span>
        <span className="text-muted"> · {text}</span>
      </span>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-accent" : "border-line"}`}>
        {on && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
      </span>
    </button>
  );
}

/** Labelled text box: one compact row when `single`, otherwise label above a multi-line box */
function Box({ label, value, onChange, placeholder, single }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; single?: boolean }) {
  if (single)
    return (
      <label className="flex items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-2.5">
        <span className="shrink-0 text-[14px] text-muted">{label}</span>
        <input className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none placeholder:text-muted" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  return (
    <label className="block rounded-xl border border-card-border bg-card px-4 py-2.5">
      <span className="mb-0.5 block text-[13px] text-muted">{label}</span>
      <textarea
        className="min-h-[72px] w-full resize-y bg-transparent py-1 outline-none placeholder:text-muted"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Words as chips: type and press Enter (or comma) to add, ✕ to remove. */
function ChipInput({ values, onChange, placeholder, more = "Add another…", max = 50, maxLen = 100 }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; more?: string; max?: number; maxLen?: number }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const words = raw.split(",").map((w) => w.trim().slice(0, maxLen)).filter(Boolean);
    const next = [...values];
    for (const w of words) if (!next.some((x) => x.toLowerCase() === w.toLowerCase()) && next.length < max) next.push(w);
    onChange(next);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card px-3 py-2.5">
      {values.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-full bg-fill py-1 pl-3 pr-2 text-[14px]">
          {v}
          <button aria-label={`Remove ${v}`} className="px-1 text-muted" onClick={() => onChange(values.filter((x) => x !== v))}>
            ✕
          </button>
        </span>
      ))}
      <input
        className="min-w-[140px] flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted"
        value={text}
        placeholder={values.length ? more : placeholder}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (text.trim()) add(text);
          } else if (e.key === "Backspace" && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
    </div>
  );
}

/** Photo / video sent after the DM text: upload from device or paste a public https URL. */
function DmMedia({ url, onChange }: { url: string | null; onChange: (u: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-[14px] text-muted">Photo / video</span>
      {url ? (
        <div className="flex items-center gap-3">
          {/\.(mp4|mov)(\?|$)/i.test(url) ? (
            <video src={url} className="h-10 w-10 rounded-lg object-cover" muted preload="metadata" />
          ) : (
            <img src={url} alt="" className="h-10 w-10 rounded-lg object-cover" />
          )}
          <button className="text-[14px] text-danger" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      ) : (
        <label className={`inline-block cursor-pointer text-[14px] font-semibold text-accent ${busy ? "opacity-40" : ""}`}>
          {busy ? "Uploading…" : "＋ Add"}
          <input
            type="file"
            className="hidden"
            accept="image/*,video/mp4,video/quicktime"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                onChange((await uploadMedia(f)).url);
              } catch (x) {
                setErr(x as Error);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {err && <span className="w-full text-[13px] text-danger">{err.message}</span>}
    </div>
  );
}

interface MessageTemplate {
  id: string;
  name: string;
  text: string;
}

/**
 * Templates library: tap a saved template to add it as one more reply line (one line = one variant).
 * "Save" stores the box's last line as a new template for every rule.
 */
function TemplatePicker({ current, onInsert }: { current: string; onInsert: (text: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["templates"], queryFn: () => api<MessageTemplate[]>("/templates") });
  const drop = useMutation({
    mutationFn: (id: string) => api(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
  const inBox = new Set(lines(current));
  const options = (list.data ?? []).filter((t) => !inBox.has(t.text.trim()));
  if (!options.length) return null;
  return (
    <div className="mt-2 flex items-center gap-2 px-1">
      <span className="shrink-0 text-[13px] text-muted">Use a saved reply:</span>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {options.map((t) => (
          <span key={t.id} className="flex shrink-0 items-center gap-1.5 rounded-full border border-card-border bg-card py-1 pl-3 pr-2 text-[13px]" title={t.text}>
            <button onClick={() => onInsert(t.text)}>{t.name}</button>
            <button aria-label={`Delete ${t.name}`} className="text-muted" onClick={() => confirm(`Delete saved reply “${t.name}”?`) && drop.mutate(t.id)}>
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
