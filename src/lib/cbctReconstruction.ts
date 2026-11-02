/**
 * Motor de reconstrucción CBCT dental (100% en el navegador).
 *
 * A partir del volumen DICOM ya cargado por DWV genera:
 *  1. Un volumen reducido de 8 bits para el renderizado volumétrico 3D (ray casting en GPU).
 *  2. La detección automática del arco dental (ajuste polinómico robusto sobre la MIP axial de los dientes).
 *  3. Una panorámica real por reformateo curvo (CPR): suma de rayos a lo largo de un "slab" que sigue el arco,
 *     equivalente a la vista "Panorama" de visores como GALILEOS / Sidexis.
 */

export interface CbctVolume {
    raw: ArrayLike<number>
    nx: number
    ny: number
    nz: number
    sx: number
    sy: number
    sz: number
    /** true si al aumentar el índice de corte se avanza hacia superior (craneal) */
    zUp: boolean
    pAir: number
    pLow: number
    pHigh: number
}

export interface RenderVolume {
    data: Uint8Array
    dims: [number, number, number]
    /** Extensión física en mm: [columnas (x), filas (y), cortes (z)] */
    physical: [number, number, number]
    zUp: boolean
    suggestedThreshold: number
    hist: Uint32Array
}

export interface DentalArch {
    /** Evalúa Y (fila, en píxeles del volumen original) a partir de X (columna) */
    evalY: (x: number) => number
    xMin: number
    xMax: number
    detected: boolean
}

export interface PanoramaData {
    gray: Uint8ClampedArray
    width: number
    height: number
    /** Relación (mm por fila) / (mm por columna) para mostrar con proporción física real */
    aspect: number
    colMm: number
    arcLengthMm: number
    /** Por cada columna: [X, Y, tx, ty] -> posición en el volumen original y tangente unitaria (espacio mm) */
    columns: Float32Array
    zUp: boolean
    nz: number
}

