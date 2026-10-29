/** Pure rule matching, shared by worker and tests. No I/O here. */

export interface RuleLike {
  id: string;
  enabled: boolean;
  trigger: "COMMENT" | "DM";
  matchType: "ANY" | "KEYWORD";
  keywords: string[];
  mediaId: string | null;
  priority: number;
}

const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase().trim();

export function matchRule<R extends RuleLike>(
  rules: R[],
  input: { trigger: "COMMENT" | "DM"; text: string; mediaId?: string },
): R | null {
  const text = norm(input.text);
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (!r.enabled || r.trigger !== input.trigger) continue;
    if (r.trigger === "COMMENT" && r.mediaId && r.mediaId !== input.mediaId) continue;
    if (r.matchType === "ANY") return r;
    if (r.keywords.some((k) => norm(k) && text.includes(norm(k)))) return r;
  }
  return null;
}

/** Random pick = simple rotation so the same reply isn't posted every time. */
export function pickTemplate(templates: string[], rand: () => number = Math.random): string | null {
  const list = templates.map((t) => t.trim()).filter(Boolean);
  if (!list.length) return null;
  return list[Math.floor(rand() * list.length)] ?? null;
}

/** Supported variables: {username} */
export function renderTemplate(tpl: string, vars: { username?: string }): string {
  return tpl.replaceAll("{username}", vars.username ? `@${vars.username}` : "").replace(/\s{2,}/g, " ").trim();
}

/** "@Some.User " -> "some.user" (how blocklist entries are stored and compared) */
export function normalizeUsername(u: string): string {
  return u.trim().replace(/^@/, "").toLowerCase();
}

export function isBlockedUser(blocklist: string[], username: string | undefined | null): boolean {
  if (!username || !blocklist.length) return false;
  const u = normalizeUsername(username);
  return blocklist.some((b) => normalizeUsername(b) === u);
}
