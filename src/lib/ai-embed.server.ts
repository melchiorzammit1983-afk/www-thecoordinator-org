import { isOptionalAiModuleEnabled } from "@/lib/optional-ai.server";

/**
 * Embed text via Lovable AI Gateway (OpenAI text-embedding-3-small, 1536 dims).
 */
export async function embedText(input: string): Promise<number[] | null> {
  if (!isOptionalAiModuleEnabled()) return null;
  const key = process.env.LOVABLE_API_KEY;
  if (!key || !input.trim()) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: input.slice(0, 8000),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}
