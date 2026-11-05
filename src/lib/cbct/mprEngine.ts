/**
 * Motor MPR clínico para CBCT dental (100% navegador, sin dependencias).
 *
 * Principios de diseño (fidelidad diagnóstica):
 *  - Todas las vistas se remuestrean desde los vóxeles DICOM ORIGINALES con interpolación trilineal.
 *  - Todas las imágenes generadas son ISOTRÓPICAS (mismo tamaño de píxel en mm en ambos ejes), por lo que
 *    una distancia en píxeles multiplicada por `spacing` es una distancia física real en milímetros.
 *  - No se aplican filtros de realce ni deformaciones de aspecto.
 *  - Los cortes Tangencial y Transversal se definen respecto a la curva del arco dental (como GALILEOS / Sidexis):
 *      · Transversal: plano vertical PERPENDICULAR al arco en la posición `s` (buco-lingual).
 *      · Tangencial: plano vertical TANGENTE al arco en la posición `tanC`, desplazado `d` mm en dirección vestibular.
 *      · Panorámica: reformateo curvo (CPR) a lo largo del arco con grosor de capa configurable.
 *
 * Sistema de coordenadas "mundo" (mm): x = columna * sx, y = fila * sy, z = índice de corte * sz.
 * La "altura" h (mm) se mide desde el corte más inferior hacia superior, independientemente del orden de los cortes.
 */

export type Vec3 = [number, number, number]

export interface BaseVolumeInput {
    raw: ArrayLike<number>
    nx: number
    ny: number
    nz: number
    sx: number
    sy: number
    sz: number
    /** true si al aumentar el índice de corte se avanza hacia superior (craneal) */
    zUp: boolean
}

export interface WindowLevel {
    center: number
    width: number
}

export type Quantile = (p: number) => number

export interface ClinicalVolume extends BaseVolumeInput {
    isx: number
    isy: number
    isz: number
    slope: number
    intercept: number
    /** Extensión física (mm) entre centros de vóxeles extremos */
    widthMm: number
    depthMm: number
    heightMm: number
    /** Tamaño de píxel isotrópico usado en las reconstrucciones (mm) */
    iso: number
    /** Percentiles en unidades de modalidad (valor * slope + intercept) */
    quantile: Quantile
    dicomWindow: WindowLevel | null
}

export interface PlaneSpec {
    /** Posición mundo (mm) del centro del píxel (0,0) */
    origin: Vec3
    /** Dirección unitaria de las columnas (derecha en pantalla) */
    u: Vec3
    /** Dirección unitaria de las filas (abajo en pantalla) */
    v: Vec3
    cols: number
    rows: number
    spacing: number
    slabMm?: number
    slabMode?: "mean" | "mip"
}

export interface ViewImage {
    data: Float32Array
    cols: number
    rows: number
    spacing: number
}

export interface ArchPoint {
    x: number
    y: number
}

export interface ArchModel {
    ctrl: ArchPoint[]
    xs: Float64Array
    ys: Float64Array
    cum: Float64Array
    length: number
    /** Signo para que la normal apunte hacia vestibular (labial/bucal) */
    nSign: number
}

export interface ArchFrame {
    x: number
    y: number
    tx: number
    ty: number
    /** Normal unitaria hacia vestibular (labial / bucal) */
    nx: number
    ny: number
}

export interface PanoramaImage extends ViewImage {
    hTop: number
    length: number
    thicknessMm: number
    mode: "mean" | "mip"
}

// ---------------------------------------------------------------------------------------------
// Volumen
// ---------------------------------------------------------------------------------------------

function makeQuantileFromSamples(samples: Float32Array, slope: number, intercept: number): Quantile {
    const n = samples.length
    return (p: number) => {
        if (n === 0) return intercept
        const i = Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))
        return samples[i] * slope + intercept
    }
}

