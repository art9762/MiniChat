/**
 * Auto-memory: after each project chat exchange, summarise and persist memory.
 * This runs AFTER the response is sent — must never throw.
 */
import { db } from "./db.js";
import { calcCost } from "./pricing.js";

const MEMORY_MODEL = "claude-haiku-4-5";
const MAX_MSG_CHARS = 2000;
const MAX_MEMORY_CHARS = 1500;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export async function updateProjectMemory(
  projectId: string,
  userId: string,
  lastUserMessage: string,
  lastAssistantMessage: string
): Promise<void> {
  try {
    const row = db
      .prepare(`SELECT memory FROM projects WHERE id = ?`)
      .get(projectId) as { memory: string | null } | undefined;

    if (!row) return; // project deleted

    const currentMemory = row.memory?.trim() || "(empty)";

    const systemPrompt =
      "You are maintaining a long-term memory note for a collaborative project. " +
      "Return ONLY the updated memory text, no preamble.";

    const userContent =
      `Current memory:\n${currentMemory}\n\n` +
      `New exchange:\n` +
      `User: ${truncate(lastUserMessage, MAX_MSG_CHARS)}\n` +
      `Assistant: ${truncate(lastAssistantMessage, MAX_MSG_CHARS)}\n\n` +
      `Update the memory: keep it concise (max ~${MAX_MEMORY_CHARS} chars), bullet-style, ` +
      `capture facts/decisions/preferences only. If nothing memorable, return the existing memory unchanged.`;

    const url = `${process.env.TRINITY_ANTHROPIC_URL}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.TRINITY_ANTHROPIC_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MEMORY_MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[memory] upstream error ${response.status}:`, text);
      return;
    }

    const json = await response.json() as {
      content: { type: string; text: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };

    const newMemory = json.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!newMemory) {
      console.warn("[memory] empty response from haiku, skipping update");
      return;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE projects SET memory = ?, updated_at = ? WHERE id = ?`
    ).run(newMemory, now, projectId);

    // Bill usage to the user (no hold needed — small call, allow small overrun)
    if (json.usage) {
      const inputTokens = json.usage.input_tokens ?? 0;
      const outputTokens = json.usage.output_tokens ?? 0;
      const cost = calcCost(MEMORY_MODEL, inputTokens, outputTokens);

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE users SET token_balance = MAX(0, token_balance - ?) WHERE id = ?`
        ).run(cost, userId);
        db.prepare(
          `INSERT INTO usage_log (user_id, model, input_tokens, output_tokens, cost, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userId, MEMORY_MODEL, inputTokens, outputTokens, cost, now);
      });

      try {
        tx();
        // Warn if balance went negative
        const bal = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(userId) as any)
          ?.token_balance ?? 0;
        if (bal <= 0) {
          console.warn(`[memory] user ${userId} balance reached 0 after memory update (cost=${cost})`);
        }
      } catch (billingErr) {
        console.error("[memory] billing error:", billingErr);
      }
    }

    console.log(`[memory] updated project ${projectId}`);
  } catch (err: any) {
    console.error("[memory] updateProjectMemory error:", err?.message ?? err);
  }
}
