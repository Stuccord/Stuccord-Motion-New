// The project's Motion Explainer plan in the editor: read with the AI
// Director's query (same key, so both stay in step), changed by hand right
// away on screen, and saved shortly after (the last change wins). If the AI
// replans meanwhile, unsaved hand changes give way to the new plan.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { emptyPlan, type MotionPlan } from "@/lib/motion-plan";
import { getMotionPlan, saveMotionPlan, type MotionPlanState } from "@/lib/motion-plan.functions";

/** Wait this long after the last change before saving (ms). */
const SAVE_AFTER_MS = 700;

export function useMotionPlan(projectId: string) {
  const qc = useQueryClient();
  const key = ["motion-plan", projectId];
  const fetchPlan = useServerFn(getMotionPlan);
  const saveFn = useServerFn(saveMotionPlan);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchPlan({ data: { project_id: projectId } }),
    enabled: typeof window !== "undefined",
  });
  const saved = query.data?.plan ?? null;

  // Hand changes not saved yet (undefined: none).
  const [draft, setDraft] = useState<MotionPlan | undefined>(undefined);
  const plan = draft !== undefined ? draft : saved;

  // A new plan from the AI (or Undo) replaces unsaved changes to an old one.
  const savedId = saved?.created_at ?? null;
  useEffect(() => {
    setDraft((d) => (d && d.created_at !== savedId && savedId !== null ? undefined : d));
  }, [savedId]);

  const save = useMutation({
    mutationFn: (next: MotionPlan) => saveFn({ data: { project_id: projectId, plan: next } }),
    onSuccess: (r, sent) => {
      qc.setQueryData<MotionPlanState>(key, (old) => (old ? { ...old, plan: r.plan } : old));
      setDraft((d) => (d === sent ? undefined : d));
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Couldn't save the graphics");
      setDraft(undefined);
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const pending = useRef<MotionPlan | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      save.mutate(pending.current);
      pending.current = null;
    }
  }, [save]);
  // Save what's waiting when leaving the editor.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // The latest plan, so changes made in quick succession build on each other.
  const latest = useRef(plan);
  latest.current = plan;

  /** Changes the plan (starting an empty one if there's none) and saves it soon. */
  const update = useCallback(
    (change: (p: MotionPlan) => MotionPlan) => {
      const next = change(latest.current ?? emptyPlan());
      latest.current = next;
      setDraft(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    [flush],
  );

  return {
    plan,
    state: query.data,
    canEdit: query.data?.canEdit ?? false,
    update,
    saving: save.isPending || draft !== undefined,
  };
}
