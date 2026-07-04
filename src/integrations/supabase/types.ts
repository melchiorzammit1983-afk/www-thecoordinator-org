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
      ai_command_log: {
        Row: {
          actions: Json
          actor_user_id: string | null
          company_id: string
          created_at: string
          error: string | null
          id: string
          mode: string
          prompt: string
          response: string | null
          status: string
        }
        Insert: {
          actions?: Json
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          error?: string | null
          id?: string
          mode?: string
          prompt: string
          response?: string | null
          status?: string
        }
        Update: {
          actions?: Json
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          error?: string | null
          id?: string
          mode?: string
          prompt?: string
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
      ai_feature_costs: {
        Row: {
          block_on_empty: boolean
          category: string
          enabled: boolean
          feature_key: string
          label: string | null
          metering_mode: string
          points_cost: number
          updated_at: string
        }
        Insert: {
          block_on_empty?: boolean
          category?: string
          enabled?: boolean
          feature_key: string
          label?: string | null
          metering_mode?: string
          points_cost?: number
          updated_at?: string
        }
        Update: {
          block_on_empty?: boolean
          category?: string
          enabled?: boolean
          feature_key?: string
          label?: string | null
          metering_mode?: string
          points_cost?: number
          updated_at?: string
        }
        Relationships: []
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
          coordinator_phone: string | null
          created_at: string
          custom_link: string
          email: string
          id: string
          logo_url: string | null
          name: string
          owner_user_id: string | null
          phone: string | null
          points_balance: number
          referral_code: string
          require_client_company: boolean
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
        }
        Insert: {
          access_end?: string | null
          advert_caption?: string | null
          advert_enabled?: boolean
          advert_link?: string | null
          advert_url?: string | null
          coordinator_phone?: string | null
          created_at?: string
          custom_link?: string
          email: string
          id?: string
          logo_url?: string | null
          name: string
          owner_user_id?: string | null
          phone?: string | null
          points_balance?: number
          referral_code?: string
          require_client_company?: boolean
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Update: {
          access_end?: string | null
          advert_caption?: string | null
          advert_enabled?: boolean
          advert_link?: string | null
          advert_url?: string | null
          coordinator_phone?: string | null
          created_at?: string
          custom_link?: string
          email?: string
          id?: string
          logo_url?: string | null
          name?: string
          owner_user_id?: string | null
          phone?: string | null
          points_balance?: number
          referral_code?: string
          require_client_company?: boolean
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Relationships: []
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
      driver_locations: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          company_id: string | null
          created_at: string
          driver_id: string
          heading: number | null
          id: string
          job_id: string | null
          latitude: number
          longitude: number
          speed_mps: number | null
        }
        Insert: {
          accuracy_m?: number | null
          captured_at?: string
          company_id?: string | null
          created_at?: string
          driver_id: string
          heading?: number | null
          id?: string
          job_id?: string | null
          latitude: number
          longitude: number
          speed_mps?: number | null
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          company_id?: string | null
          created_at?: string
          driver_id?: string
          heading?: number | null
          id?: string
          job_id?: string | null
          latitude?: number
          longitude?: number
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
          company_id: string
          created_at: string
          email: string | null
          id: string
          kind: string
          linked_company_id: string | null
          linked_user_id: string | null
          name: string
          onboarded_at: string | null
          phone: string | null
          plate: string | null
          profile_updated_at: string | null
          seats_available: number | null
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          availability_note?: string | null
          car_make_model?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          linked_company_id?: string | null
          linked_user_id?: string | null
          name: string
          onboarded_at?: string | null
          phone?: string | null
          plate?: string | null
          profile_updated_at?: string | null
          seats_available?: number | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          availability_note?: string | null
          car_make_model?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          linked_company_id?: string | null
          linked_user_id?: string | null
          name?: string
          onboarded_at?: string | null
          phone?: string | null
          plate?: string | null
          profile_updated_at?: string | null
          seats_available?: number | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          vehicle?: string | null
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
      jobs: {
        Row: {
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
          dispatch_chain_company_ids: string[]
          dispatch_decided_at: string | null
          dispatch_note: string | null
          dispatch_status: Database["public"]["Enums"]["dispatch_status"] | null
          dispatched_at: string | null
          driver_accepted_at: string | null
          driver_actual_minutes: number | null
          driver_completed_at: string | null
          driver_external: boolean
          driver_hidden_at: string | null
          driver_id: string | null
          driver_note: string | null
          driver_reported_km: number | null
          driver_started_at: string | null
          executor_company_id: string | null
          flight_baggage_belt: string | null
          flight_delay_minutes: number | null
          flight_estimated_at: string | null
          flight_gate: string | null
          flight_scheduled_at: string | null
          flight_status: string | null
          flight_status_note: string | null
          flight_status_updated_at: string | null
          flight_terminal: string | null
          flightorship: string | null
          from_flight: string | null
          from_location: string
          group_id: string | null
          group_name: string | null
          group_note: string | null
          grouped_at: string | null
          grouped_count: number | null
          id: string
          leave_by_at: string | null
          origin_company_id: string | null
          parent_job_id: string | null
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup_at: string | null
          pickup_shift_reason: string | null
          points_charged: Json
          price_amount: number | null
          price_currency: string | null
          price_set_at: string | null
          price_set_by: string | null
          promo_note: string | null
          qr_strict_mode: boolean
          self_assigned_user_id: string | null
          source: string
          status: Database["public"]["Enums"]["job_status"]
          time: string
          to_flight: string | null
          to_location: string
          tracking_enabled: boolean
          traffic_delay_minutes: number | null
          traffic_severity: string | null
          traffic_updated_at: string | null
          updated_at: string
          vehicle: string | null
        }
        Insert: {
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
          dispatch_chain_company_ids?: string[]
          dispatch_decided_at?: string | null
          dispatch_note?: string | null
          dispatch_status?:
            | Database["public"]["Enums"]["dispatch_status"]
            | null
          dispatched_at?: string | null
          driver_accepted_at?: string | null
          driver_actual_minutes?: number | null
          driver_completed_at?: string | null
          driver_external?: boolean
          driver_hidden_at?: string | null
          driver_id?: string | null
          driver_note?: string | null
          driver_reported_km?: number | null
          driver_started_at?: string | null
          executor_company_id?: string | null
          flight_baggage_belt?: string | null
          flight_delay_minutes?: number | null
          flight_estimated_at?: string | null
          flight_gate?: string | null
          flight_scheduled_at?: string | null
          flight_status?: string | null
          flight_status_note?: string | null
          flight_status_updated_at?: string | null
          flight_terminal?: string | null
          flightorship?: string | null
          from_flight?: string | null
          from_location: string
          group_id?: string | null
          group_name?: string | null
          group_note?: string | null
          grouped_at?: string | null
          grouped_count?: number | null
          id?: string
          leave_by_at?: string | null
          origin_company_id?: string | null
          parent_job_id?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_at?: string | null
          pickup_shift_reason?: string | null
          points_charged?: Json
          price_amount?: number | null
          price_currency?: string | null
          price_set_at?: string | null
          price_set_by?: string | null
          promo_note?: string | null
          qr_strict_mode?: boolean
          self_assigned_user_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["job_status"]
          time: string
          to_flight?: string | null
          to_location: string
          tracking_enabled?: boolean
          traffic_delay_minutes?: number | null
          traffic_severity?: string | null
          traffic_updated_at?: string | null
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
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
          dispatch_chain_company_ids?: string[]
          dispatch_decided_at?: string | null
          dispatch_note?: string | null
          dispatch_status?:
            | Database["public"]["Enums"]["dispatch_status"]
            | null
          dispatched_at?: string | null
          driver_accepted_at?: string | null
          driver_actual_minutes?: number | null
          driver_completed_at?: string | null
          driver_external?: boolean
          driver_hidden_at?: string | null
          driver_id?: string | null
          driver_note?: string | null
          driver_reported_km?: number | null
          driver_started_at?: string | null
          executor_company_id?: string | null
          flight_baggage_belt?: string | null
          flight_delay_minutes?: number | null
          flight_estimated_at?: string | null
          flight_gate?: string | null
          flight_scheduled_at?: string | null
          flight_status?: string | null
          flight_status_note?: string | null
          flight_status_updated_at?: string | null
          flight_terminal?: string | null
          flightorship?: string | null
          from_flight?: string | null
          from_location?: string
          group_id?: string | null
          group_name?: string | null
          group_note?: string | null
          grouped_at?: string | null
          grouped_count?: number | null
          id?: string
          leave_by_at?: string | null
          origin_company_id?: string | null
          parent_job_id?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_at?: string | null
          pickup_shift_reason?: string | null
          points_charged?: Json
          price_amount?: number | null
          price_currency?: string | null
          price_set_at?: string | null
          price_set_by?: string | null
          promo_note?: string | null
          qr_strict_mode?: boolean
          self_assigned_user_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["job_status"]
          time?: string
          to_flight?: string | null
          to_location?: string
          tracking_enabled?: boolean
          traffic_delay_minutes?: number | null
          traffic_severity?: string | null
          traffic_updated_at?: string | null
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
      pax: {
        Row: {
          boarded_at: string | null
          boarded_method: string | null
          created_at: string
          group_id: string | null
          id: string
          job_id: string
          name: string
          status: Database["public"]["Enums"]["pax_status"]
          updated_at: string
        }
        Insert: {
          boarded_at?: string | null
          boarded_method?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          job_id: string
          name: string
          status?: Database["public"]["Enums"]["pax_status"]
          updated_at?: string
        }
        Update: {
          boarded_at?: string | null
          boarded_method?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          job_id?: string
          name?: string
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
      plans: {
        Row: {
          code: string
          created_at: string
          feature_keys: string[]
          id: string
          included_points: number
          name: string
          price_monthly: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          feature_keys?: string[]
          id?: string
          included_points?: number
          name: string
          price_monthly?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          feature_keys?: string[]
          id?: string
          included_points?: number
          name?: string
          price_monthly?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      point_packs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
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
      trip_messages: {
        Row: {
          body: string
          client_identity_id: string | null
          company_id: string
          created_at: string
          id: string
          is_sos: boolean
          job_id: string
          pax_id: string | null
          read_by_coordinator_at: string | null
          read_by_driver_at: string | null
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
          id?: string
          is_sos?: boolean
          job_id: string
          pax_id?: string | null
          read_by_coordinator_at?: string | null
          read_by_driver_at?: string | null
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
          id?: string
          is_sos?: boolean
          job_id?: string
          pax_id?: string | null
          read_by_coordinator_at?: string | null
          read_by_driver_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_grant_points: {
        Args: { _company_id: string; _note?: string; _points: number }
        Returns: undefined
      }
      auto_assign_job: {
        Args: { _job_id: string }
        Returns: {
          driver_id: string
          reason: string
          score: number
        }[]
      }
      rollover_subscriptions: { Args: never; Returns: number }
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
      payment_status: "pending" | "paid"
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
      ],
      payment_status: ["pending", "paid"],
      topup_request_status: ["pending", "fulfilled", "rejected"],
    },
  },
} as const
