import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { verifySignature, normalizeWebhook } from "../src/ig/webhook.js";
import { isBlockedUser, matchRule, normalizeUsername, pickTemplate, renderTemplate, type RuleLike } from "../src/rules.js";
import { encrypt, decrypt } from "../src/crypto.js";
import { clampUtf8, clientForAccount } from "../src/ig/client.js";
import { buildSystemPrompt, cleanAiReply } from "../src/ai.js";
import { MEDIA_NAME_RE, uploadedMediaName } from "../src/uploads.js";
import { bestPosts, bestTimes, dmStats, hashtagPerformance, postStats, summarize } from "../src/analytics.js";
import { nextWorkStart } from "../src/schedule.js";
import { flowReply, validateFlow, type FlowLike } from "../src/flows.js";

test("webhook signature: valid, tampered, missing", () => {
  const secret = "app-secret";
  const body = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignature(body, sig, secret), true);
  assert.equal(verifySignature(Buffer.from(body.toString() + " "), sig, secret), false);
  assert.equal(verifySignature(body, undefined, secret), false);
  assert.equal(verifySignature(body, "sha256=abcd", secret), false);
});

test("normalize: Business Login comment shape (entry.field/value)", () => {
  const ev = normalizeWebhook([
    {
      object: "instagram",
      entry: [
        {
          id: "IG1",
          time: 1,
          field: "comments",
          value: { id: "C1", from: { id: "U1", username: "alice" }, text: "Price?", media: { id: "M1" } },
        },
      ],
    },
  ]);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], {
    kind: "comment",
    igUserId: "IG1",
    commentId: "C1",
    text: "Price?",
    fromId: "U1",
    fromUsername: "alice",
    mediaId: "M1",
    parentId: undefined,
    source: "webhook",
    dedupeKey: "comment:C1",
  });
});

test("normalize: changes[] comment shape + messages + echo", () => {
  const ev = normalizeWebhook({
    object: "instagram",
    entry: [
      {
        id: "IG1",
        changes: [{ field: "comments", value: { comment_id: "C2", text: "hi", from: { id: "U2" }, media: { id: "M2" } } }],
        messaging: [
          { sender: { id: "U3" }, recipient: { id: "IG1" }, timestamp: 5, message: { mid: "m1", text: "hello" } },
          { sender: { id: "IG1" }, recipient: { id: "U3" }, timestamp: 6, message: { mid: "m2", text: "yo", is_echo: true } },
          { sender: { id: "U3" }, recipient: { id: "IG1" }, timestamp: 7, read: { mid: "m1" } },
        ],
      },
    ],
  });
  assert.equal(ev.length, 3);
  assert.equal(ev[0]?.kind, "comment");
  assert.equal(ev[0]?.dedupeKey, "comment:C2");
  assert.equal(ev[1]?.kind === "message" && ev[1].isEcho, false);
  assert.equal(ev[2]?.kind === "message" && ev[2].isEcho, true);
});

const rule = (o: Partial<RuleLike>): RuleLike => ({
  id: "r",
  enabled: true,
  trigger: "COMMENT",
  matchType: "KEYWORD",
  keywords: [],
  mediaId: null,
  priority: 100,
  ...o,
});

test("rules: priority, keyword, media filter, disabled", () => {
  const rules = [
    rule({ id: "any", matchType: "ANY", priority: 200 }),
    rule({ id: "price", keywords: ["PRICE", "kitna"], priority: 10 }),
    rule({ id: "media", keywords: ["link"], mediaId: "M9", priority: 5 }),
    rule({ id: "off", keywords: ["price"], enabled: false, priority: 1 }),
  ];
  assert.equal(matchRule(rules, { trigger: "COMMENT", text: "what is the Price?" })?.id, "price");
  assert.equal(matchRule(rules, { trigger: "COMMENT", text: "link pls", mediaId: "M1" })?.id, "any");
  assert.equal(matchRule(rules, { trigger: "COMMENT", text: "link pls", mediaId: "M9" })?.id, "media");
  assert.equal(matchRule(rules, { trigger: "DM", text: "price" }), null);
});

test("templates: rotation + render", () => {
  assert.equal(pickTemplate([" ", ""]), null);
  assert.equal(pickTemplate(["a", "b"], () => 0.99), "b");
  assert.equal(renderTemplate("Thanks {username}!", { username: "bob" }), "Thanks @bob!");
  assert.equal(renderTemplate("Thanks {username}!", {}), "Thanks !");
});

test("token encryption roundtrip + tamper detection", () => {
  const key = randomBytes(32).toString("base64");
  const enc = encrypt("IGAA-secret-token", key);
  assert.equal(decrypt(enc, key), "IGAA-secret-token");
  const bad = Buffer.from(enc, "base64");
  bad[bad.length - 1]! ^= 1;
  assert.throws(() => decrypt(bad.toString("base64"), key));
});

