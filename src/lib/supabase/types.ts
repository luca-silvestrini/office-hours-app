/**
 * Hand-maintained database types, matching supabase/migrations/0001-0005.
 * Regenerate with `supabase gen types typescript` once the CLI is linked if you
 * prefer generated types.
 */
export type SlotStatus = "open" | "claimed";
export type CheckInMethod = "geolocation" | "manual";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: { id: string; email: string; name: string | null; created_at: string };
        Insert: { id: string; email: string; name?: string | null; created_at?: string };
        Update: { id?: string; email?: string; name?: string | null; created_at?: string };
        Relationships: [];
      };
      office_hours_slots: {
        Row: {
          id: string;
          user_id: string | null;
          start_time: string;
          end_time: string;
          status: SlotStatus;
          recurring_claim_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          start_time: string;
          end_time: string;
          status?: SlotStatus;
          recurring_claim_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          start_time?: string;
          end_time?: string;
          status?: SlotStatus;
          recurring_claim_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      recurring_claims: {
        Row: { id: string; user_id: string; created_at: string };
        Insert: { id?: string; user_id: string; created_at?: string };
        Update: { id?: string; user_id?: string; created_at?: string };
        Relationships: [];
      };
      check_ins: {
        Row: {
          id: string;
          slot_id: string;
          user_id: string;
          checked_in_at: string;
          method: CheckInMethod;
          latitude: number | null;
          longitude: number | null;
          distance_miles: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          slot_id: string;
          user_id: string;
          checked_in_at?: string;
          method: CheckInMethod;
          latitude?: number | null;
          longitude?: number | null;
          distance_miles?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          slot_id?: string;
          user_id?: string;
          checked_in_at?: string;
          method?: CheckInMethod;
          latitude?: number | null;
          longitude?: number | null;
          distance_miles?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      member_names: {
        Row: { id: string | null; name: string | null };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      slot_status: SlotStatus;
      check_in_method: CheckInMethod;
    };
    CompositeTypes: Record<string, never>;
  };
}
