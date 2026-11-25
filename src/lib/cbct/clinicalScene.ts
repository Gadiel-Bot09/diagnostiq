/**
 * Modelo de datos para persistencia de Escenas Clínicas CBCT y Cortes Específicos Preparados (Fase 4).
 *
 * Permite guardar por archivo tomográfico (`result_files.metadata_json.cbct_scene`):
 *  - La curva del arco dental ajustada manualmente sobre el corte Axial.
 *  - Los cortes específicos marcados por el radiólogo/especialista (ej. "Pieza 11 - Raíz", "Implante 36").
 *  - El trazado 3D del Nervio Alveolar Inferior (canal mandibular).
 *  - Todas las mediciones calibradas (reglas, ángulos y polilíneas) ancladas a cada corte.
 *  - La orientación, inclinación de planos, grosor MPR, brillo/contraste y vista inicial.
 */

import type { ArchPoint, SlabMode, Vec3, WindowLevel, WlPresetId } from "./mprEngine"
import type { ClinicalMeasurement } from "@/components/common/MprViewport"

export type PersistedWorkspace =
    | "multi"
    | "panorama"
    | "3d"
    | "tangential"
    | "cross"
    | "axial"
    | "invivo_mpr"
    | "invivo_serial"

export interface SavedClinicalCut {
    id: string
    name: string
    note?: string
    workspace: PersistedWorkspace
    archS: number
    archD: number
    axialH: number
    sagittalX: number
    coronalY: number
    tangentialMode: "flat" | "curved"
    tangentialTiltDeg: number
    crossTiltDeg: number
    serialSpacingMm: number
    createdAt: string
    createdBy?: string
}

export interface CbctClinicalScene {
    version: 1
    updatedAt: string
    updatedById?: string
    updatedByName?: string
    updatedByRole?: string
    defaultWorkspace: PersistedWorkspace
    archCtrlPts: ArchPoint[]
    activeCoords: {
        archS: number
        archD: number
        axialH: number
        sagittalX: number
        coronalY: number
    }
    sliceSettings: {
        panoThickness: number
        panoMode: "mean" | "mip"
        mprSlabMm: number
        invivoSlabMode: SlabMode
        tangentialMode: "flat" | "curved"
        tangentialTiltDeg: number
        crossTiltDeg: number
        serialSpacingMm: number
    }
    windowLevel: {
        sliceWl: WindowLevel
        panoWl: WindowLevel
        activeWlPreset: WlPresetId
    }
    nervePoints3D: Vec3[]
    measurementsByView: Record<string, ClinicalMeasurement[]>
    savedCuts: SavedClinicalCut[]
}

export function isValidCbctScene(raw: unknown): raw is CbctClinicalScene {
    if (!raw || typeof raw !== "object") return false
    const obj = raw as Record<string, unknown>
    if (obj.version !== 1) return false
    if (!obj.activeCoords || typeof obj.activeCoords !== "object") return false
    if (!Array.isArray(obj.savedCuts)) return false
    if (!Array.isArray(obj.nervePoints3D)) return false
    if (!obj.measurementsByView || typeof obj.measurementsByView !== "object") return false
    return true
}