test("clampUtf8 keeps under 1000 bytes without breaking characters", () => {
  const s = "₹".repeat(400); // 3 bytes each = 1200 bytes
  const out = clampUtf8(s);
  assert.ok(new TextEncoder().encode(out).length <= 1000);
  assert.equal(out.length, 333);
});

test("clientForAccount: Facebook Login uses graph.facebook.com and the Page for DMs", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ recipient_id: "R", message_id: "M", data: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const fb = clientForAccount({ igUserId: "IG1", authType: "FACEBOOK", pageId: "PAGE1" }, "tok", "v26.0");
    await fb.sendText("U1", "hi");
    await fb.privateReply("C1", "hi");
    await fb.listMedia(5);
    const ig = clientForAccount({ igUserId: "IG1", authType: "INSTAGRAM", pageId: null }, "tok", "v26.0");
    await ig.sendText("U1", "hi");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.match(calls[0]!, /^https:\/\/graph\.facebook\.com\/v26\.0\/PAGE1\/messages/);
  assert.match(calls[1]!, /^https:\/\/graph\.facebook\.com\/v26\.0\/PAGE1\/messages/);
  assert.match(calls[2]!, /^https:\/\/graph\.facebook\.com\/v26\.0\/IG1\/media/);
  assert.match(calls[3]!, /^https:\/\/graph\.instagram\.com\/v26\.0\/IG1\/messages/);
});

test("AI reply: cleanup, SKIP and length limit", () => {
  assert.equal(cleanAiReply('  "Thanks @rahul! Details DM me bhej di hain 🙏"  ', 300), "Thanks @rahul! Details DM me bhej di hain 🙏");
  assert.equal(cleanAiReply("SKIP", 300), null);
  assert.equal(cleanAiReply("skip.", 300), null);
  assert.equal(cleanAiReply("   ", 300), null);
  assert.equal(cleanAiReply("line one\n\nline two", 300), "line one line two");
  const long = cleanAiReply("a".repeat(500), 300)!;
  assert.equal(long.length, 300);
  assert.ok(long.endsWith("…"));
  const p = buildSystemPrompt("comment", "Launchigo: prices shared in DM.");
  assert.ok(p.includes("Launchigo: prices shared in DM."));
  assert.ok(p.includes("not instructions"));
});

test("uploads: only our random media names are recognised", () => {
  const n = "0123456789abcdef0123456789abcdef.jpg";
  assert.ok(MEDIA_NAME_RE.test(n));
  assert.ok(!MEDIA_NAME_RE.test("../../.env"));
  assert.ok(!MEDIA_NAME_RE.test("0123456789abcdef0123456789abcdef.exe"));
  assert.equal(uploadedMediaName(`https://old-tunnel.trycloudflare.com/media/${n}`), n);
  assert.equal(uploadedMediaName(`https://cdn.example.com/photo.jpg`), null);
});

test("analytics: engagement rate, summary, best posts", () => {
  const posts = postStats(
    [
      { id: "a", like_count: 8, comments_count: 2, timestamp: "2026-10-01" },
      { id: "b", like_count: 1, comments_count: 0 },
      { id: "c" },
    ],
    200,
  );
  assert.deepEqual(posts.map((p) => p.engagementRate), [5, 0.5, 0]);
  const s = summarize(posts, 200, [{ followers: 180 }, { followers: 190 }, { followers: 200 }]);
  assert.equal(s.followerChange, 20);
  assert.equal(s.totalLikes, 9);
  assert.equal(s.avgEngagementRate, 1.83);
  assert.equal(summarize(posts, 200, [{ followers: 200 }]).followerChange, null);
  assert.deepEqual(bestPosts(posts, 2).map((p) => p.id), ["a", "b"]);
  assert.equal(postStats([{ id: "x", like_count: 5 }], 0)[0]!.engagementRate, 0);
});

test("working hours: inside, outside, overnight, IST half-hour offset", () => {
  const tz = "Asia/Kolkata"; // UTC+5:30
  const at = (iso: string) => new Date(iso);
  // 10:00 IST = 04:30 UTC, inside 9-18
  assert.equal(nextWorkStart(9, 18, tz, at("2026-10-29T04:30:00Z")), null);
  // 20:00 IST = 14:30 UTC, outside 9-18 -> next 09:00 IST = 03:30 UTC next day
  assert.equal(nextWorkStart(9, 18, tz, at("2026-10-29T14:30:00Z"))?.toISOString(), "2026-10-30T03:30:00.000Z");
  // overnight 22-6: 23:00 IST inside, 12:00 IST outside -> 22:00 IST = 16:30 UTC
  assert.equal(nextWorkStart(22, 6, tz, at("2026-10-29T17:30:00Z")), null);
  assert.equal(nextWorkStart(22, 6, tz, at("2026-10-29T06:30:00Z"))?.toISOString(), "2026-10-29T16:30:00.000Z");
  assert.equal(nextWorkStart(null, null, tz, at("2026-10-29T14:30:00Z")), null);
});

