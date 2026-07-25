import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthenticateWithRedirectCallback, useUser } from "@clerk/clerk-react";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/sso-callback")({
  head: () => ({ meta: [{ title: "Signing in — Stuccord Motion" }] }),
  component: SsoCallbackPage,
});

function SsoCallbackPage() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useUser();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  // Safety timer: auto-redirect to /dashboard after 3 seconds if callback gets stuck
  useEffect(() => {
    const timer = setTimeout(() => {
      navigate({ to: "/dashboard", replace: true });
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl="/dashboard"
        signUpForceRedirectUrl="/dashboard"
        afterSignInUrl="/dashboard"
        afterSignUpUrl="/dashboard"
      />
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground font-medium">Signing you in…</p>
    </div>
  );
}
