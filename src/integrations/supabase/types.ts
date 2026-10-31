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
          start_ms: number | null
          storage_path: string
          thumbnail_path: string | null
          transform: Json | null
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
          start_ms?: number | null
          storage_path: string
          thumbnail_path?: string | null
          transform?: Json | null
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
          start_ms?: number | null
          storage_path?: string
          thumbnail_path?: string | null
          transform?: Json | null
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
          captions_enabled: boolean
          created_at: string
          duration_seconds: number | null
          id: string
          music_enabled: boolean
          motion_plan: Json | null
          motion_character: Json | null
          motion_plan_previous: Json | null
          music_volume: number
          output_path: string | null
          script: string | null
          status: Database["public"]["Enums"]["project_status"]
          style_preset: string
          team_id: string | null
          thumbnail_url: string | null
          title: string
          transcribe_error: string | null
          transcribe_started_at: string | null
          transcribe_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: Database["public"]["Enums"]["aspect_ratio"]
          brief?: string | null
          captions_enabled?: boolean
          created_at?: string
          duration_seconds?: number | null
          id?: string
          music_enabled?: boolean
          motion_plan?: Json | null
          motion_character?: Json | null
          motion_plan_previous?: Json | null
          music_volume?: number
          output_path?: string | null
          script?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          style_preset?: string
          team_id?: string | null
          thumbnail_url?: string | null
          title?: string
          transcribe_error?: string | null
          transcribe_started_at?: string | null
          transcribe_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: Database["public"]["Enums"]["aspect_ratio"]
          brief?: string | null
          captions_enabled?: boolean
          created_at?: string
          duration_seconds?: number | null
          id?: string
          music_enabled?: boolean
          motion_plan?: Json | null
          motion_character?: Json | null
          motion_plan_previous?: Json | null
          music_volume?: number
          output_path?: string | null
          script?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          style_preset?: string
          team_id?: string | null
          thumbnail_url?: string | null
          title?: string
          transcribe_error?: string | null
          transcribe_started_at?: string | null
          transcribe_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scope: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scope: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scope?: string
          user_id?: string
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          access_token_enc: string
          avatar_url: string | null
          created_at: string
          external_id: string
          id: string
          name: string
          platform: string
          refresh_token_enc: string | null
          scopes: string | null
          status: string
          team_id: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_enc: string
          avatar_url?: string | null
          created_at?: string
          external_id: string
          id?: string
          name: string
          platform: string
          refresh_token_enc?: string | null
          scopes?: string | null
          status?: string
          team_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_enc?: string
          avatar_url?: string | null
          created_at?: string
          external_id?: string
          id?: string
          name?: string
          platform?: string
          refresh_token_enc?: string | null
          scopes?: string | null
          status?: string
          team_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          account_id: string | null
          account_name: string
          attempts: number
          caption: string
          comments: number | null
          cover_path: string | null
          created_at: string
          error: string | null
          external_id: string | null
          external_ref: string | null
          external_url: string | null
          id: string
          likes: number | null
          made_for_kids: boolean
          options: Json
          platform: string
          privacy: string
          project_id: string | null
          published_at: string | null
          scheduled_at: string
          stats_updated_at: string | null
          status: string
          team_id: string | null
          title: string
          updated_at: string
          user_id: string
          video_path: string
          views: number | null
        }
        Insert: {
          account_id?: string | null
          account_name: string
          attempts?: number
          caption?: string
          comments?: number | null
          cover_path?: string | null
          created_at?: string
          error?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_url?: string | null
          id?: string
          likes?: number | null
          made_for_kids?: boolean
          options?: Json
          platform: string
          privacy?: string
          project_id?: string | null
          published_at?: string | null
          scheduled_at?: string
          stats_updated_at?: string | null
          status?: string
          team_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
          video_path: string
          views?: number | null
        }
        Update: {
          account_id?: string | null
          account_name?: string
          attempts?: number
          caption?: string
          comments?: number | null
          cover_path?: string | null
          created_at?: string
          error?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_url?: string | null
          id?: string
          likes?: number | null
          made_for_kids?: boolean
          options?: Json
          platform?: string
          privacy?: string
          project_id?: string | null
          published_at?: string | null
          scheduled_at?: string
          stats_updated_at?: string | null
          status?: string
          team_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          video_path?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          revoked_at: string | null
          role: string
          team_id: string
          token_hash: string
          uses: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          revoked_at?: string | null
          role: string
          team_id: string
          token_hash: string
          uses?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: string
          team_id?: string
          token_hash?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          brand_kit: Json
          id: string
          name: string
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          brand_kit?: Json
          id?: string
          name: string
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          brand_kit?: Json
          id?: string
          name?: string
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      tts_usage: {
        Row: {
          characters: number
          created_at: string
          id: string
          project_id: string | null
          user_id: string
          voice_id: string | null
        }
        Insert: {
          characters: number
          created_at?: string
          id?: string
          project_id?: string | null
          user_id: string
          voice_id?: string | null
        }
        Update: {
          characters?: number
          created_at?: string
          id?: string
          project_id?: string | null
          user_id?: string
          voice_id?: string | null
        }
        Relationships: []
      }
      motion_plan_runs: {
        Row: {
          created_at: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          project_id: string | null
          team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          project_id?: string | null
          team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          project_id?: string | null
          team_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      motion_image_runs: {
        Row: {
          created_at: string
          id: string
          model: string | null
          project_id: string | null
          team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string | null
          project_id?: string | null
          team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string | null
          project_id?: string | null
          team_id?: string | null
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
          team_id: string | null
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
          team_id?: string | null
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
          team_id?: string | null
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
      transcripts: {
        Row: {
          created_at: string
          edited: boolean
          id: string
          language: string | null
          model: string | null
          provider: string | null
          storage_path: string
          updated_at: string
          user_id: string
          words: Json
        }
        Insert: {
          created_at?: string
          edited?: boolean
          id?: string
          language?: string | null
          model?: string | null
          provider?: string | null
          storage_path: string
          updated_at?: string
          user_id: string
          words?: Json
        }
        Update: {
          created_at?: string
          edited?: boolean
          id?: string
          language?: string | null
          model?: string | null
          provider?: string | null
          storage_path?: string
          updated_at?: string
          user_id?: string
          words?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      team_role: {
        Args: { team: string }
        Returns: string
      }
      post_is_in_place: {
        Args: { p_team: string; p_user: string; p_account: string; p_video: string; p_cover: string }
        Returns: boolean
      }
    }
    Enums: {
      aspect_ratio: "9:16" | "16:9" | "1:1"
      clip_role: "auto" | "aroll" | "broll" | "music" | "sfx" | "voiceover"
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
      clip_role: ["auto", "aroll", "broll", "music", "sfx", "voiceover"],
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
