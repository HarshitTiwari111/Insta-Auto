import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { MEDIA_NAME_RE, publicMediaUrl, uploadDir } from "@instaauto/core";
import { requireAuth } from "../plugins/auth.js";

/** Phone videos can be large; Meta's own limits are checked when the container is created. */
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
/** Meta Content Publishing: images must be JPEG, max 8 MB. */
const MAX_JPEG_BYTES = 8 * 1024 * 1024;
const VIDEO_EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const CONTENT_TYPE: Record<string, string> = { jpg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime" };

const newName = (ext: string) => `${randomBytes(16).toString("hex")}.${ext}`;

/** iPhone HEIC/HEIF: ISO-BMFF "ftyp" box with a HEIF brand. sharp's prebuilt binary only decodes AVIF. */
function isHeic(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString("ascii", 4, 8) !== "ftyp") return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(buf.toString("ascii", 8, 12));
}

export default async function mediaRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });

  /** Upload one photo or video. Photos are converted to JPEG (EXIF rotation applied). */
  app.post("/media/upload", { preHandler: requireAuth }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no file" });
    const dir = uploadDir();
    await mkdir(dir, { recursive: true });

    const videoExt = VIDEO_EXT[file.mimetype];
    if (videoExt) {
      const name = newName(videoExt);
      const path = join(dir, name);
      try {
        await pipeline(file.file, createWriteStream(path));
      } catch (err) {
        await unlink(path).catch(() => undefined); // client aborted mid-upload: don't keep half a file
        throw err;
      }
      if (file.file.truncated) {
        await unlink(path).catch(() => undefined);
        return reply.code(413).send({ error: "Video is larger than 300 MB" });
      }
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
    await writeFile(join(dir, name), jpeg);
    return { url: publicMediaUrl(name), type: "image" as const };
  });

  /** Public: Meta downloads the media from here when publishing. Names are random, so not guessable. */
  app.get<{ Params: { name: string } }>("/media/:name", { config: { rateLimit: false } }, async (req, reply) => {
    const { name } = req.params;
    if (!MEDIA_NAME_RE.test(name)) return reply.code(404).send({ error: "not_found" });
    const path = join(uploadDir(), name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return reply.code(404).send({ error: "not_found" });
    const ext = name.split(".").pop()!;
    return reply
      .header("Content-Type", CONTENT_TYPE[ext] ?? "application/octet-stream")
      .header("Content-Length", info.size)
      .header("Cache-Control", "public, max-age=86400")
      .header("Cross-Origin-Resource-Policy", "cross-origin") // helmet default (same-origin) would block PWA previews
      .send(createReadStream(path));
  });
}