export type PanoramaMode = "xray" | "mip"

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Muestreo pseudoaleatorio determinista para estimar percentiles sin recorrer todo el volumen
function sampleQuantiles(raw: ArrayLike<number>, qs: number[], maxSamples = 300000): number[] {
    const n = raw.length
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

/** Extrae el volumen crudo (sin copiar) desde la aplicación DWV */
export function extractCbctVolume(app: any): CbctVolume | null {
    try {
        if (!app) return null
        const ids: string[] = typeof app.getDataIds === "function" ? app.getDataIds() : []
        let image: any = null
        for (const id of ids) {
            const im = app.getImage(id)
            if (im) {
                image = im
                break
            }
        }
        if (!image) return null
        if (typeof image.getNumberOfComponents === "function" && image.getNumberOfComponents() !== 1) return null

        const geom = image.getGeometry()
        const size = geom.getSize()
        const nx = size.get(0)
        const ny = size.get(1)
        const nz = size.get(2) || 1
        const sp = geom.getSpacing()
        const sx = sp.get(0) || 1
        const sy = sp.get(1) || sx
        const sz = sp.get(2) || sx
        const raw = image.getBuffer()
        if (!raw || nz < 16 || raw.length < nx * ny * nz) return null

        let zUp = true
        const origins = typeof geom.getOrigins === "function" ? geom.getOrigins() : null
        if (origins && origins.length > 1) {
            zUp = origins[origins.length - 1].getZ() >= origins[0].getZ()
        }

        const [pAir, pLow, pHigh] = sampleQuantiles(raw, [0.01, 0.05, 0.9995])
        return { raw, nx, ny, nz, sx, sy, sz, zUp, pAir, pLow, pHigh: Math.max(pHigh, pLow + 1) }
    } catch (err) {
        console.warn("No se pudo extraer el volumen CBCT:", err)
        return null
    }
}

/** Volumen reducido (máx. maxDim por eje) normalizado a 8 bits para la textura 3D de la GPU */
export async function buildRenderVolume(
    vol: CbctVolume,
    maxDim = 256,
    isCancelled: () => boolean = () => false
): Promise<RenderVolume | null> {
    const { raw, nx, ny, nz, sx, sy, sz } = vol
    const f = Math.max(1, Math.max(nx, ny, nz) / maxDim)
    const dx = Math.max(2, Math.round(nx / f))
    const dy = Math.max(2, Math.round(ny / f))
    const dz = Math.max(2, Math.round(nz / f))
    const out = new Uint8Array(dx * dy * dz)
    const hist = new Uint32Array(256)

    const lo = vol.pLow
    const scale = 255 / (vol.pHigh - lo)
    const fx = nx / dx
    const fy = ny / dy
    const fz = nz / dz
    const half = f >= 1.8 // promediado 2x2x2 para reducir aliasing

    const xs0 = new Int32Array(dx)
    const xs1 = new Int32Array(dx)
    for (let x = 0; x < dx; x++) {
        xs0[x] = Math.min(nx - 1, Math.floor(x * fx))
        xs1[x] = half ? Math.min(nx - 1, Math.floor(x * fx + fx / 2)) : xs0[x]
    }
    const nxy = nx * ny

    for (let z = 0; z < dz; z++) {
        if (isCancelled()) return null
        const z0 = Math.min(nz - 1, Math.floor(z * fz))
        const z1 = half ? Math.min(nz - 1, Math.floor(z * fz + fz / 2)) : z0
        for (let y = 0; y < dy; y++) {
            const y0 = Math.min(ny - 1, Math.floor(y * fy))
            const y1 = half ? Math.min(ny - 1, Math.floor(y * fy + fy / 2)) : y0
            const b00 = z0 * nxy + y0 * nx
            const b01 = z0 * nxy + y1 * nx
            const b10 = z1 * nxy + y0 * nx
            const b11 = z1 * nxy + y1 * nx
            const ob = (z * dy + y) * dx
            for (let x = 0; x < dx; x++) {
                const a = xs0[x]
                const b = xs1[x]
                let v: number
                if (half) {
                    v =
                        (raw[b00 + a] + raw[b00 + b] + raw[b01 + a] + raw[b01 + b] +
                            raw[b10 + a] + raw[b10 + b] + raw[b11 + a] + raw[b11 + b]) * 0.125
                } else {
                    v = raw[b00 + a]
                }
                let q = (v - lo) * scale
                q = q < 0 ? 0 : q > 255 ? 255 : q
                const qi = q | 0
                out[ob + x] = qi
                hist[qi]++
            }
        }
        if (z % 12 === 0) await yieldToUI()
    }

    // Umbral óseo sugerido: deja visible aprox. el 14% más denso del volumen
    const total = out.length
    let acc = 0
    let thrBin = 128
    for (let b = 255; b >= 0; b--) {
        acc += hist[b]
        if (acc >= total * 0.14) {
            thrBin = b
            break
        }
    }
    const suggestedThreshold = Math.min(0.8, Math.max(0.18, thrBin / 255))

    return {
        data: out,
        dims: [dx, dy, dz],
        physical: [nx * sx, ny * sy, nz * sz],
        zUp: vol.zUp,
        suggestedThreshold,
        hist,
    }
}

// Ajuste polinómico ponderado (ecuaciones normales + eliminación gaussiana)
function polyFit(us: Float64Array, ys: Float64Array, ws: Float64Array, n: number, degree: number): number[] | null {
    const m = degree + 1
    const A: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0))
    for (let i = 0; i < n; i++) {
        const w = ws[i]
        if (w <= 0) continue
        const pow: number[] = [1]
        for (let k = 1; k < 2 * m; k++) pow.push(pow[k - 1] * us[i])
        for (let r = 0; r < m; r++) {
            for (let c = 0; c < m; c++) A[r][c] += w * pow[r + c]
            A[r][m] += w * pow[r] * ys[i]
        }
    }
    for (let col = 0; col < m; col++) {
        let piv = col
        for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
        if (Math.abs(A[piv][col]) < 1e-12) return null
        ;[A[col], A[piv]] = [A[piv], A[col]]
        for (let r = 0; r < m; r++) {
            if (r === col) continue
            const fct = A[r][col] / A[col][col]
            for (let c = col; c <= m; c++) A[r][c] -= fct * A[col][c]
        }
    }
    return A.map((row, i) => row[m] / row[i])
}

const polyEval = (c: number[], u: number) => {
    let v = 0
    for (let k = c.length - 1; k >= 0; k--) v = v * u + c[k]
    return v
}

