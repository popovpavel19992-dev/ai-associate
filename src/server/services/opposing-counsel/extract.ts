import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";

const ResultSchema = z.object({
  name: z.string().min(2),
  firm: z.string().nullable().optional(),
  barNumber: z.string().nullable().optional(),
  barState: z.string().length(2).nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export type SignatureBlockResult = z.infer<typeof ResultSchema>;

const PROMPT = `You are extracting the attorney signature block from a US legal filing OCR text.
Return ONLY valid JSON with keys: name (string), firm (string|null), barNumber (string|null),
barState (2-letter US state code|null), confidence (0..1, your certainty this is the AUTHORING attorney).
If you cannot find a clear signature block, return confidence < 0.7.`;

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export interface ExtractDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

export async function extractSignatureBlock(
  args: { text: string },
  deps: ExtractDeps = {},
): Promise<SignatureBlockResult | null> {
  const truncated = args.text.slice(-4000);
  const anthropic = deps.anthropic ?? getAnthropic();

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: PROMPT,
      messages: [{ role: "user", content: truncated }],
    });

    const textBlock = (response.content as Array<{ type: string; text?: string }>).find(
      (b) => b.type === "text",
    );
    const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
    const raw: unknown = JSON.parse(text);

    const parsed = ResultSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.confidence < 0.7) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
