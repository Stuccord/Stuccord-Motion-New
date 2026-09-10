import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateInput = z.object({
  title: z.string().trim().min(1).max(120),
  script: z.string().max(20000).optional().nullable(),
  brief: z.string().max(4000).optional().nullable(),
  style_preset: z.string().max(64).default("gadzhi"),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        title: data.title,
        script: data.script ?? null,
        brief: data.brief ?? null,
        style_preset: data.style_preset,
        aspect_ratio: data.aspect_ratio,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getUsageStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const start30 = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    const start30Iso = new Date(start30.getFullYear(), start30.getMonth(), start30.getDate()).toISOString();

    const [{ data: projects }, { data: jobs30 }, { data: jobsMonth }] = await Promise.all([
      context.supabase.from("projects").select("id, aspect_ratio, style_preset, status, created_at, duration_seconds"),
      context.supabase
        .from("render_jobs")
        .select("id, status, created_at, updated_at")
        .gte("created_at", start30Iso),
      context.supabase
        .from("render_jobs")
        .select("id, status, created_at")
        .gte("created_at", startOfMonth),
    ]);

    const projectsList = projects ?? [];
    const jobs30List = jobs30 ?? [];
    const jobsMonthList = jobsMonth ?? [];

    // 30-day daily series of completed renders
    const days: { date: string; renders: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ date: iso, renders: 0 });
    }
    for (const j of jobs30List) {
      const iso = new Date(j.created_at).toISOString().slice(0, 10);
      const bucket = days.find((d) => d.date === iso);
      if (bucket) bucket.renders += 1;
    }

    // Format mix from projects
    const ratioCounts: Record<string, number> = { "9:16": 0, "16:9": 0, "1:1": 0 };
    for (const p of projectsList) ratioCounts[p.aspect_ratio] = (ratioCounts[p.aspect_ratio] ?? 0) + 1;
    const totalRatio = Object.values(ratioCounts).reduce((a, b) => a + b, 0);
    const formatMix = (["9:16", "16:9", "1:1"] as const).map((r) => ({
      ratio: r,
      count: ratioCounts[r] ?? 0,
      pct: totalRatio > 0 ? Math.round(((ratioCounts[r] ?? 0) / totalRatio) * 100) : 0,
    }));

    // Preset mix
    const presetCounts: Record<string, number> = {};
    for (const p of projectsList) presetCounts[p.style_preset] = (presetCounts[p.style_preset] ?? 0) + 1;
    const topPreset = Object.entries(presetCounts).sort((a, b) => b[1] - a[1])[0] ?? null;

    // Minutes rendered (sum duration_seconds of ready projects, fallback 30s each)
    const readyProjects = projectsList.filter((p) => p.status === "ready");
    const totalSeconds = readyProjects.reduce((sum, p) => sum + (p.duration_seconds ?? 30), 0);
    const totalMinutes = Math.round(totalSeconds / 60);

    const rendersThisMonth = jobsMonthList.filter(
      (j) => j.status === "completed" || j.status === "rendering" || j.status === "planning" || j.status === "transcribing" || j.status === "queued",
    ).length;

    return {
      totalProjects: projectsList.length,
      readyProjects: readyProjects.length,
      totalMinutes,
      rendersThisMonth,
      renderCap: 5,
      days,
      formatMix,
      topPreset: topPreset ? { preset: topPreset[0], count: topPreset[1] } : null,
    };
  });

