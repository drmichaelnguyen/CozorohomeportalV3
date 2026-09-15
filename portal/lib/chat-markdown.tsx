import type { ReactNode } from "react";

/** Render LLM markdown as styled text instead of raw `**asterisks**`. */
export function ChatFormattedText({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  return <div className={className ?? "leading-relaxed"}>{formatChatMarkdown(text)}</div>;
}

export function stripChatMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^\w])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^\w])_([^_\n]+)_(?!_)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
}

function formatChatMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const headingClass =
        level === 1 ? "mb-1 mt-2 text-[15px] font-bold" : level === 2 ? "mb-1 mt-2 text-sm font-bold" : "mb-1 mt-1.5 text-sm font-semibold";
      nodes.push(
        <p key={key++} className={headingClass}>
          {formatInline(heading[2] ?? "")}
        </p>
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ul key={key++} className="my-1.5 list-disc space-y-0.5 pl-4">
          {items.map((item, idx) => (
            <li key={idx}>{formatInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-0.5 pl-4">
          {items.map((item, idx) => (
            <li key={idx}>{formatInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i] ?? "") &&
      !/^(#{1,3})\s+/.test(lines[i] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? "")
    ) {
      paragraph.push(lines[i] ?? "");
      i += 1;
    }
    nodes.push(
      <p key={key++} className="mb-1.5 last:mb-0">
        {paragraph.map((part, idx) => (
          <span key={idx}>
            {idx > 0 ? <br /> : null}
            {formatInline(part)}
          </span>
        ))}
      </p>
    );
  }

  return nodes;
}

function formatInline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_|`[^`]+?`)/g);
  return tokens.map((token, idx) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(token) || /^__([^_]+)__$/.exec(token);
    if (bold) {
      return (
        <strong key={idx} className="font-semibold">
          {bold[1]}
        </strong>
      );
    }
    const italic = /^\*([^*]+)\*$/.exec(token) || /^_([^_]+)_$/.exec(token);
    if (italic) {
      return (
        <em key={idx} className="italic">
          {italic[1]}
        </em>
      );
    }
    const code = /^`([^`]+)`$/.exec(token);
    if (code) {
      return (
        <code key={idx} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em]">
          {code[1]}
        </code>
      );
    }
    return <span key={idx}>{token}</span>;
  });
}
