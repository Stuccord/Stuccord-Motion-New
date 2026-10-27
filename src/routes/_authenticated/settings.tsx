import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { User, Palette, Bell, Shield, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Stuccord Motion" }] }),
  component: SettingsPage,
});

function SettingsPage() {
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
      <Tabs defaultValue="profile" className="flex flex-col lg:flex-row gap-6">
        <TabsList className="flex flex-row lg:flex-col h-auto bg-transparent gap-1 lg:w-52 shrink-0 justify-start p-0">
          {[
            { value: "profile", label: "Profile", icon: User },
            { value: "brand", label: "Brand kit", icon: Palette },
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
                <CardDescription>Your logo, colours and caption font.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotYet what="Saving your brand colours, font and logo and using them on every export" />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
                <CardDescription>Choose what lands in your inbox.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotYet what="Notifications when an export finishes or fails, and choosing which ones you get" />
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
                <NotYet what="Changing your password, two-factor sign-in and deleting your account" />
              </CardContent>
            </Card>
          </TabsContent>

          {/* API keys */}
          <TabsContent value="api" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">API keys</CardTitle>
                <CardDescription>Programmatic access to your workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotYet what="Keys for starting exports from your own scripts" />
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  );
}

/** A part of Settings that isn't built yet, said plainly (no pretend controls). */
function NotYet({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-black/10 bg-neutral-50 p-4 text-sm text-neutral-600">
      <span className="mr-2 rounded-full border border-black/10 bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
        Soon
      </span>
      {what} isn&apos;t available yet. It&apos;s coming in an upcoming update.
    </div>
  );
}
