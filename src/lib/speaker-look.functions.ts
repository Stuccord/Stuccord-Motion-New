// What the speaker looks like, for story pictures: the automatic edit sends
// one frame of the footage and Claude describes only what's visible, so a
// person in the pictures looks like the speaker instead of a random person.
// No photo of them goes to the picture service, only these words; nothing
// is guessed about who they are.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SPEAKER_LOOK_MAX } from "@/lib/motion-plan";
import { projectForEdit } from "@/lib/projects.functions";

const INSTRUCTIONS = `Describe the main person in this video frame for an illustrator who will draw someone who looks like them. One short line, under 25 words, visible appearance only: apparent age range, gender presentation, skin tone, hair (colour, length, style), facial hair, glasses, and what they're wearing. Example: "a man in his late 20s with dark brown skin, short black hair, a full beard, wearing a patterned dark T-shirt". Never give a name, never guess who they are, their nationality, religion or anything not visible. If no person is clearly visible, answer exactly: none`;

/** Describes the speaker in one frame (a JPEG, as base64); null when no one is clearly in it. */
export const describeSpeaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        /** One frame of the footage, JPEG, base64 (about 1.5 MB at most). */
        frame: z.string().min(100).max(2_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await projectForEdit(context.supabase, data.project_id, context.userId);
    const { plannerClient, PLAN_MODEL } = await import("@/lib/motion-plan.server");
    let text = "";
    try {
      const message = await plannerClient().messages.create({
        model: PLAN_MODEL,
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: data.frame },
              },
              { type: "text", text: INSTRUCTIONS },
            ],
          },
        ],
      });
      text = message.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
    } catch (e) {
      console.warn("[speaker-look] Claude couldn't describe the frame:", e);
      return { look: null };
    }
    const look = text.replace(/^["'\s]+|["'.\s]+$/g, "").slice(0, SPEAKER_LOOK_MAX);
    return { look: !look || /^none$/i.test(look) ? null : look };
  });
