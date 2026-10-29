"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TabBar } from "@/components/TabBar";
import { PullToRefresh } from "@/components/PullToRefresh";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // 401 -> api() redirects to /login
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ id: string; email: string }>("/auth/me"), staleTime: 300_000 });

  if (me.isLoading) {
    return <div className="flex min-h-dvh items-center justify-center text-muted">Loading…</div>;
  }
  return (
    <>
      <PullToRefresh />
      <main className="mx-auto max-w-xl pb-[calc(84px+env(safe-area-inset-bottom))]">{children}</main>
      <TabBar />
    </>
  );
}
