import React, { useMemo, useState } from "react";
import { Captions, Loader2, Plus, Trash2, Check, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  groupIntoPhrases,
  placeTranscripts,
  toSourceMs,
  type CaptionSegment,
  type TimelineWord,
  type TranscriptWord,
} from "@/lib/captions";
import { formatTimecode } from "./PlaybackControls";

export interface CaptionsPanelProps {
  /** Main-track clips in timeline order (the clips whose voice is captioned). */
  segments: CaptionSegment[];
  /** Saved words per source file (storage path), in source-file time. */
  transcripts: Map<string, TranscriptWord[]>;
  isLoading: boolean;
  loadError?: string | null;
  captionsEnabled: boolean;
  /** Timeline playhead, to highlight the phrase being spoken. */
  currentTimeMs: number;
  onSeek: (word: TimelineWord) => void;
  /** Saves a source file's full word list (source-file time). */
  onSaveWords: (storagePath: string, words: TranscriptWord[]) => Promise<void>;
  isSaving: boolean;
}

/** Word being edited: an existing word, or a new one to insert after `after`. */
type Draft =
  | { mode: "edit"; word: TimelineWord; text: string; start: string; end: string }
  | { mode: "add"; after: TimelineWord; text: string; start: string; end: string };

const secs = (ms: number) => (ms / 1000).toFixed(2);

