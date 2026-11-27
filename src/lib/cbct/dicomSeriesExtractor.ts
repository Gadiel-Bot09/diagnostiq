/**
 * Extractor Multi-Serie DICOM y Auditor Metrológico LPS (DICOM PS3.3).
 *
 * Responsabilidades:
 * 1. Inspeccionar TODAS las series cargadas en DWV (`app.getDataIds()`), sin descartar
 *    series secundarias, cortes específicos del radiólogo (`DERIVED/SECONDARY`, `SC`, `PX`, `DX`),
 *    ni volúmenes 3D adicionales (p. ej. Maxilar Superior + Mandíbula o FOV de alta resolución).
 * 2. Auditar con rigor clínico la calibración física (`sx, sy, sz` en mm), detectando:
 *    - `PixelSpacing (0028,0030)` / `ImagerPixelSpacing (0018,1164)`
 *    - Proyección espacial de `ImagePositionPatient (0020,0032)` sobre la normal de `ImageOrientationPatient (0020,0037)`
 *    - `SpacingBetweenSlices (0018,0088)` y `SliceThickness (0018,0050)`
 *    - Continuidad y detección de cortes faltantes (gaps > 15%)
 *    - Orientación anatómica LPS real (`flipX`, `flipY`, `zUp`) para garantizar lateralidad R/L y A/P exacta.
 * 3. Nunca mentir sobre la calibración: clasifica cada volumen en:
 *    - `certified_geometry`: calibrado por coordenadas 3D reales `IPP + PixelSpacing`.
 *    - `certified_header`: calibrado por cabeceras `PixelSpacing + SpacingBetweenSlices/SliceThickness`.
 *    - `estimated_isotropic`: sin calibración Z válida en DICOM (se advierte explícitamente al clínico).
 */

import type { CbctVolume } from "@/lib/cbctReconstruction"

export type CalibrationStatus = "certified_geometry" | "certified_header" | "estimated_isotropic"

export interface CalibrationAudit {
    status: CalibrationStatus
    label: string
    detail: string
    sx: number
    sy: number
    sz: number
    hasGaps: boolean
    gapCount: number
    maxGapMm: number
    pixelSpacingSource: string
    zSpacingSource: string
    orientationName: string
    lpsVerified: boolean
    /** true si el eje X del buffer apunta hacia Derecha (-X LPS) y requiere reflejo horizontal para mostrar R a la izquierda */
    flipX: boolean
    /** true si el eje Y del buffer apunta hacia Anterior (-Y LPS) en vez de Posterior (+Y LPS) */
    flipY: boolean
    /** true si el índice de corte creciente apunta hacia Superior (+Z LPS) */
    zUp: boolean
    manufacturer: string
    patientName: string
    studyDescription: string
    seriesDescription: string
    studyDate: string
    modality: string
    photometricInterpretation: string
    sliceCount: number
    matrixDims: [number, number, number]
    /** Si la serie original fue adquirida en Coronal/Sagital y se permutó automáticamente a Axial LPS */
    reaxisedFrom?: string
}

export interface VolumetricSeries {
    id: string
    label: string
    seriesDescription: string
    modality: string
    volume: CbctVolume
    dicomWindow: { center: number; width: number } | null
    calibration: CalibrationAudit
}

export interface SecondaryDicomSeries {
    id: string
    seriesDescription: string
    modality: string
    imageType: string
    width: number
    height: number
    sx: number
    sy: number
    frameCount: number
    /** Imágenes renderizadas tal cual fueron generadas por el tomógrafo/radiólogo */
    dataUrls: string[]
}

export interface ClinicalSheetAttachment {
    id: string
    name: string
    kind: "pdf" | "image"
    url: string
}

export interface ExtractedStudyBundle {
    volumetricSeries: VolumetricSeries[]
    secondarySeries: SecondaryDicomSeries[]
}

// ---------------------------------------------------------------------------------------------
// Lectura segura de metadatos DICOM desde DWV
// ---------------------------------------------------------------------------------------------

function getMetaTagValue(meta: Record<string, any> | undefined, tagKey: string): any {
    if (!meta) return undefined
    const el = meta[tagKey]
    if (el) {
        return el.value !== undefined ? el.value : el
    }
    return undefined
}

/**
 * Busca una etiqueta DICOM en la raíz o dentro de secuencias Enhanced Multi-Frame:
 * SharedFunctionalGroupsSequence (5200,9229) y PerFrameFunctionalGroupsSequence (5200,9230)
 * (incluyendo PixelMeasuresSequence 0028,9110 y PlaneOrientationSequence 0020,9116).
 */
