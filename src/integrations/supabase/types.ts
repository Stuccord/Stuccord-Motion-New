export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clips: {
        Row: {
          created_at: string
          duration_ms: number | null
          filename: string
          id: string
          ordinal: number
          parent_clip_id: string | null
          project_id: string
          role: Database["public"]["Enums"]["clip_role"]
          size_bytes: number | null
          storage_path: string
          trim_in_ms: number
          trim_out_ms: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          filename: string
          id?: string
          ordinal?: number
          parent_clip_id?: string | null
          project_id: string
          role?: Database["public"]["Enums"]["clip_role"]
          size_bytes?: number | null
          storage_path: string
          trim_in_ms?: number
          trim_out_ms?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          filename?: string
          id?: string
          ordinal?: number
          parent_clip_id?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["clip_role"]
          size_bytes?: number | null
          storage_path?: string
          trim_in_ms?: number
          trim_out_ms?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clips_parent_clip_id_fkey"
            columns: ["parent_clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          aspect_ratio: Database["public"]["Enums"]["aspect_ratio"]
          brief: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          output_path: string | null
          script: string | null
          status: Database["public"]["Enums"]["project_status"]
          style_preset: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: Database["public"]["Enums"]["aspect_ratio"]
          brief?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          output_path?: string | null
          script?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          style_preset?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: Database["public"]["Enums"]["aspect_ratio"]
          brief?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          output_path?: string | null
          script?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          style_preset?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      render_jobs: {
        Row: {
          created_at: string
          edit_plan: Json | null
          error: string | null
          id: string
          output_path: string | null
          progress: number
          project_id: string
          stage_message: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          edit_plan?: Json | null
          error?: string | null
          id?: string
          output_path?: string | null
          progress?: number
          project_id: string
          stage_message?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          edit_plan?: Json | null
          error?: string | null
          id?: string
          output_path?: string | null
          progress?: number
          project_id?: string
          stage_message?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      aspect_ratio: "9:16" | "16:9" | "1:1"
      clip_role: "auto" | "aroll" | "broll" | "music" | "sfx"
      job_status:
        | "queued"
        | "transcribing"
        | "planning"
        | "rendering"
        | "completed"
        | "failed"
      project_status: "draft" | "queued" | "processing" | "ready" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      aspect_ratio: ["9:16", "16:9", "1:1"],
      clip_role: ["auto", "aroll", "broll", "music", "sfx"],
      job_status: [
        "queued",
        "transcribing",
        "planning",
        "rendering",
        "completed",
        "failed",
      ],
      project_status: ["draft", "queued", "processing", "ready", "failed"],
    },
  },
} as const
