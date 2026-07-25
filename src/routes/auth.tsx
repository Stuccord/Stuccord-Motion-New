import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useUser, useSignIn, useSignUp } from "@clerk/clerk-react";
import { ArrowLeft, Check, Loader2, Sparkles, Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
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

  const { isLoaded: userLoaded, isSignedIn } = useUser();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();

  useEffect(() => {
    if (userLoaded && isSignedIn) {
      navigate({ to: redirectUrl, replace: true });
    }
  }, [userLoaded, isSignedIn, redirectUrl, navigate]);

  if (userLoaded && isSignedIn) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">You are already signed in. Redirecting to studio…</p>
        </div>
      </div>
    );
  }

  const perks = [
    "5 free cinematic renders every month",
    "Auto-captions, B-roll, and score included",
    "Publish to TikTok, Reels & Shorts in one click",
  ];

  async function handleGoogleSignIn() {
    if (!signInLoaded || !signIn) return;
    setLoading(true);
    try {
      const origin = window.location.origin.startsWith("http")
        ? window.location.origin
        : `http://${window.location.host}`;
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${origin}/sso-callback`,
        redirectUrlComplete: `${origin}${redirectUrl}`,
      });
    } catch (err: any) {
      toast.error(err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || "Google sign-in failed");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "signin") {
        if (!signInLoaded || !signIn) {
          toast.error("Auth not ready yet — please wait a moment.");
          setLoading(false);
          return;
        }
        const result = await signIn.create({ identifier: email, password });
        if (result.status === "complete") {
          await setSignInActive({ session: result.createdSessionId });
          navigate({ to: redirectUrl, replace: true });
        } else {
          toast.info("Additional verification required.");
        }
      } else {
        if (!signUpLoaded || !signUp) {
          toast.error("Auth not ready yet — please wait a moment.");
          setLoading(false);
          return;
        }
        const result = await signUp.create({ emailAddress: email, password });
        if (result.status === "complete") {
          await setSignUpActive({ session: result.createdSessionId });
          navigate({ to: redirectUrl, replace: true });
        } else {
          await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
          setPendingVerification(true);
          toast.success("Verification code sent to your email!");
        }
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      const firstErr = err?.errors?.[0];
      const errCode = firstErr?.code;
      const msg = firstErr?.longMessage || firstErr?.message || err?.message || "Something went wrong";
      
      if (mode === "signin" && (errCode === "form_identifier_not_found" || msg.toLowerCase().includes("couldn't find"))) {
        toast.error("No account found with this email", {
          description: "Would you like to create a free account instead?",
          action: {
            label: "Sign Up",
            onClick: () => setMode("signup"),
          },
        });
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!signUpLoaded || !signUp) return;
    setLoading(true);

    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        await setSignUpActive({ session: result.createdSessionId });
        toast.success("Account verified successfully!");
        navigate({ to: redirectUrl, replace: true });
      } else {
        toast.error("Verification incomplete. Please check the code and try again.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || "Invalid verification code";
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
              {pendingVerification
                ? "Verify your email"
                : mode === "signin"
                ? "Welcome back"
                : "Join 12,400+ creators"}
            </div>

            {pendingVerification ? (
              /* Email Code Verification Step */
              <div className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
                    Check your email
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    We sent a 6-digit verification code to{" "}
                    <span className="font-semibold text-foreground">{email}</span>.
                  </p>
                </div>

                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="code" className="text-xs font-medium text-foreground">
                      Verification code
                    </Label>
                    <div className="relative">
                      <Input
                        id="code"
                        type="text"
                        placeholder="e.g. 566765"
                        required
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.trim())}
                        className="h-12 text-center text-lg font-mono tracking-widest uppercase font-semibold"
                        disabled={loading}
                        autoFocus
                      />
                      <KeyRound className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 font-medium shadow-sm"
                    disabled={loading || code.length < 6}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Verify & Launch Studio"
                    )}
                  </Button>
                </form>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
                    onClick={() => {
                      setPendingVerification(false);
                      setCode("");
                    }}
                  >
                    Use a different email address
                  </button>
                </div>
              </div>
            ) : (
              /* Standard Sign In / Sign Up Form */
              <>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  {mode === "signin" ? "Sign in to your studio" : "Create your studio"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {mode === "signin"
                    ? "Pick up where you left off."
                    : "Ship your first cinematic short in under 5 minutes."}
                </p>

                {/* Google */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-7 h-11 font-medium gap-2.5"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  <GoogleIcon />
                  Continue with Google
                </Button>

                <div className="flex items-center gap-3 my-5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  or with email
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Email/password form */}
                <form onSubmit={handleSubmit} className="space-y-4">
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

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-xs font-medium text-foreground">
                        Password
                      </Label>
                      {mode === "signin" && (
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
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
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 pr-10"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 font-medium shadow-sm"
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
                    className="text-foreground font-semibold hover:underline underline-offset-4 transition-colors"
                    onClick={() => {
                      setMode(mode === "signin" ? "signup" : "signin");
                      setEmail("");
                      setPassword("");
                    }}
                  >
                    {mode === "signin" ? "Create free account" : "Sign in"}
                  </button>
                </p>

                <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground text-center">
                  By continuing you agree to our{" "}
                  <a className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer">
                    Terms
                  </a>{" "}
                  and{" "}
                  <a className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer">
                    Privacy Policy
                  </a>
                  .
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
          <div className="flex items-center gap-2 text-background/60 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Render engine online · 2,431 shorts shipped today
          </div>

          <div className="max-w-md space-y-8">
            <blockquote className="text-[24px] leading-[1.35] font-medium tracking-tight text-background/90">
              "Stuccord replaced a $4k/mo editor. I ship five shorts a week now and my retention
              is up 38%."
            </blockquote>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary grid place-items-center font-semibold text-sm text-primary-foreground shadow-sm">
                MK
              </div>
              <div>
                <div className="text-sm font-medium text-background">Maya Kaur</div>
                <div className="text-xs text-background/55">Creator · 480K subs</div>
              </div>
            </div>

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
            <span>SOC 2 · Type II</span>
            <span>GDPR Ready</span>
            <span>4K Export</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
