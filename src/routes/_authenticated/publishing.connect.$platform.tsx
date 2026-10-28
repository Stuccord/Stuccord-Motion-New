import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { finishConnect } from "@/lib/publishing.functions";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@/lib/publishing-shared";

// Where a platform sends the user back after they sign in
// (<PUBLIC_APP_URL>/publishing/connect/youtube is the redirect address).
export const Route = createFileRoute("/_authenticated/publishing/connect/$platform")({
  head: () => ({ meta: [{ title: "Connecting — Stuccord Motion" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s.code === "string" ? s.code : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
    error: typeof s.error === "string" ? s.error : undefined,
  }),
  component: ConnectReturn,
});

function ConnectReturn() {
  const { platform } = Route.useParams();
  const { code, state, error } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const finish = useServerFn(finishConnect);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  const known = (PLATFORMS as readonly string[]).includes(platform);
  const label = known ? PLATFORM_LABEL[platform as Platform] : "that platform";

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!known) return setProblem("That isn't a platform you can connect.");
    if (error) {
      return setProblem(
        error === "access_denied"
          ? `You didn't allow Stuccord to post to ${label}.`
          : `${label} didn't finish signing in (${error.slice(0, 60)}).`,
      );
    }
    if (!code || !state) return setProblem("The sign-in didn't come back complete.");
    finish({ data: { platform: platform as Platform, code, state } })
      .then((r) => {
        toast.success(r.reconnected ? `${r.name} reconnected` : `${r.name} connected`);
        void qc.invalidateQueries({ queryKey: ["social-accounts"] });
        void navigate({ to: "/publishing", replace: true });
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : "Couldn't connect"));
  }, [code, state, error, platform, known, label, finish, navigate, qc]);

  return (
    <AppShell title="Publishing" subtitle={`Connecting ${label}`}>
      <div className="max-w-md mx-auto rounded-2xl bg-white border border-black/5 p-6 text-center space-y-3">
        {problem ? (
          <>
            <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
            <p className="text-sm text-neutral-700">{problem}</p>
            <Button asChild size="sm">
              <Link to="/publishing">Back to Publishing</Link>
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 animate-spin text-violet-600 mx-auto" />
            <p className="text-sm text-neutral-600">Connecting your {label} account…</p>
          </>
        )}
      </div>
    </AppShell>
  );
}
