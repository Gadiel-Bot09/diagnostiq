"use client"

import React, { useEffect, useRef, useState, useCallback } from "react"
import type { ViewImage, WindowLevel } from "@/lib/cbct/mprEngine"

export type ActiveClinicalTool = "navigate" | "pan" | "wl" | "ruler" | "angle"
export type ClinicalColorMap = "plain" | "invPlain" | "hot"

export interface RulerMeasurement {
    id: string
    kind: "ruler"
    /** Coordenadas en milímetros dentro del plano de la imagen (x = col * spacing, y = row * spacing) */
    x1: number
    y1: number
    x2: number
    y2: number
}

export interface AngleMeasurement {
    id: string
    kind: "angle"
    /** Puntos en milímetros dentro del plano: A -> Vértice (B) -> C */
    x1: number
    y1: number
    vx: number
    vy: number
    x2: number
    y2: number
}

export type ClinicalMeasurement = RulerMeasurement | AngleMeasurement

export interface ViewportOverlayContext {
    ctx: CanvasRenderingContext2D
    /** Convierte (xMm, yMm) de la imagen a píxeles CSS del canvas superpuesto */
    mmToScreen: (xMm: number, yMm: number) => [number, number]
    /** Convierte píxeles CSS del canvas superpuesto a (xMm, yMm) de la imagen */
    screenToMm: (sx: number, sy: number) => [number, number]
    widthCss: number
    heightCss: number
    scalePxPerMm: number
}

export interface MprViewportProps {
    viewId: string
    image: ViewImage | null
    slope?: number
    intercept?: number
    windowLevel: WindowLevel
    colorMap?: ClinicalColorMap
    sharpen?: boolean
    activeTool: ActiveClinicalTool
    measurements: ClinicalMeasurement[]
    onChangeMeasurements: (next: ClinicalMeasurement[]) => void
    onAdjustWindowLevel?: (deltaWidth: number, deltaCenter: number) => void
    onWheelStep?: (deltaSteps: number) => void
    /** Callback al hacer clic o arrastrar con la herramienta "navigate" en coordenadas (xMm, yMm) */
    onNavigateMm?: (xMm: number, yMm: number, isDragging: boolean) => void
    /** Dibuja superposiciones clínicas específicas de la vista (ej. Ventana de cortes, cruz amarilla, arco axial) */
    renderOverlay?: (rc: ViewportOverlayContext) => void
    /** Etiqueta de escala física ("1 cm" o "5 cm") */
    scaleBarCm?: 1 | 5
    /** Etiquetas anatómicas opcionales */
    leftLabel?: string
    rightLabel?: string
    topLabel?: string
    bottomLabel?: string
    bottomLeftBadge?: string
    emptyText?: string
    /** Incrementar para forzar reseteo de zoom/pan */
    resetTrigger?: number
    /** Incrementar para acercar/alejar desde la barra superior */
    externalZoomStep?: number
}

/**
 * Visor 2D clínico de alta precisión para planos MPR y Panorámica CPR.
 *
 * - Renderiza matriz Float32 isotrópica con Window/Level real de 16 bits, filtro de nitidez cortical (Unsharp Mask)
 *   e interpolación bicúbica/bilineal suave del navegador.
 * - Incluye regla milimétrica calibrada (soporta tanto Clic+Arrastrar como Clic-A + Clic-B) y goniómetro de ángulos.
 * - Dibuja barra de escala física real (1 cm o 5 cm) con subdivisiones milimétricas exactas.
 */