function findNestedTagValue(
    obj: Record<string, any> | undefined,
    tagKey: string,
    depth = 0
): any {
    if (!obj || typeof obj !== "object" || depth > 4) return undefined
    const direct = getMetaTagValue(obj, tagKey)
    if (direct !== undefined) return direct

    const seqKeys = ["52009229", "52009230", "00289110", "00209116", "00209113"]
    for (const sk of seqKeys) {
        const seqVal = getMetaTagValue(obj, sk)
        if (!seqVal) continue
        const items = Array.isArray(seqVal) ? seqVal : [seqVal]
        for (let i = 0; i < Math.min(items.length, 2); i++) {
            const item = items[i]
            if (item && typeof item === "object") {
                const found = findNestedTagValue(item, tagKey, depth + 1)
                if (found !== undefined) return found
            }
        }
    }
    return undefined
}

function getMetaNumbersDeep(meta: Record<string, any> | undefined, tagKey: string): number[] {
    const val = findNestedTagValue(meta, tagKey)
    if (val === undefined || val === null) return []
    const rawArr = Array.isArray(val) ? val : [val]
    const out: number[] = []
    for (const item of rawArr) {
        if (typeof item === "number" && Number.isFinite(item)) {
            out.push(item)
        } else if (typeof item === "string") {
            for (const part of item.split(/[\\,;\s]+/)) {
                const n = parseFloat(part)
                if (Number.isFinite(n)) out.push(n)
            }
        }
    }
    return out
}

function getMetaFirstNumberDeep(meta: Record<string, any> | undefined, tagKey: string): number | null {
    const nums = getMetaNumbersDeep(meta, tagKey)
    return nums.length > 0 ? nums[0] : null
}

/** Extrae todas las coordenadas ImagePositionPatient de PerFrameFunctionalGroupsSequence (5200,9230) en DICOM Multi-Frame */
function extractPerFramePositions(meta: Record<string, any> | undefined): [number, number, number][] {
    const pfg = getMetaTagValue(meta, "52009230")
    if (!Array.isArray(pfg) || pfg.length < 2) return []
    const pts: [number, number, number][] = []
    for (const frameItem of pfg) {
        const ipp = getMetaNumbersDeep(frameItem, "00200032")
        if (ipp.length >= 3) {
            pts.push([ipp[0], ipp[1], ipp[2]])
        }
    }
    return pts
}

function getMetaString(meta: Record<string, any> | undefined, tagKey: string): string {
    const val = getMetaTagValue(meta, tagKey)
    if (val === undefined || val === null) return ""
    if (Array.isArray(val)) {
        const flat = val
            .map((v) => (v && typeof v === "object" ? Object.values(v).join(" ") : String(v ?? "")))
            .join(" \\ ")
        return flat.replace(/\^+/g, " ").trim()
    }
    if (typeof val === "object") {
        return Object.values(val)
            .map((v) => String(v ?? ""))
            .join(" ")
            .replace(/\^+/g, " ")
            .trim()
    }
    return String(val).replace(/\^+/g, " ").trim()
}

function getMetaNumbers(meta: Record<string, any> | undefined, tagKey: string): number[] {
    const val = getMetaTagValue(meta, tagKey)
    if (val === undefined || val === null) return []
    const rawArr = Array.isArray(val) ? val : [val]
    const out: number[] = []
    for (const item of rawArr) {
        if (typeof item === "number" && Number.isFinite(item)) {
            out.push(item)
        } else if (typeof item === "string") {
            for (const part of item.split(/[\\,;\s]+/)) {
                const n = parseFloat(part)
                if (Number.isFinite(n)) out.push(n)
            }
        }
    }
    return out
}

function getMetaFirstNumber(meta: Record<string, any> | undefined, tagKey: string): number | null {
    const nums = getMetaNumbers(meta, tagKey)
    return nums.length > 0 ? nums[0] : null
}

function sampleQuantilesQuick(raw: ArrayLike<number>, qs: number[], maxSamples = 250000): number[] {
    const n = raw.length
    if (n === 0) return qs.map(() => 0)
    const count = Math.min(n, maxSamples)
    const arr = new Float32Array(count)
    let seed = 1234567
    for (let i = 0; i < count; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        arr[i] = raw[seed % n]
    }
    arr.sort()
    return qs.map((q) => arr[Math.min(count - 1, Math.max(0, Math.floor(q * (count - 1))))])
}

