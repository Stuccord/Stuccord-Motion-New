// The sidebar's workspace picker: your personal space or one of your teams.
// Projects, assets and analytics show the chosen workspace; new projects are
// made in it.

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Settings2, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/plans";
import { setWorkspace, useWorkspace } from "@/lib/use-workspace";
import { PERSONAL } from "@/lib/workspace";

function Badge({ name, personal }: { name: string; personal?: boolean }) {
  return (
    <span
      className={cn(
        "w-6 h-6 rounded-md grid place-items-center text-[11px] font-semibold shrink-0",
        personal ? "bg-surface-2 text-muted-foreground" : "bg-primary/15 text-primary",
      )}
    >
      {personal ? <User className="w-3.5 h-3.5" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const choose = (id: string) => {
    if (id === ws.id) return;
    setWorkspace(id);
    // An open project belongs to the old workspace: go to the new one's projects.
    if (/^\/projects\/[0-9a-f-]{36}/.test(path)) void navigate({ to: "/projects" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="w-full flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left hover:bg-surface-2 transition"
        aria-label="Switch workspace"
        data-workspace-switcher
      >
        <Badge name={ws.team?.name ?? "Personal"} personal={!ws.team} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium truncate text-foreground">
            {ws.team?.name ?? "Personal"}
          </span>
          <span className="block text-[10px] text-muted-foreground truncate">
            {ws.team ? `Team · ${ROLE_LABEL[ws.team.role]}` : "Just you"}
          </span>
        </span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => choose(PERSONAL)} className="gap-2">
          <Badge name="Personal" personal />
          <span className="flex-1">Personal</span>
          {ws.id === PERSONAL && <Check className="w-3.5 h-3.5" />}
        </DropdownMenuItem>
        {ws.teams.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => choose(t.id)} className="gap-2">
            <Badge name={t.name} />
            <span className="flex-1 min-w-0">
              <span className="block truncate">{t.name}</span>
              <span className="block text-[10px] text-muted-foreground">{ROLE_LABEL[t.role]}</span>
            </span>
            {ws.id === t.id && <Check className="w-3.5 h-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            ws.team
              ? navigate({ to: "/teams/$teamId", params: { teamId: ws.team.id } })
              : navigate({ to: "/settings", search: { tab: "teams" } })
          }
          className="gap-2"
        >
          <Settings2 className="w-3.5 h-3.5" />
          {ws.team ? "Manage this team" : "Make or manage teams"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
