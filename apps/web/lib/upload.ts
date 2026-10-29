import { ApiError, api } from "@/lib/api";

/**
 * Upload a photo/video straight to the API host (not through the /api proxy, which may cap request
 * bodies on the web host). The API hands out a short-lived upload URL that carries its own token.
 */
export async function uploadMedia(file: File): Promise<{ url: string; type: "image" | "video" }> {
  const { url } = await api<{ url: string }>("/media/upload-url");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { url?: string; type?: "image" | "video"; error?: string };
  if (!res.ok || !data.url) throw new ApiError(data.error ?? `Upload failed (HTTP ${res.status})`, res.status);
  return { url: data.url, type: data.type ?? "image" };
}
