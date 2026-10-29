"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const TRIGGER = 70;

/** Pull down at the top of the page to reload all data (iOS home screen apps have no reload button). */
export function PullToRefresh() {
  const qc = useQueryClient();
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !document.querySelector(".sheet") ? (e.touches[0]?.clientY ?? null) : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const d = (e.touches[0]?.clientY ?? 0) - start.current;
      setPull(d > 0 ? Math.min(d * 0.5, 110) : 0);
    };
    const up = async () => {
      if (start.current === null) return;
      start.current = null;
      if (pull >= TRIGGER) {
        setBusy(true);
        await qc.invalidateQueries();
        setBusy(false);
      }
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [pull, qc]);

  if (!pull && !busy) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center pt-safe print:hidden"
      style={{ transform: `translateY(${busy ? 40 : pull / 2}px)` }}
    >
      <div className="rounded-full bg-card px-3 py-1.5 text-[13px] text-muted shadow">
        {busy ? "Refreshing…" : pull >= TRIGGER ? "Release to refresh" : "Pull to refresh"}
      </div>
    </div>
  );
}
