import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Check, Clock, Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUsageStats } from "@/lib/projects.functions";
import { AI_VOICE_MONTHLY_CHARS, getAiVoiceUsage } from "@/lib/voiceover.functions";
import { listAllowances } from "@/lib/teams.functions";
import { MAX_UPLOAD_MB } from "@/lib/upload-rules";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — Stuccord Motion" }] }),
  component: BillingPage,
});

// What the free plan really includes (and enforces): see submitRender and
// startBrowserRender in src/lib/projects.functions.ts, and the upload limit
// in src/routes/api/authenticated/uploads/presign.ts; AI voice in
// src/lib/voiceover.functions.ts.
const INCLUDED = [
  "5 exports a month (cloud or browser)",
  "Cloud exports in 1080p; browser exports up to 4K",
  "No watermark",
  "Word-by-word captions from your speech",
  "Music and sound effects, quieter under your voice",
  "Voiceovers: record your own (no limit) or AI voice, " +
    `${AI_VOICE_MONTHLY_CHARS.toLocaleString("en")} characters a month`,
  "B-roll, images and picture-in-picture",
  "9:16, 16:9 and 1:1 videos",
  `Uploads up to ${MAX_UPLOAD_MB} MB per file`,
];

function nextResetLabel() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function BillingPage() {
  // Your own allowance (personal projects) and each team's (its projects).
  const fetchAllowances = useServerFn(listAllowances);
  const { data: allowances, isLoading } = useQuery({
    queryKey: ["usage-stats", "allowances"],
    queryFn: () => fetchAllowances(),
  });
  const data = allowances && {
    rendersThisMonth: allowances.personal.used,
    renderCap: allowances.personal.cap,
  };
  const fetchVoiceUsage = useServerFn(getAiVoiceUsage);
  const voice = useQuery({
    queryKey: ["ai-voice-usage"],
    queryFn: () => fetchVoiceUsage(),
    retry: false,
  });

  const used = data?.rendersThisMonth ?? 0;
  const cap = data?.renderCap ?? 5;
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const left = Math.max(0, cap - used);

  return (
    <AppShell title="Billing" subtitle="Your plan and how much of it you've used this month.">
      <Card className="bg-gradient-to-br from-neutral-900 via-neutral-900 to-violet-950 text-white p-6 mb-6 relative overflow-hidden border-0 shadow-lg">
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-violet-500/20 blur-3xl pointer-events-none" />
        <div className="relative">
          <Badge
            variant="outline"
            className="border-white/20 text-white/70 text-[10px] uppercase tracking-wider mb-2"
          >
            Current plan
          </Badge>
          <div className="text-2xl font-semibold">{allowances?.personal.plan ?? "Free"}</div>
          <div className="text-sm text-white/70 mt-1">
            {isLoading ? (
              "Loading your usage…"
            ) : (
              <>
                <span className="tabular-nums font-medium text-white">{used}</span> of {cap}{" "}
                personal exports used this month · {left} left · resets {nextResetLabel()}
              </>
            )}
          </div>
          <div className="mt-3 max-w-sm">
            <Progress value={pct} className="h-1.5 bg-white/10" />
          </div>
          {voice.data && (
            <div className="mt-4 max-w-sm">
              <div className="text-sm text-white/70">
                AI voice:{" "}
                <span className="tabular-nums font-medium text-white">
                  {voice.data.used.toLocaleString()}
                </span>{" "}
                of {voice.data.limit.toLocaleString()} characters used this month
              </div>
              <Progress
                value={Math.min(100, Math.round((voice.data.used / voice.data.limit) * 100))}
                className="h-1.5 bg-white/10 mt-2"
              />
            </div>
          )}
        </div>
      </Card>

      {(allowances?.teams.length ?? 0) > 0 && (
        <Card className="p-6 mb-6" data-team-allowances>
          <div className="text-sm font-semibold">Teams</div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Exports of a team&apos;s projects use the team&apos;s allowance, shared by everyone in
            it, not your own.
          </p>
          <div className="mt-4 space-y-3">
            {allowances!.teams.map((t) => (
              <div key={t.team!.id}>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium">{t.team!.name}</span>
                  <span className="text-neutral-500 tabular-nums">
                    {t.used} of {t.cap} exports · {t.plan} plan
                  </span>
                </div>
                <Progress
                  value={Math.min(100, Math.round((t.used / t.cap) * 100))}
                  className="h-1.5 mt-1.5"
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-6">
          <div className="text-sm font-semibold">What's included</div>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13px]">
                <Check className="w-3.5 h-3.5 text-emerald-600 mt-1 shrink-0" /> {f}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-neutral-500 leading-relaxed">
            Exports that fail don&apos;t count. When you&apos;ve used all {cap}, exporting pauses
            until the 1st of next month; you can keep editing meanwhile.
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="w-4 h-4 text-violet-600" /> Paid plans
          </div>
          <p className="mt-3 text-[13px] text-neutral-600 leading-relaxed">
            Paid plans aren&apos;t available yet, so there&apos;s nothing to pay and no card needed.
            Everyone is on the free plan for now.
          </p>
          <p className="mt-3 text-[13px] text-neutral-600 leading-relaxed">
            Need more than {cap} exports a month? Tell us what you&apos;re making.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href="mailto:support@stuccord.com?subject=More%20exports">
                <Mail className="w-3.5 h-3.5" /> Email us
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/analytics">See your activity</Link>
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
