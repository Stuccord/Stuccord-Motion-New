import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/onboarding";
import { supabase } from "@/integrations/supabase/client";
import { needsCode } from "@/lib/account-security";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
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
