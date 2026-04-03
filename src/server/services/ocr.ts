/**
 * Google Cloud Vision OCR service.
 * Used for scanned PDFs and image-based documents.
 */

const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";

export async function extractTextFromImage(
  imageBuffer: Buffer,
): Promise<string> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_KEY;
  if (!apiKey) {
    console.warn("GOOGLE_CLOUD_VISION_KEY not set — skipping OCR");
    return "";
  }

  try {
    const base64 = imageBuffer.toString("base64");

    const response = await fetch(`${VISION_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "TEXT_DETECTION" }],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`Vision API error: ${response.status}`);
      return "";
    }

    const data = await response.json();
    const annotations = data.responses?.[0]?.textAnnotations;
    return annotations?.[0]?.description ?? "";
  } catch (err) {
    console.error("OCR extraction failed:", err);
    return "";
  }
}
