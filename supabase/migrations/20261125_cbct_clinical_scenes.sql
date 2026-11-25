-- Fase 4: Persistencia de Escenas Clínicas CBCT y Cortes Específicos Preparados
-- Se apoya en la columna existente `public.result_files.metadata_json` (JSONB) para compatibilidad inmediata sin interrupciones.
-- Esta migración garantiza la existencia de `metadata_json` y agrega un índice GIN parcial para consultas rápidas de estudios con escenas guardadas.

ALTER TABLE public.result_files
ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_result_files_has_cbct_scene
ON public.result_files ((metadata_json ? 'cbct_scene'))
WHERE (metadata_json ? 'cbct_scene');

COMMENT ON COLUMN public.result_files.metadata_json IS
'Metadatos técnicos DICOM y escena clínica CBCT persistida bajo la clave cbct_scene (curva del arco, cortes específicos marcados, nervio dentario y mediciones calibradas).';
