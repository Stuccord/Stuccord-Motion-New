import React from "react";
import { Film, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditorShellProps {
  topBar: React.ReactNode;
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomPanel: React.ReactNode;
  mobileTab: "edit" | "media" | "ai";
  onMobileTabChange: (tab: "edit" | "media" | "ai") => void;
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
  className,
}: EditorShellProps) {
  return (
    <div
      className={cn(
        "h-screen w-screen flex flex-col bg-[#0A0B10] text-neutral-200 overflow-hidden select-none font-sans",
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
              "w-full sm:w-80 lg:w-96 h-full shrink-0 z-20 border-l border-white/[0.08] bg-[#0D0E16]",
              mobileTab === "ai" ? "flex flex-col" : "hidden xl:flex xl:flex-col",
            )}
          >
            {rightPanel}
          </div>
        )}
      </div>

      {/* 3. Bottom Timeline */}
      <div
        className={cn(
          "h-64 sm:h-72 md:h-80 shrink-0 border-t border-white/[0.08] bg-[#0B0C13] flex flex-col z-20 min-h-0",
          mobileTab === "edit" ? "flex" : "hidden md:flex",
        )}
      >
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
