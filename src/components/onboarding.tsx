import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Film,
  Wand2,
  Rocket,
  Check,
  ArrowRight,
  ArrowLeft,
  X,
  Smartphone,
  Monitor,
  Square,
  Mic,
  Music2,
  Captions,
  Scissors,
} from "lucide-react";

const STORAGE_PREFIX = "stuccord:onboarding:v1:";
const PROFILE_PREFIX = "stuccord:profile:v1:";

type Profile = {
  name: string;
  niche: string;
  aspect: "9:16" | "16:9" | "1:1";
  style: string;
  goals: string[];
};

const NICHES = [
  "Content creator",
  "Coach / educator",
  "Founder / marketer",
  "Podcaster",
  "Agency / editor",
  "Just exploring",
];

const STYLES = [
  { id: "gadzhi", label: "Cinematic", desc: "Slow, moody, film-grade color" },
  { id: "punchy", label: "Punchy shorts", desc: "Fast cuts, big captions, hooks" },
  { id: "clean", label: "Clean & minimal", desc: "Editorial, soft motion, calm" },
  { id: "bold", label: "Bold & loud", desc: "Kinetic type, SFX, high energy" },
];

const GOALS = [
  { id: "captions", label: "Auto captions", icon: Captions },
  { id: "cuts", label: "Cut silences", icon: Scissors },
  { id: "score", label: "Score & SFX", icon: Music2 },
  { id: "voice", label: "AI voiceover", icon: Mic },
];

export function OnboardingGate() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      setUserId(id);
      if (id) {
        const done = typeof window !== "undefined" && localStorage.getItem(STORAGE_PREFIX + id);
        setOpen(!done);
      }
      setReady(true);
    });
  }, []);

  if (!ready || !userId || !open) return null;

  return (
    <Onboarding
      userId={userId}
      onClose={() => setOpen(false)}
    />
  );
}

