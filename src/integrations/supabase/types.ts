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
      client_bookings: {
        Row: {
          client_email: string
          company_id: string
          created_at: string
          from_location: string
          id: string
          name: string
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
          from_location: string
          id?: string
          name: string
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
          from_location?: string
          id?: string
          name?: string
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
          company_id: string
          created_at: string
          id: string
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_company_id_fkey"
            columns: ["company_id"]
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
      jobs: {
        Row: {
          clientcompanyname: string | null
          company_id: string
          created_at: string
          date: string
          flightorship: string | null
          from_location: string
          id: string
          status: Database["public"]["Enums"]["job_status"]
          time: string
          to_location: string
          tracking_enabled: boolean
          updated_at: string
        }
        Insert: {
          clientcompanyname?: string | null
          company_id: string
          created_at?: string
          date: string
          flightorship?: string | null
          from_location: string
          id?: string
          status?: Database["public"]["Enums"]["job_status"]
          time: string
          to_location: string
          tracking_enabled?: boolean
          updated_at?: string
        }
        Update: {
          clientcompanyname?: string | null
          company_id?: string
          created_at?: string
          date?: string
          flightorship?: string | null
          from_location?: string
          id?: string
          status?: Database["public"]["Enums"]["job_status"]
          time?: string
          to_location?: string
          tracking_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pax: {
        Row: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      booking_status: "pending" | "accepted" | "rejected"
      company_status: "pending" | "approved" | "suspended"
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
      group_status: "pending" | "assigned" | "active" | "completed"
      job_status: "pending" | "active" | "completed"
      pax_status:
        | "pending"
        | "verified"
        | "onboard"
        | "delayed"
        | "noshow"
        | "completed"
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
      booking_status: ["pending", "accepted", "rejected"],
      company_status: ["pending", "approved", "suspended"],
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
      ],
      group_status: ["pending", "assigned", "active", "completed"],
      job_status: ["pending", "active", "completed"],
      pax_status: [
        "pending",
        "verified",
        "onboard",
        "delayed",
        "noshow",
        "completed",
      ],
    },
  },
} as const
