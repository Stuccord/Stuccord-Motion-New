// Who else has a team project open right now (Supabase Realtime presence).
// Each open editor shares only its user id and display name, on a channel
// named after the project; it's left when the editor closes.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Present = { user_id: string; name: string };

export function useProjectPresence(
  projectId: string,
  enabled: boolean,
  me: Present | null,
): Present[] {
  const [others, setOthers] = useState<Present[]>([]);

  useEffect(() => {
    if (!enabled || !me) {
      setOthers([]);
      return;
    }
    const channel = supabase.channel(`project-presence:${projectId}`, {
      config: { presence: { key: me.user_id } },
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Present>();
      const seen = new Map<string, Present>();
      for (const [key, metas] of Object.entries(state)) {
        const m = metas[0];
        if (key !== me.user_id && m)
          seen.set(key, { user_id: key, name: String(m.name ?? "Someone") });
      }
      setOthers([...seen.values()]);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track({ name: me.name });
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, enabled, me?.user_id, me?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  return others;
}
