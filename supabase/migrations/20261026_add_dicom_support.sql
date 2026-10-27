-- Migration: Add DICOM / Tomography support to result_files
-- Permite clasificar archivos como PDF o DICOM_ZIP y almacenar metadatos técnicos del estudio.

ALTER TABLE public.result_files 
ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'PDF';

ALTER TABLE public.result_files 
ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;

-- Actualizar registros existentes que no tengan file_type
UPDATE public.result_files 
SET file_type = 'PDF' 
WHERE file_type IS NULL;

-- Índice para optimizar consultas por tipo de archivo
CREATE INDEX IF NOT EXISTS idx_result_files_file_type ON public.result_files (file_type);

COMMENT ON COLUMN public.result_files.file_type IS 'PDF para informes escritos, DICOM_ZIP para series tomográficas';
COMMENT ON COLUMN public.result_files.metadata_json IS 'Metadatos del estudio (cortes, fabricante, modalidad)';
