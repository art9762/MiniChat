const SANDBOX_URL = process.env.SANDBOX_URL || "http://sandbox:3100";
const MAX_CODE_LENGTH = 50_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface CodeExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export async function execCode(
  language: "python" | "javascript",
  code: string
): Promise<CodeExecResult> {
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`Code too long: ${code.length} chars (max ${MAX_CODE_LENGTH})`);
  }

  console.log(`[codeexec] executing ${language} (${code.length} chars)`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(`${SANDBOX_URL}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Sandbox error ${resp.status}: ${txt}`);
    }

    const result = (await resp.json()) as CodeExecResult;
    console.log(`[codeexec] done exitCode=${result.exitCode} durationMs=${result.durationMs} timedOut=${result.timedOut}`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
