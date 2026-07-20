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
      access_requests: {
        Row: {
          company_name: string | null
          country: string | null
          created_at: string
          email: string
          fleet_size: string | null
          full_name: string
          id: string
          kind: string
          message: string | null
          notes_admin: string | null
          phone: string | null
          referral_code: string | null
          role: string | null
          status: string
        }
        Insert: {
          company_name?: string | null
          country?: string | null
          created_at?: string
          email: string
          fleet_size?: string | null
          full_name: string
          id?: string
          kind?: string
          message?: string | null
          notes_admin?: string | null
          phone?: string | null
          referral_code?: string | null
          role?: string | null
          status?: string
        }
        Update: {
          company_name?: string | null
          country?: string | null
          created_at?: string
          email?: string
          fleet_size?: string | null
          full_name?: string
          id?: string
          kind?: string
          message?: string | null
          notes_admin?: string | null
          phone?: string | null
          referral_code?: string | null
          role?: string | null
          status?: string
        }
        Relationships: []
      }
      admin_activity_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_label: string | null
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          changed_keys: string[] | null
          company_id: string | null
          created_at: string
          id: string
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_label?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_keys?: string[] | null
          company_id?: string | null
          created_at?: string
          id?: string
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_label?: string | null
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_keys?: string[] | null
          company_id?: string | null
          created_at?: string
          id?: string
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      admin_emails: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      admin_portal_settings: {
        Row: {
          ai_cap_behavior: string
          allow_bulk: boolean
          allow_coord_pax_chat: boolean
          default_ai_fallback_to_general: boolean
          default_ai_monthly_cap: number
          default_points_per_booking: number
          default_seat_points: number
          id: number
          max_link_duration_hours: number
          require_approval_within_hours: number
          updated_at: string
          urgency_green_min: number
          urgency_orange_min: number
          urgency_red_min: number
        }
        Insert: {
          ai_cap_behavior?: string
          allow_bulk?: boolean
          allow_coord_pax_chat?: boolean
          default_ai_fallback_to_general?: boolean
          default_ai_monthly_cap?: number
          default_points_per_booking?: number
          default_seat_points?: number
          id?: number
          max_link_duration_hours?: number
          require_approval_within_hours?: number
          updated_at?: string
          urgency_green_min?: number
          urgency_orange_min?: number
          urgency_red_min?: number
        }
        Update: {
          ai_cap_behavior?: string
          allow_bulk?: boolean
          allow_coord_pax_chat?: boolean
          default_ai_fallback_to_general?: boolean
          default_ai_monthly_cap?: number
          default_points_per_booking?: number
          default_seat_points?: number
          id?: number
          max_link_duration_hours?: number
          require_approval_within_hours?: number
          updated_at?: string
          urgency_green_min?: number
          urgency_orange_min?: number
          urgency_red_min?: number
        }
        Relationships: []
      }
      ai_action_audit: {
        Row: {
          action_kind: string
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          company_id: string
          created_at: string
          id: string
          raw_message: string | null
          summary: string | null
          target_id: string | null
          target_ids: string[] | null
          target_table: string
          undo_note: string | null
          undone_at: string | null
        }
        Insert: {
          action_kind: string
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          company_id: string
          created_at?: string
          id?: string
          raw_message?: string | null
          summary?: string | null
          target_id?: string | null
          target_ids?: string[] | null
          target_table: string
          undo_note?: string | null
          undone_at?: string | null
        }
        Update: {
          action_kind?: string
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          company_id?: string
          created_at?: string
          id?: string
          raw_message?: string | null
          summary?: string | null
          target_id?: string | null
          target_ids?: string[] | null
          target_table?: string
          undo_note?: string | null
          undone_at?: string | null
        }
        Relationships: []
      }
      ai_alerts: {
        Row: {
          company_id: string
          created_at: string
          detail: string | null
          dismissed_at: string | null
          driver_id: string | null
          id: string
          job_id: string | null
          kind: string
          severity: string
          suggestion: Json | null
          title: string
        }
        Insert: {
          company_id: string
          created_at?: string
          detail?: string | null
          dismissed_at?: string | null
          driver_id?: string | null
          id?: string
          job_id?: string | null
          kind: string
          severity?: string
          suggestion?: Json | null
          title: string
        }
        Update: {
          company_id?: string
          created_at?: string
          detail?: string | null
          dismissed_at?: string | null
          driver_id?: string | null
          id?: string
          job_id?: string | null
          kind?: string
          severity?: string
          suggestion?: Json | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_alerts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_alerts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_char_overage_settings: {
        Row: {
          company_id: string | null
          created_at: string
          enabled: boolean
          free_char_threshold: number
          id: string
          price_per_char: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          enabled?: boolean
          free_char_threshold?: number
          id?: string
          price_per_char?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          enabled?: boolean
          free_char_threshold?: number
          id?: string
          price_per_char?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_char_overage_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_command_log: {
        Row: {
          actions: Json
          actor_user_id: string | null
          affected_count: number
          applied_at: string | null
          company_id: string
          created_at: string
          error: string | null
          executed_actions: Json | null
          id: string
          mode: string
          prompt: string
          requires_confirmation: boolean
          response: string | null
          status: string
        }
        Insert: {
          actions?: Json
          actor_user_id?: string | null
          affected_count?: number
          applied_at?: string | null
          company_id: string
          created_at?: string
          error?: string | null
          executed_actions?: Json | null
          id?: string
          mode?: string
          prompt: string
          requires_confirmation?: boolean
          response?: string | null
          status?: string
        }
        Update: {
          actions?: Json
          actor_user_id?: string | null
          affected_count?: number
          applied_at?: string | null
          company_id?: string
          created_at?: string
          error?: string | null
          executed_actions?: Json | null
          id?: string
          mode?: string
          prompt?: string
          requires_confirmation?: boolean
          response?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_command_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_configuration: {
        Row: {
          ai_command_enabled: boolean
          auto_assign_enabled: boolean
          auto_coordinate_enabled: boolean
          auto_extract_bulk: boolean
          auto_reply_drafts: boolean
          company_id: string
          created_at: string
          updated_at: string
          voice_to_trip_enabled: boolean
        }
        Insert: {
          ai_command_enabled?: boolean
          auto_assign_enabled?: boolean
          auto_coordinate_enabled?: boolean
          auto_extract_bulk?: boolean
          auto_reply_drafts?: boolean
          company_id: string
          created_at?: string
          updated_at?: string
          voice_to_trip_enabled?: boolean
        }
        Update: {
          ai_command_enabled?: boolean
          auto_assign_enabled?: boolean
          auto_coordinate_enabled?: boolean
          auto_extract_bulk?: boolean
          auto_reply_drafts?: boolean
          company_id?: string
          created_at?: string
          updated_at?: string
          voice_to_trip_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_configuration_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_cost_events: {
        Row: {
          actor_user_id: string | null
          aig_log_id: string | null
          aig_run_id: string | null
          cached_tokens: number
          company_id: string | null
          created_at: string
          duration_ms: number | null
          feature_key: string
          id: string
          input_tokens: number
          job_id: string | null
          model: string | null
          output_tokens: number
          points_charged: number
          real_cost_credits: number
          real_cost_usd_cents: number
          status: string
          surface: string | null
        }
        Insert: {
          actor_user_id?: string | null
          aig_log_id?: string | null
          aig_run_id?: string | null
          cached_tokens?: number
          company_id?: string | null
          created_at?: string
          duration_ms?: number | null
          feature_key: string
          id?: string
          input_tokens?: number
          job_id?: string | null
          model?: string | null
          output_tokens?: number
          points_charged?: number
          real_cost_credits?: number
          real_cost_usd_cents?: number
          status?: string
          surface?: string | null
        }
        Update: {
          actor_user_id?: string | null
          aig_log_id?: string | null
          aig_run_id?: string | null
          cached_tokens?: number
          company_id?: string | null
          created_at?: string
          duration_ms?: number | null
          feature_key?: string
          id?: string
          input_tokens?: number
          job_id?: string | null
          model?: string | null
          output_tokens?: number
          points_charged?: number
          real_cost_credits?: number
          real_cost_usd_cents?: number
          status?: string
          surface?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_cost_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feature_costs: {
        Row: {
          block_on_empty: boolean
          category: string
          enabled: boolean
          est_cost_usd_cents: number | null
          feature_key: string
          is_addon: boolean
          label: string | null
          metering_mode: string
          min_plan_code: string | null
          points_cost: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          block_on_empty?: boolean
          category?: string
          enabled?: boolean
          est_cost_usd_cents?: number | null
          feature_key: string
          is_addon?: boolean
          label?: string | null
          metering_mode?: string
          min_plan_code?: string | null
          points_cost?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          block_on_empty?: boolean
          category?: string
          enabled?: boolean
          est_cost_usd_cents?: number | null
          feature_key?: string
          is_addon?: boolean
          label?: string | null
          metering_mode?: string
          min_plan_code?: string | null
          points_cost?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_insight_clusters: {
        Row: {
          created_at: string
          id: string
          lovable_prompt: string | null
          period_end: string
          period_start: string
          question_count: number
          sample_questions: Json | null
          status: string
          suggested_fix: string | null
          summary: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          lovable_prompt?: string | null
          period_end: string
          period_start: string
          question_count?: number
          sample_questions?: Json | null
          status?: string
          suggested_fix?: string | null
          summary: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          lovable_prompt?: string | null
          period_end?: string
          period_start?: string
          question_count?: number
          sample_questions?: Json | null
          status?: string
          suggested_fix?: string | null
          summary?: string
          title?: string
        }
        Relationships: []
      }
      ai_lesson_feedback: {
        Row: {
          answer_redacted: string | null
          company_id: string | null
          correction_redacted: string | null
          created_at: string
          id: string
          question_redacted: string | null
          route: string | null
          surface: string
          user_id: string | null
          vote: string
        }
        Insert: {
          answer_redacted?: string | null
          company_id?: string | null
          correction_redacted?: string | null
          created_at?: string
          id?: string
          question_redacted?: string | null
          route?: string | null
          surface: string
          user_id?: string | null
          vote: string
        }
        Update: {
          answer_redacted?: string | null
          company_id?: string | null
          correction_redacted?: string | null
          created_at?: string
          id?: string
          question_redacted?: string | null
          route?: string | null
          surface?: string
          user_id?: string | null
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_lesson_feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_lesson_share_settings: {
        Row: {
          company_id: string
          consume_global: boolean
          contribute_to_global: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          consume_global?: boolean
          contribute_to_global?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          consume_global?: boolean
          contribute_to_global?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_lesson_share_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_lessons: {
        Row: {
          approved_by: string | null
          company_id: string | null
          created_at: string
          embedding: string | null
          example_input_redacted: string
          id: string
          kind: string
          negative_count: number
          positive_count: number
          reject_reason: string | null
          rule_text: string
          scope: string
          status: string
          submitted_by: string | null
          title: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          approved_by?: string | null
          company_id?: string | null
          created_at?: string
          embedding?: string | null
          example_input_redacted: string
          id?: string
          kind: string
          negative_count?: number
          positive_count?: number
          reject_reason?: string | null
          rule_text: string
          scope?: string
          status?: string
          submitted_by?: string | null
          title: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          approved_by?: string | null
          company_id?: string | null
          created_at?: string
          embedding?: string | null
          example_input_redacted?: string
          id?: string
          kind?: string
          negative_count?: number
          positive_count?: number
          reject_reason?: string | null
          rule_text?: string
          scope?: string
          status?: string
          submitted_by?: string | null
          title?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_lessons_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_rates: {
        Row: {
          created_at: string
          credits_per_usd: number
          id: string
          input_usd_per_1m: number
          model: string
          notes: string | null
          output_usd_per_1m: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_per_usd?: number
          id?: string
          input_usd_per_1m?: number
          model: string
          notes?: string | null
          output_usd_per_1m?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_per_usd?: number
          id?: string
          input_usd_per_1m?: number
          model?: string
          notes?: string | null
          output_usd_per_1m?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_pii_audit: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          input_length: number | null
          output_length: number | null
          source: string
          stripped_types: Json
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          input_length?: number | null
          output_length?: number | null
          source: string
          stripped_types?: Json
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          input_length?: number | null
          output_length?: number | null
          source?: string
          stripped_types?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_pii_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_raw_responses: {
        Row: {
          actor_user_id: string | null
          aig_log_id: string | null
          aig_run_id: string | null
          company_id: string | null
          content_length: number | null
          created_at: string
          feature_key: string
          finish_reason: string | null
          id: string
          meta: Json
          model: string | null
          parse_error: string | null
          parse_ok: boolean
          raw_content: string | null
          surface: string | null
        }
        Insert: {
          actor_user_id?: string | null
          aig_log_id?: string | null
          aig_run_id?: string | null
          company_id?: string | null
          content_length?: number | null
          created_at?: string
          feature_key: string
          finish_reason?: string | null
          id?: string
          meta?: Json
          model?: string | null
          parse_error?: string | null
          parse_ok?: boolean
          raw_content?: string | null
          surface?: string | null
        }
        Update: {
          actor_user_id?: string | null
          aig_log_id?: string | null
          aig_run_id?: string | null
          company_id?: string | null
          content_length?: number | null
          created_at?: string
          feature_key?: string
          finish_reason?: string | null
          id?: string
          meta?: Json
          model?: string | null
          parse_error?: string | null
          parse_ok?: boolean
          raw_content?: string | null
          surface?: string | null
        }
        Relationships: []
      }
      ai_training_logs: {
        Row: {
          ai_initial_output: Json
          company_id: string | null
          created_at: string
          human_corrected_output: Json
          id: string
          original_text: string
          user_id: string | null
        }
        Insert: {
          ai_initial_output: Json
          company_id?: string | null
          created_at?: string
          human_corrected_output: Json
          id?: string
          original_text: string
          user_id?: string | null
        }
        Update: {
          ai_initial_output?: Json
          company_id?: string | null
          created_at?: string
          human_corrected_output?: Json
          id?: string
          original_text?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_action_log: {
        Row: {
          action_kind: string
          actor_user_id: string | null
          company_id: string
          created_at: string
          final_payload: Json
          id: string
          outcome: string
          proposed_payload: Json
          raw_message: string | null
        }
        Insert: {
          action_kind: string
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          final_payload?: Json
          id?: string
          outcome: string
          proposed_payload?: Json
          raw_message?: string | null
        }
        Update: {
          action_kind?: string
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          final_payload?: Json
          id?: string
          outcome?: string
          proposed_payload?: Json
          raw_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_action_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_glossary: {
        Row: {
          company_id: string
          created_at: string
          id: string
          meaning: string
          term: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          meaning: string
          term: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          meaning?: string
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_glossary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_learned_preferences: {
        Row: {
          company_id: string
          notes: string
          sample_size: number
          updated_at: string
        }
        Insert: {
          company_id: string
          notes?: string
          sample_size?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          notes?: string
          sample_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_learned_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          is_open: boolean
          note: string | null
          schedule_id: string
          start_time: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          is_open?: boolean
          note?: string | null
          schedule_id: string
          start_time?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          is_open?: boolean
          note?: string | null
          schedule_id?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_policies: {
        Row: {
          company_id: string
          created_at: string
          forwarding_enabled: boolean
          max_forward_hops: number
          notify_timeout_min: number
          off_hours_mode: string
          preferred_partner_ids: string[]
          unanswered_timeout_min: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          forwarding_enabled?: boolean
          max_forward_hops?: number
          notify_timeout_min?: number
          off_hours_mode?: string
          preferred_partner_ids?: string[]
          unanswered_timeout_min?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          forwarding_enabled?: boolean
          max_forward_hops?: number
          notify_timeout_min?: number
          off_hours_mode?: string
          preferred_partner_ids?: string[]
          unanswered_timeout_min?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_schedules: {
        Row: {
          always_open: boolean
          company_id: string
          created_at: string
          id: string
          owner_id: string
          owner_type: string
          timezone: string
          updated_at: string
        }
        Insert: {
          always_open?: boolean
          company_id: string
          created_at?: string
          id?: string
          owner_id: string
          owner_type: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          always_open?: boolean
          company_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          owner_type?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_schedules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_windows: {
        Row: {
          created_at: string
          end_time: string
          id: string
          schedule_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          schedule_id: string
          start_time: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          schedule_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_windows_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      client_booking_modifications: {
        Row: {
          acknowledged_at: string | null
          booking_id: string
          created_at: string
          id: string
          requested_at: string
          requested_changes: Json
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          booking_id: string
          created_at?: string
          id?: string
          requested_at?: string
          requested_changes: Json
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          booking_id?: string
          created_at?: string
          id?: string
          requested_at?: string
          requested_changes?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_booking_modifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "client_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      client_booking_rate_limits: {
        Row: {
          company_id: string
          count: number
          window_start: string
        }
        Insert: {
          company_id: string
          count?: number
          window_start: string
        }
        Update: {
          company_id?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      client_bookings: {
        Row: {
          client_email: string
          company_id: string
          coordinator_acked_at: string | null
          created_at: string
          created_via: string | null
          date: string | null
          from_location: string
          id: string
          job_id: string | null
          name: string
          parent_job_id: string | null
          pickup_at: string | null
          promo_note: string | null
          room_number: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surname: string
          time: string
          to_location: string
          updated_at: string
        }
        Insert: {
          client_email: string
          company_id: string
          coordinator_acked_at?: string | null
          created_at?: string
          created_via?: string | null
          date?: string | null
          from_location: string
          id?: string
          job_id?: string | null
          name: string
          parent_job_id?: string | null
          pickup_at?: string | null
          promo_note?: string | null
          room_number?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          surname: string
          time: string
          to_location: string
          updated_at?: string
        }
        Update: {
          client_email?: string
          company_id?: string
          coordinator_acked_at?: string | null
          created_at?: string
          created_via?: string | null
          date?: string | null
          from_location?: string
          id?: string
          job_id?: string | null
          name?: string
          parent_job_id?: string | null
          pickup_at?: string | null
          promo_note?: string | null
          room_number?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          surname?: string
          time?: string
          to_location?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_bookings_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      client_link_identities: {
        Row: {
          chosen_at: string
          device_id: string
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          pax_id: string | null
          pax_name: string | null
          token: string
        }
        Insert: {
          chosen_at?: string
          device_id: string
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          pax_id?: string | null
          pax_name?: string | null
          token: string
        }
        Update: {
          chosen_at?: string
          device_id?: string
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          pax_id?: string | null
          pax_name?: string | null
          token?: string
        }
        Relationships: []
      }
      client_locations: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          company_id: string
          device_id: string
          id: string
          job_id: string
          latitude: number
          longitude: number
          mode: string
          pax_id: string | null
          pax_name: string | null
          token: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at?: string
          company_id: string
          device_id: string
          id?: string
          job_id: string
          latitude: number
          longitude: number
          mode?: string
          pax_id?: string | null
          pax_name?: string | null
          token: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          company_id?: string
          device_id?: string
          id?: string
          job_id?: string
          latitude?: number
          longitude?: number
          mode?: string
          pax_id?: string | null
          pax_name?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_locations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_display: string
          client_key: string
          company_id: string
          created_at: string
          note: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_display: string
          client_key: string
          company_id: string
          created_at?: string
          note: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_display?: string
          client_key?: string
          company_id?: string
          created_at?: string
          note?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_push_subs: {
        Row: {
          auth: string
          created_at: string
          device_id: string
          endpoint: string
          id: string
          p256dh: string
          token: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_id: string
          endpoint: string
          id?: string
          p256dh: string
          token: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_id?: string
          endpoint?: string
          id?: string
          p256dh?: string
          token?: string
        }
        Relationships: []
      }
      client_sos_events: {
        Row: {
          accuracy_m: number | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          device_id: string | null
          id: string
          job_id: string
          latitude: number | null
          longitude: number | null
          note: string | null
          pax_name: string | null
          token: string
        }
        Insert: {
          accuracy_m?: number | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          job_id: string
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          pax_name?: string | null
          token: string
        }
        Update: {
          accuracy_m?: number | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          job_id?: string
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          pax_name?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sos_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          access_end: string | null
          advert_caption: string | null
          advert_enabled: boolean
          advert_link: string | null
          advert_url: string | null
          ai_fallback_to_general: boolean
          ai_free_monthly_points: number
          ai_free_points_used_this_period: number
          ai_monthly_cap: number | null
          ai_period_reset_at: string
          ai_points_balance: number
          ai_points_used_this_period: number
          arrival_radius_m: number | null
          auto_next_job_enabled: boolean
          boarding_buffer_min: number
          coordinator_phone: string | null
          created_at: string
          currency: string
          custom_link: string
          default_driver_commission_pct: number
          default_driver_pay_per_hour: number
          default_driver_pay_per_km: number
          default_driver_wait_share_pct: number
          email: string
          free_wait_minutes: number
          grace_actions_remaining: number
          grace_reset_at: string
          id: string
          logo_url: string | null
          minimum_fare: number
          name: string
          owner_user_id: string | null
          phone: string | null
          points_balance: number
          price_per_hour: number
          price_per_km: number
          referral_code: string
          referral_credit_until: string | null
          referral_percent: number
          referred_by_company_id: string | null
          require_client_company: boolean
          safety_mode_allow_override: boolean
          safety_mode_enabled: boolean
          safety_mode_threshold_kmh: number
          status: Database["public"]["Enums"]["company_status"]
          trial_ends_at: string | null
          updated_at: string
          waiting_rate_per_minute: number
        }
        Insert: {
          access_end?: string | null
          advert_caption?: string | null
          advert_enabled?: boolean
          advert_link?: string | null
          advert_url?: string | null
          ai_fallback_to_general?: boolean
          ai_free_monthly_points?: number
          ai_free_points_used_this_period?: number
          ai_monthly_cap?: number | null
          ai_period_reset_at?: string
          ai_points_balance?: number
          ai_points_used_this_period?: number
          arrival_radius_m?: number | null
          auto_next_job_enabled?: boolean
          boarding_buffer_min?: number
          coordinator_phone?: string | null
          created_at?: string
          currency?: string
          custom_link?: string
          default_driver_commission_pct?: number
          default_driver_pay_per_hour?: number
          default_driver_pay_per_km?: number
          default_driver_wait_share_pct?: number
          email: string
          free_wait_minutes?: number
          grace_actions_remaining?: number
          grace_reset_at?: string
          id?: string
          logo_url?: string | null
          minimum_fare?: number
          name: string
          owner_user_id?: string | null
          phone?: string | null
          points_balance?: number
          price_per_hour?: number
          price_per_km?: number
          referral_code?: string
          referral_credit_until?: string | null
          referral_percent?: number
          referred_by_company_id?: string | null
          require_client_company?: boolean
          safety_mode_allow_override?: boolean
          safety_mode_enabled?: boolean
          safety_mode_threshold_kmh?: number
          status?: Database["public"]["Enums"]["company_status"]
          trial_ends_at?: string | null
          updated_at?: string
          waiting_rate_per_minute?: number
        }
        Update: {
          access_end?: string | null
          advert_caption?: string | null
          advert_enabled?: boolean
          advert_link?: string | null
          advert_url?: string | null
          ai_fallback_to_general?: boolean
          ai_free_monthly_points?: number
          ai_free_points_used_this_period?: number
          ai_monthly_cap?: number | null
          ai_period_reset_at?: string
          ai_points_balance?: number
          ai_points_used_this_period?: number
          arrival_radius_m?: number | null
          auto_next_job_enabled?: boolean
          boarding_buffer_min?: number
          coordinator_phone?: string | null
          created_at?: string
          currency?: string
          custom_link?: string
          default_driver_commission_pct?: number
          default_driver_pay_per_hour?: number
          default_driver_pay_per_km?: number
          default_driver_wait_share_pct?: number
          email?: string
          free_wait_minutes?: number
          grace_actions_remaining?: number
          grace_reset_at?: string
          id?: string
          logo_url?: string | null
          minimum_fare?: number
          name?: string
          owner_user_id?: string | null
          phone?: string | null
          points_balance?: number
          price_per_hour?: number
          price_per_km?: number
          referral_code?: string
          referral_credit_until?: string | null
          referral_percent?: number
          referred_by_company_id?: string | null
          require_client_company?: boolean
          safety_mode_allow_override?: boolean
          safety_mode_enabled?: boolean
          safety_mode_threshold_kmh?: number
          status?: Database["public"]["Enums"]["company_status"]
          trial_ends_at?: string | null
          updated_at?: string
          waiting_rate_per_minute?: number
        }
        Relationships: [
          {
            foreignKeyName: "companies_referred_by_company_id_fkey"
            columns: ["referred_by_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_ai_rules: {
        Row: {
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          rule_text: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          rule_text: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          rule_text?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_ai_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_ai_shortcuts: {
        Row: {
          company_id: string
          created_at: string
          expansion: string
          id: string
          kind: string
          shortcut: string
          updated_at: string
          uses: number
        }
        Insert: {
          company_id: string
          created_at?: string
          expansion: string
          id?: string
          kind?: string
          shortcut: string
          updated_at?: string
          uses?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          expansion?: string
          id?: string
          kind?: string
          shortcut?: string
          updated_at?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_ai_shortcuts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_coordinator_invites: {
        Row: {
          company_id: string
          created_at: string
          email: string
          id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_coordinator_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_feature_entitlements: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          expires_at: string | null
          feature: string
          id: string
          monthly_cap: number | null
          period_reset_at: string
          updated_at: string
          usage_this_period: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          feature: string
          id?: string
          monthly_cap?: number | null
          period_reset_at?: string
          updated_at?: string
          usage_this_period?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          feature?: string
          id?: string
          monthly_cap?: number | null
          period_reset_at?: string
          updated_at?: string
          usage_this_period?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_feature_entitlements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_feature_price_overrides: {
        Row: {
          company_id: string
          created_at: string
          feature_key: string
          id: string
          points_cost: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          feature_key: string
          id?: string
          points_cost: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          feature_key?: string
          id?: string
          points_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_feature_price_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_logos: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_background: boolean
          is_primary: boolean
          label: string | null
          sort_order: number
          storage_path: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_background?: boolean
          is_primary?: boolean
          label?: string | null
          sort_order?: number
          storage_path: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_background?: boolean
          is_primary?: boolean
          label?: string | null
          sort_order?: number
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_logos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_subscriptions: {
        Row: {
          company_id: string
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          plan_id: string
          points_remaining_this_period: number
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_id: string
          points_remaining_this_period?: number
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_id?: string
          points_remaining_this_period?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      company_trip_counters: {
        Row: {
          company_id: string
          last_no: number
          updated_at: string
        }
        Insert: {
          company_id: string
          last_no?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          last_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_trip_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_invites: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          mode: Database["public"]["Enums"]["connection_mode"]
          owner_company_id: string
          permissions: Json
          used_at: string | null
          used_by_company_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          mode: Database["public"]["Enums"]["connection_mode"]
          owner_company_id: string
          permissions?: Json
          used_at?: string | null
          used_by_company_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["connection_mode"]
          owner_company_id?: string
          permissions?: Json
          used_at?: string | null
          used_by_company_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_invites_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_invites_used_by_company_id_fkey"
            columns: ["used_by_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coordinator_connections: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["connection_mode"]
          owner_company_id: string
          partner_company_id: string
          permissions: Json
          revoked_at: string | null
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          mode: Database["public"]["Enums"]["connection_mode"]
          owner_company_id: string
          partner_company_id: string
          permissions?: Json
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["connection_mode"]
          owner_company_id?: string
          partner_company_id?: string
          permissions?: Json
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coordinator_connections_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordinator_connections_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_default_rules: {
        Row: {
          company_id: string
          created_at: string
          days_of_week: number[]
          enabled: boolean
          end_time: string
          id: string
          label: string
          start_time: string
          target_id: string
          target_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          days_of_week?: number[]
          enabled?: boolean
          end_time: string
          id?: string
          label: string
          start_time: string
          target_id: string
          target_type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          days_of_week?: number[]
          enabled?: boolean
          end_time?: string
          id?: string
          label?: string
          start_time?: string
          target_id?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_default_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_forward_events: {
        Row: {
          created_at: string
          from_company_id: string | null
          id: string
          job_id: string
          meta: Json
          points_charged: number
          reason: string
          to_company_id: string | null
          to_driver_id: string | null
        }
        Insert: {
          created_at?: string
          from_company_id?: string | null
          id?: string
          job_id: string
          meta?: Json
          points_charged?: number
          reason: string
          to_company_id?: string | null
          to_driver_id?: string | null
        }
        Update: {
          created_at?: string
          from_company_id?: string | null
          id?: string
          job_id?: string
          meta?: Json
          points_charged?: number
          reason?: string
          to_company_id?: string | null
          to_driver_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_forward_events_from_company_id_fkey"
            columns: ["from_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_forward_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_forward_events_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_forward_events_to_driver_id_fkey"
            columns: ["to_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_ai_usage: {
        Row: {
          company_id: string
          driver_id: string
          monthly_quota: number
          period_start: string
          questions_used: number
          updated_at: string
        }
        Insert: {
          company_id: string
          driver_id: string
          monthly_quota?: number
          period_start?: string
          questions_used?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          driver_id?: string
          monthly_quota?: number
          period_start?: string
          questions_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_ai_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_ai_usage_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_locations: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          company_id: string | null
          created_at: string
          destination_label: string | null
          distance_m: number | null
          driver_id: string
          eta_sec: number | null
          heading: number | null
          id: string
          job_id: string | null
          latitude: number
          longitude: number
          next_instruction: string | null
          speed_mps: number | null
        }
        Insert: {
          accuracy_m?: number | null
          captured_at?: string
          company_id?: string | null
          created_at?: string
          destination_label?: string | null
          distance_m?: number | null
          driver_id: string
          eta_sec?: number | null
          heading?: number | null
          id?: string
          job_id?: string | null
          latitude: number
          longitude: number
          next_instruction?: string | null
          speed_mps?: number | null
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          company_id?: string | null
          created_at?: string
          destination_label?: string | null
          distance_m?: number | null
          driver_id?: string
          eta_sec?: number | null
          heading?: number | null
          id?: string
          job_id?: string | null
          latitude?: number
          longitude?: number
          next_instruction?: string | null
          speed_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_locations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_push_subs: {
        Row: {
          auth: string
          created_at: string
          driver_id: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          driver_id: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          driver_id?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_push_subs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_status_updates: {
        Row: {
          created_at: string
          driver_id: string
          estimated_eta: string | null
          group_id: string
          id: string
          location_lat: number
          location_lng: number
        }
        Insert: {
          created_at?: string
          driver_id: string
          estimated_eta?: string | null
          group_id: string
          id?: string
          location_lat: number
          location_lng: number
        }
        Update: {
          created_at?: string
          driver_id?: string
          estimated_eta?: string | null
          group_id?: string
          id?: string
          location_lat?: number
          location_lng?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_status_updates_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_status_updates_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          availability_note: string | null
          car_make_model: string | null
          commission_pct: number | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          kind: string
          linked_company_id: string | null
          linked_user_id: string | null
          name: string
          onboarded_at: string | null
          pay_per_hour: number | null
          pay_per_km: number | null
          phone: string | null
          plate: string | null
          profile_updated_at: string | null
          seats_available: number | null
          status: Database["public"]["Enums"]["driver_status"]
          trust_score: number
          trust_updated_at: string | null
          updated_at: string
          vehicle: string | null
          wait_share_pct: number | null
        }
        Insert: {
          availability_note?: string | null
          car_make_model?: string | null
          commission_pct?: number | null
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          linked_company_id?: string | null
          linked_user_id?: string | null
          name: string
          onboarded_at?: string | null
          pay_per_hour?: number | null
          pay_per_km?: number | null
          phone?: string | null
          plate?: string | null
          profile_updated_at?: string | null
          seats_available?: number | null
          status?: Database["public"]["Enums"]["driver_status"]
          trust_score?: number
          trust_updated_at?: string | null
          updated_at?: string
          vehicle?: string | null
          wait_share_pct?: number | null
        }
        Update: {
          availability_note?: string | null
          car_make_model?: string | null
          commission_pct?: number | null
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          linked_company_id?: string | null
          linked_user_id?: string | null
          name?: string
          onboarded_at?: string | null
          pay_per_hour?: number | null
          pay_per_km?: number | null
          phone?: string | null
          plate?: string | null
          profile_updated_at?: string | null
          seats_available?: number | null
          status?: Database["public"]["Enums"]["driver_status"]
          trust_score?: number
          trust_updated_at?: string | null
          updated_at?: string
          vehicle?: string | null
          wait_share_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      feature_costs: {
        Row: {
          feature_name: Database["public"]["Enums"]["feature_name"]
          points_cost: number
          updated_at: string
        }
        Insert: {
          feature_name: Database["public"]["Enums"]["feature_name"]
          points_cost?: number
          updated_at?: string
        }
        Update: {
          feature_name?: Database["public"]["Enums"]["feature_name"]
          points_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      flight_status_snapshots: {
        Row: {
          actual_at: string | null
          baggage_belt: string | null
          captured_at: string
          company_id: string
          delay_minutes: number | null
          direction: string
          estimated_at: string | null
          flight_iata: string
          gate: string | null
          id: string
          job_id: string
          raw: Json | null
          scheduled_at: string | null
          status: string | null
          terminal: string | null
        }
        Insert: {
          actual_at?: string | null
          baggage_belt?: string | null
          captured_at?: string
          company_id: string
          delay_minutes?: number | null
          direction: string
          estimated_at?: string | null
          flight_iata: string
          gate?: string | null
          id?: string
          job_id: string
          raw?: Json | null
          scheduled_at?: string | null
          status?: string | null
          terminal?: string | null
        }
        Update: {
          actual_at?: string | null
          baggage_belt?: string | null
          captured_at?: string
          company_id?: string
          delay_minutes?: number | null
          direction?: string
          estimated_at?: string | null
          flight_iata?: string
          gate?: string | null
          id?: string
          job_id?: string
          raw?: Json | null
          scheduled_at?: string | null
          status?: string | null
          terminal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_status_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      group_route_optimizations: {
        Row: {
          approved_order: string[] | null
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          distance_meters_original: number | null
          distance_meters_suggested: number | null
          duration_seconds_original: number | null
          duration_seconds_suggested: number | null
          group_id: string
          id: string
          job_id: string
          model: string | null
          original_order: string[]
          reasoning: string | null
          requested_by_user_id: string | null
          status: string
          suggested_order: string[]
          updated_at: string
        }
        Insert: {
          approved_order?: string[] | null
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          distance_meters_original?: number | null
          distance_meters_suggested?: number | null
          duration_seconds_original?: number | null
          duration_seconds_suggested?: number | null
          group_id: string
          id?: string
          job_id: string
          model?: string | null
          original_order: string[]
          reasoning?: string | null
          requested_by_user_id?: string | null
          status?: string
          suggested_order: string[]
          updated_at?: string
        }
        Update: {
          approved_order?: string[] | null
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          distance_meters_original?: number | null
          distance_meters_suggested?: number | null
          duration_seconds_original?: number | null
          duration_seconds_suggested?: number | null
          group_id?: string
          id?: string
          job_id?: string
          model?: string | null
          original_order?: string[]
          reasoning?: string | null
          requested_by_user_id?: string | null
          status?: string
          suggested_order?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_route_optimizations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_stop_reorder_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          group_id: string
          id: string
          proposed_order: string[]
          requested_by_driver_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          group_id: string
          id?: string
          proposed_order: string[]
          requested_by_driver_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          group_id?: string
          id?: string
          proposed_order?: string[]
          requested_by_driver_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_stop_reorder_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_stop_reorder_requests_requested_by_driver_id_fkey"
            columns: ["requested_by_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      group_stops: {
        Row: {
          address: string | null
          arrived_at: string | null
          boarded_at: string | null
          charges_cents: number
          completed_at: string | null
          created_at: string
          display_name: string | null
          group_id: string
          id: string
          lat: number | null
          lng: number | null
          no_show_at: string | null
          pax_count: number
          place_id: string | null
          stop_index: number
          updated_at: string
          wait_ended_at: string | null
          wait_started_at: string | null
        }
        Insert: {
          address?: string | null
          arrived_at?: string | null
          boarded_at?: string | null
          charges_cents?: number
          completed_at?: string | null
          created_at?: string
          display_name?: string | null
          group_id: string
          id?: string
          lat?: number | null
          lng?: number | null
          no_show_at?: string | null
          pax_count?: number
          place_id?: string | null
          stop_index: number
          updated_at?: string
          wait_ended_at?: string | null
          wait_started_at?: string | null
        }
        Update: {
          address?: string | null
          arrived_at?: string | null
          boarded_at?: string | null
          charges_cents?: number
          completed_at?: string | null
          created_at?: string
          display_name?: string | null
          group_id?: string
          id?: string
          lat?: number | null
          lng?: number | null
          no_show_at?: string | null
          pax_count?: number
          place_id?: string | null
          stop_index?: number
          updated_at?: string
          wait_ended_at?: string | null
          wait_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_stops_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          coordinator_note: string | null
          created_at: string
          driver_id: string | null
          driver_link: string
          id: string
          job_id: string
          meetandgreet_sign: string | null
          name: string
          status: Database["public"]["Enums"]["group_status"]
          updated_at: string
        }
        Insert: {
          coordinator_note?: string | null
          created_at?: string
          driver_id?: string | null
          driver_link?: string
          id?: string
          job_id: string
          meetandgreet_sign?: string | null
          name: string
          status?: Database["public"]["Enums"]["group_status"]
          updated_at?: string
        }
        Update: {
          coordinator_note?: string | null
          created_at?: string
          driver_id?: string | null
          driver_link?: string
          id?: string
          job_id?: string
          meetandgreet_sign?: string | null
          name?: string
          status?: Database["public"]["Enums"]["group_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      help_ai_log: {
        Row: {
          answer: string | null
          company_id: string | null
          confidence: number | null
          created_at: string
          escalated_ticket_id: string | null
          id: string
          question: string
          route: string | null
          sources_used: Json | null
          thumbs: number | null
          user_id: string | null
        }
        Insert: {
          answer?: string | null
          company_id?: string | null
          confidence?: number | null
          created_at?: string
          escalated_ticket_id?: string | null
          id?: string
          question: string
          route?: string | null
          sources_used?: Json | null
          thumbs?: number | null
          user_id?: string | null
        }
        Update: {
          answer?: string | null
          company_id?: string | null
          confidence?: number | null
          created_at?: string
          escalated_ticket_id?: string | null
          id?: string
          question?: string
          route?: string | null
          sources_used?: Json | null
          thumbs?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "help_ai_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_ai_log_escalated_ticket_id_fkey"
            columns: ["escalated_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      job_adjustments: {
        Row: {
          amount: number
          company_id: string | null
          created_at: string
          currency: string
          driver_id: string | null
          driver_note: string | null
          id: string
          job_id: string
          kind: string
          label: string | null
          source: string
          wait_session_id: string | null
        }
        Insert: {
          amount: number
          company_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string | null
          driver_note?: string | null
          id?: string
          job_id: string
          kind: string
          label?: string | null
          source?: string
          wait_session_id?: string | null
        }
        Update: {
          amount?: number
          company_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string | null
          driver_note?: string | null
          id?: string
          job_id?: string
          kind?: string
          label?: string | null
          source?: string
          wait_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_adjustments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_adjustments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_adjustments_wait_session_id_fkey"
            columns: ["wait_session_id"]
            isOneToOne: false
            referencedRelation: "job_wait_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignment_events: {
        Row: {
          company_id: string
          created_at: string
          driver_id: string | null
          event_type: string
          id: string
          job_id: string
          meta: Json
          reason: string | null
          score: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          driver_id?: string | null
          event_type: string
          id?: string
          job_id: string
          meta?: Json
          reason?: string | null
          score?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          driver_id?: string | null
          event_type?: string
          id?: string
          job_id?: string
          meta?: Json
          reason?: string | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_assignment_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignment_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignment_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_boarding_approvals: {
        Row: {
          company_id: string | null
          coordinator_note: string | null
          created_at: string
          driver_id: string | null
          driver_note: string | null
          id: string
          job_id: string
          override_at: string | null
          pax_summary: Json | null
          requested_at: string
          requested_by_user_id: string | null
          responded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          coordinator_note?: string | null
          created_at?: string
          driver_id?: string | null
          driver_note?: string | null
          id?: string
          job_id: string
          override_at?: string | null
          pax_summary?: Json | null
          requested_at?: string
          requested_by_user_id?: string | null
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          coordinator_note?: string | null
          created_at?: string
          driver_id?: string | null
          driver_note?: string | null
          id?: string
          job_id?: string
          override_at?: string | null
          pax_summary?: Json | null
          requested_at?: string
          requested_by_user_id?: string | null
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_boarding_approvals_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_boarding_approvals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_coord_change_requests: {
        Row: {
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by_driver_id: string | null
          decided_note: string | null
          id: string
          job_id: string
          kind: string
          note: string | null
          requested_by: string | null
          requested_changes: Json
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by_driver_id?: string | null
          decided_note?: string | null
          id?: string
          job_id: string
          kind: string
          note?: string | null
          requested_by?: string | null
          requested_changes?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by_driver_id?: string | null
          decided_note?: string | null
          id?: string
          job_id?: string
          kind?: string
          note?: string | null
          requested_by?: string | null
          requested_changes?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_coord_change_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_coord_change_requests_decided_by_driver_id_fkey"
            columns: ["decided_by_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_coord_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dispatch_hops: {
        Row: {
          created_at: string
          decided_at: string | null
          dispatched_at: string
          from_company_id: string | null
          hop_index: number
          id: string
          job_id: string
          note: string | null
          status: Database["public"]["Enums"]["dispatch_hop_status"]
          to_company_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          dispatched_at?: string
          from_company_id?: string | null
          hop_index: number
          id?: string
          job_id: string
          note?: string | null
          status?: Database["public"]["Enums"]["dispatch_hop_status"]
          to_company_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          dispatched_at?: string
          from_company_id?: string | null
          hop_index?: number
          id?: string
          job_id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["dispatch_hop_status"]
          to_company_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_dispatch_hops_from_company_id_fkey"
            columns: ["from_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dispatch_hops_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dispatch_hops_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      job_emergency_overrides: {
        Row: {
          approval_status: string
          company_id: string
          created_at: string
          driver_id: string | null
          from_status: string
          gps_accuracy_m: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          job_id: string
          pax_count: number | null
          photo_path: string | null
          photo_url: string | null
          reason: string
          reason_note: string | null
          speed_mps: number | null
          street_address: string | null
          to_status: string
          vehicle_label: string | null
        }
        Insert: {
          approval_status?: string
          company_id: string
          created_at?: string
          driver_id?: string | null
          from_status: string
          gps_accuracy_m?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          job_id: string
          pax_count?: number | null
          photo_path?: string | null
          photo_url?: string | null
          reason: string
          reason_note?: string | null
          speed_mps?: number | null
          street_address?: string | null
          to_status: string
          vehicle_label?: string | null
        }
        Update: {
          approval_status?: string
          company_id?: string
          created_at?: string
          driver_id?: string | null
          from_status?: string
          gps_accuracy_m?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          job_id?: string
          pax_count?: number | null
          photo_path?: string | null
          photo_url?: string | null
          reason?: string
          reason_note?: string | null
          speed_mps?: number | null
          street_address?: string | null
          to_status?: string
          vehicle_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_emergency_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_emergency_overrides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_emergency_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_labels: {
        Row: {
          created_at: string
          job_id: string
          label_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
          label_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_labels_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "trip_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      job_price_proposals: {
        Row: {
          amount_eur: number
          created_at: string
          from_company_id: string | null
          from_driver_id: string | null
          from_party_kind: string
          hop_id: string | null
          id: string
          job_id: string
          note: string | null
          parent_id: string | null
          responded_at: string | null
          responded_by_user_id: string | null
          status: string
          to_company_id: string | null
          to_driver_id: string | null
          updated_at: string
        }
        Insert: {
          amount_eur: number
          created_at?: string
          from_company_id?: string | null
          from_driver_id?: string | null
          from_party_kind: string
          hop_id?: string | null
          id?: string
          job_id: string
          note?: string | null
          parent_id?: string | null
          responded_at?: string | null
          responded_by_user_id?: string | null
          status?: string
          to_company_id?: string | null
          to_driver_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_eur?: number
          created_at?: string
          from_company_id?: string | null
          from_driver_id?: string | null
          from_party_kind?: string
          hop_id?: string | null
          id?: string
          job_id?: string
          note?: string | null
          parent_id?: string | null
          responded_at?: string | null
          responded_by_user_id?: string | null
          status?: string
          to_company_id?: string | null
          to_driver_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_price_proposals_from_company_id_fkey"
            columns: ["from_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_price_proposals_from_driver_id_fkey"
            columns: ["from_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_price_proposals_hop_id_fkey"
            columns: ["hop_id"]
            isOneToOne: false
            referencedRelation: "job_dispatch_hops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_price_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_price_proposals_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "job_price_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_price_proposals_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_price_proposals_to_driver_id_fkey"
            columns: ["to_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      job_route_cache: {
        Row: {
          company_id: string
          computed_at: string
          dest_lat: number | null
          dest_lng: number | null
          distance_m: number | null
          duration_in_traffic_s: number | null
          duration_s: number | null
          job_id: string
          leave_by_at: string | null
          next_refresh_at: string | null
          origin_lat: number | null
          origin_lng: number | null
          provider: string | null
          raw: Json | null
          severity: string | null
          traffic_delay_s: number | null
        }
        Insert: {
          company_id: string
          computed_at?: string
          dest_lat?: number | null
          dest_lng?: number | null
          distance_m?: number | null
          duration_in_traffic_s?: number | null
          duration_s?: number | null
          job_id: string
          leave_by_at?: string | null
          next_refresh_at?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          provider?: string | null
          raw?: Json | null
          severity?: string | null
          traffic_delay_s?: number | null
        }
        Update: {
          company_id?: string
          computed_at?: string
          dest_lat?: number | null
          dest_lng?: number | null
          distance_m?: number | null
          duration_in_traffic_s?: number | null
          duration_s?: number | null
          job_id?: string
          leave_by_at?: string | null
          next_refresh_at?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          provider?: string | null
          raw?: Json | null
          severity?: string | null
          traffic_delay_s?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_route_cache_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_wait_proposals: {
        Row: {
          company_id: string | null
          created_at: string
          driver_response_note: string | null
          id: string
          job_id: string
          note: string | null
          proposed_amount: number
          proposed_by_user_id: string | null
          responded_at: string | null
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          driver_response_note?: string | null
          id?: string
          job_id: string
          note?: string | null
          proposed_amount: number
          proposed_by_user_id?: string | null
          responded_at?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          driver_response_note?: string | null
          id?: string
          job_id?: string
          note?: string | null
          proposed_amount?: number
          proposed_by_user_id?: string | null
          responded_at?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_wait_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_wait_sessions: {
        Row: {
          agreed_amount: number | null
          arrived_at: string | null
          auto_started: boolean
          calculated_amount: number | null
          chargeable_from: string | null
          company_id: string | null
          created_at: string
          currency: string
          driver_id: string | null
          driver_note: string | null
          ended_at: string | null
          free_ends_at: string | null
          id: string
          job_id: string
          notified_thresholds: number[]
          source: string
          started_at: string
          updated_at: string
        }
        Insert: {
          agreed_amount?: number | null
          arrived_at?: string | null
          auto_started?: boolean
          calculated_amount?: number | null
          chargeable_from?: string | null
          company_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string | null
          driver_note?: string | null
          ended_at?: string | null
          free_ends_at?: string | null
          id?: string
          job_id: string
          notified_thresholds?: number[]
          source?: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          agreed_amount?: number | null
          arrived_at?: string | null
          auto_started?: boolean
          calculated_amount?: number | null
          chargeable_from?: string | null
          company_id?: string | null
          created_at?: string
          currency?: string
          driver_id?: string | null
          driver_note?: string | null
          ended_at?: string | null
          free_ends_at?: string | null
          id?: string
          job_id?: string
          notified_thresholds?: number[]
          source?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_wait_sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_wait_sessions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          arrival_accuracy_m: number | null
          arrival_distance_m: number | null
          arrival_heading: number | null
          arrival_lat: number | null
          arrival_lng: number | null
          arrival_speed_mps: number | null
          arrival_street_address: string | null
          arrival_verified_at: string | null
          board_config: Json | null
          breakdown_flag_at: string | null
          breakdown_flag_note: string | null
          breakdown_pax_count: number | null
          client_confirmed_at: string | null
          client_link_token: string | null
          clientcompanyname: string | null
          company_id: string
          contact_phone: string | null
          coord_approved_at: string | null
          coordinator_last_viewed_at: string | null
          created_at: string
          date: string
          deletion_requested_at: string | null
          deletion_requested_by: string | null
          dismissed_flags: string[]
          dispatch_chain_company_ids: string[]
          dispatch_decided_at: string | null
          dispatch_note: string | null
          dispatch_status: Database["public"]["Enums"]["dispatch_status"] | null
          dispatched_at: string | null
          driver_accepted_at: string | null
          driver_actual_minutes: number | null
          driver_cancel_note: string | null
          driver_cancel_reason: string | null
          driver_cancel_requested_at: string | null
          driver_cancel_requested_by: string | null
          driver_completed_at: string | null
          driver_external: boolean
          driver_hidden_at: string | null
          driver_id: string | null
          driver_note: string | null
          driver_paid_amount: number | null
          driver_paid_at: string | null
          driver_paid_by_user_id: string | null
          driver_paid_method: string | null
          driver_paid_reference: string | null
          driver_payout_status: string
          driver_reported_km: number | null
          driver_started_at: string | null
          dropoff_display_name: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          dropoff_place_id: string | null
          event_payout_total_eur: number
          executor_company_id: string | null
          flight_baggage_belt: string | null
          flight_delay_minutes: number | null
          flight_estimated_at: string | null
          flight_gate: string | null
          flight_scheduled_at: string | null
          flight_status: string | null
          flight_status_confidence: string | null
          flight_status_note: string | null
          flight_status_updated_at: string | null
          flight_t30_checked: boolean
          flight_t30_checked_at: string | null
          flight_terminal: string | null
          flightorship: string | null
          forward_after: string | null
          forward_hop_count: number
          forward_tried_company_ids: string[]
          from_flight: string | null
          from_location: string
          group_id: string | null
          group_name: string | null
          group_note: string | null
          grouped_at: string | null
          grouped_count: number | null
          id: string
          leave_by_at: string | null
          live_eta_from_lat: number | null
          live_eta_from_lng: number | null
          live_eta_sec: number | null
          live_eta_updated_at: string | null
          origin_company_id: string | null
          paid_amount: number | null
          paid_at: string | null
          paid_by_role: string | null
          paid_by_user_id: string | null
          paid_method: string | null
          paid_reference: string | null
          parent_job_id: string | null
          partner_accepted_at: string | null
          partner_decline_reason: string | null
          partner_declined_at: string | null
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup_at: string | null
          pickup_display_name: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_place_id: string | null
          pickup_shift_reason: string | null
          points_charged: Json
          price_amount: number | null
          price_currency: string | null
          price_set_at: string | null
          price_set_by: string | null
          promo_note: string | null
          qr_strict_mode: boolean
          route_computed_at: string | null
          route_distance_m: number | null
          route_duration_sec: number | null
          safety_flag_at: string | null
          safety_flag_note: string | null
          self_assigned_user_id: string | null
          source: string
          status: Database["public"]["Enums"]["job_status"]
          time: string
          to_flight: string | null
          to_location: string
          tracking_enabled: boolean
          tracking_kind: string | null
          traffic_delay_minutes: number | null
          traffic_severity: string | null
          traffic_updated_at: string | null
          trip_no: number | null
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          arrival_accuracy_m?: number | null
          arrival_distance_m?: number | null
          arrival_heading?: number | null
          arrival_lat?: number | null
          arrival_lng?: number | null
          arrival_speed_mps?: number | null
          arrival_street_address?: string | null
          arrival_verified_at?: string | null
          board_config?: Json | null
          breakdown_flag_at?: string | null
          breakdown_flag_note?: string | null
          breakdown_pax_count?: number | null
          client_confirmed_at?: string | null
          client_link_token?: string | null
          clientcompanyname?: string | null
          company_id: string
          contact_phone?: string | null
          coord_approved_at?: string | null
          coordinator_last_viewed_at?: string | null
          created_at?: string
          date: string
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          dismissed_flags?: string[]
          dispatch_chain_company_ids?: string[]
          dispatch_decided_at?: string | null
          dispatch_note?: string | null
          dispatch_status?:
            | Database["public"]["Enums"]["dispatch_status"]
            | null
          dispatched_at?: string | null
          driver_accepted_at?: string | null
          driver_actual_minutes?: number | null
          driver_cancel_note?: string | null
          driver_cancel_reason?: string | null
          driver_cancel_requested_at?: string | null
          driver_cancel_requested_by?: string | null
          driver_completed_at?: string | null
          driver_external?: boolean
          driver_hidden_at?: string | null
          driver_id?: string | null
          driver_note?: string | null
          driver_paid_amount?: number | null
          driver_paid_at?: string | null
          driver_paid_by_user_id?: string | null
          driver_paid_method?: string | null
          driver_paid_reference?: string | null
          driver_payout_status?: string
          driver_reported_km?: number | null
          driver_started_at?: string | null
          dropoff_display_name?: string | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          dropoff_place_id?: string | null
          event_payout_total_eur?: number
          executor_company_id?: string | null
          flight_baggage_belt?: string | null
          flight_delay_minutes?: number | null
          flight_estimated_at?: string | null
          flight_gate?: string | null
          flight_scheduled_at?: string | null
          flight_status?: string | null
          flight_status_confidence?: string | null
          flight_status_note?: string | null
          flight_status_updated_at?: string | null
          flight_t30_checked?: boolean
          flight_t30_checked_at?: string | null
          flight_terminal?: string | null
          flightorship?: string | null
          forward_after?: string | null
          forward_hop_count?: number
          forward_tried_company_ids?: string[]
          from_flight?: string | null
          from_location: string
          group_id?: string | null
          group_name?: string | null
          group_note?: string | null
          grouped_at?: string | null
          grouped_count?: number | null
          id?: string
          leave_by_at?: string | null
          live_eta_from_lat?: number | null
          live_eta_from_lng?: number | null
          live_eta_sec?: number | null
          live_eta_updated_at?: string | null
          origin_company_id?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          paid_by_role?: string | null
          paid_by_user_id?: string | null
          paid_method?: string | null
          paid_reference?: string | null
          parent_job_id?: string | null
          partner_accepted_at?: string | null
          partner_decline_reason?: string | null
          partner_declined_at?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_at?: string | null
          pickup_display_name?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_place_id?: string | null
          pickup_shift_reason?: string | null
          points_charged?: Json
          price_amount?: number | null
          price_currency?: string | null
          price_set_at?: string | null
          price_set_by?: string | null
          promo_note?: string | null
          qr_strict_mode?: boolean
          route_computed_at?: string | null
          route_distance_m?: number | null
          route_duration_sec?: number | null
          safety_flag_at?: string | null
          safety_flag_note?: string | null
          self_assigned_user_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["job_status"]
          time: string
          to_flight?: string | null
          to_location: string
          tracking_enabled?: boolean
          tracking_kind?: string | null
          traffic_delay_minutes?: number | null
          traffic_severity?: string | null
          traffic_updated_at?: string | null
          trip_no?: number | null
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          arrival_accuracy_m?: number | null
          arrival_distance_m?: number | null
          arrival_heading?: number | null
          arrival_lat?: number | null
          arrival_lng?: number | null
          arrival_speed_mps?: number | null
          arrival_street_address?: string | null
          arrival_verified_at?: string | null
          board_config?: Json | null
          breakdown_flag_at?: string | null
          breakdown_flag_note?: string | null
          breakdown_pax_count?: number | null
          client_confirmed_at?: string | null
          client_link_token?: string | null
          clientcompanyname?: string | null
          company_id?: string
          contact_phone?: string | null
          coord_approved_at?: string | null
          coordinator_last_viewed_at?: string | null
          created_at?: string
          date?: string
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          dismissed_flags?: string[]
          dispatch_chain_company_ids?: string[]
          dispatch_decided_at?: string | null
          dispatch_note?: string | null
          dispatch_status?:
            | Database["public"]["Enums"]["dispatch_status"]
            | null
          dispatched_at?: string | null
          driver_accepted_at?: string | null
          driver_actual_minutes?: number | null
          driver_cancel_note?: string | null
          driver_cancel_reason?: string | null
          driver_cancel_requested_at?: string | null
          driver_cancel_requested_by?: string | null
          driver_completed_at?: string | null
          driver_external?: boolean
          driver_hidden_at?: string | null
          driver_id?: string | null
          driver_note?: string | null
          driver_paid_amount?: number | null
          driver_paid_at?: string | null
          driver_paid_by_user_id?: string | null
          driver_paid_method?: string | null
          driver_paid_reference?: string | null
          driver_payout_status?: string
          driver_reported_km?: number | null
          driver_started_at?: string | null
          dropoff_display_name?: string | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          dropoff_place_id?: string | null
          event_payout_total_eur?: number
          executor_company_id?: string | null
          flight_baggage_belt?: string | null
          flight_delay_minutes?: number | null
          flight_estimated_at?: string | null
          flight_gate?: string | null
          flight_scheduled_at?: string | null
          flight_status?: string | null
          flight_status_confidence?: string | null
          flight_status_note?: string | null
          flight_status_updated_at?: string | null
          flight_t30_checked?: boolean
          flight_t30_checked_at?: string | null
          flight_terminal?: string | null
          flightorship?: string | null
          forward_after?: string | null
          forward_hop_count?: number
          forward_tried_company_ids?: string[]
          from_flight?: string | null
          from_location?: string
          group_id?: string | null
          group_name?: string | null
          group_note?: string | null
          grouped_at?: string | null
          grouped_count?: number | null
          id?: string
          leave_by_at?: string | null
          live_eta_from_lat?: number | null
          live_eta_from_lng?: number | null
          live_eta_sec?: number | null
          live_eta_updated_at?: string | null
          origin_company_id?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          paid_by_role?: string | null
          paid_by_user_id?: string | null
          paid_method?: string | null
          paid_reference?: string | null
          parent_job_id?: string | null
          partner_accepted_at?: string | null
          partner_decline_reason?: string | null
          partner_declined_at?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_at?: string | null
          pickup_display_name?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_place_id?: string | null
          pickup_shift_reason?: string | null
          points_charged?: Json
          price_amount?: number | null
          price_currency?: string | null
          price_set_at?: string | null
          price_set_by?: string | null
          promo_note?: string | null
          qr_strict_mode?: boolean
          route_computed_at?: string | null
          route_distance_m?: number | null
          route_duration_sec?: number | null
          safety_flag_at?: string | null
          safety_flag_note?: string | null
          self_assigned_user_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["job_status"]
          time?: string
          to_flight?: string | null
          to_location?: string
          tracking_enabled?: boolean
          tracking_kind?: string | null
          traffic_delay_minutes?: number | null
          traffic_severity?: string | null
          traffic_updated_at?: string | null
          trip_no?: number | null
          updated_at?: string
          vehicle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_executor_company_id_fkey"
            columns: ["executor_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_origin_company_id_fkey"
            columns: ["origin_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      magic_links: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          kind: Database["public"]["Enums"]["magic_link_kind"]
          revoked_at: string | null
          subject_id: string | null
          subject_label: string | null
          token: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          kind: Database["public"]["Enums"]["magic_link_kind"]
          revoked_at?: string | null
          subject_id?: string | null
          subject_label?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["magic_link_kind"]
          revoked_at?: string | null
          subject_id?: string | null
          subject_label?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "magic_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          body: string | null
          category: string
          clicked_at: string | null
          company_id: string | null
          created_at: string
          data: Json
          delivered_at: string | null
          device_id: string | null
          error: string | null
          id: string
          sent_at: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category: string
          clicked_at?: string | null
          company_id?: string | null
          created_at?: string
          data?: Json
          delivered_at?: string | null
          device_id?: string | null
          error?: string | null
          id?: string
          sent_at?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          clicked_at?: string | null
          company_id?: string | null
          created_at?: string
          data?: Json
          delivered_at?: string | null
          device_id?: string | null
          error?: string | null
          id?: string
          sent_at?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_log_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "push_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          boarding: boolean
          chat: boolean
          created_at: string
          driver_status: boolean
          job_updated: boolean
          new_job: boolean
          route_optimization: boolean
          safety: boolean
          security: boolean
          trip_lifecycle: boolean
          updated_at: string
          user_id: string
          waiting: boolean
        }
        Insert: {
          boarding?: boolean
          chat?: boolean
          created_at?: string
          driver_status?: boolean
          job_updated?: boolean
          new_job?: boolean
          route_optimization?: boolean
          safety?: boolean
          security?: boolean
          trip_lifecycle?: boolean
          updated_at?: string
          user_id: string
          waiting?: boolean
        }
        Update: {
          boarding?: boolean
          chat?: boolean
          created_at?: string
          driver_status?: boolean
          job_updated?: boolean
          new_job?: boolean
          route_optimization?: boolean
          safety?: boolean
          security?: boolean
          trip_lifecycle?: boolean
          updated_at?: string
          user_id?: string
          waiting?: boolean
        }
        Relationships: []
      }
      password_reset_requests: {
        Row: {
          created_at: string
          id: string
          phone: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
      }
      pax: {
        Row: {
          boarded_at: string | null
          boarded_method: string | null
          cancelled_at: string | null
          created_at: string
          group_id: string | null
          id: string
          job_id: string
          name: string
          noshow_at: string | null
          status: Database["public"]["Enums"]["pax_status"]
          updated_at: string
        }
        Insert: {
          boarded_at?: string | null
          boarded_method?: string | null
          cancelled_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          job_id: string
          name: string
          noshow_at?: string | null
          status?: Database["public"]["Enums"]["pax_status"]
          updated_at?: string
        }
        Update: {
          boarded_at?: string | null
          boarded_method?: string | null
          cancelled_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          job_id?: string
          name?: string
          noshow_at?: string | null
          status?: Database["public"]["Enums"]["pax_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pax_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pax_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      pax_tracking_tokens: {
        Row: {
          booking_ref: string | null
          created_at: string
          id: string
          job_id: string
          location_share_expires_at: string | null
          location_share_granted_at: string | null
          location_share_requested_at: string | null
          phone_last4: string | null
          portal_booking_id: string | null
          revoked_at: string | null
          show_driver_location: boolean
          token: string
        }
        Insert: {
          booking_ref?: string | null
          created_at?: string
          id?: string
          job_id: string
          location_share_expires_at?: string | null
          location_share_granted_at?: string | null
          location_share_requested_at?: string | null
          phone_last4?: string | null
          portal_booking_id?: string | null
          revoked_at?: string | null
          show_driver_location?: boolean
          token?: string
        }
        Update: {
          booking_ref?: string | null
          created_at?: string
          id?: string
          job_id?: string
          location_share_expires_at?: string | null
          location_share_granted_at?: string | null
          location_share_requested_at?: string | null
          phone_last4?: string | null
          portal_booking_id?: string | null
          revoked_at?: string | null
          show_driver_location?: boolean
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "pax_tracking_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pax_tracking_tokens_portal_booking_id_fkey"
            columns: ["portal_booking_id"]
            isOneToOne: false
            referencedRelation: "portal_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          driver_cap: number | null
          feature_keys: string[]
          id: string
          included_points: number
          is_public: boolean
          name: string
          price_monthly: number
          sort_order: number
          trial_days: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          driver_cap?: number | null
          feature_keys?: string[]
          id?: string
          included_points?: number
          is_public?: boolean
          name: string
          price_monthly?: number
          sort_order?: number
          trial_days?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          driver_cap?: number | null
          feature_keys?: string[]
          id?: string
          included_points?: number
          is_public?: boolean
          name?: string
          price_monthly?: number
          sort_order?: number
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      point_packs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_reference_rate: boolean
          name: string
          points: number
          price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_reference_rate?: boolean
          name: string
          points: number
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_reference_rate?: boolean
          name?: string
          points?: number
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      points_ledger: {
        Row: {
          company_id: string
          created_at: string
          feature_key: string | null
          feature_used: Database["public"]["Enums"]["feature_name"] | null
          id: string
          job_id: string | null
          note: string | null
          points_deducted: number
        }
        Insert: {
          company_id: string
          created_at?: string
          feature_key?: string | null
          feature_used?: Database["public"]["Enums"]["feature_name"] | null
          id?: string
          job_id?: string | null
          note?: string | null
          points_deducted: number
        }
        Update: {
          company_id?: string
          created_at?: string
          feature_key?: string | null
          feature_used?: Database["public"]["Enums"]["feature_name"] | null
          id?: string
          job_id?: string | null
          note?: string | null
          points_deducted?: number
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_addons: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          portal_company_id: string
          price: number | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          portal_company_id: string
          price?: number | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          portal_company_id?: string
          price?: number | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_addons_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_bookings: {
        Row: {
          accepted_at: string | null
          addon_selections: Json | null
          agreed_price: number | null
          created_at: string
          created_by_email: string | null
          created_by_name: string | null
          currency: string | null
          fare_breakdown: Json | null
          guest_session_id: string | null
          id: string
          job_id: string | null
          payload: Json
          portal_company_id: string
          promo_code: string | null
          requires_approval: boolean
          room_id: string | null
          status: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          addon_selections?: Json | null
          agreed_price?: number | null
          created_at?: string
          created_by_email?: string | null
          created_by_name?: string | null
          currency?: string | null
          fare_breakdown?: Json | null
          guest_session_id?: string | null
          id?: string
          job_id?: string | null
          payload?: Json
          portal_company_id: string
          promo_code?: string | null
          requires_approval?: boolean
          room_id?: string | null
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          addon_selections?: Json | null
          agreed_price?: number | null
          created_at?: string
          created_by_email?: string | null
          created_by_name?: string | null
          currency?: string | null
          fare_breakdown?: Json | null
          guest_session_id?: string | null
          id?: string
          job_id?: string | null
          payload?: Json
          portal_company_id?: string
          promo_code?: string | null
          requires_approval?: boolean
          room_id?: string | null
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_bookings_guest_session_id_fkey"
            columns: ["guest_session_id"]
            isOneToOne: false
            referencedRelation: "portal_guest_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_bookings_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "portal_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_bookings_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "portal_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_change_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          job_id: string | null
          kind: string
          portal_booking_id: string
          requested_changes: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          job_id?: string | null
          kind: string
          portal_booking_id: string
          requested_changes?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          job_id?: string | null
          kind?: string
          portal_booking_id?: string
          requested_changes?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_change_requests_portal_booking_id_fkey"
            columns: ["portal_booking_id"]
            isOneToOne: false
            referencedRelation: "portal_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_companies: {
        Row: {
          active: boolean
          brand_color: string | null
          contact_email: string | null
          contact_phone: string | null
          coordinator_company_id: string
          created_at: string
          currency: string
          display_name_for_passenger: string | null
          id: string
          kind: string
          link_enabled: boolean
          link_expires_at: string | null
          logo_url: string | null
          magic_token: string
          monthly_seat_points: number
          name: string
          notification_email: string | null
          points_per_booking: number
          pricing_mode: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          coordinator_company_id: string
          created_at?: string
          currency?: string
          display_name_for_passenger?: string | null
          id?: string
          kind?: string
          link_enabled?: boolean
          link_expires_at?: string | null
          logo_url?: string | null
          magic_token?: string
          monthly_seat_points?: number
          name: string
          notification_email?: string | null
          points_per_booking?: number
          pricing_mode?: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          coordinator_company_id?: string
          created_at?: string
          currency?: string
          display_name_for_passenger?: string | null
          id?: string
          kind?: string
          link_enabled?: boolean
          link_expires_at?: string | null
          logo_url?: string | null
          magic_token?: string
          monthly_seat_points?: number
          name?: string
          notification_email?: string | null
          points_per_booking?: number
          pricing_mode?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_companies_coordinator_company_id_fkey"
            columns: ["coordinator_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_guest_sessions: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string
          guest_name: string
          id: string
          last_seen_at: string
          phone: string | null
          portal_company_id: string
          room_id: string | null
          session_token: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          expires_at?: string
          guest_name: string
          id?: string
          last_seen_at?: string
          phone?: string | null
          portal_company_id: string
          room_id?: string | null
          session_token?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string
          guest_name?: string
          id?: string
          last_seen_at?: string
          phone?: string | null
          portal_company_id?: string
          room_id?: string | null
          session_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_guest_sessions_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_guest_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "portal_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_link_events: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          created_at: string
          detail: Json | null
          event: string
          id: string
          portal_company_id: string
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json | null
          event: string
          id?: string
          portal_company_id: string
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json | null
          event?: string
          id?: string
          portal_company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_link_events_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read_by: Json
          sender_label: string | null
          sender_role: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_by?: Json
          sender_label?: string | null
          sender_role: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_by?: Json
          sender_label?: string | null
          sender_role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "portal_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_offers: {
        Row: {
          active: boolean
          created_at: string
          cta_label: string | null
          cta_url: string | null
          description: string | null
          id: string
          image_url: string | null
          portal_company_id: string
          price: number | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          portal_company_id: string
          price?: number | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          portal_company_id?: string
          price?: number | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_offers_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_payment_messages: {
        Row: {
          amount: number | null
          body: string | null
          created_at: string
          currency: string | null
          id: string
          kind: string
          sender_label: string | null
          sender_role: string
          thread_id: string
        }
        Insert: {
          amount?: number | null
          body?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          kind?: string
          sender_label?: string | null
          sender_role: string
          thread_id: string
        }
        Update: {
          amount?: number | null
          body?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          kind?: string
          sender_label?: string | null
          sender_role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_payment_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "portal_payment_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_payment_threads: {
        Row: {
          created_at: string
          id: string
          portal_booking_id: string
          portal_company_id: string
          scope: string
        }
        Insert: {
          created_at?: string
          id?: string
          portal_booking_id: string
          portal_company_id: string
          scope: string
        }
        Update: {
          created_at?: string
          id?: string
          portal_booking_id?: string
          portal_company_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_payment_threads_portal_booking_id_fkey"
            columns: ["portal_booking_id"]
            isOneToOne: false
            referencedRelation: "portal_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_payment_threads_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_promos: {
        Row: {
          active: boolean
          applies_to: string
          code: string
          created_at: string
          ends_at: string | null
          id: string
          kind: string
          max_uses: number | null
          min_price: number | null
          portal_company_id: string
          starts_at: string | null
          updated_at: string
          uses_count: number
          value: number
        }
        Insert: {
          active?: boolean
          applies_to?: string
          code: string
          created_at?: string
          ends_at?: string | null
          id?: string
          kind?: string
          max_uses?: number | null
          min_price?: number | null
          portal_company_id: string
          starts_at?: string | null
          updated_at?: string
          uses_count?: number
          value: number
        }
        Update: {
          active?: boolean
          applies_to?: string
          code?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          kind?: string
          max_uses?: number | null
          min_price?: number | null
          portal_company_id?: string
          starts_at?: string | null
          updated_at?: string
          uses_count?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "portal_promos_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_rate_limits: {
        Row: {
          count: number
          minute_bucket: number
          token: string
        }
        Insert: {
          count?: number
          minute_bucket: number
          token: string
        }
        Update: {
          count?: number
          minute_bucket?: number
          token?: string
        }
        Relationships: []
      }
      portal_rooms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string | null
          portal_company_id: string
          qr_token: string
          room_number: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          portal_company_id: string
          qr_token?: string
          room_number: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          portal_company_id?: string
          qr_token?: string
          room_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_rooms_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_statements: {
        Row: {
          generated_at: string
          id: string
          period_end: string
          period_start: string
          portal_company_id: string
          totals: Json
        }
        Insert: {
          generated_at?: string
          id?: string
          period_end: string
          period_start: string
          portal_company_id: string
          totals?: Json
        }
        Update: {
          generated_at?: string
          id?: string
          period_end?: string
          period_start?: string
          portal_company_id?: string
          totals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "portal_statements_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_threads: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          portal_booking_id: string | null
          portal_company_id: string
          scope: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          portal_booking_id?: string | null
          portal_company_id: string
          scope: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          portal_booking_id?: string | null
          portal_company_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_threads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_threads_portal_booking_id_fkey"
            columns: ["portal_booking_id"]
            isOneToOne: false
            referencedRelation: "portal_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_threads_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_zone_fares: {
        Row: {
          coordinator_base_price: number | null
          created_at: string
          id: string
          markup: number | null
          pax_tier: string
          price: number
          updated_at: string
          zone_id: string
        }
        Insert: {
          coordinator_base_price?: number | null
          created_at?: string
          id?: string
          markup?: number | null
          pax_tier?: string
          price: number
          updated_at?: string
          zone_id: string
        }
        Update: {
          coordinator_base_price?: number | null
          created_at?: string
          id?: string
          markup?: number | null
          pax_tier?: string
          price?: number
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_zone_fares_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "portal_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_zones: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          portal_company_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          portal_company_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          portal_company_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_zones_portal_company_id_fkey"
            columns: ["portal_company_id"]
            isOneToOne: false
            referencedRelation: "portal_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      public_ai_daily_counters: {
        Row: {
          count: number
          day: string
          updated_at: string
        }
        Insert: {
          count?: number
          day: string
          updated_at?: string
        }
        Update: {
          count?: number
          day?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          auth: string | null
          company_id: string | null
          created_at: string
          endpoint: string | null
          id: string
          last_seen_at: string
          p256dh: string | null
          platform: string
          role: string
          token: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth?: string | null
          company_id?: string | null
          created_at?: string
          endpoint?: string | null
          id?: string
          last_seen_at?: string
          p256dh?: string | null
          platform: string
          role: string
          token?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string | null
          company_id?: string | null
          created_at?: string
          endpoint?: string | null
          id?: string
          last_seen_at?: string
          p256dh?: string | null
          platform?: string
          role?: string
          token?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_devices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          active: boolean
          base_price: number
          company_id: string
          created_at: string
          currency: string | null
          free_wait_minutes: number | null
          id: string
          minimum_fare: number
          name: string
          notes: string | null
          price_per_hour: number
          price_per_km: number
          sort_order: number
          updated_at: string
          waiting_rate_per_minute: number | null
        }
        Insert: {
          active?: boolean
          base_price?: number
          company_id: string
          created_at?: string
          currency?: string | null
          free_wait_minutes?: number | null
          id?: string
          minimum_fare?: number
          name: string
          notes?: string | null
          price_per_hour?: number
          price_per_km?: number
          sort_order?: number
          updated_at?: string
          waiting_rate_per_minute?: number | null
        }
        Update: {
          active?: boolean
          base_price?: number
          company_id?: string
          created_at?: string
          currency?: string | null
          free_wait_minutes?: number | null
          id?: string
          minimum_fare?: number
          name?: string
          notes?: string | null
          price_per_hour?: number
          price_per_km?: number
          sort_order?: number
          updated_at?: string
          waiting_rate_per_minute?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_messages: {
        Row: {
          author: string
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author: string
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author?: string
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_unread: boolean
          ai_thread: Json | null
          company_id: string | null
          created_at: string
          id: string
          priority: string
          resolved_at: string | null
          route: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
          user_unread: boolean
          viewport: string | null
        }
        Insert: {
          admin_unread?: boolean
          ai_thread?: Json | null
          company_id?: string | null
          created_at?: string
          id?: string
          priority?: string
          resolved_at?: string | null
          route?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
          user_unread?: boolean
          viewport?: string | null
        }
        Update: {
          admin_unread?: boolean
          ai_thread?: Json | null
          company_id?: string | null
          created_at?: string
          id?: string
          priority?: string
          resolved_at?: string | null
          route?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
          user_unread?: boolean
          viewport?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      topup_requests: {
        Row: {
          company_id: string
          created_at: string
          id: string
          note: string | null
          pack_id: string | null
          points_requested: number
          price: number | null
          requested_by: string
          status: Database["public"]["Enums"]["topup_request_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          note?: string | null
          pack_id?: string | null
          points_requested: number
          price?: number | null
          requested_by: string
          status?: Database["public"]["Enums"]["topup_request_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          note?: string | null
          pack_id?: string | null
          points_requested?: number
          price?: number | null
          requested_by?: string
          status?: Database["public"]["Enums"]["topup_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topup_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topup_requests_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "point_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_audit_log: {
        Row: {
          actor_label: string | null
          actor_user_id: string | null
          approval_status: string
          company_id: string
          created_at: string
          device_time: string | null
          driver_id: string | null
          event_type: string
          gps_accuracy_m: number | null
          gps_lat: number | null
          gps_lng: number | null
          group_id: string | null
          id: string
          job_id: string | null
          new_state: Json | null
          notes: string | null
          prev_hash: string | null
          previous_state: Json | null
          row_hash: string
          server_time: string
          speed_kmh: number | null
          stop_id: string | null
          street_address: string | null
        }
        Insert: {
          actor_label?: string | null
          actor_user_id?: string | null
          approval_status?: string
          company_id: string
          created_at?: string
          device_time?: string | null
          driver_id?: string | null
          event_type: string
          gps_accuracy_m?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          group_id?: string | null
          id?: string
          job_id?: string | null
          new_state?: Json | null
          notes?: string | null
          prev_hash?: string | null
          previous_state?: Json | null
          row_hash: string
          server_time?: string
          speed_kmh?: number | null
          stop_id?: string | null
          street_address?: string | null
        }
        Update: {
          actor_label?: string | null
          actor_user_id?: string | null
          approval_status?: string
          company_id?: string
          created_at?: string
          device_time?: string | null
          driver_id?: string | null
          event_type?: string
          gps_accuracy_m?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          group_id?: string | null
          id?: string
          job_id?: string | null
          new_state?: Json | null
          notes?: string | null
          prev_hash?: string | null
          previous_state?: Json | null
          row_hash?: string
          server_time?: string
          speed_kmh?: number | null
          stop_id?: string | null
          street_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_audit_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_labels: {
        Row: {
          color: string
          company_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          company_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_labels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_map_events: {
        Row: {
          accuracy_m: number | null
          adjustment_id: string | null
          company_id: string
          created_at: string
          driver_id: string | null
          event_type: string
          id: string
          job_id: string
          lat: number | null
          lng: number | null
          meta: Json
          notes: string | null
          occurred_at: string
          payout_delta_eur: number
          trust_delta: number
        }
        Insert: {
          accuracy_m?: number | null
          adjustment_id?: string | null
          company_id: string
          created_at?: string
          driver_id?: string | null
          event_type: string
          id?: string
          job_id: string
          lat?: number | null
          lng?: number | null
          meta?: Json
          notes?: string | null
          occurred_at?: string
          payout_delta_eur?: number
          trust_delta?: number
        }
        Update: {
          accuracy_m?: number | null
          adjustment_id?: string | null
          company_id?: string
          created_at?: string
          driver_id?: string | null
          event_type?: string
          id?: string
          job_id?: string
          lat?: number | null
          lng?: number | null
          meta?: Json
          notes?: string | null
          occurred_at?: string
          payout_delta_eur?: number
          trust_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_map_events_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "job_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_map_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_messages: {
        Row: {
          body: string
          client_identity_id: string | null
          company_id: string
          created_at: string
          driver_id: string | null
          id: string
          is_sos: boolean
          job_id: string
          pax_id: string | null
          read_by_coordinator_at: string | null
          read_by_driver_at: string | null
          retracted_at: string | null
          sender_kind: string
          sender_label: string | null
          thread: string
          thread_kind: string
          updated_at: string
        }
        Insert: {
          body: string
          client_identity_id?: string | null
          company_id: string
          created_at?: string
          driver_id?: string | null
          id?: string
          is_sos?: boolean
          job_id: string
          pax_id?: string | null
          read_by_coordinator_at?: string | null
          read_by_driver_at?: string | null
          retracted_at?: string | null
          sender_kind: string
          sender_label?: string | null
          thread?: string
          thread_kind?: string
          updated_at?: string
        }
        Update: {
          body?: string
          client_identity_id?: string | null
          company_id?: string
          created_at?: string
          driver_id?: string | null
          id?: string
          is_sos?: boolean
          job_id?: string
          pax_id?: string | null
          read_by_coordinator_at?: string | null
          read_by_driver_at?: string | null
          retracted_at?: string | null
          sender_kind?: string
          sender_label?: string | null
          thread?: string
          thread_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_messages_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_messages_pax_id_fkey"
            columns: ["pax_id"]
            isOneToOne: false
            referencedRelation: "pax"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feature_preferences: {
        Row: {
          company_id: string
          enabled: boolean
          feature_key: string
          id: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          company_id: string
          enabled?: boolean
          feature_key: string
          id?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          company_id?: string
          enabled?: boolean
          feature_key?: string
          id?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_feature_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          ai_toggles: Json
          created_at: string
          haptics_enabled: boolean
          home_layout: Json
          sound_enabled: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_toggles?: Json
          created_at?: string
          haptics_enabled?: boolean
          home_layout?: Json
          sound_enabled?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_toggles?: Json
          created_at?: string
          haptics_enabled?: boolean
          home_layout?: Json
          sound_enabled?: boolean
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_security_settings: {
        Row: {
          auto_lock_seconds: number
          biometric_enabled: boolean
          created_at: string
          require_biometric_on_open: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_lock_seconds?: number
          biometric_enabled?: boolean
          created_at?: string
          require_biometric_on_open?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_lock_seconds?: number
          biometric_enabled?: boolean
          created_at?: string
          require_biometric_on_open?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      watchtower_alerts: {
        Row: {
          body: string | null
          company_id: string
          created_at: string
          dedupe_key: string
          id: string
          job_id: string | null
          kind: string
          resolved_at: string | null
          severity: number
          status: string
          suggested_actions: Json
          title: string
        }
        Insert: {
          body?: string | null
          company_id: string
          created_at?: string
          dedupe_key: string
          id?: string
          job_id?: string | null
          kind: string
          resolved_at?: string | null
          severity?: number
          status?: string
          suggested_actions?: Json
          title: string
        }
        Update: {
          body?: string | null
          company_id?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          job_id?: string | null
          kind?: string
          resolved_at?: string | null
          severity?: number
          status?: string
          suggested_actions?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchtower_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watchtower_alerts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      watchtower_settings: {
        Row: {
          daily_scan_cap: number
          enabled: boolean
          interval_sec: number
          kinds: string[]
          last_scan_at: string | null
          scans_reset_on: string
          scans_today: number
          severity_min: number
          updated_at: string
          user_id: string
        }
        Insert: {
          daily_scan_cap?: number
          enabled?: boolean
          interval_sec?: number
          kinds?: string[]
          last_scan_at?: string | null
          scans_reset_on?: string
          scans_today?: number
          severity_min?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          daily_scan_cap?: number
          enabled?: boolean
          interval_sec?: number
          kinds?: string[]
          last_scan_at?: string | null
          scans_reset_on?: string
          scans_today?: number
          severity_min?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webauthn_credentials: {
        Row: {
          created_at: string
          credential_id: string
          device_label: string | null
          id: string
          last_used_at: string | null
          public_key: string
          sign_count: number
          transports: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          device_label?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          sign_count?: number
          transports?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          device_label?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          sign_count?: number
          transports?: string[]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_suspicious_activity: {
        Row: {
          company_id: string | null
          count: number | null
          driver_id: string | null
          signal: string | null
          window: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_grant_ai_points: {
        Args: { _amount: number; _company_id: string; _note?: string }
        Returns: number
      }
      admin_grant_points: {
        Args: { _company_id: string; _note?: string; _points: number }
        Returns: undefined
      }
      allocate_to_ai_wallet: {
        Args: { _amount: number; _company_id: string }
        Returns: number
      }
      auto_assign_job: {
        Args: { _job_id: string }
        Returns: {
          driver_id: string
          reason: string
          score: number
        }[]
      }
      bump_public_ai_daily_count: { Args: never; Returns: number }
      canonical_jsonb: { Args: { _j: Json }; Returns: string }
      charge_extra_logos_weekly: { Args: never; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      driver_clear_payout: { Args: { _job_id: string }; Returns: undefined }
      driver_guide_consume: {
        Args: { _company_id: string; _driver_id: string }
        Returns: {
          remaining_free: number
          used_free: boolean
        }[]
      }
      driver_mark_payout: {
        Args: {
          _amount: number
          _job_id: string
          _method: string
          _reference: string
        }
        Returns: undefined
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_referral_code: { Args: { _company_id: string }; Returns: string }
      feature_available: {
        Args: { _company_id: string; _feature_key: string }
        Returns: boolean
      }
      get_public_ai_daily_count: { Args: never; Returns: number }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      match_ai_lessons: {
        Args: {
          _company_id: string
          _kind: string
          _limit?: number
          query_embedding: string
        }
        Returns: {
          example_input_redacted: string
          id: string
          kind: string
          rule_text: string
          scope: string
          similarity: number
          title: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      my_company_id: { Args: { _user_id: string }; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recalc_trip_event_totals: {
        Args: { _driver_id: string; _job_id: string }
        Returns: undefined
      }
      record_trip_audit: {
        Args: {
          _accuracy?: number
          _actor_label?: string
          _address?: string
          _approval_status?: string
          _device_time?: string
          _driver_id?: string
          _event_type: string
          _group_id?: string
          _job_id: string
          _lat?: number
          _lng?: number
          _new?: Json
          _notes?: string
          _previous?: Json
          _speed?: number
          _stop_id?: string
        }
        Returns: string
      }
      register_client_booking_attempt: {
        Args: { _company_id: string; _limit?: number }
        Returns: boolean
      }
      rollover_subscriptions: { Args: never; Returns: number }
      set_ai_fallback: {
        Args: { _company_id: string; _enabled: boolean }
        Returns: undefined
      }
      set_ai_monthly_cap: {
        Args: { _cap: number; _company_id: string }
        Returns: undefined
      }
      set_company_plan: {
        Args: { _company_id: string; _plan_id: string }
        Returns: undefined
      }
      spend_points: {
        Args: {
          _company_id: string
          _cost_override?: number
          _feature_key: string
          _job_id?: string
          _note?: string
        }
        Returns: number
      }
      verify_trip_audit_chain: {
        Args: { _job_id: string }
        Returns: {
          created_at: string
          event_type: string
          ok: boolean
          row_id: string
        }[]
      }
    }
    Enums: {
      booking_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "modification_pending"
        | "cancelled"
      company_status: "pending" | "approved" | "suspended"
      connection_mode: "sync" | "provider"
      connection_status: "pending" | "active" | "revoked" | "rejected"
      dispatch_hop_status: "pending" | "accepted" | "rejected" | "cancelled"
      dispatch_status: "pending" | "accepted" | "rejected"
      driver_status: "available" | "busy" | "offline"
      feature_name:
        | "tracking"
        | "bulkupload"
        | "client_booking"
        | "qr"
        | "magic_link_driver"
        | "magic_link_client"
        | "split_job"
        | "clone_job"
        | "recurring_schedule"
        | "dispatch_partner"
      group_status: "pending" | "assigned" | "active" | "completed"
      job_status:
        | "pending"
        | "active"
        | "completed"
        | "en_route"
        | "arrived"
        | "in_progress"
        | "cancelled"
      magic_link_kind: "driver" | "client"
      pax_status:
        | "pending"
        | "verified"
        | "onboard"
        | "delayed"
        | "noshow"
        | "completed"
        | "cancelled"
      payment_status: "pending" | "paid" | "partial"
      topup_request_status: "pending" | "fulfilled" | "rejected"
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
      booking_status: [
        "pending",
        "accepted",
        "rejected",
        "modification_pending",
        "cancelled",
      ],
      company_status: ["pending", "approved", "suspended"],
      connection_mode: ["sync", "provider"],
      connection_status: ["pending", "active", "revoked", "rejected"],
      dispatch_hop_status: ["pending", "accepted", "rejected", "cancelled"],
      dispatch_status: ["pending", "accepted", "rejected"],
      driver_status: ["available", "busy", "offline"],
      feature_name: [
        "tracking",
        "bulkupload",
        "client_booking",
        "qr",
        "magic_link_driver",
        "magic_link_client",
        "split_job",
        "clone_job",
        "recurring_schedule",
        "dispatch_partner",
      ],
      group_status: ["pending", "assigned", "active", "completed"],
      job_status: [
        "pending",
        "active",
        "completed",
        "en_route",
        "arrived",
        "in_progress",
        "cancelled",
      ],
      magic_link_kind: ["driver", "client"],
      pax_status: [
        "pending",
        "verified",
        "onboard",
        "delayed",
        "noshow",
        "completed",
        "cancelled",
      ],
      payment_status: ["pending", "paid", "partial"],
      topup_request_status: ["pending", "fulfilled", "rejected"],
    },
  },
} as const
