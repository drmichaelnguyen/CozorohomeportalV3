import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { KnowledgeDocument } from "./types.js";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

export type RemoteKnowledgeSource = {
  hints?: string[] | string;
  title?: string;
  url: string;
};

function createDocumentId(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

function stripHtmlTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function readPathRecursively(entryPath: string): Promise<string[]> {
  const info = await stat(entryPath);
  if (info.isFile()) {
    return [entryPath];
  }

  if (!info.isDirectory()) {
    return [];
  }

  const children = await readdir(entryPath, { withFileTypes: true });
  const nested = await Promise.all(
    children.map((child) => readPathRecursively(path.join(entryPath, child.name)))
  );

  return nested.flat();
}

export async function loadLocalKnowledgeDocuments(paths: string[]) {
  const discoveredPaths = (
    await Promise.all(
      paths.map(async (entryPath) => {
        try {
          return await readPathRecursively(entryPath);
        } catch {
          return [];
        }
      })
    )
  ).flat();

  const files = discoveredPaths
    .filter((filePath) => ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));

  const documents = await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      return {
        id: createDocumentId(filePath),
        title: path.basename(filePath),
        source: filePath,
        content
      } satisfies KnowledgeDocument;
    })
  );

  return documents.filter((document) => document.content.trim());
}

export async function loadRemoteKnowledgeDocuments(urls: string[]) {
  const entries = urls.map((url) => ({ url }));
  return loadRemoteKnowledgeDocumentsFromSources(entries);
}

export async function loadRemoteKnowledgeSources(sourceFilePath: string) {
  try {
    const raw = await readFile(sourceFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is RemoteKnowledgeSource => {
        return Boolean(
          entry &&
            typeof entry === "object" &&
            "url" in entry &&
            typeof (entry as { url?: unknown }).url === "string"
        );
      })
      .map((entry) => ({
        hints:
          Array.isArray(entry.hints)
            ? entry.hints.filter((value): value is string => typeof value === "string")
            : typeof entry.hints === "string"
              ? entry.hints
              : undefined,
        title: typeof entry.title === "string" ? entry.title : undefined,
        url: entry.url
      }));
  } catch {
    return [];
  }
}

export async function loadRemoteKnowledgeDocumentsFromSources(entries: RemoteKnowledgeSource[]) {
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const url = entry.url;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Remote knowledge request failed with ${response.status}`);
        }

        const rawText = await response.text();
        const content = /<html[\s>]/i.test(rawText) ? stripHtmlTags(rawText) : rawText;
        const normalizedHints = Array.isArray(entry.hints)
          ? entry.hints.join(", ")
          : typeof entry.hints === "string"
            ? entry.hints
            : "";
        const augmentedContent = normalizedHints
          ? `Knowledge tags: ${normalizedHints}\n\n${content}`
          : content;

        return {
          id: createDocumentId(url),
          title: entry.title?.trim() || new URL(url).hostname,
          source: url,
          content: augmentedContent
        } satisfies KnowledgeDocument;
      } catch (error) {
        console.warn(`[bot] Failed to load remote knowledge from ${entry.url}`, error);
        return null;
      }
    })
  );

  return results.filter((document): document is KnowledgeDocument => Boolean(document?.content.trim()));
}
