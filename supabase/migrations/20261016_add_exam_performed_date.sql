-- Fecha de realización de los exámenes (ingresada al cargar resultados).
-- Las otras dos fechas ya existen: orders.ordered_at (generación de la orden)
-- y result_files.uploaded_at (fecha de cargue).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS performed_at DATE;
ALTER TABLE public.result_files ADD COLUMN IF NOT EXISTS performed_at DATE;

CREATE INDEX IF NOT EXISTS idx_orders_performed_at ON public.orders (lab_id, performed_at);
