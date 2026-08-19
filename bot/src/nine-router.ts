/**
 * OpenAI-compatible chat via 9router (same pattern as luckynekoAI).
 */

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
};

const DEFAULT_ROUTER_URL = "https://9router.k-aithelittlelion.com/v1/chat/completions";
const DEFAULT_ROUTER_MODEL = "gpt-5";
const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

function getRouterFetchTimeoutMs(): number {
  const raw = process.env.NINE_ROUTER_FETCH_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.round(parsed), 120_000);
    }
  }
  return DEFAULT_FETCH_TIMEOUT_MS;
}

function get9RouterConfig() {
  const apiKey = process.env.NINE_ROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    url: process.env.NINE_ROUTER_URL?.trim() || DEFAULT_ROUTER_URL,
    model: process.env.NINE_ROUTER_MODEL?.trim() || DEFAULT_ROUTER_MODEL
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
    let error: ChatCompletionResponse["error"] | undefined;

    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as ChatCompletionResponse;
        const choice = parsed.choices?.[0];
        const text = contentToText(choice?.delta?.content) || contentToText(choice?.message?.content);
        if (text) chunks.push(text);
        if (parsed.error) error = parsed.error;
      } catch {
        /* ignore malformed SSE frames */
      }
    }

    return {
      choices: chunks.length ? [{ message: { content: chunks.join("") } }] : undefined,
      error
    };
  }

  return (await response.json().catch(() => null)) as ChatCompletionResponse | null;
}

export function has9RouterConfig(): boolean {
  return Boolean(get9RouterConfig());
}

export async function call9RouterChatCompletion(input: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  model?: string;
}): Promise<string> {
  const config = get9RouterConfig();
  if (!config) {
    throw new Error("Server is missing NINE_ROUTER_API_KEY.");
  }

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model?.trim() || config.model,
        messages: [
          { role: "system", content: input.systemInstruction },
          { role: "user", content: input.userPrompt }
        ],
        temperature: input.temperature ?? 0.1
      }),
      signal: AbortSignal.timeout(getRouterFetchTimeoutMs())
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      const seconds = Math.round(getRouterFetchTimeoutMs() / 1000);
      throw new Error(`9router request timed out after ${seconds}s.`);
    }
    throw error instanceof Error ? error : new Error("9router request failed.");
  }

  const body = await readChatCompletionResponse(response);
  if (!response.ok) {
    throw new Error(body?.error?.message || `9router request failed with HTTP ${response.status}.`);
  }

  const text = contentToText(body?.choices?.[0]?.message?.content);
  if (!text) throw new Error("9router returned an empty response.");
  return text;
}
