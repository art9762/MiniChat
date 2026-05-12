export type MessageContent = string | ContentBlock[];

export interface ToolDef {
  name: string;
  description: string;
  parameters: any;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface ToolCallResult {
  toolCalls: ToolCall[];
  text: string;
  usage: UsageInfo;
}

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: MessageContent;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  systemPrompt?: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

export function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude");
}

export async function callWithTools(
  req: ChatRequest,
  tools: ToolDef[]
): Promise<ToolCallResult> {
  if (isAnthropicModel(req.model)) {
    const url = `${process.env.TRINITY_ANTHROPIC_URL}/messages`;
    const messages = req.messages.filter((m) => m.role !== "system");
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.TRINITY_ANTHROPIC_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 4096,
        system: req.systemPrompt || undefined,
        messages,
        temperature: req.temperature ?? 0.7,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic tools error ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of data.content || []) {
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      } else if (block.type === "text") {
        text += block.text;
      }
    }
    const usage: UsageInfo = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
    return { toolCalls, text, usage };
  } else {
    const url = `${process.env.TRINITY_OPENAI_URL}/chat/completions`;
    const messages = req.systemPrompt
      ? [{ role: "system" as const, content: req.systemPrompt }, ...req.messages]
      : req.messages;
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TRINITY_OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        temperature: req.temperature ?? 0.7,
        tools: openaiTools,
        tool_choice: "auto",
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI tools error ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    const msg = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
    }));
    const text = msg?.content || "";
    const usage: UsageInfo = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    return { toolCalls, text, usage };
  }
}

type StreamCallbacks = {
  onContent: (chunk: string) => void;
  onDone: (usage: UsageInfo) => void;
  onError: (status: number, message: string) => void;
};

export async function streamOpenAI(req: ChatRequest, cb: StreamCallbacks) {
  const url = `${process.env.TRINITY_OPENAI_URL}/chat/completions`;
  const messages = req.systemPrompt
    ? [{ role: "system" as const, content: req.systemPrompt }, ...req.messages]
    : req.messages;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TRINITY_OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages,
      temperature: req.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    cb.onError(response.status, text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let usage: UsageInfo = { inputTokens: 0, outputTokens: 0 };
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) cb.onContent(content);
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }
      } catch {}
    }
  }
  cb.onDone(usage);
}

export async function streamAnthropic(req: ChatRequest, cb: StreamCallbacks) {
  const url = `${process.env.TRINITY_ANTHROPIC_URL}/messages`;
  const messages = req.messages.filter((m) => m.role !== "system");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.TRINITY_ANTHROPIC_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: 4096,
      system: req.systemPrompt || undefined,
      messages,
      temperature: req.temperature ?? 0.7,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    cb.onError(response.status, text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let usage: UsageInfo = { inputTokens: 0, outputTokens: 0 };
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "content_block_delta") {
          const content = parsed.delta?.text;
          if (content) cb.onContent(content);
        } else if (parsed.type === "message_start") {
          const u = parsed.message?.usage;
          if (u) {
            usage.inputTokens = u.input_tokens ?? usage.inputTokens;
            usage.outputTokens = u.output_tokens ?? usage.outputTokens;
          }
        } else if (parsed.type === "message_delta") {
          const u = parsed.usage;
          if (u) {
            usage.outputTokens = u.output_tokens ?? usage.outputTokens;
            if (u.input_tokens) usage.inputTokens = u.input_tokens;
          }
        }
      } catch {}
    }
  }
  cb.onDone(usage);
}
