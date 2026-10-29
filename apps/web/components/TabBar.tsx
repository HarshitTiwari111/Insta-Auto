"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/rules", label: "Rules", icon: BoltIcon },
  { href: "/posts", label: "Posts", icon: CalIcon },
  { href: "/inbox", label: "Inbox", icon: ChatIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="pb-safe print:hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bar backdrop-blur-xl">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-0.5 pb-1 pt-2 text-[10px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const svg = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
function HomeIcon() {
  return (<svg {...svg}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>);
}
function BoltIcon() {
  return (<svg {...svg}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>);
}
function CalIcon() {
  return (<svg {...svg}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
}
function ChatIcon() {
  return (<svg {...svg}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>);
}
function GearIcon() {
  return (<svg {...svg}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>);
}
