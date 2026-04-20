-- Migration: Add version history support to diagrams table
-- Run this in Supabase SQL Editor AFTER v2 schema is applied

-- Add label column for user-provided version names
ALTER TABLE diagrams ADD COLUMN IF NOT EXISTS label TEXT;

-- Add edit_state column for storing diagram edit state (drag offsets, arrow overrides, etc.)
ALTER TABLE diagrams ADD COLUMN IF NOT EXISTS edit_state JSONB;

-- Add swimlane_data column if not already present (may have been added manually)
ALTER TABLE diagrams ADD COLUMN IF NOT EXISTS swimlane_data JSONB;
