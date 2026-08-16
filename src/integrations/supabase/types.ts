export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      auth_audit_log: {
        Row: {
          alert_resolved: boolean | null;
          created_at: string | null;
          device_info: Json | null;
          event_type: string;
          id: string;
          ip_address: string | null;
          is_alert: boolean | null;
          metadata: Json | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          alert_resolved?: boolean | null;
          created_at?: string | null;
          device_info?: Json | null;
          event_type: string;
          id?: string;
          ip_address?: string | null;
          is_alert?: boolean | null;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          alert_resolved?: boolean | null;
          created_at?: string | null;
          device_info?: Json | null;
          event_type?: string;
          id?: string;
          ip_address?: string | null;
          is_alert?: boolean | null;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      auth_recovery_codes: {
        Row: {
          code_hash: string;
          created_at: string | null;
          id: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          code_hash: string;
          created_at?: string | null;
          id?: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          code_hash?: string;
          created_at?: string | null;
          id?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      ip_blacklist: {
        Row: {
          blocked_until: string | null;
          created_at: string | null;
          ip_address: string;
          reason: string | null;
        };
        Insert: {
          blocked_until?: string | null;
          created_at?: string | null;
          ip_address: string;
          reason?: string | null;
        };
        Update: {
          blocked_until?: string | null;
          created_at?: string | null;
          ip_address?: string;
          reason?: string | null;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          ai_qualification_notes: string | null;
          client_email: string | null;
          client_name: string;
          client_phone: string | null;
          created_at: string | null;
          id: string;
          interest_property_id: string | null;
          status: string | null;
          tenant_id: string | null;
          user_id: string;
        };
        Insert: {
          ai_qualification_notes?: string | null;
          client_email?: string | null;
          client_name: string;
          client_phone?: string | null;
          created_at?: string | null;
          id?: string;
          interest_property_id?: string | null;
          status?: string | null;
          tenant_id?: string | null;
          user_id: string;
        };
        Update: {
          ai_qualification_notes?: string | null;
          client_email?: string | null;
          client_name?: string;
          client_phone?: string | null;
          created_at?: string | null;
          id?: string;
          interest_property_id?: string | null;
          status?: string | null;
          tenant_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_interest_property_id_fkey";
            columns: ["interest_property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          company_name: string | null;
          created_at: string | null;
          full_name: string | null;
          id: string;
          is_active: boolean | null;
          tenant_id: string | null;
          trial_ends_at: string | null;
          updated_at: string | null;
          user_type: Database["public"]["Enums"]["user_type"] | null;
        };
        Insert: {
          company_name?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          id: string;
          is_active?: boolean | null;
          tenant_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string | null;
          user_type?: Database["public"]["Enums"]["user_type"] | null;
        };
        Update: {
          company_name?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          tenant_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string | null;
          user_type?: Database["public"]["Enums"]["user_type"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
          anti_fraud_score: number | null;
          area_sqm: number | null;
          bathrooms: number | null;
          bedrooms: number | null;
          created_at: string | null;
          description: string | null;
          id: string;
          images: string[] | null;
          is_verified: boolean | null;
          location_address: string | null;
          location_city: string | null;
          location_state: string | null;
          owner_id: string | null;
          price: number | null;
          property_type: string | null;
          source_portal: string | null;
          source_url: string | null;
          tenant_id: string | null;
          title: string;
          updated_at: string | null;
        };
        Insert: {
          anti_fraud_score?: number | null;
          area_sqm?: number | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          images?: string[] | null;
          is_verified?: boolean | null;
          location_address?: string | null;
          location_city?: string | null;
          location_state?: string | null;
          owner_id?: string | null;
          price?: number | null;
          property_type?: string | null;
          source_portal?: string | null;
          source_url?: string | null;
          tenant_id?: string | null;
          title: string;
          updated_at?: string | null;
        };
        Update: {
          anti_fraud_score?: number | null;
          area_sqm?: number | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          images?: string[] | null;
          is_verified?: boolean | null;
          location_address?: string | null;
          location_city?: string | null;
          location_state?: string | null;
          owner_id?: string | null;
          price?: number | null;
          property_type?: string | null;
          source_portal?: string | null;
          source_url?: string | null;
          tenant_id?: string | null;
          title?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "properties_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      property_favorites: {
        Row: {
          created_at: string;
          id: string;
          property_key: string;
          property_snapshot: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          property_key: string;
          property_snapshot: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          property_key?: string;
          property_snapshot?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      property_search_index: {
        Row: {
          anti_fraud_score: number | null;
          area_sqm: number | null;
          bathrooms: number | null;
          bedrooms: number | null;
          description: string | null;
          id: string;
          images: string[] | null;
          is_verified: boolean | null;
          location_address: string | null;
          location_city: string | null;
          location_state: string | null;
          metadata: Json | null;
          price: number | null;
          property_type: string | null;
          scanned_at: string | null;
          source_portal: string | null;
          source_url: string | null;
          title: string;
        };
        Insert: {
          anti_fraud_score?: number | null;
          area_sqm?: number | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          description?: string | null;
          id?: string;
          images?: string[] | null;
          is_verified?: boolean | null;
          location_address?: string | null;
          location_city?: string | null;
          location_state?: string | null;
          metadata?: Json | null;
          price?: number | null;
          property_type?: string | null;
          scanned_at?: string | null;
          source_portal?: string | null;
          source_url?: string | null;
          title: string;
        };
        Update: {
          anti_fraud_score?: number | null;
          area_sqm?: number | null;
          bathrooms?: number | null;
          bedrooms?: number | null;
          description?: string | null;
          id?: string;
          images?: string[] | null;
          is_verified?: boolean | null;
          location_address?: string | null;
          location_city?: string | null;
          location_state?: string | null;
          metadata?: Json | null;
          price?: number | null;
          property_type?: string | null;
          scanned_at?: string | null;
          source_portal?: string | null;
          source_url?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      real_estate_companies: {
        Row: {
          cnpj: string | null;
          created_at: string | null;
          id: string;
          logo_url: string | null;
          name: string;
          rating: number | null;
          website: string | null;
        };
        Insert: {
          cnpj?: string | null;
          created_at?: string | null;
          id?: string;
          logo_url?: string | null;
          name: string;
          rating?: number | null;
          website?: string | null;
        };
        Update: {
          cnpj?: string | null;
          created_at?: string | null;
          id?: string;
          logo_url?: string | null;
          name?: string;
          rating?: number | null;
          website?: string | null;
        };
        Relationships: [];
      };
      search_configurations: {
        Row: {
          created_at: string;
          criteria: Json;
          id: string;
          is_active: boolean;
          last_run_at: string | null;
          name: string;
          next_run_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          criteria: Json;
          id?: string;
          is_active?: boolean;
          last_run_at?: string | null;
          name: string;
          next_run_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          criteria?: Json;
          id?: string;
          is_active?: boolean;
          last_run_at?: string | null;
          name?: string;
          next_run_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      security_alerts: {
        Row: {
          created_at: string | null;
          id: string;
          is_read: boolean | null;
          message: string;
          severity: string | null;
          title: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          message: string;
          severity?: string | null;
          title: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          message?: string;
          severity?: string | null;
          title?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      security_events: {
        Row: {
          created_at: string | null;
          details: Json | null;
          event_name: string;
          id: string;
          severity: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          details?: Json | null;
          event_name: string;
          id?: string;
          severity: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          details?: Json | null;
          event_name?: string;
          id?: string;
          severity?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      subscription_plans: {
        Row: {
          features: string[] | null;
          id: string;
          is_active: boolean | null;
          name: string;
          price_monthly: number;
        };
        Insert: {
          features?: string[] | null;
          id: string;
          is_active?: boolean | null;
          name: string;
          price_monthly: number;
        };
        Update: {
          features?: string[] | null;
          id?: string;
          is_active?: boolean | null;
          name?: string;
          price_monthly?: number;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          id: string;
          status: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_end: string;
          trial_start: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_end?: string;
          trial_start?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_end?: string;
          trial_start?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      system_events: {
        Row: {
          created_at: string | null;
          event_type: string;
          id: string;
          message: string | null;
          metadata: Json | null;
          severity: string | null;
          tenant_id: string;
        };
        Insert: {
          created_at?: string | null;
          event_type: string;
          id?: string;
          message?: string | null;
          metadata?: Json | null;
          severity?: string | null;
          tenant_id: string;
        };
        Update: {
          created_at?: string | null;
          event_type?: string;
          id?: string;
          message?: string | null;
          metadata?: Json | null;
          severity?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      tenant_members: {
        Row: {
          created_at: string;
          id: string;
          member_role: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          member_role?: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          member_role?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_onboarding: {
        Row: {
          completed_at: string | null;
          created_at: string;
          current_step: number;
          is_completed: boolean;
          metadata: Json | null;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          current_step?: number;
          is_completed?: boolean;
          metadata?: Json | null;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          current_step?: number;
          is_completed?: boolean;
          metadata?: Json | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_security_settings: {
        Row: {
          email_alerts_enabled: boolean | null;
          mfa_enabled_at: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          email_alerts_enabled?: boolean | null;
          mfa_enabled_at?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          email_alerts_enabled?: boolean | null;
          mfa_enabled_at?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      vps_automation_logs: {
        Row: {
          action: string;
          finished_at: string | null;
          id: string;
          output: string | null;
          started_at: string | null;
          status: string;
          vps_id: string;
        };
        Insert: {
          action: string;
          finished_at?: string | null;
          id?: string;
          output?: string | null;
          started_at?: string | null;
          status: string;
          vps_id: string;
        };
        Update: {
          action?: string;
          finished_at?: string | null;
          id?: string;
          output?: string | null;
          started_at?: string | null;
          status?: string;
          vps_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vps_automation_logs_vps_id_fkey";
            columns: ["vps_id"];
            isOneToOne: false;
            referencedRelation: "vps_servers";
            referencedColumns: ["id"];
          },
        ];
      };
      vps_servers: {
        Row: {
          created_at: string | null;
          id: string;
          ip_address: string;
          name: string;
          owner_id: string;
          provider: string | null;
          specs: Json | null;
          ssh_key_secret_name: string | null;
          ssh_user: string;
          status: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          ip_address: string;
          name: string;
          owner_id: string;
          provider?: string | null;
          specs?: Json | null;
          ssh_key_secret_name?: string | null;
          ssh_user?: string;
          status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          ip_address?: string;
          name?: string;
          owner_id?: string;
          provider?: string | null;
          specs?: Json | null;
          ssh_key_secret_name?: string | null;
          ssh_user?: string;
          status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      archive_old_audit_logs: {
        Args: { days_to_keep?: number };
        Returns: number;
      };
      check_rate_limit: { Args: { _ip: string }; Returns: boolean };
      current_tenant_id: { Args: never; Returns: string };
      generate_retention_report: { Args: { _days: number }; Returns: string };
      get_audit_logs_csv: { Args: { _user_id: string }; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean };
      refresh_search_cache: { Args: never; Returns: undefined };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
      subscription_status: "trialing" | "active" | "past_due" | "canceled" | "unpaid";
      user_type: "cliente" | "corretor" | "imobiliaria" | "proprietario" | "construtora" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      subscription_status: ["trialing", "active", "past_due", "canceled", "unpaid"],
      user_type: ["cliente", "corretor", "imobiliaria", "proprietario", "construtora", "admin"],
    },
  },
} as const;
