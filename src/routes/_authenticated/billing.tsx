import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Sparkles, Zap, Crown, CreditCard, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUsageStats } from "@/lib/projects.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — Stuccord Motion" }] }),
  component: BillingPage,
});

const PLANS = [
  {
    id: "starter", name: "Starter", price: 0, cadence: "forever",
    tag: "You're here", icon: Sparkles,
    features: ["5 renders / month", "1080p exports", "Watermark on exports", "Community support"],
  },
  {
    id: "pro", name: "Pro", price: 29, cadence: "per month",
    tag: "Most popular", icon: Zap, popular: true,
    features: ["Unlimited renders", "4K exports", "No watermark", "Auto-caption 2.0", "Brand kit + custom fonts", "Priority render queue"],
  },
  {
    id: "studio", name: "Studio", price: 99, cadence: "per month",
    tag: "For teams", icon: Crown,
    features: ["Everything in Pro", "5 seats included", "API access", "Team asset library", "SSO + audit log", "Dedicated support"],
  },
];

function nextResetLabel() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function BillingPage() {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const fetchStats = useServerFn(getUsageStats);
  const { data } = useQuery({ queryKey: ["usage-stats"], queryFn: () => fetchStats() });

  const used = data?.rendersThisMonth ?? 0;
  const cap = data?.renderCap ?? 5;
  const pct = Math.min(100, Math.round((used / cap) * 100));

  const notify = () =>
    toast.info("Paid plans arriving soon", {
      description: "We'll email you the moment upgrades open up. You're on Starter until then.",
    });

  return (
    <AppShell title="Billing" subtitle="Manage your plan, invoices and payment method.">
      <Card className="bg-gradient-to-br from-neutral-900 via-neutral-900 to-violet-950 text-white p-6 mb-6 relative overflow-hidden border-0 shadow-lg">
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-violet-500/20 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Badge variant="outline" className="border-white/20 text-white/70 text-[10px] uppercase tracking-wider mb-2">
              Current plan
            </Badge>
            <div className="text-2xl font-semibold">Starter · Free</div>
            <div className="text-sm text-white/70 mt-1">
              <span className="tabular-nums font-medium text-white">{used}</span> of {cap} renders used this month · resets {nextResetLabel()}
            </div>
            <div className="mt-3 max-w-sm">
              <Progress value={pct} className="h-1.5 bg-white/10" />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button className="bg-white text-neutral-900 hover:bg-white/90 font-medium" onClick={notify}>Upgrade</Button>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="inline-flex items-center bg-white border border-black/5 rounded-full p-1 shadow-sm">
          <button
            onClick={() => setCycle("monthly")}
            className={cn("px-3 h-8 text-xs font-medium rounded-full transition-colors", cycle === "monthly" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900")}
          >
            Monthly
          </button>
          <button
            onClick={() => setCycle("yearly")}
            className={cn("px-3 h-8 text-xs font-medium rounded-full transition-colors", cycle === "yearly" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900")}
          >
            Yearly <Badge variant="secondary" className="ml-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0 text-[10px] px-1.5 py-0">-20%</Badge>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        {PLANS.map((p) => {
          const price = cycle === "yearly" ? Math.round(p.price * 0.8) : p.price;
          return (
            <Card
              key={p.id}
              className={cn(
                "relative p-6 flex flex-col justify-between transition-all duration-150",
                p.popular ? "border-violet-300 shadow-[0_10px_40px_-12px_rgba(124,58,237,0.3)]" : "border-black/5",
              )}
            >
              {p.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 border-0">
                  {p.tag}
                </Badge>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <div className={cn("w-8 h-8 rounded-lg grid place-items-center",
                    p.popular ? "bg-violet-100 text-violet-700" : "bg-neutral-100 text-neutral-700")}>
                    <p.icon className="w-4 h-4" />
                  </div>
                  <div className="text-sm font-semibold">{p.name}</div>
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">${price}</span>
                  <span className="text-xs text-neutral-500">{p.price === 0 ? p.cadence : cycle === "yearly" ? "/mo, billed yearly" : "/mo"}</span>
                </div>
                <ul className="mt-5 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px]">
                      <Check className="w-3.5 h-3.5 text-emerald-600 mt-1 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                onClick={p.id === "starter" ? undefined : notify}
                disabled={p.id === "starter"}
                className={cn("mt-6 w-full", p.popular ? "" : p.id === "starter" ? "" : "bg-neutral-900 hover:bg-neutral-800")}
                variant={p.id === "starter" ? "outline" : "default"}
              >
                {p.id === "starter" ? "Current plan" : `Notify me`}
              </Button>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader className="p-0 mb-4">
            <CardTitle className="text-sm font-semibold">Payment method</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-lg border border-dashed border-black/10 p-6 text-center text-sm text-neutral-500">
              <CreditCard className="w-5 h-5 text-neutral-400 mx-auto mb-2" />
              No payment method needed on Starter
            </div>
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-semibold">Invoices</CardTitle>
            <Button variant="ghost" size="sm" disabled><Download className="w-3.5 h-3.5" /> Export all</Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="text-sm text-neutral-500 text-center py-8">No invoices yet.</div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
