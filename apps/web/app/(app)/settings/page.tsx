"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Account } from "@/lib/api";
import { disablePush, enablePush, pushEnabled } from "@/lib/push";
import { useAccounts } from "@/components/useAccounts";
import { Badge, Button, ErrorNote, Field, Group, Header, Row, Segmented, Sheet, Toggle } from "@/components/ui";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { accounts, error } = useAccounts();
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [push, setPush] = useState(false);
  const [pushErr, setPushErr] = useState<unknown>(null);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("connected")) setBanner({ ok: true, text: `Connected @${p.get("connected")}` });
    if (p.get("ig_error")) setBanner({ ok: false, text: `Instagram: ${p.get("ig_error")}` });
    if (p.size) history.replaceState(null, "", "/settings");
    pushEnabled().then(setPush).catch(() => setPush(false));
  }, []);

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/ig/connect"),
    onSuccess: ({ url }) => {
      location.href = url;
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<Account, "paused" | "dailyActionLimit">> }) =>
      api(`/accounts/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      location.href = "/login";
    },
  });

  async function togglePush(on: boolean) {
    setPushErr(null);
    try {
      if (on) await enablePush();
      else await disablePush();
      setPush(on);
    } catch (e) {
      setPushErr(e);
    }
  }

  return (
    <>
      <Header title="Settings" />
      {banner && (
        <p className={`mx-4 mb-4 rounded-xl px-4 py-3 text-[15px] ${banner.ok ? "bg-ok/15 text-ok" : "bg-danger/10 text-danger"}`}>
          {banner.text}
        </p>
      )}
      <ErrorNote error={error ?? connect.error ?? patch.error} />

      <Group title="Instagram accounts" footer="Business or Creator accounts only. Tap an account for limits, reconnect or removal.">
        {accounts.map((a) => (
          <Row
            key={a.id}
            onClick={() => setEditing(a)}
            title={`@${a.username}`}
            subtitle={`${a.paused ? "Paused" : "Running"} · ${
              a.authType === "FACEBOOK" ? "via Facebook Page" : `token expires ${new Date(a.tokenExpiresAt).toLocaleDateString()}`
            }${a.webhooksSubscribed ? "" : " · webhooks off"}`}
            right={<Toggle label={`Run @${a.username}`} on={!a.paused} onChange={(run) => patch.mutate({ id: a.id, body: { paused: !run } })} />}
          />
        ))}
        <Row onClick={() => connect.mutate()} title={<span className="text-accent">＋ Connect Instagram account</span>} />
      </Group>

      <Group title="Notifications" footer="iPhone: works only from the Home Screen app (iOS 16.4+).">
        <Row title="Push notifications" subtitle="New DMs, failed posts, reconnect alerts" right={<Toggle label="Push" on={push} onChange={togglePush} />} />
        {push && <Row onClick={() => api("/push/test", { method: "POST" })} title={<span className="text-accent">Send test notification</span>} />}
      </Group>
      <ErrorNote error={pushErr} />

      <Group>
        <Link href="/activity" className="block">
          <Row title="Activity log" right={<span className="text-muted">›</span>} />
        </Link>
        <Row onClick={() => logout.mutate()} title="Sign out" danger />
      </Group>

      {editing && <AccountSheet account={editing} onClose={() => setEditing(null)} onReconnect={() => connect.mutate()} />}
    </>
  );
}

function AccountSheet({ account, onClose, onReconnect }: { account: Account; onClose: () => void; onReconnect: () => void }) {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(String(account.dailyActionLimit));
  const [hourly, setHourly] = useState(String(account.hourlyActionLimit));
  const [start, setStart] = useState(account.workStartHour === null ? "" : String(account.workStartHour));
  const [end, setEnd] = useState(account.workEndHour === null ? "" : String(account.workEndHour));
  const [tz, setTz] = useState(account.timezone);
  const [spamFilter, setSpamFilter] = useState(account.aiSpamFilter);
  const [speed, setSpeed] = useState(account.replySpeed);
  const [blocked, setBlocked] = useState(account.blocklist.join("\n"));
  const [blockedHide, setBlockedHide] = useState(account.blocklistHide);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(`/accounts/${account.id}`, {
        method: "PATCH",
        json: {
          dailyActionLimit: Number(limit),
          hourlyActionLimit: Number(hourly),
          workStartHour: start === "" || end === "" ? null : Number(start),
          workEndHour: start === "" || end === "" ? null : Number(end),
          timezone: tz.trim(),
          aiSpamFilter: spamFilter,
          replySpeed: speed,
          blocklist: blocked.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean),
          blocklistHide: blockedHide,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  const backup = useMutation({
    mutationFn: () => api<object>(`/backup?accountId=${account.id}`),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `instaauto-backup-${account.username}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const restore = useMutation({
    mutationFn: async (file: File) =>
      api<{ rules: number; skippedRules: number; hashtagSets: number }>("/restore", {
        method: "POST",
        json: { accountId: account.id, backup: JSON.parse(await file.text()) },
      }),
    onSuccess: (r) => {
      setRestoreMsg(`Restored ${r.rules} rules (${r.skippedRules} already existed) and ${r.hashtagSets} hashtag sets.`);
      qc.invalidateQueries();
    },
  });
  const resub = useMutation({ mutationFn: () => api(`/accounts/${account.id}/resubscribe`, { method: "POST" }), onSuccess: () => qc.invalidateQueries() });
  const remove = useMutation({
    mutationFn: () => api(`/accounts/${account.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });

  return (
    <Sheet open onClose={onClose} title={`@${account.username}`}>
      <Group footer="Max automated replies, hides and DMs. Daily (UTC): automation stops for the day. Hourly: extra comments/DMs wait for the next hour.">
        <Field label="Daily action limit" type="number" value={limit} onChange={setLimit} />
        <Row title="Used today" right={<Badge>{account.actionsToday}</Badge>} />
        <Field label="Hourly action limit" type="number" value={hourly} onChange={setHourly} />
      </Group>
      <Group title="Reply speed" footer="Medium / Slow wait a random 20–60 s / 1–3 min before replying, so replies look human.">
        <div className="pt-3">
          <Segmented
            value={speed}
            onChange={setSpeed}
            options={[
              { value: "fast", label: "Fast" },
              { value: "medium", label: "Medium" },
              { value: "slow", label: "Slow" },
            ]}
          />
        </div>
      </Group>
      <Group
        title="Blocked accounts"
        footer="The app never auto-replies to these usernames (comments and DMs). One per line. You can also tap Block on the Comments page."
      >
        <Field label="Usernames" value={blocked} onChange={setBlocked} multiline placeholder={"spammer_123\ncompetitor.page"} />
        <Row title="Also hide their comments" right={<Toggle label="Hide blocked comments" on={blockedHide} onChange={setBlockedHide} />} />
      </Group>
      <Group footer="AI checks every new comment and hides spam (links, promotions, bots) before your rules run. Uses Gemini.">
        <Row title="AI spam filter" right={<Toggle label="AI spam filter" on={spamFilter} onChange={setSpamFilter} />} />
      </Group>
      <Group
        title="Working hours"
        footer="Automation runs only between these hours (your time zone). Comments/DMs that arrive outside wait and are answered when the hours start. Note: Instagram allows DM replies only within 24h."
      >
        <label className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[17px]">From</span>
          <select className="bg-transparent text-[17px] outline-none" value={start} onChange={(e) => setStart(e.target.value)}>
            <option value="">Always on</option>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[17px]">Until</span>
          <select className="bg-transparent text-[17px] outline-none" value={end} onChange={(e) => setEnd(e.target.value)}>
            <option value="">Always on</option>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
        </label>
        <Field label="Time zone" value={tz} onChange={setTz} placeholder="Asia/Kolkata" />
      </Group>
      <Group title="Backup" footer="Backup = rules, hashtag sets and limits as a file. Restore adds rules that don't exist yet (same name = skipped).">
        <Row onClick={() => backup.mutate()} title={<span className="text-accent">{backup.isPending ? "Preparing…" : "Download backup"}</span>} />
        <label className="press block cursor-pointer px-4 py-3 text-[17px] text-accent">
          {restore.isPending ? "Restoring…" : "Restore from backup file"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) restore.mutate(f);
              e.target.value = "";
            }}
          />
        </label>
        {restoreMsg && <p className="px-4 py-2 text-[14px] text-ok">{restoreMsg}</p>}
      </Group>
      <Group>
        <Row title="Webhooks" right={<Badge tone={account.webhooksSubscribed ? "ok" : "danger"}>{account.webhooksSubscribed ? "Subscribed" : "Not subscribed"}</Badge>} />
        <Row onClick={() => resub.mutate()} title={<span className="text-accent">Re-subscribe webhooks</span>} />
        <Row onClick={onReconnect} title={<span className="text-accent">Reconnect (new token)</span>} />
      </Group>
      <ErrorNote error={save.error ?? resub.error ?? remove.error ?? backup.error ?? restore.error} />
      <div className="mx-4 space-y-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save
        </Button>
        <Button variant="plain" onClick={() => confirm(`Remove @${account.username} and all its rules/posts?`) && remove.mutate()}>
          <span className="text-danger">Remove account</span>
        </Button>
      </div>
    </Sheet>
  );
}
