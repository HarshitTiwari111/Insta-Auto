"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

export function AccountSwitcher({ accounts, selected, onSelect }: { accounts: Account[]; selected: Account | null; onSelect: (id: string) => void }) {
  if (accounts.length < 2 || !selected) return null;
  // Story-style row: tap an avatar to switch account (selected one gets the gradient ring)
  return (
    <div className="no-scrollbar mx-4 mb-4 flex gap-4 overflow-x-auto">
      {accounts.map((a) => {
        const on = a.id === selected.id;
        return (
          <button key={a.id} onClick={() => onSelect(a.id)} className="press flex w-[68px] shrink-0 flex-col items-center gap-1">
            <span className={`flex h-[64px] w-[64px] items-center justify-center rounded-full p-[2.5px] ${on ? "ig-gradient" : "bg-line"}`}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-[3px] border-bg bg-fill text-[18px] font-semibold uppercase">
                {a.profilePictureUrl ? <img src={a.profilePictureUrl} alt="" className="h-full w-full object-cover" /> : a.username.slice(0, 1)}
              </span>
            </span>
            <span className={`w-full truncate text-center text-[12px] ${on ? "font-semibold" : "text-muted"}`}>{a.username}</span>
          </button>
        );
      })}
    </div>
  );
}
