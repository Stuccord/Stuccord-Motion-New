import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

type AuthorizationDetails = {
  client?: { name?: string; client_id?: string; redirect_uris?: string[] } | null;
  scopes?: string[] | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type SupabaseAuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};

function oauth(): SupabaseAuthOAuth {
  return (supabase.auth as unknown as { oauth: SupabaseAuthOAuth }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center bg-background p-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-lg font-semibold">Could not load this authorization request</h1>
        <p className="text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(null);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="min-h-screen grid place-items-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">Authorize access</span>
        </div>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">
          Connect {clientName} to Stuccord Motion
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          This lets {clientName} use Stuccord Motion as you — read your projects, clips and
          render jobs, and create new projects on your behalf. It won't bypass permissions
          or backend policies.
        </p>

        {details?.scopes && details.scopes.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-neutral-700">
            {details.scopes.map((s: string) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                Permission: <span className="font-mono text-xs">{s}</span>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" disabled={!!busy} onClick={() => decide(true)}>
            {busy === "approve" && <Loader2 className="w-4 h-4 animate-spin" />}
            Approve
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            disabled={!!busy}
            onClick={() => decide(false)}
          >
            {busy === "deny" && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel
          </Button>
        </div>
      </div>
    </main>
  );
}