export const listAllClips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clips")
      .select("id, filename, size_bytes, role, created_at, storage_path, project_id, projects!inner(title, aspect_ratio)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((c) => ({
      id: c.id,
      filename: c.filename,
      size_bytes: c.size_bytes,
      role: c.role,
      created_at: c.created_at,
      storage_path: c.storage_path,
      project_id: c.project_id,
      project_title: (c.projects as unknown as { title: string })?.title ?? "Untitled",
      aspect_ratio: (c.projects as unknown as { aspect_ratio: string })?.aspect_ratio ?? "9:16",
    }));
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: project, error: pErr }, { data: clips, error: cErr }, { data: jobs, error: jErr }] =
      await Promise.all([
        context.supabase.from("projects").select("*").eq("id", data.id).maybeSingle(),
        context.supabase
          .from("clips")
          .select("*")
          .eq("project_id", data.id)
          .order("ordinal", { ascending: true }),
        context.supabase
          .from("render_jobs")
          .select("*")
          .eq("project_id", data.id)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
    if (pErr) throw new Error(pErr.message);
    if (cErr) throw new Error(cErr.message);
    if (jErr) throw new Error(jErr.message);
    if (!project) throw new Error("Project not found");
    return { project, clips: clips ?? [], latestJob: jobs?.[0] ?? null };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AttachClipInput = z.object({
  project_id: z.string().uuid(),
  storage_path: z.string().min(1),
  filename: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  role: z.enum(["auto", "aroll", "broll", "music", "sfx"]).default("auto"),
  ordinal: z.number().int().nonnegative().default(0),
  duration_ms: z.number().int().nonnegative().optional(),
  trim_in_ms: z.number().int().nonnegative().optional(),
  trim_out_ms: z.number().int().nonnegative().optional(),
  parent_clip_id: z.string().uuid().optional(),
});

export const attachClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AttachClipInput.parse(d))
  .handler(async ({ data, context }) => {
    const insert = {
      project_id: data.project_id,
      user_id: context.userId,
      storage_path: data.storage_path,
      filename: data.filename,
      size_bytes: data.size_bytes,
      role: data.role,
      ordinal: data.ordinal,
      trim_in_ms: data.trim_in_ms ?? 0,
      trim_out_ms: data.trim_out_ms ?? null,
      duration_ms: data.duration_ms ?? null,
      parent_clip_id: data.parent_clip_id ?? null,
    };
    const { data: row, error } = await context.supabase
      .from("clips")
      .insert(insert)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


export const removeClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // If this clip has siblings sharing the same source (via parent_clip_id),
    // leave the storage object in place so those siblings still play.
    const { data: clip } = await context.supabase
      .from("clips")
      .select("storage_path, parent_clip_id, id")
      .eq("id", data.id)
      .single();
    if (clip?.storage_path) {
      const sourceId = clip.parent_clip_id ?? clip.id;
      const { count } = await context.supabase
        .from("clips")
        .select("id", { count: "exact", head: true })
        .or(`id.eq.${sourceId},parent_clip_id.eq.${sourceId}`);
      const remainingAfterDelete = (count ?? 0) - 1;
      if (remainingAfterDelete <= 0) {
        await context.supabase.storage.from("raw-clips").remove([clip.storage_path]);
      }
    }
    const { error } = await context.supabase.from("clips").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateClipOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        order: z.array(
          z.object({
            id: z.string().uuid(),
            ordinal: z.number().int().nonnegative(),
            role: z.enum(["auto", "aroll", "broll", "music", "sfx"]).optional(),
          })
        ),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    for (const item of data.order) {
      const updateData: { ordinal: number; role?: "auto" | "aroll" | "broll" | "music" | "sfx" } = { ordinal: item.ordinal };
      if (item.role) updateData.role = item.role;
      const { error } = await context.supabase
        .from("clips")
        .update(updateData)
        .eq("id", item.id)
        .eq("project_id", data.project_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const updateClipTrim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        trim_in_ms: z.number().int().nonnegative(),
        trim_out_ms: z.number().int().nonnegative().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clips")
      .update({ trim_in_ms: data.trim_in_ms, trim_out_ms: data.trim_out_ms })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateClipDuration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), duration_ms: z.number().int().nonnegative() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clips")
      .update({ duration_ms: data.duration_ms })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const splitClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), at_ms: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Load the source clip
    const { data: src, error: sErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sErr || !src) throw new Error("Clip not found");
    const trimIn = src.trim_in_ms ?? 0;
    const trimOut = src.trim_out_ms ?? src.duration_ms ?? null;
    const cutAbs = trimIn + data.at_ms; // absolute ms into source
    if (trimOut != null && (cutAbs <= trimIn + 50 || cutAbs >= trimOut - 50)) {
      throw new Error("Split point too close to a clip edge");
    }

    // Shift ordinals of everything after src.ordinal in this project by +1
    const { data: laterClips } = await context.supabase
      .from("clips")
      .select("id, ordinal")
      .eq("project_id", src.project_id)
      .gt("ordinal", src.ordinal);
    for (const c of laterClips ?? []) {
      await context.supabase
        .from("clips")
        .update({ ordinal: c.ordinal + 1 })
        .eq("id", c.id);
    }

    // Second half insert
    const { data: right, error: rErr } = await context.supabase
      .from("clips")
      .insert({
        project_id: src.project_id,
        user_id: context.userId,
        storage_path: src.storage_path,
        filename: src.filename,
        size_bytes: src.size_bytes,
        role: src.role,
        ordinal: src.ordinal + 1,
        duration_ms: src.duration_ms,
        trim_in_ms: cutAbs,
        trim_out_ms: trimOut,
        parent_clip_id: src.parent_clip_id ?? src.id,
      })
      .select("*")
      .single();
    if (rErr) throw new Error(rErr.message);

    // Update left half's trim_out
    const { error: uErr } = await context.supabase
      .from("clips")
      .update({ trim_out_ms: cutAbs })
      .eq("id", src.id);
    if (uErr) throw new Error(uErr.message);

    return { left_id: src.id, right_id: right.id };
  });

export const duplicateClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: src, error: sErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sErr || !src) throw new Error("Clip not found");

    const { data: laterClips } = await context.supabase
      .from("clips")
      .select("id, ordinal")
      .eq("project_id", src.project_id)
      .gt("ordinal", src.ordinal);
    for (const c of laterClips ?? []) {
      await context.supabase
        .from("clips")
        .update({ ordinal: c.ordinal + 1 })
        .eq("id", c.id);
    }

    const { data: copy, error: iErr } = await context.supabase
      .from("clips")
      .insert({
        project_id: src.project_id,
        user_id: context.userId,
        storage_path: src.storage_path,
        filename: src.filename,
        size_bytes: src.size_bytes,
        role: src.role,
        ordinal: src.ordinal + 1,
        duration_ms: src.duration_ms,
        trim_in_ms: src.trim_in_ms ?? 0,
        trim_out_ms: src.trim_out_ms,
        parent_clip_id: src.parent_clip_id ?? src.id,
      })
      .select("*")
      .single();
    if (iErr) throw new Error(iErr.message);
    return copy;
  });


