/**
 * OpenAI-compatible chat via 9router (same pattern as luckynekoAI / MCCQE / cozorohome-www).
 * Requires NINE_ROUTER_API_KEY. URL defaults to the shared router host.
 */

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image_url"; image_url: { url: string } };
type MessageContent = string | Array<TextContent | ImageContent>;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string;
  }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export const DEFAULT_9ROUTER_MODEL = "gpt-5";
export const DEFAULT_9ROUTER_URL = "https://9router.k-aithelittlelion.com/v1/chat/completions";

const DEFAULT_ROUTER_FETCH_TIMEOUT_MS = 45_000;

function getRouterFetchTimeoutMs(): number {
  const raw = process.env.NINE_ROUTER_FETCH_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.round(parsed), 120_000);
    }
  }
  return DEFAULT_ROUTER_FETCH_TIMEOUT_MS;
}

function wrapRouterFetchError(error: unknown): Error {
  if (error instanceof Error && error.name === "TimeoutError") {
    const seconds = Math.round(getRouterFetchTimeoutMs() / 1000);
    return new Error(`9router request timed out after ${seconds}s.`);
  }
  return error instanceof Error ? error : new Error("9router request failed.");
}

export function normalize9RouterModel(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function get9RouterConfig() {
  const apiKey = process.env.NINE_ROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    url: process.env.NINE_ROUTER_URL?.trim() || DEFAULT_9ROUTER_URL,
    model: normalize9RouterModel(process.env.NINE_ROUTER_MODEL, DEFAULT_9ROUTER_MODEL)
  };
}

function contentToText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

async function readChatCompletionResponse(response: Response): Promise<ChatCompletionResponse | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) {
    const raw = await response.text();
    const chunks: string[] = [];
    let usage: ChatCompletionResponse["usage"] | undefined;
    let error: ChatCompletionResponse["error"] | undefined;
    let toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined;

    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as ChatCompletionResponse;
        const choice = parsed.choices?.[0];
        const text = contentToText(choice?.delta?.content) || contentToText(choice?.message?.content);
        if (text) chunks.push(text);
        if (choice?.message?.tool_calls?.length) toolCalls = choice.message.tool_calls;
        if (parsed.usage) usage = parsed.usage;
        if (parsed.error) error = parsed.error;
      } catch {
        /* ignore malformed SSE frames */
      }
    }

    return {
      choices: chunks.length || toolCalls
        ? [
            {
              message: {
                content: chunks.join(""),
                tool_calls: toolCalls
              }
            }
          ]
        : undefined,
      error,
      usage
    };
  }

  return (await response.json().catch(() => null)) as ChatCompletionResponse | null;
}

export function has9RouterConfig(): boolean {
  return Boolean(get9RouterConfig());
}

export function prefer9Router(): boolean {
  const forced = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (forced === "gemini") return false;
  if (forced === "nine_router" || forced === "9router") return has9RouterConfig();
  return has9RouterConfig();
}

export type NineRouterToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type NineRouterChatResult = {
  text: string;
  toolCalls: NineRouterToolCall[];
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
  model: string;
  httpStatus: number;
};

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: MessageContent;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { _raw: raw };
  }
  return {};
}

export async function call9RouterChatCompletion(input: {
  systemInstruction?: string;
  userPrompt?: string;
  messages?: OpenAiChatMessage[];
  temperature?: number;
  model?: string;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  attachments?: Array<{ buffer: Buffer; mimeType: string }>;
}): Promise<NineRouterChatResult> {
  const config = get9RouterConfig();
  if (!config) {
    throw new Error("Server is missing NINE_ROUTER_API_KEY.");
  }

  let messages: OpenAiChatMessage[] = input.messages ? [...input.messages] : [];
  if (!messages.length) {
    const userContent: MessageContent = input.attachments?.length
      ? [
          { type: "text", text: input.userPrompt ?? "" },
          ...input.attachments.flatMap((attachment): Array<TextContent | ImageContent> => {
            if (attachment.mimeType.startsWith("image/")) {
              return [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${attachment.mimeType};base64,${attachment.buffer.toString("base64")}`
                  }
                }
              ];
            }
            return [
              {
                type: "text",
                text: `\n\n[Attached ${attachment.mimeType} file omitted because this GPT-style request only sends images inline.]`
              }
            ];
          })
        ]
      : input.userPrompt ?? "";

    if (input.systemInstruction) {
      messages.push({ role: "system", content: input.systemInstruction });
    }
    messages.push({ role: "user", content: userContent });
  }

  const model = normalize9RouterModel(input.model, config.model);
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: input.temperature ?? 0.1,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {})
      }),
      signal: AbortSignal.timeout(getRouterFetchTimeoutMs())
    });
  } catch (error) {
    throw wrapRouterFetchError(error);
  }

  const body = await readChatCompletionResponse(response);
  if (!response.ok) {
    throw new Error(body?.error?.message || `9router request failed with HTTP ${response.status}.`);
  }

  const choice = body?.choices?.[0];
  const text = contentToText(choice?.message?.content);
  const toolCalls: NineRouterToolCall[] = (choice?.message?.tool_calls ?? [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id?.trim() || `call_${index}`,
      name: call.function!.name!,
      args: parseToolArgs(call.function?.arguments)
    }));

  if (!text && !toolCalls.length) {
    throw new Error("9router returned an empty response.");
  }

  return {
    text,
    toolCalls,
    model,
    httpStatus: response.status,
    usage: {
      promptTokens: typeof body?.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : null,
      completionTokens: typeof body?.usage?.completion_tokens === "number" ? body.usage.completion_tokens : null,
      totalTokens: typeof body?.usage?.total_tokens === "number" ? body.usage.total_tokens : null
    }
  };
}
