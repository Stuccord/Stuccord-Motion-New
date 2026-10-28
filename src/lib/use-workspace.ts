// The workspace you're working in: "personal" or a team's id. Remembered in
// this browser and shared by every page (the switcher is in the sidebar).
// A team you've left (or that was deleted) falls back to personal.

import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyTeams, type TeamSummary } from "@/lib/teams.functions";
import { PERSONAL, type WorkspaceId } from "@/lib/workspace";

const KEY = "stuccord.workspace";
const listeners = new Set<() => void>();

function read(): WorkspaceId {
  try {
    return window.localStorage.getItem(KEY) || PERSONAL;
  } catch {
    return PERSONAL;
  }
}

export function setWorkspace(id: WorkspaceId) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Private windows etc.: it just isn't remembered.
  }
  memory = id;
  for (const l of listeners) l();
}

let memory: WorkspaceId | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      memory = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => memory ?? (memory = read());

export type CurrentWorkspace = {
  /** "personal" or the team's id (valid: falls back to personal). */
  id: WorkspaceId;
  team: TeamSummary | null;
  teams: TeamSummary[];
  /** Can make and change projects here (not a Viewer). */
  canEdit: boolean;
  loading: boolean;
};

export function useWorkspace(): CurrentWorkspace {
  const stored = useSyncExternalStore(subscribe, snapshot, () => PERSONAL);
  const fetchTeams = useServerFn(listMyTeams);
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => fetchTeams(),
    retry: false,
    staleTime: 60_000,
  });
  return useMemo(() => {
    const list = teams.data ?? [];
    const team = stored === PERSONAL ? null : (list.find((t) => t.id === stored) ?? null);
    // Until the teams have loaded, keep the stored team (so lists don't flash
    // personal first); once loaded, an unknown team means personal.
    const known = !!team || stored === PERSONAL || (!teams.isSuccess && !teams.isError);
    const id = known ? stored : PERSONAL;
    return {
      id,
      team: id === PERSONAL ? null : team,
      teams: list,
      canEdit: id === PERSONAL || (team ? team.role !== "viewer" : false),
      loading: stored !== PERSONAL && teams.isLoading,
    };
  }, [stored, teams.data, teams.isSuccess, teams.isError, teams.isLoading]);
}
