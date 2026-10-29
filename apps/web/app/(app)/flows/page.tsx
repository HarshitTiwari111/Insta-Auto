"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AccountSwitcher, useAccounts } from "@/components/useAccounts";
import { Button, Empty, ErrorNote, Field, Group, Header, Row, Sheet, Toggle } from "@/components/ui";

interface FlowButton {
  title: string;
  next: string | null;
}
interface FlowStep {
  id: string;
  text: string;
  buttons: FlowButton[];
}
interface Flow {
  id: string;
  name: string;
  enabled: boolean;
  keywords: string[];
  steps: FlowStep[];
}
type Draft = Omit<Flow, "id">;

const newId = () => Math.random().toString(36).slice(2, 10);

/** Ready-made example so the first flow isn't a blank page. */
function example(): Draft {
  const start = newId();
  const price = newId();
  const services = newId();
  return {
    name: "Welcome menu",
    enabled: true,
    keywords: ["hi", "hello", "menu"],
    steps: [
      { id: start, text: "Hi! 👋 Launchigo me aapka swagat hai. Aap kya jaanna chahte hain?", buttons: [{ title: "Price", next: price }, { title: "Services", next: services }] },
      { id: price, text: "Hamare Google Ads packages ₹… se shuru hote hain. Team se baat karni hai?", buttons: [{ title: "Haan", next: null }, { title: "Menu", next: start }] },
      { id: services, text: "Hum Google Ads, Meta Ads aur SEO karte hain.", buttons: [{ title: "Price", next: price }] },
    ],
  };
}

