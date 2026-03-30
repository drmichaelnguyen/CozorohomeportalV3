import { KnowledgeChunk, KnowledgeDocument, KnowledgeTopic, SearchResult } from "./types.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you"
]);

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function inferTopicFromText(value: string): KnowledgeTopic {
  const text = normalizeText(value);

  if (/(gia|price|chi phi|cost|rent|thang|monthly)/i.test(text)) return "pricing";
  if (/(uu dai|khuyen mai|discount|promotion|goi 3|goi 6)/i.test(text)) return "discount";
  if (/(con giuong|giuong trong|availability|vacancy|available bed)/i.test(text)) return "availability";
  if (/(hop dong|huy|bao luu|policy|noi quy|rules|contract|cancellation)/i.test(text)) return "policy";
  if (/(giat|say|laundry|dryer|washer)/i.test(text)) return "laundry";
  if (/(coin|coins|cozoro coins|diem)/i.test(text)) return "coins";
  if (/(referral|gioi thieu)/i.test(text)) return "referral";
  if (/(dia chi|address|thanh thai|hau giang|quan 10|quan 6|location)/i.test(text)) return "location";
  if (/(bao nhieu nguoi|room capacity|people per room)/i.test(text)) return "room_capacity";
  return "general";
}

function inferFreshnessScore(content: string) {
  const dateMatch = content.match(
    /\b(\d{4}-\d{2}-\d{2}|[0-3]?\d\/[01]?\d\/\d{4}|[01]?\d\/[0-3]?\d\/\d{4})\b/
  );
  if (!dateMatch) {
    return 0;
  }

  const raw = dateMatch[1];
  let parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) && raw.includes("/")) {
    const [a, b, c] = raw.split("/");
    parsed = Date.parse(`${c}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`);
  }
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60 * 24));
  if (ageDays <= 30) return 3;
  if (ageDays <= 90) return 2;
  if (ageDays <= 180) return 1;
  return 0;
}

function chunkDocument(document: KnowledgeDocument) {
  const paragraphs = document.content
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: KnowledgeChunk[] = [];
  let current = "";
  let counter = 0;
  let skipSection = false;

  const pushChunk = () => {
    const content = current.trim();
    if (!content) {
      return;
    }

    chunks.push({
      id: `${document.id}:${counter}`,
      documentId: document.id,
      title: document.title,
      source: document.source,
      content,
      normalizedContent: normalizeText(content),
      keywords: tokenize(content),
      topic: inferTopicFromText(`${document.title}\n${content}`),
      priority: document.source.startsWith("learned://") ? 2 : document.source.startsWith("fanpage://") ? 1 : 3,
      freshnessScore: inferFreshnessScore(content)
    });
    counter += 1;
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.startsWith("## ")) {
      const header = paragraph.toLowerCase();
      // These are operational instructions for the bot itself, not prospect-facing knowledge.
      // Safety rules are enforced in prompts and code, so we keep them out of retrieval.
      skipSection =
        header.startsWith("## safety rules") || header.startsWith("## live data rules");
      if (skipSection) {
        continue;
      }
    }

    if (skipSection) {
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > 900 && current) {
      pushChunk();
      current = paragraph;
      continue;
    }

    current = next;
  }

  pushChunk();
  return chunks;
}

function scoreChunk(
  queryTokens: string[],
  normalizedQuery: string,
  chunk: KnowledgeChunk,
  topic?: KnowledgeTopic | null
) {
  if (!queryTokens.length) {
    return 0;
  }

  const keywordSet = new Set(chunk.keywords);
  let score = 0;

  for (const token of queryTokens) {
    if (keywordSet.has(token)) {
      score += 3;
    }

    if (chunk.normalizedContent.includes(token)) {
      score += 1;
    }
  }

  if (normalizedQuery && chunk.normalizedContent.includes(normalizedQuery)) {
    score += 5;
  }

  if (topic && topic !== "general") {
    if (chunk.topic === topic) {
      score += 6;
    } else if (chunk.topic !== "general") {
      score -= 3;
    }
  }

  score += chunk.priority;
  score += chunk.freshnessScore;

  return score;
}

export type SearchOptions = {
  topic?: KnowledgeTopic | null;
};

export class KnowledgeSearchIndex {
  private chunks: KnowledgeChunk[];

  constructor(documents: KnowledgeDocument[]) {
    this.chunks = documents.flatMap(chunkDocument);
  }

  get chunkCount() {
    return this.chunks.length;
  }

  search(question: string, limit: number, options?: SearchOptions) {
    const normalizedQuery = normalizeText(question);
    const queryTokens = tokenize(question);

    return this.chunks
      .map((chunk) => ({
        ...chunk,
        score: scoreChunk(queryTokens, normalizedQuery, chunk, options?.topic)
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit) satisfies SearchResult[];
  }
}

