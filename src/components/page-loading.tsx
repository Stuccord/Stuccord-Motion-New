// Shown while a page is still loading (its code on a slow connection, or the
// sign-in check), so the screen is never just blank. Plain styles, so it
// shows before any of the app's code has run.

export function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-muted-foreground"
      data-page-loading
    >
      <div
        className="h-9 w-9 rounded-full border-2 border-white/15 border-t-primary"
        style={{ animation: "spin 0.9s linear infinite" }}
      />
      <div className="text-sm">Loading Stuccord…</div>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
