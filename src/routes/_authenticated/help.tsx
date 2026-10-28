import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Search,
  BookOpen,
  Mail,
  Upload,
  Film,
  Captions,
  Music2,
  Move,
  Download,
  Keyboard,
  ImageIcon,
  Scissors,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({ meta: [{ title: "Help & docs — Stuccord Motion" }] }),
  component: HelpPage,
});

const SUPPORT_EMAIL = "support@stuccord.com";

// Guides describe what the app does today; keep them in step with it.
const GUIDES: { icon: typeof Upload; title: string; steps: string[] }[] = [
  {
    icon: Upload,
    title: "Adding footage",
    steps: [
      "Open a project and press Import Media, drop files anywhere on the editor, or drop them straight onto a track.",
      "Videos: MP4, MOV or WebM. Images: JPG, PNG, WebP or GIF. Audio: MP3, WAV, M4A, AAC or OGG. Up to 500 MB per file.",
      "Uploads run in the background, two at a time, with progress in the Media panel. You can keep editing, cancel a file, or retry one that failed.",
      "Videos and images go onto V1 one after another, in the order you picked them. Drop onto V2 to put one on top as B-roll; audio goes onto A2.",
      "iPhone HEIC photos don't open in browsers: export them as JPG first.",
    ],
  },
  {
    icon: Film,
    title: "Editing on the timeline",
    steps: [
      "V1 is your main video: its clips always sit back to back. Drag one along V1 to change the order.",
      "V2 is for B-roll on top of V1: drag a clip to any time. It's silent over V1 and plays with its sound after V1 ends.",
      "Drag a clip's edges to trim it. Press S to split the selected clip at the playhead.",
      "Clips snap to edges and the playhead; hold Alt while dragging to place them freely.",
      "Ctrl+Z undoes, Ctrl+Shift+Z redoes. Right-click a clip or track for more.",
    ],
  },
  {
    icon: Scissors,
    title: "Cutting out pauses",
    steps: [
      "Press the dashed scissors on the timeline (or open Auto-cut on Home): the Auto-cut tab opens on the right.",
      "Choose all of V1 or just the selected clip, and how much to cut: Gentle (pauses over 1 s), Normal (over 0.6 s) or Tight (over 0.35 s).",
      "Press Find pauses. Each one is marked in red on the timeline and listed; click a time to see it, untick any to keep.",
      "Press Cut: the pauses are removed and the clips close up. Ctrl+Z puts everything back.",
      "It listens for quiet, so music or background noise under your voice can hide pauses.",
    ],
  },
  {
    icon: Move,
    title: "Moving clips in the frame",
    steps: [
      "Pause, then click a clip in the preview to select it.",
      "Drag it to move it, drag a corner to resize it, or drag the round arrow to rotate it. Hold Alt to turn snapping off, Shift to rotate in 15° steps.",
      "Exact numbers are in the Clip Inspector under Transform; Reset puts the clip back to its normal fit.",
      "A smaller V2 clip shows your V1 video around it (picture-in-picture).",
    ],
  },
  {
    icon: Captions,
    title: "Captions",
    steps: [
      "Captions are made from what's said in your V1 videos: the first cloud export transcribes them, word by word.",
      "After that they show in the preview and on the V3 track, and you can fix any word in the Captions tab.",
      "The eye button on the V3 track turns captions on or off for the export.",
      "Settings → Brand kit sets their font, colours, size and place, the hook's colours, and a logo on every export.",
    ],
  },
  {
    icon: Music2,
    title: "Music and sound effects",
    steps: [
      "Import audio and it lands on A2. Music plays under the whole video, looping, and gets quieter while someone speaks.",
      "Files named like whoosh, impact, riser or sfx become sound effects, played on each cut. Drag one on A2 to play it once at that spot.",
      "The speaker button on the A2 track turns music and SFX on or off for the export, and the volume slider sets how loud the music is.",
    ],
  },
  {
    icon: Download,
    title: "Exporting",
    steps: [
      "Render Video makes a cloud export in 1080p with captions, music and SFX. You can keep editing while it renders.",
      "A browser export records the video in your browser, up to 4K. It includes your clips and their sound, but not captions or music.",
      "The free plan includes 5 exports a month; failed exports don't count. The count resets on the 1st.",
    ],
  },
  {
    icon: ImageIcon,
    title: "Thumbnails and covers",
    steps: [
      "In the editor, press Thumbnail (next to Render Video), or use Thumbnail on Home to open it in your latest project.",
      "Pick a clip and the moment you want, then zoom in and drag the picture to choose what shows.",
      "Add a title: it starts in your brand kit's font and colours, with an outline or a box behind it. Your logo can go on too.",
      "Sizes: like your video, YouTube (1280×720) or square (1080×1080). Download it as PNG or JPG.",
      "Set as project cover shows it on Home and Projects instead of the first clip's frame.",
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["J  K  L", "Back 1 s · stop · play faster"],
  ["← →", "One frame (Shift: one second)"],
  ["S", "Split at the playhead"],
  ["[  ]", "Move the selected clip to the playhead"],
  ["Alt + [  ]", "Trim the selected clip to the playhead"],
  ["Ctrl + D", "Duplicate the selected clip"],
  ["Del", "Delete the selected clip"],
  ["Ctrl + Z", "Undo (Shift: redo)"],
];

const FAQS = [
  {
    q: "How long does an export take?",
    a: "It depends on the length of your video and your clips: a short of under a minute usually takes a few minutes. The editor shows the progress, and you can keep working meanwhile.",
  },
  {
    q: "Can I use my own music?",
    a: "Yes. Import an MP3, WAV, M4A, AAC or OGG file and it goes onto the A2 track. It's mixed into cloud exports, quieter under your voice.",
  },
  {
    q: "Why don't I see captions yet?",
    a: "Captions come from the speech in your V1 videos, which is transcribed during your first cloud export. After that they show in the preview and you can edit them.",
  },
  {
    q: "What happens to my footage when I delete something?",
    a: "Deleting a clip removes it from the project; its file is deleted from storage once no other clip uses it. Deleting a project removes the project and its clips.",
  },
  {
    q: "Can I post straight to TikTok, Reels or Shorts?",
    a: "Not yet: publishing is planned. For now, download your export and upload it to each app.",
  },
  {
    q: "Is there a paid plan?",
    a: "Not yet. Everyone is on the free plan, with 5 exports a month. See Billing for your usage.",
  },
];

function HelpPage() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const guides = GUIDES.filter(
    (g) =>
      !needle ||
      g.title.toLowerCase().includes(needle) ||
      g.steps.some((s) => s.toLowerCase().includes(needle)),
  );
  const faqs = FAQS.filter(
    (f) => !needle || f.q.toLowerCase().includes(needle) || f.a.toLowerCase().includes(needle),
  );

  return (
    <AppShell title="Help & docs" subtitle="How everything works, and how to reach us.">
      <div className="relative rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-fuchsia-700 text-white p-8 md:p-12 overflow-hidden mb-8">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">How can we help?</h2>
          <p className="text-sm text-white/70 mt-2">Search the guides and questions below.</p>
          <div className="mt-6 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search, e.g. captions, export, B-roll…"
              aria-label="Search help"
              className="w-full h-12 pl-11 pr-4 text-sm bg-white text-neutral-900 rounded-full focus:outline-none focus:ring-2 focus:ring-white/30 shadow-xl"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-10">
        <ContactCard
          icon={BookOpen}
          title="Guides"
          desc="Step-by-step help for every part of the editor."
          action={<a href="#guides">Read the guides</a>}
        />
        <ContactCard
          icon={Keyboard}
          title="Keyboard shortcuts"
          desc="The full list is also in the editor (the keyboard button on the timeline)."
          action={<a href="#shortcuts">See shortcuts</a>}
        />
        <ContactCard
          icon={Mail}
          title="Email support"
          desc={`Write to ${SUPPORT_EMAIL} and we'll get back to you.`}
          action={<a href={`mailto:${SUPPORT_EMAIL}`}>Email us</a>}
        />
      </div>

      <section id="guides" className="mb-10 scroll-mt-24">
        <h3 className="text-sm font-semibold mb-3">Guides</h3>
        {guides.length === 0 ? (
          <div className="rounded-xl border border-black/5 bg-white p-6 text-center text-sm text-neutral-500">
            No guide matches &ldquo;{q}&rdquo;.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {guides.map((g) => (
              <details
                key={g.title}
                open={!!needle}
                className="group rounded-xl border border-black/5 bg-white p-4 open:border-black/15"
              >
                <summary className="cursor-pointer list-none flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg bg-violet-50 text-violet-700 grid place-items-center shrink-0">
                    <g.icon className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-semibold flex-1">{g.title}</span>
                  <span className="text-neutral-400 group-open:rotate-45 transition-transform text-xl leading-none">
                    +
                  </span>
                </summary>
                <ol className="mt-3 ml-12 list-decimal space-y-1.5 text-[13px] text-neutral-600 leading-relaxed">
                  {g.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        )}
      </section>

      <section id="shortcuts" className="mb-10 scroll-mt-24">
        <h3 className="text-sm font-semibold mb-3">Keyboard shortcuts in the editor</h3>
        <div className="rounded-2xl bg-white border border-black/5 divide-y divide-black/5">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <kbd className="font-mono text-xs text-neutral-800 bg-neutral-100 rounded px-1.5 py-0.5">
                {keys}
              </kbd>
              <span className="text-[13px] text-neutral-600 text-right">{what}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Frequently asked</h3>
        <div className="rounded-2xl bg-white border border-black/5 divide-y divide-black/5">
          {faqs.map((f) => (
            <details key={f.q} className="group">
              <summary className="cursor-pointer flex items-start justify-between gap-4 p-4 list-none">
                <div className="text-sm font-medium">{f.q}</div>
                <div className="text-neutral-400 group-open:rotate-45 transition-transform text-xl leading-none">
                  +
                </div>
              </summary>
              <div className="px-4 pb-4 text-sm text-neutral-600 leading-relaxed">{f.a}</div>
            </details>
          ))}
          {faqs.length === 0 && (
            <div className="p-6 text-center text-sm text-neutral-500">
              No questions matched &ldquo;{q}&rdquo;.{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-violet-700 font-medium">
                Email us
              </a>{" "}
              instead.
            </div>
          )}
        </div>
      </section>

      <div className="mt-10 rounded-2xl border border-black/5 bg-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-900 text-white grid place-items-center">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Still stuck?</div>
            <div className="text-xs text-neutral-500">
              Email {SUPPORT_EMAIL}, or see your plan and usage in{" "}
              <Link to="/billing" className="underline">
                Billing
              </Link>
              .
            </div>
          </div>
        </div>
        <Button asChild>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Email support</a>
        </Button>
      </div>
    </AppShell>
  );
}

function ContactCard({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: typeof BookOpen;
  title: string;
  desc: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white border border-black/5 p-5">
      <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 grid place-items-center mb-3">
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-neutral-500 mt-1">{desc}</div>
      <Button variant="ghost" size="sm" className="mt-3 -ml-2" asChild>
        {action}
      </Button>
    </div>
  );
}
