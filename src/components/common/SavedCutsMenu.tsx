"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Bookmark, BookmarkPlus, Save, Trash2, Check, Loader2, Navigation } from "lucide-react"
import type { SavedClinicalCut } from "@/lib/cbct/clinicalScene"

export interface SavedCutsMenuProps {
    savedCuts: SavedClinicalCut[]
    canEdit: boolean
    isSaving: boolean
    saveFeedback: "idle" | "saved" | "error"
    saveErrorMsg?: string | null
    hasUnsavedChanges: boolean
    suggestedCutName: string
    lastSavedBy?: string
    lastSavedAt?: string
    onAddCurrentCut: (name: string, note: string) => void
    onApplyCut: (cut: SavedClinicalCut) => void
    onDeleteCut: (id: string) => void
    onSaveScene: () => void
}

const WORKSPACE_BADGE: Record<string, string> = {
    multi: "GALILEOS 5V",
    invivo_mpr: "InVivo MPR",
    invivo_serial: "Seriados 6×",
    panorama: "Panorama",
    tangential: "Tangencial",
    cross: "Transversal",
    axial: "Axial",
    "3d": "3D",
}

/**
 * Menú de "Cortes Preparados" y botón de "Guardar Escena Clínica" (Fase 4).
 * Permite al radiólogo/especialista marcar cortes específicos (ej. "Pieza 11 - Raíz")
 * y guardar toda la escena (arco dental, nervio dentario, mediciones y cortes) en Supabase.
 */
