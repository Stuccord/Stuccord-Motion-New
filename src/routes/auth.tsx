import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check, Loader2, Sparkles, Eye, EyeOff, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { needsCode, sendPasswordReset, verifySignInCode } from "@/lib/account-security";
import logoUrl from "@/assets/logo.png";
import editingDesk from "@/assets/editing-desk.jpg";

function safeRelativePath(candidate: string | undefined): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  return candidate;
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Stuccord Motion" },
      { name: "description", content: "Sign in or create your Stuccord Motion studio." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const nextPath = safeRelativePath(next);
  const redirectUrl = nextPath ?? "/dashboard";

  const [checkingSession, setCheckingSession] = useState(true);
  // signin / signup, "forgot" (send a reset link), "code" (two-factor step).
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "code">("signin");
  const [code, setCode] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);

  useEffect(() => {
    let isMounted = true;
    // Signed in already: go on, unless the two-factor code is still needed.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      if (data.session?.user) {
        if (await needsCode()) {
          setMode("code");
          setCheckingSession(false);
        } else {
          navigate({ to: redirectUrl, replace: true });
        }
      } else {
        setCheckingSession(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user || !isMounted) return;
      void needsCode().then((need) => {
        if (isMounted && !need) navigate({ to: redirectUrl, replace: true });
      });
    });

    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, [redirectUrl, navigate]);

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Checking session…</p>
        </div>
      </div>
    );
  }

  const perks = [
    "5 free exports every month",
    "Word-by-word captions, music and B-roll",
    "A real timeline editor in your browser",
  ];

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          setErrorMessage("Invalid email or password. Please check your credentials.");
          toast.error("Invalid email or password");
        } else {
          setErrorMessage(error.message);
          toast.error(error.message);
        }
        return;
      }

      if (data.session) {
        // Two-factor on: one more step before the studio.
        if (await needsCode()) {
          setMode("code");
          setPassword("");
          return;
        }
        toast.success("Welcome back to Stuccord Motion!");
        navigate({ to: redirectUrl, replace: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in. Please try again.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);
    try {
      await verifySignInCode(code);
      toast.success("Welcome back to Stuccord Motion!");
      navigate({ to: redirectUrl, replace: true });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Couldn't send the email. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match. Please re-enter.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.toLowerCase().includes("already registered")) {
          setErrorMessage("An account with this email already exists.");
          toast.error("Account already exists", {
            description: "Would you like to sign in instead?",
            action: {
              label: "Sign in",
              onClick: () => {
                setMode("signin");
                setErrorMessage(null);
              },
            },
          });
        } else {
          setErrorMessage(error.message);
          toast.error(error.message);
        }
        return;
      }

      if (data.session) {
        toast.success("Account created successfully!");
        navigate({ to: redirectUrl, replace: true });
      } else if (data.user) {
        setEmailConfirmationSent(true);
        toast.success("Account created! Check your email to confirm.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create account. Please try again.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-2">
      {/* Left: form */}
      <div className="flex flex-col min-h-screen lg:min-h-0">
        <header className="px-6 lg:px-10 py-5 flex items-center justify-between border-b border-border">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoUrl} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Stuccord <span className="text-primary">Motion</span>
            </span>
          </Link>
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to site
          </Link>
        </header>

        <main className="flex-1 grid place-items-center px-6 lg:px-10 py-8">
          <div className="w-full max-w-sm">
            {/* Badge */}
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted-foreground mb-6">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              {emailConfirmationSent
                ? "Verify your email"
                : mode === "code"
                ? "Two-factor sign-in"
                : mode === "forgot"
                ? "Reset your password"
                : mode === "signin"
                ? "Welcome back"
                : "Free to start"}
            </div>

            {emailConfirmationSent ? (
              /* Email confirmation notice */
              <div className="space-y-5 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/15 text-primary grid place-items-center mx-auto">
                  <MailCheck className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
                    Check your email
                  </h1>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    We sent a confirmation link to{" "}
                    <span className="font-semibold text-foreground">{email}</span>.
                    Click the link in your email to activate your account and start editing.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setEmailConfirmationSent(false);
                      setMode("signin");
                      setPassword("");
                      setConfirmPassword("");
                      setErrorMessage(null);
                    }}
                  >
                    Back to Sign In
                  </Button>
                </div>
              </div>
            ) : mode === "code" ? (
              /* Two-factor: the code from the authenticator app */
              <div>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  Enter your code
                </h1>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  Open your authenticator app and type the 6-digit code for Stuccord Motion.
                </p>
                {errorMessage && (
                  <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
                    {errorMessage}
                  </div>
                )}
                <form onSubmit={handleCode} className="space-y-4 mt-6">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="123456"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="h-12 text-center text-lg tracking-[0.4em] font-mono"
                    aria-label="6-digit code"
                    disabled={loading}
                  />
                  <Button type="submit" className="w-full h-11 font-medium" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                </form>
                <p className="mt-6 text-sm text-muted-foreground text-center">
                  Not you?{" "}
                  <button
                    type="button"
                    className="text-foreground font-semibold hover:underline underline-offset-4"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setMode("signin");
                      setCode("");
                      setErrorMessage(null);
                    }}
                  >
                    Sign in with another account
                  </button>
                </p>
              </div>
            ) : mode === "forgot" ? (
              /* Forgot password: email a reset link */
              <div>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  Reset your password
                </h1>
                {resetSent ? (
                  <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                    If there&apos;s an account for{" "}
                    <span className="font-semibold text-foreground">{email}</span>, we&apos;ve
                    sent it a link to set a new password. It can take a minute to arrive; check
                    your spam folder too.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                      We&apos;ll email you a link to set a new one.
                    </p>
                    {errorMessage && (
                      <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
                        {errorMessage}
                      </div>
                    )}
                    <form onSubmit={handleForgot} className="space-y-4 mt-6">
                      <div className="space-y-1.5">
                        <Label htmlFor="reset-email" className="text-xs font-medium text-foreground">
                          Email
                        </Label>
                        <Input
                          id="reset-email"
                          type="email"
                          autoComplete="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="h-11"
                          disabled={loading}
                        />
                      </div>
                      <Button type="submit" className="w-full h-11 font-medium" disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
                      </Button>
                    </form>
                  </>
                )}
                <p className="mt-6 text-sm text-muted-foreground text-center">
                  <button
                    type="button"
                    className="text-foreground font-semibold hover:underline underline-offset-4"
                    onClick={() => {
                      setMode("signin");
                      setResetSent(false);
                      setErrorMessage(null);
                    }}
                  >
                    Back to sign in
                  </button>
                </p>
              </div>
            ) : (
              /* Sign In / Sign Up Form */
              <>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  {mode === "signin" ? "Sign in to your studio" : "Create your studio"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {mode === "signin"
                    ? "Pick up where you left off."
                    : "Ship your first cinematic short in under 5 minutes."}
                </p>

                {errorMessage && (
                  <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
                    {errorMessage}
                  </div>
                )}

                <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-4 mt-6">
                  {/* Email */}
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium text-foreground">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11"
                      disabled={loading}
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-xs font-medium text-foreground">
                        Password
                      </Label>
                      {mode === "signin" && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setMode("forgot");
                            setErrorMessage(null);
                          }}
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPw ? "text" : "password"}
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                        required
                        minLength={mode === "signup" ? 8 : undefined}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 pr-10"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        tabIndex={-1}
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password (Sign up only) */}
                  {mode === "signup" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmPassword" className="text-xs font-medium text-foreground">
                        Confirm password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPw ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="Re-enter your password"
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="h-11 pr-10"
                          disabled={loading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPw((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          tabIndex={-1}
                          aria-label={showConfirmPw ? "Hide password" : "Show password"}
                        >
                          {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Submit button */}
                  <Button
                    type="submit"
                    className="w-full h-11 font-medium shadow-sm cursor-pointer"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : mode === "signin" ? (
                      "Sign in"
                    ) : (
                      "Create free account"
                    )}
                  </Button>
                </form>

                {/* Mode toggle */}
                <p className="mt-6 text-sm text-muted-foreground text-center">
                  {mode === "signin" ? "New to Stuccord?" : "Already have an account?"}{" "}
                  <button
                    type="button"
                    className="text-foreground font-semibold hover:underline underline-offset-4 transition-colors cursor-pointer"
                    onClick={() => {
                      setMode(mode === "signin" ? "signup" : "signin");
                      setErrorMessage(null);
                      setPassword("");
                      setConfirmPassword("");
                    }}
                  >
                    {mode === "signin" ? "Create free account" : "Sign in"}
                  </button>
                </p>

                <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground text-center">
                  By continuing you agree to our{" "}
                  <span className="underline underline-offset-2 text-foreground">Terms</span> and{" "}
                  <span className="underline underline-offset-2 text-foreground">Privacy Policy</span>.
                </p>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Right: brand panel */}
      <div className="hidden lg:block relative overflow-hidden bg-foreground">
        <img
          src={editingDesk}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/90 via-foreground/60 to-primary/70" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,color-mix(in_oklab,var(--color-primary)_30%,transparent),transparent_55%)]" />

        <div className="relative h-full flex flex-col justify-between p-12 text-background">
          <div className="text-background/60 text-xs font-medium">Stuccord Motion</div>

          <div className="max-w-md space-y-8">
            <p className="text-[24px] leading-[1.35] font-medium tracking-tight text-background/90">
              Drop in your footage, shape it on the timeline, and export a short with captions
              and music.
            </p>

            <ul className="space-y-3 pt-6 border-t border-background/15">
              {perks.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-background/80">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-primary/25 grid place-items-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-background" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-6 text-[11px] text-background/40 uppercase tracking-wider">
            <span>9:16 · 16:9 · 1:1</span>
            <span>Up to 4K in the browser</span>
          </div>
        </div>
      </div>
    </div>
  );
}
