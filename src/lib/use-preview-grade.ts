// The editor's side of the preview grade (preview-grade.functions.ts):
// asked for a moment after what it depends on settles (the main clips and
// their trims, the look, the LUT), and kept until a new one comes, so the
// picture doesn't flick back to the rough CSS look in between.

import { useEffect, useState } from "react";
import { getPreviewGrade, type PreviewGradeRequest } from "@/lib/preview-grade.functions";
import { gradeGlSupported, gradeTableFrom, type GradeTable } from "@/lib/grade-gl";

/** Wait after a change before asking (editing settles). */
const SETTLE_MS = 1200;

export type { PreviewGradeRequest };

export function usePreviewGrade(request: PreviewGradeRequest | null): GradeTable | null {
  const [table, setTable] = useState<GradeTable | null>(null);
  const key = request ? JSON.stringify(request) : "";
  useEffect(() => {
    if (!key || typeof window === "undefined" || !gradeGlSupported()) {
      setTable(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const g = await getPreviewGrade({ data: JSON.parse(key) as PreviewGradeRequest });
        if (!alive) return;
        // None (the worker couldn't): the rough CSS look shows.
        setTable(g ? gradeTableFrom(g.size, g.table, key) : null);
      } catch (e) {
        console.warn("[preview] Couldn't get the preview grade:", e);
      }
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key]);
  return table;
}
