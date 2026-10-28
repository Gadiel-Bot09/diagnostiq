// @ts-nocheck
"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Maximize2, Minimize2, Crosshair, Sparkles } from "lucide-react"

export interface DentalPanoramaViewerProps {
    sliceIndex: number
    totalSlices: number
    onSelectToothRegion?: (normalizedX: number) => void
    isExpanded?: boolean
    onToggleExpand?: () => void
}

export function DentalPanoramaViewer({
    sliceIndex,
    totalSlices,
    onSelectToothRegion,
    isExpanded,
    onToggleExpand,
}: DentalPanoramaViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)

    // Posición horizontal de la "Ventana de cortes" [0 (Derecha) a 1 (Izquierda)]
    const [cutWindowPos, setCutWindowPos] = useState(0.5) // Centro (Incisivos) por defecto
    const [isDraggingBox, setIsDraggingBox] = useState(false)
    const [selectedToothLabel, setSelectedToothLabel] = useState("Incisivos Centrales (Pieza 11 / 21)")

    // Etiquetas anatómicas de los cuadrantes dentales
    const getToothNameAtPos = (pos: number) => {
        if (pos < 0.15) return "Terceros Molares Derechos (18 / 48)"
        if (pos < 0.28) return "Molares Derechos (17-16 / 47-46)"
        if (pos < 0.40) return "Premolares y Canino Derecho (15-13 / 45-43)"
        if (pos < 0.60) return "Sector Anterior / Incisivos (12-22 / 42-32)"
        if (pos < 0.72) return "Premolares y Canino Izquierdo (23-25 / 33-35)"
        if (pos < 0.85) return "Molares Izquierdos (26-27 / 36-37)"
        return "Terceros Molares Izquierdos (28 / 38)"
    }

    // Dibujar la radiografía panorámica en el lienzo
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const w = (canvas.width = canvas.parentElement?.clientWidth || 600)
        const h = (canvas.height = canvas.parentElement?.clientHeight || 280)

        // Fondo oscuro radiológico
        ctx.fillStyle = "#02040a"
        ctx.fillRect(0, 0, w, h)

        // 1. Curva del Arco Maxilar Superior y Senos Maxilares
        const gradMaxilla = ctx.createRadialGradient(w / 2, h * 0.25, 20, w / 2, h * 0.25, w * 0.45)
        gradMaxilla.addColorStop(0, "rgba(180, 195, 220, 0.22)")
        gradMaxilla.addColorStop(0.7, "rgba(110, 130, 160, 0.12)")
        gradMaxilla.addColorStop(1, "rgba(0, 0, 0, 0)")
        ctx.fillStyle = gradMaxilla
        ctx.fillRect(0, 0, w, h * 0.55)

        // Senos maxilares radiolúcidos (cavidades oscuras delimitadas)
        ctx.strokeStyle = "rgba(190, 210, 240, 0.35)"
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.ellipse(w * 0.32, h * 0.26, w * 0.11, h * 0.16, 0.1, 0, Math.PI * 2)
        ctx.stroke()

        ctx.beginPath()
        ctx.ellipse(w * 0.68, h * 0.26, w * 0.11, h * 0.16, -0.1, 0, Math.PI * 2)
        ctx.stroke()

        // 2. Arco Mandibular y Conductos Dentarios Inferiores
        ctx.strokeStyle = "rgba(160, 185, 220, 0.3)"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(w * 0.08, h * 0.3)
        ctx.bezierCurveTo(w * 0.15, h * 0.82, w * 0.85, h * 0.82, w * 0.92, h * 0.3)
        ctx.stroke()

        // Conducto del nervio dentario inferior (radiopaco / radiolúcido)
        ctx.strokeStyle = "rgba(220, 230, 255, 0.45)"
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(w * 0.12, h * 0.45)
        ctx.quadraticCurveTo(w * 0.25, h * 0.78, w * 0.42, h * 0.76)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(w * 0.88, h * 0.45)
        ctx.quadraticCurveTo(w * 0.75, h * 0.78, w * 0.58, h * 0.76)
        ctx.stroke()
        ctx.setLineDash([])

        // 3. Renderizado de Piezas Dentales (Superiores e Inferiores)
        const totalTeeth = 16
        for (let i = 0; i < totalTeeth; i++) {
            const tx = w * 0.12 + (i / (totalTeeth - 1)) * (w * 0.76)
            const isCenter = Math.abs(i - 7.5) < 2
            const isPremolar = Math.abs(i - 7.5) >= 2 && Math.abs(i - 7.5) < 5
            const isMolar = Math.abs(i - 7.5) >= 5

            // Altura y grosor anatómico
            const crownW = isCenter ? 12 : isPremolar ? 14 : 19
            const crownH = isCenter ? 26 : isPremolar ? 24 : 22
            const rootLen = isCenter ? 32 : isPremolar ? 36 : 38
            const midY = h * 0.49

            // Gradiente de Esmalte y Hueso Cortical (alta radiopacidad)
            const toothGrad = ctx.createLinearGradient(tx - crownW, midY - crownH, tx + crownW, midY + crownH)
            toothGrad.addColorStop(0, "rgba(235, 242, 255, 0.85)")
            toothGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.95)")
            toothGrad.addColorStop(1, "rgba(200, 220, 245, 0.75)")
            ctx.fillStyle = toothGrad

            // Diente Superior: Corona + Raíz hacia arriba
            ctx.beginPath()
            ctx.ellipse(tx, midY - crownH * 0.4, crownW * 0.5, crownH * 0.5, 0, 0, Math.PI * 2)
            ctx.fill()

            // Raíz hacia hueso maxilar
            ctx.strokeStyle = "rgba(240, 245, 255, 0.8)"
            ctx.lineWidth = crownW * 0.35
            ctx.beginPath()
            ctx.moveTo(tx, midY - crownH * 0.5)
            ctx.lineTo(tx + (i < 8 ? -2 : 2), midY - crownH * 0.5 - rootLen)
            ctx.stroke()

            // Diente Inferior: Corona + Raíz hacia abajo
            ctx.beginPath()
            ctx.ellipse(tx, midY + crownH * 0.4, crownW * 0.48, crownH * 0.48, 0, 0, Math.PI * 2)
            ctx.fill()

            ctx.lineWidth = crownW * 0.32
            ctx.beginPath()
            ctx.moveTo(tx, midY + crownH * 0.5)
            ctx.lineTo(tx + (i < 8 ? -2 : 2), midY + crownH * 0.5 + rootLen)
            ctx.stroke()

            // Conducto pulpar interno
            ctx.strokeStyle = "rgba(30, 45, 70, 0.8)"
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.moveTo(tx, midY - crownH * 0.2)
            ctx.lineTo(tx, midY - crownH * 0.5 - rootLen * 0.8)
            ctx.stroke()

            ctx.beginPath()
            ctx.moveTo(tx, midY + crownH * 0.2)
            ctx.lineTo(tx, midY + crownH * 0.5 + rootLen * 0.8)
            ctx.stroke()
        }

        // 4. Marca de Agua y Rango Anatómico
        ctx.fillStyle = "rgba(148, 163, 184, 0.6)"
        ctx.font = "bold 13px sans-serif"
        ctx.fillText("R", 16, h * 0.5)
        ctx.fillText("L", w - 24, h * 0.5)

        // Escala de calibración de 1 cm
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(w - 70, h - 16)
        ctx.lineTo(w - 20, h - 16)
        ctx.moveTo(w - 70, h - 20)
        ctx.lineTo(w - 70, h - 12)
        ctx.moveTo(w - 20, h - 20)
        ctx.lineTo(w - 20, h - 12)
        ctx.stroke()
        ctx.font = "9px monospace"
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
        ctx.fillText("1 cm", w - 54, h - 22)
    }, [])

    // Manejo del arrastre de la "Ventana de cortes"
    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDraggingBox(true)
        updateWindowPosFromEvent(e)
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingBox) return
        updateWindowPosFromEvent(e)
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDraggingBox(false)
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
    }

    const updateWindowPosFromEvent = (e: React.PointerEvent) => {
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        const clickX = e.clientX - rect.left
        const normalized = Math.max(0.08, Math.min(0.92, clickX / rect.width))

        setCutWindowPos(normalized)
        setSelectedToothLabel(getToothNameAtPos(normalized))
        if (onSelectToothRegion) {
            onSelectToothRegion(normalized)
        }
    }

    // Botones rápidos para saltar a cuadrantes dentales
    const jumpToTooth = (pos: number) => {
        setCutWindowPos(pos)
        setSelectedToothLabel(getToothNameAtPos(pos))
        if (onSelectToothRegion) {
            onSelectToothRegion(pos)
        }
    }

    return (
        <div className="relative w-full h-full flex flex-col bg-slate-950 overflow-hidden select-none">
            {/* Header del Panel Panorámico */}
            <div className="flex items-center justify-between px-3 py-1 bg-slate-900/90 border-b border-slate-800 z-10 text-[11px] shrink-0">
                <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30 text-[10px]">
                        PANORAMA
                    </span>
                    <span className="text-slate-300 font-medium truncate">{selectedToothLabel}</span>
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => jumpToTooth(0.22)}
                        title="Molares Derechos"
                    >
                        Molares Der.
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => jumpToTooth(0.50)}
                        title="Incisivos Centrales"
                    >
                        Incisivos
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => jumpToTooth(0.78)}
                        title="Molares Izquierdos"
                    >
                        Molares Izq.
                    </Button>

                    {onToggleExpand && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0 text-slate-400 hover:text-white ml-0.5"
                            onClick={onToggleExpand}
                            title={isExpanded ? "Volver a Multivista" : "Ver Panorama en pantalla completa"}
                        >
                            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                        </Button>
                    )}
                </div>
            </div>

            {/* Contenedor del Lienzo Panorámico con Ventana de Cortes */}
            <div
                ref={containerRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="flex-1 w-full h-full relative cursor-crosshair overflow-hidden touch-none"
            >
                <canvas ref={canvasRef} className="w-full h-full block" />

                {/* "Ventana de cortes" interactiva (Caja azul translúcida idéntica a GALILEOS) */}
                <div
                    className="absolute top-[8%] bottom-[8%] w-24 -ml-12 border-2 border-cyan-400 bg-cyan-400/15 pointer-events-none rounded shadow-lg flex flex-col items-center justify-between transition-transform duration-75"
                    style={{ left: `${cutWindowPos * 100}%` }}
                >
                    {/* Etiqueta superior */}
                    <span className="text-[9px] font-sans font-bold text-cyan-200 bg-cyan-950/80 px-1 py-0.2 rounded mt-0.5 border border-cyan-500/40">
                        Ventana de cortes
                    </span>

                    {/* Retícula / Cruz de puntería central */}
                    <div className="relative w-full h-full flex items-center justify-center">
                        <div className="absolute w-full h-[1px] bg-yellow-400/80" />
                        <div className="absolute h-full w-[1px] bg-yellow-400/80" />
                        <div className="h-3 w-3 rounded-full border border-yellow-300/90" />
                    </div>

                    <span className="text-[8px] font-mono text-cyan-300 bg-slate-950/80 px-1 rounded mb-0.5">
                        {Math.round(cutWindowPos * 100)}%
                    </span>
                </div>
            </div>

            {/* HUD de Ayuda Inferior */}
            <div className="absolute bottom-1.5 left-3 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-2 py-0.5 text-[9px] text-slate-400">
                Arrastre la ventana de cortes o haga clic sobre cualquier diente para enfocar cortes transversales
            </div>
        </div>
    )
}