/** Detección automática del arco dental sobre el volumen reducido */
export function detectDentalArch(rv: RenderVolume, vol: CbctVolume): DentalArch {
    const [dx, dy, dz] = rv.dims
    const data = rv.data
    const sX = vol.nx / dx
    const sY = vol.ny / dy

    const fallback = (): DentalArch => {
        const xMin = vol.nx * 0.12
        const xMax = vol.nx * 0.88
        const xc = vol.nx / 2
        const xr = (xMax - xMin) / 2
        return {
            evalY: (x: number) => {
                const u = (x - xc) / xr
                return vol.ny * 0.25 + vol.ny * 0.4 * u * u
            },
            xMin,
            xMax,
            detected: false,
        }
    }

    try {
        // 1. Umbral de alta densidad (esmalte / dentina): 0.5% superior del volumen
        const total = data.length
        let acc = 0
        let hiThr = 200
        for (let b = 255; b >= 0; b--) {
            acc += rv.hist[b]
            if (acc >= total * 0.005) {
                hiThr = b
                break
            }
        }
        hiThr = Math.max(hiThr, 40)

        // 2. Banda axial de los dientes: cortes con mayor cantidad de vóxeles de alta densidad
        const counts = new Float64Array(dz)
        const nxy = dx * dy
        for (let z = 0; z < dz; z++) {
            let c = 0
            const base = z * nxy
            for (let i = 0; i < nxy; i++) if (data[base + i] >= hiThr) c++
            counts[z] = c
        }
        const smooth = new Float64Array(dz)
        for (let z = 0; z < dz; z++) {
            let s = 0
            let k = 0
            for (let o = -3; o <= 3; o++) {
                const zz = z + o
                if (zz >= 0 && zz < dz) {
                    s += counts[zz]
                    k++
                }
            }
            smooth[z] = s / k
        }
        let zPeak = 0
        for (let z = 1; z < dz; z++) if (smooth[z] > smooth[zPeak]) zPeak = z
        const peak = smooth[zPeak]
        if (peak < 20) return fallback()
        let z0 = zPeak
        let z1 = zPeak
        const maxBand = Math.round(dz * 0.35)
        while (z0 > 0 && smooth[z0 - 1] >= peak * 0.3 && z1 - z0 < maxBand) z0--
        while (z1 < dz - 1 && smooth[z1 + 1] >= peak * 0.3 && z1 - z0 < maxBand) z1++

        // 3. Proyección de máxima intensidad (MIP) axial sobre la banda dental
        const mip = new Uint8Array(nxy)
        for (let z = z0; z <= z1; z++) {
            const base = z * nxy
            for (let i = 0; i < nxy; i++) if (data[base + i] > mip[i]) mip[i] = data[base + i]
        }

        // 4. Puntos candidatos del arco
        const xsArr: number[] = []
        const ysArr: number[] = []
        const wsArr: number[] = []
        for (let y = 0; y < dy; y++) {
            for (let x = 0; x < dx; x++) {
                const v = mip[y * dx + x]
                if (v >= hiThr) {
                    xsArr.push(x)
                    ysArr.push(y)
                    wsArr.push(1 + (v - hiThr) / 32)
                }
            }
        }
        const n = xsArr.length
        if (n < 60) return fallback()

        let sumX = 0
        let minX = Infinity
        let maxX = -Infinity
        for (const x of xsArr) {
            sumX += x
            if (x < minX) minX = x
            if (x > maxX) maxX = x
        }
        const xc = sumX / n
        const xr = Math.max(1, (maxX - minX) / 2)
        const us = new Float64Array(n)
        const ys = new Float64Array(n)
        const ws0 = new Float64Array(n)
        for (let i = 0; i < n; i++) {
            us[i] = (xsArr[i] - xc) / xr
            ys[i] = ysArr[i]
            ws0[i] = wsArr[i]
        }

        // 5. Ajuste robusto (descarta valores atípicos: columna, implantes, artefactos metálicos)
        const robustFit = (degree: number) => {
            const ws = new Float64Array(ws0)
            let coeffs: number[] | null = null
            for (let iter = 0; iter < 5; iter++) {
                coeffs = polyFit(us, ys, ws, n, degree)
                if (!coeffs) return null
                const res: number[] = []
                for (let i = 0; i < n; i++) if (ws[i] > 0) res.push(Math.abs(ys[i] - polyEval(coeffs, us[i])))
                res.sort((a, b) => a - b)
                const med = res[Math.floor(res.length / 2)] || 1
                const lim = Math.max(2.5 * med, 2)
                for (let i = 0; i < n; i++) ws[i] = Math.abs(ys[i] - polyEval(coeffs, us[i])) <= lim ? ws0[i] : 0
            }
            let se = 0
            let sw = 0
            for (let i = 0; i < n; i++) {
                if (ws[i] <= 0) continue
                const r = ys[i] - polyEval(coeffs!, us[i])
                se += ws[i] * r * r
                sw += ws[i]
            }
            return { coeffs: coeffs!, rms: Math.sqrt(se / Math.max(sw, 1e-6)), ws }
        }

        const quad = robustFit(2)
        if (!quad) return fallback()
        let best = quad
        const quart = robustFit(4)
        if (quart && quart.rms < quad.rms * 0.8) {
            let sane = true
            for (let u = -1.15; u <= 1.15; u += 0.05) {
                const v = polyEval(quart.coeffs, u)
                if (v < -dy * 0.1 || v > dy * 1.1) {
                    sane = false
                    break
                }
            }
            if (sane) best = quart
        }

        // Rango horizontal a partir de los puntos válidos
        const inlierX: number[] = []
        for (let i = 0; i < n; i++) if (best.ws[i] > 0) inlierX.push(xsArr[i])
        inlierX.sort((a, b) => a - b)
        const pxLo = inlierX[Math.floor(inlierX.length * 0.01)]
        const pxHi = inlierX[Math.floor(inlierX.length * 0.99)]
        const ext = (pxHi - pxLo) * 0.08
        const rxMin = Math.max(1, pxLo - ext)
        const rxMax = Math.min(dx - 2, pxHi + ext)

        const coeffs = best.coeffs
        return {
            evalY: (X: number) => {
                const xr_ = (X + 0.5) / sX - 0.5
                const yr = polyEval(coeffs, (xr_ - xc) / xr)
                return (yr + 0.5) * sY - 0.5
            },
            xMin: (rxMin + 0.5) * sX - 0.5,
            xMax: (rxMax + 0.5) * sX - 0.5,
            detected: true,
        }
    } catch (err) {
        console.warn("Fallo en detección de arco dental:", err)
        return fallback()
    }
}

