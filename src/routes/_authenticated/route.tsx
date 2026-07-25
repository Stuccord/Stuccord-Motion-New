import { createFileRoute, Outlet } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/onboarding";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    return {
      user: {
        id: "clerk-user",
        email: "dev-user@example.com",
        user_metadata: { full_name: "Stuccord Creator" }
      }
    };
  },
  component: () => (
    <>
      <Outlet />
      <OnboardingGate />
    </>
  ),
});
