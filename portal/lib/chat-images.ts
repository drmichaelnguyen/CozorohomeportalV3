import { compressPortalImage } from "./compress-image";

export type ChatAttachment = { id: string; fileName: string; mimeType: string; byteSize: number; width: number | null; height: number | null };
export type PendingChatImage = { dataUrl: string; fileName: string; width: number; height: number };

export async function compressChatImage(file: File): Promise<PendingChatImage> {
  const compressed = await compressPortalImage(file, {
    maxSide: 1600,
    maxBytes: 1_900_000,
    quality: 0.82
  });
  return {
    dataUrl: compressed.dataUrl,
    fileName: compressed.fileName,
    width: compressed.width,
    height: compressed.height
  };
}
