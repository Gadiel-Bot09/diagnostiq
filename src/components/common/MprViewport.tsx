"use client"

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
    planeMmToWorld,
    projectWorldPointToPlane,
    sampleRaw,
    type ArchPoint,
    type ClinicalVolume,
    type PlaneSpec,
    type Vec3,
    type ViewImage,
    type WindowLevel,
} from "@/lib/cbct/mprEngine"
import type { WebGLMprRenderer } from "@/lib/cbct/webglMprRenderer"

export type ActiveClinicalTool =
    | "navigate"
    | "pan"
    | "wl"
    | "ruler"
    | "angle"
    | "polyline"
    | "nerve"
    | "editArch"
    | "implant"

export type ClinicalColorMap = "plain" | "invPlain" | "hot"

interface MeasurementBase {
    id: string
    /** Coordenada de corte (mm) en el plano donde se trazó la medida (respaldo para vistas curvas) */
    sliceAnchor?: number
    /** Etiqueta legible del corte para la lista auditable de mediciones */
    sliceLabel?: string
    /** true si el estudio tiene calibración Z estimada o proyección curva */
    isEstimated?: boolean
}

export interface RulerMeasurement extends MeasurementBase {
    kind: "ruler"
    /** Coordenadas locales en mm (respaldo para vistas curvas / compatibilidad) */
    x1: number
    y1: number
    x2: number
    y2: number
    /** Coordenadas 3D absolutas en el volumen LPS (mm) — eliminan cualquier deriva vertical al mover ventanas */
    p1_3d?: Vec3
    p2_3d?: Vec3
}

export interface AngleMeasurement extends MeasurementBase {
    kind: "angle"
    x1: number
    y1: number
    vx: number
    vy: number
    x2: number
    y2: number
    p1_3d?: Vec3
    v_3d?: Vec3
    p2_3d?: Vec3
}

export interface PolylineMeasurement extends MeasurementBase {
    kind: "polyline"
    points: { x: number; y: number }[]
    points_3d?: Vec3[]
}

export type ClinicalMeasurement = RulerMeasurement | AngleMeasurement | PolylineMeasurement

export interface ViewportOverlayContext {
    ctx: CanvasRenderingContext2D
    mmToScreen: (xMm: number, yMm: number) => [number, number]
    screenToMm: (sx: number, sy: number) => [number, number]
    widthCss: number
    heightCss: number
    scalePxPerMm: number
}

export interface MprViewportProps {
    viewId: string
    /** Imagen CPU (usada para Panorama CPR, Tangencial curvo o fallback si no hay WebGL2) */
    image?: ViewImage | null
    /** Ruta GPU WebGL2 16-bit Tricúbica (60 FPS): si se pasan clinicalVol + planeSpec + gpuRenderer, renderiza en GPU */
    clinicalVol?: ClinicalVolume | null
    planeSpec?: PlaneSpec | null
    gpuRenderer?: WebGLMprRenderer | null
    slope?: number
    intercept?: number
    windowLevel: WindowLevel
    colorMap?: ClinicalColorMap
    sharpen?: boolean
    activeTool: ActiveClinicalTool
    measurements: ClinicalMeasurement[]
    onChangeMeasurements: (next: ClinicalMeasurement[]) => void
    currentSliceCoord?: number
    sliceAnchorToleranceMm?: number
    currentSliceLabel?: string
    isEstimatedCalibration?: boolean
    isCurvedProjection?: boolean
    onAdjustWindowLevel?: (deltaWidth: number, deltaCenter: number) => void
    onWheelStep?: (deltaSteps: number) => void
    onNavigateMm?: (xMm: number, yMm: number, isDragging: boolean) => void
    onAddNervePointMm?: (xMm: number, yMm: number) => void
    onPlaceImplantMm?: (xMm: number, yMm: number) => void
    archControlPoints?: ArchPoint[]
    onMoveArchControlPoint?: (index: number, xMm: number, yMm: number) => void
    renderOverlay?: (rc: ViewportOverlayContext) => void
    scaleBarCm?: 1 | 5
    leftLabel?: string
    rightLabel?: string
    topLabel?: string
    bottomLabel?: string
    bottomLeftBadge?: string
    emptyText?: string
    compact?: boolean
    resetTrigger?: number
    externalZoomStep?: number
}

export function getMeasurementSummaryValue(m: ClinicalMeasurement): string {
    const prefix = m.isEstimated ? "~" : ""
    if (m.kind === "ruler") {
        const dist =
            m.p1_3d && m.p2_3d
                ? Math.hypot(
                      m.p2_3d[0] - m.p1_3d[0],
                      m.p2_3d[1] - m.p1_3d[1],
                      m.p2_3d[2] - m.p1_3d[2]
                  )
                : Math.hypot(m.x2 - m.x1, m.y2 - m.y1)
        return `${prefix}${dist.toFixed(1)} mm`
    }
    if (m.kind === "polyline") {
        let total = 0
        if (m.points_3d && m.points_3d.length >= 2) {
            for (let i = 1; i < m.points_3d.length; i++) {
                const a = m.points_3d[i - 1]
                const b = m.points_3d[i]
                total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
            }
        } else {
            for (let i = 1; i < m.points.length; i++) {
                total += Math.hypot(m.points[i].x - m.points[i - 1].x, m.points[i].y - m.points[i - 1].y)
            }
        }
        return `${prefix}${total.toFixed(1)} mm`
    }
    if (m.p1_3d && m.v_3d && m.p2_3d) {
        const v1 = [m.p1_3d[0] - m.v_3d[0], m.p1_3d[1] - m.v_3d[1], m.p1_3d[2] - m.v_3d[2]]
        const v2 = [m.p2_3d[0] - m.v_3d[0], m.p2_3d[1] - m.v_3d[1], m.p2_3d[2] - m.v_3d[2]]
        const l1 = Math.hypot(v1[0], v1[1], v1[2]) || 1
        const l2 = Math.hypot(v2[0], v2[1], v2[2]) || 1
        const cosA = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (l1 * l2)))
        return `${((Math.acos(cosA) * 180) / Math.PI).toFixed(1)}°`
    }
    const v1x = m.x1 - m.vx
    const v1y = m.y1 - m.vy
    const v2x = m.x2 - m.vx
    const v2y = m.y2 - m.vy
    const l1 = Math.hypot(v1x, v1y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const cosA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
    return `${((Math.acos(cosA) * 180) / Math.PI).toFixed(1)}°`
}

interface ProjectedMeasurement {
    source: ClinicalMeasurement
    kind: ClinicalMeasurement["kind"]
    x1?: number
    y1?: number
    x2?: number
    y2?: number
    vx?: number
    vy?: number
    points?: { x: number; y: number }[]
    distLabelMm?: number
    angleDeg?: number
}