export function SavedCutsMenu({
    savedCuts,
    canEdit,
    isSaving,
    saveFeedback,
    saveErrorMsg,
    hasUnsavedChanges,
    suggestedCutName,
    lastSavedBy,
    lastSavedAt,
    onAddCurrentCut,
    onApplyCut,
    onDeleteCut,
    onSaveScene,
}: SavedCutsMenuProps) {
    const [menuOpen, setMenuOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [newNote, setNewNote] = useState("")

    const handleCreateCut = (e: React.FormEvent) => {
        e.preventDefault()
        const finalName = newName.trim() || suggestedCutName
        onAddCurrentCut(finalName, newNote.trim())
        setNewName("")
        setNewNote("")
    }

    return (
        <div className="flex items-center gap-1 shrink-0">
            {/* Botón y Popover de Cortes Preparados */}
            <div className="relative">
                <Button
                    size="sm"
                    variant="outline"
                    className={`h-7 px-2 text-[11px] gap-1 rounded-lg border ${
                        savedCuts.length > 0
                            ? "border-sky-500/50 bg-sky-950/60 text-sky-200 hover:bg-sky-900/70"
                            : "border-slate-800 bg-slate-950/90 text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                    onClick={() => setMenuOpen((v) => !v)}
                    title="Cortes específicos preparados para este paciente (clic para ver o marcar corte actual)"
                >
                    <Bookmark className="h-3 w-3 text-sky-400" />
                    <span className="hidden lg:inline">Cortes</span>
                    <span className="font-mono text-[10px] font-bold text-sky-300">({savedCuts.length})</span>
                </Button>

                {menuOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 mt-1.5 w-80 rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur-xl shadow-2xl p-3 z-50 text-xs space-y-2.5">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                                <span className="font-bold text-white flex items-center gap-1.5">
                                    <Bookmark className="h-3.5 w-3.5 text-sky-400" />
                                    Cortes Específicos ({savedCuts.length})
                                </span>
                                {lastSavedBy && (
                                    <span className="text-[9px] text-slate-400 truncate max-w-[130px]" title={`Guardado por ${lastSavedBy}`}>
                                        Por: {lastSavedBy}
                                    </span>
                                )}
                            </div>

                            {/* Lista de cortes preparados */}
                            {savedCuts.length === 0 ? (
                                <p className="text-[11px] text-slate-400 py-2 text-center">
                                    {canEdit
                                        ? "Aún no hay cortes marcados. Posicione el visor en una pieza o hallazgo y márquelo abajo."
                                        : "No hay cortes específicos marcados para este estudio."}
                                </p>
                            ) : (
                                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5">
                                    {savedCuts.map((cut, idx) => (
                                        <div
                                            key={cut.id}
                                            className="flex items-start justify-between gap-1.5 p-2 rounded-lg bg-slate-950/85 border border-slate-800 hover:border-sky-500/50 transition-colors"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onApplyCut(cut)
                                                    setMenuOpen(false)
                                                }}
                                                className="flex-1 text-left min-w-0"
                                                title="Clic para abrir exactamente este corte preparado"
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <Navigation className="h-3 w-3 text-sky-400 shrink-0" />
                                                    <span className="font-semibold text-white truncate">
                                                        {idx + 1}. {cut.name}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-0.5 text-[9px] font-mono text-slate-400">
                                                    <span className="px-1 py-0 rounded bg-slate-800 text-sky-300">
                                                        {WORKSPACE_BADGE[cut.workspace] || cut.workspace}
                                                    </span>
                                                    <span>Arco {cut.archS.toFixed(1)}mm</span>
                                                    <span>H {cut.axialH.toFixed(1)}mm</span>
                                                </div>
                                                {cut.note && (
                                                    <p className="text-[10px] text-slate-300 mt-1 line-clamp-2">
                                                        {cut.note}
                                                    </p>
                                                )}
                                            </button>

                                            {canEdit && (
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteCut(cut.id)}
                                                    className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                                                    title="Quitar corte marcado"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Formulario para marcar el corte actual (solo staff/doctores) */}
                            {canEdit && (
                                <form onSubmit={handleCreateCut} className="border-t border-slate-800 pt-2 space-y-1.5">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                        Marcar corte actual
                                    </div>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        placeholder={suggestedCutName}
                                        className="w-full h-7 px-2 rounded-md bg-slate-950 border border-slate-700 text-[11px] text-white placeholder:text-slate-500 focus:outline-hidden focus:border-sky-500"
                                    />
                                    <input
                                        type="text"
                                        value={newNote}
                                        onChange={(e) => setNewNote(e.target.value)}
                                        placeholder="Nota clínica opcional (ej. raíz vestibular, nervio a 2.5mm)"
                                        className="w-full h-7 px-2 rounded-md bg-slate-950 border border-slate-700 text-[11px] text-white placeholder:text-slate-500 focus:outline-hidden focus:border-sky-500"
                                    />
                                    <Button
                                        type="submit"
                                        size="sm"
                                        className="w-full h-7 text-[11px] gap-1.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold"
                                    >
                                        <BookmarkPlus className="h-3.5 w-3.5" />
                                        Añadir corte a la escena
                                    </Button>
                                </form>
                            )}

                            {lastSavedAt && (
                                <div className="text-[9px] text-slate-500 text-right font-mono pt-0.5">
                                    Último guardado: {new Date(lastSavedAt).toLocaleString()}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Botón Guardar Escena en Base de Datos (solo para personal clínico/laboratorio autorizado) */}
            {canEdit && (
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={isSaving}
                    onClick={onSaveScene}
                    className={`h-7 px-2 text-[11px] gap-1 font-semibold rounded-lg transition-all ${
                        saveFeedback === "saved"
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : saveFeedback === "error"
                            ? "bg-rose-600 hover:bg-rose-700 text-white"
                            : hasUnsavedChanges
                            ? "bg-sky-600 hover:bg-sky-700 text-white shadow-sm shadow-sky-500/30"
                            : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                    }`}
                    title={
                        saveErrorMsg ||
                        "Guardar en la orden: cortes marcados, curva del arco ajustada, nervio dentario y mediciones"
                    }
                >
                    {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : saveFeedback === "saved" ? (
                        <Check className="h-3 w-3" />
                    ) : (
                        <Save className="h-3 w-3" />
                    )}
                    <span className="hidden sm:inline">
                        {isSaving
                            ? "Guardando..."
                            : saveFeedback === "saved"
                            ? "Guardado"
                            : hasUnsavedChanges
                            ? "Guardar*"
                            : "Guardar"}
                    </span>
                </Button>
            )}
        </div>
    )
}
