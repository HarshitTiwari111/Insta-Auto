import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env, MEDIA_NAME_RE, publicMediaUrl } from "@instaauto/core";
import { requireAuth } from "../plugins/auth.js";
import { readMedia, saveBuffer, saveStream } from "../media-store.js";

/** Phone videos can be large; Meta's own limits are checked when the container is created. */
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
/** In the database (free hosting) keep videos smaller: free Postgres plans have ~0.5 GB in total. */
const MAX_DB_VIDEO_BYTES = 50 * 1024 * 1024;
/** Meta Content Publishing: images must be JPEG, max 8 MB. */
const MAX_JPEG_BYTES = 8 * 1024 * 1024;
const VIDEO_EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const UPLOAD_TOKEN_TTL_MS = 10 * 60_000;

const newName = (ext: string) => `${randomBytes(16).toString("hex")}.${ext}`;

/** iPhone HEIC/HEIF: ISO-BMFF "ftyp" box with a HEIF brand. sharp's prebuilt binary only decodes AVIF. */
function isHeic(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString("ascii", 4, 8) !== "ftyp") return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(buf.toString("ascii", 8, 12));
}

/**
 * Short-lived upload token, so the PWA can send big files straight to the API host instead of through
 * the web host's proxy (which may cap request bodies). Format: <userId>.<expiresMs>.<hmac>
 */
const sign = (payload: string) => createHmac("sha256", env().TOKEN_ENC_KEY).update(`upload:${payload}`).digest("base64url");
function makeUploadToken(userId: string): string {
  const payload = `${userId}.${Date.now() + UPLOAD_TOKEN_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}
function validUploadToken(token: string | undefined): boolean {
  const i = token?.lastIndexOf(".") ?? -1;
  if (!token || i < 0) return false;
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(sign(payload));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
  return Number(payload.split(".")[1]) > Date.now();
}

/** The upload response is read by the PWA from another origin (APP_URL). Multipart POST needs no preflight. */
function allowApp(reply: FastifyReply) {
  reply.header("Access-Control-Allow-Origin", new URL(env().APP_URL).origin).header("Vary", "Origin");
}

async function uploadAuth(req: FastifyRequest<{ Querystring: { t?: string } }>, reply: FastifyReply) {
  allowApp(reply);
  if (validUploadToken(req.query.t)) return;
  return requireAuth(req, reply);
}

export default async function mediaRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });

  /** Where the PWA should POST its file (API host + one-time-ish token). */
  app.get("/media/upload-url", { preHandler: requireAuth }, async (req) => ({
    url: `${env().API_PUBLIC_URL}/media/upload?t=${encodeURIComponent(makeUploadToken(req.session!.userId))}`,
  }));

  /** Upload one photo or video. Photos are converted to JPEG (EXIF rotation applied). */
  app.post<{ Querystring: { t?: string } }>("/media/upload", { preHandler: uploadAuth }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no file" });

    const videoExt = VIDEO_EXT[file.mimetype];
    if (videoExt) {
      const name = newName(videoExt);
      const limit = env().UPLOAD_STORAGE === "db" ? MAX_DB_VIDEO_BYTES : MAX_UPLOAD_BYTES;
      const ok = await saveStream(name, file.file, () => file.file.truncated, limit);
      if (!ok) return reply.code(413).send({ error: `Video is larger than ${Math.round(limit / 1024 / 1024)} MB` });
      return { url: publicMediaUrl(name), type: "video" as const };
    }

    // Some browsers send .heic with an empty / generic type
    if (!file.mimetype.startsWith("image/") && !/\.hei[cf]$/i.test(file.filename)) {
      return reply.code(415).send({ error: "Only photos (JPG, PNG, WebP) and videos (MP4, MOV) are supported" });
    }
    let jpeg: Buffer;
    try {
      let input = await file.toBuffer();
      if (isHeic(input)) input = Buffer.from(await heicConvert({ buffer: input, format: "JPEG", quality: 0.92 }));
      jpeg = await sharp(input)
        .rotate()
        .resize({ width: 1440, height: 1800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      req.log.warn({ err: (err as Error).message, mimetype: file.mimetype, filename: file.filename }, "photo conversion failed");
      return reply.code(415).send({ error: "Could not read this photo. Please use JPG or PNG." });
    }
    if (jpeg.length > MAX_JPEG_BYTES) return reply.code(413).send({ error: "Photo is too large after conversion (max 8 MB)" });
    const name = newName("jpg");
    await saveBuffer(name, jpeg);
    return { url: publicMediaUrl(name), type: "image" as const };
  });

  /** Public: Meta downloads the media from here when publishing. Names are random, so not guessable. */
  app.get<{ Params: { name: string } }>("/media/:name", { config: { rateLimit: false } }, async (req, reply) => {
    const { name } = req.params;
    if (!MEDIA_NAME_RE.test(name)) return reply.code(404).send({ error: "not_found" });
    const media = await readMedia(name);
    if (!media) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("Content-Type", media.mimeType)
      .header("Content-Length", media.size)
      .header("Cache-Control", "public, max-age=86400")
      .header("Cross-Origin-Resource-Policy", "cross-origin") // helmet default (same-origin) would block PWA previews
      .send(media.body);
  });
}
