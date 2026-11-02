"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Maximize2, Minimize2, Loader2, SlidersHorizontal, RotateCcw } from "lucide-react"
import type { PanoramaData, PanoramaMode } from "@/lib/cbctReconstruction"

export interface ArchSelection {
    normalizedX: number
    voxelX: number
    voxelY: number
    tx: number
    ty: number
}

export interface DentalPanoramaViewerProps {
    panorama?: PanoramaData | null
    status?: string
    sliceIndex: number
    totalSlices: number
    thicknessMm?: number
    mode?: PanoramaMode
    onChangeThickness?: (mm: number) => void
    onChangeMode?: (mode: PanoramaMode) => void
    onSelectToothRegion?: (normalizedX: number) => void
    onSelectArchPoint?: (sel: ArchSelection) => void
    onSelectSlice?: (sliceIndex: number) => void
    isExpanded?: boolean
    onToggleExpand?: () => void
}

export function DentalPanoramaViewer({
    panorama = null,
    status = "Procesando reconstrucción panorámica...",
    sliceIndex,
    totalSlices,
    thicknessMm = 18,
    mode = "xray",
    onChangeThickness,
    onChangeMode,
    onSelectToothRegion,
    onSelectArchPoint,
    onSelectSlice,
    isExpanded,
    onToggleExpand,
}: DentalPanoramaViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const offscreenRef = useRef<HTMLCanvasElement | null>(null)
    const imageRectRef = useRef<{ x: number; y: number; w: number; h: number }>({
        x: 0,
        y: 0,
        w: 600,
        h: 280,
    })

    // Posición horizontal de la "Ventana de cortes" [0 (Derecha paciente / R) a 1 (Izquierda paciente / L)]
    const [cutWindowPos, setCutWindowPos] = useState(0.5)
    const [isDraggingBox, setIsDraggingBox] = useState(false)
    const [selectedToothLabel, setSelectedToothLabel] = useState("Sector Anterior / Incisivos (12-22 / 42-32)")
    const [brightness, setBrightness] = useState(1.05)
    const [contrast, setContrast] = useState(1.12)
    const [imgBounds, setImgBounds] = useState<{ leftPct: number; widthPct: number; topPct: number; heightPct: number }>({
        leftPct: 0,
        widthPct: 100,
        topPct: 0,
        heightPct: 100,
    })

    const getToothNameAtPos = (pos: number) => {
        if (pos < 0.15) return "Terceros Molares Derechos (18 / 48)"
        if (pos < 0.28) return "Molares Derechos (17-16 / 47-46)"
        if (pos < 0.40) return "Premolares y Canino Derecho (15-13 / 45-43)"
        if (pos < 0.60) return "Sector Anterior / Incisivos (12-22 / 42-32)"
        if (pos < 0.72) return "Premolares y Canino Izquierdo (23-25 / 33-35)"
        if (pos < 0.85) return "Molares Izquierdos (26-27 / 36-37)"
        return "Terceros Molares Izquierdos (28 / 38)"
    }

    // Construir el lienzo offscreen con los píxeles reales de la CPR panorámica
    useEffect(() => {
        if (!panorama || !panorama.gray || panorama.width <= 0 || panorama.height <= 0) {
            offscreenRef.current = null
            return
        }

        const off = document.createElement("canvas")
        off.width = panorama.width
        off.height = panorama.height
        const ctx = off.getContext("2d")
        if (!ctx) return

        const imgData = ctx.createImageData(panorama.width, panorama.height)
        const src = panorama.gray
        const dst = imgData.data
        const n = panorama.width * panorama.height

        for (let i = 0; i < n; i++) {
            const raw = src[i] / 255
            // Aplicar contraste y brillo radiológico con tinte ligeramente azulado clínico
            let v = (raw - 0.5) * contrast + 0.5
            v = v * brightness
            const c = Math.max(0, Math.min(255, Math.round(v * 255)))
            const idx = i * 4
            dst[idx] = Math.max(0, Math.min(255, Math.round(c * 0.97)))
            dst[idx + 1] = Math.max(0, Math.min(255, Math.round(c * 0.99)))
            dst[idx + 2] = c
            dst[idx + 3] = 255
        }

        ctx.putImageData(imgData, 0, 0)
        offscreenRef.current = off
    }, [panorama, brightness, contrast])

    // Renderizar el lienzo visible respetando la proporción física real (mm) del paciente
    const renderCanvas = useCallback(() => {
        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return

        const cw = container.clientWidth || 600
        const ch = container.clientHeight || 280
        if (cw <= 0 || ch <= 0) return

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(cw * dpr)
        canvas.height = Math.round(ch * dpr)

        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // Fondo radiológico oscuro tipo Sirona GALILEOS
        ctx.fillStyle = "#03050a"
        ctx.fillRect(0, 0, cw, ch)

        const off = offscreenRef.current
        if (off && panorama) {
            const targetAspect = Math.max(1.2, Math.min(3.5, panorama.aspect || panorama.width / panorama.height))
            const padX = 12
            const padY = 6
            const availW = Math.max(100, cw - padX * 2)
            const availH = Math.max(60, ch - padY * 2)

            let drawW = availW
            let drawH = drawW / targetAspect
            if (drawH > availH) {
                drawH = availH
                drawW = drawH * targetAspect
            }

            const drawX = (cw - drawW) * 0.5
            const drawY = (ch - drawH) * 0.5

            imageRectRef.current = { x: drawX, y: drawY, w: drawW, h: drawH }
            setImgBounds({
                leftPct: (drawX / cw) * 100,
                widthPct: (drawW / cw) * 100,
                topPct: (drawY / ch) * 100,
                heightPct: (drawH / ch) * 100,
            })

            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = "high"
            ctx.drawImage(off, drawX, drawY, drawW, drawH)

            // Borde sutil alrededor de la radiografía panorámica
            ctx.strokeStyle = "rgba(148, 163, 184, 0.16)"
            ctx.lineWidth = 1
            ctx.strokeRect(drawX, drawY, drawW, drawH)

            // Escala calibrada de 1 cm en base al ancho físico real del arco (arcLengthMm)
            const pxPerMm = panorama.arcLengthMm > 0 ? drawW / panorama.arcLengthMm : drawW / 130
            const barPx = Math.max(22, Math.min(90, pxPerMm * 10)) // 10 mm = 1 cm
            const bx2 = cw - 16
            const bx1 = bx2 - barPx
            const by = ch - 14

            ctx.strokeStyle = "rgba(226, 232, 240, 0.8)"
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(bx1, by)
            ctx.lineTo(bx2, by)
            ctx.moveTo(bx1, by - 4)
            ctx.lineTo(bx1, by + 4)
            ctx.moveTo(bx2, by - 4)
            ctx.lineTo(bx2, by + 4)
            ctx.stroke()

            ctx.font = "10px monospace"
            ctx.fillStyle = "rgba(226, 232, 240, 0.85)"
            ctx.fillText("1 cm", (bx1 + bx2) * 0.5 - 12, by - 6)
        } else {
            imageRectRef.current = { x: 0, y: 0, w: cw, h: ch }
        }

        // Marcadores radiológicos laterales R (Derecha paciente) y L (Izquierda paciente)
        ctx.font = "bold 13px sans-serif"
        ctx.fillStyle = "rgba(226, 232, 240, 0.85)"
        ctx.fillText("R", 14, ch - 14)
        ctx.fillText("L", cw - 24, 22)
    }, [panorama])

    useEffect(() => {
        renderCanvas()
    }, [renderCanvas, panorama, brightness, contrast, isExpanded])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const ro = new ResizeObserver(() => {
            renderCanvas()
        })
        ro.observe(container)
        return () => ro.disconnect()
    }, [renderCanvas])

    // Emitir coordenadas exactas del arco dental al seleccionar o arrastrar la "Ventana de cortes"
    const emitArchSelection = useCallback(
        (normX: number) => {
            const clamped = Math.max(0.04, Math.min(0.96, normX))
            setCutWindowPos(clamped)
            setSelectedToothLabel(getToothNameAtPos(clamped))

            if (onSelectToothRegion) {
                onSelectToothRegion(clamped)
            }

            if (panorama && panorama.columns && panorama.width > 0 && onSelectArchPoint) {
                const colIdx = Math.max(
                    0,
                    Math.min(panorama.width - 1, Math.round(clamped * (panorama.width - 1)))
                )
                const base = colIdx * 4
                const voxelX = panorama.columns[base]
                const voxelY = panorama.columns[base + 1]
                const tx = panorama.columns[base + 2]
                const ty = panorama.columns[base + 3]
                onSelectArchPoint({
                    normalizedX: clamped,
                    voxelX,
                    voxelY,
                    tx,
                    ty,
                })
            }
        },
        [panorama, onSelectToothRegion, onSelectArchPoint]
    )

    const updateFromPointerEvent = (e: React.PointerEvent) => {
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        const localX = e.clientX - rect.left
        const localY = e.clientY - rect.top

        const imgRect = imageRectRef.current
        const normX =
            imgRect.w > 20
                ? (localX - imgRect.x) / imgRect.w
                : localX / Math.max(1, rect.width)

        emitArchSelection(normX)

        // Si el usuario también desplaza verticalmente con clic sostenido, sincronizar altura axial
        if (onSelectSlice && totalSlices > 1 && imgRect.h > 20) {
            const relY = Math.max(0, Math.min(1, (localY - imgRect.y) / imgRect.h))
            const zUp = panorama ? panorama.zUp : true
            const sliceNorm = zUp ? 1 - relY : relY
            const targetSlice = Math.round(sliceNorm * (totalSlices - 1))
            onSelectSlice(targetSlice)
        }
    }

    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDraggingBox(true)
        updateFromPointerEvent(e)
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingBox) return
        updateFromPointerEvent(e)
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDraggingBox(false)
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
    }

    const jumpToTooth = (pos: number) => {
        emitArchSelection(pos)
    }

    // Calcular posición horizontal de la "Ventana de cortes" dentro del área real de la radiografía
    const windowLeftPct = imgBounds.leftPct + cutWindowPos * imgBounds.widthPct

    // Posición vertical de la línea amarilla axial (sincronizada con el corte axial actual)
    const sliceRatio = totalSlices > 1 ? Math.max(0, Math.min(1, sliceIndex / (totalSlices - 1))) : 0.5
    const zUp = panorama ? panorama.zUp : true
    const axialLineTopPct = (zUp ? 1 - sliceRatio : sliceRatio) * 100

    return (
        <div className="relative w-full h-full flex flex-col bg-[#03050a] overflow-hidden select-none">
            {/* Header del Panel Panorámico estilo Sirona GALILEOS */}
            <div className="flex flex-wrap items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 z-20 text-[11px] shrink-0 gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30 text-[10px] shrink-0">
                        PANORAMA
                    </span>
                    <span className="text-slate-300 font-medium truncate text-[11px]">
                        {selectedToothLabel}
                    </span>
                </div>

                <div className="flex items-center gap-1 flex-wrap">
                    {/* Selector de modo Rx vs MIP */}
                    {onChangeMode && (
                        <div className="flex items-center bg-slate-950/90 rounded border border-slate-800 p-0.5 mr-0.5">
                            <button
                                type="button"
                                onClick={() => onChangeMode("xray")}
                                className={`px-1.5 py-0.2 text-[9px] rounded font-medium transition-colors ${
                                    mode === "xray"
                                        ? "bg-blue-600 text-white"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                title="Reconstrucción Panorámica Radiográfica (CPR Dental)"
                            >
                                Rx
                            </button>
                            <button
                                type="button"
                                onClick={() => onChangeMode("mip")}
                                className={`px-1.5 py-0.2 text-[9px] rounded font-medium transition-colors ${
                                    mode === "mip"
                                        ? "bg-blue-600 text-white"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                title="Proyección de Máxima Intensidad (MIP)"
                            >
                                MIP
                            </button>
                        </div>
                    )}

                    {/* Selector de grosor de capa panorámica en mm */}
                    {onChangeThickness && (
                        <div className="hidden sm:flex items-center bg-slate-950/90 rounded border border-slate-800 p-0.5 mr-0.5">
                            {[12, 18, 25].map((mm) => (
                                <button
                                    key={mm}
                                    type="button"
                                    onClick={() => onChangeThickness(mm)}
                                    className={`px-1.5 py-0.2 text-[9px] rounded font-mono transition-colors ${
                                        thicknessMm === mm
                                            ? "bg-cyan-600 text-white"
                                            : "text-slate-400 hover:text-white"
                                    }`}
                                    title={`Grosor de corte panorámico: ${mm} mm`}
                                >
                                    {mm}mm
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Botones rápidos de cuadrantes dentales */}
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => jumpToTooth(0.24)}
                        title="Enfocar Molares Derechos"
                    >
                        Molares Der.
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => jumpToTooth(0.5)}
                        title="Enfocar Incisivos Centrales"
                    >
                        Incisivos
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => jumpToTooth(0.76)}
                        title="Enfocar Molares Izquierdos"
                    >
                        Molares Izq.
                    </Button>

                    {onToggleExpand && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0 text-slate-400 hover:text-white ml-0.5"
                            onClick={onToggleExpand}
                            title={isExpanded ? "Volver a 5 Vistas" : "Expandir Panorama"}
                        >
                            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                        </Button>
                    )}
                </div>
            </div>

            {/* Lienzo de Reconstrucción Panorámica Real + Ventana de Cortes */}
            <div
                ref={containerRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="flex-1 w-full h-full relative cursor-crosshair overflow-hidden touch-none"
            >
                <canvas ref={canvasRef} className="w-full h-full block" />

                {/* Estado de carga mientras se calcula la CPR desde los vóxeles DICOM */}
                {!panorama && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-10 gap-2 pointer-events-none">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                        <span className="text-[11px] text-slate-300 font-medium">{status}</span>
                    </div>
                )}

                {/* "Ventana de cortes" interactiva idéntica a Sirona GALILEOS Viewer */}
                {panorama && (
                    <div
                        className="absolute pointer-events-none flex flex-col items-center justify-between transition-[left] duration-75"
                        style={{
                            left: `${windowLeftPct}%`,
                            top: `${Math.max(4, imgBounds.topPct + 3)}%`,
                            height: `${Math.min(92, imgBounds.heightPct - 6)}%`,
                            width: isExpanded ? "148px" : "108px",
                            transform: "translateX(-50%)",
                            border: "1.5px solid rgba(125, 211, 252, 0.92)",
                            backgroundColor: "rgba(56, 189, 248, 0.08)",
                            boxShadow: "0 0 12px rgba(2, 132, 199, 0.25)",
                        }}
                    >
                        {/* Cabecera "Ventana de cortes" estilo GALILEOS */}
                        <div className="w-full bg-sky-300/85 text-slate-950 text-[9px] font-semibold px-1.5 py-0.5 leading-tight tracking-tight truncate shadow-xs">
                            Ventana de cortes
                        </div>

                        {/* Líneas amarillas de referencia anatómica (Eje Transversal Vertical + Nivel Axial Horizontal) */}
                        <div className="relative w-full flex-1">
                            {/* Línea vertical amarilla (Corte Transversal / Sagital actual) */}
                            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1.2px] bg-yellow-400/90" />

                            {/* Línea horizontal amarilla (Corte Axial actual) */}
                            <div
                                className="absolute inset-x-0 h-[1.2px] bg-yellow-400/85 transition-[top] duration-75"
                                style={{ top: `${axialLineTopPct}%` }}
                            />

                            {/* Marcas de graduación dental en el eje central */}
                            <div
                                className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5"
                                style={{ top: `${axialLineTopPct}%`, transform: "translate(-50%, -50%)" }}
                            >
                                <div className="w-6 h-[5px] border-x border-yellow-300/80" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Controles rápidos de Brillo/Contraste cuando está expandido o en esquina superior derecha */}
                {panorama && (
                    <div
                        className="absolute bottom-1.5 right-16 z-20 flex items-center gap-1.5 bg-slate-950/80 border border-slate-800/90 rounded-md px-2 py-0.5 text-[9px] text-slate-300"
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <SlidersHorizontal className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                        <span className="text-slate-400">Contraste</span>
                        <input
                            type="range"
                            min={0.75}
                            max={1.65}
                            step={0.05}
                            value={contrast}
                            onChange={(e) => setContrast(parseFloat(e.target.value))}
                            className="w-14 h-1 accent-blue-500 cursor-pointer"
                            title="Ajustar contraste radiográfico de la panorámica"
                        />
                        {(Math.abs(contrast - 1.12) > 0.02 || Math.abs(brightness - 1.05) > 0.02) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContrast(1.12)
                                    setBrightness(1.05)
                                }}
                                className="text-slate-400 hover:text-white ml-0.5"
                                title="Restablecer contraste original"
                            >
                                <RotateCcw className="h-2.5 w-2.5" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* HUD inferior discreto */}
            <div className="absolute bottom-1.5 left-9 pointer-events-none z-10 bg-slate-950/75 border border-slate-800/80 rounded px-2 py-0.5 text-[9px] text-slate-400 hidden sm:block">
                Arrastre la <span className="text-sky-300 font-medium">Ventana de cortes</span> sobre el arco dental para inspeccionar raíces y hueso en 3D
            </div>
        </div>
    )
}
