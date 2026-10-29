# Free deploy (no card)

Everything on free plans that don't ask for a card. For the paid setup see [DEPLOY.md](DEPLOY.md).

| Part | Free service | Notes |
|---|---|---|
| PWA (screens) | **Vercel** Hobby | |
| API + worker (one service) | **Render** Free web service | `npm run start:all` runs migrations, then API + worker in one process group |
| Postgres | **Neon** Free | 0.5 GB; does not expire |
| Redis | **Redis Cloud** Free | 30 MB, set eviction to **noeviction** |
| Keep awake | **UptimeRobot** Free | Render free sleeps after 15 min without traffic; a ping every 5 min keeps it up |

Uploaded photos/videos are stored **in Postgres** (`UPLOAD_STORAGE=db`) because Render's free disk is wiped on every restart. Videos are limited to **50 MB** in this mode.

## 1. Neon (database)
1. neon.tech → Sign up with GitHub → **Create project**: name `instaauto`, region **Singapore** (closest to India).
2. Dashboard → **Connect** → copy the connection string (`postgresql://…?sslmode=require`). This is `DATABASE_URL`.

## 2. Redis Cloud
1. redis.io/try-free → sign up → **Create database** → plan **Free (30 MB)**, cloud AWS, region **ap-south-1 (Mumbai)**.
2. Database → **Configuration → Edit → Data eviction policy: `noeviction`** → Save (BullMQ needs it).
3. Copy **Public endpoint** (`host:port`) and the **default user password**. `REDIS_URL` = `redis://default:<password>@<host>:<port>`

## 3. Render (API + worker)
1. render.com → Sign up with GitHub → **New + → Web Service** → pick the **Insta-Auto** repo.
2. Settings:
   - Name: `instaauto-api` · Region: **Singapore** · Branch: `main`
   - Runtime: **Node** · Build Command: `npm ci --include=dev` · Start Command: `npm run start:all`
   - Instance Type: **Free**
   - Advanced → Health Check Path: `/health`
3. **Environment Variables** (values for secrets: from your local `.env`):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | from Neon |
   | `REDIS_URL` | from Redis Cloud |
   | `UPLOAD_STORAGE` | `db` |
   | `API_PUBLIC_URL` | `https://instaauto-api.onrender.com` (the URL Render shows for the service) |
   | `APP_URL` | your Vercel URL (put `https://instaauto.vercel.app` first, fix after step 5) |
   | `IG_LOGIN_MODE` | `facebook` |
   | `IG_APP_ID`, `IG_APP_SECRET`, `IG_WEBHOOK_VERIFY_TOKEN` | from `.env` |
   | `IG_API_VERSION` | `v26.0` |
   | `TOKEN_ENC_KEY` | from `.env` |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | from `.env` |
   | `GEMINI_API_KEY` | from `.env` · `GEMINI_MODEL` = `gemini-flash-lite-latest` |
   | `COMMENT_POLL_MINUTES` | `2` |
   | `BOOTSTRAP_ADMIN_EMAIL` | your login email |
   | `BOOTSTRAP_ADMIN_PASSWORD` | a login password (10+ characters) |

4. **Create Web Service**. First build takes 5-10 min. Then open `https://<api>/health` → `{"ok":true}`.
   The admin login is created automatically on first start (only when there are no users yet).

## 4. UptimeRobot (keep awake)
uptimerobot.com → Sign up → **Add New Monitor** → type **HTTP(s)** → URL `https://<api>/health` → interval **5 minutes** → Create.

## 5. Vercel (PWA)
1. vercel.com → Sign up with GitHub → **Add New → Project** → **Insta-Auto** → Import.
2. **Root Directory**: `apps/web`.
3. Environment Variable: `API_URL` = `https://<api>` (the Render URL).
4. **Deploy**. Copy the Vercel URL → Render → `instaauto-api` → Environment → set `APP_URL` → Save (redeploys).

## 6. Meta app: point to Render instead of the tunnel
developers.facebook.com → app **AutoReply**:
- **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**: `https://<api>/ig/callback`
- **Use cases → Customize → Webhooks** (product Instagram): `https://<api>/webhooks/instagram`, same verify token → Verify and save
- **App settings → Basic**: Privacy policy `https://<api>/privacy`, data deletion `https://<api>/privacy#data-deletion`

## 7. Use it
1. Open the Vercel URL → sign in with the bootstrap admin.
2. **Settings → Connect Instagram account**.
3. **Settings → account → Restore from backup file** (the file downloaded from the local app).
4. Phone: open the Vercel URL → iPhone Safari → Share → **Add to Home Screen**; Android Chrome → **Install app**.

## Free-plan limits to know
- Render free: if UptimeRobot stops pinging, the app sleeps and the first request takes ~1 min; every deploy restarts it.
- Neon: 0.5 GB in total (uploads are deleted 7 days after publishing).
- Redis Cloud: 30 MB, enough for the queues.
- Videos: max 50 MB each.
