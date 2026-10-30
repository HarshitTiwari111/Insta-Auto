"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Account } from "@/lib/api";
import { disablePush, enablePush, pushEnabled } from "@/lib/push";
import { useAccounts } from "@/components/useAccounts";
import { Avatar } from "@/components/Avatar";
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
      <Header title="Settings and activity" />
      {banner && (
        <p className={`mx-4 mb-4 rounded-xl px-4 py-3 text-[15px] ${banner.ok ? "bg-ok/15 text-ok" : "bg-danger/10 text-danger"}`}>
          {banner.text}
        </p>
      )}
      <ErrorNote error={error ?? connect.error ?? patch.error} />

      <Section title="Your accounts">
        {accounts.map((a) => (
          <SettingRow
            key={a.id}
            onClick={() => setEditing(a)}
            icon={<Avatar src={a.profilePictureUrl} name={a.username} size={40} />}
            title={a.username}
            subtitle={`${a.paused ? "Paused" : "Running"} · ${
              a.authType === "FACEBOOK" ? "via Facebook Page" : `token expires ${new Date(a.tokenExpiresAt).toLocaleDateString()}`
            }${a.webhooksSubscribed ? "" : " · webhooks off"}`}
            right={<Toggle label={`Run @${a.username}`} on={!a.paused} onChange={(run) => patch.mutate({ id: a.id, body: { paused: !run } })} />}
          />
        ))}
        <SettingRow onClick={() => connect.mutate()} icon={<RoundIcon>{I.plus}</RoundIcon>} title={<span className="text-accent">Add Instagram account</span>} />
        <p className="px-4 pb-1 pt-1 text-[12px] text-muted">Business or Creator accounts only. Tap an account for limits, blocked accounts, backup or removal.</p>
      </Section>

      <Section title="How you get notified">
        <SettingRow
          icon={I.bell}
          title="Push notifications"
          subtitle="New DMs, failed posts, reconnect alerts"
          right={<Toggle label="Push" on={push} onChange={togglePush} />}
        />
        {push && <SettingRow onClick={() => api("/push/test", { method: "POST" })} icon={I.send} title="Send test notification" chevron />}
        <p className="px-4 pb-1 pt-1 text-[12px] text-muted">iPhone: works only from the Home Screen app (iOS 16.4+).</p>
        <ErrorNote error={pushErr} />
      </Section>

      <Section title="Your activity">
        <Link href="/activity" className="block">
          <SettingRow icon={I.clock} title="Activity log" subtitle="Replies, DMs, posts and errors" chevron />
        </Link>
      </Section>

      <Section title="Login">
        <SettingRow onClick={() => logout.mutate()} icon={I.logout} title={<span className="text-danger">Log out</span>} />
      </Section>

      <p className="pb-6 pt-2 text-center text-[12px] text-muted">Instaauto · official Instagram API</p>

      {editing && <AccountSheet account={editing} onClose={() => setEditing(null)} onReconnect={() => connect.mutate()} />}
    </>
  );
}

/** Instagram settings section: small grey heading and flat rows, separated by space only. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pb-4">
      <h2 className="px-4 pb-1 pt-2 text-[14px] font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function SettingRow({
  icon,
  title,
  subtitle,
  right,
  chevron,
  onClick,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  chevron?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onClick()) : undefined}
      className={`flex min-h-[56px] items-center gap-3.5 px-4 py-2 ${onClick ? "press cursor-pointer active:bg-fill" : ""}`}
    >
      <span className="flex w-10 shrink-0 justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px]">{title}</div>
        {subtitle && <div className="truncate text-[13px] text-muted">{subtitle}</div>}
      </div>
      {right}
      {chevron && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </div>
  );
}

const RoundIcon = ({ children }: { children: React.ReactNode }) => (
  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line">{children}</span>
);

const sv = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const I = {
  plus: (
    <svg {...sv} width={20} height={20}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  bell: (
    <svg {...sv}>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </svg>
  ),
  send: (
    <svg {...sv}>
      <path d="M22 3 9.2 10.8M22 3l-7 18-3-8.2L3 10z" />
    </svg>
  ),
  clock: (
    <svg {...sv}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  logout: (
    <svg {...sv} className="text-danger">
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
    </svg>
  ),
};

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