export function createClinicalVolume(
    base: BaseVolumeInput,
    rescale: { slope: number; intercept: number } = { slope: 1, intercept: 0 },
    dicomWindow: WindowLevel | null = null
): ClinicalVolume {
    const { raw, nx, ny, nz } = base
    let sx = base.sx > 0 && Number.isFinite(base.sx) ? base.sx : 0.25
    let sy = base.sy > 0 && Number.isFinite(base.sy) ? base.sy : sx
    let sz = base.sz > 0 && Number.isFinite(base.sz) ? base.sz : sx

    // Garantizar isotropía real en CBCT dental cuando el metadato Z venga sin calibrar (ej. sz = 1.0 frente a sx = 0.20)
    if (nz >= 20 && Math.abs(sx - sy) <= sx * 0.15) {
        if (sz > sx * 1.45 || sz < sx * 0.55) {
            sz = sx
        }
    }

    // Muestrear únicamente dentro del cilindro FOV inscrito (excluyendo el relleno/padding de las 4 esquinas)
    const nxy = nx * ny
    const cx = (nx - 1) * 0.5
    const cy = (ny - 1) * 0.5
    const rMax2 = Math.pow(Math.min(nx, ny) * 0.44, 2)
    const targetCount = Math.min(nx * ny * nz, 360000)
    const tmp = new Float32Array(targetCount)
    let validCount = 0
    let seed = 987654321
    const maxAttempts = targetCount * 2
    for (let i = 0; i < maxAttempts && validCount < targetCount; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const z = seed % nz
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const y = seed % ny
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const x = seed % nx
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > rMax2) continue
        const v = raw[z * nxy + y * nx + x]
        if (v === v) {
            tmp[validCount++] = v
        }
    }
    const samples = validCount > 100 ? tmp.subarray(0, validCount) : tmp
    samples.sort()
    const slope = Number.isFinite(rescale.slope) && rescale.slope !== 0 ? rescale.slope : 1
    const intercept = Number.isFinite(rescale.intercept) ? rescale.intercept : 0

    return {
        ...base,
        sx,
        sy,
        sz,
        isx: 1 / sx,
        isy: 1 / sy,
        isz: 1 / sz,
        slope,
        intercept,
        widthMm: (nx - 1) * sx,
        depthMm: (ny - 1) * sy,
        heightMm: (nz - 1) * sz,
        iso: Math.max(0.08, Math.min(sx, sy, sz)),
        quantile: makeQuantileFromSamples(samples, slope, intercept),
        dicomWindow: dicomWindow && dicomWindow.width > 0 ? dicomWindow : null,
    }
}

/** Coordenada z mundo a partir de la altura h (mm desde el corte más inferior) */
export function zFromH(vol: ClinicalVolume, h: number): number {
    return vol.zUp ? h : vol.heightMm - h
}

/** Altura h (mm desde el corte más inferior) a partir de la coordenada z mundo */
export function hFromZ(vol: ClinicalVolume, z: number): number {
    return vol.zUp ? z : vol.heightMm - z
}

/** Índice de corte DICOM (0-based, orden del buffer) para una altura h */
export function sliceIndexFromH(vol: ClinicalVolume, h: number): number {
    return Math.max(0, Math.min(vol.nz - 1, Math.round(zFromH(vol, h) * vol.isz)))
}

/** Interpolación trilineal en coordenadas mundo (mm). Devuelve NaN fuera del volumen. */
export function sampleRaw(vol: ClinicalVolume, x: number, y: number, z: number): number {
    const fx = x * vol.isx
    const fy = y * vol.isy
    const fz = z * vol.isz
    const nx = vol.nx
    const ny = vol.ny
    const nz = vol.nz
    if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx <= nx - 1 && fy <= ny - 1 && fz <= nz - 1)) return NaN
    let x0 = fx | 0
    let y0 = fy | 0
    let z0 = fz | 0
    if (x0 >= nx - 1) x0 = nx - 2
    if (y0 >= ny - 1) y0 = ny - 2
    if (z0 >= nz - 1) z0 = nz - 2
    const ax = fx - x0
    const ay = fy - y0
    const az = fz - z0
    const nxy = nx * ny
    const raw = vol.raw
    const i0 = z0 * nxy + y0 * nx + x0
    const i1 = i0 + nxy
    const a = raw[i0]
    const b = raw[i0 + nx]
    const c = raw[i1]
    const d = raw[i1 + nx]
    const c00 = a + (raw[i0 + 1] - a) * ax
    const c10 = b + (raw[i0 + nx + 1] - b) * ax
    const c01 = c + (raw[i1 + 1] - c) * ax
    const c11 = d + (raw[i1 + nx + 1] - d) * ax
    const c0 = c00 + (c10 - c00) * ay
    const c1 = c01 + (c11 - c01) * ay
    return c0 + (c1 - c0) * az
}

