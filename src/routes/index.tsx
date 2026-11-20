import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Zap,
  Type,
  Film,
  Music2,
  Volume2,
  FileText,
  Play,
  Check,
  Plus,
  Minus,
  Sparkles,
  Upload,
  Layers,
  Captions,
  ImagePlus,
  Palette,
  Redo2,
  Scissors,
  Undo2,
  Wand2,
} from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { planFor } from "@/lib/plans";
import { MAX_UPLOAD_MB } from "@/lib/upload-rules";
import { AI_VOICE_MONTHLY_CHARS } from "@/lib/ai-voice";
import creatorPortrait from "@/assets/creator-portrait.jpg";
import creatorPortraitGraded from "@/assets/creator-portrait-graded.jpg";
import editingDesk from "@/assets/editing-desk.jpg";
import btsStudio from "@/assets/bts-studio.jpg";
import phoneShort from "@/assets/phone-short.jpg";

export const Route = createFileRoute("/")({
  component: Landing,
});

/* ============================================================
   Reveal hook
   ============================================================ */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

/* ============================================================
   Nav
   ============================================================ */
function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[16px] font-semibold tracking-tight text-foreground">
            Stuccord
          </span>
          <span className="rounded-full border border-primary/25 bg-gradient-to-r from-primary/15 to-primary/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary">
            Motion
          </span>
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {[
            ["How it works", "#workflow"],
            ["What it edits", "#product"],
            ["Before / after", "#compare"],
            ["Pricing", "#pricing"],
            ["FAQ", "#faq"],
          ].map(([l, h]) => (
            <a
              key={l}
              href={h}
              className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              {l}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="/auth"
            className="hidden text-[13px] text-muted-foreground transition-colors hover:text-foreground md:block"
          >
            Sign in
          </a>
          <a
            href="/auth"
            className="group inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-[13px] font-medium text-background transition-all hover:bg-foreground/90"
          >
            Upload footage
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="Stuccord Motion logo"
      width={80}
      height={80}
      className={`${className} object-contain rounded-xl bg-white p-0.5 shadow-[0_6px_20px_-6px_rgba(124,58,237,0.6)]`}
    />
  );
}

/* ============================================================
   Hero
   ============================================================ */
function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-hairline">
      <div className="pointer-events-none absolute inset-0 bg-aurora opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
      <HeroCurve />

      {/* One heading for readers and search; the split one below is its picture. */}
      <h1 className="sr-only">Upload the take. Get the edit.</h1>

      <div className="relative mx-auto max-w-7xl px-5 pb-14 pt-10 lg:pb-20 lg:pt-14">
        <div className="flex justify-center lg:justify-start">
          <a
            href="#workflow"
            className="group inline-flex items-center gap-2 rounded-full border border-primary/25 bg-surface/70 px-1 py-1 pr-3 text-xs text-foreground/80 backdrop-blur-md transition-colors hover:bg-surface"
          >
            <span className="rounded-full bg-gradient-to-r from-primary to-primary-glow px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-primary-foreground">
              New
            </span>
            <span className="text-foreground">The edit now makes itself</span>
            <ArrowUpRight className="h-3 w-3 text-primary-glow transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>

        <div className="mt-8 grid items-center gap-10 lg:mt-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-8">
          {/* Left: the first half of the line, then the pitch and buttons. */}
          <div className="text-center lg:text-left">
            <div aria-hidden className={HERO_WORDS + " lg:text-right"}>
              Upload
              <br />
              the take.
            </div>
            <div aria-hidden className={HERO_WORDS + " mt-1 lg:hidden"}>
              Get the <SelectedWord>edit.</SelectedWord>
            </div>
            <p className="mx-auto mt-6 max-w-md text-[16px] leading-relaxed text-muted-foreground lg:ml-auto lg:mr-0 lg:text-right">
              Stuccord turns a raw talking-head video into a finished motion-graphics edit:
              captions, graphics on your words, AI story scenes, zooms and studio sound. Made
              for you, automatically.
            </p>
            <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-end">
              <a
                href="/auth"
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary-glow px-7 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-[0_10px_40px_-10px_color-mix(in_oklab,var(--color-primary)_70%,transparent)] transition-all hover:-translate-y-px"
              >
                <Sparkles className="h-4 w-4" />
                Make my first video, free
              </a>
              <a
                href="#compare"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-hairline bg-surface/60 px-6 py-3.5 text-[15px] font-medium text-foreground backdrop-blur-md transition-colors hover:border-primary/40 hover:bg-surface"
              >
                <Play className="h-3.5 w-3.5 text-primary-glow" fill="currentColor" />
                Before and after
              </a>
            </div>
            <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground lg:justify-end">
              {["No card", "No watermark", "Your footage never trains AI"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-primary-glow" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Centre: the phone, with the editor's pieces floating round it. */}
          <div className="relative mx-auto">
            <PhoneEditor />
            <FloatCard className="-left-40 top-[58%] hidden xl:block">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/20 text-primary-glow">
                  <Captions className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-[10px] text-muted-foreground">Captions · word by word</div>
                  <div className="text-[12px] font-medium text-foreground">
                    You&rsquo;ve been there <span className="text-primary-glow">before</span>
                  </div>
                </div>
              </div>
            </FloatCard>
            <FloatCard className="-right-48 top-[12%] hidden xl:block">
              <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>AI story scenes</span>
                <Wand2 className="h-3 w-3 text-primary-glow" />
              </div>
              <div className="flex gap-1.5">
                {[editingDesk, btsStudio].map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    className="h-[70px] w-[54px] rounded-lg object-cover"
                  />
                ))}
                <div className="grid h-[70px] w-[54px] place-items-center rounded-lg border border-dashed border-white/20 text-[9px] text-muted-foreground">
                  <span className="flex flex-col items-center gap-1">
                    <ImagePlus className="h-3.5 w-3.5" />
                    Next
                  </span>
                </div>
              </div>
            </FloatCard>
            <FloatCard className="-bottom-4 -left-28 hidden xl:block">
              <MakingProgress />
            </FloatCard>
            <FloatCard className="-right-40 top-[40%] hidden xl:block">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Palette className="h-3 w-3" />
                Looks
              </div>
              <div className="flex gap-1.5">
                {["#8b5cf6", "#e5e7eb", "#f59e0b", "#22d3ee", "#f5e6c8"].map((c, i) => (
                  <span
                    key={c}
                    className={
                      "h-5 w-5 rounded-full border " +
                      (i === 0 ? "border-white ring-2 ring-primary/50" : "border-white/20")
                    }
                    style={{ background: c }}
                  />
                ))}
              </div>
            </FloatCard>
          </div>

          {/* Right: the second half of the line, with the key word selected
              like a graphic in the editor. */}
          <div aria-hidden className={HERO_WORDS + " hidden self-end pb-10 lg:block"}>
            Get the
            <br />
            <SelectedWord>edit.</SelectedWord>
          </div>
        </div>

        <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline text-center md:grid-cols-4">
          {[
            ["Automatic", "upload to finished edit"],
            ["16", "motion graphic types"],
            ["Word by word", "captions"],
            ["Studio", "voice cleanup & mastering"],
          ].map(([v, l]) => (
            <div key={l} className="bg-background px-4 py-5">
              <dt className="font-display text-xl font-bold tracking-tight text-foreground">{v}</dt>
              <dd className="mt-1 text-[12px] text-muted-foreground">{l}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const HERO_WORDS =
  "font-display text-[56px] font-bold uppercase leading-[0.9] tracking-[-0.03em] text-foreground sm:text-[76px] lg:text-[84px] xl:text-[104px]";

/** A word with an editor's selection box round it: handles at the corners. */
function SelectedWord({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative mt-2 inline-block rounded-sm border-2 border-primary-glow/80 bg-primary/15 px-3 pb-1 pt-2 text-gradient-violet">
      {children}
      {["-left-1.5 -top-1.5", "-right-1.5 -top-1.5", "-bottom-1.5 -left-1.5", "-bottom-1.5 -right-1.5"].map(
        (pos) => (
          <span
            key={pos}
            className={"absolute h-3 w-3 rounded-full border-2 border-primary bg-white " + pos}
          />
        ),
      )}
    </span>
  );
}

/** A small glassy card floating next to the phone. */
function FloatCard({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div
      className={
        "absolute z-20 rounded-2xl border border-white/10 bg-surface/80 p-3 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.8)] backdrop-blur-xl " +
        className
      }
    >
      {children}
    </div>
  );
}

/** The background's glowing curve, like a timeline's keyframe line. */
function HeroCurve() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-10 h-[620px] w-full opacity-70"
      viewBox="0 0 1440 620"
      preserveAspectRatio="none"
      fill="none"
    >
      <defs>
        <linearGradient id="hero-curve" x1="0" x2="1">
          <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0" />
          <stop offset="0.3" stopColor="var(--color-primary-glow)" />
          <stop offset="0.7" stopColor="var(--color-primary)" />
          <stop offset="1" stopColor="var(--color-primary-glow)" stopOpacity="0" />
        </linearGradient>
        <filter id="hero-glow">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <path
        d="M-20 520 C 200 520, 260 120, 520 140 S 820 560, 1060 470 S 1300 80, 1460 120"
        stroke="url(#hero-curve)"
        strokeWidth="6"
        filter="url(#hero-glow)"
        opacity="0.6"
      />
      <path
        d="M-20 520 C 200 520, 260 120, 520 140 S 820 560, 1060 470 S 1300 80, 1460 120"
        stroke="url(#hero-curve)"
        strokeWidth="1.5"
      />
      <line x1="0" y1="560" x2="1440" y2="560" stroke="var(--color-primary)" strokeOpacity="0.35" strokeDasharray="2 6" />
      {[120, 380, 700, 1010, 1300].map((x) => (
        <rect key={x} x={x - 4} y={556} width="8" height="8" rx="2" fill="var(--color-primary)" opacity="0.8" />
      ))}
    </svg>
  );
}

/** The phone in the middle: the finished video on top, the editor's tracks below. */
function PhoneEditor() {
  const wave = [4, 9, 14, 8, 16, 22, 12, 18, 26, 14, 9, 20, 28, 16, 10, 6, 14, 22, 18, 12, 8, 16, 24, 12, 7, 13, 19, 11];
  return (
    <div className="relative w-[270px] rounded-[44px] border border-white/15 bg-[#0b0b12] p-2.5 shadow-[0_40px_100px_-30px_color-mix(in_oklab,var(--color-primary)_60%,black)] sm:w-[300px]">
      <div className="overflow-hidden rounded-[36px] bg-black">
        {/* Status bar */}
        <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-white">
          <span>9:41</span>
          <span className="h-5 w-20 rounded-full bg-[#0b0b12]" />
          <span className="flex gap-1">
            <span className="h-2 w-3 rounded-sm bg-white/80" />
            <span className="h-2 w-4 rounded-sm bg-white/80" />
          </span>
        </div>

        {/* The finished video */}
        <div className="relative mx-2.5 mt-1 aspect-[4/5] overflow-hidden rounded-2xl">
          <img src={creatorPortrait} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
          <div className="absolute inset-x-3 top-3 flex items-center justify-between text-[10px] font-medium text-white/90">
            <span className="rounded-md bg-black/40 px-1.5 py-0.5 backdrop-blur">3-second hook</span>
            <span className="rounded-md bg-primary px-1.5 py-0.5 text-primary-foreground">1080p</span>
          </div>
          <div className="absolute inset-x-3 bottom-4 text-center font-display text-[19px] font-bold uppercase leading-[1.05] text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.7)]">
            You&rsquo;ve been{" "}
            <span className="inline-block -rotate-1 rounded-md bg-primary px-1.5 text-primary-foreground">
              there
            </span>{" "}
            before
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-between px-4 pt-2.5 text-[10px] text-white/70">
          <span className="flex items-center gap-2">
            <Play className="h-3 w-3 text-white" fill="currentColor" />
            <span className="tabular-nums text-white">00:04</span>
            <span className="tabular-nums">/ 00:08</span>
          </span>
          <span className="flex gap-2.5">
            <Undo2 className="h-3 w-3" />
            <Redo2 className="h-3 w-3" />
          </span>
        </div>

        {/* Tracks */}
        <div className="relative mt-2 space-y-1.5 px-2.5 pb-2">
          <div className="absolute bottom-1 top-0 left-[46%] z-10 w-px bg-primary-glow shadow-[0_0_8px_var(--color-primary-glow)]">
            <span className="absolute -left-1 -top-1 h-2 w-2 rotate-45 bg-primary-glow" />
          </div>
          <Track icon={Layers}>
            <span className="w-[34%] rounded-md bg-primary/70 px-1.5 text-[8px] leading-4 text-white">Key line</span>
            <span className="ml-[6%] w-[44%] rounded-md bg-primary-glow/60 px-1.5 text-[8px] leading-4 text-white">Story · 2 scenes</span>
          </Track>
          <Track icon={Captions}>
            {[16, 22, 14, 20, 12].map((w, i) => (
              <span key={i} className="mr-[3%] rounded bg-white/25" style={{ width: `${w}%`, height: 10 }} />
            ))}
          </Track>
          <Track icon={Volume2}>
            <span className="flex h-4 w-full items-center gap-[2px]">
              {wave.map((h, i) => (
                <span key={i} className="w-full rounded-full bg-primary-glow/70" style={{ height: `${h / 2}px` }} />
              ))}
            </span>
          </Track>
          <Track icon={Film}>
            {[creatorPortrait, phoneShort, creatorPortrait, phoneShort].map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" className="mr-[2%] h-5 w-[23%] rounded object-cover" />
            ))}
          </Track>
        </div>

        {/* Tools */}
        <div className="flex items-center justify-around border-t border-white/10 px-4 py-2.5 text-white/60">
          <Scissors className="h-3.5 w-3.5" />
          <Wand2 className="h-3.5 w-3.5" />
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Captions className="h-3.5 w-3.5" />
          </span>
          <Music2 className="h-3.5 w-3.5" />
          <Palette className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

function Track({ icon: Icon, children }: { icon: typeof Film; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 shrink-0 text-white/50" />
      <div className="flex h-5 flex-1 items-center overflow-hidden rounded-md bg-white/[0.04] px-1">
        {children}
      </div>
    </div>
  );
}

/* ============================================================
   The auto edit's steps, ticking off (a floating card in the hero)
   ============================================================ */
const AUTO_STEPS = [
  "Transcribing what you say",
  "Planning the graphics",
  "Making the story scenes",
  "Mastering the sound",
  "Rendering your video",
];

function MakingProgress() {
  // The steps light up one by one, the video is ready, then it starts over.
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % (AUTO_STEPS.length + 3)), 1100);
    return () => clearInterval(id);
  }, []);
  const done = step >= AUTO_STEPS.length;
  return (
    <div className="w-[210px]">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-foreground">
          {done ? "Your video is ready" : "Making your video"}
        </span>
        <span className="text-primary-glow">
          {Math.min(100, Math.round((step / AUTO_STEPS.length) * 100))}%
        </span>
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">
        {done ? "Download, or change anything" : AUTO_STEPS[step]}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-hairline">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary-glow transition-all duration-700"
          style={{ width: `${Math.min(100, (step / AUTO_STEPS.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/* Vertical 9:16 phone-style preview inside the editor */





/* ============================================================
   Logo strip — creators shipping with Stuccord
   ============================================================ */
/* ============================================================
   Features bento
   ============================================================ */
function Features() {
  return (
    <section id="product" className="relative border-b border-hairline">
      <div className="mx-auto max-w-7xl px-5 py-24 md:py-32">
        <SectionHeader
          eyebrow="01 — What it actually edits"
          title={
            <>
              Every move a top creator-editor makes.{" "}
              <span className="text-muted-foreground">
                On your footage, in one pass.
              </span>
            </>
          }
          subtitle="Cut. Zoom. Caption. Graphics. SFX. Music. One pass."
        />

        <div className="mt-14 grid grid-cols-1 gap-3 md:grid-cols-6">
          {/* Big card — word-by-word captions */}
          <BentoCard className="md:col-span-4 md:row-span-2">
            <div className="flex h-full flex-col justify-between">
              <div>
                <FeatureBadge icon={Type}>Word-by-word captions</FeatureBadge>
                <h3 className="mt-6 max-w-md font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  Frame-accurate, pop-on captions in your brand type.
                  Emphasis words highlighted automatically.
                </h3>
              </div>
              {/* Visualization — animated caption strip */}
              <div className="mt-8 rounded-md border border-hairline bg-black p-6 text-white">
                <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-white/50">
                  <span>Track · Captions</span>
                  <span>00:04.20 → 00:04.62</span>
                </div>
                <div className="font-display text-2xl font-black leading-tight tracking-tight md:text-3xl">
                  You&rsquo;re editing{" "}
                  <span className="inline-block rounded-md bg-primary px-2 py-0.5 text-primary-foreground">
                    YOUR OWN
                  </span>{" "}
                  content
                  <span className="ml-1 inline-block h-6 w-[3px] translate-y-1 animate-blink bg-primary" />
                </div>
                <div className="mt-4 flex items-center gap-1">
                  {["you're", "editing", "your", "own", "content"].map((w, i) => (
                    <span
                      key={w}
                      className={
                        "rounded px-1.5 py-0.5 font-mono text-[9px] " +
                        (i === 3
                          ? "bg-primary text-primary-foreground"
                          : "bg-white/10 text-white/70")
                      }
                    >
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </BentoCard>

          {/* Zoom punches */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={Zap}>Zoom punches on emphasis</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              Punch-ins on the words that matter, eased back out.
            </h3>
            <div className="mt-5 relative aspect-video overflow-hidden rounded-md border border-hairline bg-black">
              <div className="absolute inset-0 bg-[radial-gradient(300px_200px_at_50%_40%,rgba(124,58,237,0.4),transparent_60%),linear-gradient(180deg,#0a0a0a,#1a1a20)]" />
              <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20" />
              <div className="absolute inset-6 rounded border border-primary/70">
                <div className="absolute -left-1 -top-1 h-2 w-2 border-l-2 border-t-2 border-primary" />
                <div className="absolute -right-1 -top-1 h-2 w-2 border-r-2 border-t-2 border-primary" />
                <div className="absolute -bottom-1 -left-1 h-2 w-2 border-b-2 border-l-2 border-primary" />
                <div className="absolute -bottom-1 -right-1 h-2 w-2 border-b-2 border-r-2 border-primary" />
              </div>
              <span className="absolute bottom-2 right-2 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary-foreground">
                zoom 1.4×
              </span>
            </div>
          </BentoCard>

          {/* AI story scenes */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={Film}>AI story scenes</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              Tell a story and each beat gets its own cinematic picture, flown through in 3D.
            </h3>
            <div className="mt-5 grid grid-cols-3 gap-1.5">
              {[
                { img: editingDesk, kw: "editor" },
                { img: btsStudio, kw: "studio" },
                { img: phoneShort, kw: "reels" },
              ].map((c, i) => (
                <div
                  key={i}
                  className="relative aspect-video overflow-hidden rounded-sm border border-hairline"
                >
                  <img src={c.img} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[8px] text-white backdrop-blur">
                    kw · {c.kw}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Made by AI in one cinematic style, or use your own pictures.
            </p>
          </BentoCard>

          {/* SFX */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={Volume2}>SFX on the punches</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              Whooshes, clicks, risers and hits, placed on every graphic.
            </h3>
            <div className="mt-5 flex h-10 items-center gap-[3px]">
              {Array.from({ length: 40 }).map((_, i) => (
                <span
                  key={i}
                  className={
                    "block w-full animate-waveform " +
                    (i % 8 === 3 ? "bg-primary" : "bg-foreground/40")
                  }
                  style={{
                    height: `${+(20 + Math.abs(Math.sin(i * 0.4)) * 80).toFixed(2)}%`,
                    animationDelay: `${(i % 10) * 0.08}s`,
                  }}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="rounded border border-hairline bg-surface px-1.5 py-0.5">
                whoosh
              </span>
              <span className="rounded border border-hairline bg-surface px-1.5 py-0.5">
                impact
              </span>
              <span className="rounded border border-hairline bg-surface px-1.5 py-0.5">
                sub
              </span>
            </div>
          </BentoCard>

          {/* Music ducking */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={Music2}>Background music that ducks</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              A music bed for each chapter, dipped under your voice.
            </h3>
            <div className="mt-5 relative flex h-10 items-end gap-[2px]">
              {Array.from({ length: 32 }).map((_, i) => {
                const ducked = i > 8 && i < 24;
                const h = Math.round(20 + Math.abs(Math.sin(i * 0.6)) * 70);
                return (
                  <span
                    key={i}
                    className="block w-full origin-bottom rounded-sm bg-foreground/60"
                    style={{
                      height: `${ducked ? Math.round(h * 0.3) : h}%`,
                      opacity: ducked ? 0.35 : 1,
                    }}
                  />
                );
              })}
              <span className="pointer-events-none absolute left-[25%] right-[25%] top-0 h-full rounded-sm border border-dashed border-primary/50" />
              <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded-sm bg-primary px-1 font-mono text-[8px] uppercase tracking-widest text-primary-foreground">
                VO
              </span>
            </div>
          </BentoCard>

          {/* Script-aware */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={FileText}>Script-aware edits</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              Paste your script — or don&rsquo;t. Either works.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              With a script, the AI plans from the lines you wrote. Without
              one, it works from your words.
            </p>
            <div className="mt-5 rounded border border-hairline bg-surface px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              <span className="text-foreground">// beat 03</span>
              <br />
              <span className="rounded bg-primary/12 px-1 text-primary">
                [ZOOM]
              </span>{" "}
              &ldquo;your own content&rdquo;
              <br />
              <span className="rounded bg-primary/12 px-1 text-primary">
                [KEY LINE]
              </span>{" "}
              &ldquo;editing your own content&rdquo;
            </div>
          </BentoCard>

          {/* Multi-clip auto-sequencing */}
          <BentoCard className="md:col-span-6">
            <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
              <div>
                <FeatureBadge icon={Layers}>Motion graphics on your words</FeatureBadge>
                <h3 className="mt-5 max-w-lg font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  Say a number, it counts up. Name three things, they stack.
                  Every graphic lands on the word that triggers it.
                </h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  The AI reads your transcript and plans key lines, numbers, lists,
                  steps, loops, comparisons, chapters, story scenes and calls to
                  action, some drawn behind you. Pick a glass or paper look, then
                  move, retype or delete any graphic on its own track.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Word-timed
                  </span>
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Behind the speaker
                  </span>
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Glass or paper look
                  </span>
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Fully editable
                  </span>
                </div>
              </div>

              {/* Visualization — clip bin → ordered sequence */}
              <div className="rounded-md border border-hairline bg-surface p-4">
                <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>Bin · 6 clips uploaded</span>
                  <span>your order</span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {[
                    { img: creatorPortrait, l: "TK_04" },
                    { img: btsStudio, l: "BRL_02" },
                    { img: creatorPortrait, l: "TK_01" },
                    { img: editingDesk, l: "BRL_01" },
                    { img: creatorPortrait, l: "TK_02" },
                    { img: phoneShort, l: "TK_03" },
                  ].map((c) => (
                    <div
                      key={c.l}
                      className="relative aspect-video overflow-hidden rounded-sm border border-hairline"
                    >
                      <img src={c.img} alt="" loading="lazy" className="h-full w-full object-cover" />
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 font-mono text-[7px] text-white">
                        {c.l}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="my-4 flex items-center justify-center gap-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  <span className="h-px flex-1 bg-hairline" />
                  On your timeline
                  <ArrowRight className="h-3 w-3" />
                  <span className="h-px flex-1 bg-hairline" />
                </div>

                <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>Sequence · V1 (A-roll)</span>
                  <span>00:58</span>
                </div>
                <div className="flex h-9 items-stretch gap-[2px] rounded border border-hairline bg-background p-1">
                  {[
                    { c: "bg-foreground/85", w: "w-[22%]", l: "TK_01" },
                    { c: "bg-foreground/85", w: "w-[18%]", l: "TK_04" },
                    { c: "bg-foreground/85", w: "w-[26%]", l: "TK_02" },
                    { c: "bg-foreground/85", w: "w-[34%]", l: "TK_03" },
                  ].map((s) => (
                    <div
                      key={s.l}
                      className={
                        "relative flex items-center justify-center rounded-sm " +
                        s.c +
                        " " +
                        s.w
                      }
                    >
                      <span className="font-mono text-[8px] uppercase tracking-widest text-background">
                        {s.l}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-1.5 mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>V2 (B-roll · on top)</span>
                </div>
                <div className="relative flex h-6 items-stretch gap-[2px] rounded border border-hairline bg-background p-1">
                  <div className="w-[22%]" />
                  <div className="flex w-[18%] items-center justify-center rounded-sm bg-primary/80 font-mono text-[8px] uppercase tracking-widest text-primary-foreground">
                    BRL_01
                  </div>
                  <div className="w-[26%]" />
                  <div className="flex w-[34%] items-center justify-center rounded-sm bg-primary/80 font-mono text-[8px] uppercase tracking-widest text-primary-foreground">
                    BRL_02
                  </div>
                </div>
              </div>
            </div>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

function BentoCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "group relative flex flex-col rounded-xl border border-hairline bg-background p-6 transition-all hover:border-foreground/20 hover:shadow-[0_10px_40px_-20px_rgba(0,0,0,0.15)] md:p-7 " +
        className
      }
    >
      {children}
    </div>
  );
}

function FeatureBadge({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      <span className="grid h-6 w-6 place-items-center rounded-md border border-hairline bg-surface">
        <Icon className="h-3 w-3 text-foreground" strokeWidth={1.8} />
      </span>
      {children}
    </div>
  );
}

/* ============================================================
   Workflow
   ============================================================ */
function Workflow() {
  const { ref, shown } = useReveal<HTMLDivElement>();
  const steps = [
    {
      k: "01",
      title: "Upload your take",
      body: "One talking-head video, or several clips. Paste your script if you have one; it is optional. Pick a look, or let the template pick it.",
      detail: "MP4 · MOV · WebM · 9:16 · 1:1 · 16:9",
    },
    {
      k: "02",
      title: "Stuccord makes the edit",
      body: "It transcribes you, plans motion graphics on your words, makes story scenes with AI, adds captions, zooms, sound effects and music, cleans up your voice and masters the sound. You watch it happen.",
      detail: "Automatic · no editing skills needed",
    },
    {
      k: "03",
      title: "Download, or make it yours",
      body: "Get the finished MP4 straight away. Or change the look, redo the graphics, or open the editor and move, retype or delete anything the AI did.",
      detail: "MP4 · 1080p · no watermark",
    },
  ];

  return (
    <section
      id="workflow"
      className="relative overflow-hidden border-b border-hairline bg-surface"
    >
      <div className="mx-auto max-w-7xl px-5 py-24 md:py-32">
        <SectionHeader
          eyebrow="02 — How it works"
          title={
            <>
              Three steps.{" "}
              <span className="text-muted-foreground">You only do the first.</span>
            </>
          }
        />

        {/* Prompt bar */}
        <div className="mt-12">
          <div className="rounded-xl border border-hairline bg-background p-2 shadow-[0_1px_0_0_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" />
              Your script (optional)
              <span className="ml-auto">What the AI picks out</span>
            </div>
            <div className="p-4">
              <div className="font-mono text-sm leading-relaxed text-foreground">
                Most people{" "}
                <span className="rounded bg-primary/12 px-1.5 py-0.5 text-primary">
                  quit right before it works
                </span>
                . I went from zero to{" "}
                <span className="rounded bg-primary/12 px-1.5 py-0.5 text-primary">
                  10,000 subscribers
                </span>{" "}
                in a year with{" "}
                <span className="rounded bg-primary/12 px-1.5 py-0.5 text-primary">
                  three simple steps
                </span>
                : show up, build, launch.
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-foreground" />
              </div>
            </div>
          </div>
        </div>

        <div
          ref={ref}
          className={
            "mt-8 grid gap-3 md:grid-cols-3 " +
            (shown ? "animate-fade-up" : "opacity-0")
          }
        >
          {steps.map((s, i) => (
            <div
              key={s.k}
              className="group relative flex flex-col rounded-xl border border-hairline bg-background p-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  {s.k}
                </span>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground md:block" />
                )}
              </div>
              <h3 className="mt-6 font-display text-lg font-semibold tracking-tight text-foreground">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
              <div className="mt-6 rounded border border-hairline bg-surface px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
                {s.detail}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Studio sound
   ============================================================ */
const SOUND_POINTS = [
  {
    title: "Your voice, cleaned up",
    body: "Low rumble cut, room noise reduced, a touch of clarity and air, sibilance tamed, loud and soft words evened out.",
  },
  {
    title: "Everything set around you",
    body: "Your voice is measured and set first. Music sits well under it and dips while you talk; whooshes and pops land under your words, never over them.",
  },
  {
    title: "Ready for every app",
    body: "Every export is mastered to the loudness TikTok, Reels and YouTube play at, so it never sounds quiet next to everyone else.",
  },
];

function StudioSound() {
  const bars = [6, 10, 16, 24, 30, 22, 14, 26, 34, 28, 18, 12, 20, 30, 36, 26, 16, 10, 22, 28, 18, 12, 8, 14];
  return (
    <section id="sound" className="relative overflow-hidden border-b border-hairline">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-24 md:grid-cols-2 md:py-32">
        <div>
          <SectionEyebrow>Studio sound</SectionEyebrow>
          <h2 className="mt-4 text-balance font-display text-4xl font-bold leading-[1.02] tracking-tight text-foreground md:text-5xl">
            Sounds like it came from a studio.{" "}
            <span className="text-muted-foreground">Because it went through one.</span>
          </h2>
          <ul className="mt-8 space-y-5">
            {SOUND_POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary-glow">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-[15px] font-semibold text-foreground">{p.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-2xl">
          {[
            { name: "Voice", hint: "cleaned · levelled", scale: 1, tone: "from-primary to-primary-glow" },
            { name: "Music", hint: "under the voice · ducks", scale: 0.35, tone: "from-primary/40 to-primary/20" },
            { name: "Sound effects", hint: "on the graphics", scale: 0.5, tone: "from-primary-glow/70 to-primary/30" },
          ].map((t) => (
            <div key={t.name} className="border-b border-hairline py-4 last:border-0">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-foreground">{t.name}</span>
                <span className="text-muted-foreground">{t.hint}</span>
              </div>
              <div className="mt-3 flex h-10 items-center gap-[3px]">
                {bars.map((h, i) => (
                  <span
                    key={i}
                    className={"w-full rounded-full bg-gradient-to-t " + t.tone}
                    style={{ height: `${Math.max(3, h * t.scale)}px` }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between rounded-lg bg-background px-3 py-2.5 text-[12px]">
            <span className="text-muted-foreground">Master</span>
            <span className="font-medium text-foreground">Mastered for TikTok, Reels and YouTube</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Before / after — the money shot
   ============================================================ */
function Compare() {
  const [pos, setPos] = useState(52);
  return (
    <section id="compare" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-5 py-24 md:py-32">
        <SectionHeader
          eyebrow="03 — Before / after"
          title={
            <>
              Same take.{" "}
              <span className="text-muted-foreground">Very different post.</span>
            </>
          }
          subtitle="Drag the handle. Left is the frame as shot. Right is the same frame through Stuccord’s colour correction and Motion Explainer grade, with the zoom, graphics, captions and sound it adds."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-[1fr_320px] md:items-center">
          {/* Slider */}
          <div className="relative aspect-video overflow-hidden rounded-xl border border-hairline bg-black">
            {/* RAW side (base): the frame as shot, untouched */}
            <img src={creatorPortrait} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute left-4 top-4 rounded border border-white/20 bg-black/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/80 backdrop-blur">
              RAW · your take
            </div>

            {/* EDITED side (clipped): the same frame through the renderer's real
                colour correction and Motion Explainer grade (render-worker/colour.js
                and LOOK_FINISH.glass), made with those filters, not CSS */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            >
              <img src={creatorPortraitGraded} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />

              {/* Zoom marker */}
              <div className="absolute inset-6 rounded border border-primary/70">
                <div className="absolute -left-1 -top-1 h-2 w-2 border-l-2 border-t-2 border-primary" />
                <div className="absolute -right-1 -top-1 h-2 w-2 border-r-2 border-t-2 border-primary" />
                <div className="absolute -bottom-1 -left-1 h-2 w-2 border-b-2 border-l-2 border-primary" />
                <div className="absolute -bottom-1 -right-1 h-2 w-2 border-b-2 border-r-2 border-primary" />
              </div>

              {/* B-roll thumb — real photo */}
              <div className="absolute left-4 top-[26%] w-20 overflow-hidden rounded-sm border border-white/30 shadow-lg">
                <img src={editingDesk} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              </div>


              {/* Caption */}
              <div className="absolute inset-x-6 bottom-8 text-center">
                <div className="font-display text-2xl font-black leading-[1.05] tracking-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.7)] md:text-3xl">
                  Post{" "}
                  <span className="inline-block -rotate-1 rounded-md bg-primary px-2 py-0.5 text-primary-foreground">
                    MORE
                  </span>{" "}
                  isn&rsquo;t the answer
                </div>
              </div>

              {/* SFX chip */}
              <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-white/25 bg-black/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-white/80 backdrop-blur">
                <Volume2 className="h-2.5 w-2.5 text-primary" />
                whoosh
              </div>

              <div className="absolute right-4 top-4 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary-foreground">
                Stuccord · edited
              </div>
            </div>

            {/* Handle */}
            <div
              className="absolute inset-y-0 w-px bg-primary shadow-[0_0_16px_2px_rgba(124,58,237,0.6)]"
              style={{ left: `${pos}%` }}
            >
              <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-background text-foreground shadow-lg">
                <span className="text-[10px] font-semibold">↔</span>
              </div>
            </div>
            <input
              type="range"
              min={5}
              max={95}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label="Reveal edited version"
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            />
          </div>

          {/* Diff list */}
          <div className="space-y-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              What AI added, right side
            </div>
            {[
              ["Colour", "Corrected, then the Motion Explainer grade"],
              ["Cut", "Pauses trimmed"],
              ["Zoom", "1.4× punch on \u201cMORE\u201d"],
              ["Caption", "Word-by-word · Anton · brand yellow"],
              ["Graphic", "Key line on \u201cPost MORE\u201d"],
              ["SFX", "3 whooshes, 1 impact, 1 sub"],
              ["Music", "A music bed, dipped under your voice"],
            ].map(([tag, v]) => (
              <div
                key={tag}
                className="flex items-start gap-2.5 rounded-lg border border-hairline bg-background p-3"
              >
                <span className="mt-0.5 rounded-sm bg-primary/12 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary">
                  {tag}
                </span>
                <span className="text-[13px] text-foreground">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Pricing
   ============================================================ */
// Free while in beta: the real limits, from src/lib/plans.ts (paid plans come
// later; see the Billing page).
const FREE = planFor("free");
const PLANS = [
  {
    name: "Free beta",
    price: "$0",
    tag: "Everything, while Stuccord is in beta. No card.",
    features: [
      `${FREE.personalExports} exports a month, no watermark`,
      `${FREE.personalPlans} AI motion-graphics plans a month`,
      `${FREE.personalImages} AI pictures a month (story scenes, cartoons)`,
      "Word-by-word captions, sounds and music",
      `AI voiceover: ${AI_VOICE_MONTHLY_CHARS.toLocaleString("en")} characters a month`,
      `9:16, 1:1 and 16:9 · uploads up to ${MAX_UPLOAD_MB} MB`,
    ],
    cta: "Start free",
    featured: true,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="border-b border-hairline bg-surface">
      <div className="mx-auto max-w-7xl px-5 py-24 md:py-32">
        <SectionHeader
          eyebrow="05 — Pricing"
          title={
            <>
              Free while{" "}
              <span className="text-muted-foreground">we&rsquo;re in beta.</span>
            </>
          }
          subtitle="Paid plans with more exports will come later. You'll always see the limits up front."
        />

        <div className="mx-auto mt-14 grid max-w-md gap-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                "relative flex flex-col rounded-xl border p-7 " +
                (p.featured
                  ? "border-primary/60 bg-gradient-to-b from-primary/25 via-card to-card text-foreground shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--color-primary)_60%,transparent)]"
                  : "border-hairline bg-card")
              }
            >
              {p.featured && (
                <span className="absolute right-6 top-6 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-widest text-primary-foreground">
                  Beta
                </span>
              )}
              <div
                className={
                  "font-mono text-[11px] uppercase tracking-widest " +
                  (p.featured ? "text-foreground/60" : "text-muted-foreground")
                }
              >
                {p.name}
              </div>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="font-display text-5xl font-semibold tracking-tight">
                  {p.price}
                </span>
                {p.price !== "$0" && (
                  <span
                    className={
                      "text-sm " + (p.featured ? "text-foreground/60" : "text-muted-foreground")
                    }
                  >
                    / month
                  </span>
                )}
              </div>
              <p
                className={
                  "mt-2 text-sm " + (p.featured ? "text-foreground/75" : "text-muted-foreground")
                }
              >
                {p.tag}
              </p>

              <ul className="mt-8 space-y-3 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      strokeWidth={2.25}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/auth"
                className={
                  "group mt-10 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all hover:-translate-y-px " +
                  (p.featured
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-hairline bg-background text-foreground hover:bg-surface")
                }
              >
                {p.cta}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */
const FAQS = [
  {
    q: "Do I really not need to know how to edit?",
    a: "No. Upload your takes and, if you like, paste your script. Stuccord transcribes you, trims the pauses, writes captions, plans motion graphics on your words, and adds zooms, sounds and music. You can export straight away or change anything first.",
  },
  {
    q: "How long does it take?",
    a: "A short is usually ready a few minutes after it finishes uploading. Longer videos take longer. You can watch each step happen, and leave the page open while it works.",
  },
  {
    q: "Can I change what the AI did?",
    a: "Yes. Every graphic sits on its own track: move it, change its words or type, delete it, or add your own. Captions, sounds and music can be edited or switched off too.",
  },
  {
    q: "What style does it edit in?",
    a: "The Motion Explainer style: premium motion graphics on every key line, number, list and story, with zooms, sound design and music, in a dark glass or a paper-on-a-desk look. More styles are coming.",
  },
  {
    q: "What footage does it accept?",
    a: `MP4, MOV and WebM video, JPG, PNG, WebP and GIF images, and MP3, WAV, M4A, AAC and OGG audio, up to ${MAX_UPLOAD_MB} MB per file. Vertical, horizontal or square.`,
  },
  {
    q: "Do you use my footage to train AI?",
    a: "No. Your clips and scripts are only used to make your videos. Some steps use AI services (speech-to-text, graphics planning, AI pictures and voices); they process your content for that job only. See the Privacy policy for the details.",
  },
  {
    q: "What do I get when I export?",
    a: "An MP4 in 1080p in the shape you chose (9:16, 1:1 or 16:9), with the captions, graphics, sounds and music burned in, ready to post or download. You can also publish to YouTube, TikTok or Instagram from Stuccord.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-5 py-24 md:py-32">
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr]">
          <div>
            <SectionEyebrow>06 — FAQ</SectionEyebrow>
            <h2 className="mt-4 max-w-md text-balance font-display text-4xl font-semibold leading-[1.03] tracking-tight text-foreground md:text-5xl">
              The stuff <br />
              creators actually ask.
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Still on the fence? It&rsquo;s free while we&rsquo;re in beta:
              upload a raw take and see the edit on your own footage.
            </p>
            <a
              href="/auth"
              className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground"
            >
              Try it on my footage
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          </div>

          <div className="border-t border-hairline">
            {FAQS.map((f, i) => (
              <div key={f.q} className="border-b border-hairline">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left"
                >
                  <span className="text-[15px] font-medium text-foreground">{f.q}</span>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-hairline text-muted-foreground">
                    {open === i ? (
                      <Minus className="h-3 w-3" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </span>
                </button>
                {open === i && (
                  <p className="animate-fade-in pb-6 pr-10 text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   CTA
   ============================================================ */
function CTA() {
  return (
    <section id="cta" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-5 py-16 md:py-24">
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-[linear-gradient(135deg,oklch(0.32_0.14_290),oklch(0.17_0.03_280)_70%)] p-10 text-white md:p-16">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-40 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(124,58,237,0.6), transparent 60%)",
            }}
          />
          <div className="relative grid gap-10 md:grid-cols-[1.4fr_1fr] md:items-end">
            <div className="max-w-2xl">
              <div className="font-mono text-[11px] uppercase tracking-widest text-white/50">
                Beta · free while in beta
              </div>
              <h2 className="mt-4 font-display text-4xl font-semibold leading-[1.02] tracking-tight md:text-6xl">
                Your next post is one upload away.
              </h2>
              <p className="mt-5 max-w-lg text-white/70">
                Drop a raw take. Get an edited, captioned short with motion
                graphics back in minutes. No card, no watermark.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="/auth"
                  className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-px"
                >
                  Upload footage
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#compare"
                  className="inline-flex items-center gap-2 rounded-md border border-white/25 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
                >
                  See before and after
                </a>
              </div>
            </div>
            <ul className="space-y-3 border-t border-white/15 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              {[
                "Free while in beta, no card",
                "MP4 exports with no watermark",
                "Your footage is never used to train AI",
                "Edit every AI decision before you export",
              ].map((l) => (
                <li key={l} className="flex items-center gap-2.5 text-sm text-white/80">
                  <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Footer
   ============================================================ */
function Footer() {
  return (
    <footer className="bg-background">
      <div className="mx-auto max-w-7xl px-5 pt-16">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark />
              <span className="text-[15px] font-semibold tracking-tight text-foreground">
                Stuccord
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              An AI motion-graphics editor for the creator economy. Built by
              people who&rsquo;ve edited a lot of shorts at 2am.
            </p>
          </div>
          {[
            {
              title: "Product",
              links: [
                ["How it works", "#workflow"],
                ["Pricing", "#pricing"],
                ["FAQ", "#faq"],
                ["Sign in", "/auth"],
              ],
            },
            {
              title: "Legal",
              links: [
                ["Terms", "/terms"],
                ["Privacy", "/privacy"],
                ["Contact", "mailto:support@stuccord.com"],
              ],
            },
          ].map((c) => (
            <div key={c.title}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {c.title}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="transition-colors hover:text-primary">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 overflow-hidden">
          <div className="select-none text-[18vw] font-display font-semibold leading-none tracking-[-0.05em] text-foreground/[0.06] md:text-[16vw]">
            STUCCORD
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 border-t border-hairline py-6 text-xs text-muted-foreground md:flex-row">
          <span>© {new Date().getFullYear()} Stuccord. Your footage stays yours.</span>
          <span className="font-mono">Beta</span>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   Section helpers
   ============================================================ */
function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      <span className="h-px w-6 bg-foreground" />
      {children}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="max-w-3xl">
      <SectionEyebrow>{eyebrow}</SectionEyebrow>
      <h2 className="mt-4 text-balance font-display text-4xl font-semibold leading-[1.03] tracking-tight text-foreground md:text-5xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   Page
   ============================================================ */
function Landing() {

  // Silence unused-import warnings for reserved icons kept for future sections.
  
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Nav />
      <main>
        <Hero />
        <Workflow />
        <Features />
        <StudioSound />
        <Compare />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
