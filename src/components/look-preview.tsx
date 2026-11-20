// A small picture of what a look makes: a frame in the video's shape, the
// footage through the look's grade (its saturation and contrast, as the
// export applies them), and a sample line in the look's graphic style. Used
// by the templates page and the dashboard so a template shows its result,
// not just a colour.

import { cn } from "@/lib/utils";
import { lookFinish, type MotionLookId } from "@/motion/looks";
import { SERIF } from "@/motion/theme";

export type PreviewRatio = "9:16" | "16:9" | "1:1";

const ASPECT: Record<PreviewRatio, string> = {
  "9:16": "aspect-[9/16] h-full",
  "16:9": "aspect-video w-full",
  "1:1": "aspect-square h-full",
};

/** The look a project style starts with ("gadzhi" is the Motion Explainer look). */
export function lookOfPreset(preset: string): MotionLookId {
  return preset === "gadzhi" ? "glass" : (preset as MotionLookId);
}

export function LookPreview({
  look,
  ratio,
  image,
  line,
  emphasis,
  className,
}: {
  look: MotionLookId;
  ratio: PreviewRatio;
  image: string;
  /** The sample line; `emphasis` (a word in it) gets the look's accent. */
  line: string;
  emphasis?: string;
  className?: string;
}) {
  const g = lookFinish(look).grade;
  const filter = g ? `saturate(${g.saturation}) contrast(${g.contrast})` : undefined;
  const tall = ratio === "9:16";
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_20px_40px_-20px_rgba(0,0,0,0.9)]",
        ASPECT[ratio],
        className,
      )}
      style={{ containerType: "inline-size" }}
    >
      {/* Sized from the frame's width (cqw works inside the container), so the words fit any size. */}
      <div className="absolute inset-0" style={{ fontSize: tall ? "8.2cqw" : "4.2cqw" }}>
        <img
          src={image}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter }}
        />
        <Overlay look={look} line={line} emphasis={emphasis} tall={tall} />
      </div>
    </div>
  );
}

function Words({ line, emphasis, accent }: { line: string; emphasis?: string; accent: string }) {
  if (!emphasis || !line.includes(emphasis)) return <>{line}</>;
  const [a, b] = line.split(emphasis);
  return (
    <>
      {a}
      <span className={accent} style={{ fontFamily: SERIF }}>
        {emphasis}
      </span>
      {b}
    </>
  );
}

function Overlay({
  look,
  line,
  emphasis,
  tall,
}: {
  look: MotionLookId;
  line: string;
  emphasis?: string;
  tall: boolean;
}) {
  // Type size comes from the frame (see LookPreview), so the words fit any size.
  const text = "";
  switch (look) {
    case "minimal":
      // A black scene (MinimalScene): thin lines hanging from the top with
      // white weights, one swung out, and small lowercase serif words.
      return (
        <div className="absolute inset-0 bg-black">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {[42, 46, 50].map((x) => (
              <line key={x} x1={x} y1={0} x2={x} y2={38} stroke="rgba(244,244,242,0.8)" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={54} y1={0} x2={66} y2={34} stroke="rgba(244,244,242,0.8)" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
          </svg>
          {[42, 46, 50].map((x) => (
            <span key={x} className="absolute h-[7%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f4f4f2]" style={{ left: `${x}%`, top: "38%" }} />
          ))}
          <span className="absolute h-[7%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f4f4f2]" style={{ left: "66%", top: "34%" }} />
          <div
            className={cn("absolute inset-x-[8%] top-[62%] text-center lowercase leading-tight text-[#f4f4f2]", text)}
            style={{ fontFamily: SERIF }}
          >
            <Words line={line} emphasis={emphasis} accent="italic" />
          </div>
        </div>
      );
    case "film":
      return (
        <>
          <div className="absolute inset-x-0 top-0 h-[8%] bg-black" />
          <div className="absolute inset-x-0 bottom-0 h-[8%] bg-black" />
          <div
            className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
            style={{ backgroundImage: "repeating-radial-gradient(circle at 30% 40%, #fff 0 1px, transparent 1px 3px)" }}
          />
          <div className="absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.75)]" />
          <div
            className={cn("absolute inset-x-[7%] bottom-[12%] text-center italic leading-tight text-[#f3e6cf]", text)}
            style={{ fontFamily: SERIF }}
          >
            {line}
          </div>
        </>
      );
    case "saas":
      return (
        <>
          <div className="absolute inset-0 bg-white/10" />
          <div className="absolute inset-x-[7%] bottom-[6%] rounded-[0.6em] bg-white p-[0.55em] text-slate-900 shadow-lg">
            <div className="mb-1.5 flex gap-1">
              {["#f87171", "#fbbf24", "#34d399"].map((c) => (
                <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
              ))}
            </div>
            <div className={cn("font-semibold leading-tight", text)}>
              <Words line={line} emphasis={emphasis} accent="text-indigo-600" />
            </div>
            <div className="mt-1.5 flex items-end gap-1">
              {[30, 45, 38, 60, 72].map((h, i) => (
                <span key={i} className="w-full rounded-sm bg-indigo-500/80" style={{ height: h / 6 }} />
              ))}
            </div>
          </div>
        </>
      );
    case "paper":
      return (
        <div className="absolute inset-x-[7%] bottom-[6%] -rotate-2 rounded-[0.4em] bg-[#f5efe3] p-[0.55em] text-[#2a2420] shadow-lg">
          <div className={cn("font-semibold leading-tight", text)}>
            <Words line={line} emphasis={emphasis} accent="italic text-[#b4532a]" />
          </div>
        </div>
      );
    default:
      // Motion Explainer: a frosted glass key line with a serif accent word.
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <div className="absolute inset-x-[7%] bottom-[6%] rounded-[0.8em] border border-white/20 bg-white/10 p-[0.6em] shadow-[0_0_30px_-6px_rgba(139,92,246,0.7)] backdrop-blur-md">
            <div className={cn("font-bold leading-tight text-white", text)}>
              <Words line={line} emphasis={emphasis} accent="font-normal italic text-violet-300" />
            </div>
          </div>
        </>
      );
  }
}