// ---------------------------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------------------------

function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
}

export function planeToWorld(spec: PlaneSpec, c: number, r: number): Vec3 {
    const sp = spec.spacing
    return [
        spec.origin[0] + spec.u[0] * c * sp + spec.v[0] * r * sp,
        spec.origin[1] + spec.u[1] * c * sp + spec.v[1] * r * sp,
        spec.origin[2] + spec.u[2] * c * sp + spec.v[2] * r * sp,
    ]
}

export function worldToPlane(spec: PlaneSpec, p: Vec3): [number, number] {
    const dx = p[0] - spec.origin[0]
    const dy = p[1] - spec.origin[1]
    const dz = p[2] - spec.origin[2]
    return [
        (dx * spec.u[0] + dy * spec.u[1] + dz * spec.u[2]) / spec.spacing,
        (dx * spec.v[0] + dy * spec.v[1] + dz * spec.v[2]) / spec.spacing,
    ]
}

/** Remuestreo de un plano arbitrario (con grosor opcional) desde los vóxeles originales */
export function renderPlane(vol: ClinicalVolume, spec: PlaneSpec): ViewImage {
    const { origin, u, v, cols, rows, spacing } = spec
    const out = new Float32Array(cols * rows)
    const slab = spec.slabMm && spec.slabMm > vol.iso * 0.75 ? spec.slabMm : 0
    const mip = spec.slabMode === "mip"
    let offsets: number[] = [0]
    let N: Vec3 = [0, 0, 0]
    if (slab > 0) {
        const m = Math.max(2, Math.min(64, Math.round(slab / (vol.iso * 0.75))))
        offsets = Array.from({ length: m }, (_, k) => -slab / 2 + (slab * (k + 0.5)) / m)
        N = normalize(cross(u, v))
    }
    const ux = u[0] * spacing
    const uy = u[1] * spacing
    const uz = u[2] * spacing
    const vx = v[0] * spacing
    const vy = v[1] * spacing
    const vz = v[2] * spacing

    for (let r = 0; r < rows; r++) {
        const bx = origin[0] + vx * r
        const by = origin[1] + vy * r
        const bz = origin[2] + vz * r
        const row = r * cols
        for (let c = 0; c < cols; c++) {
            const px = bx + ux * c
            const py = by + uy * c
            const pz = bz + uz * c
            if (offsets.length === 1) {
                out[row + c] = sampleRaw(vol, px, py, pz)
            } else {
                let acc = 0
                let cnt = 0
                let mx = -Infinity
                for (let k = 0; k < offsets.length; k++) {
                    const o = offsets[k]
                    const val = sampleRaw(vol, px + N[0] * o, py + N[1] * o, pz + N[2] * o)
                    if (val === val) {
                        acc += val
                        cnt++
                        if (val > mx) mx = val
                    }
                }
                out[row + c] = cnt ? (mip ? mx : acc / cnt) : NaN
            }
        }
    }
    return { data: out, cols, rows, spacing }
}

/** Corte axial (horizontal) a la altura h. Anterior arriba, derecha del paciente a la izquierda (DICOM estándar). */
export function axialPlane(vol: ClinicalVolume, h: number, slabMm = 0.8): PlaneSpec {
    const sp = Math.max(0.08, Math.min(vol.sx, vol.sy))
    return {
        origin: [0, 0, zFromH(vol, h)],
        u: [1, 0, 0],
        v: [0, 1, 0],
        cols: Math.floor(vol.widthMm / sp) + 1,
        rows: Math.floor(vol.depthMm / sp) + 1,
        spacing: sp,
        slabMm,
        slabMode: "mean",
    }
}

