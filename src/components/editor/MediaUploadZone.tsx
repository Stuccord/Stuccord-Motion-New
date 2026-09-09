import React, { useRef, useState } from "react";
import { UploadCloud, Loader2, Plus, Film } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaUploadZoneProps {
  onUpload: (files: FileList | File[]) => void;
  isUploading?: boolean;
  compact?: boolean;
  className?: string;
  accept?: string;
}

export function MediaUploadZone({
  onUpload,
  isUploading = false,
  compact = false,
  className,
  accept = "video/mp4,video/quicktime,video/webm",
}: MediaUploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isUploading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
      // Reset value so identical file can be re-selected if needed
      e.target.value = "";
    }
  };

  if (compact) {
    return (
      <div className={className}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading}
          aria-label="Upload video clips"
        />
        <button
          type="button"
          onClick={handleClick}
          disabled={isUploading}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer border border-dashed",
            "border-violet-500/30 bg-violet-950/10 text-violet-300 hover:bg-violet-900/20 hover:border-violet-400/50",
            "focus:outline-none focus:ring-2 focus:ring-violet-500/40",
            isUploading && "opacity-50 cursor-not-allowed",
          )}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
              <span>Uploading to cloud...</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5 text-violet-400" />
              <span>Import Video Clips</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={cn(
        "relative rounded-xl border border-dashed transition-all p-5 text-center cursor-pointer select-none group",
        isDragOver
          ? "border-violet-500 bg-violet-950/25 ring-2 ring-violet-500/30 scale-[0.99]"
          : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
        isUploading && "pointer-events-none opacity-60",
        className,
      )}
      role="button"
      tabIndex={0}
      aria-label="Drop or select video files to upload"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        disabled={isUploading}
      />

      <div className="flex flex-col items-center justify-center gap-2.5">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-200",
            isDragOver
              ? "bg-violet-600/30 text-violet-300 scale-110"
              : "bg-white/[0.05] text-neutral-400 group-hover:text-violet-300 group-hover:bg-violet-900/20",
          )}
        >
          {isUploading ? (
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          ) : (
            <UploadCloud className="w-5 h-5" />
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-neutral-200 group-hover:text-white transition-colors">
            {isUploading ? "Uploading clips..." : "Click or drag videos here"}
          </p>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            MP4, MOV, WebM · Up to 500 MB
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono">
          <Film className="w-3 h-3 text-violet-400" />
          <span>Auto-assigned to A-Roll &amp; B-Roll</span>
        </div>
      </div>
    </div>
  );
}
