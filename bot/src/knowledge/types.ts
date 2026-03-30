export type KnowledgeDocument = {
  id: string;
  title: string;
  source: string;
  content: string;
};

export type KnowledgeTopic =
  | "general"
  | "pricing"
  | "discount"
  | "availability"
  | "policy"
  | "laundry"
  | "coins"
  | "referral"
  | "location"
  | "room_capacity";

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  title: string;
  source: string;
  content: string;
  normalizedContent: string;
  keywords: string[];
  topic: KnowledgeTopic;
  priority: number;
  freshnessScore: number;
};

export type SearchResult = KnowledgeChunk & {
  score: number;
};
