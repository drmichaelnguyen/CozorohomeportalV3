import { config } from "../config.js";
import { loadFanpageTranscriptKnowledgeDocuments } from "../fanpage-transcript.js";
import { loadLearnedKnowledgeDocuments } from "../learning.js";
import {
  loadLocalKnowledgeDocuments,
  loadRemoteKnowledgeDocumentsFromSources,
  loadRemoteKnowledgeSources
} from "./loaders.js";
import { KnowledgeSearchIndex } from "./search.js";
import { SearchResult } from "./types.js";
import { SearchOptions } from "./search.js";

type KnowledgeStatus = {
  loadedAt: string | null;
  documentCount: number;
  chunkCount: number;
  sources: string[];
};

export class KnowledgeService {
  private index = new KnowledgeSearchIndex([]);
  private status: KnowledgeStatus = {
    loadedAt: null,
    documentCount: 0,
    chunkCount: 0,
    sources: []
  };

  async refresh() {
    const sourceEntries = await loadRemoteKnowledgeSources(config.knowledgeRemoteSourceFile);
    const remoteEntries = [
      ...sourceEntries,
      ...config.knowledgeRemoteUrls.map((url) => ({ url }))
    ];

    const [localDocuments, remoteDocuments, learnedDocuments, fanpageDocuments] = await Promise.all([
      loadLocalKnowledgeDocuments(config.knowledgeLocalPaths),
      loadRemoteKnowledgeDocumentsFromSources(remoteEntries),
      loadLearnedKnowledgeDocuments(),
      loadFanpageTranscriptKnowledgeDocuments(config.fanpageTranscriptPaths)
    ]);

    const documents = [...localDocuments, ...remoteDocuments, ...learnedDocuments, ...fanpageDocuments];
    this.index = new KnowledgeSearchIndex(documents);
    this.status = {
      loadedAt: new Date().toISOString(),
      documentCount: documents.length,
      chunkCount: this.index.chunkCount,
      sources: documents.map((document) => document.source)
    };

    return this.status;
  }

  search(question: string, options?: SearchOptions) {
    return this.index.search(question, config.topK, options);
  }

  getStatus() {
    return this.status;
  }
}

export type { SearchResult };
export type { SearchOptions };
