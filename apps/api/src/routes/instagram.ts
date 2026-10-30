import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import {
  buildAuthorizeUrl,
  buildFacebookAuthorizeUrl,
  clientForAccount,
  encrypt,
  env,
  exchangeCode,
  exchangeFacebookCode,
  exchangeLongLived,
  IgClient,
  keys,
  listLinkedInstagramPages,
  logger,
  NO_EXPIRY,
  redis,
} from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";
import { log } from "../ctx.js";

const redirectUri = () => `${env().API_PUBLIC_URL}/ig/callback`;

/** Webhook fields we subscribe each connected account to. */
export const WEBHOOK_FIELDS = ["comments", "messages"];

export default async function instagramRoutes(app: FastifyInstance) {
  /** Step 1: PWA asks for the Instagram authorize URL, then navigates to it. */
  app.get("/ig/connect", { preHandler: requireAuth }, async (req) => {
    const state = randomBytes(24).toString("base64url");
    await redis().set(keys.oauthState(state), req.session!.userId, "EX", 600);
    const e = env();
    const url =
      e.IG_LOGIN_MODE === "facebook"
        ? buildFacebookAuthorizeUrl({ appId: e.IG_APP_ID, redirectUri: redirectUri(), state, version: e.IG_API_VERSION, extraScopes: e.IG_EXTRA_SCOPES })
        : buildAuthorizeUrl({ appId: e.IG_APP_ID, redirectUri: redirectUri(), state });
    return { url };
  });

  /** Steps 2-3: Instagram redirects here (on the API host). No cookie needed: state maps to the user. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    "/ig/callback",
    async (req, reply) => {
      const back = (q: string) => reply.redirect(`${env().APP_URL}/settings?${q}`);
      const { code, state, error, error_description } = req.query;
      if (error) return back(`ig_error=${encodeURIComponent(error_description ?? error)}`);
      if (!code || !state) return back("ig_error=missing_code");

      const userId = await redis().getdel(keys.oauthState(state));
      if (!userId) return back("ig_error=expired_state");

      if (env().IG_LOGIN_MODE === "facebook") return connectViaFacebook(code, userId, back);

      try {
        const short = await exchangeCode({
          appId: env().IG_APP_ID,
          appSecret: env().IG_APP_SECRET,
          redirectUri: redirectUri(),
          code,
        });
        const long = await exchangeLongLived({ appSecret: env().IG_APP_SECRET, shortToken: short.accessToken });

        const me = await new IgClient(long.accessToken, short.userId, env().IG_API_VERSION).me();
        const igUserId = me.user_id ?? short.userId;
        const ig = new IgClient(long.accessToken, igUserId, env().IG_API_VERSION);

        const data = {
          username: me.username ?? "unknown",
          accountType: me.account_type ?? null,
          profilePictureUrl: me.profile_picture_url ?? null,
          accessTokenEnc: encrypt(long.accessToken, env().TOKEN_ENC_KEY),
          tokenExpiresAt: long.expiresAt,
          tokenRefreshedAt: new Date(),
        };
        const acc = await prisma.igAccount.upsert({
          where: { igUserId },
          create: { igUserId, ...data },
          update: data,
        });

        let subscribed = false;
        try {
          subscribed = (await ig.subscribeWebhooks(WEBHOOK_FIELDS)).success === true;
        } catch (err) {
          logger.warn({ err, accountId: acc.id }, "webhook subscription failed");
        }
        await prisma.igAccount.update({ where: { id: acc.id }, data: { webhooksSubscribed: subscribed } });
        await log(acc.id, "account.connected", { by: userId, permissions: short.permissions, subscribed });

        return back(`connected=${encodeURIComponent(acc.username)}`);
      } catch (err) {
        logger.error({ err }, "instagram connect failed");
        return back(`ig_error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
      }
    },
  );
}

/** Facebook Login: one connected account per granted Page that has an Instagram professional account. */
async function connectViaFacebook(code: string, userId: string, back: (q: string) => unknown) {
  const e = env();
  try {
    const userToken = await exchangeFacebookCode({
      appId: e.IG_APP_ID,
      appSecret: e.IG_APP_SECRET,
      redirectUri: redirectUri(),
      code,
      version: e.IG_API_VERSION,
    });
    const pages = await listLinkedInstagramPages(userToken, e.IG_API_VERSION);
    if (!pages.length) {
      return back(`ig_error=${encodeURIComponent("No Facebook Page linked to an Instagram professional account was shared. Link the Page to Instagram, then connect again and select that Page.")}`);
    }

    const names: string[] = [];
    for (const p of pages) {
      const data = {
        username: p.username,
        profilePictureUrl: p.profilePictureUrl,
        authType: "FACEBOOK" as const,
        pageId: p.pageId,
        accessTokenEnc: encrypt(p.pageAccessToken, e.TOKEN_ENC_KEY),
        tokenExpiresAt: NO_EXPIRY,
        tokenRefreshedAt: new Date(),
      };
      const acc = await prisma.igAccount.upsert({
        where: { igUserId: p.igUserId },
        create: { igUserId: p.igUserId, ...data },
        update: data,
      });

      let subscribed = false;
      try {
        const ig = clientForAccount(acc, p.pageAccessToken, e.IG_API_VERSION);
        subscribed = (await ig.subscribeWebhooks(WEBHOOK_FIELDS)).success === true;
      } catch (err) {
        logger.warn({ err, accountId: acc.id }, "page webhook subscription failed");
      }
      await prisma.igAccount.update({ where: { id: acc.id }, data: { webhooksSubscribed: subscribed } });
      await log(acc.id, "account.connected", { by: userId, via: "facebook", page: p.pageName, subscribed });
      names.push(acc.username);
    }
    return back(`connected=${encodeURIComponent(names.join(", @"))}`);
  } catch (err) {
    logger.error({ err }, "facebook connect failed");
    return back(`ig_error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
  }
}
