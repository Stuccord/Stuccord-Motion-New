import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { readPrefs, savePrefs, type NotificationPrefs } from "@/lib/notification-prefs";
import { SecuritySettings } from "@/components/settings-security";
import { BrandKitSettings } from "@/components/settings-brand-kit";
import { ApiKeySettings } from "@/components/settings-api-keys";
import { TeamSettings } from "@/components/settings-teams";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { User, Palette, Bell, Shield, KeyRound, Users } from "lucide-react";

const TABS = ["profile", "brand", "teams", "notifications", "security", "api"] as const;

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Stuccord Motion" }] }),
  // ?tab=notifications opens that tab (e.g. from the bell).
  validateSearch: (s: Record<string, unknown>): { tab?: (typeof TABS)[number] } => ({
    tab: TABS.includes(s.tab as (typeof TABS)[number])
      ? (s.tab as (typeof TABS)[number])
      : undefined,
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { tab } = Route.useSearch();
  const [email, setEmail] = useState<string>("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setDisplayName((data.user?.user_metadata?.full_name as string) ?? data.user?.email?.split("@")[0] ?? "");
    });
  }, []);

  async function saveProfile() {
    const { error } = await supabase.auth.updateUser({ data: { full_name: displayName } });
    if (error) toast.error(error.message);
    else toast.success("Profile updated");
  }

  return (
    <AppShell title="Settings" subtitle="Personalise your workspace, brand and notifications.">
      <Tabs defaultValue={tab ?? "profile"} className="flex flex-col lg:flex-row gap-6">
        <TabsList className="flex flex-row lg:flex-col h-auto bg-transparent gap-1 lg:w-52 shrink-0 justify-start p-0">
          {[
            { value: "profile", label: "Profile", icon: User },
            { value: "brand", label: "Brand kit", icon: Palette },
            { value: "teams", label: "Teams", icon: Users },
            { value: "notifications", label: "Notifications", icon: Bell },
            { value: "security", label: "Security", icon: Shield },
            { value: "api", label: "API keys", icon: KeyRound },
          ].map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="w-full justify-start gap-2.5 px-3 py-2 text-[13px] font-medium rounded-lg data-[state=active]:bg-neutral-900 data-[state=active]:text-white data-[state=inactive]:text-neutral-600 data-[state=inactive]:hover:bg-neutral-100 data-[state=inactive]:hover:text-neutral-900"
            >
              <t.icon className="w-4 h-4 shrink-0" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 space-y-6">
          {/* Profile */}
          <TabsContent value="profile" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Profile</CardTitle>
                <CardDescription>How you show up across Stuccord.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="display-name" className="text-xs font-medium text-neutral-700">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="bg-white border-black/10 focus:border-black/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium text-neutral-700">Email</Label>
                  <Input
                    id="email"
                    value={email}
                    disabled
                    className="bg-neutral-50 border-black/10 text-neutral-500"
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={saveProfile}>Save changes</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Brand kit */}
          <TabsContent value="brand" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Brand kit</CardTitle>
                <CardDescription>
                  Your captions&apos; font, colours, size and place, and a logo on every export.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BrandKitSettings />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
                <CardDescription>
                  What the bell (and a pop-up) tells you about while you&apos;re in the app.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <NotificationSettings />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security */}
          <TabsContent value="security" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Security</CardTitle>
                <CardDescription>Password, sessions and two-factor.</CardDescription>
              </CardHeader>
              <CardContent>
                <SecuritySettings />
              </CardContent>
            </Card>
          </TabsContent>

          {/* API keys */}
          <TabsContent value="api" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">API keys</CardTitle>
                <CardDescription>Use your workspace from your own scripts.</CardDescription>
              </CardHeader>
              <CardContent>
                <ApiKeySettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teams" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Teams</CardTitle>
                <CardDescription>Make a team and invite people to it.</CardDescription>
              </CardHeader>
              <CardContent>
                <TeamSettings />
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  );
}

/** Which notifications to get, saved on the account as soon as they change. */
function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setPrefs(readPrefs(data.user?.user_metadata)));
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  async function change(next: NotificationPrefs) {
    const before = prefs;
    setPrefs(next);
    try {
      await savePrefs(next);
    } catch (e) {
      setPrefs(before);
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    }
  }

  async function toggleDesktop(on: boolean) {
    if (!prefs) return;
    if (on && permission !== "granted") {
      if (permission === "unsupported") return;
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        toast.error("Your browser blocked notifications for this site.", {
          description: "Allow them in the browser's site settings, then try again.",
        });
        return;
      }
    }
    await change({ ...prefs, desktop: on });
  }

  if (!prefs) return <div className="text-sm text-neutral-500 py-3">Loading…</div>;
  const rows: { label: string; desc: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }[] = [
    {
      label: "Export finished",
      desc: "When a video is ready to watch or download.",
      on: prefs.exportDone,
      set: (v) => change({ ...prefs, exportDone: v }),
    },
    {
      label: "Export failed",
      desc: "So you can fix it and try again.",
      on: prefs.exportFailed,
      set: (v) => change({ ...prefs, exportFailed: v }),
    },
    {
      label: "Desktop notifications",
      desc:
        permission === "unsupported"
          ? "This browser doesn't support desktop notifications."
          : permission === "denied"
            ? "Blocked in your browser: allow notifications for this site in its settings."
            : "Also tell me when the app is in another tab or window.",
      on: prefs.desktop && permission === "granted",
      set: (v) => void toggleDesktop(v),
      disabled: permission === "unsupported" || permission === "denied",
    },
  ];
  return (
    <div className="divide-y divide-black/5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-3">
          <div>
            <div className="text-sm font-medium">{r.label}</div>
            <div className="text-xs text-neutral-500 mt-0.5">{r.desc}</div>
          </div>
          <Switch checked={r.on} onCheckedChange={r.set} disabled={r.disabled} aria-label={r.label} />
        </div>
      ))}
      <p className="pt-3 text-xs text-neutral-500">
        Email notifications aren&apos;t available yet.
      </p>
    </div>
  );
}
