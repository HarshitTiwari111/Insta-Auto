/** Pure analytics maths, shared by the API and tests. No I/O here. */

export interface PostStat {
  id: string;
  type: string;
  caption: string;
  permalink: string | null;
  thumbnail: string | null;
  timestamp: string | null;
  likes: number;
  comments: number;
  /** (likes + comments) / followers, in percent */
  engagementRate: number;
}

export interface AnalyticsSummary {
  followers: number;
  /** Change over the stored history window (null until there are 2 days of data) */
  followerChange: number | null;
  posts: number;
  totalLikes: number;
  totalComments: number;
  /** Average engagement rate over the listed posts, in percent */
  avgEngagementRate: number;
}

export interface MediaLike {
  id: string;
  media_type?: string;
  caption?: string;
  permalink?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function postStats(media: MediaLike[], followers: number): PostStat[] {
  return media.map((m) => {
    const likes = m.like_count ?? 0;
    const comments = m.comments_count ?? 0;
    return {
      id: m.id,
      type: m.media_type ?? "IMAGE",
      caption: (m.caption ?? "").slice(0, 200),
      permalink: m.permalink ?? null,
      thumbnail: m.thumbnail_url ?? m.media_url ?? null,
      timestamp: m.timestamp ?? null,
      likes,
      comments,
      engagementRate: followers > 0 ? round2(((likes + comments) / followers) * 100) : 0,
    };
  });
}

export function summarize(posts: PostStat[], followers: number, history: { followers: number }[]): AnalyticsSummary {
  const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
  const totalComments = posts.reduce((s, p) => s + p.comments, 0);
  const first = history[0];
  const last = history[history.length - 1];
  return {
    followers,
    followerChange: history.length >= 2 && first && last ? last.followers - first.followers : null,
    posts: posts.length,
    totalLikes,
    totalComments,
    avgEngagementRate: posts.length ? round2(posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length) : 0,
  };
}

/** Best first: engagement, then newest. */
export function bestPosts(posts: PostStat[], n = 5): PostStat[] {
  return [...posts]
    .sort((a, b) => b.engagementRate - a.engagementRate || (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, n);
}

export interface TimeSlot {
  /** 0 = Sunday */
  weekday: number;
  /** Local hour, 0-23 */
  hour: number;
  posts: number;
  avgEngagementRate: number;
  avgInteractions: number;
}

/** Local weekday + hour for an ISO timestamp in an IANA time zone. */
export function localSlot(iso: string, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour };
}

/**
 * Best posting slots from our own history: posts grouped by local weekday + hour, ranked by
 * average interactions (likes + comments). Needs a few posts to mean anything.
 */
export function bestTimes(posts: PostStat[], timeZone: string, n = 3): TimeSlot[] {
  const groups = new Map<string, PostStat[]>();
  for (const p of posts) {
    if (!p.timestamp) continue;
    const { weekday, hour } = localSlot(p.timestamp, timeZone);
    const k = `${weekday}:${hour}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([k, list]) => {
      const [weekday, hour] = k.split(":").map(Number) as [number, number];
      return {
        weekday,
        hour,
        posts: list.length,
        avgEngagementRate: round2(list.reduce((s, p) => s + p.engagementRate, 0) / list.length),
        avgInteractions: round2(list.reduce((s, p) => s + p.likes + p.comments, 0) / list.length),
      };
    })
    .sort((a, b) => b.avgInteractions - a.avgInteractions || b.posts - a.posts)
    .slice(0, n);
}

export interface HashtagStat {
  tag: string;
  posts: number;
  avgInteractions: number;
  avgEngagementRate: number;
}

export function hashtagsIn(text: string): string[] {
  return [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.toLowerCase()))];
}

/** Which hashtags appear on posts that do well. Captions are cut at 200 chars by postStats, so pass raw media. */
export function hashtagPerformance(media: MediaLike[], followers: number, n = 10): HashtagStat[] {
  const stats = postStats(media, followers);
  const byTag = new Map<string, { posts: number; inter: number; rate: number }>();
  media.forEach((m, i) => {
    const s = stats[i]!;
    for (const tag of hashtagsIn(m.caption ?? "")) {
      const g = byTag.get(tag) ?? { posts: 0, inter: 0, rate: 0 };
      g.posts++;
      g.inter += s.likes + s.comments;
      g.rate += s.engagementRate;
      byTag.set(tag, g);
    }
  });
  return [...byTag.entries()]
    .map(([tag, g]) => ({ tag, posts: g.posts, avgInteractions: round2(g.inter / g.posts), avgEngagementRate: round2(g.rate / g.posts) }))
    .sort((a, b) => b.avgInteractions - a.avgInteractions || b.posts - a.posts)
    .slice(0, n);
}

export interface DmStats {
  received: number;
  sent: number;
  people: number;
  /** Incoming messages that got any reply from us (auto or manual) */
  replied: number;
  replyRate: number;
  /** Median minutes from their message to our next reply (null when nothing replied) */
  medianResponseMinutes: number | null;
}

/** DM numbers from our stored messages (oldest first per person is not required). */
export function dmStats(messages: { igsid: string; direction: "IN" | "OUT"; createdAt: Date }[]): DmStats {
  const byPerson = new Map<string, { direction: "IN" | "OUT"; at: number }[]>();
  for (const m of messages) {
    byPerson.set(m.igsid, [...(byPerson.get(m.igsid) ?? []), { direction: m.direction, at: m.createdAt.getTime() }]);
  }
  let received = 0;
  let replied = 0;
  const waits: number[] = [];
  for (const list of byPerson.values()) {
    list.sort((a, b) => a.at - b.at);
    list.forEach((m, i) => {
      if (m.direction !== "IN") return;
      received++;
      const reply = list.slice(i + 1).find((x) => x.direction === "OUT");
      if (reply) {
        replied++;
        waits.push((reply.at - m.at) / 60_000);
      }
    });
  }
  waits.sort((a, b) => a - b);
  const mid = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2]! : (waits[waits.length / 2 - 1]! + waits[waits.length / 2]!) / 2) : null;
  return {
    received,
    sent: messages.filter((m) => m.direction === "OUT").length,
    people: [...byPerson.values()].filter((l) => l.some((m) => m.direction === "IN")).length,
    replied,
    replyRate: received ? round2((replied / received) * 100) : 0,
    medianResponseMinutes: mid === null ? null : round2(mid),
  };
}
