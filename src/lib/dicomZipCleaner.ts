import JSZip from "jszip"

export interface CleanDicomZipResult {
    file: File
    cleaned: boolean
    originalSize: number
    newSize: number
    savedMB: number
    dicomSlicesCount: number
}

/**
 * Extensiones y archivos de instaladores de escritorio (Windows/Mac)
 * que empaquetan los tomógrafos pero que son innecesarios para el visor web.
 */
const BANNED_EXTENSIONS = [
    ".exe",
    ".dll",
    ".msi",
    ".bat",
    ".cmd",
    ".inf",
    ".docx",
    ".doc",
    ".inv",
    ".sdx",
    ".gwg",
    ".manifest",
    ".ini",
    ".sys",
    ".iso",
    ".bin",
    ".app",
    ".dmg",
    ".pkg",
    ".cab",
]

export function isBannedInstallerFile(filePath: string): boolean {
    const lower = filePath.toLowerCase()
    return BANNED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Analiza un archivo .zip. Si contiene instaladores de PC pesados (VISOR GALILEO, InVivoDental, etc.),
 * extrae únicamente la serie de cortes tomográficos DICOM (.dcm) y re-empaqueta un ZIP limpio y ligero,
 * reduciendo el peso de ~450 MB a solo ~120 MB antes de subirlo a MinIO.
 */
export async function cleanDicomZip(
    file: File,
    onProgress?: (message: string, percent: number) => void
): Promise<CleanDicomZipResult> {
    const fileNameLower = file.name.toLowerCase()
    if (!fileNameLower.endsWith(".zip")) {
        return {
            file,
            cleaned: false,
            originalSize: file.size,
            newSize: file.size,
            savedMB: 0,
            dicomSlicesCount: 0,
        }
    }

    try {
        onProgress?.("Analizando contenido del archivo ZIP...", 5)
        const zip = await JSZip.loadAsync(file)

        const allEntryNames = Object.keys(zip.files)
        const hasBannedFiles = allEntryNames.some((name) => {
            const entry = zip.files[name]
            return !entry.dir && isBannedInstallerFile(name)
        })

        // Si ya está limpio (no contiene instaladores de escritorio), sube directamente
        if (!hasBannedFiles) {
            const dcmCount = allEntryNames.filter((n) => {
                const lower = n.toLowerCase()
                return !zip.files[n].dir && (lower.endsWith(".dcm") || lower.includes("/dcm/") || lower.includes("/dicom/"))
            }).length

            return {
                file,
                cleaned: false,
                originalSize: file.size,
                newSize: file.size,
                savedMB: 0,
                dicomSlicesCount: dcmCount,
            }
        }

        onProgress?.("Detectados instaladores de PC. Filtrando cortes DICOM puros...", 15)

        // Seleccionar solo archivos de tomografía DICOM válidos
        const cleanZip = new JSZip()
        let dicomCount = 0

        for (const name of allEntryNames) {
            const entry = zip.files[name]
            if (entry.dir) continue
            if (isBannedInstallerFile(name)) continue

            const lower = name.toLowerCase()
            const isDicom =
                lower.endsWith(".dcm") ||
                lower.endsWith(".dcm30") ||
                lower.includes("/dcm/") ||
                lower.includes("/dicom/") ||
                !lower.includes(".")

            if (isDicom) {
                const data = await entry.async("uint8array")
                cleanZip.file(name, data)
                dicomCount++
            }
        }

        if (dicomCount === 0) {
            // Si por alguna razón no se detectaron cortes filtrados, conserva el original
            console.warn("[cleanDicomZip] No se detectaron cortes específicos .dcm, conservando ZIP original")
            return {
                file,
                cleaned: false,
                originalSize: file.size,
                newSize: file.size,
                savedMB: 0,
                dicomSlicesCount: 0,
            }
        }

        onProgress?.(`Comprimiendo ${dicomCount} cortes tomográficos limpios...`, 40)

        // Generar el archivo ZIP optimizado sin la basura de instalación
        const cleanBlob = await cleanZip.generateAsync(
            {
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 4 },
            },
            (meta) => {
                const progressPct = 40 + Math.round((meta.percent / 100) * 55)
                onProgress?.(`Optimizando tomografía limpia... ${meta.percent.toFixed(0)}%`, progressPct)
            }
        )

        const cleanFile = new File([cleanBlob], file.name, {
            type: "application/zip",
            lastModified: Date.now(),
        })

        const savedMB = Math.max(0, (file.size - cleanFile.size) / (1024 * 1024))

        return {
            file: cleanFile,
            cleaned: true,
            originalSize: file.size,
            newSize: cleanFile.size,
            savedMB,
            dicomSlicesCount: dicomCount,
        }
    } catch (err: any) {
        console.error("[cleanDicomZip] Error al limpiar archivo ZIP:", err)
        // Fallback seguro: si falla la limpieza en memoria, retorna el archivo original
        return {
            file,
            cleaned: false,
            originalSize: file.size,
            newSize: file.size,
            savedMB: 0,
            dicomSlicesCount: 0,
        }
    }
}
