// Where the "reset your password" email link lands: Supabase signs the
// visitor in from the link (a recovery session), and they set a new password.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD, needsCode, verifySignInCode } from "@/lib/account-security";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Set a new password — Stuccord Motion" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  // "checking": reading the link; "ready": signed in from it; "invalid": no usable link.
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      setState("ready");
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) ready();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready();
    });
    // The link is read when the page loads; give it a moment.
    const timer = setTimeout(() => {
      if (!done) setState("invalid");
    }, 4000);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      // Two-factor on: the code is needed before the password can change.
      if (await needsCode()) {
        if (!askCode) {
          setAskCode(true);
          return;
        }
        await verifySignInCode(code);
      }
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw new Error(upErr.message);
      toast.success("Your password is changed");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          Set a new password
        </h1>
        {state === "checking" ? (
          <p className="mt-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking your link…
          </p>
        ) : state === "invalid" ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              This link has expired or was already used. Ask for a new one from the sign-in page.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/auth" search={{ next: undefined }}>
                Back to sign in
              </Link>
            </Button>
          </>
        ) : (
          <form onSubmit={save} className="space-y-4 mt-6">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs font-medium">
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD} characters`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-xs font-medium">
                Type it again
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-11"
              />
            </div>
            {askCode && (
              <div className="space-y-1.5">
                <Label htmlFor="code" className="text-xs font-medium">
                  Code from your authenticator app
                </Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-11 font-mono tracking-[0.3em]"
                />
              </div>
            )}
            <Button type="submit" className="w-full h-11" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save new password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
