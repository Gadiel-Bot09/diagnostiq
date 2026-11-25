import JSZip from "jszip"

export interface CleanDicomZipResult {
    file: File
    cleaned: boolean
    originalSize: number
    newSize: number
    savedMB: number
    dicomSlicesCount: number
    clinicalSheetsCount?: number
}

/**
 * Extensiones de instaladores de escritorio y binarios de sistema (Windows/Mac)
 * que empaquetan los tomógrafos (Sirona GALILEOS, InVivoDental, Romexis, Sidexis, etc.)
 * y aumentan enormemente el peso del paquete sin aportar datos DICOM web.
 */
const BANNED_INSTALLER_EXTENSIONS = [
    ".exe",
    ".dll",
    ".msi",
    ".bat",
    ".cmd",
    ".inf",
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
    ".dat",
    ".pak",
    ".jar",
    ".chm",
    ".hlp",
    ".db",
    ".sqlite",
    ".ico",
    ".mp4",
    ".avi",
    ".7z",
    ".rar",
    ".zip",
]

const BANNED_NON_DICOM_TEXT_EXTENSIONS = [
    ".docx",
    ".doc",
    ".txt",
    ".rtf",
    ".xml",
    ".htm",
    ".html",
    ".bmp",
]

const CLINICAL_SHEET_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"]

const SOFTWARE_DOC_KEYWORDS = [
    "readme",
    "license",
    "licencia",
    "manual",
    "guide",
    "guia",
    "instruc",
    "install",
    "setup",
    "splash",
    "logo",
    "icon",
    "banner",
    "about",
    "eula",
    "release",
    "changelog",
    "galileos",
    "invivo",
    "sidexis",
    "romexis",
    "sirona",
    "anatomage",
]

const BANNED_BASENAMES = new Set([
    "dicomdir",
    "autorun",
    "autorun.inf",
    "thumbs.db",
    ".ds_store",
    "readme",
    "license",
    "setup",
    "install",
])

function isInsideSoftwareFolder(normalizedLower: string): boolean {
    return (
        normalizedLower.includes("__macosx/") ||
        normalizedLower.includes("/instalar software/") ||
        normalizedLower.includes("/instalador/") ||
        normalizedLower.includes("/viewer/") ||
        normalizedLower.includes("/setup/") ||
        normalizedLower.includes("/program/") ||
        normalizedLower.includes("/bin/") ||
        normalizedLower.includes("/jre/") ||
        normalizedLower.includes("/redist/") ||
        normalizedLower.includes("/galileos viewer/") ||
        normalizedLower.includes("/invivoviewer/") ||
        normalizedLower.includes("/invivo/") ||
        normalizedLower.startsWith("viewer/") ||
        normalizedLower.startsWith("setup/") ||
        normalizedLower.startsWith("instalar software/")
    )
}

/**
 * Determina si una entrada corresponde a una lámina de cortes específicos o informe clínico
 * generado por el centro radiológico (PDF o imagen JPG/PNG fuera de carpetas de instaladores).
 */
export function isClinicalSheetEntry(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase()
    if (isInsideSoftwareFolder(normalized)) return false
    const baseName = normalized.split("/").pop() || ""
    if (!baseName || baseName.startsWith(".") || BANNED_BASENAMES.has(baseName)) return false
    if (!CLINICAL_SHEET_EXTENSIONS.some((ext) => baseName.endsWith(ext))) return false
    if (SOFTWARE_DOC_KEYWORDS.some((kw) => baseName.includes(kw))) return false
    return true
}

export function isBannedInstallerFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase()
    if (normalized.includes("__macosx/")) return true
    if (isInsideSoftwareFolder(normalized)) {
        // Incluso dentro de subcarpetas de software, ignorar cualquier archivo que no sea .dcm
        if (!normalized.endsWith(".dcm") && !normalized.endsWith(".dcm30")) return true
    }

    const baseName = normalized.split("/").pop() || ""
    if (!baseName || BANNED_BASENAMES.has(baseName)) return true

    if (BANNED_INSTALLER_EXTENSIONS.some((ext) => baseName.endsWith(ext))) return true
    if (BANNED_NON_DICOM_TEXT_EXTENSIONS.some((ext) => baseName.endsWith(ext))) return true
    if (CLINICAL_SHEET_EXTENSIONS.some((ext) => baseName.endsWith(ext))) return true
    return false
}