function upVector(vol: ClinicalVolume): Vec3 {
    return [0, 0, vol.zUp ? 1 : -1]
}

/** Sección transversal (buco-lingual): oral a la izquierda, vestibular (labial/bucal) a la derecha, enmarcada en [winHBottom, winHTop] */
export function crossPlane(
    vol: ClinicalVolume,
    arch: ArchModel,
    s: number,
    halfWidthMm: number,
    slabMm = 1.5,
    winHBottom = 0,
    winHTop = vol.heightMm
): PlaneSpec {
    const f = archFrame(arch, s)
    const sp = vol.iso
    const hBot = Math.max(0, Math.min(vol.heightMm, winHBottom))
    const hTop = Math.max(hBot + sp * 4, Math.min(vol.heightMm, winHTop))
    const cols = Math.floor((2 * halfWidthMm) / sp) + 1
    const rows = Math.floor((hTop - hBot) / sp) + 1
    const zTop = zFromH(vol, hTop)
    return {
        origin: [f.x - f.nx * halfWidthMm, f.y - f.ny * halfWidthMm, zTop],
        u: [f.nx, f.ny, 0],
        v: [-upVector(vol)[0], -upVector(vol)[1], -upVector(vol)[2]],
        cols,
        rows,
        spacing: sp,
        slabMm,
        slabMode: "mean",
    }
}

/** Corte tangencial plano: tangente al arco en tanC, desplazado d mm hacia vestibular, enmarcado en [winHBottom, winHTop] */
export function tangentialPlane(
    vol: ClinicalVolume,
    arch: ArchModel,
    tanC: number,
    d: number,
    halfWidthMm: number,
    slabMm = 2.0,
    winHBottom = 0,
    winHTop = vol.heightMm
): PlaneSpec {
    const f = archFrame(arch, tanC)
    const sp = vol.iso
    const hBot = Math.max(0, Math.min(vol.heightMm, winHBottom))
    const hTop = Math.max(hBot + sp * 4, Math.min(vol.heightMm, winHTop))
    const cols = Math.floor((2 * halfWidthMm) / sp) + 1
    const rows = Math.floor((hTop - hBot) / sp) + 1
    const cx = f.x + f.nx * d
    const cy = f.y + f.ny * d
    const zTop = zFromH(vol, hTop)
    const up = upVector(vol)
    return {
        origin: [cx - f.tx * halfWidthMm, cy - f.ty * halfWidthMm, zTop],
        u: [f.tx, f.ty, 0],
        v: [-up[0], -up[1], -up[2]],
        cols,
        rows,
        spacing: sp,
        slabMm,
        slabMode: "mean",
    }
}

/**
 * Corte tangencial anatómico curvo (estilo Sirona GALILEOS "Ventana de cortes"):
 * Recorre s en [tanC - halfWidthMm, tanC + halfWidthMm] siguiendo la curvatura local del arco dental
 * a un desplazamiento normal d (mm) con integración de grosor (slabMm), garantizando que las 3-4 piezas
 * dentales adyacentes se mantengan simultáneamente en foco dentro de la ventana vertical [winHBottom, winHTop].
 */
