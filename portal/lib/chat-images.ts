export type ChatAttachment = { id: string; fileName: string; mimeType: string; byteSize: number; width: number | null; height: number | null };
export type PendingChatImage = { dataUrl: string; fileName: string; width: number; height: number };

export async function compressChatImage(file: File): Promise<PendingChatImage> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let quality = 0.82;
  let blob: Blob | null = null;
  do {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    quality -= 0.12;
  } while (blob && blob.size > 1_900_000 && quality >= 0.46);
  if (!blob || blob.size > 2_000_000) throw new Error("This image could not be compressed below 2 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.readAsDataURL(blob!);
  });
  return { dataUrl, fileName: `${file.name.replace(/\.[^.]+$/, "").slice(0, 180) || "image"}.jpg`, width, height };
}