/** Panorámica real por reformateo curvo (CPR) a lo largo del arco dental */
export async function computePanorama(
    vol: CbctVolume,
    arch: DentalArch,
    opts: { thicknessMm: number; mode: PanoramaMode; maxWidth?: number; maxHeight?: number },
    isCancelled: () => boolean = () => false
): Promise<PanoramaData | null> {
    const { raw, nx, ny, nz, sx, sy, sz } = vol
    const nxy = nx * ny

    // 1. Muestreo denso del arco y longitud de arco en mm
    const N = 2048
    const ax = new Float64Array(N)
    const ay = new Float64Array(N)
    const cum = new Float64Array(N)
    for (let i = 0; i < N; i++) {
        const X = arch.xMin + ((arch.xMax - arch.xMin) * i) / (N - 1)
        ax[i] = X
        ay[i] = arch.evalY(X)
        if (i > 0) cum[i] = cum[i - 1] + Math.hypot((ax[i] - ax[i - 1]) * sx, (ay[i] - ay[i - 1]) * sy)
    }
    const L = cum[N - 1]
    if (!(L > 10)) return null

    const minSp = Math.min(sx, sy)
    const W = Math.round(Math.min(opts.maxWidth ?? 1000, Math.max(360, L / minSp)))
    const H = Math.min(opts.maxHeight ?? 640, nz)

    // 2. Geometría por columna: punto del arco, tangente y normal
    const columns = new Float32Array(W * 4)
    const thickness = Math.max(2, opts.thicknessMm)
    const m = Math.max(6, Math.min(40, Math.round(thickness / minSp / 1.5)))
    const idx = new Int32Array(W * m)
    const fxA = new Float32Array(W * m)
    const fyA = new Float32Array(W * m)
    const valid = new Uint8Array(W * m)

    let j = 0
    for (let i = 0; i < W; i++) {
        const s = (i / (W - 1)) * L
        while (j < N - 2 && cum[j + 1] < s) j++
        const seg = cum[j + 1] - cum[j] || 1
        const t = Math.min(1, Math.max(0, (s - cum[j]) / seg))
        const X = ax[j] + (ax[j + 1] - ax[j]) * t
        const Y = ay[j] + (ay[j + 1] - ay[j]) * t
        const ja = Math.max(0, j - 4)
        const jb = Math.min(N - 1, j + 5)
        let tx = (ax[jb] - ax[ja]) * sx
        let ty = (ay[jb] - ay[ja]) * sy
        const tl = Math.hypot(tx, ty) || 1
        tx /= tl
        ty /= tl
        columns[i * 4] = X
        columns[i * 4 + 1] = Y
        columns[i * 4 + 2] = tx
        columns[i * 4 + 3] = ty

        // Normal (mm) -> pasos en píxeles
        const nmx = -ty / sx
        const nmy = tx / sy
        for (let k = 0; k < m; k++) {
            const off = -thickness / 2 + (thickness * (k + 0.5)) / m
            const px = X + nmx * off
            const py = Y + nmy * off
            const o = i * m + k
            if (px < 0 || py < 0 || px >= nx - 1 || py >= ny - 1) {
                valid[o] = 0
                continue
            }
            const x0 = Math.floor(px)
            const y0 = Math.floor(py)
            idx[o] = y0 * nx + x0
            fxA[o] = px - x0
            fyA[o] = py - y0
            valid[o] = 1
        }
    }

    // 3. Integración por filas (cada fila = un nivel axial; fila 0 = superior)
    const out = new Float32Array(W * H)
    const air = vol.pAir
    const useMip = opts.mode === "mip"
    for (let r = 0; r < H; r++) {
        if (isCancelled()) return null
        const zf = Math.min(nz - 1, Math.floor(((r + 0.5) * nz) / H))
        const z = vol.zUp ? nz - 1 - zf : zf
        const base = z * nxy
        for (let i = 0; i < W; i++) {
            let acc = 0
            let mx = -Infinity
            const o0 = i * m
            for (let k = 0; k < m; k++) {
                const o = o0 + k
                let v: number
                if (valid[o]) {
                    const p = base + idx[o]
                    const fx = fxA[o]
                    const fy = fyA[o]
                    const v00 = raw[p]
                    const v10 = raw[p + 1]
                    const v01 = raw[p + nx]
                    const v11 = raw[p + nx + 1]
                    v = (v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy
                } else {
                    v = air
                }
                acc += v
                if (v > mx) mx = v
            }
            out[r * W + i] = useMip ? mx : acc / m
        }
        if (r % 24 === 0) await yieldToUI()
    }

    // 4. Ventana automática por percentiles + gamma + realce de nitidez (unsharp mask)
    const sorted = Float32Array.from(out).sort()
    const lo = sorted[Math.floor(sorted.length * 0.005)]
    const hi = sorted[Math.floor(sorted.length * 0.997)]
    const range = Math.max(1e-6, hi - lo)
    const norm = new Float32Array(W * H)
    const gamma = useMip ? 1.0 : 0.92
    for (let p = 0; p < out.length; p++) {
        let v = (out[p] - lo) / range
        v = v < 0 ? 0 : v > 1 ? 1 : v
        norm[p] = Math.pow(v, gamma)
    }
    const gray = new Uint8ClampedArray(W * H)
    const amount = 0.6
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let s = 0
            let c = 0
            for (let oy = -1; oy <= 1; oy++) {
                const yy = y + oy
                if (yy < 0 || yy >= H) continue
                for (let ox = -1; ox <= 1; ox++) {
                    const xx = x + ox
                    if (xx < 0 || xx >= W) continue
                    s += norm[yy * W + xx]
                    c++
                }
            }
            const v = norm[y * W + x]
            gray[y * W + x] = (v + amount * (v - s / c)) * 255
        }
    }

    const colMm = L / W
    const rowMm = (nz * sz) / H
    return {
        gray,
        width: W,
        height: H,
        aspect: rowMm / colMm,
        colMm,
        arcLengthMm: L,
        columns,
        zUp: vol.zUp,
        nz,
    }
}
