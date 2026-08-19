import { isGeminiCapacityOrRateLimit } from "./gemini-capacity-reply.js";
import type { GeminiUsageMetadata } from "./ai-usage.js";
import {
  call9RouterChatCompletion,
  has9RouterConfig,
  prefer9Router,
  type OpenAiChatMessage
} from "./nine-router.js";

export type LlmChatPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type LlmChatContent = {
  role: "user" | "model";
  parts: LlmChatPart[];
};

export type LlmChatTool = {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters?: {
      type: string;
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
  }>;
};

export type ToolChatRoundResult = {
  text: string | null;
  functionCall: { name: string; args: Record<string, unknown> } | null;
  usage?: GeminiUsageMetadata;
  provider: string;
  model: string;
  rateLimited: boolean;
  errorMessage?: string;
  invalidJson?: boolean;
  emptyCandidate?: boolean;
  finishReason?: string | null;
  httpStatus?: number;
};

function jsonTypeToOpenAi(type: string | undefined): string {
  const normalized = (type ?? "object").toLowerCase();
  if (normalized === "object" || normalized === "string" || normalized === "number" || normalized === "integer" || normalized === "boolean" || normalized === "array") {
    return normalized;
  }
  return "string";
}

function geminiToolsToOpenAi(tools: LlmChatTool[]) {
  return tools.flatMap((group) =>
    group.functionDeclarations.map((fn) => ({
      type: "function" as const,
      function: {
        name: fn.name,
        description: fn.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(fn.parameters?.properties ?? {}).map(([key, spec]) => [
              key,
              {
                type: jsonTypeToOpenAi(spec.type),
                description: spec.description,
                ...(spec.enum ? { enum: spec.enum } : {})
              }
            ])
          ),
          required: fn.parameters?.required ?? []
        }
      }
    }))
  );
}

function geminiContentsToOpenAiMessages(systemPrompt: string, contents: LlmChatContent[]): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [{ role: "system", content: systemPrompt }];
  let pendingToolId: string | null = null;
  let callIndex = 0;

  for (const content of contents) {
    const functionCall = content.parts.find(
      (part): part is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in part
    );
    const functionResponse = content.parts.find(
      (part): part is { functionResponse: { name: string; response: Record<string, unknown> } } =>
        "functionResponse" in part
    );
    const textPart = content.parts.find((part): part is { text: string } => "text" in part);

    if (functionCall) {
      const id = `call_${callIndex++}`;
      pendingToolId = id;
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            id,
            type: "function",
            function: {
              name: functionCall.functionCall.name,
              arguments: JSON.stringify(functionCall.functionCall.args ?? {})
            }
          }
        ]
      });
      continue;
    }

    if (functionResponse) {
      messages.push({
        role: "tool",
        tool_call_id: pendingToolId ?? `call_${callIndex++}`,
        content: JSON.stringify(functionResponse.functionResponse.response ?? {})
      });
      pendingToolId = null;
      continue;
    }

    messages.push({
      role: content.role === "model" ? "assistant" : "user",
      content: textPart?.text ?? ""
    });
  }

  return messages;
}

function usageFromNineRouter(usage: {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}): GeminiUsageMetadata {
  return {
    promptTokenCount: usage.promptTokens ?? undefined,
    candidatesTokenCount: usage.completionTokens ?? undefined,
    totalTokenCount: usage.totalTokens ?? undefined
  };
}

export function resolveGeminiGenerateUrl(kind: "shared" | "resident"): string | null {
  const key =
    kind === "resident"
      ? process.env.GEMINI_RESIDENT_PORTAL_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim()
      : process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
}

export function hasPortalLlmConfig(kind: "shared" | "resident" = "shared"): boolean {
  return prefer9Router() || Boolean(resolveGeminiGenerateUrl(kind));
}

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: LlmChatPart[] };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number; status?: string };
  usageMetadata?: GeminiUsageMetadata;
};

