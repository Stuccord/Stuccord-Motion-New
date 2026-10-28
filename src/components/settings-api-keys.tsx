// Settings > API keys: make a key (read-only or full access), see it once to
// copy it, and revoke keys. The API is described in Help (API section).

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  API_KEY_LIMIT,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRow,
  type ApiKeyScope,
} from "@/lib/api-keys.functions";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Never";

export function ApiKeySettings() {
  const qc = useQueryClient();
  const fetchKeys = useServerFn(listApiKeys);
  const makeKey = useServerFn(createApiKey);
  const dropKey = useServerFn(revokeApiKey);
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => fetchKeys(), retry: false });

  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("full");
  const [made, setMade] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const create = useMutation({
    mutationFn: () => makeKey({ data: { name: name.trim(), scope } }),
    onSuccess: (r) => {
      setMade({ key: r.key, name: r.row.name });
      setCopied(false);
      setName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => dropKey({ data: { id } }),
    onSuccess: () => {
      toast.success("Key revoked: it stopped working straight away");
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.key);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy: select the key and copy it yourself");
    }
  };

  const list = keys.data ?? [];
  const full = list.length >= API_KEY_LIMIT;

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-600">
        Use a key in your own scripts to make projects, upload clips, start exports and download
        them. See the{" "}
        <Link to="/help" hash="api" className="text-violet-700 font-medium underline">
          API guide in Help
        </Link>
        . Treat a key like a password: anyone with it can use your workspace.
      </p>

      {made && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 space-y-2">
          <div className="text-sm font-semibold text-emerald-900">Your new key “{made.name}”</div>
          <p className="text-[13px] text-emerald-900/80">
            Copy it now. It won&apos;t be shown again; if you lose it, revoke it and make a new one.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={made.key}
              aria-label="Your new API key"
              className="font-mono text-xs bg-white"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="outline" onClick={() => void copy()} className="shrink-0">
              {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-emerald-900"
            onClick={() => setMade(null)}
          >
            I&apos;ve saved it
          </Button>
        </div>
      )}

      <form
        className="rounded-xl border border-black/10 p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !full) create.mutate();
        }}
      >
        <div className="text-sm font-semibold">New key</div>
        <div className="space-y-1.5">
          <Label htmlFor="api-key-name">Name</Label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="e.g. Upload script"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Access</Label>
          <div role="radiogroup" aria-label="Access" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["full", "Full access", "Make projects, upload clips, start exports"],
                ["read", "Read only", "See projects and exports, download videos"],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition",
                  scope === value
                    ? "border-violet-500 bg-violet-50"
                    : "border-black/10 hover:border-black/20",
                )}
              >
                <div className="text-[13px] font-medium">{label}</div>
                <div className="text-[11px] text-neutral-500">{hint}</div>
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={!name.trim() || create.isPending || full}>
          {create.isPending ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <KeyRound className="w-4 h-4 mr-1.5" />
          )}
          Make key
        </Button>
        {full && (
          <p className="text-[12px] text-neutral-500">
            You have {API_KEY_LIMIT} keys, the most allowed. Revoke one to make another.
          </p>
        )}
      </form>

      <div className="space-y-2">
        <div className="text-sm font-semibold">Your keys</div>
        {keys.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : keys.error ? (
          <p className="text-sm text-rose-600">
            {keys.error instanceof Error ? keys.error.message : "Couldn't load your keys"}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-neutral-500">No keys yet.</p>
        ) : (
          <div className="rounded-xl border border-black/10 divide-y divide-black/5">
            {list.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{k.name}</div>
                  <div className="text-[11px] text-neutral-500">
                    <span className="font-mono">{k.prefix}…</span> ·{" "}
                    {k.scope === "full" ? "Full access" : "Read only"} · made {when(k.created_at)} ·
                    last used {when(k.last_used_at)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  onClick={() => setRevoking(k)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using this key stops working straight away. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault();
                if (revoking) revoke.mutate(revoking.id);
              }}
            >
              {revoke.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