/**
 * Visor 2D clínico de grado médico:
 * - Aceleración GPU WebGL2 (16-bit R16F + Tricúbico B-Spline + Unsharp Mask Float32 a 60 FPS) con fallback CPU 16-bit.
 * - Mediciones ancladas en coordenadas 3D absolutas del volumen (0.00 mm de deriva al mover la ventana vertical).
 * - Lupa 3× de precisión, densidad ósea bajo el puntero, regla, ángulo, polilínea (conducto), nervio, arco e implantes.
 */
export function MprViewport({
    image = null,
    clinicalVol = null,
    planeSpec = null,
    gpuRenderer = null,
    slope = 1,
    intercept = 0,
    windowLevel,
    colorMap = "plain",
    sharpen = true,
    activeTool,
    measurements,
    onChangeMeasurements,
    currentSliceCoord,
    sliceAnchorToleranceMm = 1.6,
    currentSliceLabel,
    isEstimatedCalibration = false,
    isCurvedProjection = false,
    onAdjustWindowLevel,
    onWheelStep,
    onNavigateMm,
    onAddNervePointMm,
    onPlaceImplantMm,
    archControlPoints,
    onMoveArchControlPoint,
    renderOverlay,
    scaleBarCm = 1,
    leftLabel,
    rightLabel,
    topLabel,
    bottomLabel,
    bottomLeftBadge,
    emptyText = "Reconstruyendo corte tomográfico...",
    compact = false,
    resetTrigger = 0,
    externalZoomStep = 0,
}: MprViewportProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const imgCanvasRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)

    const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 300, h: 220 })
    const [zoom, setZoom] = useState<number>(1)
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renderVersion, setRenderVersion] = useState<number>(0)

    const activeSpec = planeSpec ?? image?.planeSpec ?? null
    const imgCols = activeSpec ? activeSpec.cols : image?.cols ?? 0
    const imgRows = activeSpec ? activeSpec.rows : image?.rows ?? 0
    const imgSpacing = activeSpec ? activeSpec.spacing : image?.spacing ?? 0.25
    const hasRenderableSource = Boolean(
        (gpuRenderer?.isReady && clinicalVol && planeSpec) || (image && image.cols >= 2 && image.rows >= 2)
    )

    const [hoverState, setHoverState] = useState<{
        sx: number
        sy: number
        xMm: number
        yMm: number
        hu: number | null
    } | null>(null)

    const [draftRuler, setDraftRuler] = useState<{
        x1: number
        y1: number
        x2: number
        y2: number
        startScreenX: number
        startScreenY: number
        awaitingSecondClick: boolean
    } | null>(null)

    const [draftAngle, setDraftAngle] = useState<{
        step: 1 | 2
        x1: number
        y1: number
        vx: number
        vy: number
        x2: number
        y2: number
    } | null>(null)

    const [draftPolyline, setDraftPolyline] = useState<{
        points: { x: number; y: number }[]
        cursor: { x: number; y: number }
    } | null>(null)

    const [draggingHandle, setDraggingHandle] = useState<{
        id: string
        point: "p1" | "p2" | "v" | number
    } | null>(null)

    const [draggingArchIdx, setDraggingArchIdx] = useState<number | null>(null)

    const dragStateRef = useRef<{
        mode: "none" | "navigate" | "pan" | "wl" | "ruler" | "handle" | "archNode"
        startX: number
        startY: number
        lastX: number
        lastY: number
    }>({
        mode: "none",
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
    })

    // Proyectar mediciones 3D absolutas sobre el plano actual (0.00 mm de deriva vertical al mover sliceWindowBounds)
    const projectedMeasurements = useMemo<ProjectedMeasurement[]>(() => {
        const result: ProjectedMeasurement[] = []
        for (const m of measurements) {
            if (activeSpec) {
                if (m.kind === "ruler" && m.p1_3d && m.p2_3d) {
                    const p1 = projectWorldPointToPlane(activeSpec, m.p1_3d)
                    const p2 = projectWorldPointToPlane(activeSpec, m.p2_3d)
                    if (Math.max(p1.distMm, p2.distMm) <= sliceAnchorToleranceMm) {
                        const dist3d = Math.hypot(
                            m.p2_3d[0] - m.p1_3d[0],
                            m.p2_3d[1] - m.p1_3d[1],
                            m.p2_3d[2] - m.p1_3d[2]
                        )
                        result.push({
                            source: m,
                            kind: "ruler",
                            x1: p1.xMm,
                            y1: p1.yMm,
                            x2: p2.xMm,
                            y2: p2.yMm,
                            distLabelMm: dist3d,
                        })
                    }
                    continue
                }
                if (m.kind === "angle" && m.p1_3d && m.v_3d && m.p2_3d) {
                    const p1 = projectWorldPointToPlane(activeSpec, m.p1_3d)
                    const pv = projectWorldPointToPlane(activeSpec, m.v_3d)
                    const p2 = projectWorldPointToPlane(activeSpec, m.p2_3d)
                    if (Math.max(p1.distMm, pv.distMm, p2.distMm) <= sliceAnchorToleranceMm) {
                        const v1 = [m.p1_3d[0] - m.v_3d[0], m.p1_3d[1] - m.v_3d[1], m.p1_3d[2] - m.v_3d[2]]
                        const v2 = [m.p2_3d[0] - m.v_3d[0], m.p2_3d[1] - m.v_3d[1], m.p2_3d[2] - m.v_3d[2]]
                        const l1 = Math.hypot(v1[0], v1[1], v1[2]) || 1
                        const l2 = Math.hypot(v2[0], v2[1], v2[2]) || 1
                        const cosA = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (l1 * l2)))
                        result.push({
                            source: m,
                            kind: "angle",
                            x1: p1.xMm,
                            y1: p1.yMm,
                            vx: pv.xMm,
                            vy: pv.yMm,
                            x2: p2.xMm,
                            y2: p2.yMm,
                            angleDeg: (Math.acos(cosA) * 180) / Math.PI,
                        })
                    }
                    continue
                }
                if (m.kind === "polyline" && m.points_3d && m.points_3d.length >= 2) {
                    const projs = m.points_3d.map((pt) => projectWorldPointToPlane(activeSpec, pt))
                    const maxD = Math.max(...projs.map((p) => p.distMm))
                    if (maxD <= sliceAnchorToleranceMm) {
                        let total3d = 0
                        for (let i = 1; i < m.points_3d.length; i++) {
                            const a = m.points_3d[i - 1]
                            const b = m.points_3d[i]
                            total3d += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
                        }
                        result.push({
                            source: m,
                            kind: "polyline",
                            points: projs.map((p) => ({ x: p.xMm, y: p.yMm })),
                            distLabelMm: total3d,
                        })
                    }
                    continue
                }
            }

            // Respaldo 2D (para Panorama CPR, Tangencial curvo o mediciones antiguas sin 3D)
            if (
                currentSliceCoord === undefined ||
                m.sliceAnchor === undefined ||
                Math.abs(m.sliceAnchor - currentSliceCoord) <= sliceAnchorToleranceMm
            ) {
                if (m.kind === "ruler") {
                    result.push({ source: m, kind: "ruler", x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 })
                } else if (m.kind === "angle") {
                    result.push({ source: m, kind: "angle", x1: m.x1, y1: m.y1, vx: m.vx, vy: m.vy, x2: m.x2, y2: m.y2 })
                } else {
                    result.push({ source: m, kind: "polyline", points: m.points })
                }
            }
        }
        return result
    }, [measurements, activeSpec, currentSliceCoord, sliceAnchorToleranceMm])

    useEffect(() => {
        if (resetTrigger > 0) {
            setZoom(1)
            setPan({ x: 0, y: 0 })
            setDraftRuler(null)
            setDraftAngle(null)
            setDraftPolyline(null)
        }
    }, [resetTrigger])

    const prevZoomStepRef = useRef(externalZoomStep)
    useEffect(() => {
        const diff = externalZoomStep - prevZoomStepRef.current
        prevZoomStepRef.current = externalZoomStep
        if (diff !== 0) {
            setZoom((z) => Math.max(0.5, Math.min(8, z * Math.pow(1.2, diff))))
        }
    }, [externalZoomStep])

    useEffect(() => {
        setDraftRuler(null)
        setDraftAngle(null)
        setDraftPolyline(null)
    }, [activeTool])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const update = () => {
            const rect = el.getBoundingClientRect()
            if (rect.width > 10 && rect.height > 10) {
                setViewportSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
            }
        }
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // 1. Renderizar la imagen DICOM en imgCanvasRef:
    //    - Ruta rápida GPU WebGL2 (16-bit R16F + Tricúbico B-Spline + Sharpen Float32) cuando hay gpuRenderer + clinicalVol + planeSpec.
    //    - Ruta CPU Float32 (16-bit Sharpen) para Panorama CPR, Tangencial curvo o fallback automático.
    useEffect(() => {
        const canvas = imgCanvasRef.current
        if (!canvas) return

        // Intentar primero aceleración GPU WebGL2 (60 FPS, 0 bucles JS)
        if (gpuRenderer?.isReady && clinicalVol && planeSpec) {
            const ok = gpuRenderer.renderPlaneToCanvas(
                clinicalVol,
                planeSpec,
                windowLevel,
                colorMap,
                sharpen,
                canvas,
                true
            )
            if (ok) {
                setRenderVersion((v) => v + 1)
                return
            }
        }

        // Respaldo CPU Float32 de 16 bits
        if (!image || image.cols < 2 || image.rows < 2) return

        const { cols, rows, data } = image
        if (canvas.width !== cols) canvas.width = cols
        if (canvas.height !== rows) canvas.height = rows

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const imgData = ctx.createImageData(cols, rows)
        const out = imgData.data
        const n = cols * rows

        const wlWidth = Math.max(1, windowLevel.width)
        const wlMin = windowLevel.center - wlWidth * 0.5
        const invWl = 1 / wlWidth

        const modBuf = new Float32Array(n)
        const validMask = new Uint8Array(n)
        for (let i = 0; i < n; i++) {
            const rawVal = data[i]
            if (rawVal !== rawVal) {
                validMask[i] = 0
                modBuf[i] = wlMin
            } else {
                validMask[i] = 1
                modBuf[i] = rawVal * slope + intercept
            }
        }

        const procBuf = sharpen ? new Float32Array(n) : modBuf
        if (sharpen) {
            const amount = 0.62
            for (let r = 0; r < rows; r++) {
                const rowOff = r * cols
                const rUp = Math.max(0, r - 1) * cols
                const rDn = Math.min(rows - 1, r + 1) * cols
                for (let c = 0; c < cols; c++) {
                    const idx = rowOff + c
                    if (!validMask[idx]) continue
                    const cL = Math.max(0, c - 1)
                    const cR = Math.min(cols - 1, c + 1)
                    const center = modBuf[idx]
                    const blur =
                        (modBuf[rUp + c] * 2 +
                            modBuf[rDn + c] * 2 +
                            modBuf[rowOff + cL] * 2 +
                            modBuf[rowOff + cR] * 2 +
                            modBuf[rUp + cL] +
                            modBuf[rUp + cR] +
                            modBuf[rDn + cL] +
                            modBuf[rDn + cR] +
                            center * 4) *
                        0.0625
                    procBuf[idx] = center + amount * (center - blur)
                }
            }
        }

        for (let i = 0; i < n; i++) {
            const p = i * 4
            if (!validMask[i]) {
                out[p] = 0
                out[p + 1] = 0
                out[p + 2] = 0
                out[p + 3] = 255
                continue
            }
            const t = (procBuf[i] - wlMin) * invWl
            let v: number
            if (t <= 0) {
                v = 0
            } else if (t >= 1) {
                v = 255
            } else {
                const sCurve = t * t * (3 - 2 * t)
                const blended = sCurve * 0.34 + Math.pow(t, 1.03) * 0.66
                v = Math.round(blended * 255)
            }

            if (colorMap === "invPlain") {
                const iv = 255 - v
                out[p] = iv
                out[p + 1] = iv
                out[p + 2] = iv
                out[p + 3] = 255
            } else if (colorMap === "hot") {
                out[p] = Math.min(255, v * 1.45)
                out[p + 1] = v > 85 ? Math.min(255, (v - 85) * 1.65) : 0
                out[p + 2] = v > 180 ? Math.min(255, (v - 180) * 3.2) : 0
                out[p + 3] = 255
            } else {
                out[p] = v
                out[p + 1] = v
                out[p + 2] = v
                out[p + 3] = 255
            }
        }

        ctx.putImageData(imgData, 0, 0)
        setRenderVersion((v) => v + 1)
    }, [gpuRenderer, clinicalVol, planeSpec, image, slope, intercept, windowLevel, colorMap, sharpen])

    // Geometría física (mm) <-> pantalla (px CSS)
    const getTransformMetrics = useCallback(() => {
        const w = viewportSize.w
        const h = viewportSize.h
        if (!hasRenderableSource || imgCols < 2 || imgRows < 2) {
            return {
                w,
                h,
                widthMm: 100,
                heightMm: 100,
                scalePxPerMm: 1,
                originX: 0,
                originY: 0,
            }
        }
        const widthMm = (imgCols - 1) * imgSpacing
        const heightMm = (imgRows - 1) * imgSpacing
        const padX = compact ? 0.98 : 0.96
        const padY = compact ? 0.96 : 0.94
        const baseScale = Math.min((w * padX) / Math.max(1e-3, widthMm), (h * padY) / Math.max(1e-3, heightMm))
        const scalePxPerMm = baseScale * zoom
        const drawW = widthMm * scalePxPerMm
        const drawH = heightMm * scalePxPerMm
        const originX = (w - drawW) * 0.5 + pan.x
        const originY = (h - drawH) * 0.5 + pan.y
        return { w, h, widthMm, heightMm, scalePxPerMm, originX, originY, drawW, drawH }
    }, [viewportSize, hasRenderableSource, imgCols, imgRows, imgSpacing, zoom, pan, compact])

    const mmToScreen = useCallback(
        (xMm: number, yMm: number): [number, number] => {
            const m = getTransformMetrics()
            return [m.originX + xMm * m.scalePxPerMm, m.originY + yMm * m.scalePxPerMm]
        },
        [getTransformMetrics]
    )

    const screenToMm = useCallback(
        (sx: number, sy: number): [number, number] => {
            const m = getTransformMetrics()
            return [(sx - m.originX) / m.scalePxPerMm, (sy - m.originY) / m.scalePxPerMm]
        },
        [getTransformMetrics]
    )

    // Muestreo instantáneo O(1) de densidad (HU / GV) bajo el puntero
    const sampleDensityAtMm = useCallback(
        (xMm: number, yMm: number): number | null => {
            if (clinicalVol && activeSpec) {
                const [wx, wy, wz] = planeMmToWorld(activeSpec, xMm, yMm)
                const rawVal = sampleRaw(clinicalVol, wx, wy, wz)
                if (rawVal !== rawVal) return null
                return Math.round(rawVal * clinicalVol.slope + clinicalVol.intercept)
            }
            if (!image || image.spacing <= 0) return null
            const c = Math.round(xMm / image.spacing)
            const r = Math.round(yMm / image.spacing)
            if (c < 0 || c >= image.cols || r < 0 || r >= image.rows) return null
            const rawVal = image.data[r * image.cols + c]
            if (rawVal !== rawVal) return null
            return Math.round(rawVal * slope + intercept)
        },
        [clinicalVol, activeSpec, image, slope, intercept]
    )

    // 2. Canvas superpuesto: imagen + overlays + arco + barra de escala + mediciones 3D + lupa 3×
    useEffect(() => {
        const canvas = overlayCanvasRef.current
        const imgCanvas = imgCanvasRef.current
        if (!canvas) return

        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
        const { w, h, widthMm, heightMm, scalePxPerMm, originX, originY } = getTransformMetrics()

        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(h * dpr)
        }

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        ctx.save()
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, w, h)

        ctx.fillStyle = "#03060c"
        ctx.fillRect(0, 0, w, h)

        if (hasRenderableSource && imgCanvas && imgCanvas.width > 1 && imgCanvas.height > 1) {
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = "high"
            const drawW = widthMm * scalePxPerMm
            const drawH = heightMm * scalePxPerMm
            ctx.drawImage(imgCanvas, originX, originY, drawW, drawH)
        }

        if (hasRenderableSource && renderOverlay) {
            ctx.save()
            renderOverlay({
                ctx,
                mmToScreen,
                screenToMm,
                widthCss: w,
                heightCss: h,
                scalePxPerMm,
            })
            ctx.restore()
        }

        if (hasRenderableSource && archControlPoints && archControlPoints.length > 0 && activeTool === "editArch") {
            ctx.save()
            for (let i = 0; i < archControlPoints.length; i++) {
                const pt = archControlPoints[i]
                const [px, py] = mmToScreen(pt.x, pt.y)
                ctx.fillStyle = draggingArchIdx === i ? "#facc15" : "#06b6d4"
                ctx.strokeStyle = "#020617"
                ctx.lineWidth = 2
                ctx.beginPath()
                ctx.arc(px, py, 5.2, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }
            ctx.restore()
        }

        if (hasRenderableSource && !compact) {
            const totalMm = scaleBarCm * 10
            const barPx = totalMm * scalePxPerMm
            if (barPx >= 24 && barPx <= w * 0.8) {
                const rightX = w - 12
                const leftX = rightX - barPx
                const baseY = h - 10
                ctx.save()
                ctx.strokeStyle = "rgba(226, 232, 240, 0.85)"
                ctx.fillStyle = "rgba(226, 232, 240, 0.9)"
                ctx.lineWidth = 1.3
                ctx.beginPath()
                ctx.moveTo(leftX, baseY)
                ctx.lineTo(rightX, baseY)

                const subTicks = scaleBarCm === 1 ? 10 : 5
                for (let i = 0; i <= subTicks; i++) {
                    const tx = leftX + (barPx * i) / subTicks
                    const tickH = i === 0 || i === subTicks ? 6 : i === subTicks / 2 ? 4.5 : 3
                    ctx.moveTo(tx, baseY)
                    ctx.lineTo(tx, baseY - tickH)
                }
                ctx.stroke()

                ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace"
                ctx.textAlign = "right"
                ctx.shadowColor = "rgba(0,0,0,0.9)"
                ctx.shadowBlur = 3
                ctx.fillText(`${scaleBarCm} cm`, rightX, baseY - 8)
                ctx.restore()
            }
        }

        const drawRuler = (
            x1: number,
            y1: number,
            x2: number,
            y2: number,
            isDraft = false,
            estimated = isEstimatedCalibration,
            overrideDistMm?: number
        ) => {
            const [sx1, sy1] = mmToScreen(x1, y1)
            const [sx2, sy2] = mmToScreen(x2, y2)
            const distMm = overrideDistMm ?? Math.hypot(x2 - x1, y2 - y1)
            const strokeMain = estimated ? "#f59e0b" : isDraft ? "#38bdf8" : "#22d3ee"
            const textColor = estimated ? "#fde68a" : "#67e8f9"

            ctx.save()
            ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
            ctx.lineWidth = 3.5
            ctx.beginPath()
            ctx.moveTo(sx1, sy1)
            ctx.lineTo(sx2, sy2)
            ctx.stroke()

            ctx.strokeStyle = strokeMain
            ctx.lineWidth = 1.8
            if (isDraft) ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(sx1, sy1)
            ctx.lineTo(sx2, sy2)
            ctx.stroke()
            ctx.setLineDash([])

            const dx = sx2 - sx1
            const dy = sy2 - sy1
            const len = Math.hypot(dx, dy)
            if (len > 4) {
                const nx = (-dy / len) * 5
                const ny = (dx / len) * 5
                ctx.strokeStyle = strokeMain
                ctx.lineWidth = 1.6
                ctx.beginPath()
                ctx.moveTo(sx1 - nx, sy1 - ny)
                ctx.lineTo(sx1 + nx, sy1 + ny)
                ctx.moveTo(sx2 - nx, sy2 - ny)
                ctx.lineTo(sx2 + nx, sy2 + ny)
                ctx.stroke()
            }

            for (const [px, py] of [
                [sx1, sy1],
                [sx2, sy2],
            ]) {
                ctx.fillStyle = "#083344"
                ctx.strokeStyle = strokeMain
                ctx.lineWidth = 1.8
                ctx.beginPath()
                ctx.arc(px, py, 3.6, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }

            const prefix = estimated || isCurvedProjection ? "~" : ""
            const label = `${prefix}${distMm.toFixed(1)} mm`
            ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace"
            const textW = ctx.measureText(label).width
            const mx = (sx1 + sx2) * 0.5
            const my = (sy1 + sy2) * 0.5 - 12
            const bx = Math.max(4, Math.min(w - textW - 16, mx - (textW + 10) * 0.5))
            const by = Math.max(4, Math.min(h - 22, my - 9))

            ctx.fillStyle = "rgba(2, 6, 23, 0.92)"
            ctx.strokeStyle = estimated ? "rgba(245, 158, 11, 0.8)" : "rgba(34, 211, 238, 0.78)"
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.roundRect(bx, by, textW + 10, 18, 4)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = textColor
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText(label, bx + 5, by + 9)
            ctx.restore()
        }

        const drawAngle = (
            x1: number,
            y1: number,
            vx: number,
            vy: number,
            x2: number,
            y2: number,
            isDraft = false,
            overrideDeg?: number
        ) => {
            const [sx1, sy1] = mmToScreen(x1, y1)
            const [svx, svy] = mmToScreen(vx, vy)
            const [sx2, sy2] = mmToScreen(x2, y2)

            let deg = overrideDeg
            if (deg === undefined) {
                const v1x = x1 - vx
                const v1y = y1 - vy
                const v2x = x2 - vx
                const v2y = y2 - vy
                const l1 = Math.hypot(v1x, v1y) || 1
                const l2 = Math.hypot(v2x, v2y) || 1
                const cosA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
                deg = (Math.acos(cosA) * 180) / Math.PI
            }

            ctx.save()
            ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
            ctx.lineWidth = 3.2
            ctx.beginPath()
            ctx.moveTo(sx1, sy1)
            ctx.lineTo(svx, svy)
            ctx.lineTo(sx2, sy2)
            ctx.stroke()

            ctx.strokeStyle = "#fbbf24"
            ctx.lineWidth = 1.8
            if (isDraft) ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(sx1, sy1)
            ctx.lineTo(svx, svy)
            ctx.lineTo(sx2, sy2)
            ctx.stroke()
            ctx.setLineDash([])

            for (const [px, py] of [
                [sx1, sy1],
                [svx, svy],
                [sx2, sy2],
            ]) {
                ctx.fillStyle = "#451a03"
                ctx.strokeStyle = "#fbbf24"
                ctx.lineWidth = 1.8
                ctx.beginPath()
                ctx.arc(px, py, 3.5, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }

            const label = `${deg.toFixed(1)}°`
            ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace"
            const textW = ctx.measureText(label).width
            const bx = Math.max(4, Math.min(w - textW - 14, svx + 8))
            const by = Math.max(4, Math.min(h - 22, svy - 20))

            ctx.fillStyle = "rgba(2, 6, 23, 0.92)"
            ctx.strokeStyle = "rgba(251, 191, 36, 0.8)"
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.roundRect(bx, by, textW + 10, 18, 4)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = "#fde68a"
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText(label, bx + 5, by + 9)
            ctx.restore()
        }

        const drawPolyline = (
            pts: { x: number; y: number }[],
            isDraft = false,
            estimated = isEstimatedCalibration,
            overrideDistMm?: number
        ) => {
            if (pts.length < 2) return
            let totalMm = overrideDistMm ?? 0
            if (overrideDistMm === undefined) {
                for (let i = 1; i < pts.length; i++) {
                    totalMm += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
                }
            }
            const screenPts = pts.map((p) => mmToScreen(p.x, p.y))

            ctx.save()
            ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
            ctx.lineWidth = 3.4
            ctx.beginPath()
            screenPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
            ctx.stroke()

            ctx.strokeStyle = estimated ? "#f59e0b" : "#34d399"
            ctx.lineWidth = 1.8
            if (isDraft) ctx.setLineDash([4, 3])
            ctx.beginPath()
            screenPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
            ctx.stroke()
            ctx.setLineDash([])

            for (const [px, py] of screenPts) {
                ctx.fillStyle = "#022c22"
                ctx.strokeStyle = estimated ? "#f59e0b" : "#34d399"
                ctx.lineWidth = 1.6
                ctx.beginPath()
                ctx.arc(px, py, 3.2, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }

            const last = screenPts[screenPts.length - 1]
            const prefix = estimated || isCurvedProjection ? "~" : ""
            const label = `L: ${prefix}${totalMm.toFixed(1)} mm`
            ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace"
            const textW = ctx.measureText(label).width
            const bx = Math.max(4, Math.min(w - textW - 14, last[0] + 8))
            const by = Math.max(4, Math.min(h - 22, last[1] - 18))

            ctx.fillStyle = "rgba(2, 6, 23, 0.92)"
            ctx.strokeStyle = estimated ? "rgba(245, 158, 11, 0.8)" : "rgba(52, 211, 153, 0.8)"
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.roundRect(bx, by, textW + 10, 18, 4)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = estimated ? "#fde68a" : "#6ee7b7"
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText(label, bx + 5, by + 9)
            ctx.restore()
        }

        // Dibujar todas las mediciones proyectadas en el corte actual
        for (const pm of projectedMeasurements) {
            if (pm.kind === "ruler") {
                drawRuler(pm.x1!, pm.y1!, pm.x2!, pm.y2!, false, pm.source.isEstimated, pm.distLabelMm)
            } else if (pm.kind === "angle") {
                drawAngle(pm.x1!, pm.y1!, pm.vx!, pm.vy!, pm.x2!, pm.y2!, false, pm.angleDeg)
            } else if (pm.points) {
                drawPolyline(pm.points, false, pm.source.isEstimated, pm.distLabelMm)
            }
        }

        if (draftRuler) {
            drawRuler(draftRuler.x1, draftRuler.y1, draftRuler.x2, draftRuler.y2, true, isEstimatedCalibration)
        }
        if (draftAngle) {
            drawAngle(draftAngle.x1, draftAngle.y1, draftAngle.vx, draftAngle.vy, draftAngle.x2, draftAngle.y2, true)
        }
        if (draftPolyline) {
            drawPolyline([...draftPolyline.points, draftPolyline.cursor], true, isEstimatedCalibration)
        }

        // Lupa de precisión 3x
        const showLoupe =
            !compact &&
            hoverState &&
            hasRenderableSource &&
            imgCanvas &&
            (activeTool === "ruler" ||
                activeTool === "angle" ||
                activeTool === "polyline" ||
                activeTool === "nerve" ||
                activeTool === "implant") &&
            w >= 210 &&
            h >= 180

        if (showLoupe && hoverState && imgCanvas) {
            const loupeR = 44
            const offset = 62
            let lx = hoverState.sx + offset
            let ly = hoverState.sy - offset
            if (lx + loupeR > w - 8) lx = hoverState.sx - offset
            if (ly - loupeR < 26) ly = hoverState.sy + offset
            lx = Math.max(loupeR + 8, Math.min(w - loupeR - 8, lx))
            ly = Math.max(loupeR + 24, Math.min(h - loupeR - 8, ly))

            const srcCenterX = hoverState.xMm / imgSpacing
            const srcCenterY = hoverState.yMm / imgSpacing
            const srcRadiusPx = Math.max(8, (loupeR / Math.max(0.5, scalePxPerMm * 3)) / imgSpacing)

            ctx.save()
            ctx.beginPath()
            ctx.arc(lx, ly, loupeR, 0, Math.PI * 2)
            ctx.fillStyle = "#020617"
            ctx.fill()
            ctx.clip()

            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = "high"
            ctx.drawImage(
                imgCanvas,
                srcCenterX - srcRadiusPx,
                srcCenterY - srcRadiusPx,
                srcRadiusPx * 2,
                srcRadiusPx * 2,
                lx - loupeR,
                ly - loupeR,
                loupeR * 2,
                loupeR * 2
            )

            ctx.strokeStyle = "rgba(34, 211, 238, 0.85)"
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(lx - 14, ly)
            ctx.lineTo(lx - 3, ly)
            ctx.moveTo(lx + 3, ly)
            ctx.lineTo(lx + 14, ly)
            ctx.moveTo(lx, ly - 14)
            ctx.lineTo(lx, ly - 3)
            ctx.moveTo(lx, ly + 3)
            ctx.lineTo(lx, ly + 14)
            ctx.stroke()

            ctx.restore()

            ctx.save()
            ctx.strokeStyle = "rgba(56, 189, 248, 0.9)"
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.arc(lx, ly, loupeR, 0, Math.PI * 2)
            ctx.stroke()

            ctx.font = "700 9px ui-monospace, monospace"
            ctx.textAlign = "center"
            ctx.fillStyle = "#7dd3fc"
            ctx.fillText("3×", lx, ly + loupeR - 8)
            ctx.restore()
        }

        ctx.restore()
    }, [
        hasRenderableSource,
        renderVersion,
        imgSpacing,
        windowLevel,
        colorMap,
        sharpen,
        getTransformMetrics,
        mmToScreen,
        screenToMm,
        renderOverlay,
        scaleBarCm,
        compact,
        projectedMeasurements,
        draftRuler,
        draftAngle,
        draftPolyline,
        hoverState,
        activeTool,
        archControlPoints,
        draggingArchIdx,
        isEstimatedCalibration,
        isCurvedProjection,
    ])

    const findHitHandle = (sx: number, sy: number): { id: string; point: "p1" | "p2" | "v" | number } | null => {
        const hitRadius = 10
        for (let i = projectedMeasurements.length - 1; i >= 0; i--) {
            const pm = projectedMeasurements[i]
            if (pm.kind === "polyline" && pm.points) {
                for (let k = 0; k < pm.points.length; k++) {
                    const [px, py] = mmToScreen(pm.points[k].x, pm.points[k].y)
                    if (Math.hypot(sx - px, sy - py) <= hitRadius) return { id: pm.source.id, point: k }
                }
            } else if (pm.x1 !== undefined && pm.y1 !== undefined && pm.x2 !== undefined && pm.y2 !== undefined) {
                const [x1, y1] = mmToScreen(pm.x1, pm.y1)
                if (Math.hypot(sx - x1, sy - y1) <= hitRadius) return { id: pm.source.id, point: "p1" }
                const [x2, y2] = mmToScreen(pm.x2, pm.y2)
                if (Math.hypot(sx - x2, sy - y2) <= hitRadius) return { id: pm.source.id, point: "p2" }
                if (pm.kind === "angle" && pm.vx !== undefined && pm.vy !== undefined) {
                    const [vx, vy] = mmToScreen(pm.vx, pm.vy)
                    if (Math.hypot(sx - vx, sy - vy) <= hitRadius) return { id: pm.source.id, point: "v" }
                }
            }
        }
        return null
    }

    const findHitArchNode = (sx: number, sy: number): number | null => {
        if (!archControlPoints || activeTool !== "editArch") return null
        for (let i = 0; i < archControlPoints.length; i++) {
            const [px, py] = mmToScreen(archControlPoints[i].x, archControlPoints[i].y)
            if (Math.hypot(sx - px, sy - py) <= 12) return i
        }
        return null
    }

    const getLocalCoords = (e: React.PointerEvent): [number, number] => {
        const rect = overlayCanvasRef.current?.getBoundingClientRect()
        if (!rect) return [0, 0]
        return [e.clientX - rect.left, e.clientY - rect.top]
    }

    const toWorld3D = (xMm: number, yMm: number): Vec3 | undefined =>
        activeSpec ? planeMmToWorld(activeSpec, xMm, yMm) : undefined

    const buildBaseMeta = (): Omit<MeasurementBase, "id"> => ({
        sliceAnchor: currentSliceCoord,
        sliceLabel: currentSliceLabel,
        isEstimated: isEstimatedCalibration || isCurvedProjection,
    })

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!hasRenderableSource) return
        const [sx, sy] = getLocalCoords(e)
        const [xMm, yMm] = screenToMm(sx, sy)

        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}

        if (e.button === 2 && activeTool === "polyline" && draftPolyline) {
            if (draftPolyline.points.length >= 2) {
                const pts3d = activeSpec
                    ? draftPolyline.points.map((pt) => planeMmToWorld(activeSpec, pt.x, pt.y))
                    : undefined
                onChangeMeasurements([
                    ...measurements,
                    {
                        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        kind: "polyline",
                        points: draftPolyline.points,
                        points_3d: pts3d,
                        ...buildBaseMeta(),
                    },
                ])
            }
            setDraftPolyline(null)
            return
        }

        if (e.button === 2 || e.button === 1 || e.shiftKey) {
            dragStateRef.current = { mode: "pan", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        if (activeTool === "editArch") {
            const nodeIdx = findHitArchNode(sx, sy)
            if (nodeIdx !== null) {
                setDraggingArchIdx(nodeIdx)
                dragStateRef.current = { mode: "archNode", startX: sx, startY: sy, lastX: sx, lastY: sy }
                return
            }
        }

        if (activeTool === "nerve" && onAddNervePointMm) {
            onAddNervePointMm(xMm, yMm)
            return
        }

        if (activeTool === "implant" && onPlaceImplantMm) {
            onPlaceImplantMm(xMm, yMm)
            return
        }

        if (activeTool === "ruler") {
            if (draftRuler && draftRuler.awaitingSecondClick) {
                const dist = Math.hypot(xMm - draftRuler.x1, yMm - draftRuler.y1)
                if (dist >= 0.2) {
                    onChangeMeasurements([
                        ...measurements,
                        {
                            id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            kind: "ruler",
                            x1: draftRuler.x1,
                            y1: draftRuler.y1,
                            x2: xMm,
                            y2: yMm,
                            p1_3d: toWorld3D(draftRuler.x1, draftRuler.y1),
                            p2_3d: toWorld3D(xMm, yMm),
                            ...buildBaseMeta(),
                        },
                    ])
                }
                setDraftRuler(null)
                dragStateRef.current.mode = "none"
                return
            }

            const hit = findHitHandle(sx, sy)
            if (hit) {
                setDraggingHandle(hit)
                dragStateRef.current = { mode: "handle", startX: sx, startY: sy, lastX: sx, lastY: sy }
                return
            }

            setDraftRuler({
                x1: xMm,
                y1: yMm,
                x2: xMm,
                y2: yMm,
                startScreenX: sx,
                startScreenY: sy,
                awaitingSecondClick: false,
            })
            dragStateRef.current = { mode: "ruler", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        if (activeTool === "angle") {
            if (!draftAngle) {
                const hit = findHitHandle(sx, sy)
                if (hit) {
                    setDraggingHandle(hit)
                    dragStateRef.current = { mode: "handle", startX: sx, startY: sy, lastX: sx, lastY: sy }
                    return
                }
                setDraftAngle({
                    step: 1,
                    x1: xMm,
                    y1: yMm,
                    vx: xMm,
                    vy: yMm,
                    x2: xMm,
                    y2: yMm,
                })
            } else if (draftAngle.step === 1) {
                setDraftAngle({
                    ...draftAngle,
                    step: 2,
                    vx: xMm,
                    vy: yMm,
                    x2: xMm,
                    y2: yMm,
                })
            } else {
                onChangeMeasurements([
                    ...measurements,
                    {
                        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        kind: "angle",
                        x1: draftAngle.x1,
                        y1: draftAngle.y1,
                        vx: draftAngle.vx,
                        vy: draftAngle.vy,
                        x2: xMm,
                        y2: yMm,
                        p1_3d: toWorld3D(draftAngle.x1, draftAngle.y1),
                        v_3d: toWorld3D(draftAngle.vx, draftAngle.vy),
                        p2_3d: toWorld3D(xMm, yMm),
                        ...buildBaseMeta(),
                    },
                ])
                setDraftAngle(null)
            }
            return
        }

        if (activeTool === "polyline") {
            if (!draftPolyline) {
                const hit = findHitHandle(sx, sy)
                if (hit) {
                    setDraggingHandle(hit)
                    dragStateRef.current = { mode: "handle", startX: sx, startY: sy, lastX: sx, lastY: sy }
                    return
                }
                setDraftPolyline({
                    points: [{ x: xMm, y: yMm }],
                    cursor: { x: xMm, y: yMm },
                })
            } else {
                const last = draftPolyline.points[draftPolyline.points.length - 1]
                const distLast = Math.hypot(xMm - last.x, yMm - last.y)
                if (distLast < 0.35 && draftPolyline.points.length >= 2) {
                    const pts3d = activeSpec
                        ? draftPolyline.points.map((pt) => planeMmToWorld(activeSpec, pt.x, pt.y))
                        : undefined
                    onChangeMeasurements([
                        ...measurements,
                        {
                            id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            kind: "polyline",
                            points: draftPolyline.points,
                            points_3d: pts3d,
                            ...buildBaseMeta(),
                        },
                    ])
                    setDraftPolyline(null)
                } else {
                    setDraftPolyline({
                        points: [...draftPolyline.points, { x: xMm, y: yMm }],
                        cursor: { x: xMm, y: yMm },
                    })
                }
            }
            return
        }

        const hit = findHitHandle(sx, sy)
        if (hit) {
            setDraggingHandle(hit)
            dragStateRef.current = { mode: "handle", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        if (activeTool === "pan") {
            dragStateRef.current = { mode: "pan", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        if (activeTool === "wl") {
            dragStateRef.current = { mode: "wl", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        dragStateRef.current = { mode: "navigate", startX: sx, startY: sy, lastX: sx, lastY: sy }
        onNavigateMm?.(xMm, yMm, false)
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!hasRenderableSource) return
        const [sx, sy] = getLocalCoords(e)
        const [xMm, yMm] = screenToMm(sx, sy)

        if (!compact) {
            setHoverState({ sx, sy, xMm, yMm, hu: sampleDensityAtMm(xMm, yMm) })
        }

        if (draftRuler) {
            setDraftRuler((prev) => (prev ? { ...prev, x2: xMm, y2: yMm } : null))
            return
        }

        if (draftAngle) {
            setDraftAngle((prev) => {
                if (!prev) return null
                if (prev.step === 1) return { ...prev, vx: xMm, vy: yMm, x2: xMm, y2: yMm }
                return { ...prev, x2: xMm, y2: yMm }
            })
            return
        }

        if (draftPolyline) {
            setDraftPolyline((prev) => (prev ? { ...prev, cursor: { x: xMm, y: yMm } } : null))
            return
        }

        const st = dragStateRef.current
        if (st.mode === "none") return

        const dx = sx - st.lastX
        const dy = sy - st.lastY
        st.lastX = sx
        st.lastY = sy

        if (st.mode === "archNode" && draggingArchIdx !== null && onMoveArchControlPoint) {
            onMoveArchControlPoint(draggingArchIdx, xMm, yMm)
            return
        }

        if (st.mode === "handle" && draggingHandle) {
            const w3 = toWorld3D(xMm, yMm)
            onChangeMeasurements(
                measurements.map((m) => {
                    if (m.id !== draggingHandle.id) return m
                    if (m.kind === "polyline" && typeof draggingHandle.point === "number") {
                        const nextPts = m.points.map((pt, idx) =>
                            idx === draggingHandle.point ? { x: xMm, y: yMm } : pt
                        )
                        const nextPts3d =
                            w3 && m.points_3d
                                ? m.points_3d.map((pt, idx) => (idx === draggingHandle.point ? w3 : pt))
                                : m.points_3d
                        return { ...m, points: nextPts, points_3d: nextPts3d }
                    }
                    if (m.kind !== "polyline") {
                        if (draggingHandle.point === "p1") {
                            return { ...m, x1: xMm, y1: yMm, ...(w3 ? { p1_3d: w3 } : {}) }
                        }
                        if (draggingHandle.point === "p2") {
                            return { ...m, x2: xMm, y2: yMm, ...(w3 ? { p2_3d: w3 } : {}) }
                        }
                        if (m.kind === "angle" && draggingHandle.point === "v") {
                            return { ...m, vx: xMm, vy: yMm, ...(w3 ? { v_3d: w3 } : {}) }
                        }
                    }
                    return m
                })
            )
            return
        }

        if (st.mode === "pan") {
            setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
            return
        }

        if (st.mode === "wl") {
            onAdjustWindowLevel?.(dx * 8, -dy * 6)
            return
        }

        if (st.mode === "navigate") {
            onNavigateMm?.(xMm, yMm, true)
        }
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}

        const [sx, sy] = getLocalCoords(e)
        const [xMm, yMm] = screenToMm(sx, sy)

        if (dragStateRef.current.mode === "ruler" && draftRuler) {
            const screenDragPx = Math.hypot(sx - draftRuler.startScreenX, sy - draftRuler.startScreenY)
            const distMm = Math.hypot(xMm - draftRuler.x1, yMm - draftRuler.y1)
            if (screenDragPx >= 6 && distMm >= 0.3) {
                onChangeMeasurements([
                    ...measurements,
                    {
                        id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        kind: "ruler",
                        x1: draftRuler.x1,
                        y1: draftRuler.y1,
                        x2: xMm,
                        y2: yMm,
                        p1_3d: toWorld3D(draftRuler.x1, draftRuler.y1),
                        p2_3d: toWorld3D(xMm, yMm),
                        ...buildBaseMeta(),
                    },
                ])
                setDraftRuler(null)
            } else {
                setDraftRuler((prev) => (prev ? { ...prev, awaitingSecondClick: true } : null))
            }
        }

        setDraggingHandle(null)
        setDraggingArchIdx(null)
        dragStateRef.current.mode = "none"
    }

    const handleDoubleClick = () => {
        if (activeTool === "polyline" && draftPolyline && draftPolyline.points.length >= 2) {
            const pts3d = activeSpec
                ? draftPolyline.points.map((pt) => planeMmToWorld(activeSpec, pt.x, pt.y))
                : undefined
            onChangeMeasurements([
                ...measurements,
                {
                    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    kind: "polyline",
                    points: draftPolyline.points,
                    points_3d: pts3d,
                    ...buildBaseMeta(),
                },
            ])
            setDraftPolyline(null)
        }
    }

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.ctrlKey || activeTool === "pan") {
            const factor = e.deltaY < 0 ? 1.12 : 0.89
            setZoom((z) => Math.max(0.5, Math.min(8, z * factor)))
            return
        }
        if (onWheelStep) {
            onWheelStep(e.deltaY > 0 ? 1 : -1)
        }
    }

    const cursorClass =
        activeTool === "ruler" ||
        activeTool === "angle" ||
        activeTool === "polyline" ||
        activeTool === "nerve" ||
        activeTool === "implant"
            ? "cursor-crosshair"
            : activeTool === "pan" || activeTool === "editArch"
            ? "cursor-grab active:cursor-grabbing"
            : activeTool === "wl"
            ? "cursor-ns-resize"
            : "cursor-crosshair"

    return (
        <div
            ref={containerRef}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            onPointerLeave={() => setHoverState(null)}
            className={`relative flex-1 w-full h-full overflow-hidden bg-[#03060c] select-none touch-none ${cursorClass}`}
        >
            <canvas ref={imgCanvasRef} className="hidden" />
            <canvas
                ref={overlayCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleDoubleClick}
                className="w-full h-full block touch-none"
            />

            {!hasRenderableSource && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-xs text-slate-400 font-medium animate-pulse">{emptyText}</span>
                </div>
            )}

            {leftLabel && (
                <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                    {leftLabel.length <= 2 ? (
                        <span className="text-xs font-bold font-mono text-slate-300/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                            {leftLabel}
                        </span>
                    ) : (
                        <span
                            className="block text-[10px] font-semibold tracking-wider text-slate-200/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                        >
                            {leftLabel}
                        </span>
                    )}
                </div>
            )}

            {rightLabel && (
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                    {rightLabel.length <= 2 ? (
                        <span className="text-xs font-bold font-mono text-slate-300/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                            {rightLabel}
                        </span>
                    ) : (
                        <span
                            className="block text-[10px] font-semibold tracking-wider text-slate-200/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                            style={{ writingMode: "vertical-rl" }}
                        >
                            {rightLabel}
                        </span>
                    )}
                </div>
            )}

            {topLabel && (
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-10 px-1.5 py-0.2 rounded bg-slate-950/75 border border-slate-800/80 text-[9px] font-mono text-slate-200">
                    {topLabel}
                </div>
            )}

            {bottomLabel && (
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-10 px-1.5 py-0.2 rounded bg-slate-950/75 border border-slate-800/80 text-[9px] font-mono text-slate-300">
                    {bottomLabel}
                </div>
            )}

            {bottomLeftBadge && (
                <div className="absolute bottom-1.5 left-2 pointer-events-none z-10 text-xs font-bold font-mono text-slate-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                    {bottomLeftBadge}
                </div>
            )}

            {!compact &&
                hoverState &&
                hoverState.hu !== null &&
                (activeTool === "ruler" ||
                    activeTool === "angle" ||
                    activeTool === "polyline" ||
                    activeTool === "implant") && (
                    <div className="absolute bottom-1.5 left-7 pointer-events-none z-10 px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700/80 text-[9px] font-mono text-slate-300">
                        Densidad: <span className="text-cyan-300 font-semibold">{hoverState.hu}</span>
                    </div>
                )}

            {!compact &&
                (activeTool === "ruler" ||
                    activeTool === "angle" ||
                    activeTool === "polyline" ||
                    activeTool === "nerve" ||
                    activeTool === "implant" ||
                    (activeTool === "editArch" && archControlPoints)) && (
                    <div className="absolute top-1.5 left-2 pointer-events-none z-10 px-2 py-0.5 rounded bg-cyan-950/85 border border-cyan-500/40 text-[10px] font-medium text-cyan-200 shadow-md">
                        {activeTool === "ruler"
                            ? draftRuler?.awaitingSecondClick
                                ? "Clic en el punto final para completar la medida 3D (mm)"
                                : isCurvedProjection
                                ? "Medida aprox. sobre curva (use Transversal o Tangencial Plano para 100% precisión 3D)"
                                : "Clic y arrastre (o 2 clics) · Lupa 3× · Anclada en 3D"
                            : activeTool === "angle"
                            ? !draftAngle
                                ? "Paso 1/3: Clic en el primer extremo del ángulo"
                                : draftAngle.step === 1
                                ? "Paso 2/3: Clic en el vértice del ángulo"
                                : "Paso 3/3: Clic en el segundo extremo del ángulo"
                            : activeTool === "polyline"
                            ? draftPolyline
                                ? `${draftPolyline.points.length} ptos · Doble clic o clic der. para terminar`
                                : "Clic punto a punto para medir longitud curva 3D (conductos)"
                            : activeTool === "nerve"
                            ? "Clic a lo largo del canal mandibular para trazar el Nervio Dentario"
                            : activeTool === "implant"
                            ? "Clic en la cresta ósea (Transversal / Tangencial / Axial) para colocar Implante Virtual"
                            : "Arrastre los puntos cian sobre el corte Axial para ajustar la curva del arco dental"}
                    </div>
                )}
        </div>
    )
}
