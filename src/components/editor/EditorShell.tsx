import React, { useEffect, useRef, useState } from "react";
import { Film, SlidersHorizontal, Sparkles, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";

const TIMELINE_HEIGHT_KEY = "stuccord.timelineHeight";

/** Keeps the timeline between 140px and 70% of the window. */
function clampTimelineHeight(h: number) {
  const max = typeof window === "undefined" ? 800 : window.innerHeight * 0.7;
  return Math.round(Math.max(140, Math.min(max, h)));
}

interface EditorShellProps {
  topBar: React.ReactNode;
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomPanel: React.ReactNode;
  mobileTab: "edit" | "media" | "ai";
  onMobileTabChange: (tab: "edit" | "media" | "ai") => void;
  /** Controls whether the right panel is visible on non-XL desktop (md–lg). Ignored on XL+. */
  showRightPanel?: boolean;
  /** Called when the user clicks the panel-toggle button on non-XL screens. */
  onToggleRightPanel?: () => void;
  className?: string;
}

export function EditorShell({
  topBar,
  leftPanel,
  centerPanel,
  rightPanel,
  bottomPanel,
  mobileTab,
  onMobileTabChange,
  showRightPanel = false,
  onToggleRightPanel,
  className,
}: EditorShellProps) {
  // Timeline height in px, or null to fit its tracks. Saved in this browser.
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(TIMELINE_HEIGHT_KEY));
      if (saved > 0) setTimelineHeight(clampTimelineHeight(saved));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const saveTimelineHeight = (h: number | null) => {
    setTimelineHeight(h);
    try {
      if (h == null) localStorage.removeItem(TIMELINE_HEIGHT_KEY);
      else localStorage.setItem(TIMELINE_HEIGHT_KEY, String(Math.round(h)));
    } catch {
      /* storage unavailable */
    }
  };
  const startTimelineResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = el.offsetHeight;
    let h = startH;
    const move = (ev: PointerEvent) => {
      h = clampTimelineHeight(startH - (ev.clientY - startY));
      setTimelineHeight(h);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (h !== startH) saveTimelineHeight(h);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={cn(
        // editor-scrollbars: thin dark scrollbars everywhere inside (styles.css).
        "editor-scrollbars h-screen w-screen flex flex-col bg-[#0A0B10] text-neutral-200 overflow-hidden select-none font-sans",
        className,
      )}
    >
      {/* 1. Top Bar */}
      {topBar}

      {/* 2. Middle Workspace (Left Library, Center Canvas, Right AI Panel) */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Panel (Media Library) */}
        <div
          className={cn(
            "w-full sm:w-72 lg:w-80 h-full shrink-0 z-20 transition-all duration-200",
            mobileTab === "media" ? "flex flex-col" : "hidden md:flex md:flex-col",
          )}
        >
          {leftPanel}
        </div>

        {/* Center Panel (Preview Canvas & Transport) */}
        <div
          className={cn(
            "flex-1 flex flex-col min-w-0 h-full relative z-10",
            mobileTab === "edit" ? "flex" : "hidden md:flex",
          )}
        >
          {centerPanel}
        </div>

        {/* Right Panel (AI Studio / Inspector) */}
        {rightPanel && (
          <div
            className={cn(
              "w-full sm:w-80 lg:w-[17rem] xl:w-80 h-full shrink-0 z-20 border-l border-white/[0.08] bg-[#0D0E16] transition-all duration-200",
              // Mobile: show in 'ai' tab. Desktop non-XL: controlled by showRightPanel. XL+: always visible.
              mobileTab === "ai"
                ? "flex flex-col"
                : showRightPanel
                  ? "hidden md:flex md:flex-col xl:flex xl:flex-col"
                  : "hidden xl:flex xl:flex-col",
            )}
          >
            {rightPanel}
          </div>
        )}

        {/* Right Panel Toggle — shown on md/lg only (XL always shows it) */}
        {rightPanel && onToggleRightPanel && (
          <button
            type="button"
            onClick={onToggleRightPanel}
            title={showRightPanel ? "Hide panel" : "Show AI / Inspector panel"}
            aria-label={showRightPanel ? "Hide right panel" : "Show right panel"}
            className={cn(
              "hidden md:flex xl:hidden absolute right-2 bottom-[calc(var(--timeline-h,19rem)+0.5rem)] z-30",
              "w-7 h-7 rounded-md items-center justify-center",
              "border border-white/[0.08] bg-[#0E0F17] text-neutral-400 hover:text-violet-400 hover:border-violet-500/40 hover:bg-violet-950/30 transition shadow-sm",
              showRightPanel && "text-violet-400 border-violet-500/30 bg-violet-950/20",
            )}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 3. Bottom Timeline: as tall as its tracks, or the height the user
          dragged it to (remembered). The preview gets the rest. */}
      <div
        ref={timelineRef}
        className={cn(
          "relative shrink-0 border-t border-white/[0.08] bg-[#0B0C13] flex flex-col z-20 min-h-0",
          timelineHeight == null && "max-h-[55vh]",
          mobileTab === "edit" ? "flex" : "hidden md:flex",
        )}
        style={timelineHeight != null ? { height: timelineHeight } : undefined}
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the timeline (double-click to fit its tracks)"
          title="Drag to resize · double-click to fit the tracks"
          onPointerDown={startTimelineResize}
          onDoubleClick={() => saveTimelineHeight(null)}
          className="hidden md:block absolute -top-1.5 inset-x-0 h-3 z-30 cursor-row-resize group touch-none"
        >
          <div className="mx-auto mt-[5px] h-[3px] w-12 rounded-full bg-white/10 group-hover:bg-violet-400/70 transition-colors" />
        </div>
        {bottomPanel}
      </div>

      {/* 4. Mobile Bottom Navigation (Visible only on small screens) */}
      <div className="md:hidden h-12 bg-[#0C0D15] border-t border-white/[0.08] flex items-center justify-around px-2 shrink-0 z-30">
        <button
          type="button"
          onClick={() => onMobileTabChange("media")}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg text-[10px] font-medium transition",
            mobileTab === "media"
              ? "text-violet-400 bg-violet-950/40"
              : "text-neutral-400 hover:text-neutral-200",
          )}
        >
          <Film className="w-4 h-4" />
          <span>Media</span>
        </button>

        <button
          type="button"
          onClick={() => onMobileTabChange("edit")}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg text-[10px] font-medium transition",
            mobileTab === "edit"
              ? "text-violet-400 bg-violet-950/40"
              : "text-neutral-400 hover:text-neutral-200",
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Timeline</span>
        </button>

        {rightPanel && (
          <button
            type="button"
            onClick={() => onMobileTabChange("ai")}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg text-[10px] font-medium transition",
              mobileTab === "ai"
                ? "text-violet-400 bg-violet-950/40"
                : "text-neutral-400 hover:text-neutral-200",
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span>AI Studio</span>
          </button>
        )}
      </div>
    </div>
  );
}
