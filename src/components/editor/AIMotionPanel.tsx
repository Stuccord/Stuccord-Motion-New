import React, { useState } from "react";
import {
  Sparkles,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  FileText,
  Wand2,
  Volume2,
  Mic,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RenderJobRow } from "./types";

/* ---------- types ---------- */
export interface EditPlan {
  brief?: string | null;
  style?: string | null;
  hooks?: string[] | null;
  steps?: { title: string; detail: string }[] | null;
}

export interface AIMotionPanelProps {
  projectId: string;
  status: string;
  latestJob: RenderJobRow | any;
  clipCount: number;
  preset: string;
  script: string | null;
  musicEnabled: boolean;
  musicVolume: number;
  captionsEnabled: boolean;
  captionsText: string | null;
  onScriptChange: (text: string) => void;
  onScriptBlur?: () => void;
  onMusicEnabledChange: (enabled: boolean) => void;
  onMusicVolumeChange: (vol: number) => void;
  onCaptionsEnabledChange: (enabled: boolean) => void;
}

/* ---------- sub-components ---------- */
function SectionHeader({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3 h-3 text-violet-400 shrink-0" />
      <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
        {label}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
    queued: {
      label: "Queued",
      cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
      icon: Clock,
    },
    transcribing: {
      label: "Transcribing",
      cls: "border-violet-400/40 bg-violet-400/10 text-violet-300",
      icon: Loader2,
    },
    planning: {
      label: "Planning",
      cls: "border-violet-400/40 bg-violet-400/10 text-violet-300",
      icon: Loader2,
    },
    rendering: {
      label: "Rendering",
      cls: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
      icon: Loader2,
    },
    completed: {
      label: "Ready",
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      icon: CheckCircle2,
    },
    failed: {
      label: "Failed",
      cls: "border-red-500/40 bg-red-500/10 text-red-300",
      icon: XCircle,
    },
    idle: {
      label: "Idle",
      cls: "border-white/10 bg-white/5 text-neutral-500",
      icon: Sparkles,
    },
  };
  const s = cfg[status] ?? cfg.idle;
  const SIcon = s.icon;
  const spinning = ["transcribing", "planning", "rendering"].includes(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border font-mono",
        s.cls,
      )}
    >
      <SIcon className={cn("w-2.5 h-2.5", spinning && "animate-spin")} />
      {s.label}
    </span>
  );
}

function StepCard({
  n,
  text,
  active,
  done,
  failed,
}: {
  n: number;
  text: string;
  active?: boolean;
  done?: boolean;
  failed?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg p-2.5 border text-[11px] leading-snug",
        failed
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : active
          ? "border-violet-400/40 bg-violet-400/10 text-violet-200"
          : done
          ? "border-white/[0.06] bg-white/[0.02] text-neutral-300"
          : "border-white/[0.04] bg-transparent text-neutral-600",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "shrink-0 text-[9px] font-mono w-4 h-4 rounded grid place-items-center",
            failed
              ? "bg-red-500/70 text-white"
              : active
              ? "bg-violet-500 text-white"
              : done
              ? "bg-emerald-500/80 text-neutral-950"
              : "bg-white/5 text-neutral-600",
          )}
        >
          {failed ? "!" : n}
        </span>
        <span className="leading-relaxed">{text}</span>
      </div>
    </div>
  );
}

