import { api } from "./api";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Must be called from a user tap (iOS requires a user gesture for the permission prompt). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Push not supported here. On iPhone, install the app to the Home Screen first (iOS 16.4+).");
  const { key } = await api<{ key: string | null }>("/push/public-key");
  if (!key) throw new Error("Server has no VAPID keys configured");
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new Error(
      "Notifications are blocked for this site in your browser. Click the icon left of the address bar → Notifications → Allow, then reload and try again.",
    );
  }
  if (permission !== "granted") throw new Error("Notification permission was not granted");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  await api("/push/subscribe", { method: "POST", json: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api("/push/unsubscribe", { method: "POST", json: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(await reg?.pushManager.getSubscription());
}