export function renderTangentialSection(
    vol: ClinicalVolume,
    arch: ArchModel,
    tanC: number,
    d: number,
    halfWidthMm: number,
    slabMm = 2.0,
    winHBottom = 0,
    winHTop = vol.heightMm
): ViewImage {
    const sp = vol.iso
    const hBot = Math.max(0, Math.min(vol.heightMm, winHBottom))
    const hTop = Math.max(hBot + sp * 4, Math.min(vol.heightMm, winHTop))
    const cols = Math.max(2, Math.floor((2 * halfWidthMm) / sp) + 1)
    const rows = Math.max(2, Math.floor((hTop - hBot) / sp) + 1)
    const slab = Math.max(0, slabMm)
    const m = slab < sp * 0.75 ? 1 : Math.max(2, Math.min(24, Math.round(slab / (sp * 0.75))))

    const pxArr = new Float32Array(cols * m)
    const pyArr = new Float32Array(cols * m)
    for (let c = 0; c < cols; c++) {
        const s = tanC - halfWidthMm + c * sp
        const f = archFrame(arch, s)
        for (let k = 0; k < m; k++) {
            const off = m === 1 ? d : d - slab * 0.5 + (slab * (k + 0.5)) / m
            const idx = c * m + k
            pxArr[idx] = f.x + f.nx * off
            pyArr[idx] = f.y + f.ny * off
        }
    }

    const out = new Float32Array(cols * rows)
    for (let r = 0; r < rows; r++) {
        const z = zFromH(vol, hTop - r * sp)
        const rowOff = r * cols
        for (let c = 0; c < cols; c++) {
            const baseIdx = c * m
            if (m === 1) {
                out[rowOff + c] = sampleRaw(vol, pxArr[baseIdx], pyArr[baseIdx], z)
            } else {
                let acc = 0
                let cnt = 0
                for (let k = 0; k < m; k++) {
                    const val = sampleRaw(vol, pxArr[baseIdx + k], pyArr[baseIdx + k], z)
                    if (val === val) {
                        acc += val
                        cnt++
                    }
                }
                out[rowOff + c] = cnt ? acc / cnt : NaN
            }
        }
    }

    return { data: out, cols, rows, spacing: sp }
}

// ---------------------------------------------------------------------------------------------
// Arco dental (spline Catmull-Rom editable)
// ---------------------------------------------------------------------------------------------

export function buildArch(ctrlIn: ArchPoint[]): ArchModel {
    const ctrl = ctrlIn.map((p) => ({ x: p.x, y: p.y }))
    const n = ctrl.length
    const xs: number[] = []
    const ys: number[] = []
    const STEPS = 48
    const get = (i: number): ArchPoint => {
        if (i < 0) {
            const a = ctrl[0]
            const b = ctrl[1]
            return { x: 2 * a.x - b.x, y: 2 * a.y - b.y }
        }
        if (i > n - 1) {
            const a = ctrl[n - 1]
            const b = ctrl[n - 2]
            return { x: 2 * a.x - b.x, y: 2 * a.y - b.y }
        }
        return ctrl[i]
    }
    for (let i = 0; i < n - 1; i++) {
        const p0 = get(i - 1)
        const p1 = get(i)
        const p2 = get(i + 1)
        const p3 = get(i + 2)
        for (let j = 0; j < STEPS; j++) {
            const t = j / STEPS
            const t2 = t * t
            const t3 = t2 * t
            xs.push(
                0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
            )
            ys.push(
                0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
            )
        }
    }
    xs.push(ctrl[n - 1].x)
    ys.push(ctrl[n - 1].y)

    const X = Float64Array.from(xs)
    const Y = Float64Array.from(ys)
    const cum = new Float64Array(X.length)
    for (let i = 1; i < X.length; i++) cum[i] = cum[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1])

    const model: ArchModel = { ctrl, xs: X, ys: Y, cum, length: cum[cum.length - 1], nSign: 1 }

    // Orientación de la normal: debe apuntar hacia fuera de la concavidad del arco (vestibular)
    const mid = archFrame(model, model.length / 2)
    const refX = (ctrl[0].x + ctrl[n - 1].x) / 2
    const refY = (ctrl[0].y + ctrl[n - 1].y) / 2
    const dot = mid.nx * (mid.x - refX) + mid.ny * (mid.y - refY)
    if (Math.hypot(mid.x - refX, mid.y - refY) > 2) {
        model.nSign = dot >= 0 ? 1 : -1
    } else {
        // Arco casi recto: se asume anterior hacia filas menores (convención DICOM)
        model.nSign = mid.ny <= 0 ? 1 : -1
    }
    return model
}