export function MprViewport({
    image,
    slope = 1,
    intercept = 0,
    windowLevel,
    colorMap = "plain",
    sharpen = true,
    activeTool,
    measurements,
    onChangeMeasurements,
    onAdjustWindowLevel,
    onWheelStep,
    onNavigateMm,
    renderOverlay,
    scaleBarCm = 1,
    leftLabel,
    rightLabel,
    topLabel,
    bottomLabel,
    bottomLeftBadge,
    emptyText = "Reconstruyendo corte tomográfico...",
    resetTrigger = 0,
    externalZoomStep = 0,
}: MprViewportProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const imgCanvasRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)

    const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 300, h: 220 })
    const [zoom, setZoom] = useState<number>(1)
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

    // Estado interactivo de medición (soporta clic-arrastrar y clic-clic)
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

    const [draggingHandle, setDraggingHandle] = useState<{
        id: string
        point: "p1" | "p2" | "v"
    } | null>(null)

    const dragStateRef = useRef<{
        mode: "none" | "navigate" | "pan" | "wl" | "ruler" | "handle"
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

    // Resetear zoom y pan cuando se solicita desde fuera
    useEffect(() => {
        if (resetTrigger > 0) {
            setZoom(1)
            setPan({ x: 0, y: 0 })
            setDraftRuler(null)
            setDraftAngle(null)
        }
    }, [resetTrigger])

    // Zoom externo (+ / - desde barra superior)
    const prevZoomStepRef = useRef(externalZoomStep)
    useEffect(() => {
        const diff = externalZoomStep - prevZoomStepRef.current
        prevZoomStepRef.current = externalZoomStep
        if (diff !== 0) {
            setZoom((z) => Math.max(0.5, Math.min(8, z * Math.pow(1.2, diff))))
        }
    }, [externalZoomStep])

    // Limpiar borradores al cambiar de herramienta
    useEffect(() => {
        setDraftRuler(null)
        setDraftAngle(null)
    }, [activeTool])

    // Observar tamaño del contenedor
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

    // 1. Pintar la imagen radiográfica en imgCanvasRef cuando cambian datos, W/L, mapa de color o nitidez
    useEffect(() => {
        const canvas = imgCanvasRef.current
        if (!canvas || !image || image.cols < 2 || image.rows < 2) return

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
        const invWl = 255 / wlWidth

        // Mapear a escala 0..255 primero para poder aplicar realce de nitidez cortical (Unsharp Mask 3x3)
        const lum = new Uint8ClampedArray(n)
        const validMask = new Uint8Array(n)

        for (let i = 0; i < n; i++) {
            const rawVal = data[i]
            if (rawVal !== rawVal) {
                lum[i] = 0
                validMask[i] = 0
                continue
            }
            validMask[i] = 1
            const modVal = rawVal * slope + intercept
            const g = (modVal - wlMin) * invWl
            lum[i] = g <= 0 ? 0 : g >= 255 ? 255 : g
        }

        // Aplicar realce de bordes óseos suave (como GALILEOS / Sidexis)
        const finalLum = new Uint8ClampedArray(n)
        if (sharpen) {
            const amount = 0.42
            for (let r = 0; r < rows; r++) {
                const rowOff = r * cols
                const rUp = Math.max(0, r - 1) * cols
                const rDn = Math.min(rows - 1, r + 1) * cols
                for (let c = 0; c < cols; c++) {
                    const idx = rowOff + c
                    if (!validMask[idx]) continue
                    const cL = Math.max(0, c - 1)
                    const cR = Math.min(cols - 1, c + 1)
                    const center = lum[idx]
                    const blur =
                        (lum[rUp + c] + lum[rDn + c] + lum[rowOff + cL] + lum[rowOff + cR] + center * 4) * 0.125
                    finalLum[idx] = center + amount * (center - blur)
                }
            }
        } else {
            finalLum.set(lum)
        }

        // Colorear según el mapa de color clínico seleccionado
        for (let i = 0; i < n; i++) {
            const p = i * 4
            if (!validMask[i]) {
                out[p] = 0
                out[p + 1] = 0
                out[p + 2] = 0
                out[p + 3] = 255
                continue
            }
            const v = finalLum[i]
            if (colorMap === "invPlain") {
                const iv = 255 - v
                out[p] = iv
                out[p + 1] = iv
                out[p + 2] = iv
                out[p + 3] = 255
            } else if (colorMap === "hot") {
                // Mapa térmico de densidad ósea
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
    }, [image, slope, intercept, windowLevel, colorMap, sharpen])

    // Geometría de transformación física (mm) <-> pantalla (px CSS)
    const getTransformMetrics = useCallback(() => {
        const w = viewportSize.w
        const h = viewportSize.h
        if (!image || image.cols < 2 || image.rows < 2) {
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
        const widthMm = (image.cols - 1) * image.spacing
        const heightMm = (image.rows - 1) * image.spacing
        const baseScale = Math.min((w * 0.96) / Math.max(1e-3, widthMm), (h * 0.94) / Math.max(1e-3, heightMm))
        const scalePxPerMm = baseScale * zoom
        const drawW = widthMm * scalePxPerMm
        const drawH = heightMm * scalePxPerMm
        const originX = (w - drawW) * 0.5 + pan.x
        const originY = (h - drawH) * 0.5 + pan.y
        return { w, h, widthMm, heightMm, scalePxPerMm, originX, originY, drawW, drawH }
    }, [viewportSize, image, zoom, pan])

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

    // 2. Pintar el canvas superpuesto: imagen escalada + overlays clínicos + barra de escala + mediciones
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

        // Fondo radiográfico oscuro
        ctx.fillStyle = "#03060c"
        ctx.fillRect(0, 0, w, h)

        // Dibujar la imagen DICOM con interpolación suave de alta calidad
        if (image && imgCanvas && imgCanvas.width > 1 && imgCanvas.height > 1) {
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = "high"
            const drawW = widthMm * scalePxPerMm
            const drawH = heightMm * scalePxPerMm
            ctx.drawImage(imgCanvas, originX, originY, drawW, drawH)
        }

        // Superposiciones clínicas específicas de cada ventana (Ventana de cortes, líneas de corte, arco axial)
        if (image && renderOverlay) {
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

        // Dibujar barra de escala física real (1 cm o 5 cm) estilo Sirona GALILEOS en la esquina inferior derecha
        if (image) {
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

        // Función auxiliar para dibujar una regla milimétrica
        const drawRuler = (x1: number, y1: number, x2: number, y2: number, isDraft = false) => {
            const [sx1, sy1] = mmToScreen(x1, y1)
            const [sx2, sy2] = mmToScreen(x2, y2)
            const distMm = Math.hypot(x2 - x1, y2 - y1)

            ctx.save()
            // Sombra para contraste sobre hueso blanco
            ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
            ctx.lineWidth = 3.5
            ctx.beginPath()
            ctx.moveTo(sx1, sy1)
            ctx.lineTo(sx2, sy2)
            ctx.stroke()

            // Línea principal cian/amarilla clínica
            ctx.strokeStyle = isDraft ? "#38bdf8" : "#22d3ee"
            ctx.lineWidth = 1.8
            if (isDraft) ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(sx1, sy1)
            ctx.lineTo(sx2, sy2)
            ctx.stroke()
            ctx.setLineDash([])

            // Ticks perpendiculares en los extremos (calibrador dental)
            const dx = sx2 - sx1
            const dy = sy2 - sy1
            const len = Math.hypot(dx, dy)
            if (len > 4) {
                const nx = (-dy / len) * 5
                const ny = (dx / len) * 5
                ctx.strokeStyle = "#22d3ee"
                ctx.lineWidth = 1.6
                ctx.beginPath()
                ctx.moveTo(sx1 - nx, sy1 - ny)
                ctx.lineTo(sx1 + nx, sy1 + ny)
                ctx.moveTo(sx2 - nx, sy2 - ny)
                ctx.lineTo(sx2 + nx, sy2 + ny)
                ctx.stroke()
            }

            // Nodos extremos
            for (const [px, py] of [
                [sx1, sy1],
                [sx2, sy2],
            ]) {
                ctx.fillStyle = "#083344"
                ctx.strokeStyle = "#22d3ee"
                ctx.lineWidth = 1.8
                ctx.beginPath()
                ctx.arc(px, py, 3.8, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }

            // Etiqueta de distancia en milímetros
            const label = `${distMm.toFixed(1)} mm`
            ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace"
            const textW = ctx.measureText(label).width
            const mx = (sx1 + sx2) * 0.5
            const my = (sy1 + sy2) * 0.5 - 12
            const bx = Math.max(4, Math.min(w - textW - 16, mx - (textW + 10) * 0.5))
            const by = Math.max(4, Math.min(h - 22, my - 9))

            ctx.fillStyle = "rgba(2, 6, 23, 0.9)"
            ctx.strokeStyle = "rgba(34, 211, 238, 0.75)"
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.roundRect(bx, by, textW + 10, 18, 4)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = "#67e8f9"
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText(label, bx + 5, by + 9)
            ctx.restore()
        }

        // Función auxiliar para dibujar un ángulo clínico
        const drawAngle = (
            x1: number,
            y1: number,
            vx: number,
            vy: number,
            x2: number,
            y2: number,
            isDraft = false
        ) => {
            const [sx1, sy1] = mmToScreen(x1, y1)
            const [svx, svy] = mmToScreen(vx, vy)
            const [sx2, sy2] = mmToScreen(x2, y2)

            const v1x = x1 - vx
            const v1y = y1 - vy
            const v2x = x2 - vx
            const v2y = y2 - vy
            const l1 = Math.hypot(v1x, v1y) || 1
            const l2 = Math.hypot(v2x, v2y) || 1
            const cosA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
            const deg = (Math.acos(cosA) * 180) / Math.PI

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
                ctx.arc(px, py, 3.6, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }

            const label = `${deg.toFixed(1)}°`
            ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace"
            const textW = ctx.measureText(label).width
            const bx = Math.max(4, Math.min(w - textW - 14, svx + 8))
            const by = Math.max(4, Math.min(h - 22, svy - 20))

            ctx.fillStyle = "rgba(2, 6, 23, 0.9)"
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

        // Dibujar todas las mediciones guardadas
        for (const m of measurements) {
            if (m.kind === "ruler") {
                drawRuler(m.x1, m.y1, m.x2, m.y2, false)
            } else {
                drawAngle(m.x1, m.y1, m.vx, m.vy, m.x2, m.y2, false)
            }
        }

        // Dibujar borrador en curso
        if (draftRuler) {
            drawRuler(draftRuler.x1, draftRuler.y1, draftRuler.x2, draftRuler.y2, true)
        }
        if (draftAngle) {
            drawAngle(draftAngle.x1, draftAngle.y1, draftAngle.vx, draftAngle.vy, draftAngle.x2, draftAngle.y2, true)
        }

        ctx.restore()
    }, [
        image,
        windowLevel,
        colorMap,
        sharpen,
        getTransformMetrics,
        mmToScreen,
        screenToMm,
        renderOverlay,
        scaleBarCm,
        measurements,
        draftRuler,
        draftAngle,
    ])

    // Buscar si el usuario hizo clic sobre el extremo de una medición existente
    const findHitHandle = (sx: number, sy: number): { id: string; point: "p1" | "p2" | "v" } | null => {
        const hitRadius = 10
        for (let i = measurements.length - 1; i >= 0; i--) {
            const m = measurements[i]
            const [x1, y1] = mmToScreen(m.x1, m.y1)
            if (Math.hypot(sx - x1, sy - y1) <= hitRadius) return { id: m.id, point: "p1" }
            const [x2, y2] = mmToScreen(m.x2, m.y2)
            if (Math.hypot(sx - x2, sy - y2) <= hitRadius) return { id: m.id, point: "p2" }
            if (m.kind === "angle") {
                const [vx, vy] = mmToScreen(m.vx, m.vy)
                if (Math.hypot(sx - vx, sy - vy) <= hitRadius) return { id: m.id, point: "v" }
            }
        }
        return null
    }

    const getLocalCoords = (e: React.PointerEvent): [number, number] => {
        const rect = overlayCanvasRef.current?.getBoundingClientRect()
        if (!rect) return [0, 0]
        return [e.clientX - rect.left, e.clientY - rect.top]
    }

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!image) return
        const [sx, sy] = getLocalCoords(e)
        const [xMm, yMm] = screenToMm(sx, sy)

        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}

        // Clic derecho o botón central -> Panorámica / Mover encuadre
        if (e.button === 2 || e.button === 1 || e.shiftKey) {
            dragStateRef.current = { mode: "pan", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        // 1. Si estamos en modo Regla ("ruler")
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
                        },
                    ])
                }
                setDraftRuler(null)
                dragStateRef.current.mode = "none"
                return
            }

            // Verificar si quiere arrastrar un extremo existente
            const hit = findHitHandle(sx, sy)
            if (hit) {
                setDraggingHandle(hit)
                dragStateRef.current = { mode: "handle", startX: sx, startY: sy, lastX: sx, lastY: sy }
                return
            }

            // Iniciar nueva medición
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

        // 2. Si estamos en modo Ángulo ("angle")
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
                    },
                ])
                setDraftAngle(null)
            }
            return
        }

        // Permitir ajustar extremos de medidas incluso en otras herramientas si hace clic directo sobre el nodo
        const hit = findHitHandle(sx, sy)
        if (hit) {
            setDraggingHandle(hit)
            dragStateRef.current = { mode: "handle", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        // 3. Herramienta Mover ("pan")
        if (activeTool === "pan") {
            dragStateRef.current = { mode: "pan", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        // 4. Herramienta Contraste ("wl")
        if (activeTool === "wl") {
            dragStateRef.current = { mode: "wl", startX: sx, startY: sy, lastX: sx, lastY: sy }
            return
        }

        // 5. Herramienta Navegar / Explorar Cortes ("navigate")
        dragStateRef.current = { mode: "navigate", startX: sx, startY: sy, lastX: sx, lastY: sy }
        onNavigateMm?.(xMm, yMm, false)
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!image) return
        const [sx, sy] = getLocalCoords(e)
        const [xMm, yMm] = screenToMm(sx, sy)

        if (draftRuler) {
            setDraftRuler((prev) => (prev ? { ...prev, x2: xMm, y2: yMm } : null))
            return
        }

        if (draftAngle) {
            setDraftAngle((prev) => {
                if (!prev) return null
                if (prev.step === 1) {
                    return { ...prev, vx: xMm, vy: yMm, x2: xMm, y2: yMm }
                }
                return { ...prev, x2: xMm, y2: yMm }
            })
            return
        }

        const st = dragStateRef.current
        if (st.mode === "none") return

        const dx = sx - st.lastX
        const dy = sy - st.lastY
        st.lastX = sx
        st.lastY = sy

        if (st.mode === "handle" && draggingHandle) {
            onChangeMeasurements(
                measurements.map((m) => {
                    if (m.id !== draggingHandle.id) return m
                    if (draggingHandle.point === "p1") return { ...m, x1: xMm, y1: yMm }
                    if (draggingHandle.point === "p2") return { ...m, x2: xMm, y2: yMm }
                    if (m.kind === "angle" && draggingHandle.point === "v") return { ...m, vx: xMm, vy: yMm }
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
                // El doctor hizo clic y arrastró -> guardar medida inmediatamente
                onChangeMeasurements([
                    ...measurements,
                    {
                        id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        kind: "ruler",
                        x1: draftRuler.x1,
                        y1: draftRuler.y1,
                        x2: xMm,
                        y2: yMm,
                    },
                ])
                setDraftRuler(null)
            } else {
                // El doctor hizo un solo clic -> esperar el segundo clic en el punto final
                setDraftRuler((prev) => (prev ? { ...prev, awaitingSecondClick: true } : null))
            }
        }

        setDraggingHandle(null)
        dragStateRef.current.mode = "none"
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
        activeTool === "ruler" || activeTool === "angle"
            ? "cursor-crosshair"
            : activeTool === "pan"
            ? "cursor-grab active:cursor-grabbing"
            : activeTool === "wl"
            ? "cursor-ns-resize"
            : "cursor-crosshair"

    return (
        <div
            ref={containerRef}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            className={`relative flex-1 w-full h-full overflow-hidden bg-[#03060c] select-none touch-none ${cursorClass}`}
        >
            {/* Canvas oculto que almacena la imagen DICOM procesada con Window/Level */}
            <canvas ref={imgCanvasRef} className="hidden" />

            {/* Canvas interactivo visible a resolución Retina/DPR */}
            <canvas
                ref={overlayCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="w-full h-full block touch-none"
            />

            {/* Estado de carga si aún no hay imagen */}
            {!image && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-xs text-slate-400 font-medium animate-pulse">{emptyText}</span>
                </div>
            )}

            {/* Etiquetas de orientación anatómica estilo Sirona GALILEOS */}
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
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-10 px-1.5 py-0.2 rounded bg-slate-950/70 border border-slate-800/80 text-[9px] font-mono text-slate-300">
                    {topLabel}
                </div>
            )}

            {bottomLabel && (
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 pointer-events-none z-10 px-1.5 py-0.2 rounded bg-slate-950/70 border border-slate-800/80 text-[9px] font-mono text-slate-300">
                    {bottomLabel}
                </div>
            )}

            {bottomLeftBadge && (
                <div className="absolute bottom-1.5 left-2 pointer-events-none z-10 text-xs font-bold font-mono text-slate-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                    {bottomLeftBadge}
                </div>
            )}

            {/* Indicador flotante cuando el usuario está trazando una medida o ángulo */}
            {(activeTool === "ruler" || activeTool === "angle") && (
                <div className="absolute top-1.5 left-2 pointer-events-none z-10 px-2 py-0.5 rounded bg-cyan-950/85 border border-cyan-500/40 text-[10px] font-medium text-cyan-200 shadow-md">
                    {activeTool === "ruler"
                        ? draftRuler?.awaitingSecondClick
                            ? "Haga clic en el punto final para completar la medida (mm)"
                            : "Haga clic y arrastre (o clic en 2 puntos) para medir en mm"
                        : !draftAngle
                        ? "Paso 1/3: Clic en el primer extremo del ángulo"
                        : draftAngle.step === 1
                        ? "Paso 2/3: Clic en el vértice del ángulo"
                        : "Paso 3/3: Clic en el segundo extremo del ángulo"}
                </div>
            )}
        </div>
    )
}
