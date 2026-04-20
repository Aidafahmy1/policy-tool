import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface DiagramEditState {
  posOffsets: Record<string, { dx: number; dy: number }>;
  arrowOverrides: Record<string, { x: number; y: number }[]>;
  labelOverrides: Record<string, string>;
  deletedConnections: string[];
  extraShapes: Array<{ id: string; label: string; type: string; x: number; y: number }>;
  extraConnections: Array<{ from: string; to: string; label?: string }>;
}

export interface Diagram {
  id: string;
  conversation_id: string;
  mermaid_code: string;
  swimlane_data?: string | null;
  version: number;
  label?: string | null;
  edit_state?: DiagramEditState | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  conversation_id: string;
  file_name: string;
  file_type: string;
  file_content: string;
  created_at: string;
}
