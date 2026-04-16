/** Returns an https embed URL for common hosts, or null to fall back to <video> or opening the link. */
export function embeddableVideoSrc(url: string): { kind: "iframe"; src: string } | { kind: "video"; src: string } | null {
  const u = url.trim();
  if (!u) {
    return null;
  }
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{6,})/i);
  if (yt?.[1]) {
    return { kind: "iframe", src: `https://www.youtube.com/embed/${yt[1]}` };
  }
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm?.[1]) {
    return { kind: "iframe", src: `https://player.vimeo.com/video/${vm[1]}` };
  }
  if (/\.mp4(\?|$)/i.test(u)) {
    return { kind: "video", src: u };
  }
  return null;
}
