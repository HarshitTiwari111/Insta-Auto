# Deploy (24x7, no laptop / tunnel needed)

Plan from the project brief: **PWA on Vercel**, **API + worker + Postgres + Redis on Render** (Railway works the same way with the same Dockerfile). Expect roughly $15-25/month on Render (web service, worker, Key Value, Postgres and a small disk are paid plans).

```
Vercel  ── apps/web (Next.js PWA) ── /api/* proxied ──▶ Render: instaauto-api  (Dockerfile, `npm run start:api`, disk /data/uploads)
                                                      Render: instaauto-worker (same image, `npm run start:worker`)
                                                      Render: Postgres + Key Value (Redis, noeviction)
```

## 1. Render (API, worker, database, Redis)

1. Push this repo to GitHub (private is fine).
2. render.com → **New → Blueprint** → pick the repo. Render reads `render.yaml` and creates: `instaauto-api`, `instaauto-worker`, `instaauto-redis`, `instaauto-db`.
3. It asks for the secret values (`sync: false`). Copy them from your local `.env`:
   - `IG_APP_ID`, `IG_APP_SECRET`, `IG_WEBHOOK_VERIFY_TOKEN`, `GEMINI_API_KEY`, `VAPID_*`
   - `TOKEN_ENC_KEY`: **the same value as local** if you will copy the local database; otherwise any new 32-byte base64 key (then reconnect Instagram once).
   - `API_PUBLIC_URL`: the API URL Render shows, e.g. `https://instaauto-api.onrender.com`
   - `APP_URL`: the Vercel URL from step 2 (you can fill it after step 2 and redeploy).
4. Deploy. `preDeployCommand` runs the database migrations. Check `https://<api>/health` → `{"ok":true}`.
5. Create your login: Render → `instaauto-api` → **Shell** → `npm run create-user -- you@company.com "a-long-password" "Your Name" admin`

> Uploads live on the API's disk (`/data/uploads`). The worker has no disk, so the 7-day upload cleanup only runs where the files are once you also give the worker access (or move uploads to object storage later). Disk usage is small: published media is only needed until Meta fetches it.

## 2. Vercel (PWA)

1. vercel.com → **Add New → Project** → same repo.
2. **Root Directory**: `apps/web`. Framework: Next.js (auto).
3. Environment variable: `API_URL` = your Render API URL (`https://instaauto-api.onrender.com`).
4. Deploy, then put the Vercel URL into Render's `APP_URL` and redeploy the API.

## 3. Meta app: switch URLs from the tunnel to Render

developers.facebook.com → app **AutoReply**:
- **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**: `https://<api>/ig/callback`
- **Use cases → Customize → Webhooks** (product Instagram): Callback URL `https://<api>/webhooks/instagram`, same verify token → Verify and save
- **App settings → Basic → Privacy policy URL**: `https://<api>/privacy` and data deletion `https://<api>/privacy#data-deletion`

Then in the app: **Settings → Connect Instagram account** once (stores the token in the new database).

## 4. Phones

Open the Vercel URL → iPhone: Safari → Share → **Add to Home Screen** (push needs iOS 16.4+). Android: Chrome → **Install app**.

## Not verified yet

The Dockerfile was written for this repo but a full local `docker build` could not finish on the dev machine (C: drive out of space). The first Render deploy is the real build test: if it fails, the build log shows the step.
