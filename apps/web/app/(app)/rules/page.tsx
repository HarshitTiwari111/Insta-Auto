"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadMedia } from "@/lib/upload";
import { api, type Rule } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Button, Empty, ErrorNote, Field, Group, Header, Row, Segmented, Sheet, Toggle } from "@/components/ui";
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
        title="Rules"
        right={
          <button className="text-[17px] text-accent" onClick={() => setEditing({ draft: blank(tab) })}>
            New
          </button>
        }
      />
      <AccountSwitcher accounts={accounts} selected={selected} onSelect={select} />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "COMMENT", label: "Comments" },
          { value: "DM", label: "DMs" },
        ]}
      />
      <ErrorNote error={rules.error} />
      {tab === "DM" && (
        <div className="mx-4 mb-4">
          <Link href="/flows" className="press flex items-center justify-between rounded-xl border border-card-border bg-card px-4 py-3.5 text-[17px]">
            <span>🤖 Chatbot flows</span>
            <span className="text-muted">Step-by-step DM menus ›</span>
          </Link>
        </div>
      )}

      {rules.data && list.length === 0 && (
        <Empty
          icon={tab === "COMMENT" ? "💬" : "📩"}
          text={
            tab === "COMMENT"
              ? "No comment rules. Example: keyword “price” → reply under the comment + send a private DM."
              : "No DM rules. Example: keyword “hi” → auto reply with your FAQ."
          }
        />
      )}

      {list.length > 0 && (
        <Group footer="Checked top to bottom (lower priority number first). First match wins.">
          {list.map((r) => (
            <Row
              key={r.id}
              onClick={() => {
                const { id, accountId: _a, ...draft } = r;
                setEditing({ id, draft });
              }}
              title={r.name}
              subtitle={describe(r)}
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
  const on = r.trigger === "COMMENT" && r.mediaIds?.length ? ` on ${r.mediaIds.length} post${r.mediaIds.length === 1 ? "" : "s"}` : "";
  const when = (r.matchType === "ANY" ? "Any message" : `Contains: ${r.keywords.join(", ")}`) + on;
  const acts = [
    r.deleteComment && "delete",
    r.hideComment && "hide",
    r.aiReply && (r.trigger === "DM" ? "AI reply" : "AI public reply"),
    !r.aiReply && r.replyTemplates.length && (r.trigger === "DM" ? "reply" : "public reply"),
    r.privateReplyTemplates.length && "private DM",
    r.quickReplies?.length && `${r.quickReplies.length} buttons`,
  ].filter(Boolean);
  return `${when} → ${acts.join(" + ")}`;
}

function RuleEditor({ accountId, id, initial, onClose }: { accountId: string; id?: string; initial: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [keywords, setKeywords] = useState(initial.keywords.join(", "));
  const [replies, setReplies] = useState(initial.replyTemplates.join("\n"));
  const [privateReplies, setPrivateReplies] = useState(initial.privateReplyTemplates.join("\n"));
  const [buttons, setButtons] = useState((initial.quickReplies ?? []).join(", "));
  const isComment = d.trigger === "COMMENT";

  const media = useAllMedia(accountId, isComment);
  const [picking, setPicking] = useState(false);
  const chosen = (media.data ?? []).filter((m) => d.mediaIds.includes(m.id));

  const save = useMutation({
    mutationFn: () => {
      const body: Draft = {
        ...d,
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        replyTemplates: lines(replies),
        aiInstructions: d.aiReply ? d.aiInstructions?.trim() || null : d.aiInstructions,
        privateReplyTemplates: isComment ? lines(privateReplies) : [],
        hideComment: isComment ? d.hideComment : false,
        deleteComment: isComment ? d.deleteComment : false,
        quickReplies: isComment ? [] : buttons.split(",").map((b) => b.trim()).filter(Boolean),
        replyMediaUrl: isComment ? null : d.replyMediaUrl?.trim() || null,
        mediaIds: isComment ? d.mediaIds : [],
      };
      return id
        ? api(`/rules/${id}`, { method: "PUT", json: body })
        : api(`/accounts/${accountId}/rules`, { method: "POST", json: body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
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

  return (
    <Sheet open onClose={onClose} title={id ? "Edit rule" : "New rule"}>
      <Segmented
        value={d.trigger}
        onChange={(trigger) => setD({ ...d, trigger })}
        options={[
          { value: "COMMENT", label: "On comment" },
          { value: "DM", label: "On DM" },
        ]}
      />
      <Group>
        <Field label="Rule name" value={d.name} onChange={(name) => setD({ ...d, name })} placeholder="e.g. Price enquiries" />
      </Group>

      <Group title="When">
        <Row
          title="Match every message"
          right={<Toggle label="Match any" on={d.matchType === "ANY"} onChange={(v) => setD({ ...d, matchType: v ? "ANY" : "KEYWORD" })} />}
        />
        {d.matchType === "KEYWORD" && (
          <Field label="Keywords (comma separated, any one matches)" value={keywords} onChange={setKeywords} placeholder="price, kitna, cost" />
        )}
        {isComment && (
          <button className="press block w-full px-4 py-2.5 text-left" onClick={() => setPicking(true)}>
            <span className="mb-1 block text-[13px] text-muted">Runs on</span>
            <span className="flex items-center gap-2">
              {d.mediaIds.length === 0 ? (
                <span className="text-[16px]">All posts &amp; reels</span>
              ) : (
                <>
                  <span className="flex -space-x-2">
                    {chosen.slice(0, 4).map((m) => (
                      <img key={m.id} src={m.thumbnail_url ?? m.media_url} alt="" className="h-9 w-9 rounded-md border-2 border-card object-cover" />
                    ))}
                  </span>
                  <span className="text-[16px]">
                    {d.mediaIds.length} selected post{d.mediaIds.length === 1 ? "" : "s"}
                  </span>
                </>
              )}
              <span className="ml-auto text-[15px] font-semibold text-accent">Choose ›</span>
            </span>
          </button>
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
      </Group>

      <Group
        title="Then"
        footer={
          isComment
            ? "One line = one variant (picked at random). {username} = commenter. Private DM: Meta allows 1 per comment, within 7 days."
            : "One line = one variant (picked at random). Sent only inside Meta's 24h window after their message."
        }
      >
        {isComment && (
          <Row
            title="Delete the comment"
            subtitle="Spam: removes it completely (no reply, no hide)"
            right={<Toggle label="Delete comment" on={d.deleteComment} onChange={(deleteComment) => setD({ ...d, deleteComment })} />}
          />
        )}
        {isComment && !d.deleteComment && (
          <Row
            title="Hide the comment"
            subtitle="For spam / blacklist words (no public reply)"
            right={<Toggle label="Hide comment" on={d.hideComment} onChange={(hideComment) => setD({ ...d, hideComment })} />}
          />
        )}
        {!(isComment && (d.hideComment || d.deleteComment)) && (
          <Row
            title="AI reply (Gemini)"
            subtitle="AI reads the message and writes the reply"
            right={<Toggle label="AI reply" on={d.aiReply} onChange={(aiReply) => setD({ ...d, aiReply })} />}
          />
        )}
        {!(isComment && (d.hideComment || d.deleteComment)) && d.aiReply && (
          <Field
            label="About your business (AI uses only this)"
            value={d.aiInstructions ?? ""}
            onChange={(aiInstructions) => setD({ ...d, aiInstructions })}
            multiline
            placeholder="e.g. Launchigo: digital marketing services in Lucknow. Prices are shared in DM. Reply politely in Hinglish."
          />
        )}
        {!(isComment && (d.hideComment || d.deleteComment)) && (
          <TemplatePicker current={replies} onInsert={(t) => setReplies(replies.trim() ? `${replies.trim()}\n${t}` : t)} />
        )}
        {!(isComment && (d.hideComment || d.deleteComment)) && (
          <Field
            label={
              d.aiReply
                ? "Backup reply (used if AI is busy)"
                : isComment
                  ? "Public reply under the comment"
                  : "DM reply"
            }
            value={replies}
            onChange={setReplies}
            multiline
            placeholder={isComment ? "Thanks {username}! Check your DMs 📩" : "Hi! Here is our price list: …"}
          />
        )}
        {!isComment && <DmMedia url={d.replyMediaUrl} onChange={(replyMediaUrl) => setD({ ...d, replyMediaUrl })} />}
        {!isComment && (
          <Field
            label="Quick reply buttons (comma separated, max 13, 20 letters each)"
            value={buttons}
            onChange={setButtons}
            placeholder="Price, Services, Talk to team"
          />
        )}
        {isComment && !d.deleteComment && (
          <TemplatePicker
            current={privateReplies}
            forDm
            onInsert={(t) => setPrivateReplies(privateReplies.trim() ? `${privateReplies.trim()}\n${t}` : t)}
          />
        )}
        {isComment && !d.deleteComment && (
          <Field label="Private DM to the commenter" value={privateReplies} onChange={setPrivateReplies} multiline placeholder="Hi! Here are the details you asked for: …" />
        )}
      </Group>

      <Group>
        <Field label="Priority (lower runs first)" type="number" value={String(d.priority)} onChange={(v) => setD({ ...d, priority: Number(v) || 0 })} />
      </Group>

      <ErrorNote error={save.error ?? remove.error} />
      <div className="mx-4 space-y-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending || !d.name}>
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

/** Photo / video sent after the DM text: upload from device or paste a public https URL. */
function DmMedia({ url, onChange }: { url: string | null; onChange: (u: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <div className="px-4 py-2.5">
      <span className="mb-1 block text-[13px] text-muted">Photo / video with the reply (optional)</span>
      {url ? (
        <div className="flex items-center gap-3">
          {/\.(mp4|mov)(\?|$)/i.test(url) ? (
            <video src={url} className="h-16 w-16 rounded-lg object-cover" muted preload="metadata" />
          ) : (
            <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
          )}
          <button className="text-[15px] text-danger" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      ) : (
        <label className={`inline-block cursor-pointer text-[16px] text-accent ${busy ? "opacity-40" : ""}`}>
          {busy ? "Uploading…" : "📷 Upload photo / video"}
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
      {err && <p className="mt-1 text-[14px] text-danger">{err.message}</p>}
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
function TemplatePicker({ current, onInsert, forDm }: { current: string; onInsert: (text: string) => void; forDm?: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["templates"], queryFn: () => api<MessageTemplate[]>("/templates") });
  const add = useMutation({
    mutationFn: (body: { name: string; text: string }) => api("/templates", { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
  const drop = useMutation({
    mutationFn: (id: string) => api(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
  const last = current.split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
  return (
    <div className="px-4 pt-2.5">
      <span className="mb-1 block text-[13px] text-muted">{forDm ? "Templates for the DM" : "Templates library"} (tap to add)</span>
      <div className="flex flex-wrap gap-2">
        {list.data?.map((t) => (
          <span key={t.id} className="flex items-center gap-1 rounded-full bg-fill px-3 py-1.5 text-[14px]" title={t.text}>
            <button onClick={() => onInsert(t.text)}>{t.name}</button>
            <button aria-label={`Delete ${t.name}`} className="text-muted" onClick={() => confirm(`Delete template “${t.name}”?`) && drop.mutate(t.id)}>
              ✕
            </button>
          </span>
        ))}
        <button
          className="rounded-full border border-line px-3 py-1.5 text-[14px] text-accent"
          onClick={() => {
            if (!last) return alert("Write a reply in the box below first, then save it as a template.");
            const name = prompt("Template name:", last.slice(0, 30))?.trim();
            if (name) add.mutate({ name, text: last });
          }}
        >
          ＋ Save last line
        </button>
      </div>
      {(add.error || drop.error) && <p className="mt-1 text-[13px] text-danger">{((add.error ?? drop.error) as Error).message}</p>}
    </div>
  );
}