/**
 * Conserva la jerarquía relativa de subcarpetas DICOM para evitar colisiones de nombres
 * entre múltiples series (ej. Series1/IMG0001.dcm vs Series2/IMG0001.dcm).
 */
function buildPreservedDicomPath(rawPath: string, usedPaths: Set<string>): string {
    const cleaned = rawPath
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .split("/")
        .filter((seg) => seg && seg !== "." && seg !== "..")
        .join("/")
    let target = cleaned.toLowerCase().startsWith("dicom/") ? cleaned : `DICOM/${cleaned}`
    if (!usedPaths.has(target.toLowerCase())) {
        usedPaths.add(target.toLowerCase())
        return target
    }
    const dot = target.lastIndexOf(".")
    let idx = 2
    while (true) {
        const candidate = dot > 0 ? `${target.slice(0, dot)}_${idx}${target.slice(dot)}` : `${target}_${idx}`
        if (!usedPaths.has(candidate.toLowerCase())) {
            usedPaths.add(candidate.toLowerCase())
            return candidate
        }
        idx++
    }
}

/**
 * Determina si una ruta interna dentro de un archivo comprimido (.zip / .rar)
 * corresponde a un corte tomográfico DICOM válido (.dcm).
 */
export function isDicomSliceEntry(entryPath: string): boolean {
    const normalized = entryPath.replace(/\\/g, "/")
    const lower = normalized.toLowerCase()
    if (isBannedInstallerFile(lower)) return false

    const baseName = lower.split("/").pop() || ""
    if (!baseName || baseName.startsWith(".")) return false

    const hasDotInBase = baseName.includes(".")
    return (
        baseName.endsWith(".dcm") ||
        baseName.endsWith(".dcm30") ||
        lower.includes("/dcm/") ||
        lower.includes("/dicom/") ||
        !hasDotInBase
    )
}

/**
 * Detecta el formato binario real de un Blob/File leyendo su firma mágica (magic bytes),
 * independientemente de si el usuario le puso extensión .zip a un archivo WinRAR (.rar).
 */
