# Instaauto: project handover

Everything a new developer needs to take over Instaauto: what it does, how it is built, where it runs, how to change it, and what is left.
State as of **30 Oct 2026**. Where this file and an older doc disagree, this file is newer.

Other docs in the repo:
- [README.md](README.md): run locally
- [ARCHITECTURE.md](ARCHITECTURE.md): design, Redis/caching, Meta limits. Its scope table predates the like and post-delete APIs; see section 3 below for the current status.
- [FREE_DEPLOY.md](FREE_DEPLOY.md) / [DEPLOY.md](DEPLOY.md): hosting steps
- [TESTERS.md](TESTERS.md): letting other people connect Instagram without App Review

The product plan is `instagram-automation-plan.md` (kept outside the repo by the owner). Build only what that plan lists, and ask the owner before adding anything else.

---

## 1. What it is

A team-only Instagram automation **PWA** for iPhone and Android, installed from the browser ("Add to Home Screen"), with no App Store. It uses **only the official Instagram Graph API** with Facebook Login: no scraping, no bots, no private API.

Main jobs:
- Auto-reply to comments by keyword or for every comment, with fixed text or Gemini AI. Optionally also like the comment and send the commenter a private DM.
- Hide or delete spam comments, blocklist accounts, AI spam filter.
- DM auto-replies, quick-reply buttons, photo/video replies, a chatbot flow builder (works only for tester accounts, see section 6).
- Schedule photo, video, carousel, reel and story posts, with a first comment, drafts, a calendar view and **auto-delete**.
- Analytics: followers, engagement, best posts, best time to post, hashtag performance, DM stats, what the app did, weekly/monthly reports, PDF/CSV.
- Push notifications, an activity log, limits, working hours, emergency stop, backup and restore.

Two Instagram accounts are connected now: **@tiwar.i1573** (Facebook Page "Launchigo") and **@off_icialharshit71** (Page "Harshit71"). Each has its own Running/Paused switch.

---

## 2. Tech stack and repo layout

npm workspaces monorepo, Node **22** (`.node-version`), TypeScript everywhere.

```
apps/web       Next.js 16 PWA (App Router, Tailwind v4, TanStack Query). Proxies /api/* to the API.
apps/api       Fastify API: auth, rules, posts, comments, OAuth, Meta webhooks, media serving
apps/worker    BullMQ worker: every Instagram write, comment polling, publishing, reports, token refresh
packages/core  Shared: env (zod), IG client, OAuth, rules matching, AI (Gemini), analytics, reports, Redis keys, queues
packages/db    Prisma 7 schema + migrations + generated client (Postgres)
scripts/start-all.mjs   One-process start for free hosting: migrate, then API + worker together
```

| Layer | Tech |
|---|---|
| UI | Next.js 16, React, Tailwind v4, TanStack Query; Instagram-like design tokens in `apps/web/app/globals.css` |
| API | Fastify, zod validation, cookie sessions in Redis |
| Jobs | BullMQ on Redis. Queues: `events`, `publish`, `maintenance`, `notify` |
| DB | PostgreSQL + Prisma 7 |
| AI | Google Gemini (`GEMINI_MODEL=gemini-flash-lite-latest`) |
| Push | Web Push (VAPID) |

Key web screens (`apps/web/app/(app)/…`): Home (`page.tsx`), `rules`, `posts`, `inbox`, `analytics`, `comments`, `flows`, `activity`, `settings`. Shared UI: `apps/web/components/ui.tsx`, the account switcher in `components/useAccounts.tsx`, and the post + comments viewer in `components/PostViewer.tsx`.

---

## 3. Feature status (against the plan)

✅ built · 🔒 blocked in tester mode (needs Meta App Review, which the owner does not want) · ❌ not possible with the official API