// ---------------------------------------------------------------------------------------------
// Auditoría de Orientación LPS y Calibración Metrológica
// ---------------------------------------------------------------------------------------------

function parseOrientationCosines(
    geom: any,
    meta: Record<string, any> | undefined
): {
    row: [number, number, number]
    col: [number, number, number]
    normal: [number, number, number]
    verified: boolean
    orientationName: string
} {
    // 1. Intentar leer ImageOrientationPatient (0020,0037) desde raíz o secuencias Enhanced Multi-Frame
    const iop = getMetaNumbersDeep(meta, "00200037")
    if (iop.length >= 6) {
        const rLen = Math.hypot(iop[0], iop[1], iop[2])
        const cLen = Math.hypot(iop[3], iop[4], iop[5])
        if (rLen > 0.5 && cLen > 0.5) {
            const row: [number, number, number] = [iop[0] / rLen, iop[1] / rLen, iop[2] / rLen]
            const col: [number, number, number] = [iop[3] / cLen, iop[4] / cLen, iop[5] / cLen]
            const nx = row[1] * col[2] - row[2] * col[1]
            const ny = row[2] * col[0] - row[0] * col[2]
            const nz = row[0] * col[1] - row[1] * col[0]
            const nLen = Math.hypot(nx, ny, nz) || 1
            const normal: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen]
            const ax = Math.abs(normal[0])
            const ay = Math.abs(normal[1])
            const az = Math.abs(normal[2])
            const orientationName =
                az >= ax && az >= ay && az > 0.85
                    ? "Axial"
                    : ay >= ax && ay >= az && ay > 0.85
                    ? "Coronal"
                    : ax >= ay && ax >= az && ax > 0.85
                    ? "Sagital"
                    : "Oblicuo"
            return { row, col, normal, verified: true, orientationName }
        }
    }

    // 2. Intentar leer la matriz 3x3 de Geometry en DWV
    try {
        const ori = typeof geom?.getOrientation === "function" ? geom.getOrientation() : null
        if (ori && typeof ori.get === "function") {
            // Matrix33 en DWV almacena las columnas como ejes [row, col, normal]
            const r: [number, number, number] = [ori.get(0, 0), ori.get(1, 0), ori.get(2, 0)]
            const c: [number, number, number] = [ori.get(0, 1), ori.get(1, 1), ori.get(2, 1)]
            const n: [number, number, number] = [ori.get(0, 2), ori.get(1, 2), ori.get(2, 2)]
            if (Math.hypot(r[0], r[1], r[2]) > 0.5 && Math.hypot(c[0], c[1], c[2]) > 0.5) {
                const az = Math.abs(n[2])
                const ay = Math.abs(n[1])
                const ax = Math.abs(n[0])
                const orientationName =
                    az >= ax && az >= ay && az > 0.85
                        ? "Axial"
                        : ay >= ax && ay >= az && ay > 0.85
                        ? "Coronal"
                        : ax >= ay && ax >= az && ax > 0.85
                        ? "Sagital"
                        : "Oblicuo"
                return { row: r, col: c, normal: n, verified: true, orientationName }
            }
        }
    } catch {}

    // 3. Por defecto axial estándar DICOM LPS
    return {
        row: [1, 0, 0],
        col: [0, 1, 0],
        normal: [0, 0, 1],
        verified: false,
        orientationName: "Axial (estándar)",
    }
}

