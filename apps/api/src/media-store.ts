/**
 * Where uploaded media lives: on disk (UPLOAD_DIR) or in Postgres (UPLOAD_STORAGE=db, for free hosts
 * whose disk is wiped on every restart/deploy).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env, uploadDir } from "@instaauto/core";
import { prisma } from "@instaauto/db";

export const CONTENT_TYPE: Record<string, string> = { jpg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime" };
const mimeOf = (name: string) => CONTENT_TYPE[name.split(".").pop() ?? ""] ?? "application/octet-stream";
const inDb = () => env().UPLOAD_STORAGE === "db";

export async function saveBuffer(name: string, data: Buffer): Promise<void> {
  if (inDb()) {
    await prisma.mediaFile.create({ data: { name, mimeType: mimeOf(name), data: new Uint8Array(data), size: data.length } });
    return;
  }
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(join(uploadDir(), name), data);
}

/**
 * Stream an upload to storage. Returns false when the stream was cut at the size limit
 * (`isTruncated` is read after the stream ends). Partial files are never kept.
 */
export async function saveStream(name: string, stream: Readable, isTruncated: () => boolean, maxBytes = Infinity): Promise<boolean> {
  if (inDb()) {
    // Collect in memory, but stop keeping chunks past maxBytes (free hosts have ~512 MB RAM)
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of stream) {
      total += (c as Buffer).length;
      if (total <= maxBytes) chunks.push(c as Buffer);
    }
    if (isTruncated() || total > maxBytes) return false;
    await saveBuffer(name, Buffer.concat(chunks));
    return true;
  }
  await mkdir(uploadDir(), { recursive: true });
  const path = join(uploadDir(), name);
  try {
    await pipeline(stream, createWriteStream(path));
  } catch (err) {
    await unlink(path).catch(() => undefined); // client aborted mid-upload
    throw err;
  }
  if (isTruncated()) {
    await unlink(path).catch(() => undefined);
    return false;
  }
  return true;
}

export async function readMedia(name: string): Promise<{ size: number; mimeType: string; body: Readable | Buffer } | null> {
  if (inDb()) {
    const row = await prisma.mediaFile.findUnique({ where: { name } });
    return row ? { size: row.size, mimeType: row.mimeType, body: Buffer.from(row.data) } : null;
  }
  const path = join(uploadDir(), name);
  const info = await stat(path).catch(() => null);
  return info?.isFile() ? { size: info.size, mimeType: mimeOf(name), body: createReadStream(path) } : null;
}

export async function readMediaBuffer(name: string): Promise<Buffer | null> {
  if (inDb()) {
    const row = await prisma.mediaFile.findUnique({ where: { name }, select: { data: true } });
    return row ? Buffer.from(row.data) : null;
  }
  return readFile(join(uploadDir(), name)).catch(() => null);
}