function Onboarding({ userId, onClose }: { userId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({
    name: "",
    niche: "",
    aspect: "9:16",
    style: "punchy",
    goals: ["captions", "cuts"],
  });

  const steps = ["Welcome", "About you", "Format", "Style", "Ready"];
  const total = steps.length;

  function finish(go: "project" | "dashboard") {
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, new Date().toISOString());
      localStorage.setItem(PROFILE_PREFIX + userId, JSON.stringify(profile));
    } catch {
      /* no-op */
    }
    onClose();
    if (go === "project") navigate({ to: "/projects/new" });
  }

  function skip() {
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, "skipped");
    } catch {
      /* no-op */
    }
    onClose();
  }

  const canNext =
    step === 0 ||
    (step === 1 && profile.niche.length > 0) ||
    step === 2 ||
    step === 3 ||
    step === 4;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-black/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3 border-b border-black/5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="text-[13px] font-semibold tracking-tight">Get started</div>
            <div className="text-[11px] text-neutral-500 hidden sm:block">
              · Step {step + 1} of {total}
            </div>
          </div>
          <button
            onClick={skip}
            className="text-[12px] text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-1"
          >
            Skip <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Progress */}
        <div className="h-1 bg-neutral-100">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>

        {/* Body */}
        <div className="px-5 sm:px-8 py-6 sm:py-8 min-h-[380px]">
          {step === 0 && (
            <StepWelcome
              name={profile.name}
              onName={(name) => setProfile((p) => ({ ...p, name }))}
            />
          )}
          {step === 1 && (
            <StepNiche
              niche={profile.niche}
              onNiche={(niche) => setProfile((p) => ({ ...p, niche }))}
            />
          )}
          {step === 2 && (
            <StepFormat
              aspect={profile.aspect}
              onAspect={(aspect) => setProfile((p) => ({ ...p, aspect }))}
            />
          )}
          {step === 3 && (
            <StepStyle
              style={profile.style}
              goals={profile.goals}
              onStyle={(style) => setProfile((p) => ({ ...p, style }))}
              onGoals={(goals) => setProfile((p) => ({ ...p, goals }))}
            />
          )}
          {step === 4 && <StepFinish profile={profile} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-black/5 bg-neutral-50/50">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-6 bg-neutral-900" : i < step ? "w-1.5 bg-neutral-400" : "w-1.5 bg-neutral-200",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            )}
            {step < total - 1 ? (
              <Button
                size="sm"
                disabled={!canNext}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => finish("dashboard")}>
                  Explore first
                </Button>
                <Button size="sm" onClick={() => finish("project")}>
                  <Rocket className="w-4 h-4" /> Create first project
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepWelcome({ name, onName }: { name: string; onName: (v: string) => void }) {
  return (
    <div>
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center mb-4 shadow-lg shadow-violet-500/30">
        <Sparkles className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
        Welcome to Stuccord Motion
      </h2>
      <p className="mt-2 text-[14px] text-neutral-600 leading-relaxed max-w-lg">
        We'll turn your raw footage into cinematic, motion-graphics-heavy edits — in minutes.
        Let's set up your studio in 4 quick steps.
      </p>

      <div className="mt-6 max-w-sm">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          What should we call you?
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Your first name (optional)"
          className="mt-2 w-full h-11 px-3.5 text-[14px] bg-white border border-neutral-200 rounded-lg focus:border-neutral-900 focus:outline-none transition-colors"
        />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2 max-w-md">
        {[
          { icon: Wand2, label: "AI edits" },
          { icon: Captions, label: "Auto captions" },
          { icon: Music2, label: "Score + SFX" },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-black/5 bg-neutral-50 px-3 py-2.5">
            <f.icon className="w-4 h-4 text-violet-600 mb-1" />
            <div className="text-[11px] font-medium text-neutral-700">{f.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepNiche({ niche, onNiche }: { niche: string; onNiche: (v: string) => void }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 mb-2">
        Step 2 · About you
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
        What best describes you?
      </h2>
      <p className="mt-2 text-[14px] text-neutral-600">
        We'll tailor templates and recommendations to your workflow.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        {NICHES.map((n) => {
          const active = niche === n;
          return (
            <button
              key={n}
              onClick={() => onNiche(n)}
              className={cn(
                "text-left px-4 py-3.5 rounded-xl border transition-all",
                active
                  ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                  : "border-neutral-200 hover:border-neutral-400 bg-white",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-medium">{n}</span>
                {active && <Check className="w-4 h-4 shrink-0" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepFormat({
  aspect,
  onAspect,
}: {
  aspect: "9:16" | "16:9" | "1:1";
  onAspect: (v: "9:16" | "16:9" | "1:1") => void;
}) {
  const opts = [
    { id: "9:16" as const, label: "Vertical", desc: "TikTok, Reels, Shorts", icon: Smartphone, box: "aspect-[9/16] w-12" },
    { id: "16:9" as const, label: "Widescreen", desc: "YouTube, web", icon: Monitor, box: "aspect-video w-20" },
    { id: "1:1" as const, label: "Square", desc: "Feed posts", icon: Square, box: "aspect-square w-14" },
  ];
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 mb-2">
        Step 3 · Format
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
        Where do you post most?
      </h2>
      <p className="mt-2 text-[14px] text-neutral-600">
        Sets your default aspect ratio. You can change it anytime per project.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {opts.map((o) => {
          const active = aspect === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onAspect(o.id)}
              className={cn(
                "relative flex flex-col items-center gap-3 rounded-xl border p-5 transition-all",
                active
                  ? "border-neutral-900 bg-neutral-50 shadow-sm"
                  : "border-neutral-200 hover:border-neutral-400 bg-white",
              )}
            >
              <div
                className={cn(
                  "rounded-md bg-gradient-to-br grid place-items-center",
                  o.box,
                  active
                    ? "from-violet-500 to-fuchsia-500"
                    : "from-neutral-200 to-neutral-300",
                )}
              >
                <o.icon className={cn("w-4 h-4", active ? "text-white" : "text-neutral-500")} />
              </div>
              <div className="text-center">
                <div className="text-[13px] font-semibold">{o.label}</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{o.desc}</div>
                <div className="text-[10px] font-mono text-neutral-400 mt-1">{o.id}</div>
              </div>
              {active && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-neutral-900 grid place-items-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepStyle({
  style,
  goals,
  onStyle,
  onGoals,
}: {
  style: string;
  goals: string[];
  onStyle: (v: string) => void;
  onGoals: (v: string[]) => void;
}) {
  const toggle = (id: string) =>
    onGoals(goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id]);

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 mb-2">
        Step 4 · Style
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
        Pick a signature look
      </h2>
      <p className="mt-2 text-[14px] text-neutral-600">
        Your default preset. Turn features on for every new render.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {STYLES.map((s) => {
          const active = style === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onStyle(s.id)}
              className={cn(
                "text-left rounded-xl border p-3.5 transition-all",
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 hover:border-neutral-400 bg-white",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold">{s.label}</div>
                {active && <Check className="w-4 h-4" />}
              </div>
              <div className={cn("text-[11.5px] mt-0.5", active ? "text-white/70" : "text-neutral-500")}>
                {s.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
          Enable by default
        </div>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => {
            const active = goals.includes(g.id);
            return (
              <button
                key={g.id}
                onClick={() => toggle(g.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all",
                  active
                    ? "border-violet-500 bg-violet-50 text-violet-700"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
                )}
              >
                <g.icon className="w-3.5 h-3.5" />
                {g.label}
                {active && <Check className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepFinish({ profile }: { profile: Profile }) {
  return (
    <div>
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center mb-4 shadow-lg shadow-emerald-500/30">
        <Check className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {profile.name ? `You're set, ${profile.name}.` : "Your studio is set."}
      </h2>
      <p className="mt-2 text-[14px] text-neutral-600 max-w-lg">
        Everything below is saved as your defaults. You can change them anytime in Settings.
      </p>

      <div className="mt-6 rounded-xl border border-black/5 bg-neutral-50 divide-y divide-black/5">
        <SummaryRow label="Profile" value={profile.niche || "—"} />
        <SummaryRow label="Default format" value={profile.aspect} />
        <SummaryRow label="Signature style" value={STYLES.find((s) => s.id === profile.style)?.label ?? profile.style} />
        <SummaryRow
          label="Enabled features"
          value={
            profile.goals.length
              ? profile.goals
                  .map((g) => GOALS.find((x) => x.id === g)?.label ?? g)
                  .join(" · ")
              : "None"
          }
        />
      </div>

      <div className="mt-5 flex items-center gap-2 text-[12px] text-neutral-500">
        <Film className="w-3.5 h-3.5" />
        Ready to ship? Create your first project or take a look around first.
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-[11.5px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <span className="text-[13px] font-medium text-neutral-900 text-right truncate">{value}</span>
    </div>
  );
}
