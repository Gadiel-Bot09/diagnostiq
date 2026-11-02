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
 * a una tomografía computarizada / serie DICOM (.zip, .rar, .dcm) o a un informe PDF convencional.
 * Soporta tanto un objeto `ResultFileMeta` como `(fileName: string, fileType?: string)`.
 */
export function isDicomFile(
    file: ResultFileMeta | string | null | undefined,
    fileTypeArg?: string | null
): boolean {
    if (!file) return false

    if (typeof file === "string") {
        if (fileTypeArg === "DICOM_ZIP" || fileTypeArg === "DICOM") return true
        const lower = file.toLowerCase()
        return lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".dcm")
    }

    // 1. Clasificación explícita por base de datos
    if (file.file_type === "DICOM_ZIP" || file.file_type === "DICOM") {
        return true
    }

    const name = (file.file_name || "").toLowerCase()

    // 2. Clasificación por tipo MIME
    if (file.mime_type) {
        const mime = file.mime_type.toLowerCase()
        if (
            mime.includes("dicom") ||
            mime.includes("zip") ||
            mime.includes("rar") ||
            mime === "application/x-rar-compressed" ||
            mime === "application/vnd.rar"
        ) {
            if (name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".dcm")) return true
        }
    }

    // 3. Clasificación por extensión de archivo
    return name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".dcm")
}