function positionAt(arch: ArchModel, s: number): [number, number] {
    const { xs, ys, cum } = arch
    const n = cum.length
    if (s <= 0) return [xs[0], ys[0]]
    if (s >= arch.length) return [xs[n - 1], ys[n - 1]]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1
        if (cum[m] <= s) lo = m
        else hi = m
    }
    const seg = cum[hi] - cum[lo] || 1
    const t = (s - cum[lo]) / seg
    return [xs[lo] + (xs[hi] - xs[lo]) * t, ys[lo] + (ys[hi] - ys[lo]) * t]
}

/** Punto, tangente y normal vestibular del arco a la distancia s (mm). Se extrapola linealmente fuera de [0, L]. */
export function archFrame(arch: ArchModel, s: number): ArchFrame {
    const L = arch.length
    const sc = Math.max(0, Math.min(L, s))
    const h = Math.min(0.75, L / 4)
    const a = positionAt(arch, Math.max(0, sc - h))
    const b = positionAt(arch, Math.min(L, sc + h))
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const p = positionAt(arch, sc)
    const extra = s - sc
    const sign = arch.nSign
    return {
        x: p[0] + tx * extra,
        y: p[1] + ty * extra,
        tx,
        ty,
        nx: -ty * sign,
        ny: tx * sign,
    }
}

/** Proyección de un punto axial (mm) sobre el arco: posición s y desplazamiento vestibular d */
export function projectToArch(arch: ArchModel, x: number, y: number): { s: number; d: number } {
    const { xs, ys, cum } = arch
    let best = Infinity
    let bestS = 0
    for (let i = 0; i < xs.length - 1; i++) {
        const ax = xs[i]
        const ay = ys[i]
        const bx = xs[i + 1]
        const by = ys[i + 1]
        const dx = bx - ax
        const dy = by - ay
        const l2 = dx * dx + dy * dy || 1e-9
        let t = ((x - ax) * dx + (y - ay) * dy) / l2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const px = ax + dx * t
        const py = ay + dy * t
        const dist = (x - px) * (x - px) + (y - py) * (y - py)
        if (dist < best) {
            best = dist
            bestS = cum[i] + (cum[i + 1] - cum[i]) * t
        }
    }
    const f = archFrame(arch, bestS)
    return { s: bestS, d: (x - f.x) * f.nx + (y - f.y) * f.ny }
}

/**
 * Puntos de control iniciales a partir de la detección automática, con refinamiento normal
 * en 2 pasadas sobre la cresta de máxima densidad dento-alveolar (dentina/esmalte) para garantizar
 * que d = 0 mm pase exactamente por el centro de las raíces y coronas en todo el arco.
 */
