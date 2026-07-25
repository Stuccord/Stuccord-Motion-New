import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
                <CardDescription>Logo, colors, and font that captions and lower-thirds use by default.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-neutral-700">Primary brand color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" defaultValue="#7C3AED" className="w-12 h-10 rounded-md border border-black/10 cursor-pointer" />
                    <Input defaultValue="#7C3AED" className="flex-1 font-mono bg-white border-black/10 focus:border-black/30" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-neutral-700">Caption font</Label>
                  <select className="w-full h-10 px-3 text-sm bg-white border border-black/10 rounded-md focus:border-black/30 focus:outline-none">
                    <option>Inter</option><option>SF Pro Display</option><option>Space Grotesk</option><option>Poppins</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-neutral-700">Logo</Label>
                  <div className="border-2 border-dashed border-black/10 rounded-lg p-6 text-center text-sm text-neutral-500">
                    Drop SVG or PNG · transparent background recommended
                  </div>
                </div>
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
              <CardContent className="space-y-0 divide-y divide-black/5">
                {[
                  { label: "Render finished", desc: "Ping me when a project is ready to publish.", on: true },
                  { label: "Render failed", desc: "Alert me so I can retry quickly.", on: true },
                  { label: "Weekly digest", desc: "A short recap of your activity every Monday.", on: false },
                  { label: "Product updates", desc: "New features, tips, and templates.", on: true },
                ].map((n) => (
                  <NotificationRow key={n.label} label={n.label} desc={n.desc} defaultOn={n.on} />
                ))}
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
              <CardContent className="space-y-0 divide-y divide-black/5">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">Password</div>
                    <div className="text-xs text-neutral-500 mt-0.5">Rotate every 90 days.</div>
                  </div>
                  <Button variant="outline" size="sm">Change password</Button>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">Two-factor auth</div>
                    <div className="text-xs text-neutral-500 mt-0.5">Add an authenticator app.</div>
                  </div>
                  <Button variant="outline" size="sm">Enable 2FA</Button>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-red-700">Delete account</div>
                    <div className="text-xs text-neutral-500 mt-0.5">This is permanent.</div>
                  </div>
                  <Button variant="outline" size="sm" className="text-red-700 border-red-200 hover:bg-red-50">Delete</Button>
                </div>
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
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-black/10 bg-neutral-50 p-4 text-sm text-neutral-600">
                  No keys yet. Create one to render projects from your own scripts or CI.
                </div>
                <div className="flex justify-end"><Button>Create API key</Button></div>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  );
}

function NotificationRow({ label, desc, defaultOn }: { label: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-neutral-500 mt-0.5">{desc}</div>
      </div>
      <Switch checked={on} onCheckedChange={setOn} />
    </div>
  );
}
