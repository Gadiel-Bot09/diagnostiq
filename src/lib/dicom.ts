/**
 * Utilidades para detección y manejo de archivos DICOM y Tomografías 3D en DiagnostiQ
 */

export interface ResultFileMeta {
    id?: string
    file_name?: string
    file_type?: string | null
    mime_type?: string | null
    storage_path?: string
    size_bytes?: number
    version?: number
    performed_at?: string | null
    uploaded_at?: string | null
    order_test_id?: string | null
    metadata_json?: any
}

/**
 * Determina de forma inteligente si un archivo de resultados corresponde
 * a una tomografía computarizada / serie DICOM o a un informe PDF convencional.
 */
export function isDicomFile(file: ResultFileMeta | null | undefined): boolean {
    if (!file) return false

    // 1. Clasificación explícita por base de datos
    if (file.file_type === "DICOM_ZIP" || file.file_type === "DICOM") {
        return true
    }

    // 2. Clasificación por tipo MIME
    if (file.mime_type) {
        const mime = file.mime_type.toLowerCase()
        if (mime.includes("dicom") || mime === "application/x-zip-compressed" || mime === "application/zip") {
            // Si el nombre termina en zip o dcm
            const name = (file.file_name || "").toLowerCase()
            if (name.endsWith(".zip") || name.endsWith(".dcm")) return true
        }
    }

    // 3. Clasificación por extensión de archivo
    const name = (file.file_name || "").toLowerCase()
    return name.endsWith(".zip") || name.endsWith(".dcm")
}