| # | Section | Status |
|---|---|---|
| 1 | Auth & accounts | ✅ Facebook Login OAuth, multiple accounts, global account switcher, token refresh, Business/Creator check |
| 2 | Auto like | ✅ Auto-like comments on own posts (rule option "Also like their comment"), ❤️ like/unlike in the post viewer, counted in the daily limit, like history (Activity) and count (Analytics). 🔒 Hashtag-based likes (hashtag search needs App Review). ❌ Location likes, competitor-follower likes |
| 3 | Auto comment | ✅ Templates, AI comments, rotation (random pick among versions), blacklist, sentiment. ❌ Commenting on other people's / hashtag posts, emoji-only, comment scheduling |
| 4 | Auto DM | ✅ Keyword + AI DM replies, FAQ, templates library, quick-reply buttons, chatbot flows, photo/video in DMs, DM analytics, private DM to commenters. 🔒 DMs from the general public only arrive after App Review. ❌ Welcome DM to new followers (no follow event in the API) |
| 5 | Comment replies | ✅ Reply, keyword, AI, thank-you, hide/delete spam, moderation page. ❌ Pin comment (no endpoint) |
| 6 | Follow/unfollow | ❌ Not in the API |
| 7 | Post scheduling | ✅ Photo/video/carousel/reel/story, caption + AI caption, hashtag sets, first comment, best time, calendar, drafts, **auto-delete** (Never / 1 / 7 / 30 days / a date; can also be set after publishing) |
| 8 | Analytics | ✅ Follower growth, engagement, best posts, hashtag performance, "Done by the app", weekly/monthly reports, PDF/CSV. 🔒 Demographics, competitor analysis (code exists, Meta returns #10) |
| 9 | Hashtag tools | ✅ Sets, performance, first comment, AI suggestions, **blocked-hashtag warning** (built-in list in `apps/web/lib/bannedHashtags.ts`). 🔒 Hashtag research / trending |
| 10 | AI | ✅ All 7 (caption, comment, DM reply, ideas, sentiment, spam, best time) |
| 11 | PWA | ✅ Install, offline page, push, splash screens, status bar, pull-to-refresh. Tested on Android and iPhone |
| 12 | Settings | ✅ Daily/hourly limits, reply speed, working hours, backup/restore, activity log, emergency stop. ❌ Proxy (not needed with the official API) |

**Tested on real Instagram:** comment auto-reply, AI reply, private DM, auto-like + manual like, scheduled publishing + first comment, auto-delete, blocked-hashtag warning, two accounts with separate pause, push on Android.

---

## 4. How the main flows work

**Comments → rules.** Comment webhooks need Advanced Access, so the worker **polls** every `COMMENT_POLL_MINUTES` (2) minutes (`maintenance.ts → pollComments`). It reads the latest posts plus older posts that rules target (using `?ids=` comment counts) and puts new comments on the `events` queue. Dedupe keys are shared with webhooks, so nothing is processed twice. `events.ts → onComment`:
1. Skip our own comments, paused accounts, blocklisted users (optionally hide them), and the AI spam filter.
2. `matchRule` picks the rule: lowest `priority` first, keyword or "every comment", optional `mediaIds` (chosen posts; empty means all posts).
3. Actions run, each **at most once per comment** (`once(...)` + Redis): delete → stop, or like → hide → public reply (AI or template) → private DM. Every action calls `takeDailyAction`, so the account's daily limit applies.

**Rule texts.** Each reply box is one whole message (multi-line allowed). Several versions can be stored, separated by a line with `---`; one is picked at random. `{username}` is replaced with the commenter's name. AI replies use `aiInstructions` (business info); the templates are the fallback when AI is busy.

**DMs.** Meta sends `messages` webhooks through the Facebook Page subscription. Chatbot flows run before DM rules. Replies are only allowed inside Meta's 24-hour window.

**Posting.** Creating a post schedules a delayed `publish` job: container → wait until FINISHED → `media_publish` → first comment. `sweep-posts` runs every 5 minutes: it re-queues missing jobs and runs **auto-delete** (`DELETE /{ig-media-id}`) for published posts whose `deleteAt` has passed. A failed delete is not retried; the reason is saved on the post and a push is sent.

**Media uploads.** Photos are converted to JPEG (Meta requires it). Storage is `UPLOAD_STORAGE=db` in production (`MediaFile` table, videos up to 50 MB), because Render's free disk is wiped on restart.

**Worker schedule** (`apps/worker/src/index.ts`): token refresh 03:00, `sweep-posts` every 5 minutes, cleanup 04:30, follower snapshot hourly, weekly report Monday 09:00 IST, monthly report on the 1st, comment polling every 2 minutes. A heartbeat in Redis feeds `/health`.

---

## 5. Hosting (current, free)

| Part | Where | Notes |
|---|---|---|
| PWA | **Vercel**, project `insta-auto` → https://insta-auto-rho.vercel.app | Root `apps/web`. `apps/web/vercel.json` installs with `--ignore-scripts` (no Prisma on Vercel). Env: `API_URL=https://instaauto-api.onrender.com` |
| API + worker | **Render** free web service `instaauto-api` → https://instaauto-api.onrender.com | Build `npm ci --include=dev`, start `npm run start:all` (migrations run on every start), health check `/health` |
| Postgres | **Render free Postgres** | ⚠️ **Expires 28 Nov 2026.** Upgrade to a paid plan before then or all data is lost |
| Redis | **Render Key Value** | Eviction policy must be `noeviction` (BullMQ) |
| Keep-awake | **UptimeRobot** | Pings `/health` every 5 minutes, because Render free sleeps after 15 minutes |

Deploys are automatic: pushing to `main` on GitHub (`HarshitTiwari111/Insta-Auto`) redeploys both Vercel and Render.

**Health check:** `GET https://instaauto-api.onrender.com/health` returns the worker heartbeat (`alive`, `lastSeen`), `lastPoll` (time, number of accounts polled, errors) and queue counts (`waiting`, `delayed`, `failed`). If replies stop, check this first; most often the account is simply **Paused**.

---

## 6. Meta app

- App **AutoReply** (ID 2416257519181219), mode **Live**, **Standard Access** only. This is tester mode: the owner has decided **not** to do App Review.
- Login: `IG_LOGIN_MODE=facebook` (Facebook Login for Business). Each Instagram account must be Business/Creator and linked to a Facebook Page.
- Base scopes are in `packages/core/src/ig/oauth-facebook.ts`. Extra scopes come from env **`IG_EXTRA_SCOPES`**, currently `instagram_manage_contents,instagram_manage_engagement`:
  - `instagram_manage_contents`: delete posts (Meta changelog, 3 Dec 2025)
  - `instagram_manage_engagement`: like comments/media via `POST /{ig-user-id}/likes` (22 Apr 2026). Meta locks the account for 1 hour after more than 50 like calls in 5 seconds.
  - To add a permission: Meta dashboard → Use cases → Customize → **Add** the permission → add it to `IG_EXTRA_SCOPES` on Render → reconnect the accounts (Settings → Connect Instagram account). Requesting a scope the app doesn't have breaks the login dialog, so add it in Meta first.
- Only people with a role on the app (admin/developer/tester) can connect accounts or have their DMs reach the app. How to add testers: [TESTERS.md](TESTERS.md).
- The privacy policy page is served by the API (`/privacy`).

---

## 7. Environment variables

Full list with comments: `.env.example` and `packages/core/src/env.ts` (validated at startup; the app fails fast with a readable list of what's missing).

Production values live in the **Render** service env and the **Vercel** project env (`API_URL` only). The local `.env` and `LOCAL_LOGIN.txt` are git-ignored. **Never commit them.** Get the values from the owner, not from chat logs.

Important ones:
- `TOKEN_ENC_KEY`: encrypts the Instagram tokens stored in the DB. Changing it makes every stored token unreadable, so all accounts must reconnect.
- `IG_APP_ID` / `IG_APP_SECRET` / `IG_WEBHOOK_VERIFY_TOKEN` / `IG_LOGIN_MODE=facebook` / `IG_EXTRA_SCOPES`
- `GEMINI_API_KEY`: empty means the AI features are off
- `VAPID_*`: Web Push
- `COMMENT_POLL_MINUTES=2`, `UPLOAD_STORAGE=db`
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`: create the first admin login on a host without a shell

---

## 8. Working on the code

```bash
npm install                 # also generates the Prisma client
npm run typecheck           # all workspaces
npm test                    # core unit tests (node:test)
npm run db:migrate          # dev: new migration after editing packages/db/prisma/schema.prisma
npm run dev:api | dev:worker | dev:web
```

- Local run needs Postgres + Redis (`docker compose up -d`) and an HTTPS tunnel for Meta (see README). **Docker on the owner's PC must stay on drive D:** (`D:\DockerDisk`). The owner starts Docker themselves; don't start it from scripts.
- **Don't run a local worker while the Render worker is running.** Both would poll the same accounts and reply twice.
- Migrations live in `packages/db/prisma/migrations/`; Render applies them on start (`start:all`). The latest ones: `post_auto_delete` (`ScheduledPost.deleteAt/deletedAt`) and `rule_like_comment` (`AutomationRule.likeComment`).
- Rules are cached in Redis per account. The API invalidates the cache on every rule change.
- Before every push, check that no secret values are staged.
- Commit straight to `main`; it auto-deploys.

UI conventions: the owner is not a developer. Keep screens simple, in plain words, Instagram-like (dark theme, `#0095f6` accent), one-line option rows, and full-screen sheets for editors. Avoid helper paragraphs unless needed.

---

## 9. What is left

1. **Hosting (must do before 28 Nov 2026):** upgrade the Render Postgres to a paid plan (about $6–7/month). Optionally also the API service, so it never sleeps. Back up first (Settings → account → Backup).
2. **Domain (optional):** for example `instaauto.in` on Vercel.
3. The owner will add their real WhatsApp number to the private DM texts in rules.

Nothing else from the plan can be built in tester mode. The 🔒 items need App Review (which the owner does not want). The ❌ items are not in the official API. If Meta releases new endpoints (as it did for likes and post deletion), revisit section 3.
