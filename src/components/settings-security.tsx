// Settings > Security: change password, two-factor sign-in (authenticator
// app), and deleting the account.

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  MIN_PASSWORD,
  changePassword,
  checkCode,
  getAuthenticator,
  removeAuthenticator,
  startAuthenticatorSetup,
} from "@/lib/account-security";
import { deleteAccount } from "@/lib/account.functions";

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-5 first:pt-0">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-neutral-500 mt-0.5 mb-3">{desc}</div>
      {children}
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== again) {
      setError("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      toast.success("Your password is changed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 max-w-sm">
      {error && <div className="text-xs text-red-700 bg-red-50 rounded-md p-2">{error}</div>}
      <div className="space-y-1">
        <Label htmlFor="pw-current" className="text-xs">
          Current password
        </Label>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pw-new" className="text-xs">
          New password
        </Label>
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pw-again" className="text-xs">
          New password again
        </Label>
        <Input
          id="pw-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Change password"}
      </Button>
    </form>
  );
}

function TwoFactor() {
  // null: loading; "off"; "setup" (scanning + code); "on".
  const [state, setState] = useState<"loading" | "off" | "setup" | "on">("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ image: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const f = await getAuthenticator();
      setFactorId(f?.id ?? null);
      setState(f ? "on" : "off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read your two-factor setting.");
      setState("off");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      const s = await startAuthenticatorSetup();
      setFactorId(s.factorId);
      setQr({ image: s.qrCode, secret: s.secret });
      setCode("");
      setState("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the set-up.");
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setBusy(true);
    try {
      await checkCode(factorId, code);
      setQr(null);
      setState("on");
      toast.success("Two-factor sign-in is on", {
        description: "You'll be asked for a code from your app each time you sign in.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }
  async function cancelSetup() {
    if (factorId) await removeAuthenticator(factorId).catch(() => {});
    setQr(null);
    setFactorId(null);
    setState("off");
  }
  async function turnOff() {
    if (!factorId) return;
    setBusy(true);
    try {
      await removeAuthenticator(factorId);
      setFactorId(null);
      setState("off");
      toast.success("Two-factor sign-in is off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't turn it off.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="text-xs text-neutral-500">Loading…</div>;
  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-red-700 bg-red-50 rounded-md p-2 max-w-sm">{error}</div>
      )}
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
            <ShieldCheck className="w-4 h-4" /> On: sign-in asks for a code from your app
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                Turn off
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Turn off two-factor sign-in?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your password alone will be enough to sign in again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it on</AlertDialogCancel>
                <AlertDialogAction onClick={() => void turnOff()}>Turn off</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {state === "off" && (
        <Button variant="outline" size="sm" onClick={() => void begin()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Turn on"}
        </Button>
      )}
      {state === "setup" && qr && (
        <form onSubmit={confirm} className="space-y-3 max-w-sm">
          <ol className="list-decimal ml-4 space-y-1 text-xs text-neutral-600">
            <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
            <li>Scan this code, or type in the key below.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <img
            src={qr.image}
            alt="QR code for your authenticator app"
            className="w-40 h-40 rounded-md border border-black/10 bg-white p-1"
          />
          <div className="text-[11px] text-neutral-500">
            Key:{" "}
            <code className="font-mono text-neutral-800 break-all select-all">{qr.secret}</code>
          </div>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="6-digit code"
            className="font-mono tracking-[0.3em]"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Turn on"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void cancelSetup()}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function DeleteAccount() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const remove = useServerFn(deleteAccount);
  const [email, setEmail] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  async function run() {
    setBusy(true);
    try {
      await remove({ data: { confirmEmail: typed } });
      qc.clear();
      await supabase.auth.signOut({ scope: "local" });
      toast.success("Your account and everything in it are deleted");
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 max-w-sm">
      <p className="text-xs text-neutral-600 leading-relaxed">
        This deletes all your projects, clips, uploaded files, thumbnails, exports and captions,
        then your account. It can&apos;t be undone.
      </p>
      <div className="space-y-1">
        <Label htmlFor="delete-email" className="text-xs">
          Type your email{email ? ` (${email})` : ""} to confirm
        </Label>
        <Input
          id="delete-email"
          type="email"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-red-700 border-red-200 hover:bg-red-50"
            disabled={!matches || busy}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete my account"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account for good?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything in it is deleted right away and can&apos;t be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my account</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void run()}>
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SecuritySettings() {
  return (
    <div className="divide-y divide-black/5">
      <Section title="Password" desc="Change the password you sign in with.">
        <PasswordForm />
      </Section>
      <Section
        title="Two-factor sign-in"
        desc="Ask for a code from an authenticator app as well as your password. Your projects and files stay locked to anyone with only the password."
      >
        <TwoFactor />
      </Section>
      <Section title="Delete account" desc="Remove your account and everything in it.">
        <DeleteAccount />
      </Section>
    </div>
  );
}
