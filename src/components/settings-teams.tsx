// Settings > Teams: the teams you're in, and making a new one.

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTeam, listMyTeams } from "@/lib/teams.functions";
import { ROLE_LABEL, TEAMS_OWNED_LIMIT, planFor } from "@/lib/plans";

export function TeamSettings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchTeams = useServerFn(listMyTeams);
  const make = useServerFn(createTeam);
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => fetchTeams(), retry: false });
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => make({ data: { name: name.trim() } }),
    onSuccess: (t) => {
      toast.success(`${t.name} is ready. Invite people from its page.`);
      setName("");
      void qc.invalidateQueries({ queryKey: ["teams"] });
      void navigate({ to: "/teams/$teamId", params: { teamId: t.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = teams.data ?? [];
  const owned = list.filter((t) => t.role === "owner").length;
  const free = planFor("free");

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-600">
        Work together on projects. Each team has its own members and roles; invite people with a
        link. On the Free plan a team can have up to {free.teamSeats} people.
      </p>

      <div className="space-y-2">
        <div className="text-sm font-semibold">Your teams</div>
        {teams.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : teams.error ? (
          <p className="text-sm text-rose-600">
            {teams.error instanceof Error ? teams.error.message : "Couldn't load your teams"}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-neutral-500">You&apos;re not in any teams yet.</p>
        ) : (
          <div className="rounded-xl border border-black/10 divide-y divide-black/5">
            {list.map((t) => (
              <Link
                key={t.id}
                to="/teams/$teamId"
                params={{ teamId: t.id }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 grid place-items-center text-sm font-semibold">
                  {t.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-[11px] text-neutral-500">
                    {ROLE_LABEL[t.role]} · {t.members} {t.members === 1 ? "person" : "people"} ·{" "}
                    {planFor(t.plan).label} plan
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-400" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <form
        className="rounded-xl border border-black/10 p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4" /> New team
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team-name">Team name</Label>
          <Input
            id="team-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ebube Media"
          />
        </div>
        <Button
          type="submit"
          disabled={!name.trim() || create.isPending || owned >= TEAMS_OWNED_LIMIT}
        >
          {create.isPending ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-1.5" />
          )}
          Make team
        </Button>
        {owned >= TEAMS_OWNED_LIMIT && (
          <p className="text-[12px] text-neutral-500">
            You own {TEAMS_OWNED_LIMIT} teams, the most allowed.
          </p>
        )}
      </form>
    </div>
  );
}
