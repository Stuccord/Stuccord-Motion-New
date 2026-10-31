// The privacy policy: what Stuccord keeps, which services process it, and
// how to remove it. Keep it in step with what the app does.

import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, SUPPORT_EMAIL } from "@/components/legal-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy — Stuccord Motion" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="31 October 2026">
      <p>
        Stuccord is a video editor: you upload footage, and Stuccord edits it with captions,
        motion graphics, sounds and music. This page explains what we keep, who helps us run the
        service, and how you can remove your data.
      </p>

      <section>
        <h2>What we keep</h2>
        <ul>
          <li>Your account: email address, password (stored hashed by our sign-in provider) and settings, including two-step sign-in if you turn it on.</li>
          <li>What you make: projects, the files you upload (video, images, audio), transcripts of your speech, scripts and notes you add, the graphics plan, AI pictures, your speaker cartoon if you make one, your brand kit and finished exports.</li>
          <li>Teams: the teams you belong to, your role, and invites.</li>
          <li>Connected accounts: if you connect YouTube, TikTok or Instagram, the access tokens to post for you, stored encrypted.</li>
          <li>Usage: how many exports, AI plans, AI pictures and AI voice characters you used this month, to apply the free limits.</li>
        </ul>
      </section>

      <section>
        <h2>How we use it</h2>
        <p>
          Only to provide Stuccord to you: to edit, store and export your videos, to post them where
          you ask, to keep your account secure and to apply plan limits. We don&rsquo;t sell your
          data, we don&rsquo;t show ads, and we don&rsquo;t use your footage or scripts to train AI
          models.
        </p>
      </section>

      <section>
        <h2>Services that process your data</h2>
        <p>Stuccord uses these providers to run. Each gets only what its job needs:</p>
        <ul>
          <li><strong>Supabase</strong>: database, sign-in and file storage.</li>
          <li><strong>Render</strong>: hosting the app and the video rendering service, which downloads your files to edit them.</li>
          <li><strong>ElevenLabs</strong>: speech-to-text (your audio, to make captions and transcripts) and AI voiceovers (the text you ask it to read).</li>
          <li><strong>Anthropic (Claude)</strong>: planning the motion graphics and writing hook lines (your transcript, title, script and notes).</li>
          <li><strong>Google (Gemini)</strong>: AI pictures for story scenes and cartoons (the picture descriptions and, for your speaker cartoon or scenes with you in them, a photo of you, only after you confirm you&rsquo;re that person or have their permission).</li>
          <li><strong>YouTube, TikTok and Instagram</strong>: only when you connect an account and post to it.</li>
        </ul>
      </section>

      <section>
        <h2>Keeping and deleting</h2>
        <p>
          Your data stays until you delete it. Removing a clip deletes its file once no other clip
          uses it; deleting a project removes it from your workspace. You can delete your whole
          account in Settings, which removes your account and your personal projects. You can also
          ask us to export or delete your data at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Files are private: they&rsquo;re reached through short-lived links. Connected-account
          tokens are encrypted. You can turn on two-step sign-in in Settings.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions or requests: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If this
          policy changes in a way that matters, we&rsquo;ll update the date above and tell you in
          the app.
        </p>
      </section>
    </LegalPage>
  );
}
