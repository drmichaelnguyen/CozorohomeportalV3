export type CompressedPortalImage = {
  dataUrl: string;
  dataBase64: string;
  fileName: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
};

export type CompressPortalImageOptions = {
  /** Longest side in pixels. Default 1600. */
  maxSide?: number;
  /** Target max bytes after compression. Default 1.5 MB. */
  maxBytes?: number;
  /** Starting JPEG quality. Default 0.82. */
  quality?: number;
};

/**
 * Canvas-compress an image for upload. Rejects non-images and unsupported
 * formats (e.g. HEIC on browsers without decode support) with a clear Error.
 */
export async function compressPortalImage(
  file: File,
  options?: CompressPortalImageOptions
): Promise<CompressedPortalImage> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("Please choose an image file (JPEG, PNG, or WebP).");
  }

  const maxSide = options?.maxSide ?? 1600;
  const maxBytes = options?.maxBytes ?? 1_500_000;
  let quality = options?.quality ?? 0.82;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This photo format is not supported in this browser (HEIC/HEIF often fails). Please retake as JPEG or convert the image."
    );
  }

  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to process this photo on this device.");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    let blob: Blob | null = null;
    do {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      quality -= 0.1;
    } while (blob && blob.size > maxBytes && quality >= 0.45);

    if (!blob || blob.size > maxBytes * 1.15) {
      throw new Error("This image could not be compressed small enough. Please try another photo.");
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Unable to read compressed photo."));
      reader.readAsDataURL(blob!);
    });
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      throw new Error("Invalid compressed photo.");
    }

    const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 180) || "photo";
    return {
      dataUrl,
      dataBase64: match[2]!,
      fileName: `${baseName}.jpg`,
      mimeType: "image/jpeg",
      width,
      height,
      byteSize: blob.size
    };
  } finally {
    bitmap.close();
  }
}
