-- Migration: Add is_direct and direct_exam_name to orders table
-- Run this in your Supabase SQL Editor

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS direct_exam_name TEXT;

-- Index for faster filtering of direct orders
CREATE INDEX IF NOT EXISTS idx_orders_is_direct ON orders(is_direct) WHERE is_direct = true;
