export interface SearchResult {
  url: string;
  title: string;
  content: string;
  score: number;
}

export interface SearchResponse {
  answer: string | null;
  results: SearchResult[];
}

export async function tavilySearch(query: string, maxResults = 5): Promise<SearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("websearch_not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: maxResults,
        include_answer: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tavily error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const results: SearchResult[] = (data.results || []).map((r: any) => ({
      url: r.url || "",
      title: r.title || "",
      content: typeof r.content === "string" ? r.content.slice(0, 2000) : "",
      score: r.score || 0,
    }));

    console.log(`[websearch] query="${query}" results=${results.length}`);
    return { answer: data.answer || null, results };
  } finally {
    clearTimeout(timeout);
  }
}
