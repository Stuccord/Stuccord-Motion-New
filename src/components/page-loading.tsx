// Shown while a page is still loading (its code on a slow connection, or the
// sign-in check), so the screen is never just blank: the Stuccord logo with
// a soft purple glow that pulses. Its own small styles, so it shows before
// any of the app's code has run.

import logoUrl from "@/assets/logo.png";

const CSS = `
@keyframes stuccord-glow {
  0%, 100% { transform: scale(0.85); opacity: 0.35; }
  50% { transform: scale(1.15); opacity: 0.8; }
}
@keyframes stuccord-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
@keyframes stuccord-dots {
  0%, 20% { opacity: 0.2; }
  50% { opacity: 1; }
  100% { opacity: 0.2; }
}
@media (prefers-reduced-motion: reduce) {
  [data-page-loading] * { animation: none !important; }
}
`;

export function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-muted-foreground"
      data-page-loading
    >
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div
          aria-hidden
          className="absolute inset-0 rounded-3xl"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.25) 0%, rgba(255,90,31,0) 70%)",
            filter: "blur(14px)",
            animation: "stuccord-glow 1.8s ease-in-out infinite",
          }}
        />
        <img
          src={logoUrl}
          alt=""
          width={64}
          height={64}
          className="relative h-16 w-16 rounded-2xl bg-white object-contain p-1 shadow-[0_8px_30px_-6px_rgba(255,255,255,0.25)]"
          style={{ animation: "stuccord-breathe 1.8s ease-in-out infinite" }}
        />
      </div>
      <div className="text-sm tracking-wide">
        Loading Stuccord
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            style={{ animation: `stuccord-dots 1.4s ${i * 0.2}s infinite` }}
          >
            .
          </span>
        ))}
      </div>
      <style>{CSS}</style>
    </div>
  );
}
