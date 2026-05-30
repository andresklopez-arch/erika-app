-- Migration: Tasks RLS Configuration

-- 1. Enable RLS
ALTER TABLE public.internal_tasks ENABLE ROW LEVEL SECURITY;

-- 2. Drop policy if exists
DROP POLICY IF EXISTS "Permitir todo a anonimos en tareas" ON public.internal_tasks;

-- 3. Create policy for full public access
CREATE POLICY "Permitir todo a anonimos en tareas" 
ON public.internal_tasks 
FOR ALL 
USING (true) 
WITH CHECK (true);
