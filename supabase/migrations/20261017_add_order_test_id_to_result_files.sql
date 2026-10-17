-- Migration: Associate result_files with specific order_tests
-- Permite que cada examen dentro de una orden tenga su propio archivo de resultados cargado de forma independiente.

ALTER TABLE public.result_files 
ADD COLUMN IF NOT EXISTS order_test_id UUID REFERENCES public.order_tests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_result_files_order_test_id ON public.result_files (order_test_id);
