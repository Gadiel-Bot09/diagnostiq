"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { FileText, Image as ImageIcon, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Layers } from "lucide-react"
import type {
    ClinicalSheetAttachment,
    SecondaryDicomSeries,
    VolumetricSeries,
} from "@/lib/cbct/dicomSeriesExtractor"

export interface StudyCutsGalleryProps {
    volumetricSeries: VolumetricSeries[]
    activeVolumeId: string
    onSelectVolume: (id: string) => void
    secondarySeries: SecondaryDicomSeries[]
    clinicalSheets: ClinicalSheetAttachment[]
    onBackTo3D: () => void
}

/**
 * Explorador nativo de "Cortes del Estudio":
 * Muestra tal cual fueron generados por el tomógrafo o radiólogo:
 *  - Todas las series DICOM secundarias (cortes específicos, panorámicas exportadas, capturas SC/DERIVED/PX/DX).
 *  - Láminas de cortes e informes PDF/JPG/PNG adjuntos dentro del paquete tomográfico.
 *  - Selector entre múltiples volúmenes 3D CBCT si el estudio contiene más de uno.
 */
export function StudyCutsGallery({
    volumetricSeries,
    activeVolumeId,
    onSelectVolume,
    secondarySeries,
    clinicalSheets,
    onBackTo3D,
}: StudyCutsGalleryProps) {
    type SelectedItem =
        | { kind: "dicom"; seriesId: string }
        | { kind: "sheet"; sheetId: string }
        | null

    const initialSelection: SelectedItem =
        secondarySeries.length > 0
            ? { kind: "dicom", seriesId: secondarySeries[0].id }
            : clinicalSheets.length > 0
            ? { kind: "sheet", sheetId: clinicalSheets[0].id }
            : null

    const [selected, setSelected] = useState<SelectedItem>(initialSelection)
    const [frameIdx, setFrameIdx] = useState<number>(0)
    const [zoom, setZoom] = useState<number>(1)

    const activeDicom =
        selected?.kind === "dicom"
            ? secondarySeries.find((s) => s.id === selected.seriesId) ?? null
            : null

    const activeSheet =
        selected?.kind === "sheet"
            ? clinicalSheets.find((s) => s.id === selected.sheetId) ?? null
            : null

    const totalExtraItems = secondarySeries.length + clinicalSheets.length

    return (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 p-2 bg-[#03060c] overflow-hidden">
            {/* Sidebar de Series y Láminas del Estudio */}
            <div className="w-full md:w-72 shrink-0 bg-slate-900/95 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-cyan-400" />
                        Series del Estudio ({volumetricSeries.length + totalExtraItems})
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-3">
                    {/* Bloque 1: Volúmenes 3D CBCT */}
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1 mb-1">
                            Volúmenes CBCT 3D ({volumetricSeries.length})
                        </p>
                        <div className="space-y-1">
                            {volumetricSeries.map((vs) => {
                                const isActive = vs.id === activeVolumeId
                                return (
                                    <button
                                        key={vs.id}
                                        type="button"
                                        onClick={() => {
                                            onSelectVolume(vs.id)
                                            onBackTo3D()
                                        }}
                                        className={`w-full text-left p-2 rounded-md border transition-colors ${
                                            isActive
                                                ? "bg-blue-600/20 border-blue-500/50 text-white"
                                                : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[11px] font-semibold truncate">
                                                {vs.seriesDescription}
                                            </span>
                                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-blue-500/20 text-blue-300 shrink-0">
                                                {vs.modality}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                            {vs.calibration.matrixDims.join("×")} ·{" "}
                                            {vs.calibration.sx.toFixed(2)} mm
                                        </div>
                                        <div className="text-[9px] text-cyan-300 mt-1">
                                            Clic para abrir en 5 Vistas / InVivo MPR →
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Bloque 2: Series DICOM Secundarias / Cortes Específicos */}
                    {secondarySeries.length > 0 && (
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 px-1 mb-1">
                                Cortes Específicos DICOM ({secondarySeries.length})
                            </p>
                            <div className="space-y-1">
                                {secondarySeries.map((s) => {
                                    const isSel = selected?.kind === "dicom" && selected.seriesId === s.id
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => {
                                                setSelected({ kind: "dicom", seriesId: s.id })
                                                setFrameIdx(0)
                                                setZoom(1)
                                            }}
                                            className={`w-full text-left p-2 rounded-md border flex items-center gap-2 transition-colors ${
                                                isSel
                                                    ? "bg-emerald-600/20 border-emerald-500/60 text-white"
                                                    : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                                            }`}
                                        >
                                            {s.dataUrls[0] && (
                                                <img
                                                    src={s.dataUrls[0]}
                                                    alt={s.seriesDescription}
                                                    className="w-11 h-11 rounded object-cover border border-slate-700 bg-black shrink-0"
                                                />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[11px] font-semibold truncate">
                                                    {s.seriesDescription}
                                                </div>
                                                <div className="text-[9px] text-slate-400 font-mono">
                                                    {s.modality} · {s.frameCount} corte(s) · {s.width}×{s.height}
                                                </div>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Bloque 3: Láminas e Informes Clínicos (PDF/JPG/PNG) */}
                    {clinicalSheets.length > 0 && (
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 px-1 mb-1">
                                Láminas / Informes del Estudio ({clinicalSheets.length})
                            </p>
                            <div className="space-y-1">
                                {clinicalSheets.map((sh) => {
                                    const isSel = selected?.kind === "sheet" && selected.sheetId === sh.id
                                    return (
                                        <button
                                            key={sh.id}
                                            type="button"
                                            onClick={() => {
                                                setSelected({ kind: "sheet", sheetId: sh.id })
                                                setZoom(1)
                                            }}
                                            className={`w-full text-left p-2 rounded-md border flex items-center gap-2 transition-colors ${
                                                isSel
                                                    ? "bg-amber-600/20 border-amber-500/60 text-white"
                                                    : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                                            }`}
                                        >
                                            <div className="w-8 h-8 rounded bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0">
                                                {sh.kind === "pdf" ? (
                                                    <FileText className="h-4 w-4 text-rose-400" />
                                                ) : (
                                                    <ImageIcon className="h-4 w-4 text-amber-300" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[11px] font-medium truncate">{sh.name}</div>
                                                <div className="text-[9px] text-slate-400 uppercase">{sh.kind}</div>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Área Principal de Visualización de Cortes Específicos / Láminas */}
            <div className="flex-1 min-w-0 min-h-0 bg-slate-950 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
                {activeDicom ? (
                    <>
                        <div className="px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold text-[10px]">
                                    {activeDicom.modality}
                                </span>
                                <span className="font-semibold text-white truncate">
                                    {activeDicom.seriesDescription}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                                    ({activeDicom.width}×{activeDicom.height} px)
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                {activeDicom.frameCount > 1 && (
                                    <div className="flex items-center gap-1 mr-2 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 text-slate-300"
                                            onClick={() => setFrameIdx((i) => Math.max(0, i - 1))}
                                            disabled={frameIdx === 0}
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </Button>
                                        <span className="text-[10px] font-mono text-cyan-300">
                                            {frameIdx + 1} / {activeDicom.frameCount}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 text-slate-300"
                                            onClick={() =>
                                                setFrameIdx((i) => Math.min(activeDicom.frameCount - 1, i + 1))
                                            }
                                            disabled={frameIdx >= activeDicom.frameCount - 1}
                                        >
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                )}
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom((z) => Math.min(4, z * 1.2))}>
                                    <ZoomIn className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}>
                                    <ZoomOut className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(1)}>
                                    <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto flex items-center justify-center p-3 bg-black">
                            <img
                                src={activeDicom.dataUrls[Math.min(frameIdx, activeDicom.dataUrls.length - 1)]}
                                alt={activeDicom.seriesDescription}
                                style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
                                className="max-w-full max-h-full object-contain transition-transform duration-150"
                            />
                        </div>
                    </>
                ) : activeSheet ? (
                    <>
                        <div className="px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between text-xs">
                            <span className="font-semibold text-white truncate">{activeSheet.name}</span>
                            {activeSheet.kind === "image" && (
                                <div className="flex items-center gap-1">
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom((z) => Math.min(4, z * 1.2))}>
                                        <ZoomIn className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}>
                                        <ZoomOut className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(1)}>
                                        <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-auto">
                            {activeSheet.kind === "pdf" ? (
                                <iframe
                                    src={activeSheet.url}
                                    title={activeSheet.name}
                                    className="w-full h-full border-0 bg-white"
                                />
                            ) : (
                                <img
                                    src={activeSheet.url}
                                    alt={activeSheet.name}
                                    style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
                                    className="max-w-full max-h-full object-contain p-2 transition-transform duration-150"
                                />
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-2">
                        <Layers className="h-8 w-8 text-slate-600" />
                        <p className="text-sm font-medium text-slate-300">
                            Este paquete solo contiene el volumen CBCT 3D principal
                        </p>
                        <p className="text-xs text-slate-500 max-w-md">
                            No se encontraron series secundarias DICOM ni láminas PDF/JPG adicionales dentro del archivo.
                            Puede explorar cualquier corte anatómico exacto en el modo <strong>GALILEOS (5 Vistas)</strong>,{" "}
                            <strong>InVivo MPR</strong> o <strong>Cortes Seriados</strong>.
                        </p>
                        <Button size="sm" onClick={onBackTo3D} className="mt-2 bg-blue-600 hover:bg-blue-700 text-white">
                            Volver a la Reconstrucción 3D / MPR
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
