# Instaauto

Instagram automation PWA for the team: comment auto-replies, spam hiding, private DMs to commenters, DM auto-replies, post / reel / story / carousel scheduling, push alerts.
Uses only the official Instagram API. Works on iPhone and Android as a Home Screen app, no App Store.

Architecture, Redis/caching design and the verified Meta limits: see [ARCHITECTURE.md](ARCHITECTURE.md). Going live 24x7: [FREE_DEPLOY.md](FREE_DEPLOY.md) (free plans) or [DEPLOY.md](DEPLOY.md) (paid Render). Letting other people connect their Instagram without App Review: [TESTERS.md](TESTERS.md).

```
apps/web      Next.js PWA (UI)
apps/api      Fastify API + Meta webhook receiver
apps/worker   BullMQ worker (all Instagram calls, scheduling, token refresh)
packages/core Shared: env, Redis cache / rate limit / locks, queues, Instagram client, rules
packages/db   Prisma schema, migrations, client
```

## Run locally (Windows / Mac / Linux)

Needs: **Node.js 22+**, and Postgres + Redis. Easiest is Docker Desktop (`docker compose up -d` starts both).

```bash
# 1. install (also generates the Prisma client)
npm install

# 2. config
copy .env.example .env        # Windows   (Mac/Linux: cp .env.example .env)
#    fill IG_APP_ID, IG_APP_SECRET, IG_WEBHOOK_VERIFY_TOKEN, TOKEN_ENC_KEY, VAPID keys
#    TOKEN_ENC_KEY:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#    VAPID keys:     npx web-push generate-vapid-keys

# 3. database + Redis
docker compose up -d
npm run db:deploy

# 4. first team login
npm run create-user -- you@company.com "a-long-password" "Your Name" admin

# 5. run (3 terminals)
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open http://localhost:3000 and sign in.

**Meta needs HTTPS** for the OAuth redirect and webhooks. In local dev, expose the API (port 4000) with a tunnel such as `cloudflared tunnel --url http://localhost:4000` and put that https URL in `API_PUBLIC_URL`. Then follow the Meta app checklist in ARCHITECTURE.md section 8.

**Installing on phones** also needs HTTPS (deploy the web app first):
- iPhone: open the URL in Safari → Share → Add to Home Screen. Push needs iOS 16.4+ and the installed app.
- Android: open in Chrome → Install app.

## Useful commands

| Command | What |
|---|---|
| `npm run typecheck` | TypeScript check, all packages |
| `npm test` | Unit tests (webhook signature, payload parsing, rules, encryption) |
| `npm run db:migrate` | Create a new migration after editing `schema.prisma` (dev) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run build:web` | Production build of the PWA |
| `npm run start:api` / `start:worker` | Production start |
