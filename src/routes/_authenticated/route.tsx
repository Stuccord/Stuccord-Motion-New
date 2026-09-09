import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/onboarding";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;

    if (!session?.user) {
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