export async function detectArchiveFormat(blob: Blob): Promise<"zip" | "rar" | "dcm" | "unknown"> {
    try {
        const headerSlice = blob.slice(0, Math.min(140, blob.size))
        const buf = new Uint8Array(await headerSlice.arrayBuffer())

        // Firma ZIP: PK\x03\x04 (0x50 0x4B 0x03 0x04) o PK\x05\x06 (ZIP vacío)
        if (
            buf.length >= 4 &&
            buf[0] === 0x50 &&
            buf[1] === 0x4b &&
            (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
        ) {
            return "zip"
        }

        // Firma WinRAR v4 / v5: Rar!\x1A\x07 (0x52 0x61 0x72 0x21 0x1A 0x07)
        if (
            buf.length >= 6 &&
            buf[0] === 0x52 &&
            buf[1] === 0x61 &&
            buf[2] === 0x72 &&
            buf[3] === 0x21 &&
            buf[4] === 0x1a &&
            buf[5] === 0x07
        ) {
            return "rar"
        }

        // Firma DICOM estándar: "DICM" en el byte 128..131
        if (
            buf.length >= 132 &&
            buf[128] === 0x44 &&
            buf[129] === 0x49 &&
            buf[130] === 0x43 &&
            buf[131] === 0x4d
        ) {
            return "dcm"
        }
    } catch (e) {
        console.warn("[detectArchiveFormat] Error leyendo cabecera binaria:", e)
    }
    return "unknown"
}

let cachedUnrarWasm: ArrayBuffer | null = null

async function getUnrarWasmBinary(): Promise<ArrayBuffer> {
    if (cachedUnrarWasm) return cachedUnrarWasm
    const res = await fetch("/wasm/unrar.wasm")
    if (!res.ok) {
        throw new Error(`No se pudo cargar el módulo WebAssembly unrar.wasm (${res.status})`)
    }
    cachedUnrarWasm = await res.arrayBuffer()
    return cachedUnrarWasm
}

const MAX_CLINICAL_SHEET_BYTES = 25 * 1024 * 1024 // 25 MB máx. por lámina/informe clínico

export interface ExtractedClinicalSheet {
    name: string
    kind: "pdf" | "image"
    data: Uint8Array
}

/**
 * Extrae los cortes tomográficos DICOM (.dcm) y láminas clínicas (PDF/JPG/PNG fuera de instaladores)
 * desde un archivo WinRAR (v4 o v5), descartando en C++/WebAssembly todos los ejecutables (.exe, .inv, .dll, etc.).
 */
export async function extractDicomFilesFromRar(
    blob: Blob,
    onProgress?: (percent: number, message: string) => void
): Promise<{
    dcmFiles: File[]
    rawSlices: { name: string; data: Uint8Array }[]
    clinicalSheets: ExtractedClinicalSheet[]
    skippedCount: number
    skippedBytes: number
}> {
    onProgress?.(10, "Cargando motor de descompresión RAR/DICOM...")
    const [wasmBinary, archiveBuffer] = await Promise.all([
        getUnrarWasmBinary(),
        blob.arrayBuffer(),
    ])

    const { createExtractorFromData } = await import("node-unrar-js/esm/index.esm")
    const extractor = await createExtractorFromData({
        wasmBinary,
        data: archiveBuffer,
    })

    // 1. Listar cabeceras para identificar cortes DICOM y láminas clínicas vs instaladores pesados
    const list = extractor.getFileList()
    const headers = [...list.fileHeaders]

    let skippedCount = 0
    let skippedBytes = 0
    let validTargetCount = 0

    for (const h of headers) {
        if (h.flags.directory) continue
        const isDcm = isDicomSliceEntry(h.name)
        const isSheet = !isDcm && isClinicalSheetEntry(h.name) && (h.unpSize || 0) <= MAX_CLINICAL_SHEET_BYTES
        if (isDcm || isSheet) {
            validTargetCount++
        } else {
            skippedCount++
            skippedBytes += h.unpSize || 0
        }
    }

    onProgress?.(
        25,
        `Extrayendo ${validTargetCount} archivos clínicos (ignorando ${skippedCount} archivos de instalación)...`
    )

    // 2. Extraer cortes DICOM válidos + láminas clínicas del estudio
    const extracted = extractor.extract({
        files: (fh) =>
            !fh.flags.directory &&
            (isDicomSliceEntry(fh.name) ||
                (isClinicalSheetEntry(fh.name) && (fh.unpSize || 0) <= MAX_CLINICAL_SHEET_BYTES)),
    })

    const dcmFiles: File[] = []
    const rawSlices: { name: string; data: Uint8Array }[] = []
    const clinicalSheets: ExtractedClinicalSheet[] = []
    let processed = 0

    for (const item of extracted.files) {
        if (item.fileHeader.flags.directory || !item.extraction) continue
        const normalizedPath = item.fileHeader.name.replace(/\\/g, "/")
        const baseName = normalizedPath.split("/").pop() || normalizedPath
        // Copiar el buffer extraído para que sea independiente de la memoria WASM
        const sliceBytes = new Uint8Array(item.extraction)

        if (isDicomSliceEntry(normalizedPath)) {
            rawSlices.push({ name: normalizedPath, data: sliceBytes })
            // Usar ruta única segura para evitar colisiones entre series
            const safeUniqueName = normalizedPath.replace(/\//g, "__")
            dcmFiles.push(new File([sliceBytes], safeUniqueName, { type: "application/dicom" }))
        } else if (isClinicalSheetEntry(normalizedPath)) {
            const lower = baseName.toLowerCase()
            clinicalSheets.push({
                name: baseName,
                kind: lower.endsWith(".pdf") ? "pdf" : "image",
                data: sliceBytes,
            })
        }

        processed++
        if (processed % 25 === 0 || processed === validTargetCount) {
            const pct = 25 + Math.round((processed / Math.max(1, validTargetCount)) * 45)
            onProgress?.(pct, `Procesando archivo clínico ${processed} de ${validTargetCount}...`)
            await new Promise((r) => setTimeout(r, 0))
        }
    }

    return { dcmFiles, rawSlices, clinicalSheets, skippedCount, skippedBytes }
}

/**
 * Analiza un archivo .zip o .rar (incluso cuando un archivo RAR tiene extensión .zip).
 * Elimina instaladores de PC pesados (GALILEOS, InVivoDental .exe/.dll/.inv),
 * conserva TODAS las series DICOM sin colisión de nombres (preservando subcarpetas)
 * y mantiene láminas/informes clínicos del radiólogo (PDF/JPG/PNG).
 */
export async function cleanDicomZip(
    file: File,
    onProgress?: (message: string, percent: number) => void
): Promise<CleanDicomZipResult> {
    const fileNameLower = file.name.toLowerCase()
    if (!fileNameLower.endsWith(".zip") && !fileNameLower.endsWith(".rar")) {
        return {
            file,
            cleaned: false,
            originalSize: file.size,
            newSize: file.size,
            savedMB: 0,
            dicomSlicesCount: 0,
            clinicalSheetsCount: 0,
        }
    }

    try {
        onProgress?.("Inspeccionando estructura del paquete tomográfico...", 5)
        const format = await detectArchiveFormat(file)

        // CASO A: El archivo es internamente un paquete WinRAR (aunque se llame .zip o .rar)
        if (format === "rar") {
            const { rawSlices, clinicalSheets, skippedCount, skippedBytes } = await extractDicomFilesFromRar(
                file,
                (pct, msg) => onProgress?.(msg, pct)
            )

            if (rawSlices.length === 0) {
                return {
                    file,
                    cleaned: false,
                    originalSize: file.size,
                    newSize: file.size,
                    savedMB: 0,
                    dicomSlicesCount: 0,
                    clinicalSheetsCount: 0,
                }
            }

            onProgress?.(`Empaquetando ${rawSlices.length} cortes DICOM limpios en formato ZIP estándar...`, 72)
            const cleanZip = new JSZip()
            const usedPaths = new Set<string>()
            for (const s of rawSlices) {
                const targetPath = buildPreservedDicomPath(s.name, usedPaths)
                cleanZip.file(targetPath, s.data)
            }
            for (const sheet of clinicalSheets) {
                cleanZip.file(`CLINICAL_SHEETS/${sheet.name}`, sheet.data)
            }

            const cleanBlob = await cleanZip.generateAsync(
                {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 1 },
                },
                (meta) => {
                    const progressPct = 72 + Math.round((meta.percent / 100) * 26)
                    onProgress?.(`Optimizando paquete DICOM limpio... ${meta.percent.toFixed(0)}%`, progressPct)
                }
            )

            const cleanName = file.name.replace(/\.rar$/i, ".zip")
            const cleanFile = new File([cleanBlob], cleanName, {
                type: "application/zip",
                lastModified: Date.now(),
            })

            const savedBytes = Math.max(file.size - cleanFile.size, skippedBytes)
            const savedMB = Math.max(0, savedBytes / (1024 * 1024))

            console.log(
                `[cleanDicomZip] Convertido RAR->ZIP limpio: ${rawSlices.length} cortes DICOM, ${clinicalSheets.length} láminas clínicas, omitidos ${skippedCount} instaladores (${savedMB.toFixed(1)} MB descartados).`
            )

            return {
                file: cleanFile,
                cleaned: true,
                originalSize: file.size,
                newSize: cleanFile.size,
                savedMB,
                dicomSlicesCount: rawSlices.length,
                clinicalSheetsCount: clinicalSheets.length,
            }
        }

        // CASO B: El archivo es un paquete ZIP estándar
        if (format === "zip") {
            onProgress?.("Analizando contenido del archivo ZIP...", 8)
            const zip = await JSZip.loadAsync(file)

            const allEntryNames = Object.keys(zip.files)
            const nonDirNames = allEntryNames.filter((name) => !zip.files[name].dir)
            const validDicomNames = nonDirNames.filter((name) => isDicomSliceEntry(name))
            const clinicalSheetNames = nonDirNames.filter((name) => !isDicomSliceEntry(name) && isClinicalSheetEntry(name))
            const discardedCount = nonDirNames.length - validDicomNames.length - clinicalSheetNames.length

            // Si ya está limpio (solo cortes DICOM y láminas clínicas, sin ejecutables/instaladores)
            if (discardedCount === 0 && validDicomNames.length > 0) {
                return {
                    file,
                    cleaned: false,
                    originalSize: file.size,
                    newSize: file.size,
                    savedMB: 0,
                    dicomSlicesCount: validDicomNames.length,
                    clinicalSheetsCount: clinicalSheetNames.length,
                }
            }

            if (validDicomNames.length === 0) {
                console.warn("[cleanDicomZip] No se detectaron cortes DICOM en el ZIP, conservando original")
                return {
                    file,
                    cleaned: false,
                    originalSize: file.size,
                    newSize: file.size,
                    savedMB: 0,
                    dicomSlicesCount: 0,
                    clinicalSheetsCount: clinicalSheetNames.length,
                }
            }

            onProgress?.(
                `Descartando ${discardedCount} instalador(es) y conservando ${validDicomNames.length} cortes DICOM...`,
                18
            )

            const cleanZip = new JSZip()
            const usedPaths = new Set<string>()
            let processed = 0
            for (const name of validDicomNames) {
                const entry = zip.files[name]
                const data = await entry.async("uint8array")
                const targetPath = buildPreservedDicomPath(name, usedPaths)
                cleanZip.file(targetPath, data)
                processed++
                if (processed % 30 === 0 || processed === validDicomNames.length) {
                    const pct = 18 + Math.round((processed / validDicomNames.length) * 30)
                    onProgress?.(`Extrayendo corte DICOM ${processed} de ${validDicomNames.length}...`, pct)
                }
            }

            let savedSheets = 0
            for (const sheetName of clinicalSheetNames) {
                const entry = zip.files[sheetName]
                const data = await entry.async("uint8array")
                if (data.byteLength <= MAX_CLINICAL_SHEET_BYTES) {
                    const baseName = sheetName.replace(/\\/g, "/").split("/").pop() || sheetName
                    cleanZip.file(`CLINICAL_SHEETS/${baseName}`, data)
                    savedSheets++
                }
            }

            onProgress?.(`Comprimiendo ${validDicomNames.length} cortes tomográficos limpios...`, 52)

            const cleanBlob = await cleanZip.generateAsync(
                {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 1 },
                },
                (meta) => {
                    const progressPct = 52 + Math.round((meta.percent / 100) * 45)
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
                dicomSlicesCount: validDicomNames.length,
                clinicalSheetsCount: savedSheets,
            }
        }

        return {
            file,
            cleaned: false,
            originalSize: file.size,
            newSize: file.size,
            savedMB: 0,
            dicomSlicesCount: 0,
            clinicalSheetsCount: 0,
        }
    } catch (err: any) {
        console.error("[cleanDicomZip] Error al limpiar archivo:", err)
        return {
            file,
            cleaned: false,
            originalSize: file.size,
            newSize: file.size,
            savedMB: 0,
            dicomSlicesCount: 0,
            clinicalSheetsCount: 0,
        }
    }
}
