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
    case "docu":
      // A drawn scene (Documentary): a light grey stage, a dark road winding
      // into the distance to a small red flag, and the line in dark ink.
      return (
        <div className="absolute inset-0 bg-[#e4e3df]">
          <div className="absolute inset-0 shadow-[inset_0_0_50px_rgba(0,0,0,0.25)]" />
          <svg className="absolute inset-x-0 top-[12%] h-[46%] w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M18 100 C 40 78, 70 74, 58 56 S 44 34, 56 22" fill="none" stroke="#1d1d1f" strokeWidth={7} strokeLinecap="round" />
            <line x1={56} y1={22} x2={56} y2={6} stroke="#1d1d1f" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            <path d="M56 6 L66 10 L56 14 Z" fill="#d7262e" />
          </svg>
          <div className={cn("absolute inset-x-[8%] top-[64%] text-center font-semibold leading-tight text-[#1d1d1f]", text)}>
            <Words line={line} emphasis={emphasis} accent="text-[#d7262e]" />
          </div>
        </div>
      );
    case "cine3d":
      // 3D Cinematic: a dark, red-lit stage, a glowing sphere for the object
      // and big glowing words, the key word largest.
      return (
        <div className="absolute inset-0 bg-[#0a0506]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_35%,rgba(220,38,38,0.55),transparent_60%)]" />
          <div className="absolute left-1/2 top-[30%] h-[26%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f5d27a,#a8741c_55%,#3a2306)] shadow-[0_0_40px_rgba(239,68,68,0.6)]" />
          <div className="absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.85)]" />
          <div
            className={cn("absolute inset-x-[7%] top-[58%] text-center font-semibold leading-tight text-white [text-shadow:0_0_18px_rgba(255,255,255,0.7)]", text)}
          >
            <Words line={line} emphasis={emphasis} accent="block text-[1.6em] font-normal" />
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
    case "studio":
      // Studio 3D: a light studio stage, a browser window floating at an
      // angle with a soft shadow, the line on a white card.
      return (
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#f6f6f4_0%,#eeeeeb_62%,#e2e2de_100%)] [perspective:600px]">
          <div className="absolute left-1/2 top-[18%] w-[66%] -translate-x-1/2 rounded-[0.35em] border border-[#d9d9d4] bg-white p-[0.35em] shadow-[0_1.2em_2em_-0.8em_rgba(20,22,26,0.45)] [transform:translateX(-50%)_rotateY(-16deg)_rotateX(6deg)]">
            <div className="mb-[0.25em] h-[0.3em] w-1/2 rounded bg-[#2b5cff]" />
            <div className="mb-[0.18em] h-[0.2em] w-[90%] rounded bg-[#e3e3de]" />
            <div className="mb-[0.18em] h-[0.2em] w-[72%] rounded bg-[#e3e3de]" />
            <div className="h-[0.9em] w-[40%] rounded bg-[#eef2ff]" />
          </div>
          <div
            className="absolute inset-x-[10%] bottom-[10%] rounded-[0.4em] bg-white px-[0.5em] py-[0.3em] text-center font-bold leading-tight tracking-[-0.03em] text-[#14161a] shadow-lg"
            style={{ fontFamily: "'Space Grotesk', Inter, sans-serif" }}
          >
            {emphasis && line.includes(emphasis) ? (
              <>
                {line.split(emphasis)[0]}
                <span className="text-[#2b5cff]">{emphasis}</span>
                {line.split(emphasis)[1]}
              </>
            ) : (
              line
            )}
          </div>
        </div>
      );
    case "hud":
      // Spec HUD: corner brackets, a target ring with a callout tag, lime
      // mono on dark panels.
      return (
        <div className="absolute inset-0 text-[#b6ff3b]" style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
          {[
            "left-[5%] top-[4%] border-l-2 border-t-2",
            "right-[5%] top-[4%] border-r-2 border-t-2",
            "left-[5%] bottom-[4%] border-b-2 border-l-2",
            "right-[5%] bottom-[4%] border-b-2 border-r-2",
          ].map((c) => (
            <span key={c} className={cn("absolute h-[8%] aspect-square border-[#b6ff3b]", c)} />
          ))}
          <span className="absolute left-[30%] top-[50%] h-[12%] aspect-square rounded-full border-2 border-dashed border-[#b6ff3b]" />
          <div className="absolute inset-x-[8%] bottom-[12%] bg-black/80 px-[0.4em] py-[0.25em] text-center text-[0.8em] font-bold uppercase leading-tight text-white">
            <span className="text-[#b6ff3b]">[ </span>
            {emphasis && line.includes(emphasis) ? (
              <>
                {line.split(emphasis)[0]}
                <span className="text-[#b6ff3b]">{emphasis}</span>
                {line.split(emphasis)[1]}
              </>
            ) : (
              line
            )}
            <span className="text-[#b6ff3b]"> ]</span>
          </div>
        </div>
      );
    case "notebook":
      // Notebook: a torn grid-paper strip over the footage, the line in ink
      // blue, the key word under a yellow marker.
      return (
        <div
          className="absolute inset-x-[4%] bottom-[10%] px-[0.5em] py-[0.45em] text-center font-extrabold leading-tight text-[#1f3a93] shadow-lg"
          style={{
            backgroundColor: "#fafaf6",
            backgroundImage: "linear-gradient(#dde6f0 1px, transparent 1px), linear-gradient(90deg, #dde6f0 1px, transparent 1px)",
            backgroundSize: "0.6em 0.6em",
          }}
        >
          {emphasis && line.includes(emphasis) ? (
            <>
              {line.split(emphasis)[0]}
              <span className="bg-[#ffe45c] px-[0.1em]">{emphasis}</span>
              {line.split(emphasis)[1]}
            </>
          ) : (
            line
          )}
        </div>
      );
    case "talk":
      // Studio Talk: a cream pull-quote card rising from the bottom, an amber
      // quote mark, a small waveform under the line.
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1c1a17]/55 to-transparent" />
          <div className="absolute inset-x-[5%] bottom-[6%] rounded-[0.5em] bg-[#f2e8d5] px-[0.55em] pb-[0.45em] pt-[0.3em] shadow-lg">
            <div className="h-[0.45em] text-[1.6em] leading-[0.7] text-[#e0a84e]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
              &ldquo;
            </div>
            <div className="font-semibold leading-tight text-[#1c1a17]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
              {emphasis && line.includes(emphasis) ? (
                <>
                  {line.split(emphasis)[0]}
                  <span className="text-[#b7791f]">{emphasis}</span>
                  {line.split(emphasis)[1]}
                </>
              ) : (
                line
              )}
            </div>
            <div className="mt-[0.3em] flex h-[0.45em] items-end gap-[0.08em]">
              {[40, 90, 60, 100, 50, 80, 35, 70, 95, 45, 65, 85].map((h, i) => (
                <span key={i} className="w-[0.09em] rounded-full bg-[#e0a84e]" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </>
      );
    case "monument":
      // Monument: a dark stage lit warm from the upper left, the line in
      // large ivory serif italic, the key word in gold.
      return (
        <div className="absolute inset-0 bg-[#0d0b08]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_32%_28%,rgba(201,164,92,0.18),transparent_70%)]" />
          <div
            className="absolute inset-x-[7%] top-1/2 -translate-y-1/2 text-center text-[1.35em] italic leading-[1.08] text-[#ede6da]"
            style={{ fontFamily: SERIF }}
          >
            {emphasis && line.includes(emphasis) ? (
              <>
                {line.split(emphasis)[0]}
                <span className="text-[#c9a45c]">{emphasis}</span>
                {line.split(emphasis)[1]}
              </>
            ) : (
              line
            )}
          </div>
        </div>
      );
    case "noir":
      // Noir: the footage in black and white (the grade), grain, a
      // vignette, thin bars, and the line typed low with a red key word.
      return (
        <>
          <div className="absolute inset-x-0 top-0 z-10 h-[6%] bg-black" />
          <div className="absolute inset-x-0 bottom-0 z-10 h-[6%] bg-black" />
          <div
            className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
            style={{ backgroundImage: "repeating-radial-gradient(circle at 30% 40%, #fff 0 1px, transparent 1px 3px)" }}
          />
          <div className="absolute inset-0 shadow-[inset_0_0_70px_rgba(0,0,0,0.9)]" />
          <div
            className="absolute inset-x-[8%] bottom-[14%] text-center leading-tight text-[#ededed] [text-shadow:0_2px_10px_rgba(0,0,0,0.8)]"
            style={{ fontFamily: "'Special Elite', 'Courier New', monospace" }}
          >
            {emphasis && line.includes(emphasis) ? (
              <>
                {line.split(emphasis)[0]}
                <span className="text-[#d7262e]">{emphasis}</span>
                {line.split(emphasis)[1]}
              </>
            ) : (
              line
            )}
            <span className="opacity-80">_</span>
          </div>
        </>
      );
    case "impact": {
      // Impact: the footage darkened, huge condensed capitals, the key word
      // on an acid-yellow block.
      const words = line.toUpperCase().split(/\s+/);
      const key = emphasis?.toUpperCase();
      return (
        <>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-x-[6%] top-1/2 -translate-y-1/2 text-center text-[1.5em] leading-[1.02] text-white"
            style={{ fontFamily: "'Anton', Impact, sans-serif" }}
          >
            {words.map((w, i) => (
              <span
                key={i}
                className={cn("mx-[0.1em] inline-block", key && key.split(/\s+/).includes(w) && "bg-[#e6ff00] px-[0.12em] text-[#0a0a0a]")}
              >
                {w}
              </span>
            ))}
          </div>
        </>
      );
    }
    case "bulletin": {
      // Bulletin: the headline bar over the footage - a red UPDATE tag and
      // a navy bar with a red base, the key word in a red box.
      const [a, b] = emphasis && line.includes(emphasis) ? line.split(emphasis) : [line, ""];
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-[#040a16]/60 via-transparent to-transparent" />
          <div className="absolute inset-x-[5%] bottom-[12%]">
            <span className="inline-block bg-[#d7262e] px-[0.35em] py-[0.1em] text-[0.42em] font-extrabold tracking-[0.12em] text-white">
              UPDATE
            </span>
            <div className="border-b-[0.12em] border-[#d7262e] bg-[#0b1f3a] px-[0.3em] py-[0.18em] font-extrabold leading-tight tracking-[-0.02em] text-white">
              {a}
              {emphasis && line.includes(emphasis) && (
                <span className="bg-[#d7262e] px-[0.15em]">{emphasis}</span>
              )}
              {b}
            </div>
          </div>
        </>
      );
    }
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
          <div className="absolute inset-x-[7%] bottom-[6%] rounded-[0.8em] border border-white/20 bg-white/10 p-[0.6em] shadow-[0_0_30px_-6px_rgba(255,90,31,0.7)] backdrop-blur-md">
            <div className={cn("font-bold leading-tight text-white", text)}>
              <Words line={line} emphasis={emphasis} accent="font-normal italic text-violet-300" />
            </div>
          </div>
        </>
      );
  }
}
