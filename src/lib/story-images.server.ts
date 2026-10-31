// Makes story scenes' pictures with Google's Gemini image model (server
// only: uses GEMINI_API_KEY). One cinematic house style for every video,
// tinted toward the video's colour (stage 5); later scenes of a story get
// its first picture as a reference so the story looks like one series.
// Stage 8: the speaker's cartoon (a 3D animated character made from a photo
// of them, with consent) is sent along for scenes with the speaker in them,
// and cartoon graphics are drawn in its 3D animated look.

/** Google's current image model (Nano Banana 2.1; Imagen was shut down in 2026). */
export const IMAGE_MODEL = "gemini-nano-banana-2.1";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
// One picture can take a while; give up after this.
const TIMEOUT_MS = 90_000;

/** A problem the user can act on; its message is shown as is. */
export class ImageError extends Error {}

export type SceneStyle = "cinematic" | "cartoon";

/** The house style, added to every scene's own description. */
export function houseStyle(accentHex: string | null, style: SceneStyle = "cinematic"): string {
  return [
    ...(style === "cartoon"
      ? [
          "Still from a modern 3D animated feature film: expressive characters, soft rounded shapes, rich materials.",
          "Cinematic lighting with a moody, low-key background and a soft rim light on the character.",
        ]
      : [
          "Cinematic film still, 35mm photograph, shallow depth of field.",
          "Moody, low-key lighting with deep shadows and soft highlights, subtle film grain, realistic.",
        ]),
    accentHex ? `A gentle colour cast toward ${accentHex} in the light and shadows.` : "",
    "No text, letters, numbers, captions, logos or watermarks anywhere in the picture.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A picture's bytes (JPEG/PNG/WebP). */
export type ImageBytes = { data: Uint8Array; mimeType: string };

export type ImageRequest = {
  /** What the scene shows. */
  prompt: string;
  /** The video's shape: "9:16", "16:9" or "1:1". */
  aspect: string;
  /** The video's colour (#RRGGBB), for the house style's tint. */
  accentHex: string | null;
  /** The story's first picture, to match. */
  reference: ImageBytes | null;
  /** Cinematic (stories) or 3D animated (cartoon graphics); cinematic if left out. */
  style?: SceneStyle;
  /** The speaker's cartoon, when they're in the scene. */
  character?: ImageBytes | null;
};

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

const imagePart = (img: ImageBytes) => ({
  type: "image",
  mime_type: img.mimeType,
  data: toBase64(img.data),
});

const responseFormat = (aspect: string) => ({
  type: "image",
  mime_type: "image/jpeg",
  aspect_ratio: ["9:16", "16:9", "1:1"].includes(aspect) ? aspect : "9:16",
  image_size: "2K",
});

/** The request body for one picture (Gemini Interactions API). */
export function imageRequestBody(req: ImageRequest) {
  const style = req.style ?? "cinematic";
  // Attached pictures, in order: the speaker's cartoon, then the series' first shot.
  const character = req.character ?? null;
  const text = [
    req.prompt.trim(),
    houseStyle(req.accentHex, style),
    character
      ? `The first attached picture is the speaker's cartoon character. Show the speaker as exactly this character: the same face, hairstyle, skin tone, facial hair, glasses and clothes${style === "cinematic" ? ", as a 3D animated character in the cinematic scene" : ""}. Change only their pose, expression and setting to fit the scene.`
      : "",
    req.reference
      ? `The ${character ? "second" : "first"} attached picture is the previous shot of this series. Match its style, colour grading, lighting and look exactly, as the next shot of the same series; show the new scene described above, not that picture's content.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    model: IMAGE_MODEL,
    input: [
      { type: "text", text },
      ...(character ? [imagePart(character)] : []),
      ...(req.reference ? [imagePart(req.reference)] : []),
    ],
    response_format: responseFormat(req.aspect),
  };
}

/** What the speaker's cartoon looks like: one character, reused in every scene. */
export const CARTOON_PROMPT = [
  "Turn the person in the attached photo into a character from a modern 3D animated feature film.",
  "Keep them clearly recognisable: the same face shape, hairstyle and hair colour, skin tone, facial hair, glasses and clothes.",
  "Friendly, confident expression, head and upper body facing the camera, centred.",
  "Plain soft dark grey studio background, soft studio lighting.",
  "Only this one character. No text, letters, logos or watermarks.",
].join(" ");

/** The request body for the speaker's cartoon, from a photo of them. */
export function cartoonRequestBody(photo: ImageBytes) {
  return {
    model: IMAGE_MODEL,
    input: [{ type: "text", text: CARTOON_PROMPT }, imagePart(photo)],
    response_format: responseFormat("1:1"),
  };
}

/**
 * The first picture in the answer: an object with base64 `data` and an image
 * type, wherever it sits (the answer's shape has changed between API
 * versions, so this looks through all of it).
 */
export function findImage(answer: unknown): ImageBytes | null {
  const seen = new Set<unknown>();
  const visit = (v: unknown): ImageBytes | null => {
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

/** Makes one scene picture; throws ImageError with a message the user can act on. */
export function generateSceneImage(
  req: ImageRequest,
  fetchFn: typeof fetch = fetch,
): Promise<ImageBytes> {
  return requestImage(imageRequestBody(req), fetchFn);
}

/** Makes the speaker's cartoon from a photo of them; throws ImageError like above. */
export function generateSpeakerCartoon(
  photo: ImageBytes,
  fetchFn: typeof fetch = fetch,
): Promise<ImageBytes> {
  return requestImage(cartoonRequestBody(photo), fetchFn);
}

async function requestImage(body: object, fetchFn: typeof fetch): Promise<ImageBytes> {
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
      body: JSON.stringify(body),
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
    if (res.status === 402) {
      throw new ImageError("AI pictures are paused: the image service is out of credit.");
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