export const updateProjectSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        aspect_ratio: z.enum(["9:16", "16:9", "1:1"]).optional(),
        style_preset: z.string().max(64).optional(),
        title: z.string().trim().min(1).max(120).optional(),
        script: z.string().max(20000).nullable().optional(),
        brief: z.string().max(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      aspect_ratio?: "9:16" | "16:9" | "1:1";
      style_preset?: string;
      title?: string;
      script?: string | null;
      brief?: string | null;
    } = {};
    if (data.aspect_ratio !== undefined) patch.aspect_ratio = data.aspect_ratio;
    if (data.style_preset !== undefined) patch.style_preset = data.style_preset;
    if (data.title !== undefined) patch.title = data.title;
    if (data.script !== undefined) patch.script = data.script;
    if (data.brief !== undefined) patch.brief = data.brief;
    const { data: row, error } = await context.supabase
      .from("projects")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getClipSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("raw-clips")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

export const getSignedClipUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      project_id: z.string().uuid(),
      filename: z.string().min(1),
      ordinal: z.number().int().nonnegative().default(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const safeName = data.filename.replace(/[^\w.\-]+/g, "_");
    const path = `${context.userId}/${data.project_id}/${Date.now()}_${data.ordinal}_${safeName}`;
    const { data: signed, error } = await context.supabase.storage
      .from("raw-clips")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Failed to create signed upload URL");
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const getRenderSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("renders")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

function resolveWorkerJobsEndpoint(rawUrl: string | undefined): URL {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error("RENDER_WORKER_URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("RENDER_WORKER_URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RENDER_WORKER_URL must use http or https");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[segments.length - 1] !== "jobs") {
    segments.push("jobs");
  }
  parsed.pathname = `/${segments.join("/")}`;
  return parsed;
}

function resolveCallbackWebhookEndpoint(rawBaseUrl: string | undefined): URL {
  if (!rawBaseUrl || !rawBaseUrl.trim()) {
    throw new Error("PUBLIC_APP_URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl.trim());
  } catch {
    throw new Error("PUBLIC_APP_URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use http or https");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const expectedTail = ["api", "public", "render-webhook"];
  const endsWithExpected = expectedTail.every(
    (seg, idx) => segments[segments.length - expectedTail.length + idx] === seg,
  );
  if (!endsWithExpected) {
    segments.push(...expectedTail);
  }
  parsed.pathname = `/${segments.join("/")}`;
  return parsed;
}

export const submitRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Enforce monthly render cap for the current (Starter) tier.
    // Counts every job created this billing month except failed ones so
    // retries after a hard failure don't burn quota.
    const RENDER_CAP = 5;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: usedThisMonth, error: countErr } = await context.supabase
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .neq("status", "failed")
      .gte("created_at", monthStart.toISOString());
    if (countErr) throw new Error(countErr.message);
    if ((usedThisMonth ?? 0) >= RENDER_CAP) {
      throw new Error(
        `You've used all ${RENDER_CAP} renders on the Starter plan this month. Upgrade to Pro for unlimited renders, or wait for your quota to reset on the 1st.`,
      );
    }

    // Verify ownership + fetch payload for worker
    const { data: project, error: pErr } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.project_id)
      .single();
    if (pErr || !project) throw new Error("Project not found");

    const { data: clips, error: cErr } = await context.supabase
      .from("clips")
      .select("*")
      .eq("project_id", data.project_id)
      .order("ordinal", { ascending: true });
    if (cErr) throw new Error(cErr.message);
    if (!clips?.length) throw new Error("Upload at least one clip before rendering");

    // Create job row
    const { data: job, error: jErr } = await context.supabase
      .from("render_jobs")
      .insert({
        project_id: project.id,
        user_id: context.userId,
        status: "queued",
        progress: 0,
        stage_message: "Queued for editing",
      })
      .select("*")
      .single();
    if (jErr) throw new Error(jErr.message);

    await context.supabase
      .from("projects")
      .update({ status: "queued" })
      .eq("id", project.id);

    // Dispatch to external worker with timeout and robust status validation
    try {
      const workerJobsUrl = resolveWorkerJobsEndpoint(process.env.RENDER_WORKER_URL);
      const workerSecret = process.env.RENDER_WORKER_SECRET?.trim();
      if (!workerSecret) {
        throw new Error("RENDER_WORKER_SECRET is not configured");
      }
      const callbackWebhookUrl = resolveCallbackWebhookEndpoint(
        process.env.PUBLIC_APP_URL || process.env.PUBLIC_URL,
      );

      // Presign download URLs for each clip so the worker doesn't need service role.
      const clipUrls = await Promise.all(
        clips.map(async (c) => {
          const { data: signed } = await context.supabase.storage
            .from("raw-clips")
            .createSignedUrl(c.storage_path, 60 * 60 * 6);
          return {
            id: c.id,
            storage_path: c.storage_path,
            filename: c.filename,
            role: c.role,
            ordinal: c.ordinal,
            download_url: signed?.signedUrl ?? null,
            duration_ms: c.duration_ms ?? null,
            trim_in_ms: c.trim_in_ms ?? 0,
            trim_out_ms: c.trim_out_ms ?? null,
            parent_clip_id: c.parent_clip_id ?? null,
          };
        }),
      );

      // Presign an upload URL for the final render output.
      const outputPath = `${context.userId}/${project.id}/${job.id}.mp4`;
      const { data: uploadSigned, error: uploadErr } = await context.supabase.storage
        .from("renders")
        .createSignedUploadUrl(outputPath);
      if (uploadErr) throw new Error(uploadErr.message);

      const payload = {
        job_id: job.id,
        project_id: project.id,
        user_id: context.userId,
        title: project.title,
        script: project.script,
        brief: project.brief,
        style_preset: project.style_preset,
        aspect_ratio: project.aspect_ratio,
        clips: clipUrls,
        output: {
          path: outputPath,
          upload_url: uploadSigned.signedUrl,
          token: uploadSigned.token,
        },
        callback_url: callbackWebhookUrl.toString(),
      };
      const body = JSON.stringify(payload);
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(workerSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
      const signature = Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(workerJobsUrl.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stuccord-signature": signature,
          },
          body,
          signal: controller.signal,
        });
      } catch (fetchErr: unknown) {
        if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
          throw new Error("Render worker connection timed out after 15 seconds");
        }
        throw new Error("Failed to connect to render worker");
      } finally {
        clearTimeout(timeoutId);
      }

      if (res.status !== 202) {
        throw new Error(`Render worker rejected job with HTTP status ${res.status}`);
      }
    } catch (dispatchErr: unknown) {
      const sanitizedError =
        dispatchErr instanceof Error
          ? dispatchErr.message.slice(0, 500)
          : "Cloud render dispatch failed";

      console.error(`[Worker Dispatch Failed] job=${job.id} project=${project.id}`);

      // Safely transition job and project rows to failed so they never stay stuck in queued
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();

        const { data: updatedJobs, error: jErr } = await supabaseAdmin
          .from("render_jobs")
          .update({
            status: "failed",
            stage_message: "Dispatch failed",
            error: sanitizedError,
            updated_at: nowIso,
          })
          .eq("id", job.id)
          .eq("project_id", project.id)
          .eq("user_id", context.userId)
          .select("id");

        if (jErr || !updatedJobs || updatedJobs.length !== 1) {
          console.error(`[Worker Dispatch] Failed to update render job row: ${jErr?.message}`);
        }

        const { data: updatedProjects, error: pErr } = await supabaseAdmin
          .from("projects")
          .update({
            status: "failed",
            updated_at: nowIso,
          })
          .eq("id", project.id)
          .eq("user_id", context.userId)
          .select("id");

        if (pErr || !updatedProjects || updatedProjects.length !== 1) {
          console.error(`[Worker Dispatch] Failed to update project row: ${pErr?.message}`);
        }
      } catch (adminErr) {
        console.error(
          `[Worker Dispatch] Admin failure update error: ${adminErr instanceof Error ? adminErr.message : "unknown"}`,
        );
      }

      throw new Error(
        "Cloud rendering is temporarily unavailable. The job could not be dispatched to the render worker.",
      );
    }

    return job;
  });

