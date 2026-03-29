import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type SubmissionStatus = 'pending' | 'approved' | 'revision_requested';

export interface Submission {
  id: string;
  user_id: string;
  process_name: string;
  narration: string;
  mermaid_code: string | null;
  status: SubmissionStatus;
  created_at: string;
}
