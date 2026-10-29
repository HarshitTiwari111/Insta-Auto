/**
 * Media files uploaded from the PWA. Stored on the API server's disk and served at
 * <API_PUBLIC_URL>/media/<name>, because Meta's Content Publishing API fetches media from a public URL.
 */
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

/** Random 32-hex name + extension. Anything else is rejected (no path traversal). */
export const MEDIA_NAME_RE = /^[a-f0-9]{32}\.(jpg|mp4|mov)$/;
const MEDIA_URL_RE = /\/media\/([a-f0-9]{32}\.(?:jpg|mp4|mov))(?:\?.*)?$/;

/** UPLOAD_DIR, or <repo>/uploads (same folder for API and worker, whatever their cwd). */
export function uploadDir(): string {
  return env().UPLOAD_DIR || fileURLToPath(new URL("../../../uploads", import.meta.url));
}

export function publicMediaUrl(name: string): string {
  return `${env().API_PUBLIC_URL}/media/${name}`;
}

/** File name if the URL points at one of our uploads (any host), else null. */
export function uploadedMediaName(url: string): string | null {
  return MEDIA_URL_RE.exec(url)?.[1] ?? null;
}

/**
 * Our own upload URLs are rewritten to the current API_PUBLIC_URL at publish time:
 * a dev tunnel gets a new hostname on every restart. Other URLs pass through unchanged.
 */
export function currentMediaUrl(url: string): string {
  const name = uploadedMediaName(url);
  return name ? publicMediaUrl(name) : url;
}
