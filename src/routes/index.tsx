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
  MousePointer2,
  Layers,
} from "lucide-react";
import logoUrl from "@/assets/logo.png";
import creatorPortrait from "@/assets/creator-portrait.jpg";
import editingDesk from "@/assets/editing-desk.jpg";
import btsStudio from "@/assets/bts-studio.jpg";
import phoneShort from "@/assets/phone-short.jpg";
import creator2 from "@/assets/creator-2.jpg";
import creator3 from "@/assets/creator-3.jpg";
import deskOverhead from "@/assets/desk-overhead.jpg";
import phoneCaptions from "@/assets/phone-captions.jpg";
import studioMics from "@/assets/studio-mics.jpg";
import cameraLens from "@/assets/camera-lens.jpg";

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
      className={`${className} object-contain drop-shadow-[0_6px_16px_rgba(124,58,237,0.4)]`}
    />
  );
}

/* ============================================================
   Hero
   ============================================================ */
function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-hairline">
      <div className="pointer-events-none absolute inset-0 bg-aurora opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-25 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/25 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 md:pb-24 md:pt-24">
        {/* Top badge */}
        <div className="animate-fade-up">
          <a
            href="#"
            className="group inline-flex items-center gap-2 rounded-full border border-primary/25 bg-surface/70 px-1 py-1 pr-3 text-xs text-foreground/80 shadow-[0_1px_0_0_rgb(255_255_255/0.04),0_0_24px_-8px_color-mix(in_oklab,var(--color-primary)_60%,transparent)] backdrop-blur-md transition-colors hover:bg-surface"
          >
            <span className="rounded-full bg-gradient-to-r from-primary to-primary-glow px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-primary-foreground">
              New
            </span>
            <span className="text-foreground">Script-aware edits are live</span>
            <ArrowUpRight className="h-3 w-3 text-primary-glow transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* Headline */}
        <h1 className="mt-8 max-w-5xl text-balance font-display text-[44px] font-semibold leading-[0.98] tracking-[-0.035em] text-foreground sm:text-6xl md:text-[88px]">
          Talking-head footage in.{" "}
          <span className="relative inline-block">
            <span className="relative z-10">Edited like Gadzhi</span>
            <svg
              className="absolute -bottom-1 left-0 h-2.5 w-full text-primary md:-bottom-2 md:h-4"
              viewBox="0 0 300 12"
              preserveAspectRatio="none"
              fill="none"
            >
              <path
                d="M2 8 Q 75 2, 150 6 T 298 4"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </span>{" "}
          <span className="text-gradient-violet">out.</span>
        </h1>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="hairline flex items-center gap-2 rounded-md bg-surface px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
            <Upload className="h-3 w-3" />
            <span>Drop a .mp4</span>
            <span className="text-hairline">·</span>
            <span>first cut in ~90s</span>
          </div>
        </div>


        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="/auth"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-primary to-primary-glow px-6 py-3 text-sm font-medium text-primary-foreground shadow-[0_10px_40px_-10px_color-mix(in_oklab,var(--color-primary)_70%,transparent)] transition-all hover:-translate-y-px hover:shadow-[0_16px_50px_-10px_color-mix(in_oklab,var(--color-primary)_85%,transparent)]"
          >
            <Sparkles className="relative z-10 h-4 w-4" />
            <span className="relative z-10">Edit my first short — free</span>
            <ArrowRight className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="#compare"
            className="group inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-surface hover:border-primary/40"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_16px_-2px_color-mix(in_oklab,var(--color-primary)_80%,transparent)]">
              <Play className="h-2.5 w-2.5 translate-x-px" fill="currentColor" />
            </span>
            Watch raw vs. edited
          </a>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-glow shadow-[0_0_8px_color-mix(in_oklab,var(--color-primary-glow)_80%,transparent)]" />
            No card · No watermark · Own every export
          </div>
        </div>

        {/* Signature product mock */}
        <div className="mt-16">
          <ShortsViewer />
        </div>

        {/* Micro stats strip */}
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline text-center md:grid-cols-4">
          {[
            ["~90s", "average first cut"],
            ["8.6M", "captions animated"],
            ["4K + 9:16", "master + vertical"],
            ["100%", "editable after render"],
          ].map(([v, l]) => (
            <div key={l} className="bg-background px-4 py-4">
              <dt className="font-display text-xl font-semibold tracking-tight text-foreground">
                {v}
              </dt>
              <dd className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {l}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ============================================================
   Shorts viewer — 9:16 creator-style short mock
   ============================================================ */
function ShortsViewer() {
  return (
    <div className="relative">
      {/* Floating cursor accent */}
      <div className="pointer-events-none absolute -left-6 top-[8%] hidden md:block">
        <div className="flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 font-mono text-[10px] font-medium text-primary-foreground shadow-lg">
          <MousePointer2 className="h-3 w-3" fill="currentColor" />
          stuccord AI
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-hairline bg-background shadow-[0_30px_80px_-30px_rgba(0,0,0,0.2),0_1px_0_0_rgba(0,0,0,0.04)]">
        {/* Chrome */}
        <div className="flex items-center justify-between border-b border-hairline bg-surface px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
            <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
            <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span>hormozi_hook_v2.short</span>
            <span className="text-hairline">·</span>
            <span className="text-foreground">saved 2s ago</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary" />
            <span>edit 00:37 / 00:58</span>
          </div>
        </div>

        <div className="grid grid-cols-12">
          {/* Left — transcript / script */}
          <aside className="col-span-12 hidden border-r border-hairline bg-surface/60 p-4 md:col-span-3 md:block">
            <div className="mb-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              <span>Script · read by AI</span>
              <span className="rounded-sm bg-primary/12 px-1 py-0.5 text-primary">
                live
              </span>
            </div>
            <div className="space-y-2.5 font-mono text-[11px] leading-relaxed">
              <p className="text-muted-foreground">
                <span className="text-foreground">Everyone tells you to</span>{" "}
                <span className="rounded bg-foreground px-1 text-background">
                  post more
                </span>
                .
              </p>
              <p className="text-muted-foreground">
                <span className="text-foreground">That&rsquo;s not the problem.</span>
              </p>
              <p className="rounded-sm border border-primary/40 bg-primary/8 p-2 text-foreground">
                The problem is you&rsquo;re editing your{" "}
                <span className="text-primary">own</span> content.
                <span className="ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 animate-blink bg-primary" />
              </p>
              <p className="text-muted-foreground/60">
                And every hour you spend in Premiere is an hour you&rsquo;re not…
              </p>
            </div>

            <div className="mt-5 space-y-2">
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                AI is placing
              </div>
              {[
                ["Zoom punch", "on \u201cpost more\u201d"],
                ["B-roll cutaway", "on \u201cPremiere\u201d"],
                ["SFX · whoosh", "at 00:04.2"],
                ["Music duck", "-8 dB under VO"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-start gap-2 rounded border border-hairline bg-background px-2 py-1.5"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-foreground">
                      {k}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {v}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Center — 9:16 vertical preview */}
          <div className="relative col-span-12 flex items-center justify-center bg-surface p-5 md:col-span-6 md:p-8">
            <VerticalShort />
          </div>

          {/* Right — asset drawer */}
          <aside className="col-span-12 hidden border-l border-hairline bg-surface/60 p-4 md:col-span-3 md:block">
            <div className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              B-roll suggested
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                "linear-gradient(135deg,#1a1a1a,#3a3a3a)",
                "linear-gradient(135deg,#7c3aed,#3a1a5a)",
                "linear-gradient(135deg,#c67b5c,#3a2a2a)",
                "linear-gradient(135deg,#0a0a0a,#2a2a4a)",
              ].map((g, i) => (
                <div
                  key={i}
                  className="relative aspect-video overflow-hidden rounded-sm border border-hairline"
                  style={{ background: g }}
                >
                  <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 font-mono text-[8px] text-white backdrop-blur">
                    0{i + 1}
                  </span>
                  {i === 1 && (
                    <span className="absolute right-1 top-1 rounded-sm bg-primary px-1 font-mono text-[8px] text-primary-foreground">
                      picked
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Music · ducked
            </div>
            <div className="rounded-sm border border-hairline bg-background p-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="text-foreground">Neon Streets</span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  118 bpm
                </span>
              </div>
              <div className="flex h-8 items-center gap-[2px]">
                {Array.from({ length: 32 }).map((_, i) => {
                  const ducked = i > 8 && i < 24;
                  const h = +(20 + Math.abs(Math.sin(i * 0.6)) * 70).toFixed(2);
                  return (
                    <span
                      key={i}
                      className="block w-full origin-bottom animate-waveform bg-foreground/50"
                      style={{
                        height: `${+(ducked ? h * 0.35 : h).toFixed(2)}%`,
                        opacity: ducked ? 0.4 : 1,
                        animationDelay: `${(i % 8) * 0.09}s`,
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
                <span>VO in</span>
                <span>VO out</span>
              </div>
            </div>

            <div className="mt-5 mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Style preset
            </div>
            <div className="space-y-1 text-[11px]">
              {[
                ["High-retention · creator", true],
                ["Cinematic · brand doc", false],
                ["Cutdown · ads", false],
              ].map(([n, active]) => (
                <div
                  key={n as string}
                  className={
                    "flex items-center gap-2 rounded px-1.5 py-1 " +
                    (active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-background")
                  }
                >
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (active ? "bg-primary" : "bg-hairline")
                    }
                  />
                  <span className="truncate">{n as string}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {/* Bottom transport */}
        <div className="flex items-center justify-between gap-4 border-t border-hairline bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-background">
              <Play className="h-2.5 w-2.5 translate-x-px" fill="currentColor" />
            </span>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              00:04.2 / 00:58.0
            </span>
          </div>
          <div className="relative hidden h-1 flex-1 rounded-full bg-hairline sm:block">
            <div className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-foreground" />
            {/* AI edit markers */}
            {[12, 28, 46, 64, 82].map((p) => (
              <span
                key={p}
                className="absolute top-1/2 -translate-y-1/2 h-2 w-[2px] bg-primary"
                style={{ left: `${p}%` }}
              />
            ))}
            <div className="absolute left-[38%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-[0_0_10px_2px_rgba(124,58,237,0.6)]" />
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="rounded border border-hairline bg-background px-1.5 py-0.5">
              9:16
            </span>
            <span className="rounded border border-hairline bg-background px-1.5 py-0.5">
              4K
            </span>
            <span className="text-hairline">·</span>
            <span>Ready to render</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Vertical 9:16 phone-style preview inside the editor */
function VerticalShort() {
  return (
    <div className="relative aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-2xl border border-foreground/20 bg-foreground shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)]">
      {/* Real talking-head footage */}
      <img
        src={creatorPortrait}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
      {/* Violet tint overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(400px_300px_at_50%_20%,rgba(124,58,237,0.25),transparent_60%)] mix-blend-overlay" />
      {/* Film grain */}
      <div
        className="absolute inset-0 opacity-[0.08] mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px)",
        }}
      />


      {/* Top HUD */}
      <div className="absolute inset-x-3 top-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-white/70">
        <span className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 backdrop-blur">
          Rec · 4K
        </span>
        <span className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 tabular-nums backdrop-blur">
          00:04
        </span>
      </div>

      {/* Zoom-punch marker */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[60%] w-[60%] rounded-md border border-primary/70 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.25)]">
          <div className="absolute -left-1 -top-1 h-2 w-2 border-l-2 border-t-2 border-primary" />
          <div className="absolute -right-1 -top-1 h-2 w-2 border-r-2 border-t-2 border-primary" />
          <div className="absolute -bottom-1 -left-1 h-2 w-2 border-b-2 border-l-2 border-primary" />
          <div className="absolute -bottom-1 -right-1 h-2 w-2 border-b-2 border-r-2 border-primary" />
        </div>
      </div>
      <div className="absolute right-3 top-[38%] rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary-foreground shadow-lg">
        Zoom 1.4×
      </div>

      {/* B-roll cutaway thumb */}
      <div className="absolute left-3 top-[28%] w-14 overflow-hidden rounded-sm border border-white/30 shadow-lg">
        <div className="aspect-video bg-[linear-gradient(135deg,#c67b5c,#3a2a2a)]" />
        <div className="bg-black/60 px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest text-white/80">
          B-roll · in 2f
        </div>
      </div>

      {/* Word-by-word caption */}
      <div className="absolute inset-x-4 bottom-24 text-center">
        <div className="mb-1 inline-block rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest text-white/70 backdrop-blur">
          00:04.20
        </div>
        <div className="font-display text-lg font-black leading-[1.05] tracking-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.6)]">
          You&rsquo;re editing your{" "}
          <span className="inline-block -rotate-1 rounded-md bg-primary px-1.5 py-0.5 text-primary-foreground shadow-[0_4px_0_0_rgba(0,0,0,0.35)]">
            OWN
          </span>{" "}
          content
        </div>
      </div>

      {/* SFX chip */}
      <div className="absolute bottom-14 left-3 flex items-center gap-1 rounded-full border border-white/25 bg-black/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest text-white/80 backdrop-blur">
        <Volume2 className="h-2.5 w-2.5 text-primary" />
        whoosh · -3dB
      </div>

      {/* Progress + scan */}
      <div className="absolute inset-x-3 bottom-3">
        <div className="relative h-0.5 rounded-full bg-white/20">
          <div className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-white" />
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 w-px animate-scan bg-primary/70 shadow-[0_0_18px_2px_rgba(124,58,237,0.7)]"
        style={{ left: "50%" }}
      />
    </div>
  );
}

/* ============================================================
   FramesWall — full-bleed motion mosaic (parallax columns)
   ============================================================ */
function FramesWall() {
  const colA = [creatorPortrait, editingDesk, phoneCaptions, studioMics, creator3];
  const colB = [creator2, btsStudio, cameraLens, phoneShort, deskOverhead];
  const colC = [creator3, phoneShort, creatorPortrait, editingDesk, studioMics];
  const colD = [deskOverhead, phoneCaptions, btsStudio, creator2, cameraLens];
  const cols = [
    { imgs: colA, dir: "up", dur: 40 },
    { imgs: colB, dir: "down", dur: 55 },
    { imgs: colC, dir: "up", dur: 48 },
    { imgs: colD, dir: "down", dur: 62 },
  ] as const;

  return (
    <section
      aria-hidden
      className="relative overflow-hidden border-b border-hairline bg-foreground"
    >
      <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-b from-background via-transparent to-background" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-24 bg-gradient-to-r from-background to-transparent md:w-40" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-24 bg-gradient-to-l from-background to-transparent md:w-40" />

      <div className="relative grid h-[70vh] min-h-[520px] grid-cols-2 gap-2 p-2 md:grid-cols-4 md:gap-3 md:p-3">
        {cols.map((c, idx) => (
          <div key={idx} className="relative overflow-hidden rounded-md">
            <div
              className={c.dir === "up" ? "animate-scroll-up" : "animate-scroll-down"}
              style={{ animationDuration: `${c.dur}s` }}
            >
              {[...c.imgs, ...c.imgs].map((src, i) => (
                <div key={i} className="mb-2 md:mb-3">
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="h-[280px] w-full rounded-md object-cover md:h-[360px]"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Overlay type badge */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center">
        <div className="rounded-full border border-white/20 bg-black/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/80 backdrop-blur-md">
          <span className="mr-2 inline-block h-1.5 w-1.5 animate-blink rounded-full bg-primary align-middle" />
          rendering · 8,642 frames · live
        </div>
      </div>
    </section>
  );
}




/* ============================================================
   Logo strip — creators shipping with Stuccord
   ============================================================ */
function LogoStrip() {
  const names = [
    "HighKey Clips",
    "Solo · Founder",
    "Nomad Agency",
    "Podcast Cutdown",
    "Course Creator Co.",
    "Reels Republic",
    "Fitness Vertical",
    "The Newsletter Guy",
    "Kinograph Shorts",
    "Vertical Ventures",
  ];
  return (
    <section className="border-b border-hairline bg-surface">
      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-6 text-center font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Shipping daily with Stuccord
        </div>
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <div className="flex w-max animate-marquee gap-14">
            {[...names, ...names].map((n, i) => (
              <span
                key={i}
                className="whitespace-nowrap font-display text-lg font-semibold tracking-tight text-foreground/60"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

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
          subtitle="Cut. Zoom. Caption. Cutaway. SFX. Music. One pass."
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
              <div className="mt-8 rounded-md border border-hairline bg-foreground p-6 text-background">
                <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-background/50">
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
                          : "bg-background/10 text-background/70")
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
              Hard cuts. 1.2×, 1.4×, snap back on the beat.
            </h3>
            <div className="mt-5 relative aspect-video overflow-hidden rounded-md border border-hairline bg-foreground">
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

          {/* B-roll on keywords */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={Film}>B-roll on keywords</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              Say &ldquo;Premiere&rdquo; — get a cutaway of a timeline. Every time.
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
              4M+ clip library. Or upload your own.
            </p>
          </BentoCard>

          {/* SFX */}
          <BentoCard className="md:col-span-2">
            <FeatureBadge icon={Volume2}>SFX on the punches</FeatureBadge>
            <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
              Whooshes, impacts, sub-drops. Auto-placed on your cuts.
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
              Licensed tracks. Auto-ducked -8 dB under your voice.
            </h3>
            <div className="mt-5 relative flex h-10 items-end gap-[2px]">
              {Array.from({ length: 32 }).map((_, i) => {
                const ducked = i > 8 && i < 24;
                const h = 20 + Math.abs(Math.sin(i * 0.6)) * 70;
                return (
                  <span
                    key={i}
                    className="block w-full origin-bottom rounded-sm bg-foreground/60"
                    style={{
                      height: `${ducked ? h * 0.3 : h}%`,
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
              With a script, Stuccord matches beats exactly. Without, it
              transcribes and follows the vibe.
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
                [B-ROLL]
              </span>{" "}
              &ldquo;Premiere&rdquo;
            </div>
          </BentoCard>

          {/* Multi-clip auto-sequencing */}
          <BentoCard className="md:col-span-6">
            <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
              <div>
                <FeatureBadge icon={Layers}>Multi-clip auto-sequencing</FeatureBadge>
                <h3 className="mt-5 max-w-lg font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  Dump every take, every angle, every B-roll clip.
                  Stuccord figures out what goes where.
                </h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Upload 2 clips or 20. If you paste a script, Stuccord matches each
                  line to the take that delivers it — in the exact order your script
                  reads. No script? It listens to the audio, reads the room, and
                  builds the sequence itself. Then it decides which clips are A-roll
                  (you, on camera) and which drop in as B-roll cutaways on the
                  right words.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Transcript match
                  </span>
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Angle detection
                  </span>
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    A-roll / B-roll routing
                  </span>
                  <span className="rounded border border-hairline bg-surface px-2 py-1">
                    Continuity check
                  </span>
                </div>
              </div>

              {/* Visualization — clip bin → ordered sequence */}
              <div className="rounded-md border border-hairline bg-surface p-4">
                <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>Bin · 6 clips uploaded</span>
                  <span>unordered</span>
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
                  Stuccord orders it
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
                  <span>V2 (B-roll · keyword-triggered)</span>
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
      title: "Drop every clip",
      body: "One take or twenty. A-roll, B-roll, phone footage, screen recordings — throw it all in. Order doesn't matter. Stuccord sorts it against your script (or figures it out from the audio).",
      detail: "6 clips · auto-ordered · A-roll + B-roll routed",
    },
    {
      k: "02",
      title: "Add your script (optional)",
      body: "Paste it, upload a .txt, or skip it entirely. With a script, cuts land on the exact beats you wrote.",
      detail: "hook.txt · 214 words · 58s target",
    },
    {
      k: "03",
      title: "AI edits like a pro",
      body: "Transcribes, cuts, zooms, drops captions, places B-roll, layers SFX, scores it, ducks the music. All the moves.",
      detail: "142 edits placed · 47s render time",
    },
    {
      k: "04",
      title: "Tweak or ship",
      body: "Every AI decision is a clip you can nudge. Or hit render and get 9:16, 1:1, 16:9 masters in one export.",
      detail: "9:16 · 1:1 · 16:9 · SRT · MP4",
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
              Raw take on Monday.{" "}
              <span className="text-muted-foreground">
                Ten posts by Friday.
              </span>
            </>
          }
        />

        {/* Prompt bar */}
        <div className="mt-12">
          <div className="rounded-xl border border-hairline bg-background p-2 shadow-[0_1px_0_0_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" />
              Your brief (or paste script)
              <span className="ml-auto">⌘ ↵ to render</span>
            </div>
            <div className="p-4">
              <div className="font-mono text-sm leading-relaxed text-foreground">
                Cut this into a{" "}
                <span className="rounded bg-primary/12 px-1.5 py-0.5 text-primary">
                  58-second short
                </span>{" "}
                for TikTok. Style like{" "}
                <span className="rounded bg-primary/12 px-1.5 py-0.5 text-primary">
                  Iman Gadzhi
                </span>
                . Hard zooms on every emphasis, word-by-word captions in{" "}
                <span className="rounded bg-primary/12 px-1.5 py-0.5 text-primary">
                  Anton
                </span>
                , B-roll when I say &ldquo;editor&rdquo; or &ldquo;Premiere&rdquo;,
                lofi score at -12 dB.
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-foreground" />
              </div>
            </div>
          </div>
        </div>

        <div
          ref={ref}
          className={
            "mt-8 grid gap-3 md:grid-cols-4 " +
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
          subtitle="Drag the handle. Left is what you filmed. Right is what Stuccord ships."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-[1fr_320px] md:items-center">
          {/* Slider */}
          <div className="relative aspect-video overflow-hidden rounded-xl border border-hairline bg-foreground">
            {/* RAW side (base) — real footage, flat */}
            <img src={creatorPortrait} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover grayscale-[35%] brightness-90" />
            <div className="absolute inset-0 bg-black/25" />
            <div className="absolute left-4 top-4 rounded border border-white/20 bg-black/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/80 backdrop-blur">
              RAW · your take
            </div>

            {/* EDITED side (clipped) — same footage, styled */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            >
              <img src={creatorPortrait} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover contrast-[1.08] saturate-[1.15]" />
              <div className="absolute inset-0 bg-[radial-gradient(500px_400px_at_50%_30%,rgba(124,58,237,0.35),transparent_60%),radial-gradient(400px_300px_at_50%_80%,rgba(255,180,120,0.18),transparent_60%)] mix-blend-overlay" />

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
              ["Cut", "12 hard cuts on emphasis words"],
              ["Zoom", "1.4× punch on \u201cMORE\u201d"],
              ["Caption", "Word-by-word · Anton · brand yellow"],
              ["B-roll", "1 cutaway · keyword \u201cpost\u201d"],
              ["SFX", "3 whooshes, 1 impact, 1 sub"],
              ["Music", "Lofi · -12 dB, ducked under VO"],
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
   Showcase — creator testimonials
   ============================================================ */
function Showcase() {
  const quotes = [
    {
      text: "I was paying an editor $3.2k a month for daily shorts. Stuccord makes cuts I'd fight my editor for. First month I saved eight grand and posted more.",
      name: "Jordan Vance",
      role: "Solo creator · 480k IG",
    },
    {
      text: "Our agency runs 14 creator clients. We do the strategy, Stuccord does the edit. Turnaround went from four days to same-day.",
      name: "Sana Okafor",
      role: "Founder, HighKey Clips",
    },
    {
      text: "I'm not an editor. I could never be. This is the first tool that makes me look like I hired one.",
      name: "Marcus Lin",
      role: "Course creator",
    },
  ];

  return (
    <section id="showcase" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-5 py-24 md:py-32">
        <SectionHeader
          eyebrow="04 — In the wild"
          title={
            <>
              Creators fired their editor.{" "}
              <span className="text-muted-foreground">Kept the output.</span>
            </>
          }
        />

        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {quotes.map((q, i) => (
            <figure
              key={q.name}
              className="relative flex flex-col justify-between rounded-xl border border-hairline bg-background p-7"
            >
              <div className="mb-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Case 0{i + 1}
              </div>
              <blockquote className="font-display text-lg leading-snug tracking-tight text-foreground">
                &ldquo;{q.text}&rdquo;
              </blockquote>
              <figcaption className="mt-8 flex items-center gap-3 border-t border-hairline pt-5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground font-mono text-[11px] font-medium text-background">
                  {q.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </span>
                <div>
                  <div className="text-sm font-medium text-foreground">{q.name}</div>
                  <div className="text-xs text-muted-foreground">{q.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Pricing
   ============================================================ */
const PLANS = [
  {
    name: "Creator",
    price: "$29",
    tag: "You post daily. Solo.",
    features: [
      "20 shorts / month",
      "9:16, 1:1, 16:9 exports",
      "Word-by-word captions",
      "500+ SFX · 10k music tracks",
    ],
    cta: "Start free",
  },
  {
    name: "Studio",
    price: "$99",
    tag: "You run 3–10 creator clients.",
    features: [
      "Unlimited shorts",
      "4K masters",
      "Custom brand kit (font, colors, LUTs)",
      "Client review links",
      "Priority render queue",
    ],
    cta: "Start 14-day trial",
    featured: true,
  },
  {
    name: "Agency",
    price: "Custom",
    tag: "You run 10+ clients or a media desk.",
    features: [
      "Dedicated GPU pool",
      "SSO + team seats",
      "API access",
      "Named onboarding editor",
    ],
    cta: "Talk to us",
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
              Less than a{" "}
              <span className="text-muted-foreground">one-off Fiverr edit.</span>
            </>
          }
          subtitle="Less than one freelance short."
        />

        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                "relative flex flex-col rounded-xl border p-7 " +
                (p.featured
                  ? "border-foreground bg-foreground text-background shadow-[0_30px_80px_-30px_rgba(0,0,0,0.4)]"
                  : "border-hairline bg-background")
              }
            >
              {p.featured && (
                <span className="absolute right-6 top-6 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-widest text-primary-foreground">
                  Most picked
                </span>
              )}
              <div
                className={
                  "font-mono text-[11px] uppercase tracking-widest " +
                  (p.featured ? "text-background/60" : "text-muted-foreground")
                }
              >
                {p.name}
              </div>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="font-display text-5xl font-semibold tracking-tight">
                  {p.price}
                </span>
                {p.price !== "Custom" && (
                  <span
                    className={
                      "text-sm " + (p.featured ? "text-background/60" : "text-muted-foreground")
                    }
                  >
                    / month
                  </span>
                )}
              </div>
              <p
                className={
                  "mt-2 text-sm " + (p.featured ? "text-background/70" : "text-muted-foreground")
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
    a: "Correct. Upload the raw take. If you want, paste your script or bullet points. Stuccord transcribes, cuts, zooms, drops captions, places B-roll, layers SFX, scores it. You get a finished short. No timeline required.",
  },
  {
    q: "Can I tweak individual edits if I don't love one?",
    a: "Yes. Every AI decision — every cut, zoom, caption, cutaway, SFX, music beat — lands as an editable clip. Drag it, delete it, swap it, or hit \"re-edit that beat\" and Stuccord tries again with your note.",
  },
  {
    q: "Does the style really match creators like Gadzhi, Hormozi, Hamza?",
    a: "That's exactly what it's built for. Hard zooms on emphasis, word-by-word captions in bold display type, B-roll on keywords, whoosh SFX on cuts, lofi/hip-hop score ducked under VO. Pick a preset or upload a reference short and it matches the vibe.",
  },
  {
    q: "What footage does it accept?",
    a: "Anything modern — iPhone, mirrorless, DSLR, screen recording, Zoom, Riverside. H.264, H.265, ProRes. Vertical, horizontal, or square. We handle proxies and color on our side.",
  },
  {
    q: "Do you use my footage to train?",
    a: "Never. Your clips, scripts, and edits are yours. No training, no aggregation, no reuse. Files are deleted 30 days after your project closes unless you keep them.",
  },
  {
    q: "Can I get the raw project file to finish in Premiere / CapCut?",
    a: "Yes. Export FCPXML for Premiere and Final Cut, or a native CapCut project. Nothing is locked in Stuccord.",
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
              Still on the fence? Send us your rawest take — we&rsquo;ll edit
              the first one on the house so you can see it on your own footage.
            </p>
            <a
              href="#"
              className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground"
            >
              Get my free first edit
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
        <div className="relative overflow-hidden rounded-2xl border border-hairline bg-foreground p-10 text-background md:p-16">
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
              <div className="font-mono text-[11px] uppercase tracking-widest text-background/50">
                Beta · v1.4 · free while in beta
              </div>
              <h2 className="mt-4 font-display text-4xl font-semibold leading-[1.02] tracking-tight md:text-6xl">
                Your next post is one upload away.
              </h2>
              <p className="mt-5 max-w-lg text-background/70">
                Drop a raw take. Get a scroll-stopping short back before you
                finish your coffee. No card, no watermark, no subscription trap.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="#"
                  className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-px"
                >
                  Upload footage
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#"
                  className="inline-flex items-center gap-2 rounded-md border border-background/25 px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-background/10"
                >
                  Watch a full edit
                </a>
              </div>
            </div>
            <ul className="space-y-3 border-t border-background/15 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              {[
                "First edit is free — no card",
                "Export FCPXML / CapCut anytime",
                "Your footage is never used to train",
                "Cancel by closing the tab",
              ].map((l) => (
                <li key={l} className="flex items-center gap-2.5 text-sm text-background/80">
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
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
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
            { title: "Product", links: ["Editor", "Style presets", "Changelog", "Roadmap"] },
            { title: "For", links: ["Solo creators", "Agencies", "Podcasters", "Course creators"] },
            { title: "Legal", links: ["Terms", "Privacy", "DPA", "Status"] },
          ].map((c) => (
            <div key={c.title}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {c.title}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {c.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="transition-colors hover:text-primary">
                      {l}
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
          <span>© {new Date().getFullYear()} Stuccord, Inc. Your footage stays yours.</span>
          <span className="font-mono">v1.4.2 · build 20260701 · all systems normal</span>
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
/* ============================================================
   Gallery — dual-row marquee of creator stills
   ============================================================ */
const GALLERY_ROW_A = [
  { src: creatorPortrait, label: "TK_01 · hook" },
  { src: deskOverhead, label: "BRL_04 · desk" },
  { src: creator2, label: "TK_07 · VO" },
  { src: phoneShort, label: "OUT_02 · 9:16" },
  { src: btsStudio, label: "BRL_02 · studio" },
  { src: cameraLens, label: "FX_01 · flare" },
];

const GALLERY_ROW_B = [
  { src: creator3, label: "TK_09 · stream" },
  { src: editingDesk, label: "BRL_01 · edit" },
  { src: phoneCaptions, label: "OUT_05 · captions" },
  { src: studioMics, label: "BRL_08 · mics" },
  { src: creatorPortrait, label: "TK_02 · reax" },
  { src: deskOverhead, label: "BRL_04 · desk" },
];

function Gallery() {
  return (
    <section id="gallery" className="relative overflow-hidden border-b border-hairline bg-surface">
      <div className="mx-auto max-w-7xl px-5 pt-20 md:pt-28">
        <SectionHeader
          eyebrow="05 — Frames"
          title={
            <>
              A week of shipped shorts.{" "}
              <span className="text-muted-foreground">Every frame edited by Stuccord.</span>
            </>
          }
        />
      </div>

      <div className="relative mt-12 space-y-4 pb-20 md:pb-28">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-surface to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-surface to-transparent" />

        <MarqueeRow items={[...GALLERY_ROW_A, ...GALLERY_ROW_A]} direction="left" />
        <MarqueeRow items={[...GALLERY_ROW_B, ...GALLERY_ROW_B]} direction="right" />
      </div>
    </section>
  );
}

function MarqueeRow({
  items,
  direction,
}: {
  items: { src: string; label: string }[];
  direction: "left" | "right";
}) {
  return (
    <div className="flex overflow-hidden">
      <div
        className={
          "flex shrink-0 gap-3 pr-3 " +
          (direction === "left" ? "animate-marquee-left" : "animate-marquee-right")
        }
        style={{ animationDuration: "60s" }}
      >
        {items.map((item, i) => (
          <figure
            key={`${item.label}-${i}`}
            className="group relative aspect-[4/3] w-[280px] shrink-0 overflow-hidden rounded-lg border border-hairline bg-background md:w-[360px]"
          >
            <img
              src={item.src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <figcaption className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
              {item.label}
            </figcaption>
            <span className="absolute right-2 top-2 rounded-sm bg-primary/90 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-widest text-primary-foreground">
              Stuccord
            </span>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Landing() {

  // Silence unused-import warnings for reserved icons kept for future sections.
  
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Nav />
      <main>
        <Hero />
        <FramesWall />
        <LogoStrip />
        <Features />
        <Workflow />
        <Compare />
        <Showcase />
        <Gallery />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
