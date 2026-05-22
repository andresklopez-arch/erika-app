-- Script para crear la tabla de servicios técnicos / citas a domicilio
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    technician_name TEXT NOT NULL,
    service_type TEXT NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    notes TEXT
);

-- Habilitar acceso para todos los usuarios autenticados
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Eliminar la política si ya existe para evitar errores al volver a ejecutar el script
DROP POLICY IF EXISTS "Allow read/write access for all authenticated users" ON public.services;

CREATE POLICY "Allow read/write access for all authenticated users" 
ON public.services 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);
