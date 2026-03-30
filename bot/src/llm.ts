import { z } from "zod";

import { config } from "./config.js";
import { SearchResult } from "./knowledge/service.js";
import { normalizeVietnameseChatText, PreferredLanguage } from "./language.js";
import {
  getRelevantAnswerTrainingExamples,
  getRelevantRouterExamples,
  type AnswerTrainingExample,
  type RouterTrainingExample
} from "./prompt-training.js";

const topicDecisionSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  route: z.enum(["simple_policy", "deep_policy", "off_topic"]),
  reason: z.string().min(1).max(240)
});

export type TopicDecision = z.infer<typeof topicDecisionSchema>;

export function sanitizeTextForLlm(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    // Mask likely ID numbers without masking typical VND prices like 1,700,000 or 100000.
    .replace(/\b\d{9,}\b/g, "[id]")
    .trim();
}

function extractGeminiText(payload: unknown) {
  const data = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function formatRouterExamples(title: string, examples: RouterTrainingExample[]) {
  if (!examples.length) {
    return "";
  }

  return [
    title,
    ...examples.map((example, index) =>
      [
        `${index + 1}. Input: "${sanitizeTextForLlm(example.input)}"`,
        example.context?.trim() ? `   Context: "${sanitizeTextForLlm(example.context)}"` : "",
        `   Output: decision=${example.decision}, route=${example.route}`,
        example.reason?.trim() ? `   Note: ${sanitizeTextForLlm(example.reason)}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n");
}

function formatAnswerTrainingExamples(examples: AnswerTrainingExample[]) {
  if (!examples.length) {
    return "";
  }

  return [
    "Relevant approved local Cozoro answer examples:",
    ...examples.map((example, index) =>
      [
        `${index + 1}. Customer: ${sanitizeTextForLlm(example.question)}`,
        `   Cozoro: ${sanitizeTextForLlm(example.answer)}`,
        `   Source: ${sanitizeTextForLlm(example.source)}`
      ].join("\n")
    )
  ].join("\n");
}

async function callGemini<T>({
  model,
  prompt,
  maxOutputTokens,
  mimeType,
  jsonSchema
}: {
  model: string;
  prompt: string;
  maxOutputTokens: number;
  mimeType?: "text/plain" | "application/json";
  jsonSchema?: Record<string, unknown>;
}) {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await fetch(`${config.geminiApiBaseUrl}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens,
        responseMimeType: mimeType,
        responseJsonSchema: jsonSchema
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed with ${response.status}: ${errorText}`);
  }

  return response.json();
}

export async function routeDormQuestion(question: string, conversationContext?: string) {
  const normalizedQuestion = normalizeVietnameseChatText(question);
  const sanitizedQuestion = sanitizeTextForLlm(normalizedQuestion);
  const sanitizedRawQuestion = sanitizeTextForLlm(question);
  const baselineRouterExamples = [
    'Input: "khuyen mai co gi" -> allow, simple_policy',
    'Input: "km co gi" -> allow, simple_policy',
    'Input: "gia bn 3 thang" -> allow, deep_policy',
    'Input: "q10 con cho k" -> allow, deep_policy',
    'Input: "d2 co may say k" -> allow, simple_policy',
    'Input: "m la ai" -> allow, simple_policy',
    'Input: "cho xin sdt de xem phong" -> allow, simple_policy',
    'Input: "toi muon dat lich xem nha" -> allow, simple_policy',
    'Input: "hôm nay btc tăng bao nhiêu" -> deny, off_topic',
    'Input: "code python tính fibonacci" -> deny, off_topic'
  ].join("\n");
  const localRouterExamples = await getRelevantRouterExamples(normalizedQuestion, conversationContext, 8);
  const prompt = [
    "You are a strict routing classifier for a dormitory sales and support assistant.",
    "Allowed topics: dorm stay, room or bed availability, branch information, contract policy, cancellation, prices, discounts, referral discount, Cozoro Coins, laundry, cleaning, dorm rules, move-in process.",
    "Vietnamese discount keywords are allowed topics too: khuyến mãi, khuyen mai, ưu đãi, uu dai, giảm giá, giam gia.",
    "Vietnamese chat slang, teencode, and short acronyms should be interpreted correctly.",
    "Treat shorthand like these as dorm-related when context fits: km, bn, k/ko, dc, q10, q6, ktx, sdt, ib, tv.",
    "Deny anything unrelated to staying at the dorm or using dorm services.",
    "If the question is broad but still about the dorm, allow it.",
    "If message is short/ambiguous but likely dorm-sales intent, prefer allow over deny.",
    "",
    "Baseline classification examples:",
    baselineRouterExamples,
    "",
    formatRouterExamples("Relevant local router training examples:", localRouterExamples),
    "Return JSON only.",
    "",
    conversationContext?.trim()
      ? [
          "Conversation context:",
          "(If the user message is short/ambiguous, use the conversation context to decide.)",
          sanitizeTextForLlm(normalizeVietnameseChatText(conversationContext.trim())),
          ""
        ].join("\n")
      : "",
    `Raw customer question: ${sanitizedRawQuestion}`,
    `Normalized customer question: ${sanitizedQuestion}`
  ].join("\n");

  const payload = await callGemini({
    model: config.routerModel,
    prompt,
    maxOutputTokens: 120,
    mimeType: "application/json",
    jsonSchema: {
      type: "object",
      properties: {
        decision: { type: "string", enum: ["allow", "deny"] },
        route: { type: "string", enum: ["simple_policy", "deep_policy", "off_topic"] },
        reason: { type: "string" }
      },
      required: ["decision", "route", "reason"]
    }
  });

  const text = extractGeminiText(payload);
  return topicDecisionSchema.parse(JSON.parse(text));
}

function buildSourceList(results: SearchResult[]) {
  return results
    .slice(0, 6)
    .map((result, index) => `${index + 1}. ${result.title}`)
    .join("\n");
}

function buildKnowledgeContext(results: SearchResult[], liveContext?: string) {
  const sections = results.map((result, index) =>
    [
      `Source ${index + 1}: ${result.title}`,
      `Location: ${result.source}`,
      result.content
    ].join("\n")
  );

  return [liveContext?.trim(), ...sections].filter(Boolean).join("\n\n");
}

export async function answerWithGemini(params: {
  question: string;
  results: SearchResult[];
  liveContext?: string;
  conversationContext?: string;
  preferredLanguage: PreferredLanguage;
}) {
  const normalizedQuestion = normalizeVietnameseChatText(params.question);
  const normalizedConversation = params.conversationContext?.trim()
    ? normalizeVietnameseChatText(params.conversationContext.trim())
    : "";
  const answerTrainingExamples = await getRelevantAnswerTrainingExamples(normalizedQuestion, 4);

  const prompt = [
    "You are the Cozorohome prospective-client assistant.",
    "Answer only from the provided context.",
    "Do not guess or invent any rule, price, discount, fee, or cancellation policy.",
    "Never reveal any current client identity, phone number, room assignment, or account detail.",
    "If the answer is not supported, say you are not sure and suggest human support.",
    "Keep the answer short, friendly, specific, and sales-supportive.",
    "Prefer 1 to 3 short sentences unless the customer asks for detailed breakdown.",
    "Do not dump raw notes, bullet fragments, or long citations.",
    "Do not include a Sources section unless the customer explicitly asks for the source.",
    "Always refer to yourself as Cozoro.",
    "In Vietnamese, address the customer politely as 'quý khách' or a similar respectful term.",
    "In Vietnamese, the tone should be witty, warm, cheerful, lightly feminine, and natural.",
    "Understand Vietnamese slang, teencode, and short acronyms from customer messages.",
    "When replying in Vietnamese, keep wording clear and concise, with light chat style (for example: 'ạ', 'nha'), but avoid excessive filler.",
    "Do not sound robotic or overly formal.",
    "When the customer asks about price, you may mention the current listed monthly price from context, but you should also say the actual monthly amount is often lower after discounts because Cozoro usually has multiple discounts available.",
    "Do not promise an unconfirmed promotion or net price.",
    `If the customer asks for a final quote or wants to book, suggest contacting the owner/manager hotline ${config.hotline} or asking for a human agent.`,
    params.preferredLanguage === "vi"
      ? "Default language: Vietnamese. Only use English if the customer clearly asked in English."
      : "Reply in English because the customer used or requested English.",
    "",
    formatAnswerTrainingExamples(answerTrainingExamples),
    "",
    normalizedConversation
      ? ["Conversation so far:", sanitizeTextForLlm(normalizedConversation), ""].join("\n")
      : "",
    `Customer question: ${sanitizeTextForLlm(normalizedQuestion)}`,
    "",
    "Context:",
    buildKnowledgeContext(params.results, params.liveContext),
    "",
    "Approved source titles:",
    buildSourceList(params.results)
  ].join("\n");

  const payload = await callGemini({
    model: config.answerModel,
    prompt,
    maxOutputTokens: 360,
    mimeType: "text/plain"
  });

  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("Gemini response did not include text");
  }

  return text;
}
