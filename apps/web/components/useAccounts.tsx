"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type Account } from "@/lib/api";

const KEY = "ia:selectedAccount";

/** Accounts list + the account currently selected in the UI (remembered per device). */
export function useAccounts() {
  const query = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/accounts") });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSelectedId(localStorage.getItem(KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const accounts = query.data ?? [];
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  };

  return { ...query, accounts, selected, select };
}

/**
 * Instagram-style account dropdown: "username ⌄", tap to pick another connected account.
 * `inHeader` renders it as the big page title (Posts); otherwise a compact pill under the header.
 */
export function AccountSwitcher({
  accounts,
  selected,
  onSelect,
  inHeader,
}: {
  accounts: Account[];
  selected: Account | null;
  onSelect: (id: string) => void;
  inHeader?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Close on a click/tap outside (a fixed overlay would be clipped by the blurred sticky header)
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!selected) return null;
  if (accounts.length < 2) return inHeader ? <span>{selected.username}</span> : null;

  return (
    <div ref={box} className={`relative ${inHeader ? "" : "mx-4 mb-4"}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`press flex items-center gap-1.5 ${inHeader ? "" : "rounded-full bg-fill py-1.5 pl-1.5 pr-3 text-[15px] font-semibold"}`}
      >
        {!inHeader && <Pic a={selected} size={26} />}
        <span className="truncate">{inHeader ? selected.username : `@${selected.username}`}</span>
        <svg width={inHeader ? 20 : 16} height={inHeader ? 20 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      {open && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-2xl border border-card-border bg-card py-1 text-[15px] font-normal tracking-normal shadow-xl"
          >
            {accounts.map((a) => {
              const on = a.id === selected.id;
              return (
                <button
                  key={a.id}
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onSelect(a.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill"
                >
                  <Pic a={a} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-text">{a.username}</span>
                    <span className="block text-[12px] text-muted">{a.paused ? "Paused" : "Running"}</span>
                  </span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent" : "border-line"}`}>
                    {on && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
      )}
    </div>
  );
}

function Pic({ a, size }: { a: Account; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-line text-[13px] font-semibold uppercase text-text" style={{ width: size, height: size }}>
      {a.profilePictureUrl ? <img src={a.profilePictureUrl} alt="" className="h-full w-full object-cover" /> : a.username.slice(0, 1)}
    </span>
  );
}
