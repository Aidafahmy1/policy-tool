-- Supabase table schema for Policy Tool
-- Run this in your Supabase SQL Editor (supabase.com -> your project -> SQL Editor)

CREATE TABLE submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  process_name TEXT NOT NULL,
  narration TEXT NOT NULL,
  mermaid_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revision_requested')),
  revision_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index for faster queries by user_id
CREATE INDEX idx_submissions_user_id ON submissions(user_id);

-- Create an index for status filtering
CREATE INDEX idx_submissions_status ON submissions(status);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- Policy to allow all operations for now (you can restrict later)
CREATE POLICY "Allow all operations" ON submissions
  FOR ALL
  USING (true)
  WITH CHECK (true);