export default function FlowsPage() {
  const qc = useQueryClient();
  const { accounts, selected, select } = useAccounts();
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const flows = useQuery({
    queryKey: ["flows", selected?.id],
    queryFn: () => api<Flow[]>(`/accounts/${selected!.id}/flows`),
    enabled: Boolean(selected),
  });
  const toggle = useMutation({
    mutationFn: (f: Flow) => api(`/flows/${f.id}`, { method: "PUT", json: { ...f, id: undefined, enabled: !f.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
  });

  if (!selected) {
    return (
      <>
        <Header title="Flows" />
        <Empty icon="🔌" text="Connect an Instagram account in Settings first." />
      </>
    );
  }

  return (
    <>
      <Header
        title="Chatbot flows"
        right={
          <button className="text-[17px] text-accent" onClick={() => setEditing({ draft: example() })}>
            New
          </button>
        }
      />
      <AccountSwitcher accounts={accounts} selected={selected} onSelect={select} />
      <ErrorNote error={flows.error ?? toggle.error} />
      {flows.data?.length === 0 && (
        <Empty icon="🤖" text="No flows yet. A flow starts when a DM contains its keyword, then guides the person step by step with buttons. Tap New for an example." />
      )}
      {!!flows.data?.length && (
        <Group footer="Flows answer before DM rules. Same 24h messaging window and limits apply.">
          {flows.data.map((f) => (
            <Row
              key={f.id}
              onClick={() => {
                const { id, ...draft } = f;
                setEditing({ id, draft });
              }}
              title={f.name}
              subtitle={`Starts on: ${f.keywords.join(", ")} · ${f.steps.length} steps`}
              right={<Toggle label={`Enable ${f.name}`} on={f.enabled} onChange={() => toggle.mutate(f)} />}
            />
          ))}
        </Group>
      )}
      <div className="mx-4">
        <Link href="/rules" className="block py-2 text-center text-[15px] text-accent">
          ‹ Back to rules
        </Link>
      </div>
      {editing && <FlowEditor accountId={selected.id} id={editing.id} initial={editing.draft} onClose={() => setEditing(null)} />}
    </>
  );
}

function FlowEditor({ accountId, id, initial, onClose }: { accountId: string; id?: string; initial: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [keywords, setKeywords] = useState(initial.keywords.join(", "));
  const done = () => {
    qc.invalidateQueries({ queryKey: ["flows"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { ...d, keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) };
      return id ? api(`/flows/${id}`, { method: "PUT", json: body }) : api(`/accounts/${accountId}/flows`, { method: "POST", json: body });
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api(`/flows/${id}`, { method: "DELETE" }), onSuccess: done });

  const setStep = (i: number, step: FlowStep) => setD({ ...d, steps: d.steps.map((s, j) => (j === i ? step : s)) });
  const removeStep = (i: number) => {
    const gone = d.steps[i]!.id;
    setD({
      ...d,
      steps: d.steps
        .filter((_, j) => j !== i)
        .map((s) => ({ ...s, buttons: s.buttons.map((b) => (b.next === gone ? { ...b, next: null } : b)) })),
    });
  };
  const stepName = (sid: string | null) => {
    const i = d.steps.findIndex((s) => s.id === sid);
    return i < 0 ? "End" : `Step ${i + 1}`;
  };

  return (
    <Sheet open onClose={onClose} title={id ? "Edit flow" : "New flow"}>
      <Group>
        <Field label="Flow name" value={d.name} onChange={(name) => setD({ ...d, name })} />
        <Field label="Starts when a DM contains (comma separated)" value={keywords} onChange={setKeywords} placeholder="hi, hello, menu" />
      </Group>

      {d.steps.map((s, i) => (
        <Group key={s.id} title={i === 0 ? "Step 1 · start" : `Step ${i + 1}`}>
          <Field label="Message" value={s.text} onChange={(text) => setStep(i, { ...s, text })} multiline />
          {s.buttons.map((b, bi) => (
            <div key={bi} className="flex items-center gap-2 px-4 py-2">
              <input
                className="min-w-0 flex-1 rounded-lg bg-line px-3 py-2 text-[15px] outline-none"
                maxLength={20}
                placeholder="Button text"
                value={b.title}
                onChange={(e) => setStep(i, { ...s, buttons: s.buttons.map((x, k) => (k === bi ? { ...x, title: e.target.value } : x)) })}
              />
              <span className="text-[13px] text-muted">→</span>
              <select
                className="rounded-lg bg-line px-2 py-2 text-[15px] outline-none"
                value={b.next ?? ""}
                onChange={(e) => setStep(i, { ...s, buttons: s.buttons.map((x, k) => (k === bi ? { ...x, next: e.target.value || null } : x)) })}
              >
                <option value="">End</option>
                {d.steps.map((t, ti) => (
                  <option key={t.id} value={t.id}>
                    Step {ti + 1}
                  </option>
                ))}
              </select>
              <button aria-label="Remove button" className="px-1 text-danger" onClick={() => setStep(i, { ...s, buttons: s.buttons.filter((_, k) => k !== bi) })}>
                ✕
              </button>
            </div>
          ))}
          <div className="flex justify-between px-4 py-2.5 text-[15px]">
            <button
              className="text-accent disabled:opacity-40"
              disabled={s.buttons.length >= 13}
              onClick={() => setStep(i, { ...s, buttons: [...s.buttons, { title: "", next: null }] })}
            >
              ＋ Add button
            </button>
            {d.steps.length > 1 && (
              <button className="text-danger" onClick={() => removeStep(i)}>
                Remove step
              </button>
            )}
          </div>
          {s.buttons.length > 0 && (
            <p className="px-4 pb-2 text-[12px] text-muted">{s.buttons.map((b) => `“${b.title || "…"}” → ${stepName(b.next)}`).join(" · ")}</p>
          )}
        </Group>
      ))}

      <div className="mx-4 mb-4">
        <Button variant="plain" onClick={() => setD({ ...d, steps: [...d.steps, { id: newId(), text: "", buttons: [] }] })}>
          ＋ Add step
        </Button>
      </div>
      <ErrorNote error={save.error ?? remove.error} />
      <div className="mx-4 space-y-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending || !d.name.trim()}>
          {save.isPending ? "Saving…" : "Save flow"}
        </Button>
        {id && (
          <Button variant="plain" onClick={() => confirm("Delete this flow?") && remove.mutate()}>
            <span className="text-danger">Delete flow</span>
          </Button>
        )}
      </div>
    </Sheet>
  );
}
