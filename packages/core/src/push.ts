import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;

export function configurePush(publicKey: string, privateKey: string, subject: string): boolean {
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/** Sends to all targets. Returns endpoints that are gone (404/410) so callers can delete them. */
export async function sendPush(
  targets: PushTarget[],
  payload: { title: string; body: string; url?: string },
): Promise<string[]> {
  if (!configured) return [];
  const gone: string[] = [];
  const data = JSON.stringify(payload);
  await Promise.all(
    targets.map(async (t) => {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, data, {
          TTL: 3600,
        });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(t.endpoint);
      }
    }),
  );
  return gone;
}