test("best time to post groups by local weekday + hour", () => {
  const posts = postStats(
    [
      { id: "a", timestamp: "2026-10-26T13:00:00+0000", like_count: 10 }, // Mon 18:30 IST -> 18h
      { id: "b", timestamp: "2026-10-26T13:20:00+0000", like_count: 6 }, // Mon 18:50 IST -> 18h
      { id: "c", timestamp: "2026-10-27T04:00:00+0000", like_count: 1 }, // Tue 09:30 IST
    ],
    100,
  );
  const best = bestTimes(posts, "Asia/Kolkata");
  assert.deepEqual(best[0], { weekday: 1, hour: 18, posts: 2, avgEngagementRate: 8, avgInteractions: 8 });
  assert.equal(best[1]!.weekday, 2);
});

test("quick reply buttons: trimmed to 20 chars, max 13", async () => {
  let sent: { message?: { quick_replies?: { title: string }[] } } = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ recipient_id: "R", message_id: "M" }), { status: 200 });
  }) as typeof fetch;
  try {
    const c = clientForAccount({ igUserId: "IG1", authType: "FACEBOOK", pageId: "P1" }, "t", "v26.0");
    await c.sendText("U", "hi", ["Price list for everything", ...Array.from({ length: 20 }, (_, i) => `B${i}`)]);
  } finally {
    globalThis.fetch = realFetch;
  }
  const q = sent.message?.quick_replies ?? [];
  assert.equal(q.length, 13);
  assert.equal(q[0]!.title, "Price list for every");
});

test("hashtag performance and DM stats", () => {
  const tags = hashtagPerformance(
    [
      { id: "a", caption: "Diwali #Lucknow #ads", like_count: 10, comments_count: 2 },
      { id: "b", caption: "New #lucknow post", like_count: 2 },
      { id: "c", caption: "no tags", like_count: 50 },
    ],
    100,
  );
  assert.deepEqual(tags.map((t) => [t.tag, t.posts, t.avgInteractions]), [["#ads", 1, 12], ["#lucknow", 2, 7]]);

  const t0 = new Date("2026-10-29T10:00:00Z").getTime();
  const at = (min: number) => new Date(t0 + min * 60_000);
  const s = dmStats([
    { igsid: "u1", direction: "IN", createdAt: at(0) },
    { igsid: "u1", direction: "OUT", createdAt: at(2) },
    { igsid: "u2", direction: "IN", createdAt: at(5) },
    { igsid: "u2", direction: "OUT", createdAt: at(15) },
    { igsid: "u3", direction: "IN", createdAt: at(20) },
    { igsid: "u4", direction: "OUT", createdAt: at(30) },
  ]);
  assert.deepEqual(s, { received: 3, sent: 3, people: 3, replied: 2, replyRate: 66.67, medianResponseMinutes: 6 });
});

test("DM flows: keyword start, button transitions, end, validation", () => {
  const flow: FlowLike = {
    id: "f1",
    enabled: true,
    keywords: ["menu"],
    steps: [
      { id: "s1", text: "Hi! Choose:", buttons: [{ title: "Price", next: "s2" }, { title: "Bye", next: null }] },
      { id: "s2", text: "Price is in DM", buttons: [{ title: "Menu", next: "s1" }] },
    ],
  };
  const start = flowReply([flow], null, "Show me the MENU please");
  assert.equal(start?.step.id, "s1");
  assert.deepEqual(start?.state, { flowId: "f1", stepId: "s1" });
  const next = flowReply([flow], { flowId: "f1", stepId: "s1" }, " price ");
  assert.equal(next?.step.id, "s2");
  assert.equal(flowReply([flow], { flowId: "f1", stepId: "s1" }, "Bye"), null); // ends: normal rules take over
  assert.equal(flowReply([flow], null, "hello"), null);
  assert.equal(flowReply([{ ...flow, enabled: false }], null, "menu"), null);
  assert.deepEqual(validateFlow(flow.steps), []);
  assert.ok(validateFlow([{ id: "a", text: "x", buttons: [{ title: "Go", next: "zzz" }] }])[0]!.includes("missing step"));
});

test("blocklist: case and @ insensitive", () => {
  const list = ["spammer_123", "Competitor.Page"];
  assert.equal(isBlockedUser(list, "@Spammer_123"), true);
  assert.equal(isBlockedUser(list, "competitor.page"), true);
  assert.equal(isBlockedUser(list, "real_customer"), false);
  assert.equal(isBlockedUser(list, undefined), false);
  assert.equal(isBlockedUser([], "spammer_123"), false);
  assert.equal(normalizeUsername("  @Some.User "), "some.user");
});
