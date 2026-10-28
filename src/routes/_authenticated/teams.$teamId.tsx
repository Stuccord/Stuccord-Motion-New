import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Link2,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  changeMemberRole,
  createInvite,
  deleteTeam,
  getTeam,
  leaveTeam,
  removeMember,
  renameTeam,
  revokeInvite,
  transferOwnership,
  type TeamMember,
} from "@/lib/teams.functions";
import { INVITE_DAYS, ROLE_HINT, ROLE_LABEL, type TeamRole } from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/teams/$teamId")({
  head: () => ({ meta: [{ title: "Team — Stuccord Motion" }] }),
  component: TeamPage,
});

type Confirm =
  | { kind: "remove"; member: TeamMember }
  | { kind: "transfer"; member: TeamMember }
  | { kind: "leave" }
  | { kind: "delete" }
  | null;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function TeamPage() {
  const { teamId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchTeam = useServerFn(getTeam);
  const q = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => fetchTeam({ data: { teamId } }),
    retry: false,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["team", teamId] });
    void qc.invalidateQueries({ queryKey: ["teams"] });
  };

  const rename = useServerFn(renameTeam);
  const setRole = useServerFn(changeMemberRole);
  const invite = useServerFn(createInvite);
  const revoke = useServerFn(revokeInvite);
  const remove = useServerFn(removeMember);
  const transfer = useServerFn(transferOwnership);
  const leave = useServerFn(leaveTeam);
  const destroy = useServerFn(deleteTeam);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [link, setLink] = useState<{ url: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [typed, setTyped] = useState("");

  const ok = (msg: string) => () => {
    toast.success(msg);
    refresh();
  };
  const err = (e: Error) => toast.error(e.message);

  const doRename = useMutation({
    mutationFn: () => rename({ data: { teamId, name: name.trim() } }),
    onSuccess: () => {
      setEditing(false);
      ok("Renamed")();
    },
    onError: err,
  });
  const doRole = useMutation({
    mutationFn: (v: { userId: string; role: "admin" | "editor" | "viewer" }) =>
      setRole({ data: { teamId, ...v } }),
    onSuccess: ok("Role changed"),
    onError: err,
  });
  const doInvite = useMutation({
    mutationFn: () => invite({ data: { teamId, role: inviteRole } }),
    onSuccess: (r) => {
      setLink({ url: `${window.location.origin}/join/${r.token}`, role: ROLE_LABEL[inviteRole] });
      setCopied(false);
      refresh();
    },
    onError: err,
  });
  const doRevoke = useMutation({
    mutationFn: (inviteId: string) => revoke({ data: { teamId, inviteId } }),
    onSuccess: ok("Link revoked: it no longer works"),
    onError: err,
  });
  const doConfirm = useMutation({
    mutationFn: async () => {
      if (!confirm) return;
      if (confirm.kind === "remove")
        return remove({ data: { teamId, userId: confirm.member.user_id } });
      if (confirm.kind === "transfer")
        return transfer({ data: { teamId, userId: confirm.member.user_id } });
      if (confirm.kind === "leave") return leave({ data: { teamId } });
      return destroy({ data: { teamId, confirmName: typed } });
    },
    onSuccess: () => {
      const kind = confirm?.kind;
      setConfirm(null);
      setTyped("");
      if (kind === "leave" || kind === "delete") {
        toast.success(kind === "leave" ? "You left the team" : "Team deleted");
        void qc.invalidateQueries({ queryKey: ["teams"] });
        void navigate({ to: "/settings", search: { tab: "teams" } });
        return;
      }
      ok(kind === "remove" ? "Removed from the team" : "Ownership handed over")();
    },
    onError: err,
  });

  if (q.isLoading) {
    return (
      <AppShell title="Team">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      </AppShell>
    );
  }
  if (q.error || !q.data) {
    return (
      <AppShell title="Team">
        <div className="rounded-2xl bg-white border border-black/5 p-6 text-center space-y-3">
          <p className="text-sm text-neutral-600">
            {q.error instanceof Error ? q.error.message : "Team not found"}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/settings" search={{ tab: "teams" }}>
              Back to your teams
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const { team, role, members, invites, seats } = q.data;
  const manage = role === "owner" || role === "admin";
  const full = seats.used >= seats.limit;
  // What the caller may set another member to.
  const rolesFor = (m: TeamMember): ("admin" | "editor" | "viewer")[] =>
    m.you || m.role === "owner" || !manage
      ? []
      : role === "owner"
        ? ["admin", "editor", "viewer"]
        : m.role === "admin"
          ? []
          : ["editor", "viewer"];
  const canRemove = (m: TeamMember) =>
    !m.you && m.role !== "owner" && manage && !(role === "admin" && m.role === "admin");

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy: select the link and copy it yourself");
    }
  };

  return (
    <AppShell title={team.name} subtitle={`${team.planLabel} plan · you're ${ROLE_LABEL[role]}`}>
      <div className="max-w-3xl space-y-6">
        <Link
          to="/settings"
          search={{ tab: "teams" }}
          className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Your teams
        </Link>

        {/* Name */}
        <section className="rounded-2xl bg-white border border-black/5 p-5">
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) doRename.mutate();
              }}
            >
              <Input
                aria-label="Team name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <Button type="submit" disabled={!name.trim() || doRename.isPending}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{team.name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {seats.used} of {seats.limit} people on the {team.planLabel} plan
                </div>
              </div>
              {manage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setName(team.name);
                    setEditing(true);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Rename
                </Button>
              )}
            </div>
          )}
        </section>

        {/* Members */}
        <section className="rounded-2xl bg-white border border-black/5 p-5 space-y-3">
          <div className="text-sm font-semibold">People</div>
          <div className="rounded-xl border border-black/10 divide-y divide-black/5">
            {members.map((m) => {
              const options = rolesFor(m);
              return (
                <div
                  key={m.user_id}
                  className="flex items-center gap-3 px-4 py-3"
                  data-member={m.user_id}
                >
                  <div className="w-8 h-8 rounded-full bg-neutral-100 grid place-items-center text-xs font-semibold text-neutral-600">
                    {m.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {m.name}
                      {m.you && <span className="text-neutral-400 font-normal"> (you)</span>}
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {m.email ?? ""} · joined {fmtDate(m.joined_at)}
                    </div>
                  </div>
                  {options.length ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        doRole.mutate({
                          userId: m.user_id,
                          role: v as "admin" | "editor" | "viewer",
                        })
                      }
                    >
                      <SelectTrigger className="w-32 h-8 text-xs" aria-label={`Role for ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-neutral-600 inline-flex items-center gap-1">
                      {m.role === "owner" && <Crown className="w-3 h-3 text-amber-500" />}
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                  {(canRemove(m) || (role === "owner" && !m.you)) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`More for ${m.name}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {role === "owner" && !m.you && (
                          <DropdownMenuItem
                            onClick={() => setConfirm({ kind: "transfer", member: m })}
                          >
                            <Crown className="w-3.5 h-3.5 mr-2" /> Make owner
                          </DropdownMenuItem>
                        )}
                        {role === "owner" && canRemove(m) && <DropdownMenuSeparator />}
                        {canRemove(m) && (
                          <DropdownMenuItem
                            className="text-rose-600"
                            onClick={() => setConfirm({ kind: "remove", member: m })}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove from team
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
          <ul className="text-[11px] text-neutral-500 grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
            {(Object.keys(ROLE_HINT) as TeamRole[]).map((r) => (
              <li key={r}>
                <span className="font-medium text-neutral-700">{ROLE_LABEL[r]}:</span>{" "}
                {ROLE_HINT[r]}
              </li>
            ))}
          </ul>
        </section>

        {/* Invites */}
        {manage && (
          <section className="rounded-2xl bg-white border border-black/5 p-5 space-y-3">
            <div>
              <div className="text-sm font-semibold">Invite people</div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Make a link and send it however you like. Anyone signed in who opens it can join
                with the role you pick, until it expires in {INVITE_DAYS} days or you revoke it.
              </div>
            </div>

            {full ? (
              <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                The team is full ({seats.limit} people on the {team.planLabel} plan). Remove someone
                to make room.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as typeof inviteRole)}
                  >
                    <SelectTrigger className="w-40" aria-label="Invite role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(role === "owner"
                        ? (["admin", "editor", "viewer"] as const)
                        : (["editor", "viewer"] as const)
                      ).map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => doInvite.mutate()} disabled={doInvite.isPending}>
                  {doInvite.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4 mr-1.5" />
                  )}
                  Make invite link
                </Button>
              </div>
            )}

            {link && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 space-y-2">
                <div className="text-[13px] font-medium text-emerald-900">
                  Invite link for an {link.role}
                </div>
                <p className="text-[12px] text-emerald-900/80">
                  Copy it now: it won&apos;t be shown again. You can revoke it below.
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={link.url}
                    aria-label="Invite link"
                    className="font-mono text-xs bg-white"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button variant="outline" onClick={() => void copy()} className="shrink-0">
                    {copied ? (
                      <Check className="w-4 h-4 mr-1.5" />
                    ) : (
                      <Copy className="w-4 h-4 mr-1.5" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            {invites.length > 0 && (
              <div className="rounded-xl border border-black/10 divide-y divide-black/5">
                {invites.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link2 className="w-4 h-4 text-neutral-400" />
                    <div className="flex-1 text-[13px]">
                      {ROLE_LABEL[i.role]} link
                      <span className="text-[11px] text-neutral-500">
                        {" "}
                        · made {fmtDate(i.created_at)} · expires {fmtDate(i.expires_at)} · used{" "}
                        {i.uses} {i.uses === 1 ? "time" : "times"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => doRevoke.mutate(i.id)}
                      disabled={doRevoke.isPending}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Leave / delete */}
        <section className="rounded-2xl bg-white border border-rose-200 p-5 flex flex-wrap items-center justify-between gap-3">
          {role === "owner" ? (
            <>
              <div>
                <div className="text-sm font-semibold">Delete team</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  Everyone loses access to it. This can&apos;t be undone.
                </div>
              </div>
              <Button
                variant="outline"
                className="text-rose-600 border-rose-200 hover:bg-rose-50"
                onClick={() => setConfirm({ kind: "delete" })}
              >
                <Trash2 className="w-4 h-4 mr-1.5" /> Delete team
              </Button>
            </>
          ) : (
            <>
              <div>
                <div className="text-sm font-semibold">Leave team</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  You lose access until someone invites you again.
                </div>
              </div>
              <Button
                variant="outline"
                className="text-rose-600 border-rose-200 hover:bg-rose-50"
                onClick={() => setConfirm({ kind: "leave" })}
              >
                <LogOut className="w-4 h-4 mr-1.5" /> Leave team
              </Button>
            </>
          )}
        </section>
      </div>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setTyped("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "remove"
                ? `Remove ${confirm.member.name}?`
                : confirm?.kind === "transfer"
                  ? `Make ${confirm.member.name} the owner?`
                  : confirm?.kind === "leave"
                    ? `Leave ${team.name}?`
                    : `Delete ${team.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "remove"
                ? "They lose access to the team straight away. Their work stays with the team."
                : confirm?.kind === "transfer"
                  ? "They become the owner and you become an admin. Only they can hand it back."
                  : confirm?.kind === "leave"
                    ? "You lose access straight away."
                    : "Everyone loses access to the team. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.kind === "delete" && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-team">Type the team&apos;s name to confirm</Label>
              <Input
                id="confirm-team"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={team.name}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.kind === "transfer" ? "" : "bg-rose-600 hover:bg-rose-700"}
              disabled={
                doConfirm.isPending || (confirm?.kind === "delete" && typed.trim() !== team.name)
              }
              onClick={(e) => {
                e.preventDefault();
                doConfirm.mutate();
              }}
            >
              {doConfirm.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {confirm?.kind === "remove"
                ? "Remove"
                : confirm?.kind === "transfer"
                  ? "Make owner"
                  : confirm?.kind === "leave"
                    ? "Leave"
                    : "Delete team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
