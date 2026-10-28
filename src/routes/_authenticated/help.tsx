import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Search,
  BookOpen,
  Mail,
  Upload,
  Send,
  Film,
  Captions,
  Music2,
  Move,
  Download,
  Keyboard,
  ImageIcon,
  Scissors,
  Mic,
  Code2,
} from "lucide-react";
import { useEffect, useState } from "react";

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
    icon: Mic,
    title: "Voiceovers",
    steps: [
      "Move the playhead to where it should start, then press + on the VO track (or Voiceover on Home).",
      "Record my voice: allow the microphone, press record, then Stop. Listen back, record again if you like, then add it. Recording has no limit.",
      "AI voice: pick a voice (press play to hear it), type the script and press Make voiceover. The free plan includes 5,000 AI voice characters a month (about 5 minutes); see Billing.",
      "Drag a voiceover along the VO track to move it; right-click it to start it at the playhead or delete it.",
      "Your clips' own sound and the music get quieter while a voiceover plays, in the preview and the cloud export. Browser exports don't include voiceovers yet.",
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
  {
    icon: Send,
    title: "Publishing to YouTube and TikTok",
    steps: [
      "On the Publishing page, press Connect YouTube or Connect TikTok and sign in to the account you want to post to.",
      "Export your video, then press Publish in the editor (or New post on the Publishing page).",
      "Add a title and description, choose who can watch, and post now or pick a date and time. Your project cover becomes the YouTube thumbnail when YouTube allows it.",
      "For TikTok, choose Post to profile or Send to TikTok drafts (you finish it in the TikTok app). Posting to the profile asks who can see it, whether viewers can comment, Duet or Stitch, and whether the video promotes a brand. The description is the TikTok caption.",
      "Scheduled posts go out within a minute or two of the time. You can move or cancel them until then.",
      "Views, likes and comments are updated once a day, on the Publishing page and in Analytics.",
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

// The API (src/lib/api/v1.server.ts). Each step: what it does, then curl.
const API_STEPS: { title: string; note: string; curl: string }[] = [
  {
    title: "1. Make a project",
    note: "aspect_ratio is 9:16, 16:9 or 1:1 (default 9:16). Returns the project with its id.",
    curl: `curl -X POST $BASE/api/v1/projects \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"title":"My short","aspect_ratio":"9:16"}'`,
  },
  {
    title: "2. Get an upload link",
    note: "Give the file's name, type and size in bytes. Returns upload.url and upload.path (the link works for 2 hours).",
    curl: `curl -X POST $BASE/api/v1/projects/$PROJECT/uploads \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"filename":"talk.mp4","content_type":"video/mp4","size":12345678}'`,
  },
  {
    title: "3. Upload the file",
    note: "PUT the file itself to upload.url, with its content type.",
    curl: `curl -X PUT "$UPLOAD_URL" -H "content-type: video/mp4" --data-binary @talk.mp4`,
  },
  {
    title: "4. Put it on the timeline",
    note: "track: V1 (main, after the last clip), V2 (B-roll), A2 (music or SFX) or VO (voiceover, with start_ms). Videos and pictures default to V1, audio to A2. duration_ms is optional; the editor reads it when you open the project.",
    curl: `curl -X POST $BASE/api/v1/projects/$PROJECT/clips \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"path":"<upload.path>","track":"V1"}'`,
  },
  {
    title: "5. Start an export",
    note: "A cloud export in 1080p. captions, music and music_volume (0-100) are optional and default to the project's switches. Counts toward your 5 exports a month.",
    curl: `curl -X POST $BASE/api/v1/projects/$PROJECT/exports \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" -d '{"captions":true}'`,
  },
  {
    title: "6. Check it, then download",
    note: "Check every 10-30 seconds. status goes queued → transcribing → planning → rendering → completed (or failed, with error). When completed, download_url works for an hour; ask again for a fresh one.",
    curl: `curl $BASE/api/v1/exports/$EXPORT -H "Authorization: Bearer $KEY"`,
  },
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
    a: "YouTube and TikTok, yes: connect your accounts on the Publishing page and post now or on a schedule. Instagram is next; until then, download your export and upload it in the app.",
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

      <ApiGuide />

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

function ApiGuide() {
  // The address scripts call: this site's own.
  const [base, setBase] = useState("https://your-stuccord-site");
  useEffect(() => setBase(window.location.origin), []);
  return (
    <section id="api" className="mb-10 scroll-mt-24">
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Code2 className="w-4 h-4 text-violet-700" /> API for your own scripts
      </h3>
      <p className="text-[13px] text-neutral-600 mb-3 max-w-3xl leading-relaxed">
        Make a key in{" "}
        <Link to="/settings" search={{ tab: "api" }} className="underline">
          Settings → API keys
        </Link>{" "}
        and send it with every request as <code className="font-mono">Authorization: Bearer smk_…</code>.
        Full-access keys can do everything below; read-only keys can list projects (
        <code className="font-mono">GET /api/v1/projects</code>), see one with its clips and latest
        export (<code className="font-mono">GET /api/v1/projects/ID</code>) and check exports.
        Answers are JSON; errors look like{" "}
        <code className="font-mono">{'{"error":{"code","message"}}'}</code>. Up to 120 requests a
        minute per key.
      </p>
      <div className="rounded-2xl bg-white border border-black/5 divide-y divide-black/5">
        <div className="p-4 text-[12px] text-neutral-600">
          In the examples: <code className="font-mono">BASE={base}</code>,{" "}
          <code className="font-mono">KEY</code> is your key, and{" "}
          <code className="font-mono">PROJECT</code>, <code className="font-mono">UPLOAD_URL</code>{" "}
          and <code className="font-mono">EXPORT</code> come from the answers before.
        </div>
        {API_STEPS.map((s) => (
          <div key={s.title} className="p-4 space-y-2">
            <div className="text-sm font-medium">{s.title}</div>
            <p className="text-[12.5px] text-neutral-600 leading-relaxed">{s.note}</p>
            <pre className="text-[11.5px] leading-relaxed bg-neutral-950 text-neutral-100 rounded-lg p-3 overflow-x-auto">
              <code>{s.curl.replaceAll("$BASE", base)}</code>
            </pre>
          </div>
        ))}
      </div>
    </section>
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
