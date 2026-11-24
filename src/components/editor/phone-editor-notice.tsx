// The editor on a phone: like Higgsfield's studio, it needs a bigger
// screen, so phones get this instead: the project, a way to its finished
// video (the make page: watch, download, change the look, redo the
// graphics) and a note to open the editor on a computer or tablet.

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Laptop, PlayCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getProject } from "@/lib/projects.functions";

/** Below this width the editor shows the phone notice (tablets get the editor). */
const PHONE_MAX = 767;

/** True on a phone-sized screen; follows the window as it changes. */
export function usePhoneScreen(): boolean {
  const query = `(max-width: ${PHONE_MAX}px)`;
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setPhone(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return phone;
}

export function PhoneEditorNotice({ projectId }: { projectId: string }) {
  const fetchProject = useServerFn(getProject);
  const { data } = useQuery({
    queryKey: ["project", projectId, "phone-notice"],
    queryFn: () => fetchProject({ data: { id: projectId } }),
    staleTime: 30_000,
  });
  const title = data?.project.title ?? "Your project";
  const ready = data?.project.status === "ready" && !!data.project.output_path;

  return (
    <AppShell title={title}>
      <div className="mx-auto max-w-md space-y-4" data-phone-editor-notice>
        <div className="rounded-3xl border border-border bg-card p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.06] text-foreground/70">
            <Laptop className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-bold tracking-tight">
            The editor needs a bigger screen
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Open this project on a computer or tablet to change clips, graphics and captions. On
            your phone you can watch and download the video, change its look or redo the graphics.
          </p>
        </div>

        <Link to="/projects/$projectId/make" params={{ projectId }} className="block">
          <Button size="lg" className="w-full rounded-full">
            <PlayCircle /> {ready ? "See your video" : "See how it's going"}
          </Button>
        </Link>
        <Link to="/projects" className="block">
          <Button size="lg" variant="outline" className="w-full rounded-full">
            <ArrowLeft /> All projects
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
