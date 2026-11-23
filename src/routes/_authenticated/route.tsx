import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/onboarding";
import { PageLoading } from "@/components/page-loading";
import { supabase } from "@/integrations/supabase/client";
import { needsCode } from "@/lib/account-security";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Drawn by the server in place of the page (which loads in the browser),
  // so a slow connection sees a loading screen, not a blank one.
  pendingComponent: PageLoading,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;

    // Not signed in, or signed in with the password but not yet the
    // two-factor code: the sign-in page (which asks for the code).
    if (!session?.user || (await needsCode())) {
      throw redirect({
        to: "/auth",
        search: { next: location.pathname },
      });
    }

    return {
      user: session.user,
      session,
    };
  },
  component: () => (
    <>
      <Outlet />
      <OnboardingGate />
    </>
  ),
});
