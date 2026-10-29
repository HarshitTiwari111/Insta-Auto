import type { FastifyInstance } from "fastify";

/**
 * Public privacy policy + data deletion instructions. Meta requires both URLs before an app can go Live,
 * and the API is the part that is publicly reachable (tunnel / deployed host).
 */
const CONTACT = "harshit@launchigo.in";
const UPDATED = "29 October 2026";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy · AutoReply by Launchigo</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:28px}h2{font-size:20px;margin-top:32px}</style>
</head><body>
<h1>Privacy Policy</h1>
<p>AutoReply is an internal tool of Launchigo (Lucknow, India) that helps our own team manage our Instagram business account. Last updated: ${UPDATED}.</p>

<h2>What data we access</h2>
<p>When an account owner connects an Instagram professional account through Meta's login, we receive, through the official Instagram API:</p>
<ul>
<li>Account details: Instagram account ID, username, profile picture, follower and post counts, and the linked Facebook Page.</li>
<li>Comments on our posts and direct messages sent to our account, including the sender's Instagram-scoped ID and username.</li>
<li>Our own posts and their like and comment counts.</li>
</ul>

<h2>How we use it</h2>
<ul>
<li>To reply to comments and messages (automatically, by our rules or with AI-written text), hide spam comments, and schedule our own posts.</li>
<li>To show our team an activity log and basic statistics.</li>
</ul>
<p>Message and comment text may be sent to Google Gemini to draft a reply. We do not sell data, use it for advertising, or share it with anyone else.</p>

<h2>Storage and security</h2>
<p>Data is stored on our own servers. Access tokens are encrypted. Webhook events are deleted after 30 days and activity logs after 90 days. Uploaded media is deleted 7 days after publishing.</p>

<h2 id="data-deletion">Data deletion</h2>
<p>To delete your data, email <a href="mailto:${CONTACT}">${CONTACT}</a> with your Instagram username. We delete all messages, comments and account data linked to you within 30 days and confirm by email. Account owners can also disconnect the account in the app (Settings → account → Remove), which deletes all of its stored data immediately, and can remove the app in Instagram / Facebook settings under "Apps and websites".</p>

<h2>Contact</h2>
<p>Launchigo · <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</body></html>`;

export default async function privacyRoutes(app: FastifyInstance) {
  app.get("/privacy", { config: { rateLimit: false } }, async (_req, reply) =>
    reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "public, max-age=3600").send(html),
  );
}
