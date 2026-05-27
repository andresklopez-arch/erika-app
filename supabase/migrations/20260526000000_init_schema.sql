-- Initial Schema Migration

CREATE TABLE IF NOT EXISTS public.internal_tasks ( 
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL, 
  title TEXT NOT NULL, 
  assigned_to TEXT NOT NULL, 
  status TEXT DEFAULT 'pending', 
  created_by TEXT 
);