export function CaptionsPanel({
  segments,
  transcripts,
  isLoading,
  loadError,
  captionsEnabled,
  currentTimeMs,
  onSeek,
  onSaveWords,
  isSaving,
}: CaptionsPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const words = useMemo(() => placeTranscripts(segments, transcripts), [segments, transcripts]);
  const phrases = useMemo(() => groupIntoPhrases(words), [words]);
  const untranscribed = useMemo(
    () =>
      new Set(segments.filter((s) => !transcripts.has(s.storagePath)).map((s) => s.storagePath)),
    [segments, transcripts],
  );

  function openEdit(word: TimelineWord) {
    setDraftError(null);
    setDraft({
      mode: "edit",
      word,
      text: word.text,
      start: secs(word.startMs),
      end: secs(word.endMs),
    });
  }

  function openAdd(after: TimelineWord) {
    const next = words[words.findIndex((w) => w.key === after.key) + 1];
    const seg = segments.find((s) => s.clipId === after.clipId);
    const clipEnd = seg ? seg.offsetMs + seg.durationMs : after.endMs + 400;
    const start = Math.min(after.endMs, clipEnd - 1);
    const limit = next && next.clipId === after.clipId ? next.startMs : clipEnd;
    const end = Math.max(start + 1, Math.min(start + 400, limit));
    setDraftError(null);
    setDraft({ mode: "add", after, text: "", start: secs(start), end: secs(end) });
  }

  async function saveDraft(remove = false) {
    if (!draft) return;
    const anchor = draft.mode === "edit" ? draft.word : draft.after;
    const seg = segments.find((s) => s.clipId === anchor.clipId);
    const source = transcripts.get(anchor.storagePath);
    if (!seg || !source) return;
    const next = [...source];

    if (remove && draft.mode === "edit") {
      next.splice(draft.word.wordIndex, 1);
    } else {
      const text = draft.text.trim();
      const startMs = Math.round(Number(draft.start) * 1000);
      const endMs = Math.round(Number(draft.end) * 1000);
      const clipStart = seg.offsetMs;
      const clipEnd = seg.offsetMs + seg.durationMs;
      if (!text) return setDraftError("Type the word.");
      if (text.length > 100) return setDraftError("Keep it under 100 characters.");
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return setDraftError("Enter the start and end in seconds, e.g. 3.25.");
      }
      if (endMs <= startMs) return setDraftError("The end has to be after the start.");
      if (startMs < clipStart || startMs >= clipEnd) {
        return setDraftError(
          `Start inside this clip (${formatTimecode(clipStart / 1000)}–${formatTimecode(clipEnd / 1000)}).`,
        );
      }
      const word = {
        text,
        start_ms: toSourceMs(seg, startMs),
        end_ms: toSourceMs(seg, Math.min(endMs, clipEnd)),
      };
      if (draft.mode === "edit") next[draft.word.wordIndex] = word;
      else next.splice(draft.after.wordIndex + 1, 0, word);
    }

    try {
      await onSaveWords(anchor.storagePath, next);
      setDraft(null);
      setDraftError(null);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    }
  }

  const activePhrase = phrases.findIndex((p) => {
    const start = p[0].startMs;
    const end = p[p.length - 1].endMs;
    return currentTimeMs >= start && currentTimeMs < end;
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-white/[0.06] shrink-0 space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-neutral-200">
          <Captions className="w-3.5 h-3.5 text-violet-400" />
          Captions
          {isSaving && <Loader2 className="w-3 h-3 animate-spin text-neutral-500" />}
        </div>
        <p className="text-[10px] text-neutral-500 leading-relaxed">
          Click a word to fix it or change its timing. Changes are used on your next cloud render.
        </p>
        {!captionsEnabled && (
          <p className="text-[10px] text-amber-300/90 leading-relaxed">
            Captions are turned off, so they won&apos;t be burned into exports.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {isLoading ? (
          <div className="flex items-center gap-2 p-3 text-[11px] text-neutral-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading captions…
          </div>
        ) : loadError ? (
          <div className="flex gap-2 p-3 text-[11px] text-red-300/90">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Couldn&apos;t load captions: {loadError}</span>
          </div>
        ) : segments.length === 0 ? (
          <p className="p-3 text-[11px] text-neutral-500">
            Add a clip where you speak to get captions.
          </p>
        ) : (
          <>
            {untranscribed.size > 0 && (
              <p className="px-1 pb-1 text-[10px] text-neutral-500 leading-relaxed">
                {untranscribed.size === segments.length
                  ? "No captions yet. Your clips are transcribed during your first cloud render."
                  : `${untranscribed.size} clip file${untranscribed.size === 1 ? " hasn't" : "s haven't"} been transcribed yet. That happens on your next cloud render.`}
              </p>
            )}
            {phrases.map((phrase, pi) => {
              const editingHere =
                draft &&
                phrase.some(
                  (w) => w.key === (draft.mode === "edit" ? draft.word.key : draft.after.key),
                );
              return (
                <div
                  key={phrase[0].key}
                  className={cn(
                    "rounded-lg border p-2 transition-colors",
                    pi === activePhrase
                      ? "border-violet-500/40 bg-violet-950/25"
                      : "border-white/[0.06] bg-white/[0.02]",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onSeek(phrase[0])}
                      className="shrink-0 mt-0.5 text-[10px] font-mono tabular-nums text-neutral-500 hover:text-violet-300"
                      title="Jump to this phrase"
                    >
                      {formatTimecode(phrase[0].startMs / 1000)}
                    </button>
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {phrase.map((w) => {
                        const selected = draft?.mode === "edit" && draft.word.key === w.key;
                        return (
                          <span key={w.key} className="inline-flex items-center">
                            <button
                              type="button"
                              onClick={() => openEdit(w)}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[12px] leading-tight transition-colors",
                                selected
                                  ? "bg-violet-600/40 text-white"
                                  : "text-neutral-200 hover:bg-white/[0.08]",
                              )}
                              title={`${formatTimecode(w.startMs / 1000)} – ${formatTimecode(w.endMs / 1000)}`}
                            >
                              {w.text}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {editingHere && draft && (
                    <WordEditor
                      draft={draft}
                      error={draftError}
                      saving={isSaving}
                      onChange={(patch) => setDraft({ ...draft, ...patch } as Draft)}
                      onSave={() => void saveDraft()}
                      onDelete={draft.mode === "edit" ? () => void saveDraft(true) : undefined}
                      onAddAfter={draft.mode === "edit" ? () => openAdd(draft.word) : undefined}
                      onCancel={() => {
                        setDraft(null);
                        setDraftError(null);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function WordEditor({
  draft,
  error,
  saving,
  onChange,
  onSave,
  onDelete,
  onAddAfter,
  onCancel,
}: {
  draft: Draft;
  error: string | null;
  saving: boolean;
  onChange: (patch: Partial<Pick<Draft, "text" | "start" | "end">>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onAddAfter?: () => void;
  onCancel: () => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keep editor shortcuts (space = play, delete = remove clip) out of typing.
    e.stopPropagation();
    if (e.key === "Enter") onSave();
    if (e.key === "Escape") onCancel();
  };
  const field =
    "w-full h-7 rounded border border-white/10 bg-black/30 px-2 text-[11px] text-neutral-100 outline-none focus:border-violet-500/60";

  return (
    <div className="mt-2 rounded-md border border-white/[0.08] bg-black/20 p-2 space-y-1.5">
      <div className="text-[9px] uppercase tracking-widest text-neutral-500">
        {draft.mode === "edit" ? "Edit word" : `New word after “${draft.after.text}”`}
      </div>
      <input
        autoFocus
        value={draft.text}
        onChange={(e) => onChange({ text: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder="Word"
        maxLength={100}
        className={field}
        aria-label="Word text"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[9px] text-neutral-500 space-y-0.5">
          <span>Start (s)</span>
          <input
            value={draft.start}
            onChange={(e) => onChange({ start: e.target.value })}
            onKeyDown={onKeyDown}
            inputMode="decimal"
            className={cn(field, "font-mono tabular-nums")}
          />
        </label>
        <label className="text-[9px] text-neutral-500 space-y-0.5">
          <span>End (s)</span>
          <input
            value={draft.end}
            onChange={(e) => onChange({ end: e.target.value })}
            onKeyDown={onKeyDown}
            inputMode="decimal"
            className={cn(field, "font-mono tabular-nums")}
          />
        </label>
      </div>
      {error && <p className="text-[10px] text-red-300/90">{error}</p>}
      <div className="flex items-center gap-1 pt-0.5">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1 h-6 px-2 rounded bg-violet-600 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          <Check className="w-3 h-3" /> Save
        </button>
        {onAddAfter && (
          <button
            type="button"
            onClick={onAddAfter}
            disabled={saving}
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-neutral-300 hover:bg-white/[0.06] disabled:opacity-50"
            title="Insert a missing word after this one"
          >
            <Plus className="w-3 h-3" /> Add after
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-neutral-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            title="Remove this word from the captions (the video isn't cut)"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto inline-flex items-center h-6 px-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06]"
          aria-label="Cancel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