export function archControlPointsFromDetection(
    det: { evalY: (x: number) => number; xMin: number; xMax: number; zMidNorm?: number },
    vol: ClinicalVolume,
    count = 11
): ArchPoint[] {
    let pts: ArchPoint[] = []
    for (let i = 0; i < count; i++) {
        const X = det.xMin + ((det.xMax - det.xMin) * i) / (count - 1)
        const Y = det.evalY(X)
        pts.push({
            x: Math.max(2, Math.min(vol.widthMm - 2, X * vol.sx)),
            y: Math.max(2, Math.min(vol.depthMm - 2, Y * vol.sy)),
        })
    }

    try {
        const hMid = Math.max(
            vol.heightMm * 0.12,
            Math.min(vol.heightMm * 0.88, (det.zMidNorm ?? 0.45) * vol.heightMm)
        )
        const rawThr = (vol.quantile(0.92) - vol.intercept) / (vol.slope || 1)
        const hOffsets = [-5, -2.5, 0, 2.5, 5]

        // 2 pasadas de centrado ortogonal sobre las raíces/coronas dentales
        const searchRadii = [12, 6]
        for (const maxD of searchRadii) {
            const arch = buildArch(pts)
            const shifts = new Float64Array(count)
            for (let i = 0; i < count; i++) {
                const s = (arch.length * i) / (count - 1)
                const f = archFrame(arch, s)
                let bestD = 0
                let bestScore = -1
                const stepD = 0.5
                const nSteps = Math.round((2 * maxD) / stepD)
                const profile = new Float64Array(nSteps + 1)

                for (let k = 0; k <= nSteps; k++) {
                    const d = -maxD + k * stepD
                    let maxVal = -Infinity
                    for (const tOff of [-1.5, 0, 1.5]) {
                        const px = f.x + f.nx * d + f.tx * tOff
                        const py = f.y + f.ny * d + f.ty * tOff
                        for (const dh of hOffsets) {
                            const h = Math.max(0, Math.min(vol.heightMm, hMid + dh))
                            const v = sampleRaw(vol, px, py, zFromH(vol, h))
                            if (v === v && v > maxVal) maxVal = v
                        }
                    }
                    const excess = Math.max(0, maxVal - rawThr)
                    const prior = Math.exp(-(d * d) / (2 * maxD * maxD))
                    const score = excess * excess * prior
                    profile[k] = score
                    if (score > bestScore) {
                        bestScore = score
                        bestD = d
                    }
                }

                if (bestScore > 0) {
                    // Centroide local alrededor del pico (±3.5 mm) para centrar en el conducto radicular
                    let num = 0
                    let den = 0
                    for (let k = 0; k <= nSteps; k++) {
                        const d = -maxD + k * stepD
                        if (Math.abs(d - bestD) <= 3.5) {
                            num += d * profile[k]
                            den += profile[k]
                        }
                    }
                    shifts[i] = den > 0 ? num / den : bestD
                }
            }

            // Suavizado a lo largo del arco para mantener una curva spline limpia
            const smooth = new Float64Array(count)
            for (let i = 0; i < count; i++) {
                const prev = shifts[Math.max(0, i - 1)]
                const curr = shifts[i]
                const next = shifts[Math.min(count - 1, i + 1)]
                smooth[i] = 0.25 * prev + 0.5 * curr + 0.25 * next
            }

            pts = pts.map((_, i) => {
                const s = (arch.length * i) / (count - 1)
                const f = archFrame(arch, s)
                return {
                    x: Math.max(2, Math.min(vol.widthMm - 2, f.x + f.nx * smooth[i])),
                    y: Math.max(2, Math.min(vol.depthMm - 2, f.y + f.ny * smooth[i])),
                }
            })
        }
    } catch {}

    return pts
}

