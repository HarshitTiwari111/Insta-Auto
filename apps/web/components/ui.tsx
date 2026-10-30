"use client";

import { useEffect } from "react";

/** Instagram-style top bar: page title left, action right, hairline below */
export function Header({ title, right, brand }: { title: string; right?: React.ReactNode; brand?: boolean }) {
  return (
    <header className="pt-safe sticky top-0 z-20 mb-4 border-b border-line bg-bar backdrop-blur-xl print:static">
      <div className="flex min-h-[56px] items-center justify-between px-4">
        <h1 className={`text-[24px] font-bold tracking-tight ${brand ? "ig-gradient-text" : ""}`}>{title}</h1>
        <div className="text-[16px] font-semibold">{right}</div>
      </div>
    </header>
  );
}

/** Grouped inset list section */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 mb-6">
      {title && <h2 className="mb-2 px-1 text-[15px] font-semibold">{title}</h2>}
      <div className="overflow-hidden rounded-xl border border-card-border bg-card [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
      {footer && <p className="mt-1.5 px-1 text-[13px] leading-snug text-muted">{footer}</p>}
    </section>
  );
}

export function Row({
  title,
  subtitle,
  right,
  left,
  onClick,
  danger,
}: {
  left?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  // A clickable row is a div with button semantics, not a <button>: rows often contain a Toggle
  // (itself a <button>), and a button inside a button is invalid HTML (hydration error, stray clicks).
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`flex w-full min-h-[48px] items-center gap-3 px-4 py-2.5 text-left ${onClick ? "press cursor-pointer active:bg-fill" : ""}`}
    >
      {left}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[16px] ${danger ? "text-danger" : ""}`}>{title}</div>
        {subtitle && <div className="truncate text-[14px] text-muted">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={`relative h-[28px] w-[46px] shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-fill"}`}
    >
      <span
        className={`absolute left-0 top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[20px]" : "translate-x-[2px]"}`}
      />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "plain";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-accent text-white",
    danger: "bg-danger text-white",
    plain: "border border-card-border bg-card text-text",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press w-full rounded-lg px-4 py-3 text-[15px] font-semibold disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "ok" | "danger" | "accent" | "muted" }) {
  const c = { ok: "text-ok", danger: "text-danger", accent: "text-accent", muted: "text-muted" }[tone];
  return <span className={`text-[13px] font-medium ${c}`}>{children}</span>;
}

/** Bottom sheet (modal) */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        // Same width as the app column (max-w-xl), so on a computer it doesn't stretch across the screen
        className="sheet pb-safe max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-bg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-bg/90 px-4 py-3 backdrop-blur">
          <button onClick={onClose} className="text-[17px] text-accent">
            Cancel
          </button>
          <span className="text-[17px] font-semibold">{title}</span>
          <span className="w-14" />
        </div>
        <div className="pb-6">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
}) {
  const cls = "w-full bg-transparent py-1 outline-none placeholder:text-muted";
  return (
    <label className="block px-4 py-2.5">
      <span className="mb-0.5 block text-[13px] text-muted">{label}</span>
      {multiline ? (
        <textarea className={`${cls} min-h-[84px] resize-y`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="mx-4 mb-4 flex border-b border-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`-mb-px min-w-0 flex-1 truncate border-b-2 px-1 py-2.5 text-[14px] font-semibold transition ${
            value === o.value ? "border-text text-text" : "border-transparent text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-12 text-center text-muted">
      <div className="text-4xl">{icon}</div>
      <p>{text}</p>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="mx-4 mb-4 rounded-xl bg-danger/10 px-4 py-3 text-[15px] text-danger">{(error as Error).message}</p>;
}
