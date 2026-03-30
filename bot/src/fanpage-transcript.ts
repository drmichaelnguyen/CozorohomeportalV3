import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeVietnameseChatText } from "./language.js";
import { KnowledgeDocument } from "./knowledge/types.js";

export type FanpageTranscriptExample = {
  id: string;
  question: string;
  answer: string;
  source: string;
  tags: string[];
  createdAt: string;
};

type Speaker = "customer" | "admin";

type Utterance = {
  speaker: Speaker;
  text: string;
};

const NOISE_PATTERNS = [
  /^chat cases:/i,
  /^sent by /i,
  /^seen by /i,
  /^lead stage set to /i,
  /^cozoro replied to /i,
  /^.+ replied to an ad\./i,
  /^.+ a r[ée]pondu [àa] /i,
  /learn more$/i
];

const DATE_LINE_PATTERN =
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2},\s+\d{4}/i;

const ADMIN_LINE_PATTERNS = [
  /^cozoro ch[aà]o/i,
  /^d[ạa]\b/i,
  /^ch[aà]o b[ạa]n/i,
  /^ở chi nh[aá]nh/i,
  /^kh[oô]ng bi[ếe]t b[ạa]n/i,
  /^t[uụ]i m[ìi]nh/i,
  /^b[ạa]n c[oó] th[ểe] li[êe]n h[ệe]/i,
  /^tr[ườu]ng h[ợo]p c[ủu]a m[ìi]nh/i,
  /^hi[ệe]n t[ạa]i b[êe]n m[ìi]nh/i,
  /^h[ợo]p đ[ồo]ng/i,
  /^gi[ườu]ng tr[êe]n/i,
  /^gi[ườu]ng gi[ữu]a/i,
  /^khuy[ếe]n m[aã]i/i,
  /^chi ph[ií]/i,
  /^[-•*]/,
  /0902949682/,
  /(locker|wifi|gym|camera an ninh|m[aá]y gi[ặa]t|m[aá]y s[ấa]y|khuy[ếe]n m[aã]i|ưu đ[aã]i|g[ií]a trung b[ìi]nh|c[oọ]c online|ti[ệe]n nghi|chi nh[aá]nh qu[aậ]n)/i
];

const CUSTOMER_LINE_PATTERNS = [
  /\?$/,
  /\b(em|m[ìi]nh|shop ơi|cho em h[ỏo]i|xin gi[aá]|chi ph[ií]|gi[aá] nh[ưu] th[ếe] n[aà]o|c[oò]n gi[ườu]ng|mu[ốo]n [ởo]|xem m[ẫa]u dorm|c[oọ]c|qu[aậ]n 10|qu[aậ]n 6)\b/i
];

const CUSTOMER_QUESTION_PATTERNS = [
  /\?$/,
  /(cho em h[ỏo]i|xin gi[aá]|gi[aá]|chi ph[ií]|bao nhi[êe]u|m[aấ]y ng[ườu]i|c[oò]n gi[ườu]ng|c[oọ]c|xem ph[oò]ng|xem m[ẫa]u|ở [13-9]+ th[aá]ng|qu[aậ]n 10|qu[aậ]n 6|nh[aâ]n vi[êe]n y t[ếe]|đi h[oọ]c)/i
];

const ADMIN_ANSWER_PATTERNS = [
  /(cozoro|chi nh[aá]nh|ti[ệe]n nghi|ưu đ[aã]i|khuy[ếe]n m[aã]i|gi[ườu]ng|h[ợo]p đ[ồo]ng|c[oọ]c|m[aá]y gi[ặa]t|m[aá]y s[ấa]y|coins|0902949682|dorm|locker|wifi|gym|camera|đ[aặ]t c[oọ]c|g[ií]a trung b[ìi]nh|ph[ií] ở|gửi xe)/i
];

