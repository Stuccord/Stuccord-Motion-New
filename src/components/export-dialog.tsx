import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Loader2, Film, Music2, Gauge } from "lucide-react";

export type ExportSettings = {
  resolution: "1080p" | "4k";
  bitrateMbps: number;
  audioMix: "balanced" | "voice" | "music" | "voice_only";
};

const RES_LABEL: Record<ExportSettings["resolution"], string> = {
  "1080p": "1080p — Full HD",
  "4k": "4K — Ultra HD",
};

const DEFAULT_BITRATE: Record<ExportSettings["resolution"], number> = {
  "1080p": 12,
  "4k": 45,
};

const MIX_LABEL: Record<ExportSettings["audioMix"], string> = {
  balanced: "Balanced — VO + music",
  voice: "Voice-forward — music ducked",
  music: "Music-forward — quieter VO",
  voice_only: "Voice only — no music",
};

export function ExportDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
  defaultFileName,
  progressPct,
  progressMsg,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (settings: ExportSettings) => void;
  loading?: boolean;
  defaultFileName: string;
  progressPct?: number;
  progressMsg?: string | null;
}) {
  const [resolution, setResolution] = useState<ExportSettings["resolution"]>("1080p");
  const [bitrate, setBitrate] = useState<number>(DEFAULT_BITRATE["1080p"]);
  const [audioMix, setAudioMix] = useState<ExportSettings["audioMix"]>("balanced");

  function updateResolution(next: ExportSettings["resolution"]) {
    setResolution(next);
    setBitrate(DEFAULT_BITRATE[next]);
  }

  const min = resolution === "4k" ? 20 : 6;
  const max = resolution === "4k" ? 80 : 25;
  const sizeEstimate = estimateSizeMb(bitrate, 30); // assume 30s default

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-[#0f0f18] border-white/10 text-neutral-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-50">
            <Download className="w-4 h-4 text-cyan-400" />
            Export final video
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            {defaultFileName}.mp4 · H.264 · AAC
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Resolution */}
          <div className="space-y-2.5">
            <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-400">
              <Film className="w-3.5 h-3.5" /> Resolution
            </Label>
            <RadioGroup
              value={resolution}
              onValueChange={(v) => updateResolution(v as ExportSettings["resolution"])}
              className="grid grid-cols-2 gap-2"
            >
              {(["1080p", "4k"] as const).map((r) => (
                <label
                  key={r}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                    resolution === r
                      ? "border-cyan-400/60 bg-cyan-400/10"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <RadioGroupItem value={r} className="border-white/30" />
                  <div className="text-sm">
                    <div className="font-medium">{RES_LABEL[r]}</div>
                    <div className="text-[11px] text-neutral-500">
                      {r === "1080p" ? "1920×1080" : "3840×2160"}
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* Bitrate */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-400">
                <Gauge className="w-3.5 h-3.5" /> Bitrate
              </Label>
              <span className="text-xs font-mono text-cyan-300">
                {bitrate} Mbps · ~{sizeEstimate} MB/min
              </span>
            </div>
            <Slider
              min={min}
              max={max}
              step={1}
              value={[bitrate]}
              onValueChange={(v) => setBitrate(v[0])}
            />
            <div className="flex justify-between text-[10px] text-neutral-500">
              <span>Smaller file</span>
              <span>Higher quality</span>
            </div>
          </div>

          {/* Audio mix */}
          <div className="space-y-2.5">
            <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-400">
              <Music2 className="w-3.5 h-3.5" /> Audio mix
            </Label>
            <Select value={audioMix} onValueChange={(v) => setAudioMix(v as ExportSettings["audioMix"])}>
              <SelectTrigger className="bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MIX_LABEL) as ExportSettings["audioMix"][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {MIX_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-col sm:items-stretch">
          {loading && (
            <div className="w-full">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 mb-1">
                <span>{progressMsg ?? "Rendering"}</span>
                <span>{Math.max(0, Math.min(100, progressPct ?? 0))}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-all"
                  style={{ width: `${Math.max(2, Math.min(100, progressPct ?? 0))}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm({ resolution, bitrateMbps: bitrate, audioMix })}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-neutral-950 font-semibold"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {loading ? "Rendering…" : "Render & download"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function estimateSizeMb(mbps: number, seconds: number) {
  // (Mbps * seconds) / 8 = MB
  return Math.round((mbps * seconds) / 8);
}
