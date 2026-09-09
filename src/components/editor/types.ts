export type AspectRatio = "9:16" | "16:9" | "1:1";

export type ClipRow = {
  id: string;
  filename: string;
  role: string;
  ordinal: number;
  size_bytes: number | null;
  storage_path: string;
  duration_seconds?: number | null;
  duration_ms?: number | null;
  trim_in_ms?: number | null;
  trim_out_ms?: number | null;
  parent_clip_id?: string | null;
};

export type ProjectRow = {
  id: string;
  user_id: string;
  title: string;
  script?: string | null;
  brief?: string | null;
  style_preset: string;
  aspect_ratio: AspectRatio;
  status: "draft" | "queued" | "processing" | "ready" | "failed";
  thumbnail_url?: string | null;
  output_path?: string | null;
  duration_seconds?: number | null;
  created_at: string;
  updated_at: string;
};

export type RenderJobRow = {
  id: string;
  project_id: string;
  user_id: string;
  status: "queued" | "transcribing" | "planning" | "rendering" | "completed" | "failed";
  progress: number;
  stage_message?: string | null;
  edit_plan?: any;
  output_path?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

export type ViewMode = "program" | "source" | "compare";
