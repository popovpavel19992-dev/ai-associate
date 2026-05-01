import { VoyageAIClient } from "voyageai";
import { getEnv } from "@/lib/env";
import { VOYAGE_MODEL } from "./constants";

let client: VoyageAIClient | null = null;
function getClient(): VoyageAIClient {
  if (client) return client;
  const env = getEnv();
  if (!env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY not configured — embeddings disabled");
  }
  client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });
  return client;
}

export type VoyageInputType = "document" | "query";

export async function embedTexts(
  texts: string[],
  inputType: VoyageInputType,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await getClient().embed({
    input: texts,
    model: VOYAGE_MODEL,
    inputType,
  });
  return (res.data ?? []).map((d: { embedding?: number[] }) => d.embedding ?? []);
}
