import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2, Sparkles, Undo2, Redo2, Film, Smartphone, Monitor, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AspectRatio } from "./types";

interface EditorTopBarProps {
  title: string;
  onTitleChange: (newTitle: string) => void;
  isSaving?: boolean;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onOpenRender: () => void;
  isRenderDisabled?: boolean;
  clipCount: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function EditorTopBar({
  title,
  onTitleChange,
  isSaving = false,
  aspectRatio,
  onAspectRatioChange,
  onOpenRender,
  isRenderDisabled = false,
  clipCount,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: EditorTopBarProps) {
  const [localTitle, setLocalTitle] = useState(title);

  useEffect(() => {
    setLocalTitle(title);
  }, [title]);

  const handleBlur = () => {
    const trimmed = localTitle.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    } else {
      setLocalTitle(title);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <header className="h-14 border-b border-white/[0.08] bg-[#0E0F17] px-4 flex items-center justify-between gap-3 select-none shrink-0 z-30">
        {/* Left Section: Back, Title, Save status */}
        <div className="flex items-center gap-3 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/dashboard"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition"
                aria-label="Back to Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back to Dashboard</TooltipContent>
          </Tooltip>

          <div className="h-4 w-px bg-white/[0.08]" />

          {/* Editable Project Title */}
          <div className="flex items-center gap-2 min-w-0 max-w-[280px] sm:max-w-md">
            <input
              type="text"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="bg-transparent text-sm font-semibold text-neutral-100 placeholder:text-neutral-500 rounded px-1.5 py-0.5 hover:bg-white/[0.04] focus:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-violet-500/50 truncate w-full transition"
              placeholder="Untitled Project"
              aria-label="Project Title"
            />

            {/* Save indicator */}
            <div className="flex items-center gap-1 shrink-0 text-[11px] text-neutral-500 font-mono">
              {isSaving ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                  <span className="hidden sm:inline">Saving</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
                  <span className="hidden sm:inline">Saved</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center Section: History & Aspect Ratio */}
        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="hidden md:flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-lg p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo || !onUndo}
                  className="w-7 h-7 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Undo"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{canUndo ? "Undo (Ctrl+Z)" : "Undo"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onRedo}
                  disabled={!canRedo || !onRedo}
                  className="w-7 h-7 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Redo"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{canRedo ? "Redo (Ctrl+Y)" : "Redo"}</TooltipContent>
            </Tooltip>
          </div>

          {/* Aspect Ratio Picker */}
          <Select
            value={aspectRatio}
            onValueChange={(val) => onAspectRatioChange(val as AspectRatio)}
          >
            <SelectTrigger
              className="h-8 bg-white/[0.04] border-white/[0.08] text-neutral-200 text-xs font-medium px-2.5 min-w-[100px] hover:bg-white/[0.08] transition focus:ring-1 focus:ring-violet-500/50"
              aria-label="Select Aspect Ratio"
            >
              <div className="flex items-center gap-1.5">
                {aspectRatio === "9:16" && <Smartphone className="w-3.5 h-3.5 text-violet-400" />}
                {aspectRatio === "16:9" && <Monitor className="w-3.5 h-3.5 text-cyan-400" />}
                {aspectRatio === "1:1" && <Square className="w-3.5 h-3.5 text-pink-400" />}
                <span>{aspectRatio}</span>
              </div>
            </SelectTrigger>
            <SelectContent className="bg-[#151622] border-white/10 text-neutral-200 text-xs">
              <SelectItem value="9:16">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-3.5 h-3.5 text-violet-400" />
                  <span>9:16 · Reels / Shorts</span>
                </div>
              </SelectItem>
              <SelectItem value="16:9">
                <div className="flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5 text-cyan-400" />
                  <span>16:9 · Landscape / YT</span>
                </div>
              </SelectItem>
              <SelectItem value="1:1">
                <div className="flex items-center gap-2">
                  <Square className="w-3.5 h-3.5 text-pink-400" />
                  <span>1:1 · Square Feed</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Right Section: Primary Action (Render Video) */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onOpenRender}
                disabled={isRenderDisabled || clipCount === 0}
                className="h-9 px-4 bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-500 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-lg shadow-lg shadow-violet-900/30 border border-violet-400/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-violet-200 animate-pulse" />
                Render Video
              </Button>
            </TooltipTrigger>
            {clipCount === 0 && (
              <TooltipContent side="bottom">Upload at least one clip to render</TooltipContent>
            )}
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
