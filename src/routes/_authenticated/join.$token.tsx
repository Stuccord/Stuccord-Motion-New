import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { acceptInvite, getInvite } from "@/lib/teams.functions";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/plans";

// An invite link: <site>/join/<secret>. Signing in first brings people back here.
export const Route = createFileRoute("/_authenticated/join/$token")({
  head: () => ({ meta: [{ title: "Join a team — Stuccord Motion" }] }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchInvite = useServerFn(getInvite);
  const accept = useServerFn(acceptInvite);
  const wellFormed = /^[A-Za-z0-9]{32}$/.test(token);
  const q = useQuery({
    queryKey: ["invite", token],
    queryFn: () => fetchInvite({ data: { token } }),
    enabled: wellFormed,
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => accept({ data: { token } }),
    onSuccess: (r) => {
      toast.success(r.already ? "You're already in this team" : "You joined the team");
      void qc.invalidateQueries({ queryKey: ["teams"] });
      void navigate({ to: "/teams/$teamId", params: { teamId: r.teamId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inv = q.data;
  const problem = !wellFormed
    ? "This invite link isn't complete. Check you copied all of it."
    : q.error
      ? q.error instanceof Error
        ? q.error.message
        : "Couldn't open this invite"
      : inv && !inv.valid
        ? "This invite link has expired or was revoked. Ask for a new one."
        : null;

  return (
    <AppShell title="Join a team">
      <div className="max-w-md mx-auto rounded-2xl bg-white border border-black/5 p-6 text-center space-y-4">
        {q.isLoading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-neutral-500 py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Opening the invite…
          </div>
        ) : problem || !inv?.valid ? (
          <>
            <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
            <p className="text-sm text-neutral-700">{problem}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard">Go home</Link>
            </Button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl bg-violet-100 text-violet-700 grid place-items-center mx-auto">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-lg font-semibold">{inv.teamName}</div>
              <p className="text-sm text-neutral-600 mt-1">
                {inv.invitedBy ? `${inv.invitedBy} invited you` : "You're invited"} to join as{" "}
                {/^[AEIOU]/.test(ROLE_LABEL[inv.role]) ? "an" : "a"}{" "}
                <span className="font-medium">{ROLE_LABEL[inv.role]}</span>.
              </p>
              <p className="text-xs text-neutral-500 mt-1">{ROLE_HINT[inv.role]}.</p>
            </div>
            {inv.alreadyMember ? (
              <Button asChild>
                <Link to="/teams/$teamId" params={{ teamId: inv.teamId }}>
                  You&apos;re in this team: open it
                </Link>
              </Button>
            ) : inv.full ? (
              <p className="text-sm text-amber-700">
                This team is full on its plan. Ask one of its admins to make room.
              </p>
            ) : (
              <Button onClick={() => join.mutate()} disabled={join.isPending}>
                {join.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Join {inv.teamName}
              </Button>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