function EditPlanCard({ plan }: { plan: EditPlan }) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  return (
    <div className="rounded-lg border border-violet-400/20 bg-violet-400/5 overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-violet-300 hover:bg-violet-400/10 transition"
      >
        <Wand2 className="w-3 h-3" />
        <span className="font-semibold flex-1 text-left">AI Edit Plan</span>
        {open ? (
          <ChevronDown className="w-3 h-3 text-violet-400" />
        ) : (
          <ChevronRight className="w-3 h-3 text-violet-400" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {plan.brief && (
            <p className="text-[11px] text-neutral-300 leading-relaxed italic">&ldquo;{plan.brief}&rdquo;</p>
          )}
          {plan.style && (
            <div className="text-[10px] text-neutral-500">
              Style:{" "}
              <span className="text-violet-300 font-mono">{plan.style}</span>
            </div>
          )}
          {plan.hooks && plan.hooks.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-neutral-600 mb-1">
                Hooks
              </div>
              <ul className="space-y-0.5">
                {plan.hooks.map((h: string, i: number) => (
                  <li key={i} className="text-[10px] text-neutral-400 flex gap-1">
                    <span className="text-violet-400 shrink-0">·</span> {h}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.steps && plan.steps.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-neutral-600 mb-1">
                Steps
              </div>
              <ul className="space-y-1">
                {plan.steps.map((s: { title: string; detail: string }, i: number) => (
                  <li key={i}>
                    <div className="text-[10px] font-semibold text-neutral-300">{s.title}</div>
                    <div className="text-[10px] text-neutral-500 leading-snug">{s.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- main panel ---------- */
export function AIMotionPanel({
  status,
  latestJob,
  clipCount,
  preset,
  script,
  musicEnabled,
  musicVolume,
  captionsEnabled,
  captionsText,
  onScriptChange,
  onScriptBlur,
  onMusicEnabledChange,
  onMusicVolumeChange,
  onCaptionsEnabledChange,
}: AIMotionPanelProps) {
  const [activeTab, setActiveTab] = useState<"director" | "notes">("director");

  const jobStatus = latestJob?.status ?? "idle";
  const inProgress = ["queued", "transcribing", "planning", "rendering"].includes(jobStatus);

  const steps = [
    {
      n: 1,
      text: `Analyzed ${clipCount} source clip${clipCount === 1 ? "" : "s"} and ordered by ordinal.`,
      done: clipCount > 0,
    },
    {
      n: 2,
      text: `Applied ${preset.toUpperCase()} preset — pacing, cut cadence, color signature.`,
      done: true,
    },
    {
      n: 3,
      text: latestJob?.stage_message ?? "Waiting to begin AI edit.",
      active: inProgress,
      done: status === "ready" || jobStatus === "completed",
      failed: jobStatus === "failed",
    },
    {
      n: 4,
      text: status === "ready" ? "Rendered final MP4 — ready to export." : "Final render pending.",
      done: status === "ready",
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="h-9 border-b border-white/[0.06] flex items-center px-1 gap-0.5 shrink-0">
        {(["director", "notes"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-2.5 h-6 rounded text-[11px] font-medium transition-colors",
              activeTab === tab
                ? "bg-white/[0.08] text-violet-300"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03]",
            )}
          >
            {tab === "director" ? "AI Director" : "Notes & Audio"}
          </button>
        ))}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === "director" ? (
          <>
            {/* Status row */}
            <div className="flex items-center gap-2">
              <SectionHeader label="Status" icon={Sparkles} />
              <StatusBadge status={jobStatus} />
            </div>

            {/* Progress bar for active jobs */}
            {inProgress && (
              <div>
                <div className="flex items-center justify-between mb-1 text-[10px] font-mono text-neutral-500">
                  <span className="text-violet-300 truncate">{latestJob?.stage_message ?? "Working…"}</span>
                  <span className="tabular-nums">{latestJob?.progress ?? 0}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-700"
                    style={{ width: `${Math.max(4, latestJob?.progress ?? 0)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Step cards */}
            <div className="space-y-1.5">
              <SectionHeader label="Reasoning" icon={Zap} />
              {steps.map((s) => (
                <StepCard key={s.n} {...s} />
              ))}
            </div>

            {/* Edit plan (if available) */}
            {latestJob?.edit_plan && (
              <EditPlanCard plan={latestJob.edit_plan as EditPlan} />
            )}

            {/* Error details */}
            {jobStatus === "failed" && latestJob?.error && (
              <div className="rounded-lg p-2.5 border border-red-500/30 bg-red-500/8 text-red-300 text-[11px] leading-relaxed">
                <div className="font-semibold mb-0.5">Error</div>
                {latestJob.error}
              </div>
            )}

            {/* Empty state */}
            {clipCount === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-neutral-500">
                <Sparkles className="w-5 h-5 mx-auto mb-2 text-neutral-700" />
                Import at least one clip, then hit&nbsp;
                <span className="text-violet-300 font-semibold">Render Video</span>
                &nbsp;to start the AI director.
              </div>
            )}
          </>
        ) : (
          <>
            {/* Captions */}
            <div>
              <SectionHeader label="Captions" icon={FileText} />
              <div className="flex items-center gap-2 mb-2">
                <Switch
                  checked={captionsEnabled}
                  onCheckedChange={onCaptionsEnabledChange}
                  className="data-[state=checked]:bg-violet-600"
                />
                <span className="text-[11px] text-neutral-400">Burn word-by-word</span>
              </div>
              <Textarea
                value={captionsText ?? (script ?? "")}
                onChange={(e) => onScriptChange(e.target.value)}
                onBlur={onScriptBlur}
                placeholder="AI captions will be generated from audio. Override here…"
                className="min-h-[80px] bg-black/40 border-white/10 text-neutral-200 text-[11px] font-mono resize-none focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
              />
            </div>

            {/* Music */}
            <div>
              <SectionHeader label="Music" icon={Volume2} />
              <div className="flex items-center gap-2 mb-2">
                <Switch
                  checked={musicEnabled}
                  onCheckedChange={onMusicEnabledChange}
                  className="data-[state=checked]:bg-violet-600"
                />
                <span className="text-[11px] text-neutral-400">Auto-score &amp; duck under VO</span>
              </div>
              {musicEnabled && (
                <div className="flex items-center gap-2">
                  <Volume2 className="w-3 h-3 text-neutral-500 shrink-0" />
                  <Slider
                    value={[musicVolume]}
                    onValueChange={(v) => onMusicVolumeChange(v[0])}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-[10px] font-mono text-neutral-500 w-7 text-right tabular-nums">
                    {musicVolume}
                  </span>
                </div>
              )}
            </div>

            {/* Voice-over placeholder */}
            <div>
              <SectionHeader label="Voice-over" icon={Mic} />
              <div className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11px] text-neutral-600">
                AI voice-over coming in Phase 3
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
