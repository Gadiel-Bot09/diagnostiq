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
 * Extensiones de instaladores de escritorio, manuales y archivos adjuntos (Windows/Mac)
 * que empaquetan los tomógrafos (Sirona GALILEOS, InVivoDental, Romexis, Sidexis, etc.)
 * pero que son innecesarios para el visor web y aumentan el peso del paquete.
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
    ".pdf",
    ".txt",
    ".rtf",
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
    ".xml",
    ".htm",
    ".html",
    ".db",
    ".sqlite",
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".ico",
    ".mp4",
    ".avi",
    ".7z",
    ".rar",
    ".zip",
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

export function isBannedInstallerFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase()
    if (normalized.includes("__macosx/")) return true
    if (normalized.includes("/instalar software/") || normalized.includes("/viewer/") || normalized.includes("/setup/")) {
        // Incluso dentro de subcarpetas de software, ignorar cualquier archivo que no sea .dcm
        if (!normalized.endsWith(".dcm") && !normalized.endsWith(".dcm30")) return true
    }

    const baseName = normalized.split("/").pop() || ""
    if (!baseName || BANNED_BASENAMES.has(baseName)) return true

    return BANNED_EXTENSIONS.some((ext) => baseName.endsWith(ext))
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

/**
 * Extrae únicamente los cortes tomográficos DICOM (.dcm) desde un archivo WinRAR (v4 o v5),
 * descartando en C++/WebAssembly todos los ejecutables (.exe, .inv, .dll, .pdf, .docx).
 */
export async function extractDicomFilesFromRar(
    blob: Blob,
    onProgress?: (percent: number, message: string) => void
): Promise<{
    dcmFiles: File[]
    rawSlices: { name: string; data: Uint8Array }[]
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

    // 1. Listar cabeceras para identificar cortes DICOM vs instaladores pesados
    const list = extractor.getFileList()
    const headers = [...list.fileHeaders]

    let skippedCount = 0
    let skippedBytes = 0
    let validTargetCount = 0

    for (const h of headers) {
        if (h.flags.directory) continue
        if (isDicomSliceEntry(h.name)) {
            validTargetCount++
        } else {
            skippedCount++
            skippedBytes += h.unpSize || 0
        }
    }

    onProgress?.(
        25,
        `Extrayendo ${validTargetCount} cortes DICOM (ignorando ${skippedCount} archivos de instalación)...`
    )

    // 2. Extraer únicamente los cortes DICOM válidos
    const extracted = extractor.extract({
        files: (fh) => !fh.flags.directory && isDicomSliceEntry(fh.name),
    })

    const dcmFiles: File[] = []
    const rawSlices: { name: string; data: Uint8Array }[] = []
    let processed = 0

    for (const item of extracted.files) {
        if (item.fileHeader.flags.directory || !item.extraction) continue
        const normalizedPath = item.fileHeader.name.replace(/\\/g, "/")
        const baseName = normalizedPath.split("/").pop() || normalizedPath
        // Copiar el buffer extraído para que sea independiente de la memoria WASM
        const sliceBytes = new Uint8Array(item.extraction)

        rawSlices.push({ name: normalizedPath, data: sliceBytes })
        dcmFiles.push(new File([sliceBytes], baseName, { type: "application/dicom" }))

        processed++
        if (processed % 25 === 0 || processed === validTargetCount) {
            const pct = 25 + Math.round((processed / Math.max(1, validTargetCount)) * 45)
            onProgress?.(pct, `Procesando corte DICOM ${processed} de ${validTargetCount}...`)
            await new Promise((r) => setTimeout(r, 0))
        }
    }

    return { dcmFiles, rawSlices, skippedCount, skippedBytes }
}

/**
 * Analiza un archivo .zip o .rar (incluso cuando un archivo RAR tiene extensión .zip).
 * Si contiene instaladores de PC pesados (GALILEOS, InVivoDental .exe/.inv, manuales .pdf/.docx)
 * o si está en formato WinRAR (.rar), extrae únicamente la serie de cortes tomográficos DICOM (.dcm)
 * y empaqueta un archivo .ZIP estándar limpio y ligero antes de subirlo a MinIO.
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
        }
    }

    try {
        onProgress?.("Inspeccionando estructura del paquete tomográfico...", 5)
        const format = await detectArchiveFormat(file)

        // CASO A: El archivo es internamente un paquete WinRAR (aunque se llame .zip o .rar)
        if (format === "rar") {
            const { rawSlices, skippedCount, skippedBytes } = await extractDicomFilesFromRar(
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
                }
            }

            onProgress?.(`Empaquetando ${rawSlices.length} cortes DICOM limpios en formato ZIP estándar...`, 72)
            const cleanZip = new JSZip()
            for (const s of rawSlices) {
                const baseName = s.name.split("/").pop() || s.name
                cleanZip.file(`DICOM/${baseName}`, s.data)
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
                `[cleanDicomZip] Convertido RAR->ZIP limpio: ${rawSlices.length} cortes DICOM, omitidos ${skippedCount} archivos de instalación (${savedMB.toFixed(1)} MB descartados).`
            )

            return {
                file: cleanFile,
                cleaned: true,
                originalSize: file.size,
                newSize: cleanFile.size,
                savedMB,
                dicomSlicesCount: rawSlices.length,
            }
        }

        // CASO B: El archivo es un paquete ZIP estándar
        if (format === "zip") {
            onProgress?.("Analizando contenido del archivo ZIP...", 8)
            const zip = await JSZip.loadAsync(file)

            const allEntryNames = Object.keys(zip.files)
            const nonDirNames = allEntryNames.filter((name) => !zip.files[name].dir)
            const validDicomNames = nonDirNames.filter((name) => isDicomSliceEntry(name))
            const discardedCount = nonDirNames.length - validDicomNames.length

            // Si ya está limpio (todos los archivos son cortes DICOM y no hay ejecutables/instaladores)
            if (discardedCount === 0 && validDicomNames.length > 0) {
                return {
                    file,
                    cleaned: false,
                    originalSize: file.size,
                    newSize: file.size,
                    savedMB: 0,
                    dicomSlicesCount: validDicomNames.length,
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
                }
            }

            onProgress?.(
                `Descartando ${discardedCount} archivo(s) de instalación y conservando ${validDicomNames.length} cortes DICOM...`,
                18
            )

            const cleanZip = new JSZip()
            let processed = 0
            for (const name of validDicomNames) {
                const entry = zip.files[name]
                const data = await entry.async("uint8array")
                const baseName = name.replace(/\\/g, "/").split("/").pop() || name
                cleanZip.file(`DICOM/${baseName}`, data)
                processed++
                if (processed % 30 === 0 || processed === validDicomNames.length) {
                    const pct = 18 + Math.round((processed / validDicomNames.length) * 32)
                    onProgress?.(`Extrayendo corte DICOM ${processed} de ${validDicomNames.length}...`, pct)
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
            }
        }

        return {
            file,
            cleaned: false,
            originalSize: file.size,
            newSize: file.size,
            savedMB: 0,
            dicomSlicesCount: 0,
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
        }
    }
}