/**
 * Client-side render pipeline (browser stitches clips with MediaRecorder).
 * `startBrowserRender` enforces the render cap, creates a job row, mints
 * signed download URLs for every clip, and mints a signed upload URL for
 * the final MP4/WebM in the `renders` bucket.
 */
export const startBrowserRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        ext: z.enum(["mp4", "webm"]).default("mp4"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const RENDER_CAP = 5;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: usedThisMonth } = await context.supabase
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .neq("status", "failed")
      .gte("created_at", monthStart.toISOString());
    if ((usedThisMonth ?? 0) >= RENDER_CAP) {
      throw new Error(
        `You've used all ${RENDER_CAP} renders on the Starter plan this month. Upgrade to Pro for unlimited renders, or wait for your quota to reset on the 1st.`,
      );
    }

    const { data: project, error: pErr } = await context.supabase
      .from("projects")
      .select("id, user_id, aspect_ratio")
      .eq("id", data.project_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (pErr || !project) throw new Error("Project not found");

    const { data: clips, error: cErr } = await context.supabase
      .from("clips")
      .select("id, storage_path, role, ordinal, trim_in_ms, trim_out_ms, duration_ms, filename")
      .eq("project_id", data.project_id)
      .order("ordinal", { ascending: true });
    if (cErr) throw new Error(cErr.message);
    if (!clips || clips.length === 0) throw new Error("Add at least one clip before exporting.");

    const signed = await Promise.all(
      clips.map(async (c) => {
        const { data: s } = await context.supabase.storage
          .from("raw-clips")
          .createSignedUrl(c.storage_path, 60 * 60 * 2);
        return { ...c, download_url: s?.signedUrl ?? null };
      }),
    );
    const missing = signed.filter((c) => !c.download_url);
    if (missing.length) throw new Error("Some clips are unavailable. Try re-uploading.");

    const { data: job, error: jErr } = await context.supabase
      .from("render_jobs")
      .insert({
        project_id: data.project_id,
        user_id: context.userId,
        status: "rendering",
        progress: 5,
        stage_message: "Rendering in browser",
      })
      .select("id")
      .single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Failed to create render job");

    const outputPath = `${context.userId}/${data.project_id}/${job.id}.${data.ext}`;
    const { data: up, error: upErr } = await context.supabase.storage
      .from("renders")
      .createSignedUploadUrl(outputPath);
    if (upErr || !up) throw new Error(upErr?.message ?? "Failed to prepare upload");

    await context.supabase
      .from("projects")
      .update({ status: "processing" })
      .eq("id", data.project_id)
      .eq("user_id", context.userId);

    return {
      job_id: job.id,
      aspect_ratio: project.aspect_ratio,
      clips: signed,
      upload: { path: outputPath, token: up.token },
    };
  });

