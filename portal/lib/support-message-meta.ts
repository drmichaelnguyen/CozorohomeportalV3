/** Allow `\r\n` (Windows / some DB clients) before the trailer. */
const SUPPORT_ASSISTANT_META_RE = /\r?\n\[\[cozoro-meta:(vent-offer|vent-start|founder-egg)\]\]\s*$/;

export type SupportAssistantClientMeta = "vent-offer" | "vent-start" | "founder-egg";

/** Strip machine trailer from assistant messages (not shown in UI / notifications). */
export function supportMessageDisplayBody(stored: string): string {
  const m = stored.match(SUPPORT_ASSISTANT_META_RE);
  if (!m || m.index === undefined) return stored;
  return stored.slice(0, m.index).trimEnd();
}

export function parseSupportAssistantMeta(stored: string): SupportAssistantClientMeta | null {
  const m = stored.match(SUPPORT_ASSISTANT_META_RE);
  if (!m) return null;
  return m[1] as SupportAssistantClientMeta;
}
