"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Rotate3d, Crosshair, Trash2, AlertTriangle, CheckCircle2, Navigation } from "lucide-react"
import type { ReorientationEuler, Vec3 } from "@/lib/cbct/mprEngine"
import {
    computeImplantNerveDistanceMm,
    type ArchJawType,
    type VirtualImplant,
} from "@/lib/cbct/clinicalScene"

export interface ReorientationPopoverProps {
    reorientation: ReorientationEuler
    onChangeReorientation: (next: ReorientationEuler) => void
    activeArchJaw: ArchJawType
    onSwitchArchJaw: (jaw: ArchJawType) => void
    disabled?: boolean
}

/**
 * Control de Reorientación 3D del Plano Oclusal (Pitch / Roll / Yaw) y selector de Doble Arco (Maxilar / Mandíbula).
 */
export function ReorientationPopover({
    reorientation,
    onChangeReorientation,
    activeArchJaw,
    onSwitchArchJaw,
    disabled,
}: ReorientationPopoverProps) {
    const [open, setOpen] = useState(false)
    const isModified =
        Math.abs(reorientation.pitchDeg) > 0.1 ||
        Math.abs(reorientation.rollDeg) > 0.1 ||
        Math.abs(reorientation.yawDeg) > 0.1

    return (
        <div className="relative">
            <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                className={`h-7 px-2 text-[11px] gap-1 rounded-lg border ${
                    isModified
                        ? "border-amber-500/60 bg-amber-950/60 text-amber-200 hover:bg-amber-900/60"
                        : "border-slate-800 bg-slate-950/90 text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
                title="Reorientar plano oclusal 3D (Pitch / Roll / Yaw) y alternar arco Maxilar / Mandibular"
            >
                <Rotate3d className="h-3 w-3 text-amber-400" />
                <span className="hidden 2xl:inline">Nivelar</span>
                {isModified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </Button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 mt-1.5 w-72 rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur-xl shadow-2xl p-3 z-50 text-xs space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                            <span className="font-bold text-white flex items-center gap-1.5">
                                <Rotate3d className="h-3.5 w-3.5 text-amber-400" />
                                Plano Oclusal 3D y Arcada
                            </span>
                            {isModified && (
                                <button
                                    type="button"
                                    onClick={() => onChangeReorientation({ pitchDeg: 0, rollDeg: 0, yawDeg: 0 })}
                                    className="text-[10px] text-cyan-400 hover:underline"
                                >
                                    Centrar 0°
                                </button>
                            )}
                        </div>

                        {/* Doble Arco: Maxilar Superior vs Mandíbula */}
                        <div className="space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Curva de Arco Activa (Bimaxilar)
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                <button
                                    type="button"
                                    onClick={() => onSwitchArchJaw("upper")}
                                    className={`py-1.5 px-2 rounded-lg border text-[11px] font-semibold transition-colors ${
                                        activeArchJaw === "upper"
                                            ? "bg-blue-600/30 border-blue-500 text-white"
                                            : "bg-slate-950/70 border-slate-800 text-slate-400 hover:text-white"
                                    }`}
                                >
                                    Arco Maxilar Sup.
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onSwitchArchJaw("lower")}
                                    className={`py-1.5 px-2 rounded-lg border text-[11px] font-semibold transition-colors ${
                                        activeArchJaw === "lower"
                                            ? "bg-cyan-600/30 border-cyan-500 text-white"
                                            : "bg-slate-950/70 border-slate-800 text-slate-400 hover:text-white"
                                    }`}
                                >
                                    Arco Mandibular
                                </button>
                            </div>
                        </div>

                        {/* Reorientación 3D Euler */}
                        <div className="border-t border-slate-800 pt-2 space-y-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Reorientación 3D (Corregir inclinación)
                            </div>

                            <label className="block space-y-0.5">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-300">Pitch (Antero-posterior)</span>
                                    <span className="font-mono text-amber-300">{reorientation.pitchDeg.toFixed(0)}°</span>
                                </div>
                                <input
                                    type="range"
                                    min={-25}
                                    max={25}
                                    step={1}
                                    value={reorientation.pitchDeg}
                                    onChange={(e) =>
                                        onChangeReorientation({ ...reorientation, pitchDeg: parseInt(e.target.value, 10) })
                                    }
                                    className="w-full accent-amber-400"
                                />
                            </label>

                            <label className="block space-y-0.5">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-300">Roll (Nivelación Izq/Der)</span>
                                    <span className="font-mono text-amber-300">{reorientation.rollDeg.toFixed(0)}°</span>
                                </div>
                                <input
                                    type="range"
                                    min={-25}
                                    max={25}
                                    step={1}
                                    value={reorientation.rollDeg}
                                    onChange={(e) =>
                                        onChangeReorientation({ ...reorientation, rollDeg: parseInt(e.target.value, 10) })
                                    }
                                    className="w-full accent-amber-400"
                                />
                            </label>

                            <label className="block space-y-0.5">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-300">Yaw (Línea media axial)</span>
                                    <span className="font-mono text-amber-300">{reorientation.yawDeg.toFixed(0)}°</span>
                                </div>
                                <input
                                    type="range"
                                    min={-25}
                                    max={25}
                                    step={1}
                                    value={reorientation.yawDeg}
                                    onChange={(e) =>
                                        onChangeReorientation({ ...reorientation, yawDeg: parseInt(e.target.value, 10) })
                                    }
                                    className="w-full accent-amber-400"
                                />
                            </label>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

export interface ImplantPlannerPopoverProps {
    implants: VirtualImplant[]
    selectedImplantId: string | null
    onSelectImplant: (id: string | null) => void
    isPlacingImplant: boolean
    onTogglePlacingImplant: () => void
    defaultDiameter: number
    setDefaultDiameter: (d: number) => void
    defaultLength: number
    setDefaultLength: (l: number) => void
    onUpdateImplant: (id: string, patch: Partial<VirtualImplant>) => void
    onDeleteImplant: (id: string) => void
    onJumpToImplant: (imp: VirtualImplant) => void
    nervePoints3D: Vec3[]
    disabled?: boolean
}

/**
 * Planificador de Implantes Dentales Virtuales 3D con alerta automática de proximidad al Nervio Dentario.
 */
export function ImplantPlannerPopover({
    implants,
    selectedImplantId,
    onSelectImplant,
    isPlacingImplant,
    onTogglePlacingImplant,
    defaultDiameter,
    setDefaultDiameter,
    defaultLength,
    setDefaultLength,
    onUpdateImplant,
    onDeleteImplant,
    onJumpToImplant,
    nervePoints3D,
    disabled,
}: ImplantPlannerPopoverProps) {
    const [open, setOpen] = useState(false)
    const selected = implants.find((i) => i.id === selectedImplantId) || implants[implants.length - 1] || null
    const hasAnyDanger = implants.some((imp) => {
        const d = computeImplantNerveDistanceMm(imp, nervePoints3D)
        return d !== null && d < imp.safetyMarginMm
    })

    return (
        <div className="relative">
            <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                className={`h-7 px-2 text-[11px] gap-1 rounded-lg border ${
                    hasAnyDanger
                        ? "border-rose-500/70 bg-rose-950/70 text-rose-200 animate-pulse"
                        : isPlacingImplant || implants.length > 0
                        ? "border-indigo-500/60 bg-indigo-950/70 text-indigo-200"
                        : "border-slate-800 bg-slate-950/90 text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
                title="Simulador de Implantes Virtuales 3D con margen de seguridad al Nervio Dentario"
            >
                <Crosshair className="h-3 w-3 text-indigo-400" />
                <span className="hidden lg:inline">Implante</span>
                {implants.length > 0 && <span className="font-mono text-[10px] font-bold">({implants.length})</span>}
            </Button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 mt-1.5 w-80 rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur-xl shadow-2xl p-3 z-50 text-xs space-y-2.5">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                            <span className="font-bold text-white flex items-center gap-1.5">
                                <Crosshair className="h-3.5 w-3.5 text-indigo-400" />
                                Planificador de Implantes 3D
                            </span>
                            <Button
                                size="sm"
                                onClick={() => {
                                    onTogglePlacingImplant()
                                    if (!isPlacingImplant) setOpen(false)
                                }}
                                className={`h-6 px-2 text-[10px] font-semibold ${
                                    isPlacingImplant
                                        ? "bg-rose-600 hover:bg-rose-700 text-white"
                                        : "bg-indigo-600 hover:bg-indigo-700 text-white"
                                }`}
                            >
                                {isPlacingImplant ? "Cancelar" : "+ Colocar en corte"}
                            </Button>
                        </div>

                        {/* Medidas por defecto del siguiente implante */}
                        <div className="grid grid-cols-2 gap-2 bg-slate-950/70 p-2 rounded-lg border border-slate-800">
                            <div>
                                <label className="text-[9px] text-slate-400 block mb-0.5">Diámetro (Ø mm)</label>
                                <select
                                    value={defaultDiameter}
                                    onChange={(e) => {
                                        const v = parseFloat(e.target.value)
                                        setDefaultDiameter(v)
                                        if (selected) onUpdateImplant(selected.id, { diameterMm: v })
                                    }}
                                    className="w-full h-6 px-1.5 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono text-white"
                                >
                                    {[3.0, 3.3, 3.5, 3.75, 4.0, 4.2, 4.5, 5.0, 5.5, 6.0].map((d) => (
                                        <option key={d} value={d}>
                                            Ø {d.toFixed(2)} mm
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[9px] text-slate-400 block mb-0.5">Longitud (L mm)</label>
                                <select
                                    value={defaultLength}
                                    onChange={(e) => {
                                        const v = parseFloat(e.target.value)
                                        setDefaultLength(v)
                                        if (selected) onUpdateImplant(selected.id, { lengthMm: v })
                                    }}
                                    className="w-full h-6 px-1.5 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono text-white"
                                >
                                    {[6.0, 7.0, 8.0, 8.5, 10.0, 11.5, 13.0, 15.0, 16.0].map((l) => (
                                        <option key={l} value={l}>
                                            L {l.toFixed(1)} mm
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Lista de implantes colocados con alerta de proximidad al nervio */}
                        {implants.length === 0 ? (
                            <p className="text-[10px] text-slate-400 text-center py-2">
                                Pulse <strong>+ Colocar en corte</strong> y haga clic sobre la cresta ósea en Transversal o Tangencial.
                            </p>
                        ) : (
                            <div className="max-h-44 overflow-y-auto space-y-1.5">
                                {implants.map((imp) => {
                                    const dist = computeImplantNerveDistanceMm(imp, nervePoints3D)
                                    const danger = dist !== null && dist < imp.safetyMarginMm
                                    const isSel = selected?.id === imp.id
                                    return (
                                        <div
                                            key={imp.id}
                                            className={`p-2 rounded-lg border transition-colors ${
                                                danger
                                                    ? "bg-rose-950/40 border-rose-500/60"
                                                    : isSel
                                                    ? "bg-indigo-950/50 border-indigo-500/60"
                                                    : "bg-slate-950/80 border-slate-800"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onSelectImplant(imp.id)
                                                        onJumpToImplant(imp)
                                                    }}
                                                    className="flex items-center gap-1 text-left font-semibold text-white min-w-0 flex-1"
                                                >
                                                    <Navigation className="h-3 w-3 text-indigo-400 shrink-0" />
                                                    <span className="truncate">{imp.label}</span>
                                                    <span className="font-mono text-[10px] text-cyan-300 shrink-0">
                                                        Ø{imp.diameterMm.toFixed(1)}×{imp.lengthMm.toFixed(0)}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteImplant(imp.id)}
                                                    className="p-0.5 text-slate-500 hover:text-rose-400"
                                                    title="Eliminar implante"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>

                                            <div className="mt-1 flex items-center justify-between text-[10px]">
                                                {dist === null ? (
                                                    <span className="text-slate-400">
                                                        Trace el Nervio para verificar margen de {imp.safetyMarginMm} mm
                                                    </span>
                                                ) : danger ? (
                                                    <span className="text-rose-300 font-semibold flex items-center gap-1">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        ¡Alerta! Nervio a {dist.toFixed(1)} mm (&lt; {imp.safetyMarginMm} mm)
                                                    </span>
                                                ) : (
                                                    <span className="text-emerald-300 flex items-center gap-1">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        Seguro · Nervio a {dist.toFixed(1)} mm
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