export const finishBrowserRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        job_id: z.string().uuid("Invalid job ID format"),
        project_id: z.string().uuid("Invalid project ID format"),
        output_path: z.string().min(1).max(500),
        duration_ms: z.number().int().nonnegative().optional(),
        status: z.enum(["completed", "failed"]),
        error: z.string().max(2000).optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // 1. Validate & sanitize payload based on status
    let sanitizedOutputPath: string | null = null;
    let sanitizedError: string | null = null;

    if (data.status === "completed") {
      const rawPath = data.output_path.trim();
      const expectedPrefix = `${context.userId}/${data.project_id}/`;

      if (
        !rawPath.startsWith(expectedPrefix) ||
        rawPath.includes("..") ||
        rawPath.includes("//") ||
        rawPath.startsWith("/") ||
        rawPath.startsWith("\\") ||
        /https?:\/\//i.test(rawPath)
      ) {
        throw new Error("Invalid output path format or unauthorized path prefix");
      }

      const filename = rawPath.slice(expectedPrefix.length);
      if (!/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes("/") || filename.includes("\\")) {
        throw new Error("Invalid output path filename");
      }

      sanitizedOutputPath = rawPath;
    } else {
      const rawError = (data.error ?? "Render failed in browser").trim();
      // Strip control characters and multi-line traces; enforce max 500 characters
      sanitizedError = rawError
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .slice(0, 500);
    }

    // 2. Load trusted server admin client inside handler (never exposed to client bundle)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 3. Verify job ownership before performing any update
    const { data: existingJob, error: jobFetchErr } = await supabaseAdmin
      .from("render_jobs")
      .select("id, project_id, user_id, status, output_path")
      .eq("id", data.job_id)
      .eq("project_id", data.project_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (jobFetchErr || !existingJob) {
      throw new Error("Render job not found or unauthorized");
    }

    // Defense in depth: verify matching project ownership
    const { data: existingProject, error: projectFetchErr } = await supabaseAdmin
      .from("projects")
      .select("id, user_id")
      .eq("id", data.project_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (projectFetchErr || !existingProject) {
      throw new Error("Project not found or unauthorized");
    }

    const nowIso = new Date().toISOString();

    // 4. Perform trusted admin update on render_jobs and verify exactly one row affected
    if (data.status === "completed") {
      const { data: updatedJobs, error: jErr } = await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "completed",
          progress: 100,
          stage_message: "Ready",
          output_path: sanitizedOutputPath,
          error: null,
          updated_at: nowIso,
        })
        .eq("id", data.job_id)
        .eq("project_id", data.project_id)
        .eq("user_id", context.userId)
        .select("id");

      if (jErr || !updatedJobs || updatedJobs.length !== 1) {
        throw new Error(jErr?.message ?? "Failed to update render job row");
      }

      // 5. Update projects row and verify exactly one row affected
      const projectPatch: {
        status: "ready";
        output_path: string;
        updated_at: string;
        duration_seconds?: number;
      } = {
        status: "ready",
        output_path: sanitizedOutputPath!,
        updated_at: nowIso,
      };
      if (data.duration_ms != null) {
        projectPatch.duration_seconds = Math.round(data.duration_ms / 1000);
      }

      const { data: updatedProjects, error: pErr } = await supabaseAdmin
        .from("projects")
        .update(projectPatch)
        .eq("id", data.project_id)
        .eq("user_id", context.userId)
        .select("id");

      if (pErr || !updatedProjects || updatedProjects.length !== 1) {
        throw new Error(pErr?.message ?? "Failed to update project row");
      }
    } else {
      const { data: updatedJobs, error: jErr } = await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          stage_message: "Failed",
          error: sanitizedError,
          updated_at: nowIso,
        })
        .eq("id", data.job_id)
        .eq("project_id", data.project_id)
        .eq("user_id", context.userId)
        .select("id");

      if (jErr || !updatedJobs || updatedJobs.length !== 1) {
        throw new Error(jErr?.message ?? "Failed to update render job row");
      }

      const { data: updatedProjects, error: pErr } = await supabaseAdmin
        .from("projects")
        .update({
          status: "failed",
          updated_at: nowIso,
        })
        .eq("id", data.project_id)
        .eq("user_id", context.userId)
        .select("id");

      if (pErr || !updatedProjects || updatedProjects.length !== 1) {
        throw new Error(pErr?.message ?? "Failed to update project row");
      }
    }

    return { ok: true };
  });