function analyzeOriginsSpacing(
    geom: any,
    normal: [number, number, number],
    meta?: Record<string, any>
): {
    medianStep: number | null
    hasGaps: boolean
    gapCount: number
    maxGapMm: number
    zUpFromOrigins: boolean | null
    normalSignFromOrigins: 1 | -1
    looksLikeUncalibratedIndex: boolean
} {
    const origins = typeof geom?.getOrigins === "function" ? geom.getOrigins() : null
    const rawPoints: [number, number, number][] = []

    if (origins && origins.length >= 2) {
        for (let i = 0; i < origins.length; i++) {
            const p = origins[i]
            rawPoints.push([
                typeof p.getX === "function" ? p.getX() : 0,
                typeof p.getY === "function" ? p.getY() : 0,
                typeof p.getZ === "function" ? p.getZ() : 0,
            ])
        }
    } else {
        // Fallback para DICOM Enhanced Multi-Frame (PerFrameFunctionalGroupsSequence 5200,9230)
        rawPoints.push(...extractPerFramePositions(meta))
    }

    if (rawPoints.length < 2) {
        return {
            medianStep: null,
            hasGaps: false,
            gapCount: 0,
            maxGapMm: 0,
            zUpFromOrigins: null,
            normalSignFromOrigins: 1,
            looksLikeUncalibratedIndex: false,
        }
    }

    const projs: number[] = []
    let allZeroXY = true
    let allIntegerZ = true
    for (let i = 0; i < rawPoints.length; i++) {
        const [x, y, z] = rawPoints[i]
        if (Math.abs(x) > 1e-4 || Math.abs(y) > 1e-4) allZeroXY = false
        if (Math.abs(z - Math.round(z)) > 1e-4) allIntegerZ = false
        projs.push(x * normal[0] + y * normal[1] + z * normal[2])
    }

    const diffs: number[] = []
    for (let i = 1; i < projs.length; i++) {
        const d = Math.abs(projs[i] - projs[i - 1])
        if (d > 1e-5) diffs.push(d)
    }

    if (diffs.length === 0) {
        return {
            medianStep: null,
            hasGaps: false,
            gapCount: 0,
            maxGapMm: 0,
            zUpFromOrigins: null,
            normalSignFromOrigins: 1,
            looksLikeUncalibratedIndex: true,
        }
    }

    const sortedDiffs = [...diffs].sort((a, b) => a - b)
    const medianStep = sortedDiffs[Math.floor(sortedDiffs.length / 2)]

    let gapCount = 0
    let maxGapMm = medianStep
    for (const d of diffs) {
        if (d > maxGapMm) maxGapMm = d
        if (Math.abs(d - medianStep) > Math.max(medianStep * 0.18, 0.08)) {
            gapCount++
        }
    }

    // Detectar si DWV o el tomógrafo rellenaron IPP con índice secuencial ficticio (0, 0, 0), (0, 0, 1), (0, 0, 2)...
    const looksLikeUncalibratedIndex = allZeroXY && allIntegerZ && Math.abs(medianStep - 1.0) < 1e-4

    // Determinar dirección de progresión de cortes a lo largo de la normal y en +Z LPS
    const firstP = rawPoints[0]
    const lastP = rawPoints[rawPoints.length - 1]
    const deltaProj = projs[projs.length - 1] - projs[0]
    const normalSignFromOrigins: 1 | -1 = deltaProj >= 0 ? 1 : -1
    const zUpFromOrigins = Math.abs(lastP[2] - firstP[2]) > 1e-4 ? lastP[2] > firstP[2] : null

    return {
        medianStep,
        hasGaps: gapCount > 0,
        gapCount,
        maxGapMm,
        zUpFromOrigins,
        normalSignFromOrigins,
        looksLikeUncalibratedIndex,
    }
}

/**
 * Permuta automáticamente un volumen adquirido originalmente en Coronal o Sagital
 * a una matriz Axial LPS canónica (eje 0 = R->L, eje 1 = A->P, eje 2 = I->S).
 */
function reaxisNonAxialToCanonicalAxial(
    raw: ArrayLike<number>,
    dims: [number, number, number],
    spacings: [number, number, number],
    rowDir: [number, number, number],
    colDir: [number, number, number],
    sliceDir: [number, number, number]
): {
    raw: Int16Array | Uint16Array | Float32Array
    nx: number
    ny: number
    nz: number
    sx: number
    sy: number
    sz: number
} | null {
    const axes = [rowDir, colDir, sliceDir]
    const pickAxis = (lpsIdx: 0 | 1 | 2, exclude: Set<number>): { axis: number; sign: 1 | -1 } => {
        let bestAxis = 0
        let bestAbs = -1
        let bestSign: 1 | -1 = 1
        for (let a = 0; a < 3; a++) {
            if (exclude.has(a)) continue
            const v = axes[a][lpsIdx]
            if (Math.abs(v) > bestAbs) {
                bestAbs = Math.abs(v)
                bestAxis = a
                bestSign = v >= 0 ? 1 : -1
            }
        }
        return { axis: bestAxis, sign: bestSign }
    }

    const used = new Set<number>()
    const xMap = pickAxis(0, used) // +X LPS = Izquierda (L)
    used.add(xMap.axis)
    const yMap = pickAxis(1, used) // +Y LPS = Posterior (P)
    used.add(yMap.axis)
    const zMap = pickAxis(2, used) // +Z LPS = Superior (S)

    // Si ya es axial (x=0, y=1, z=2), no hace falta permutar memoria
    if (xMap.axis === 0 && yMap.axis === 1 && zMap.axis === 2) return null

    const newNx = dims[xMap.axis]
    const newNy = dims[yMap.axis]
    const newNz = dims[zMap.axis]
    const total = newNx * newNy * newNz

    // Preservar tipo numérico sin pérdida de precisión
    const out =
        raw instanceof Int16Array
            ? new Int16Array(total)
            : raw instanceof Uint16Array
            ? new Uint16Array(total)
            : new Float32Array(total)

    const [oldNx, oldNy] = dims
    const oldNxy = oldNx * oldNy
    const newNxy = newNx * newNy
    const srcCoord = [0, 0, 0]

    for (let z = 0; z < newNz; z++) {
        srcCoord[zMap.axis] = zMap.sign > 0 ? z : newNz - 1 - z
        const dstZ = z * newNxy
        for (let y = 0; y < newNy; y++) {
            srcCoord[yMap.axis] = yMap.sign > 0 ? y : newNy - 1 - y
            const dstZY = dstZ + y * newNx
            for (let x = 0; x < newNx; x++) {
                srcCoord[xMap.axis] = xMap.sign > 0 ? x : newNx - 1 - x
                const srcIdx = srcCoord[2] * oldNxy + srcCoord[1] * oldNx + srcCoord[0]
                out[dstZY + x] = raw[srcIdx]
            }
        }
    }

    return {
        raw: out,
        nx: newNx,
        ny: newNy,
        nz: newNz,
        sx: spacings[xMap.axis],
        sy: spacings[yMap.axis],
        sz: spacings[zMap.axis],
    }
}

