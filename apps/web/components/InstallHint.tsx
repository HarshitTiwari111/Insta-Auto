"use client";

import { useEffect, useState } from "react";

/** iOS has no install prompt: show the "Share > Add to Home Screen" steps when not installed. */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("ia:installHint") === "0";
    } catch {
      /* ignore */
    }
    setShow(ios && !standalone && !dismissed);
  }, []);

  if (!show) return null;
  return (
    <div className="mx-4 mb-4 rounded-xl bg-accent/10 px-4 py-3 text-[15px]">
      <div className="flex items-start justify-between gap-3">
        <p>
          <b>Install the app:</b> tap <b>Share</b> <span aria-hidden>⬆️</span> in Safari, then <b>Add to Home Screen</b>. Push
          notifications work only from the installed app (iOS 16.4+).
        </p>
        <button
          className="text-muted"
          aria-label="Dismiss"
          onClick={() => {
            setShow(false);
            try {
              localStorage.setItem("ia:installHint", "0");
            } catch {
              /* ignore */
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
