/**
 * url_fetch tool — fetch and extract text content from a URL
 * SSRF-safe, no external deps.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const TIMEOUT_MS = 10_000;
const MAX_CONTENT_CHARS = 50_000;

const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
];

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(hostname));
}

function stripHtml(html: string): string {
  // Remove <script> and <style> blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode basic HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return stripHtml(m[1]).trim();
}

export async function fetchUrl(url: string): Promise<{ url: string; title: string; content: string }> {
  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked host: ${parsed.hostname}`);
  }

  console.log(`[url_fetch] fetching: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Minichat/1.0",
        Accept: "text/html,text/plain,*/*",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = response.url || url;

  // Re-check after redirect
  try {
    const redirectParsed = new URL(finalUrl);
    if (isBlockedHost(redirectParsed.hostname)) {
      throw new Error(`Blocked redirect target: ${redirectParsed.hostname}`);
    }
  } catch (e: any) {
    if (e.message.startsWith("Blocked")) throw e;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${finalUrl}`);
  }

  const contentType = response.headers.get("content-type") || "";

  // Read body with size limit
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BYTES) {
      reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks);
  const rawText = buffer.toString("utf8");

  let title = "";
  let content: string;

  if (contentType.includes("text/html")) {
    title = extractTitle(rawText);
    content = stripHtml(rawText);
  } else {
    content = rawText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS) + "\n\n[content truncated]";
  }

  console.log(`[url_fetch] done: ${finalUrl} — ${content.length} chars, title="${title}"`);

  return { url: finalUrl, title, content };
}
