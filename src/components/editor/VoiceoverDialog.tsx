// Voiceover: record your own voice in the browser, or type a script and get
// an AI voice. Either way it lands on the VO track at the playhead.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AudioLines, Loader2, Mic, Pause, Play, RotateCcw, Sparkles, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AI_VOICE_MAX_CHARS,
  getAiVoiceUsage,
  listAiVoices,
  type AiVoice,
} from "@/lib/voiceover.functions";

/** Longest recording (the file is kept as WAV, about 4 MB a minute). */
const MAX_RECORD_MS = 5 * 60 * 1000;
const WAV_RATE = 32000;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A recording as a mono 16-bit WAV: it has an exact length and seeks
 * precisely in every browser and in the export (browser recordings don't).
 */
async function toWav(blob: Blob): Promise<{ wav: Blob; ms: number }> {
  const decoder = new AudioContext();
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer()).finally(() => {
    void decoder.close().catch(() => {});
  });
  const frames = Math.max(1, Math.ceil(decoded.duration * WAV_RATE));
  const ctx = new OfflineAudioContext(1, frames, WAV_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const mono = (await ctx.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + mono.length * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + mono.length * 2, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, WAV_RATE, true);
  v.setUint32(28, WAV_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const x = Math.max(-1, Math.min(1, mono[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return {
    wav: new Blob([buf], { type: "audio/wav" }),
    ms: Math.round((mono.length / WAV_RATE) * 1000),
  };
}

type Recorded = { wav: Blob; ms: number; url: string };

export function VoiceoverDialog({
  open,
  onOpenChange,
  startMs,
  onAddRecording,
  onMakeAi,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where it will start on the timeline (the playhead). */
  startMs: number;
  /** Saves a recording and puts it on the VO track. */
  onAddRecording: (wav: Blob, lengthMs: number) => Promise<void>;
  /** Makes an AI voiceover and puts it on the VO track. */
  onMakeAi: (text: string, voice: AiVoice) => Promise<void>;
}) {
  const [tab, setTab] = useState<"record" | "ai">("record");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-[#0f0f18] border-white/10 text-neutral-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-50">
            <AudioLines className="w-4 h-4 text-sky-400" />
            Add a voiceover
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            It goes on the VO track at {clock(startMs)} (the playhead). Your clips and music get
            quieter while it plays.
          </DialogDescription>
        </DialogHeader>
        <div role="tablist" className="flex rounded-md bg-white/[0.04] p-0.5 gap-0.5">
          {(
            [
              ["record", "Record my voice", Mic],
              ["ai", "AI voice", Sparkles],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 h-8 rounded text-[12px] font-medium flex items-center justify-center gap-1.5",
                tab === id
                  ? "bg-sky-600/80 text-white"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]",
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        {open &&
          (tab === "record" ? (
            <RecordTab onAdd={onAddRecording} onDone={() => onOpenChange(false)} />
          ) : (
            <AiTab onMake={onMakeAi} onDone={() => onOpenChange(false)} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function RecordTab({
  onAdd,
  onDone,
}: {
  onAdd: (wav: Blob, lengthMs: number) => Promise<void>;
  onDone: () => void;
}) {
  const [state, setState] = useState<"idle" | "asking" | "recording" | "processing" | "done">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<Recorded | null>(null);
  const [saving, setSaving] = useState(false);
  const rec = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    ctx: AudioContext;
    timer: ReturnType<typeof setInterval>;
    raf: number;
  } | null>(null);

  const cleanUp = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => {});
    rec.current = null;
  };
  useEffect(
    () => () => {
      if (rec.current?.recorder.state === "recording") rec.current.recorder.stop();
      cleanUp();
    },
    [],
  );
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record sound. Try Chrome, Edge, Firefox or Safari.");
      return;
    }
    setState("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setState("idle");
      setError("The microphone wasn't allowed. Allow it in the address bar, then try again.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = async () => {
      cleanUp();
      setState("processing");
      try {
        const { wav, ms } = await toWav(new Blob(chunks, { type: recorder.mimeType }));
        if (ms < 300) throw new Error("short");
        setTake({ wav, ms, url: URL.createObjectURL(wav) });
        setState("done");
      } catch {
        setState("idle");
        setError("Nothing was recorded. Check your microphone and try again.");
      }
    };
    // A level meter, so you can see the mic is hearing you.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const meter = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const x of data) peak = Math.max(peak, Math.abs(x - 128) / 128);
      setLevel(peak);
      if (rec.current) rec.current.raf = requestAnimationFrame(meter);
    };
    const t0 = performance.now();
    const timer = setInterval(() => {
      const ms = performance.now() - t0;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS && recorder.state === "recording") recorder.stop();
    }, 200);
    rec.current = { recorder, stream, ctx, timer, raf: requestAnimationFrame(meter) };
    setElapsed(0);
    setTake(null);
    recorder.start(250);
    setState("recording");
  };
  const stop = () => {
    if (rec.current?.recorder.state === "recording") rec.current.recorder.stop();
  };

  const add = async () => {
    if (!take) return;
    setSaving(true);
    try {
      await onAdd(take.wav, take.ms);
      onDone();
    } catch {
      // The editor shows what went wrong.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="rounded-xl border border-white/10 bg-black/30 p-5 flex flex-col items-center gap-3">
        {state === "recording" ? (
          <>
            <div className="font-mono text-2xl tabular-nums text-rose-300">{clock(elapsed)}</div>
            <div className="w-full h-2 rounded bg-white/5 overflow-hidden" aria-hidden>
              <div
                className="h-full bg-rose-400 transition-[width] duration-75"
                style={{ width: `${Math.min(100, level * 140)}%` }}
              />
            </div>
            <Button
              onClick={stop}
              className="bg-rose-600 hover:bg-rose-500 text-white"
              aria-label="Stop recording"
            >
              <Square className="w-3.5 h-3.5 mr-1.5 fill-current" /> Stop
            </Button>
            <div className="text-[11px] text-neutral-500">Up to {clock(MAX_RECORD_MS)}</div>
          </>
        ) : state === "processing" ? (
          <div className="flex items-center gap-2 text-sm text-neutral-300 py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Getting it ready…
          </div>
        ) : take ? (
          <>
            <TakePlayer url={take.url} ms={take.ms} />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="text-neutral-300 hover:text-white hover:bg-white/5"
                onClick={() => void start()}
                disabled={saving}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Record again
              </Button>
              <Button
                className="bg-sky-600 hover:bg-sky-500 text-white"
                onClick={() => void add()}
                disabled={saving}
              >
                {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Add to the timeline
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              onClick={() => void start()}
              disabled={state === "asking"}
              className="h-14 w-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white p-0"
              aria-label="Start recording"
            >
              {state === "asking" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </Button>
            <div className="text-[12px] text-neutral-400">
              {state === "asking" ? "Allow the microphone…" : "Press to start recording"}
            </div>
          </>
        )}
      </div>
      {error && <p className="text-[12px] text-amber-300">{error}</p>}
      <p className="text-[11px] text-neutral-500">
        Tip: pause the video while you record, and use headphones so the mic doesn&apos;t pick it
        up. Recording your own voice has no limit.
      </p>
    </div>
  );
}

function TakePlayer({ url, ms }: { url: string; ms: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <audio
        ref={audio}
        src={url}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <Button
        size="icon"
        variant="outline"
        className="rounded-full bg-white/5 border-white/10 hover:bg-white/10 text-neutral-100"
        aria-label={playing ? "Pause the recording" : "Play the recording"}
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
      <span className="font-mono text-sm tabular-nums text-neutral-300">{clock(ms)}</span>
    </div>
  );
}

function AiTab({
  onMake,
  onDone,
}: {
  onMake: (text: string, voice: AiVoice) => Promise<void>;
  onDone: () => void;
}) {
  const fetchVoices = useServerFn(listAiVoices);
  const fetchUsage = useServerFn(getAiVoiceUsage);
  const voices = useQuery({
    queryKey: ["ai-voices"],
    queryFn: () => fetchVoices(),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const usage = useQuery({ queryKey: ["ai-voice-usage"], queryFn: () => fetchUsage() });
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [making, setMaking] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewEl = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => previewEl.current?.pause(), []);

  const list = voices.data?.voices ?? [];
  const voice = list.find((v) => v.voice_id === voiceId) ?? list[0] ?? null;
  const left = usage.data ? Math.max(0, usage.data.limit - usage.data.used) : null;
  const chars = text.trim().length;
  const tooLong = left != null && chars > left;

  const preview = (v: AiVoice) => {
    previewEl.current?.pause();
    if (previewing === v.voice_id || !v.preview_url) {
      setPreviewing(null);
      return;
    }
    const a = new Audio(v.preview_url);
    a.onended = () => setPreviewing(null);
    previewEl.current = a;
    setPreviewing(v.voice_id);
    void a.play().catch(() => setPreviewing(null));
  };

  const make = async () => {
    if (!voice || chars === 0 || tooLong) return;
    setMaking(true);
    try {
      await onMake(text.trim(), voice);
      void usage.refetch();
      onDone();
    } catch {
      // The editor shows what went wrong.
      void usage.refetch();
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="space-y-3 pt-1">
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">Voice</div>
        {voices.isLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-neutral-400 h-24">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading voices…
          </div>
        ) : voices.error ? (
          <p className="text-[12px] text-amber-300">
            {voices.error instanceof Error ? voices.error.message : "Couldn't load the voices"}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Voice"
            className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1"
          >
            {list.map((v) => {
              const on = voice?.voice_id === v.voice_id;
              const hint = [v.labels.gender, v.labels.accent, v.labels.age]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={v.voice_id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1.5",
                    on
                      ? "border-sky-400/60 bg-sky-500/10"
                      : "border-white/10 hover:border-white/20",
                  )}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setVoiceId(v.voice_id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-[12px] font-medium truncate">{v.name}</div>
                    {hint && <div className="text-[10px] text-neutral-500 truncate">{hint}</div>}
                  </button>
                  {v.preview_url && (
                    <button
                      type="button"
                      onClick={() => preview(v)}
                      aria-label={`Hear ${v.name}`}
                      className="w-6 h-6 grid place-items-center rounded text-neutral-400 hover:text-white hover:bg-white/10 shrink-0"
                    >
                      {previewing === v.voice_id ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] uppercase tracking-wider text-neutral-500">
          <span>Script</span>
          <span className={cn("normal-case tracking-normal", tooLong && "text-amber-300")}>
            {chars} / {Math.min(AI_VOICE_MAX_CHARS, left ?? AI_VOICE_MAX_CHARS)}
          </span>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, AI_VOICE_MAX_CHARS))}
          placeholder="What should the voice say?"
          rows={5}
          className="bg-white/5 border-white/10 text-sm resize-none"
        />
        <p className="text-[11px] text-neutral-500">
          {usage.data
            ? `${left!.toLocaleString()} of ${usage.data.limit.toLocaleString()} AI voice characters left this month (resets on the 1st).`
            : "Checking this month's AI voice allowance…"}
          {tooLong && " Shorten the script, or record it yourself."}
        </p>
      </div>

      <Button
        className="w-full bg-sky-600 hover:bg-sky-500 text-white"
        disabled={!voice || chars === 0 || tooLong || making || left == null}
        onClick={() => void make()}
      >
        {making ? (
          <>
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Making the voiceover…
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-1.5" /> Make voiceover
          </>
        )}
      </Button>
    </div>
  );
}