// ---------------------------------------------------------------------------------------------
// Panorámica CPR (escala física isotrópica real)
// ---------------------------------------------------------------------------------------------

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function renderPanorama(
    vol: ClinicalVolume,
    arch: ArchModel,
    opts: { thicknessMm: number; mode: "mean" | "mip"; spacing?: number },
    isCancelled: () => boolean = () => false
): Promise<PanoramaImage | null> {
    const sp = opts.spacing ?? Math.max(0.2, vol.iso)
    const L = arch.length
    const cols = Math.max(2, Math.floor(L / sp) + 1)
    const hTop = vol.heightMm
    const rows = Math.max(2, Math.floor(hTop / sp) + 1)
    const thick = Math.max(0, opts.thicknessMm)
    const m = thick < sp ? 1 : Math.max(2, Math.min(96, Math.round(thick / Math.max(sp * 0.8, 0.2))))
    const { nx, ny, nz, isx, isy, isz, raw } = vol
    const nxy = nx * ny

    const idx = new Int32Array(cols * m)
    const wx = new Float32Array(cols * m)
    const wy = new Float32Array(cols * m)
    const ok = new Uint8Array(cols * m)

    for (let c = 0; c < cols; c++) {
        const f = archFrame(arch, c * sp)
        for (let k = 0; k < m; k++) {
            const off = m === 1 ? 0 : -thick / 2 + (thick * (k + 0.5)) / m
            const fx = (f.x + f.nx * off) * isx
            const fy = (f.y + f.ny * off) * isy
            const o = c * m + k
            if (!(fx >= 0 && fy >= 0 && fx <= nx - 1 && fy <= ny - 1)) continue
            let x0 = fx | 0
            let y0 = fy | 0
            if (x0 >= nx - 1) x0 = nx - 2
            if (y0 >= ny - 1) y0 = ny - 2
            idx[o] = y0 * nx + x0
            wx[o] = fx - x0
            wy[o] = fy - y0
            ok[o] = 1
        }
    }

    const out = new Float32Array(cols * rows)
    const mip = opts.mode === "mip"
    for (let r = 0; r < rows; r++) {
        const z = zFromH(vol, hTop - r * sp)
        let fz = z * isz
        fz = fz < 0 ? 0 : fz > nz - 1 ? nz - 1 : fz
        let z0 = fz | 0
        if (z0 >= nz - 1) z0 = nz - 2
        const az = fz - z0
        const b0 = z0 * nxy
        const b1 = b0 + nxy
        const row = r * cols
        for (let c = 0; c < cols; c++) {
            let acc = 0
            let cnt = 0
            let mx = -Infinity
            const o0 = c * m
            for (let k = 0; k < m; k++) {
                const o = o0 + k
                if (!ok[o]) continue
                const p = idx[o]
                const ax = wx[o]
                const ay = wy[o]
                const p0 = b0 + p
                const p1 = b1 + p
                const a0 = raw[p0] + (raw[p0 + 1] - raw[p0]) * ax
                const a1 = raw[p0 + nx] + (raw[p0 + nx + 1] - raw[p0 + nx]) * ax
                const c0 = raw[p1] + (raw[p1 + 1] - raw[p1]) * ax
                const c1 = raw[p1 + nx] + (raw[p1 + nx + 1] - raw[p1 + nx]) * ax
                const v0 = a0 + (a1 - a0) * ay
                const v1 = c0 + (c1 - c0) * ay
                const val = v0 + (v1 - v0) * az
                acc += val
                cnt++
                if (val > mx) mx = val
            }
            out[row + c] = cnt ? (mip ? mx : acc / cnt) : NaN
        }
        if (r % 16 === 15) {
            await yieldToUI()
            if (isCancelled()) return null
        }
    }

    return { data: out, cols, rows, spacing: sp, hTop, length: L, thicknessMm: thick, mode: opts.mode }
}

// ---------------------------------------------------------------------------------------------
// Ventanas (brillo / contraste)
// ---------------------------------------------------------------------------------------------

export function imageQuantile(data: Float32Array, slope: number, intercept: number): Quantile {
    const n = data.length
    const count = Math.min(n, 120000)
    const tmp: number[] = []
    const step = n / count
    for (let i = 0; i < count; i++) {
        const v = data[Math.floor(i * step)]
        if (v === v) tmp.push(v)
    }
    return makeQuantileFromSamples(Float32Array.from(tmp).sort(), slope, intercept)
}

export type WlPresetId = "auto" | "dicom" | "bone" | "enamel" | "soft"

/**
 * Los valores de gris de CBCT no son Unidades Hounsfield calibradas, por lo que los preajustes se
 * derivan de la distribución real de densidades del estudio (percentiles), no de valores HU fijos.
 */
export function presetWindow(q: Quantile, id: WlPresetId, dicom: WindowLevel | null = null): WindowLevel {
    if (id === "dicom" && dicom) return dicom
    let lo: number
    let hi: number
    switch (id) {
        case "bone":
            lo = q(0.54)
            hi = q(0.9994)
            break
        case "enamel":
            lo = q(0.84)
            hi = q(0.9999)
            break
        case "soft":
            lo = q(0.16)
            hi = q(0.95)
            break
        default:
            // Ventana diagnóstica estilo Sirona GALILEOS: suprime el aire de cavidades (0..34%) a negro puro
            // y expande el rango dinámico sobre hueso trabecular, cortical, dentina, conducto radicular y esmalte
            lo = q(0.34)
            hi = q(0.999)
    }
    const width = Math.max(1, hi - lo)
    return { center: lo + width / 2, width }
}
