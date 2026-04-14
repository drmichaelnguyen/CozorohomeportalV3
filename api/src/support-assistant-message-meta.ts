const SUPPORT_ASSISTANT_META_SUFFIX_RE = /\n\[\[cozoro-meta:(vent-offer|vent-start|founder-egg)\]\]\s*$/;

export type SupportAssistantStoredMeta = "vent-offer" | "vent-start" | "founder-egg";

export function stripSupportAssistantMetaSuffix(stored: string): string {
  const m = stored.match(SUPPORT_ASSISTANT_META_SUFFIX_RE);
  if (!m || m.index === undefined) return stored;
  return stored.slice(0, m.index).trimEnd();
}

export function appendSupportAssistantMetaSuffix(body: string, meta: SupportAssistantStoredMeta | undefined): string {
  if (!meta) return body;
  return `${body.trimEnd()}\n[[cozoro-meta:${meta}]]`;
}
