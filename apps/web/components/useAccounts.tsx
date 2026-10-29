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
  return (
    <div className="mx-4 mb-4">
      <select
        className="w-full rounded-xl bg-card px-4 py-3 text-[17px] outline-none"
        value={selected.id}
        onChange={(e) => onSelect(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.username}
          </option>
        ))}
      </select>
    </div>
  );
}
