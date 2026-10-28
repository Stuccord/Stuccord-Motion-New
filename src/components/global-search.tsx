// Search in the top bar (also ⌘K / Ctrl+K): your projects, your uploaded
// files, templates and the app's pages, in one list. Enter or a click opens
// the result.

import { useWorkspace } from "@/lib/use-workspace";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  CreditCard,
  Film,
  FolderOpen,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Music2,
  Plus,
  Search,
  Settings,
  Wand2,
} from "lucide-react";
import { listAllClips, listProjects } from "@/lib/projects.functions";
import { TEMPLATES } from "@/lib/templates.data";
import { isAudioRole, isImageFilename } from "@/lib/media-kind";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** A result matches when every word typed appears in it (not scattered letters). */
function matchWords(value: string, search: string) {
  const text = value.toLowerCase();
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w)) ? 1 : 0;
}

const PAGES = [
  { label: "Home", to: "/dashboard", icon: Home, words: "dashboard start" },
  { label: "Projects", to: "/projects", icon: Film, words: "videos shorts" },
  { label: "New project", to: "/projects/new", icon: Plus, words: "create start upload" },
  { label: "Templates", to: "/templates", icon: Wand2, words: "formats presets" },
  { label: "Assets", to: "/assets", icon: FolderOpen, words: "files clips uploads library" },
  { label: "Analytics", to: "/analytics", icon: BarChart3, words: "stats usage renders" },
  { label: "Settings", to: "/settings", icon: Settings, words: "profile account notifications" },
  { label: "Billing", to: "/billing", icon: CreditCard, words: "plan usage exports limit" },
  { label: "Help & docs", to: "/help", icon: HelpCircle, words: "support guides faq shortcuts" },
] as const;

export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // ⌘K / Ctrl+K opens and closes it from anywhere on these pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Loaded when it opens (shared with the Projects and Assets pages).
  const fetchProjects = useServerFn(listProjects);
  const fetchClips = useServerFn(listAllClips);
  const ws = useWorkspace();
  const projects = useQuery({
    queryKey: ["projects", ws.id],
    queryFn: () => fetchProjects({ data: { workspace: ws.id } }),
    enabled: open,
    staleTime: 30_000,
  });
  const clips = useQuery({
    queryKey: ["all-clips", ws.id],
    queryFn: () => fetchClips({ data: { workspace: ws.id } }),
    enabled: open,
    staleTime: 30_000,
  });

  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:flex relative w-full max-w-md h-9 items-center pl-8 pr-16 text-[13px] text-muted-foreground bg-surface border border-border rounded-lg hover:border-primary/40 transition-colors text-left"
        aria-label="Search projects, files, templates and pages"
      >
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" />
        <span className="truncate">Search projects, files, templates…</span>
        <span className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-0.5 text-[10px] font-mono">
          <kbd className="px-1.5 py-0.5 border border-border rounded bg-card">
            {isMac ? "⌘" : "Ctrl"}
          </kbd>
          <kbd className="px-1.5 py-0.5 border border-border rounded bg-card">K</kbd>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden p-2 rounded-lg hover:bg-surface text-muted-foreground"
        aria-label="Search"
      >
        <Search className="w-4 h-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command
            filter={matchWords}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
          >
            <CommandInput placeholder="Search projects, files, templates and pages…" />
            <CommandList>
              <CommandEmpty>
                {projects.isLoading || clips.isLoading ? "Searching…" : "Nothing found."}
              </CommandEmpty>

              {(projects.data?.length ?? 0) > 0 && (
                <CommandGroup heading="Projects">
                  {projects.data!.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`project ${p.title} ${p.id}`}
                      onSelect={() =>
                        go(() =>
                          navigate({ to: "/projects/$projectId", params: { projectId: p.id } }),
                        )
                      }
                    >
                      {p.thumbnail_signed_url ? (
                        <img
                          src={p.thumbnail_signed_url}
                          alt=""
                          className="w-5 h-5 rounded object-cover"
                        />
                      ) : (
                        <Film />
                      )}
                      <span className="truncate">{p.title}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {p.aspect_ratio}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {(clips.data?.length ?? 0) > 0 && (
                <CommandGroup heading="Files">
                  {clips.data!.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`file ${c.filename} ${c.project_title} ${c.id}`}
                      onSelect={() =>
                        go(() =>
                          navigate({
                            to: "/projects/$projectId",
                            params: { projectId: c.project_id },
                          }),
                        )
                      }
                    >
                      {c.thumbnail_url ? (
                        <img
                          src={c.thumbnail_url}
                          alt=""
                          className="w-5 h-5 rounded object-cover"
                        />
                      ) : isAudioRole(c.role) ? (
                        <Music2 />
                      ) : isImageFilename(c.filename) ? (
                        <ImageIcon />
                      ) : (
                        <Film />
                      )}
                      <span className="truncate">{c.filename}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground truncate max-w-[40%]">
                        {c.project_title}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              <CommandGroup heading="Templates">
                {TEMPLATES.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`template ${t.title} ${t.cat} ${t.desc}`}
                    onSelect={() =>
                      go(() =>
                        navigate({ to: "/projects/new", search: { template: t.id } as never }),
                      )
                    }
                  >
                    <t.icon />
                    <span className="truncate">{t.title}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{t.ratio}</span>
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandGroup heading="Pages">
                {PAGES.map((p) => (
                  <CommandItem
                    key={p.to}
                    value={`page ${p.label} ${p.words}`}
                    onSelect={() => go(() => navigate({ to: p.to }))}
                  >
                    <p.icon />
                    <span>{p.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
