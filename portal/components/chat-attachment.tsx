"use client";
import { useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import type { ChatAttachment } from "../lib/chat-images";

export function ChatAttachmentView({ attachment, viewerEmail }: { attachment: ChatAttachment; viewerEmail: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="mt-2 flex w-full items-center gap-2 rounded-xl border border-current/20 bg-white/10 px-3 py-2 text-left text-xs hover:bg-white/20">
      <span aria-hidden="true">🖼️</span><span className="min-w-0 flex-1 truncate">{attachment.fileName}</span><span className="shrink-0 opacity-70">Load image</span>
    </button>
  );
  const source = `${API_BASE_URL}/support/attachments/${encodeURIComponent(attachment.id)}?email=${encodeURIComponent(viewerEmail)}`;
  return (
    <button type="button" onClick={() => setOpen(false)} className="mt-2 block overflow-hidden rounded-xl" title="Click to unload image">
      <img src={source} alt={attachment.fileName} className="max-h-80 w-auto max-w-full object-contain" />
    </button>
  );
}
