// The terms of service. Keep them in step with what the app does and its
// limits (src/lib/plans.ts).

import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage, SUPPORT_EMAIL } from "@/components/legal-page";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms — Stuccord Motion" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="31 October 2026">
      <p>
        These terms apply when you use Stuccord, an online editor that turns your footage into
        edited videos. By creating an account you agree to them.
      </p>

      <section>
        <h2>The beta</h2>
        <p>
          Stuccord is in beta and free to use within the monthly limits shown on the Billing page.
          Features and limits may change; paid plans may be added later, and we&rsquo;ll tell you
          before anything you use starts to cost money. We work to keep the service running, but
          it&rsquo;s provided as it is, without guarantees of availability.
        </p>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You keep all rights to what you upload and make. You let us store and process it only to
          provide the service to you (see the <Link to="/privacy">Privacy policy</Link>). You must
          have the rights to everything you upload, including music and footage of other people.
        </p>
      </section>

      <section>
        <h2>AI features</h2>
        <ul>
          <li>AI suggestions (graphics, captions, pictures, voices) can be wrong. Check your video before you publish it; you&rsquo;re responsible for what you post.</li>
          <li>Only make a cartoon or AI picture of a real person if you are that person or have their permission.</li>
          <li>Don&rsquo;t use AI voices or pictures to impersonate anyone or to mislead people.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>Don&rsquo;t use Stuccord to:</p>
        <ul>
          <li>upload or publish anything illegal, hateful, sexual content involving minors, or content that infringes someone else&rsquo;s rights;</li>
          <li>harass, threaten or deceive people;</li>
          <li>break, overload or get around the limits or security of the service.</li>
        </ul>
        <p>We may remove content or suspend accounts that break these rules.</p>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          Keep your sign-in details safe; you&rsquo;re responsible for activity on your account.
          You can delete your account at any time in Settings.
        </p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the extent the law allows, Stuccord isn&rsquo;t liable for indirect losses, lost
          profits or lost data arising from use of the service. Keep your own copies of important
          footage.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms; the date above shows the latest version, and we&rsquo;ll tell
          you about important changes in the app. Questions:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
