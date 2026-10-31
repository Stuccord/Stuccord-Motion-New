// Makes story scenes' pictures with Google's Gemini image model (server
// only: uses GEMINI_API_KEY). One cinematic house style for every video,
// tinted toward the video's colour (stage 5); later scenes of a story get
// its first picture as a reference so the story looks like one series.

/** Google's current image model (Nano Banana 2.1; Imagen was shut down in 2026). */
export const IMAGE_MODEL = "gemini-nano-banana-2.1";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
// One picture can take a while; give up after this.
const TIMEOUT_MS = 90_000;

/** A problem the user can act on; its message is shown as is. */
export class ImageError extends Error {}

/** The house style, added to every scene's own description. */
export function houseStyle(accentHex: string | null): string {
  return [
    "Cinematic film still, 35mm photograph, shallow depth of field.",
    "Moody, low-key lighting with deep shadows and soft highlights, subtle film grain, realistic.",
    accentHex ? `A gentle colour cast toward ${accentHex} in the light and shadows.` : "",
    "No text, letters, numbers, captions, logos or watermarks anywhere in the picture.",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ImageRequest = {
  /** What the scene shows. */
  prompt: string;
  /** The video's shape: "9:16", "16:9" or "1:1". */
  aspect: string;
  /** The video's colour (#RRGGBB), for the house style's tint. */
  accentHex: string | null;
  /** The story's first picture, to match (JPEG/PNG/WebP bytes). */
  reference: { data: Uint8Array; mimeType: string } | null;
};

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** The request body for one picture (Gemini Interactions API). */
export function imageRequestBody(req: ImageRequest) {
  const text = [
    req.prompt.trim(),
    houseStyle(req.accentHex),
    req.reference
      ? "Match the reference picture's style, colour grading, lighting and look exactly, as the next shot of the same series; show the new scene described above, not the reference's content."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    model: IMAGE_MODEL,
    input: [
      { type: "text", text },
      ...(req.reference
        ? [{ type: "image", mime_type: req.reference.mimeType, data: toBase64(req.reference.data) }]
        : []),
    ],
    response_format: {
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: ["9:16", "16:9", "1:1"].includes(req.aspect) ? req.aspect : "9:16",
      image_size: "2K",
    },
  };
}

/**
 * The first picture in the answer: an object with base64 `data` and an image
 * type, wherever it sits (the answer's shape has changed between API
 * versions, so this looks through all of it).
 */
export function findImage(answer: unknown): { data: Uint8Array; mimeType: string } | null {
  const seen = new Set<unknown>();
  const visit = (v: unknown): { data: Uint8Array; mimeType: string } | null => {
    if (!v || typeof v !== "object" || seen.has(v)) return null;
    seen.add(v);
    const o = v as Record<string, unknown>;
    const mime = (o.mime_type ?? o.mimeType) as unknown;
    const isImage = (typeof mime === "string" && mime.startsWith("image/")) || o.type === "image";
    if (isImage && typeof o.data === "string" && o.data.length > 100) {
      return {
        data: new Uint8Array(Buffer.from(o.data, "base64")),
        mimeType: typeof mime === "string" ? mime : "image/jpeg",
      };
    }
    for (const child of Array.isArray(v) ? v : Object.values(o)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(answer);
}

/** Makes one picture; throws ImageError with a message the user can act on. */
export async function generateSceneImage(
  req: ImageRequest,
  fetchFn: typeof fetch = fetch,
): Promise<{ data: Uint8Array; mimeType: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new ImageError(
      "AI pictures aren't set up yet (GEMINI_API_KEY is missing on the server).",
    );
  }
  let res: Response;
  try {
    res = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(imageRequestBody(req)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.warn("[story-images] Gemini request failed:", e);
    throw new ImageError("Couldn't reach the image service. Try again in a moment.");
  }
  const answer = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (answer as { error?: { message?: string } } | null)?.error?.message ?? "";
    console.warn(`[story-images] Gemini said ${res.status}:`, detail.slice(0, 300));
    if (res.status === 400 && /safety|blocked|policy/i.test(detail)) {
      throw new ImageError(
        "The image service turned this description down. Try describing the scene differently.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ImageError("The image service didn't accept the server's key (GEMINI_API_KEY).");
    }
    // The image models have no free tier: "limit: 0 … on Free Tier" means the
    // key's Google project has no billing yet.
    if (res.status === 429 && /free tier|limit: 0/i.test(detail)) {
      throw new ImageError(
        "AI pictures aren't switched on for the server's Gemini key yet (its Google project needs billing).",
      );
    }
    if (res.status === 429) {
      throw new ImageError("The image service is busy or out of credit. Try again later.");
    }
    throw new ImageError("The image service had a problem. Try again in a moment.");
  }
  const image = findImage(answer);
  if (!image) {
    throw new ImageError(
      "The image service didn't return a picture for this description. Try describing it differently.",
    );
  }
  return image;
}