function createId(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

function decodeVisibleArtifacts(value: string) {
  return value
    .replace(/â€¯/g, " ")
    .replace(/â€”/g, "-")
    .replace(/â€¢/g, "•")
    .replace(/ðŸ”¸/g, "-")
    .replace(/ðŸ“/g, "Dia chi:")
    .replace(/ðŸŒ±/g, "-")
    .replace(/ðŸŒŸ/g, "-")
    .replace(/ðŸ›¢ï¸/g, "-")
    .replace(/ðŸ–/g, "-")
    .replace(/ðŸ‘•/g, "-")
    .replace(/â„ï¸/g, "-")
    .replace(/ðŸ›Œ/g, "-")
    .replace(/ðŸŒ /g, "-")
    .replace(/ðŸŠ/g, "-")
    .replace(/ðŸª/g, "-")
    .replace(/â¤ï¸|â¤\d*/g, " ")
    .replace(/\u00a0/g, " ");
}

function cleanLine(value: string) {
  return decodeVisibleArtifacts(value).replace(/\s+/g, " ").trim();
}

function isNoiseLine(line: string) {
  if (!line) {
    return true;
  }

  if (line === "-" || line === "—" || line === "––") {
    return true;
  }

  if (DATE_LINE_PATTERN.test(line)) {
    return true;
  }

  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function looksLikeSpeakerLabel(line: string) {
  if (!line || line.length > 40) {
    return false;
  }

  if (/[?!,:]/.test(line)) {
    return false;
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) {
    return false;
  }

  return words.every((word) => /^[\p{L}][\p{L}'’. -]*$/u.test(word));
}

function detectSpeaker(line: string, previousSpeaker: Speaker | null): Speaker | null {
  if (ADMIN_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
    return "admin";
  }

  if (CUSTOMER_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
    return "customer";
  }

  if (looksLikeSpeakerLabel(line)) {
    return null;
  }

  if (previousSpeaker === "admin") {
    return "admin";
  }

  if (previousSpeaker === "customer" && line.length <= 140) {
    return "customer";
  }

  return line.length > 100 ? "admin" : "customer";
}

function buildUtterances(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line, index, all) => !(line === all[index - 1] && line.length > 20));

  const utterances: Utterance[] = [];
  let previousSpeaker: Speaker | null = null;

  for (const line of lines) {
    if (isNoiseLine(line) || looksLikeSpeakerLabel(line)) {
      continue;
    }

    const speaker = detectSpeaker(line, previousSpeaker);
    if (!speaker) {
      continue;
    }

    const previous = utterances[utterances.length - 1];
    const shouldMerge =
      previous?.speaker === speaker &&
      ((speaker === "admin" && previous.text.length < 900) ||
        (speaker === "customer" && previous.text.length < 160));

    if (shouldMerge) {
      previous.text = `${previous.text}\n${line}`.trim();
    } else {
      utterances.push({ speaker, text: line });
    }

    previousSpeaker = speaker;
  }

  return utterances;
}

function normalizePairText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function inferTags(question: string, answer: string) {
  const text = normalizeVietnameseChatText(`${question}\n${answer}`).toLowerCase();
  const tags = ["fanpage-transcript"];

  if (/(gia|bao nhieu|chi phi|1\.499|1\.599|1\.870|1\.980|thang)/i.test(text)) tags.push("pricing");
  if (/(khuyen mai|uu dai|giam|goi 3|goi 6|tet 2026)/i.test(text)) tags.push("discount");
  if (/(con giuong|giuong trong|slot|con cho)/i.test(text)) tags.push("availability");
  if (/(quan 10|q10|thanh thai|quan 6|q6|hau giang|dia chi)/i.test(text)) tags.push("location");
  if (/(may giat|may say|coins|coin|giu xe)/i.test(text)) tags.push("amenities");
  if (/(3-6 nguoi|6 nguoi|9 nguoi|phong 6|phong 9)/i.test(text)) tags.push("room_capacity");
  if (/(coc|giu cho|online)/i.test(text)) tags.push("deposit");

  return [...new Set(tags)];
}

function looksLikeCustomerQuestion(text: string) {
  if (text.length < 4 || text.length > 220) {
    return false;
  }

  if (ADMIN_LINE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }

  if (/^[-•*]/.test(text) || /(locker|wifi|gym|camera|máy giặt|máy sấy)/i.test(text)) {
    return false;
  }

  return CUSTOMER_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikeAdminAnswer(text: string) {
  if (text.length < 20 || text.length > 1500) {
    return false;
  }

  return ADMIN_ANSWER_PATTERNS.some((pattern) => pattern.test(text));
}

function isUsefulPair(question: string, answer: string) {
  return looksLikeCustomerQuestion(question) && looksLikeAdminAnswer(answer);
}

function extractExamplesFromUtterances(utterances: Utterance[], source: string) {
  const examples: FanpageTranscriptExample[] = [];

  for (let index = 0; index < utterances.length - 1; index += 1) {
    const current = utterances[index];
    const next = utterances[index + 1];

    if (current.speaker !== "customer" || next.speaker !== "admin") {
      continue;
    }

    const question = normalizePairText(current.text);
    const answer = normalizePairText(next.text);
    if (!isUsefulPair(question, answer)) {
      continue;
    }

    const tags = inferTags(question, answer);
    examples.push({
      id: createId(`${source}:${question}:${answer}`),
      question,
      answer,
      source,
      tags,
      createdAt: new Date("2026-03-29T00:00:00.000Z").toISOString()
    });
  }

  return examples;
}

export async function loadFanpageTranscriptExamples(filePaths: string[]) {
  const examples: FanpageTranscriptExample[] = [];

  for (const filePath of filePaths) {
    try {
      const raw = await readFile(filePath, "utf8");
      const source = `fanpage://${path.basename(filePath)}`;
      examples.push(...extractExamplesFromUtterances(buildUtterances(raw), source));
    } catch (error) {
      console.warn(`[bot] Failed to parse fanpage transcript ${filePath}`, error);
    }
  }

  const deduped = new Map<string, FanpageTranscriptExample>();
  for (const example of examples) {
    const key = normalizeVietnameseChatText(example.question);
    if (!deduped.has(key)) {
      deduped.set(key, example);
    }
  }

  return [...deduped.values()];
}

export async function loadFanpageTranscriptKnowledgeDocuments(filePaths: string[]) {
  const examples = await loadFanpageTranscriptExamples(filePaths);

  return examples.map(
    (example, index) =>
      ({
        id: createId(`${example.id}:${index}`),
        title: `Fanpage case ${index + 1}`,
        source: `${example.source}#${example.id}`,
        content: [
          `Question: ${example.question}`,
          `Answer: ${example.answer}`,
          `Tags: ${example.tags.join(", ")}`,
          `Created at: ${example.createdAt}`
        ].join("\n")
      }) satisfies KnowledgeDocument
  );
}