// ---------------------------------------------------------------------------------------------
// Renderizado directo de series 2D / Secondary Captures / Cortes específicos DICOM
// ---------------------------------------------------------------------------------------------

function renderSecondaryFramesToDataUrls(
    image: any,
    meta: Record<string, any> | undefined
): { dataUrls: string[]; width: number; height: number; frameCount: number } {
    if (typeof document === "undefined") {
        return { dataUrls: [], width: 0, height: 0, frameCount: 0 }
    }

    const geom = image.getGeometry()
    const size = geom.getSize()
    const nx = size.get(0)
    const ny = size.get(1)
    const nz = Math.max(1, size.get(2) || 1)
    const nComp = typeof image.getNumberOfComponents === "function" ? image.getNumberOfComponents() : 1
    const raw = image.getBuffer()
    if (!raw || nx < 2 || ny < 2) {
        return { dataUrls: [], width: nx, height: ny, frameCount: 0 }
    }

    const maxFrames = Math.min(nz, 40) // Evitar saturar RAM si una serie secundaria trae decenas de capturas
    const photometric = getMetaString(meta, "00280004").toUpperCase()
    const isMonochrome1 = photometric === "MONOCHROME1"
    const wcMeta = getMetaFirstNumber(meta, "00281050")
    const wwMeta = getMetaFirstNumber(meta, "00281051")

    let slope = 1
    let intercept = 0
    try {
        const rsi = typeof image.getRescaleSlopeAndIntercept === "function" ? image.getRescaleSlopeAndIntercept() : null
        if (rsi) {
            const s = rsi.getSlope?.()
            const ic = rsi.getIntercept?.()
            if (typeof s === "number" && Number.isFinite(s) && s !== 0) slope = s
            if (typeof ic === "number" && Number.isFinite(ic)) intercept = ic
        }
    } catch {}

    const canvas = document.createElement("canvas")
    canvas.width = nx
    canvas.height = ny
    const ctx = canvas.getContext("2d")
    if (!ctx) return { dataUrls: [], width: nx, height: ny, frameCount: 0 }

    const dataUrls: string[] = []
    const frameStride = nx * ny * nComp

    for (let f = 0; f < maxFrames; f++) {
        const offset = f * frameStride
        if (offset + frameStride > raw.length) break

        const imgData = ctx.createImageData(nx, ny)
        const out = imgData.data

        if (nComp >= 3) {
            for (let i = 0; i < nx * ny; i++) {
                const src = offset + i * nComp
                const dst = i * 4
                out[dst] = raw[src]
                out[dst + 1] = raw[src + 1]
                out[dst + 2] = raw[src + 2]
                out[dst + 3] = 255
            }
        } else {
            // Escala de grises 1 componente
            let wlMin: number
            let wlWidth: number
            if (wcMeta !== null && wwMeta !== null && wwMeta > 1) {
                wlWidth = wwMeta
                wlMin = wcMeta - wwMeta * 0.5
            } else {
                // Calcular percentiles del frame
                const nPix = nx * ny
                const sampleStep = Math.max(1, Math.floor(nPix / 40000))
                const samples: number[] = []
                for (let i = 0; i < nPix; i += sampleStep) {
                    samples.push(raw[offset + i] * slope + intercept)
                }
                samples.sort((a, b) => a - b)
                const lo = samples[Math.floor(samples.length * 0.02)] ?? 0
                const hi = samples[Math.floor(samples.length * 0.995)] ?? lo + 1
                wlMin = lo
                wlWidth = Math.max(1, hi - lo)
            }
            const inv = 255 / wlWidth
            for (let i = 0; i < nx * ny; i++) {
                const modVal = raw[offset + i] * slope + intercept
                let g = (modVal - wlMin) * inv
                if (g < 0) g = 0
                else if (g > 255) g = 255
                if (isMonochrome1) g = 255 - g
                const dst = i * 4
                out[dst] = g
                out[dst + 1] = g
                out[dst + 2] = g
                out[dst + 3] = 255
            }
        }

        ctx.putImageData(imgData, 0, 0)
        dataUrls.push(canvas.toDataURL("image/png"))
    }

    return { dataUrls, width: nx, height: ny, frameCount: dataUrls.length }
}