async function completeGeminiRound(input: {
  systemPrompt: string;
  contents: LlmChatContent[];
  tools: LlmChatTool[];
  temperature: number;
  maxOutputTokens: number;
  geminiUrl: string;
}): Promise<ToolChatRoundResult> {
  const body = {
    system_instruction: { parts: [{ text: input.systemPrompt }] },
    contents: input.contents,
    tools: input.tools,
    tool_config: { function_calling_config: { mode: "AUTO" } },
    generation_config: {
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens
    }
  };

  const res = await fetch(input.geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  let data: GeminiGenerateResponse;
  try {
    data = JSON.parse(raw) as GeminiGenerateResponse;
  } catch {
    return {
      text: null,
      functionCall: null,
      provider: "GOOGLE",
      model: "gemini-2.5-flash",
      rateLimited: false,
      invalidJson: true,
      httpStatus: res.status
    };
  }

  if (isGeminiCapacityOrRateLimit(res, data)) {
    return {
      text: null,
      functionCall: null,
      usage: data.usageMetadata,
      provider: "GOOGLE",
      model: "gemini-2.5-flash",
      rateLimited: true,
      httpStatus: res.status,
      errorMessage: data.error?.message
    };
  }

  if (data.error) {
    return {
      text: null,
      functionCall: null,
      usage: data.usageMetadata,
      provider: "GOOGLE",
      model: "gemini-2.5-flash",
      rateLimited: false,
      errorMessage: data.error.message ?? "Gemini error",
      httpStatus: res.status
    };
  }

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  if (!parts.length) {
    return {
      text: null,
      functionCall: null,
      usage: data.usageMetadata,
      provider: "GOOGLE",
      model: "gemini-2.5-flash",
      rateLimited: false,
      emptyCandidate: true,
      finishReason: candidate?.finishReason ?? null,
      httpStatus: res.status
    };
  }

  const functionCallPart = parts.find(
    (part): part is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in part
  );
  if (functionCallPart) {
    return {
      text: null,
      functionCall: {
        name: functionCallPart.functionCall.name,
        args: functionCallPart.functionCall.args ?? {}
      },
      usage: data.usageMetadata,
      provider: "GOOGLE",
      model: "gemini-2.5-flash",
      rateLimited: false,
      httpStatus: res.status
    };
  }

  const textPart = parts.find((part): part is { text: string } => "text" in part);
  return {
    text: textPart?.text?.trim() || null,
    functionCall: null,
    usage: data.usageMetadata,
    provider: "GOOGLE",
    model: "gemini-2.5-flash",
    rateLimited: false,
    httpStatus: res.status
  };
}

async function completeNineRouterRound(input: {
  systemPrompt: string;
  contents: LlmChatContent[];
  tools: LlmChatTool[];
  temperature: number;
}): Promise<ToolChatRoundResult> {
  const result = await call9RouterChatCompletion({
    messages: geminiContentsToOpenAiMessages(input.systemPrompt, input.contents),
    temperature: input.temperature,
    tools: geminiToolsToOpenAi(input.tools)
  });

  const firstTool = result.toolCalls[0];
  return {
    text: firstTool ? null : result.text.trim() || null,
    functionCall: firstTool ? { name: firstTool.name, args: firstTool.args } : null,
    usage: usageFromNineRouter(result.usage),
    provider: "NINE_ROUTER",
    model: result.model,
    rateLimited: result.httpStatus === 429,
    httpStatus: result.httpStatus
  };
}

export async function completeToolChatRound(input: {
  systemPrompt: string;
  contents: LlmChatContent[];
  tools: LlmChatTool[];
  temperature: number;
  maxOutputTokens: number;
  geminiKind: "shared" | "resident";
}): Promise<ToolChatRoundResult> {
  const geminiUrl = resolveGeminiGenerateUrl(input.geminiKind);

  if (prefer9Router() && has9RouterConfig()) {
    try {
      return await completeNineRouterRound({
        systemPrompt: input.systemPrompt,
        contents: input.contents,
        tools: input.tools,
        temperature: input.temperature
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = /429|rate limit|quota|overloaded|timed out/i.test(message);
      if (!geminiUrl) {
        return {
          text: null,
          functionCall: null,
          provider: "NINE_ROUTER",
          model: process.env.NINE_ROUTER_MODEL?.trim() || "gpt-5",
          rateLimited,
          errorMessage: message
        };
      }
      console.warn("[llm-tool-chat] 9router failed, falling back to Gemini:", message);
    }
  }

  if (!geminiUrl) {
    throw new Error(
      "No LLM is configured. Set NINE_ROUTER_API_KEY (preferred) or GEMINI_API_KEY / GEMINI_RESIDENT_PORTAL_AI_API_KEY."
    );
  }

  return completeGeminiRound({
    systemPrompt: input.systemPrompt,
    contents: input.contents,
    tools: input.tools,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    geminiUrl
  });
}
