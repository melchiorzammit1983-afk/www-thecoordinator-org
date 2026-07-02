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
          message: string | null
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
          message?: string | null
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
          message?: string | null
          phone?: string | null
          referral_code?: string | null
          role?: string | null
          status?: string
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
      client_booking_modifications: {
        Row: {
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
          created_at: string
          date: string | null
          from_location: string
          id: string
          job_id: string | null
          name: string
          pickup_at: string | null
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
          created_at?: string
          date?: string | null
          from_location: string
          id?: string
          job_id?: string | null
          name: string
          pickup_at?: string | null
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
          created_at?: string
          date?: string | null
          from_location?: string
          id?: string
          job_id?: string | null
          name?: string
          pickup_at?: string | null
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
        ]
      }
      companies: {
        Row: {
          access_end: string | null
          created_at: string
          custom_link: string
          email: string
          id: string
          name: string
          owner_user_id: string | null
          phone: string | null
          points_balance: number
          require_client_company: boolean
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
        }
        Insert: {
          access_end?: string | null
          created_at?: string
          custom_link?: string
          email: string
          id?: string
          name: string
          owner_user_id?: string | null
          phone?: string | null
          points_balance?: number
          require_client_company?: boolean
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Update: {
          access_end?: string | null
          created_at?: string
          custom_link?: string
          email?: string
          id?: string
          name?: string
          owner_user_id?: string | null
          phone?: string | null
          points_balance?: number
          require_client_company?: boolean
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Relationships: []
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
          company_id: string
          created_at: string
          email: string | null
          id: string
          kind: string
          linked_company_id: string | null
          linked_user_id: string | null
          name: string
          phone: string | null
          profile_updated_at: string | null
          seats_available: number | null
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          availability_note?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          linked_company_id?: string | null
          linked_user_id?: string | null
          name: string
          phone?: string | null
          profile_updated_at?: string | null
          seats_available?: number | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          availability_note?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          linked_company_id?: string | null
          linked_user_id?: string | null
          name?: string
          phone?: string | null
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
      jobs: {
        Row: {
          clientcompanyname: string | null
          company_id: string
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
          driver_hidden_at: string | null
          driver_id: string | null
          executor_company_id: string | null
          flight_estimated_at: string | null
          flight_scheduled_at: string | null
          flight_status: string | null
          flight_status_note: string | null
          flight_status_updated_at: string | null
          flightorship: string | null
          from_flight: string | null
          from_location: string
          id: string
          origin_company_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup_at: string | null
          points_charged: Json
          qr_strict_mode: boolean
          self_assigned_user_id: string | null
          status: Database["public"]["Enums"]["job_status"]
          time: string
          to_flight: string | null
          to_location: string
          tracking_enabled: boolean
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          clientcompanyname?: string | null
          company_id: string
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
          driver_hidden_at?: string | null
          driver_id?: string | null
          executor_company_id?: string | null
          flight_estimated_at?: string | null
          flight_scheduled_at?: string | null
          flight_status?: string | null
          flight_status_note?: string | null
          flight_status_updated_at?: string | null
          flightorship?: string | null
          from_flight?: string | null
          from_location: string
          id?: string
          origin_company_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_at?: string | null
          points_charged?: Json
          qr_strict_mode?: boolean
          self_assigned_user_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          time: string
          to_flight?: string | null
          to_location: string
          tracking_enabled?: boolean
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          clientcompanyname?: string | null
          company_id?: string
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
          driver_hidden_at?: string | null
          driver_id?: string | null
          executor_company_id?: string | null
          flight_estimated_at?: string | null
          flight_scheduled_at?: string | null
          flight_status?: string | null
          flight_status_note?: string | null
          flight_status_updated_at?: string | null
          flightorship?: string | null
          from_flight?: string | null
          from_location?: string
          id?: string
          origin_company_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_at?: string | null
          points_charged?: Json
          qr_strict_mode?: boolean
          self_assigned_user_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          time?: string
          to_flight?: string | null
          to_location?: string
          tracking_enabled?: boolean
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
          qr_code: string
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
          qr_code?: string
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
          qr_code?: string
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
      points_ledger: {
        Row: {
          company_id: string
          created_at: string
          feature_used: Database["public"]["Enums"]["feature_name"] | null
          id: string
          job_id: string | null
          note: string | null
          points_deducted: number
        }
        Insert: {
          company_id: string
          created_at?: string
          feature_used?: Database["public"]["Enums"]["feature_name"] | null
          id?: string
          job_id?: string | null
          note?: string | null
          points_deducted: number
        }
        Update: {
          company_id?: string
          created_at?: string
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
          points_requested: number
          requested_by: string
          status: Database["public"]["Enums"]["topup_request_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          note?: string | null
          points_requested: number
          requested_by: string
          status?: Database["public"]["Enums"]["topup_request_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          note?: string | null
          points_requested?: number
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
          company_id: string
          created_at: string
          id: string
          job_id: string
          read_by_coordinator_at: string | null
          read_by_driver_at: string | null
          sender_kind: string
          sender_label: string | null
          updated_at: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          id?: string
          job_id: string
          read_by_coordinator_at?: string | null
          read_by_driver_at?: string | null
          sender_kind: string
          sender_label?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string
          read_by_coordinator_at?: string | null
          read_by_driver_at?: string | null
          sender_kind?: string
          sender_label?: string | null
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      charge_feature: {
        Args: {
          _company_id: string
          _feature: Database["public"]["Enums"]["feature_name"]
          _job_id: string
          _note: string
        }
        Returns: number
      }
      company_of: { Args: { _user_id: string }; Returns: string }
      dispatch_job_forward: {
        Args: { _job_id: string; _note: string; _to_company: string }
        Returns: undefined
      }
      driver_accept_job: {
        Args: { _job_id: string; _token: string }
        Returns: undefined
      }
      driver_approve_deletion: {
        Args: { _job_id: string; _token: string }
        Returns: undefined
      }
      has_connection_permission: {
        Args: {
          _perm: string
          _target_company: string
          _viewer_company: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_company_owner: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_executor_of: {
        Args: { _job_id: string; _viewer_company: string }
        Returns: boolean
      }
      job_in_my_chain: { Args: { _job_id: string }; Returns: boolean }
      lookup_magic_link: {
        Args: { _token: string }
        Returns: {
          company_id: string
          expires_at: string
          id: string
          kind: string
          revoked_at: string
          subject_id: string
          subject_label: string
        }[]
      }
      respond_dispatch: {
        Args: { _decision: string; _job_id: string; _note: string }
        Returns: undefined
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
