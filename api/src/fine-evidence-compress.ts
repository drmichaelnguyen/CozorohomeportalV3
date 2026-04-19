import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const require = createRequire(import.meta.url);

let cachedFfmpegPath: string | null | undefined;

function getFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) {
    return cachedFfmpegPath;
  }

  try {
    const ffmpegStatic = require("ffmpeg-static") as unknown;
    cachedFfmpegPath = typeof ffmpegStatic === "string" && ffmpegStatic.length > 0 ? ffmpegStatic : null;
  } catch (error) {
    console.warn("[fine-evidence] ffmpeg-static unavailable; uploading original videos (no transcode)", error);
    cachedFfmpegPath = null;
  }

  return cachedFfmpegPath;
}

const MAX_IMAGE_EDGE = 1920;
const JPEG_QUALITY = 82;

export type CompressedEvidence = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
};

/**
 * Resize / re-encode images and transcode videos to reduce Drive storage and bandwidth.
 */
export async function compressFineEvidence(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<CompressedEvidence> {
  if (!buffer.length) {
    throw new Error("The uploaded file is empty.");
  }

  const mt = mimeType.toLowerCase().split(";")[0]!.trim();
  const baseName = (fileName || "evidence").replace(/\.[^/.]+$/, "") || "evidence";

  if (mt.startsWith("image/")) {
    return compressImage(buffer, mt, baseName);
  }

  if (mt.startsWith("video/")) {
    return compressVideo(buffer, fileName, baseName);
  }

  return { buffer, mimeType: mt, fileName: fileName || "evidence.bin" };
}

async function compressImage(buffer: Buffer, mimeType: string, baseName: string): Promise<CompressedEvidence> {
  try {
    const img = sharp(buffer, { failOn: "none", animated: false }).rotate();
    const meta = await img.metadata();
    let pipeline = img;
    if (meta.width && meta.height) {
      const maxSide = Math.max(meta.width, meta.height);
      if (maxSide > MAX_IMAGE_EDGE) {
        pipeline = pipeline.resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, {
          fit: "inside",
          withoutEnlargement: true
        });
      }
    }
    const out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    return {
      buffer: out,
      mimeType: "image/jpeg",
      fileName: `${sanitizeFileBase(baseName)}.jpg`
    };
  } catch (error) {
    console.warn("[fine-evidence] image compress failed, using original", error);
    const ext = mimeToImageExt(mimeType);
    return {
      buffer,
      mimeType,
      fileName: `${sanitizeFileBase(baseName)}.${ext}`
    };
  }
}

function mimeToImageExt(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function sanitizeFileBase(name: string): string {
  return name.replace(/[^\w\-]+/g, "_").slice(0, 80) || "evidence";
}

async function compressVideo(buffer: Buffer, originalName: string, baseName: string): Promise<CompressedEvidence> {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    console.warn("[fine-evidence] ffmpeg-static not available; uploading original video (no transcode)");
    const ext = guessVideoExt(originalName, "mp4");
    return {
      buffer,
      mimeType: guessVideoMime(ext),
      fileName: `${sanitizeFileBase(baseName)}.${ext}`
    };
  }

  const id = randomUUID();
  const inPath = join(tmpdir(), `fine-vin-${id}`);
  const outPath = join(tmpdir(), `fine-vout-${id}.mp4`);

  await writeFile(inPath, buffer);

  const args = [
    "-y",
    "-i",
    inPath,
    "-vf",
    "scale='min(1280,iw)':-2",
    "-c:v",
    "libx264",
    "-crf",
    "28",
    "-preset",
    "fast",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outPath
  ];

  try {
    await runFfmpeg(ffmpegPath, args);
    const out = await readFile(outPath);
    if (!out.length) {
      throw new Error("Compressed video is empty.");
    }
    return {
      buffer: out,
      mimeType: "video/mp4",
      fileName: `${sanitizeFileBase(baseName)}.mp4`
    };
  } catch (error) {
    console.warn("[fine-evidence] video transcode failed; uploading original", error);
    if (buffer.length > 80 * 1024 * 1024) {
      throw new Error(
        "Video is too large to upload without compression. Try a shorter clip or install ffmpeg on the server."
      );
    }
    const ext = guessVideoExt(originalName, "mp4");
    return {
      buffer,
      mimeType: guessVideoMime(ext),
      fileName: `${sanitizeFileBase(baseName)}.${ext}`
    };
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function guessVideoExt(fileName: string, fallback: string): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (m?.[1] && ["mp4", "mov", "webm", "m4v", "mkv"].includes(m[1])) {
    return m[1];
  }
  return fallback;
}

function guessVideoMime(ext: string): string {
  switch (ext) {
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    default:
      return "video/mp4";
  }
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}