// ---------------------------------------------------------------------------------------------
// Extracción Principal Multi-Serie
// ---------------------------------------------------------------------------------------------

export function extractAllStudySeries(app: any): ExtractedStudyBundle {
    const volumetricSeries: VolumetricSeries[] = []
    const secondarySeries: SecondaryDicomSeries[] = []

    if (!app) return { volumetricSeries, secondarySeries }

    let dataIds: string[] = []
    try {
        dataIds = typeof app.getDataIds === "function" ? app.getDataIds() : []
    } catch {
        dataIds = []
    }
    if (dataIds.length === 0 && typeof app.getImage === "function") {
        dataIds = ["0"]
    }

    for (const id of dataIds) {
        try {
            const image = app.getImage(id)
            if (!image) continue
            const meta = typeof app.getMetaData === "function" ? app.getMetaData(id) : undefined
            const geom = image.getGeometry()
            const size = geom.getSize()
            const nx = size.get(0)
            const ny = size.get(1)
            const nz = size.get(2) || 1
            const nComp = typeof image.getNumberOfComponents === "function" ? image.getNumberOfComponents() : 1
            const raw = image.getBuffer()
            if (!raw || nx < 2 || ny < 2) continue

            const modality = (getMetaString(meta, "00080060") || "CT").toUpperCase()
            const imageType = getMetaString(meta, "00080008").toUpperCase()
            const seriesDescription =
                getMetaString(meta, "0008103E") ||
                getMetaString(meta, "00081030") ||
                (nz >= 16 ? `Volumen CBCT (${nx}×${ny}×${nz})` : `Serie ${modality} (${nz} img)`)
            const studyDescription = getMetaString(meta, "00081030")
            const manufacturer = getMetaString(meta, "00080070") || "No declarado"
            const patientName = getMetaString(meta, "00100010")
            const studyDate = getMetaString(meta, "00080020")
            const photometricInterpretation = getMetaString(meta, "00280004") || "MONOCHROME2"

            // Leer PixelSpacing (0028,0030) desde raíz o Enhanced Multi-Frame (PixelMeasuresSequence 0028,9110)
            const spGeom = geom.getSpacing()
            const psTag = getMetaNumbersDeep(meta, "00280030")
            const ipsTag = getMetaNumbersDeep(meta, "00181164")

            let sx = spGeom.get(0) || 0
            let sy = spGeom.get(1) || 0
            let pixelSpacingSource = "Geometría DWV"

            if (psTag.length >= 2 && psTag[0] > 0 && psTag[1] > 0) {
                sy = psTag[0]
                sx = psTag[1]
                pixelSpacingSource =
                    getMetaNumbers(meta, "00280030").length >= 2
                        ? "PixelSpacing (0028,0030)"
                        : "Enhanced Multi-Frame PixelMeasures (0028,9110)"
            } else if (ipsTag.length >= 2 && ipsTag[0] > 0 && ipsTag[1] > 0) {
                sy = ipsTag[0]
                sx = ipsTag[1]
                pixelSpacingSource = "ImagerPixelSpacing (0018,1164)"
            } else if (sx > 0 && sy > 0) {
                pixelSpacingSource = "PixelSpacing (DWV)"
            } else {
                sx = 0.25
                sy = 0.25
                pixelSpacingSource = "Sin etiqueta (0.25 mm est.)"
            }

            // ¿Es una serie secundaria / capturas específicas del radiólogo, o un volumen CBCT 3D?
            const isExplicitSecondary =
                nComp !== 1 ||
                modality === "SC" ||
                modality === "OT" ||
                modality === "PX" ||
                modality === "DX" ||
                modality === "CR" ||
                modality === "IO" ||
                (imageType.includes("SECONDARY") && nz < 40) ||
                nz < 16

            if (isExplicitSecondary) {
                const rendered = renderSecondaryFramesToDataUrls(image, meta)
                if (rendered.dataUrls.length > 0) {
                    secondarySeries.push({
                        id: String(id),
                        seriesDescription,
                        modality,
                        imageType: imageType || "SECONDARY",
                        width: rendered.width,
                        height: rendered.height,
                        sx,
                        sy,
                        frameCount: rendered.frameCount,
                        dataUrls: rendered.dataUrls,
                    })
                }
                continue
            }

            // Serie Volumétrica 3D CBCT (monocroma, nz >= 16)
            const ori = parseOrientationCosines(geom, meta)
            const originsInfo = analyzeOriginsSpacing(geom, ori.normal, meta)
            const sbsTag = getMetaFirstNumberDeep(meta, "00180088") // SpacingBetweenSlices (raíz o Multi-Frame)
            const stTag = getMetaFirstNumberDeep(meta, "00180050") // SliceThickness (raíz o Multi-Frame)
            const geomSz = spGeom.get(2) || 0

            // Determinar sz con jerarquía metrológica estricta (sin heurísticas silenciosas)
            let sz: number
            let calibrationStatus: CalibrationStatus
            let zSpacingSource: string

            if (
                originsInfo.medianStep !== null &&
                originsInfo.medianStep > 0.04 &&
                !originsInfo.looksLikeUncalibratedIndex
            ) {
                sz = originsInfo.medianStep
                calibrationStatus = "certified_geometry"
                zSpacingSource = "ImagePositionPatient (0020,0032)"
            } else if (sbsTag !== null && sbsTag > 0.04 && sbsTag < 5.0) {
                sz = sbsTag
                calibrationStatus = "certified_header"
                zSpacingSource = "SpacingBetweenSlices (0018,0088)"
            } else if (stTag !== null && stTag > 0.04 && stTag < 5.0) {
                sz = stTag
                calibrationStatus = "certified_header"
                zSpacingSource = "SliceThickness (0018,0050)"
            } else if (geomSz > 0.04 && Math.abs(geomSz - 1.0) > 1e-3 && geomSz < 5.0) {
                sz = geomSz
                calibrationStatus = "certified_header"
                zSpacingSource = "Espaciado Z DICOM"
            } else {
                // Sin calibración Z física válida en el archivo DICOM (ej. IPP = 0,1,2... sin SliceThickness)
                sz = sx
                calibrationStatus = "estimated_isotropic"
                zSpacingSource = "Isotrópico inferido (sz = sx; sin Z en DICOM)"
            }

            if (pixelSpacingSource.startsWith("Sin etiqueta")) {
                calibrationStatus = "estimated_isotropic"
            }

            // Si la serie fue adquirida originalmente en Coronal o Sagital, permutar automáticamente a Axial LPS canónico
            let finalRaw: ArrayLike<number> = raw
            let finalNx = nx
            let finalNy = ny
            let finalNz = nz
            let finalSx = sx
            let finalSy = sy
            let finalSz = sz
            let flipX = ori.verified ? ori.row[0] < -0.5 : false
            let flipY = ori.verified ? ori.col[1] < -0.5 : false
            let zUp =
                originsInfo.zUpFromOrigins !== null
                    ? originsInfo.zUpFromOrigins
                    : ori.verified
                    ? ori.normal[2] >= 0
                    : true
            let reaxisedFrom: string | undefined

            if (ori.verified && (ori.orientationName === "Coronal" || ori.orientationName === "Sagital")) {
                const sliceDir: [number, number, number] = [
                    ori.normal[0] * originsInfo.normalSignFromOrigins,
                    ori.normal[1] * originsInfo.normalSignFromOrigins,
                    ori.normal[2] * originsInfo.normalSignFromOrigins,
                ]
                const permuted = reaxisNonAxialToCanonicalAxial(
                    raw,
                    [nx, ny, nz],
                    [sx, sy, sz],
                    ori.row,
                    ori.col,
                    sliceDir
                )
                if (permuted) {
                    finalRaw = permuted.raw
                    finalNx = permuted.nx
                    finalNy = permuted.ny
                    finalNz = permuted.nz
                    finalSx = permuted.sx
                    finalSy = permuted.sy
                    finalSz = permuted.sz
                    flipX = false
                    flipY = false
                    zUp = true
                    reaxisedFrom = ori.orientationName
                }
            }

            let slope = 1
            let intercept = 0
            try {
                const rsi =
                    typeof image.getRescaleSlopeAndIntercept === "function"
                        ? image.getRescaleSlopeAndIntercept()
                        : null
                if (rsi) {
                    const s = typeof rsi.getSlope === "function" ? rsi.getSlope() : 1
                    const ic = typeof rsi.getIntercept === "function" ? rsi.getIntercept() : 0
                    if (typeof s === "number" && Number.isFinite(s) && s !== 0) slope = s
                    if (typeof ic === "number" && Number.isFinite(ic)) intercept = ic
                }
            } catch {}

            const wcMeta = getMetaFirstNumberDeep(meta, "00281050")
            const wwMeta = getMetaFirstNumberDeep(meta, "00281051")
            const dicomWindow =
                wcMeta !== null && wwMeta !== null && wwMeta > 1 ? { center: wcMeta, width: wwMeta } : null

            const [pAir, pLow, pHigh] = sampleQuantilesQuick(finalRaw, [0.01, 0.32, 0.9995])

            const volume: CbctVolume = {
                raw: finalRaw,
                nx: finalNx,
                ny: finalNy,
                nz: finalNz,
                sx: finalSx,
                sy: finalSy,
                sz: finalSz,
                zUp,
                pAir,
                pLow,
                pHigh: Math.max(pHigh, pLow + 1),
                slope,
                intercept,
            }

            const calibrationLabel =
                calibrationStatus === "certified_geometry"
                    ? `Calibrado DICOM (${finalSx.toFixed(2)}×${finalSy.toFixed(2)}×${finalSz.toFixed(2)} mm)`
                    : calibrationStatus === "certified_header"
                    ? `Calibrado Cabecera (${finalSx.toFixed(2)}×${finalSy.toFixed(2)}×${finalSz.toFixed(2)} mm)`
                    : `Calibración Z Estimada (${finalSx.toFixed(2)}×${finalSy.toFixed(2)}×${finalSz.toFixed(2)} mm)`

            const calibrationDetail =
                calibrationStatus === "certified_geometry"
                    ? "Dimensiones verificadas directamente desde PixelSpacing y coordenadas 3D ImagePositionPatient."
                    : calibrationStatus === "certified_header"
                    ? `Dimensiones verificadas desde ${pixelSpacingSource} y ${zSpacingSource}.`
                    : "El archivo DICOM no incluye coordenadas Z físicas válidas ni grosor de corte; se asumió vóxel isotrópico (sz = sx). Verifique las medidas verticales con precaución."

            volumetricSeries.push({
                id: String(id),
                label: `${seriesDescription} (${finalNx}×${finalNy}×${finalNz})`,
                seriesDescription,
                modality,
                volume,
                dicomWindow,
                calibration: {
                    status: calibrationStatus,
                    label: calibrationLabel,
                    detail: calibrationDetail,
                    sx: finalSx,
                    sy: finalSy,
                    sz: finalSz,
                    hasGaps: originsInfo.hasGaps,
                    gapCount: originsInfo.gapCount,
                    maxGapMm: originsInfo.maxGapMm,
                    pixelSpacingSource,
                    zSpacingSource,
                    orientationName: reaxisedFrom ? `${reaxisedFrom} → Axial LPS` : ori.orientationName,
                    lpsVerified: ori.verified,
                    flipX,
                    flipY,
                    zUp,
                    manufacturer,
                    patientName,
                    studyDescription,
                    seriesDescription,
                    studyDate,
                    modality,
                    photometricInterpretation,
                    sliceCount: finalNz,
                    matrixDims: [finalNx, finalNy, finalNz],
                    reaxisedFrom,
                },
            })
        } catch (err) {
            console.warn(`[extractAllStudySeries] Error analizando serie ${id}:`, err)
        }
    }

    // Ordenar volúmenes 3D de mayor a menor número de vóxeles (el volumen CBCT principal primero)
    volumetricSeries.sort(
        (a, b) =>
            b.volume.nx * b.volume.ny * b.volume.nz - a.volume.nx * a.volume.ny * a.volume.nz
    )

    return { volumetricSeries, secondarySeries }
}
