export interface ChatRequest {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  model: string;
  temperature?: number;
  systemPrompt?: string;
}

export function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude");
}

export async function streamOpenAI(
  req: ChatRequest,
  res: import("express").Response
) {
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
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    res.status(response.status).json({ error: text });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Parse SSE lines and re-emit in unified format
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") {
          res.write("data: [DONE]\n\n");
          break;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {}
      }
    }
  } finally {
    res.end();
  }
}

export async function streamAnthropic(
  req: ChatRequest,
  res: import("express").Response
) {
  const url = `${process.env.TRINITY_ANTHROPIC_URL}/messages`;

  // Anthropic API: system is a top-level param, messages don't include system role
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
    res.status(response.status).json({ error: text });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta") {
            const content = parsed.delta?.text;
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } else if (parsed.type === "message_stop") {
            res.write("data: [DONE]\n\n");
          }
        } catch {}
      }
    }
  } finally {
    res.end();
  }
}
