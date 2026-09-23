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
      agent_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          created_at: string | null
          decision: string
          id: string
          recommendation_id: string
          rejection_reason: string | null
        }
        Insert: {
          approved_at?: string
          approved_by: string
          created_at?: string | null
          decision: string
          id?: string
          recommendation_id: string
          rejection_reason?: string | null
        }
        Update: {
          approved_at?: string
          approved_by?: string
          created_at?: string | null
          decision?: string
          id?: string
          recommendation_id?: string
          rejection_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "agent_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_executions: {
        Row: {
          approval_id: string
          created_at: string | null
          error_message: string | null
          executed_at: string
          executed_by: string | null
          execution_status: string
          id: string
          pricelabs_response: Json | null
        }
        Insert: {
          approval_id: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string
          executed_by?: string | null
          execution_status: string
          id?: string
          pricelabs_response?: Json | null
        }
        Update: {
          approval_id?: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string
          executed_by?: string | null
          execution_status?: string
          id?: string
          pricelabs_response?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "executions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "agent_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_outcomes: {
        Row: {
          created_at: string | null
          days_after_execution: number
          execution_id: string
          id: string
          measured_at: string
          notes: string | null
          occupancy_after: number | null
          occupancy_before: number | null
          occupancy_change: number | null
          outcome_assessment: string | null
          revenue_after: number | null
          revenue_before: number | null
          revenue_change: number | null
        }
        Insert: {
          created_at?: string | null
          days_after_execution: number
          execution_id: string
          id?: string
          measured_at?: string
          notes?: string | null
          occupancy_after?: number | null
          occupancy_before?: number | null
          occupancy_change?: number | null
          outcome_assessment?: string | null
          revenue_after?: number | null
          revenue_before?: number | null
          revenue_change?: number | null
        }
        Update: {
          created_at?: string | null
          days_after_execution?: number
          execution_id?: string
          id?: string
          measured_at?: string
          notes?: string | null
          occupancy_after?: number | null
          occupancy_before?: number | null
          occupancy_change?: number | null
          outcome_assessment?: string | null
          revenue_after?: number | null
          revenue_before?: number | null
          revenue_change?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "agent_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_recommendations: {
        Row: {
          created_at: string | null
          discount_percentage: number | null
          expected_occupancy_impact: number | null
          expected_revenue_impact: number | null
          id: string
          property_id: string
          recommendation_type: string
          recommended_at: string
          recommended_by: string | null
          sage_assessment_text: string | null
          scout_report_json: Json | null
          strategist_report_text: string | null
          target_dates: Json | null
          urgency_tier: string
        }
        Insert: {
          created_at?: string | null
          discount_percentage?: number | null
          expected_occupancy_impact?: number | null
          expected_revenue_impact?: number | null
          id?: string
          property_id: string
          recommendation_type: string
          recommended_at?: string
          recommended_by?: string | null
          sage_assessment_text?: string | null
          scout_report_json?: Json | null
          strategist_report_text?: string | null
          target_dates?: Json | null
          urgency_tier: string
        }
        Update: {
          created_at?: string | null
          discount_percentage?: number | null
          expected_occupancy_impact?: number | null
          expected_revenue_impact?: number | null
          id?: string
          property_id?: string
          recommendation_type?: string
          recommended_at?: string
          recommended_by?: string | null
          sage_assessment_text?: string | null
          scout_report_json?: Json | null
          strategist_report_text?: string | null
          target_dates?: Json | null
          urgency_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      agreed_commission_rates: {
        Row: {
          agreed_rate: number | null
          building_hpid: string
          building_name: string | null
          loaded_at: string | null
          partner: string | null
          source: string | null
        }
        Insert: {
          agreed_rate?: number | null
          building_hpid: string
          building_name?: string | null
          loaded_at?: string | null
          partner?: string | null
          source?: string | null
        }
        Update: {
          agreed_rate?: number | null
          building_hpid?: string
          building_name?: string | null
          loaded_at?: string | null
          partner?: string | null
          source?: string | null
        }
        Relationships: []
      }
      ask_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          queries: Json
          question: string
          row_counts: Json
          tool_call_count: number
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          queries?: Json
          question: string
          row_counts?: Json
          tool_call_count?: number
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          queries?: Json
          question?: string
          row_counts?: Json
          tool_call_count?: number
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ask_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar: {
        Row: {
          available: boolean | null
          base_price: number | null
          block_reason: string | null
          block_type: string | null
          blocked: boolean | null
          created_at: string | null
          date: string
          id: string
          last_synced_at: string | null
          min_stay: number | null
          property_id: string
          reservation_id: string | null
          reserved: boolean | null
          updated_at: string | null
        }
        Insert: {
          available?: boolean | null
          base_price?: number | null
          block_reason?: string | null
          block_type?: string | null
          blocked?: boolean | null
          created_at?: string | null
          date: string
          id?: string
          last_synced_at?: string | null
          min_stay?: number | null
          property_id: string
          reservation_id?: string | null
          reserved?: boolean | null
          updated_at?: string | null
        }
        Update: {
          available?: boolean | null
          base_price?: number | null
          block_reason?: string | null
          block_type?: string | null
          blocked?: boolean | null
          created_at?: string | null
          date?: string
          id?: string
          last_synced_at?: string | null
          min_stay?: number | null
          property_id?: string
          reservation_id?: string | null
          reserved?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          call_status: string
          conversation_id: string | null
          created_at: string
          direction: string
          duration_seconds: number | null
          id: string
          occurred_at: string
          phone_number: string | null
          provider: string
          provider_call_id: string
          recording_url: string | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          call_status: string
          conversation_id?: string | null
          created_at?: string
          direction: string
          duration_seconds?: number | null
          id?: string
          occurred_at: string
          phone_number?: string | null
          provider?: string
          provider_call_id: string
          recording_url?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          call_status?: string
          conversation_id?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          id?: string
          occurred_at?: string
          phone_number?: string | null
          provider?: string
          provider_call_id?: string
          recording_url?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_buddy_check: {
        Row: {
          alerted_at: string | null
          check_date: string
          property_id: string
          property_name: string | null
        }
        Insert: {
          alerted_at?: string | null
          check_date: string
          property_id: string
          property_name?: string | null
        }
        Update: {
          alerted_at?: string | null
          check_date?: string
          property_id?: string
          property_name?: string | null
        }
        Relationships: []
      }
      cleaning_form_option_map: {
        Row: {
          connecteam_job_id: string | null
          is_deleted: boolean | null
          last_synced_at: string | null
          match_confidence: string
          option_id: string
          option_text: string | null
          property_id: string | null
        }
        Insert: {
          connecteam_job_id?: string | null
          is_deleted?: boolean | null
          last_synced_at?: string | null
          match_confidence?: string
          option_id: string
          option_text?: string | null
          property_id?: string | null
        }
        Update: {
          connecteam_job_id?: string | null
          is_deleted?: boolean | null
          last_synced_at?: string | null
          match_confidence?: string
          option_id?: string
          option_text?: string | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_form_option_map_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_form_submission: {
        Row: {
          check_date: string
          form_id: string | null
          form_kind: string | null
          form_submission_id: string
          option_id: string | null
          property_id: string | null
          reservation_id: string | null
          submitted_at: string | null
          submitting_user_id: number | null
        }
        Insert: {
          check_date: string
          form_id?: string | null
          form_kind?: string | null
          form_submission_id: string
          option_id?: string | null
          property_id?: string | null
          reservation_id?: string | null
          submitted_at?: string | null
          submitting_user_id?: number | null
        }
        Update: {
          check_date?: string
          form_id?: string | null
          form_kind?: string | null
          form_submission_id?: string
          option_id?: string | null
          property_id?: string | null
          reservation_id?: string | null
          submitted_at?: string | null
          submitting_user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_form_submission_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_job_map: {
        Row: {
          connecteam_job_id: string
          connecteam_subjob_id: string | null
          connecteam_title: string | null
          hospitable_listing_id: string | null
          hospitable_property_id: string | null
          id: number
          in_scope: boolean
          is_active: boolean
          is_subjob: boolean
          last_synced_at: string | null
          market: string | null
          match_confidence: string
          node_key: string | null
          parent_title: string | null
          property_id: string | null
          property_name: string | null
        }
        Insert: {
          connecteam_job_id: string
          connecteam_subjob_id?: string | null
          connecteam_title?: string | null
          hospitable_listing_id?: string | null
          hospitable_property_id?: string | null
          id?: never
          in_scope?: boolean
          is_active?: boolean
          is_subjob?: boolean
          last_synced_at?: string | null
          market?: string | null
          match_confidence?: string
          node_key?: string | null
          parent_title?: string | null
          property_id?: string | null
          property_name?: string | null
        }
        Update: {
          connecteam_job_id?: string
          connecteam_subjob_id?: string | null
          connecteam_title?: string | null
          hospitable_listing_id?: string | null
          hospitable_property_id?: string | null
          id?: never
          in_scope?: boolean
          is_active?: boolean
          is_subjob?: boolean
          last_synced_at?: string | null
          market?: string | null
          match_confidence?: string
          node_key?: string | null
          parent_title?: string | null
          property_id?: string | null
          property_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_job_map_hospitable_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_property_form_map: {
        Row: {
          connecteam_job_id: string | null
          form_id: string
          form_name: string | null
          last_synced_at: string | null
          match_confidence: string
          property_id: string | null
        }
        Insert: {
          connecteam_job_id?: string | null
          form_id: string
          form_name?: string | null
          last_synced_at?: string | null
          match_confidence?: string
          property_id?: string | null
        }
        Update: {
          connecteam_job_id?: string | null
          form_id?: string
          form_name?: string | null
          last_synced_at?: string | null
          match_confidence?: string
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_property_form_map_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_shift_check: {
        Row: {
          alerted_flag: string | null
          assigned_count: number | null
          assigned_user_ids: Json | null
          check_date: string
          connecteam_job_id: string | null
          finished: boolean
          first_checkin_at: string | null
          flag: string | null
          is_published: boolean | null
          last_evaluated_at: string | null
          reservation_id: string | null
          shift_end: string | null
          shift_id: string
          shift_start: string | null
          started: boolean
        }
        Insert: {
          alerted_flag?: string | null
          assigned_count?: number | null
          assigned_user_ids?: Json | null
          check_date: string
          connecteam_job_id?: string | null
          finished?: boolean
          first_checkin_at?: string | null
          flag?: string | null
          is_published?: boolean | null
          last_evaluated_at?: string | null
          reservation_id?: string | null
          shift_end?: string | null
          shift_id: string
          shift_start?: string | null
          started?: boolean
        }
        Update: {
          alerted_flag?: string | null
          assigned_count?: number | null
          assigned_user_ids?: Json | null
          check_date?: string
          connecteam_job_id?: string | null
          finished?: boolean
          first_checkin_at?: string | null
          flag?: string | null
          is_published?: boolean | null
          last_evaluated_at?: string | null
          reservation_id?: string | null
          shift_end?: string | null
          shift_id?: string
          shift_start?: string | null
          started?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_shift_check_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      connecteam_chat_events: {
        Row: {
          event_type: string | null
          id: number
          raw: Json | null
          received_at: string
        }
        Insert: {
          event_type?: string | null
          id?: never
          raw?: Json | null
          received_at?: string
        }
        Update: {
          event_type?: string | null
          id?: never
          raw?: Json | null
          received_at?: string
        }
        Relationships: []
      }
      connecteam_chat_messages: {
        Row: {
          attachments: Json | null
          connecteam_message_id: string
          content: string | null
          conversation_id: string | null
          conversation_source: string | null
          conversation_type: string | null
          event_type: string | null
          is_system: boolean | null
          message_type: string | null
          raw: Json | null
          received_at: string
          recipient_id: number | null
          sender_id: number | null
          sender_type: string | null
          sent_at: string | null
        }
        Insert: {
          attachments?: Json | null
          connecteam_message_id: string
          content?: string | null
          conversation_id?: string | null
          conversation_source?: string | null
          conversation_type?: string | null
          event_type?: string | null
          is_system?: boolean | null
          message_type?: string | null
          raw?: Json | null
          received_at?: string
          recipient_id?: number | null
          sender_id?: number | null
          sender_type?: string | null
          sent_at?: string | null
        }
        Update: {
          attachments?: Json | null
          connecteam_message_id?: string
          content?: string | null
          conversation_id?: string | null
          conversation_source?: string | null
          conversation_type?: string | null
          event_type?: string | null
          is_system?: boolean | null
          message_type?: string | null
          raw?: Json | null
          received_at?: string
          recipient_id?: number | null
          sender_id?: number | null
          sender_type?: string | null
          sent_at?: string | null
        }
        Relationships: []
      }
      connecteam_users: {
        Row: {
          email: string | null
          first_name: string | null
          full_name: string | null
          is_archived: boolean | null
          last_name: string | null
          last_synced_at: string | null
          user_id: number
        }
        Insert: {
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          is_archived?: boolean | null
          last_name?: string | null
          last_synced_at?: string | null
          user_id: number
        }
        Update: {
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          is_archived?: boolean | null
          last_name?: string | null
          last_synced_at?: string | null
          user_id?: number
        }
        Relationships: []
      }
      conversations: {
        Row: {
          channel: string
          created_at: string
          external_id: string | null
          guest_id: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          property_id: string | null
          reservation_id: string | null
          unanswered: boolean
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          external_id?: string | null
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          property_id?: string | null
          reservation_id?: string | null
          unanswered?: boolean
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          external_id?: string | null
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          property_id?: string | null
          reservation_id?: string | null
          unanswered?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_classifications: {
        Row: {
          claim_key: string | null
          created_at: string
          event_type: string
          followup_window: string | null
          from_folder: string | null
          id: number
          model: string | null
          reason: string | null
          thread_id: string
          to_folder: string
        }
        Insert: {
          claim_key?: string | null
          created_at?: string
          event_type?: string
          followup_window?: string | null
          from_folder?: string | null
          id?: never
          model?: string | null
          reason?: string | null
          thread_id: string
          to_folder: string
        }
        Update: {
          claim_key?: string | null
          created_at?: string
          event_type?: string
          followup_window?: string | null
          from_folder?: string | null
          id?: never
          model?: string | null
          reason?: string | null
          thread_id?: string
          to_folder?: string
        }
        Relationships: []
      }
      guest_reviews: {
        Row: {
          category_tags: Json | null
          cleanliness: number | null
          communication: number | null
          created_at: string | null
          guest_first_name: string | null
          guest_full_name: string | null
          guest_last_name: string | null
          guest_name_normalized: string | null
          hospitable_review_id: string
          id: string
          last_synced_at: string | null
          platform: number | null
          private_feedback: string | null
          property_hospitable_id: string | null
          property_name: string | null
          public_message: string | null
          rating: number | null
          raw_hospitable_data: Json | null
          recommend: boolean | null
          reservation_code: string | null
          reservation_id: string | null
          respect_house_rules: number | null
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          category_tags?: Json | null
          cleanliness?: number | null
          communication?: number | null
          created_at?: string | null
          guest_first_name?: string | null
          guest_full_name?: string | null
          guest_last_name?: string | null
          guest_name_normalized?: string | null
          hospitable_review_id: string
          id?: string
          last_synced_at?: string | null
          platform?: number | null
          private_feedback?: string | null
          property_hospitable_id?: string | null
          property_name?: string | null
          public_message?: string | null
          rating?: number | null
          raw_hospitable_data?: Json | null
          recommend?: boolean | null
          reservation_code?: string | null
          reservation_id?: string | null
          respect_house_rules?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          category_tags?: Json | null
          cleanliness?: number | null
          communication?: number | null
          created_at?: string | null
          guest_first_name?: string | null
          guest_full_name?: string | null
          guest_last_name?: string | null
          guest_name_normalized?: string | null
          hospitable_review_id?: string
          id?: string
          last_synced_at?: string | null
          platform?: number | null
          private_feedback?: string | null
          property_hospitable_id?: string | null
          property_name?: string | null
          public_message?: string | null
          rating?: number | null
          raw_hospitable_data?: Json | null
          recommend?: boolean | null
          reservation_code?: string | null
          reservation_id?: string | null
          respect_house_rules?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      guests: {
        Row: {
          about: string | null
          airbnb_member_since: string | null
          average_rating: number | null
          created_at: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          hospitable_guest_id: string
          id: string
          languages: Json | null
          last_name: string | null
          last_synced_at: string | null
          location: string | null
          phone: string | null
          profile_picture_url: string | null
          raw_hospitable_data: Json | null
          reviews_count: number | null
          updated_at: string | null
          verifications: Json | null
        }
        Insert: {
          about?: string | null
          airbnb_member_since?: string | null
          average_rating?: number | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          hospitable_guest_id: string
          id?: string
          languages?: Json | null
          last_name?: string | null
          last_synced_at?: string | null
          location?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          raw_hospitable_data?: Json | null
          reviews_count?: number | null
          updated_at?: string | null
          verifications?: Json | null
        }
        Update: {
          about?: string | null
          airbnb_member_since?: string | null
          average_rating?: number | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          hospitable_guest_id?: string
          id?: string
          languages?: Json | null
          last_name?: string | null
          last_synced_at?: string | null
          location?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          raw_hospitable_data?: Json | null
          reviews_count?: number | null
          updated_at?: string | null
          verifications?: Json | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string | null
          booking_source: string | null
          conversation_id: string | null
          created_at: string | null
          direction: string | null
          guest_id: string | null
          hospitable_message_id: string
          id: string
          intent: string | null
          intent_confidence: number | null
          last_synced_at: string | null
          message_type: string | null
          property_id: string | null
          raw_hospitable_data: Json | null
          read_at: string | null
          reservation_id: string | null
          sent_at: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          booking_source?: string | null
          conversation_id?: string | null
          created_at?: string | null
          direction?: string | null
          guest_id?: string | null
          hospitable_message_id: string
          id?: string
          intent?: string | null
          intent_confidence?: number | null
          last_synced_at?: string | null
          message_type?: string | null
          property_id?: string | null
          raw_hospitable_data?: Json | null
          read_at?: string | null
          reservation_id?: string | null
          sent_at?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          booking_source?: string | null
          conversation_id?: string | null
          created_at?: string | null
          direction?: string | null
          guest_id?: string | null
          hospitable_message_id?: string
          id?: string
          intent?: string | null
          intent_confidence?: number | null
          last_synced_at?: string | null
          message_type?: string | null
          property_id?: string | null
          raw_hospitable_data?: Json | null
          read_at?: string | null
          reservation_id?: string | null
          sent_at?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_statement_expenses: {
        Row: {
          account: string | null
          amount: number | null
          created_at: string
          id: number
          markup_amount: number | null
          matched_claim_code: string | null
          matched_claim_source: string | null
          memo: string | null
          qb_txn_id: string | null
          statement_id: number
          vendor: string | null
        }
        Insert: {
          account?: string | null
          amount?: number | null
          created_at?: string
          id?: never
          markup_amount?: number | null
          matched_claim_code?: string | null
          matched_claim_source?: string | null
          memo?: string | null
          qb_txn_id?: string | null
          statement_id: number
          vendor?: string | null
        }
        Update: {
          account?: string | null
          amount?: number | null
          created_at?: string
          id?: never
          markup_amount?: number | null
          matched_claim_code?: string | null
          matched_claim_source?: string | null
          memo?: string | null
          qb_txn_id?: string | null
          statement_id?: number
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_statement_expenses_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "owner_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_statements: {
        Row: {
          commission_amount: number | null
          commission_rate_applied: number | null
          created_at: string
          gross_revenue: number | null
          id: number
          net_revenue: number | null
          owner_payout: number | null
          period_month: number
          period_year: number
          processed_at: string
          property_id: number | null
          raw_financials: Json | null
          status: string | null
          total_expenses: number | null
          vr_statement_id: string | null
        }
        Insert: {
          commission_amount?: number | null
          commission_rate_applied?: number | null
          created_at?: string
          gross_revenue?: number | null
          id?: never
          net_revenue?: number | null
          owner_payout?: number | null
          period_month: number
          period_year: number
          processed_at?: string
          property_id?: number | null
          raw_financials?: Json | null
          status?: string | null
          total_expenses?: number | null
          vr_statement_id?: string | null
        }
        Update: {
          commission_amount?: number | null
          commission_rate_applied?: number | null
          created_at?: string
          gross_revenue?: number | null
          id?: never
          net_revenue?: number | null
          owner_payout?: number | null
          period_month?: number
          period_year?: number
          processed_at?: string
          property_id?: number | null
          raw_financials?: Json | null
          status?: string | null
          total_expenses?: number | null
          vr_statement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_statements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_mapping"
            referencedColumns: ["id"]
          },
        ]
      }
      packnplay_requests: {
        Row: {
          check_in: string
          confirmation_code: string
          created_at: string | null
          detected_at: string | null
          guest_name: string | null
          id: string
          property_name: string | null
          requested: boolean
          reservation_id: string | null
          updated_at: string | null
        }
        Insert: {
          check_in: string
          confirmation_code: string
          created_at?: string | null
          detected_at?: string | null
          guest_name?: string | null
          id?: string
          property_name?: string | null
          requested?: boolean
          reservation_id?: string | null
          updated_at?: string | null
        }
        Update: {
          check_in?: string
          confirmation_code?: string
          created_at?: string | null
          detected_at?: string | null
          guest_name?: string | null
          id?: string
          property_name?: string | null
          requested?: boolean
          reservation_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packnplay_requests_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_health: {
        Row: {
          active_properties: number | null
          calendar_days_count: number | null
          calendar_ok: boolean | null
          check_date: string
          checked_at: string | null
          created_at: string | null
          failures: Json | null
          id: string
          is_healthy: boolean
          messages_ok: boolean | null
          metrics_daily_count: number | null
          metrics_daily_ok: boolean | null
          metrics_monthly_ok: boolean | null
          properties_ok: boolean | null
          reservations_ok: boolean | null
          reservations_synced_24h: number | null
          reviews_ok: boolean | null
        }
        Insert: {
          active_properties?: number | null
          calendar_days_count?: number | null
          calendar_ok?: boolean | null
          check_date?: string
          checked_at?: string | null
          created_at?: string | null
          failures?: Json | null
          id?: string
          is_healthy?: boolean
          messages_ok?: boolean | null
          metrics_daily_count?: number | null
          metrics_daily_ok?: boolean | null
          metrics_monthly_ok?: boolean | null
          properties_ok?: boolean | null
          reservations_ok?: boolean | null
          reservations_synced_24h?: number | null
          reviews_ok?: boolean | null
        }
        Update: {
          active_properties?: number | null
          calendar_days_count?: number | null
          calendar_ok?: boolean | null
          check_date?: string
          checked_at?: string | null
          created_at?: string | null
          failures?: Json | null
          id?: string
          is_healthy?: boolean
          messages_ok?: boolean | null
          metrics_daily_count?: number | null
          metrics_daily_ok?: boolean | null
          metrics_monthly_ok?: boolean | null
          properties_ok?: boolean | null
          reservations_ok?: boolean | null
          reservations_synced_24h?: number | null
          reviews_ok?: boolean | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          role: string
          slack_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          role: string
          slack_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string
          slack_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          airbnb_url: string | null
          amenities: Json | null
          bathrooms: number | null
          bedrooms: number | null
          beds: number | null
          booking_com_url: string | null
          calendar_restricted: boolean | null
          checkin_time: string | null
          checkout_time: string | null
          city: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          events_allowed: boolean | null
          hospitable_property_id: string
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          latitude: number | null
          listing_status: string | null
          longitude: number | null
          market: string | null
          max_guests: number | null
          parent_child_type: string | null
          parent_id: string | null
          pets_allowed: boolean | null
          photos: Json | null
          picture_url: string | null
          postal_code: string | null
          property_name: string
          property_type: string | null
          public_name: string | null
          raw_hospitable_data: Json | null
          room_details: Json | null
          room_type: string | null
          smoking_allowed: boolean | null
          state_province: string | null
          summary: string | null
          tags: Json | null
          timezone: string | null
          updated_at: string | null
          vrbo_url: string | null
        }
        Insert: {
          address?: string | null
          airbnb_url?: string | null
          amenities?: Json | null
          bathrooms?: number | null
          bedrooms?: number | null
          beds?: number | null
          booking_com_url?: string | null
          calendar_restricted?: boolean | null
          checkin_time?: string | null
          checkout_time?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          events_allowed?: boolean | null
          hospitable_property_id: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          latitude?: number | null
          listing_status?: string | null
          longitude?: number | null
          market?: string | null
          max_guests?: number | null
          parent_child_type?: string | null
          parent_id?: string | null
          pets_allowed?: boolean | null
          photos?: Json | null
          picture_url?: string | null
          postal_code?: string | null
          property_name: string
          property_type?: string | null
          public_name?: string | null
          raw_hospitable_data?: Json | null
          room_details?: Json | null
          room_type?: string | null
          smoking_allowed?: boolean | null
          state_province?: string | null
          summary?: string | null
          tags?: Json | null
          timezone?: string | null
          updated_at?: string | null
          vrbo_url?: string | null
        }
        Update: {
          address?: string | null
          airbnb_url?: string | null
          amenities?: Json | null
          bathrooms?: number | null
          bedrooms?: number | null
          beds?: number | null
          booking_com_url?: string | null
          calendar_restricted?: boolean | null
          checkin_time?: string | null
          checkout_time?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          events_allowed?: boolean | null
          hospitable_property_id?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          latitude?: number | null
          listing_status?: string | null
          longitude?: number | null
          market?: string | null
          max_guests?: number | null
          parent_child_type?: string | null
          parent_id?: string | null
          pets_allowed?: boolean | null
          photos?: Json | null
          picture_url?: string | null
          postal_code?: string | null
          property_name?: string
          property_type?: string | null
          public_name?: string | null
          raw_hospitable_data?: Json | null
          room_details?: Json | null
          room_type?: string | null
          smoking_allowed?: boolean | null
          state_province?: string | null
          summary?: string | null
          tags?: Json | null
          timezone?: string | null
          updated_at?: string | null
          vrbo_url?: string | null
        }
        Relationships: []
      }
      property_mapping: {
        Row: {
          active: boolean
          created_at: string
          id: number
          notes: string | null
          qb_class_nickname: string
          sheet_property_name: string | null
          updated_at: string
          vr_listing_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          notes?: string | null
          qb_class_nickname: string
          sheet_property_name?: string | null
          updated_at?: string
          vr_listing_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          notes?: string | null
          qb_class_nickname?: string
          sheet_property_name?: string | null
          updated_at?: string
          vr_listing_id?: string | null
        }
        Relationships: []
      }
      property_metrics: {
        Row: {
          adr: number | null
          available_days: number | null
          blocked_days: number | null
          calculated_at: string | null
          host_payout: number | null
          id: string
          market: string | null
          occupancy_rate: number | null
          period: string
          property_id: string
          property_name: string | null
          reservations_count: number | null
          reserved_days: number | null
          revpar: number | null
          total_days: number | null
          total_nights: number | null
          total_revenue: number | null
        }
        Insert: {
          adr?: number | null
          available_days?: number | null
          blocked_days?: number | null
          calculated_at?: string | null
          host_payout?: number | null
          id?: string
          market?: string | null
          occupancy_rate?: number | null
          period: string
          property_id: string
          property_name?: string | null
          reservations_count?: number | null
          reserved_days?: number | null
          revpar?: number | null
          total_days?: number | null
          total_nights?: number | null
          total_revenue?: number | null
        }
        Update: {
          adr?: number | null
          available_days?: number | null
          blocked_days?: number | null
          calculated_at?: string | null
          host_payout?: number | null
          id?: string
          market?: string | null
          occupancy_rate?: number | null
          period?: string
          property_id?: string
          property_name?: string | null
          reservations_count?: number | null
          reserved_days?: number | null
          revpar?: number | null
          total_days?: number | null
          total_nights?: number | null
          total_revenue?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_metrics_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_metrics_daily: {
        Row: {
          adr_30d: number | null
          adr_60d: number | null
          adr_90d: number | null
          available_30d: number | null
          available_60d: number | null
          available_90d: number | null
          blocked_30d: number | null
          blocked_60d: number | null
          blocked_90d: number | null
          calculated_at: string | null
          gap_nights_30d: number | null
          id: string
          market: string | null
          occ_30d: number | null
          occ_60d: number | null
          occ_90d: number | null
          property_id: string
          property_name: string | null
          reserved_30d: number | null
          reserved_60d: number | null
          reserved_90d: number | null
          revenue_30d: number | null
          revenue_60d: number | null
          revenue_90d: number | null
          revpar_30d: number | null
          revpar_60d: number | null
          revpar_90d: number | null
          snapshot_date: string
          total_30d: number | null
          total_60d: number | null
          total_90d: number | null
        }
        Insert: {
          adr_30d?: number | null
          adr_60d?: number | null
          adr_90d?: number | null
          available_30d?: number | null
          available_60d?: number | null
          available_90d?: number | null
          blocked_30d?: number | null
          blocked_60d?: number | null
          blocked_90d?: number | null
          calculated_at?: string | null
          gap_nights_30d?: number | null
          id?: string
          market?: string | null
          occ_30d?: number | null
          occ_60d?: number | null
          occ_90d?: number | null
          property_id: string
          property_name?: string | null
          reserved_30d?: number | null
          reserved_60d?: number | null
          reserved_90d?: number | null
          revenue_30d?: number | null
          revenue_60d?: number | null
          revenue_90d?: number | null
          revpar_30d?: number | null
          revpar_60d?: number | null
          revpar_90d?: number | null
          snapshot_date?: string
          total_30d?: number | null
          total_60d?: number | null
          total_90d?: number | null
        }
        Update: {
          adr_30d?: number | null
          adr_60d?: number | null
          adr_90d?: number | null
          available_30d?: number | null
          available_60d?: number | null
          available_90d?: number | null
          blocked_30d?: number | null
          blocked_60d?: number | null
          blocked_90d?: number | null
          calculated_at?: string | null
          gap_nights_30d?: number | null
          id?: string
          market?: string | null
          occ_30d?: number | null
          occ_60d?: number | null
          occ_90d?: number | null
          property_id?: string
          property_name?: string | null
          reserved_30d?: number | null
          reserved_60d?: number | null
          reserved_90d?: number | null
          revenue_30d?: number | null
          revenue_60d?: number | null
          revenue_90d?: number | null
          revpar_30d?: number | null
          revpar_60d?: number | null
          revpar_90d?: number | null
          snapshot_date?: string
          total_30d?: number | null
          total_60d?: number | null
          total_90d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_metrics_daily_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_classes: {
        Row: {
          active: boolean | null
          confirmed_listing: string | null
          confirmed_raw: string | null
          depth: number | null
          fully_qualified_name: string | null
          hpid: string | null
          hpid_method: string | null
          is_property: boolean | null
          map_confidence: string | null
          map_status: string | null
          mapped_hpid: string | null
          mapped_property_id: string | null
          mapped_property_name: string | null
          name: string | null
          parent_group: string | null
          qbo_class_id: string
          signed_at: string | null
          signed_status: string | null
          synced_at: string | null
        }
        Insert: {
          active?: boolean | null
          confirmed_listing?: string | null
          confirmed_raw?: string | null
          depth?: number | null
          fully_qualified_name?: string | null
          hpid?: string | null
          hpid_method?: string | null
          is_property?: boolean | null
          map_confidence?: string | null
          map_status?: string | null
          mapped_hpid?: string | null
          mapped_property_id?: string | null
          mapped_property_name?: string | null
          name?: string | null
          parent_group?: string | null
          qbo_class_id: string
          signed_at?: string | null
          signed_status?: string | null
          synced_at?: string | null
        }
        Update: {
          active?: boolean | null
          confirmed_listing?: string | null
          confirmed_raw?: string | null
          depth?: number | null
          fully_qualified_name?: string | null
          hpid?: string | null
          hpid_method?: string | null
          is_property?: boolean | null
          map_confidence?: string | null
          map_status?: string | null
          mapped_hpid?: string | null
          mapped_property_id?: string | null
          mapped_property_name?: string | null
          name?: string | null
          parent_group?: string | null
          qbo_class_id?: string
          signed_at?: string | null
          signed_status?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_classes_mapped_property_id_fkey"
            columns: ["mapped_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_transactions: {
        Row: {
          currency: string | null
          doc_number: string | null
          entity_name: string | null
          has_class: boolean | null
          private_note: string | null
          qbo_id: string
          raw: Json | null
          synced_at: string | null
          total_amt: number | null
          txn_date: string | null
          txn_type: string
        }
        Insert: {
          currency?: string | null
          doc_number?: string | null
          entity_name?: string | null
          has_class?: boolean | null
          private_note?: string | null
          qbo_id: string
          raw?: Json | null
          synced_at?: string | null
          total_amt?: number | null
          txn_date?: string | null
          txn_type: string
        }
        Update: {
          currency?: string | null
          doc_number?: string | null
          entity_name?: string | null
          has_class?: boolean | null
          private_note?: string | null
          qbo_id?: string
          raw?: Json | null
          synced_at?: string | null
          total_amt?: number | null
          txn_date?: string | null
          txn_type?: string
        }
        Relationships: []
      }
      reconciliation_exceptions: {
        Row: {
          check_id: string
          created_at: string
          expected_value: string | null
          fix_needed: string | null
          id: number
          published_value: string | null
          run_id: string | null
          severity: string | null
          statement_id: number | null
        }
        Insert: {
          check_id: string
          created_at?: string
          expected_value?: string | null
          fix_needed?: string | null
          id?: never
          published_value?: string | null
          run_id?: string | null
          severity?: string | null
          statement_id?: number | null
        }
        Update: {
          check_id?: string
          created_at?: string
          expected_value?: string | null
          fix_needed?: string | null
          id?: never
          published_value?: string | null
          run_id?: string | null
          severity?: string | null
          statement_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_exceptions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "owner_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          booked_at: string | null
          booking_source: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          check_in: string
          check_out: string
          cleaning_fee: number | null
          confirmation_code: string | null
          created_at: string | null
          guest_count: number | null
          guest_id: string | null
          hospitable_reservation_id: string
          host_payout: number | null
          id: string
          last_synced_at: string | null
          nightly_rate: number | null
          nights: number | null
          property_id: string
          raw_hospitable_data: Json | null
          special_requests: string | null
          status: string
          taxes: number | null
          total_nightly: number | null
          total_revenue: number | null
          updated_at: string | null
        }
        Insert: {
          booked_at?: string | null
          booking_source?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          check_in: string
          check_out: string
          cleaning_fee?: number | null
          confirmation_code?: string | null
          created_at?: string | null
          guest_count?: number | null
          guest_id?: string | null
          hospitable_reservation_id: string
          host_payout?: number | null
          id?: string
          last_synced_at?: string | null
          nightly_rate?: number | null
          nights?: number | null
          property_id: string
          raw_hospitable_data?: Json | null
          special_requests?: string | null
          status: string
          taxes?: number | null
          total_nightly?: number | null
          total_revenue?: number | null
          updated_at?: string | null
        }
        Update: {
          booked_at?: string | null
          booking_source?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          check_in?: string
          check_out?: string
          cleaning_fee?: number | null
          confirmation_code?: string | null
          created_at?: string | null
          guest_count?: number | null
          guest_id?: string | null
          hospitable_reservation_id?: string
          host_payout?: number | null
          id?: string
          last_synced_at?: string | null
          nightly_rate?: number | null
          nights?: number | null
          property_id?: string
          raw_hospitable_data?: Json | null
          special_requests?: string | null
          status?: string
          taxes?: number | null
          total_nightly?: number | null
          total_revenue?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      review_flags: {
        Row: {
          agent_verdict: string | null
          checkout_date: string | null
          confidence: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          draft_rating: number | null
          draft_recommend: boolean | null
          draft_review: string | null
          evidence_snippet: string | null
          existing_rating: number | null
          existing_review: string | null
          flagged: boolean
          guest_name: string | null
          id: number
          our_fault: string | null
          preview_ts: string | null
          property_name: string | null
          reason: string | null
          reminders_cancelled: boolean | null
          reservation_code: string | null
          reservation_uuid: string | null
          review_handled: boolean | null
          severity: string | null
          slack_channel: string | null
          slack_hits: number | null
          slack_ts: string | null
          source: string | null
          status: string
          suggested_rating: number | null
          suggested_review: string | null
          their_fault: string | null
          updated_at: string
        }
        Insert: {
          agent_verdict?: string | null
          checkout_date?: string | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          draft_rating?: number | null
          draft_recommend?: boolean | null
          draft_review?: string | null
          evidence_snippet?: string | null
          existing_rating?: number | null
          existing_review?: string | null
          flagged?: boolean
          guest_name?: string | null
          id?: never
          our_fault?: string | null
          preview_ts?: string | null
          property_name?: string | null
          reason?: string | null
          reminders_cancelled?: boolean | null
          reservation_code?: string | null
          reservation_uuid?: string | null
          review_handled?: boolean | null
          severity?: string | null
          slack_channel?: string | null
          slack_hits?: number | null
          slack_ts?: string | null
          source?: string | null
          status?: string
          suggested_rating?: number | null
          suggested_review?: string | null
          their_fault?: string | null
          updated_at?: string
        }
        Update: {
          agent_verdict?: string | null
          checkout_date?: string | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          draft_rating?: number | null
          draft_recommend?: boolean | null
          draft_review?: string | null
          evidence_snippet?: string | null
          existing_rating?: number | null
          existing_review?: string | null
          flagged?: boolean
          guest_name?: string | null
          id?: never
          our_fault?: string | null
          preview_ts?: string | null
          property_name?: string | null
          reason?: string | null
          reminders_cancelled?: boolean | null
          reservation_code?: string | null
          reservation_uuid?: string | null
          review_handled?: boolean | null
          severity?: string | null
          slack_channel?: string | null
          slack_hits?: number | null
          slack_ts?: string | null
          source?: string | null
          status?: string
          suggested_rating?: number | null
          suggested_review?: string | null
          their_fault?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      review_removal_drafts: {
        Row: {
          airbnb_response: string | null
          attempt_number: number | null
          created_at: string | null
          draft_email: string | null
          guest_name: string | null
          id: string
          property_name: string | null
          review_id: string
          review_rating: number | null
          review_text: string | null
          slack_thread_ts: string | null
          status: string | null
          updated_at: string | null
          violation_types: string | null
        }
        Insert: {
          airbnb_response?: string | null
          attempt_number?: number | null
          created_at?: string | null
          draft_email?: string | null
          guest_name?: string | null
          id?: string
          property_name?: string | null
          review_id: string
          review_rating?: number | null
          review_text?: string | null
          slack_thread_ts?: string | null
          status?: string | null
          updated_at?: string | null
          violation_types?: string | null
        }
        Update: {
          airbnb_response?: string | null
          attempt_number?: number | null
          created_at?: string | null
          draft_email?: string | null
          guest_name?: string | null
          id?: string
          property_name?: string | null
          review_id?: string
          review_rating?: number | null
          review_text?: string | null
          slack_thread_ts?: string | null
          status?: string | null
          updated_at?: string | null
          violation_types?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          accuracy_rating: number | null
          booking_source: string | null
          checkin_rating: number | null
          cleanliness_rating: number | null
          communication_rating: number | null
          created_at: string | null
          guest_id: string | null
          hospitable_review_id: string
          host_response: string | null
          id: string
          last_synced_at: string | null
          location_rating: number | null
          overall_rating: number | null
          property_id: string
          raw_hospitable_data: Json | null
          removed_at: string | null
          reservation_id: string | null
          response_date: string | null
          review_date: string | null
          review_text: string | null
          reviewer_name: string | null
          updated_at: string | null
          value_rating: number | null
        }
        Insert: {
          accuracy_rating?: number | null
          booking_source?: string | null
          checkin_rating?: number | null
          cleanliness_rating?: number | null
          communication_rating?: number | null
          created_at?: string | null
          guest_id?: string | null
          hospitable_review_id: string
          host_response?: string | null
          id?: string
          last_synced_at?: string | null
          location_rating?: number | null
          overall_rating?: number | null
          property_id: string
          raw_hospitable_data?: Json | null
          removed_at?: string | null
          reservation_id?: string | null
          response_date?: string | null
          review_date?: string | null
          review_text?: string | null
          reviewer_name?: string | null
          updated_at?: string | null
          value_rating?: number | null
        }
        Update: {
          accuracy_rating?: number | null
          booking_source?: string | null
          checkin_rating?: number | null
          cleanliness_rating?: number | null
          communication_rating?: number | null
          created_at?: string | null
          guest_id?: string | null
          hospitable_review_id?: string
          host_response?: string | null
          id?: string
          last_synced_at?: string | null
          location_rating?: number | null
          overall_rating?: number | null
          property_id?: string
          raw_hospitable_data?: Json | null
          removed_at?: string | null
          reservation_id?: string | null
          response_date?: string | null
          review_date?: string | null
          review_text?: string | null
          reviewer_name?: string | null
          updated_at?: string | null
          value_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_overrides: {
        Row: {
          covering: string
          key: string
          updated_at: string
        }
        Insert: {
          covering: string
          key: string
          updated_at?: string
        }
        Update: {
          covering?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      slack_channels: {
        Row: {
          channel_id: string
          created_at_slack: string | null
          history_access: boolean | null
          is_archived: boolean | null
          is_general: boolean | null
          is_private: boolean | null
          last_checked_at: string | null
          last_message_at: string | null
          name: string | null
          num_members: number | null
          purpose: string | null
          topic: string | null
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at_slack?: string | null
          history_access?: boolean | null
          is_archived?: boolean | null
          is_general?: boolean | null
          is_private?: boolean | null
          last_checked_at?: string | null
          last_message_at?: string | null
          name?: string | null
          num_members?: number | null
          purpose?: string | null
          topic?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at_slack?: string | null
          history_access?: boolean | null
          is_archived?: boolean | null
          is_general?: boolean | null
          is_private?: boolean | null
          last_checked_at?: string | null
          last_message_at?: string | null
          name?: string | null
          num_members?: number | null
          purpose?: string | null
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      slack_messages: {
        Row: {
          channel_id: string
          channel_type: string | null
          created_at: string
          event_type: string | null
          id: number
          raw: Json | null
          sent_at: string | null
          slack_ts: string
          subtype: string | null
          text: string | null
          thread_ts: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          channel_id: string
          channel_type?: string | null
          created_at?: string
          event_type?: string | null
          id?: never
          raw?: Json | null
          sent_at?: string | null
          slack_ts: string
          subtype?: string | null
          text?: string | null
          thread_ts?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          channel_id?: string
          channel_type?: string | null
          created_at?: string
          event_type?: string | null
          id?: never
          raw?: Json | null
          sent_at?: string | null
          slack_ts?: string
          subtype?: string | null
          text?: string | null
          thread_ts?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      slack_users: {
        Row: {
          display_name: string | null
          is_bot: boolean | null
          real_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          display_name?: string | null
          is_bot?: boolean | null
          real_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          display_name?: string | null
          is_bot?: boolean | null
          real_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      str_wealth_slack_export: {
        Row: {
          captured_at: string
          channel_id: string
          channel_name: string
          export_run_id: string | null
          has_attachments: boolean | null
          id: number
          is_thread_reply: boolean | null
          message_text: string | null
          message_ts: string
          raw_payload: Json | null
          reply_count: number
          sent_at: string
          thread_replies: Json | null
          thread_ts: string | null
          user_id: string | null
          username: string | null
          workspace: string
        }
        Insert: {
          captured_at?: string
          channel_id: string
          channel_name: string
          export_run_id?: string | null
          has_attachments?: boolean | null
          id?: number
          is_thread_reply?: boolean | null
          message_text?: string | null
          message_ts: string
          raw_payload?: Json | null
          reply_count?: number
          sent_at: string
          thread_replies?: Json | null
          thread_ts?: string | null
          user_id?: string | null
          username?: string | null
          workspace?: string
        }
        Update: {
          captured_at?: string
          channel_id?: string
          channel_name?: string
          export_run_id?: string | null
          has_attachments?: boolean | null
          id?: number
          is_thread_reply?: boolean | null
          message_text?: string | null
          message_ts?: string
          raw_payload?: Json | null
          reply_count?: number
          sent_at?: string
          thread_replies?: Json | null
          thread_ts?: string | null
          user_id?: string | null
          username?: string | null
          workspace?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          error_details: Json | null
          error_message: string | null
          id: string
          records_created: number | null
          records_failed: number | null
          records_processed: number | null
          records_updated: number | null
          sync_completed_at: string | null
          sync_entity: string
          sync_source: string
          sync_started_at: string
          sync_status: string
          sync_type: string
          triggered_by: string | null
        }
        Insert: {
          created_at?: string | null
          duration_seconds?: number | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          records_created?: number | null
          records_failed?: number | null
          records_processed?: number | null
          records_updated?: number | null
          sync_completed_at?: string | null
          sync_entity: string
          sync_source: string
          sync_started_at?: string
          sync_status: string
          sync_type: string
          triggered_by?: string | null
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          records_created?: number | null
          records_failed?: number | null
          records_processed?: number | null
          records_updated?: number | null
          sync_completed_at?: string | null
          sync_entity?: string
          sync_source?: string
          sync_started_at?: string
          sync_status?: string
          sync_type?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      ticket_attachments: {
        Row: {
          created_at: string
          id: string
          kind: string
          review_removal_draft_id: string | null
          storage_path: string
          ticket_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          review_removal_draft_id?: string | null
          storage_path: string
          ticket_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          review_removal_draft_id?: string | null
          storage_path?: string
          ticket_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_review_removal_draft_id_fkey"
            columns: ["review_removal_draft_id"]
            isOneToOne: false
            referencedRelation: "review_removal_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_value: string | null
          id: string
          note: string | null
          payload: Json
          ticket_id: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_value?: string | null
          id?: string
          note?: string | null
          payload?: Json
          ticket_id: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_value?: string | null
          id?: string
          note?: string | null
          payload?: Json
          ticket_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_items: {
        Row: {
          created_at: string
          done_at: string | null
          done_by: string | null
          id: string
          is_done: boolean
          label: string
          sort_order: number
          ticket_id: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          label: string
          sort_order?: number
          ticket_id: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          label?: string
          sort_order?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          assignee_id: string | null
          closed_at: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          external_ref: string | null
          guest_name: string | null
          id: string
          metadata: Json
          parent_ticket_id: string | null
          priority: string
          property_id: string | null
          reservation_id: string | null
          rollover_count: number
          sla_breached: boolean
          source: string
          staff_ref: string | null
          stage: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          closed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          external_ref?: string | null
          guest_name?: string | null
          id?: string
          metadata?: Json
          parent_ticket_id?: string | null
          priority?: string
          property_id?: string | null
          reservation_id?: string | null
          rollover_count?: number
          sla_breached?: boolean
          source: string
          staff_ref?: string | null
          stage?: string | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          closed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          external_ref?: string | null
          guest_name?: string | null
          id?: string
          metadata?: Json
          parent_ticket_id?: string | null
          priority?: string
          property_id?: string | null
          reservation_id?: string | null
          rollover_count?: number
          sla_breached?: boolean
          source?: string
          staff_ref?: string | null
          stage?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_parent_ticket_id_fkey"
            columns: ["parent_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      unanswered_message_alerts: {
        Row: {
          alerted_at: string
          escalation_count: number
          hospitable_message_id: string
          id: string
          last_escalated_at: string | null
          reservation_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          slack_channel: string | null
          slack_ts: string | null
        }
        Insert: {
          alerted_at?: string
          escalation_count?: number
          hospitable_message_id: string
          id?: string
          last_escalated_at?: string | null
          reservation_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          slack_channel?: string | null
          slack_ts?: string | null
        }
        Update: {
          alerted_at?: string
          escalation_count?: number
          hospitable_message_id?: string
          id?: string
          last_escalated_at?: string | null
          reservation_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          slack_channel?: string | null
          slack_ts?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unanswered_message_alerts_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      vr_listing_map: {
        Row: {
          hpid: string | null
          hpid_method: string | null
          listing: string
          updated_at: string | null
        }
        Insert: {
          hpid?: string | null
          hpid_method?: string | null
          listing: string
          updated_at?: string | null
        }
        Update: {
          hpid?: string | null
          hpid_method?: string | null
          listing?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      vr_statement_summary: {
        Row: {
          currency: string | null
          current_balance: number | null
          ending_balance: number | null
          id: number
          is_draft: boolean | null
          listing: string | null
          loaded_at: string | null
          month: string | null
          net_income: number | null
          owner_payout: number | null
          owners: string | null
          period_date: string | null
          raw: Json | null
          starting_balance: number | null
          status: string | null
        }
        Insert: {
          currency?: string | null
          current_balance?: number | null
          ending_balance?: number | null
          id?: number
          is_draft?: boolean | null
          listing?: string | null
          loaded_at?: string | null
          month?: string | null
          net_income?: number | null
          owner_payout?: number | null
          owners?: string | null
          period_date?: string | null
          raw?: Json | null
          starting_balance?: number | null
          status?: string | null
        }
        Update: {
          currency?: string | null
          current_balance?: number | null
          ending_balance?: number | null
          id?: number
          is_draft?: boolean | null
          listing?: string | null
          loaded_at?: string | null
          month?: string | null
          net_income?: number | null
          owner_payout?: number | null
          owners?: string | null
          period_date?: string | null
          raw?: Json | null
          starting_balance?: number | null
          status?: string | null
        }
        Relationships: []
      }
      vr_statements: {
        Row: {
          balance_end: number | null
          balance_start: number | null
          currency: string | null
          expenses: number | null
          listing_id: string | null
          listing_name: string | null
          listing_ref: string | null
          net_income: number | null
          net_revenue: number | null
          owner_names: string | null
          payouts: number | null
          period: string | null
          period_end: string | null
          period_start: string | null
          raw: Json | null
          reserve: number | null
          statement_id: string
          status: string | null
          synced_at: string | null
          total: number | null
        }
        Insert: {
          balance_end?: number | null
          balance_start?: number | null
          currency?: string | null
          expenses?: number | null
          listing_id?: string | null
          listing_name?: string | null
          listing_ref?: string | null
          net_income?: number | null
          net_revenue?: number | null
          owner_names?: string | null
          payouts?: number | null
          period?: string | null
          period_end?: string | null
          period_start?: string | null
          raw?: Json | null
          reserve?: number | null
          statement_id: string
          status?: string | null
          synced_at?: string | null
          total?: number | null
        }
        Update: {
          balance_end?: number | null
          balance_start?: number | null
          currency?: string | null
          expenses?: number | null
          listing_id?: string | null
          listing_name?: string | null
          listing_ref?: string | null
          net_income?: number | null
          net_revenue?: number | null
          owner_names?: string | null
          payouts?: number | null
          period?: string | null
          period_end?: string | null
          period_start?: string | null
          raw?: Json | null
          reserve?: number | null
          statement_id?: string
          status?: string | null
          synced_at?: string | null
          total?: number | null
        }
        Relationships: []
      }
      z_backfill_queue: {
        Row: {
          completed_at: string | null
          date_from: string
          date_to: string
          id: number
          label: string
          queue_type: string | null
        }
        Insert: {
          completed_at?: string | null
          date_from: string
          date_to: string
          id?: number
          label: string
          queue_type?: string | null
        }
        Update: {
          completed_at?: string | null
          date_from?: string
          date_to?: string
          id?: number
          label?: string
          queue_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      qbo_expense_lines: {
        Row: {
          account_or_item_id: string | null
          account_or_item_name: string | null
          amount: number | null
          class_id: string | null
          class_name: string | null
          description: string | null
          detail_type: string | null
          entity_name: string | null
          line_id: string | null
          qbo_id: string | null
          txn_date: string | null
          txn_type: string | null
        }
        Relationships: []
      }
      recon_building_commission: {
        Row: {
          building_group: string | null
          commission: number | null
          commission_rate: number | null
          fees: number | null
          gross: number | null
          opex: number | null
          owner_adj: number | null
          owner_tax: number | null
          parent_group: string | null
          payout: number | null
          period_date: string | null
        }
        Relationships: []
      }
      recon_commission_audit: {
        Row: {
          agreed_rate: number | null
          building_name: string | null
          commission_10mo: number | null
          gross_10mo: number | null
          partner: string | null
          rate_hosp: number | null
          rate_moneyin: number | null
          var_moneyin: number | null
          verdict: string | null
        }
        Relationships: []
      }
      recon_commission_audit_v2: {
        Row: {
          agreed_rate: number | null
          building_name: string | null
          comm: number | null
          n_bookings: number | null
          net_accom: number | null
          normalized: number | null
          partner: string | null
          portfolio_norm: number | null
          rate_pct: number | null
          ratio_to_agreed: number | null
          verdict: string | null
        }
        Relationships: []
      }
      recon_commission_flags: {
        Row: {
          building_hpid: string | null
          building_name: string | null
          commission_10mo: number | null
          eff_rate: number | null
          gross_10mo: number | null
          status: string | null
        }
        Relationships: []
      }
      recon_crosswalk: {
        Row: {
          hospitable_name: string | null
          hpid: string | null
          market: string | null
          qbo_class_id: string | null
          qbo_listing: string | null
          qbo_method: string | null
          vr_listing: string | null
          vr_net_income: number | null
          vr_status: string | null
        }
        Relationships: []
      }
      recon_damage_register: {
        Row: {
          amount: number | null
          confirmed_listing: string | null
          description: string | null
          entity_name: string | null
          hpid: string | null
          qbo_id: string | null
          txn_date: string | null
        }
        Relationships: []
      }
      recon_expense_anomaly: {
        Row: {
          building_median: number | null
          building_name: string | null
          excess: number | null
          opex_month: number | null
          period_date: string | null
        }
        Relationships: []
      }
      recon_qbo_statement: {
        Row: {
          cc_fees: number | null
          channel_fees: number | null
          commission_rate: number | null
          damage: number | null
          hpid: string | null
          opex_total: number | null
          owner_adj: number | null
          owner_tax: number | null
          period_date: string | null
          qbo_commission: number | null
          qbo_gross: number | null
          qbo_payout: number | null
        }
        Relationships: []
      }
      recon_worksheet: {
        Row: {
          any_draft: boolean | null
          ccy: string | null
          expenses: number | null
          host_payout: number | null
          hpid: string | null
          implied_commission: number | null
          implied_rate: number | null
          month: string | null
          n_lines: number | null
          n_res: number | null
          period_date: string | null
          property_name: string | null
          total_revenue: number | null
          vr_net_income: number | null
          vr_payout: number | null
        }
        Relationships: []
      }
      v_cleanliness_accountability: {
        Row: {
          assigned_cleaner: string | null
          check_in: string | null
          cleanliness_rating: number | null
          clocked_in: boolean | null
          flag_reason: string | null
          form_filed: boolean | null
          guest: string | null
          market: string | null
          overall_rating: number | null
          property: string | null
          review_date: string | null
          review_snippet: string | null
          shift_flag: string | null
        }
        Relationships: []
      }
      v_cleanliness_reviews_untracked: {
        Row: {
          cleanliness_rating: number | null
          flag_reason: string | null
          guest: string | null
          market: string | null
          overall_rating: number | null
          property: string | null
          review_date: string | null
          review_snippet: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ask_pique_run_sql: { Args: { query: string }; Returns: Json[] }
      get_checkout_evidence: {
        Args: { day: string }
        Returns: {
          city: string
          confirmation_code: string
          guest_name: string
          hospitable_reservation_id: string
          msg_count: number
          property_name: string
          reservation_id: string
          slack_hits: number
          slack_snippets: string
          transcript: string
        }[]
      }
      get_guest_history:
        | { Args: { p_name_norm: string }; Returns: Json }
        | { Args: { p_email?: string; p_name_norm: string }; Returns: Json }
      is_admin: { Args: { uid: string }; Returns: boolean }
      link_reservation_guests: { Args: never; Returns: number }
      link_review_reservations: { Args: never; Returns: number }
      norm_listing: { Args: { t: string }; Returns: string }
      pique_norm: { Args: { p: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
