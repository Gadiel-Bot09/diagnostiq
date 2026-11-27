/**
 * Modelo de datos para persistencia de Escenas Clínicas CBCT y Cortes Específicos Preparados (Fase 4 + Mejoras #1-#5).
 */

import type { ArchPoint, ReorientationEuler, SlabMode, Vec3, WindowLevel, WlPresetId } from "./mprEngine"
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

export type ArchJawType = "upper" | "lower"

/** Implante dental virtual calibrado en coordenadas 3D del volumen (mm) */
export interface VirtualImplant {
    id: string
    label: string
    /** Posición 3D (mm) de la plataforma coronal del implante */
    platform3D: Vec3
    /** Vector unitario desde plataforma hacia ápice del implante */
    axis3D: Vec3
    /** Diámetro en mm (típicamente 3.0 - 6.0 mm) */
    diameterMm: number
    /** Longitud en mm (típicamente 6.0 - 16.0 mm) */
    lengthMm: number
    /** Margen de seguridad periapical en mm (estándar clínico: 2.0 mm) */
    safetyMarginMm: number
    /** Inclinación buco-lingual en grados respecto al eje vertical */
    buccoLingualDeg: number
    /** Inclinación mesio-distal en grados respecto al eje vertical */
    mesioDistalDeg: number
    /** Posición de arco aproximada donde se colocó (para salto rápido) */
    archS: number
}

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
    /** Doble arco independiente (Maxilar Superior y Mandíbula) */
    activeArchJaw?: ArchJawType
    upperArchCtrlPts?: ArchPoint[]
    lowerArchCtrlPts?: ArchPoint[]
    /** Reorientación 3D del plano oclusal (Pitch / Roll / Yaw) */
    reorientation?: ReorientationEuler
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
    /** Implantes virtuales planificados con margen de seguridad */
    implants?: VirtualImplant[]
    measurementsByView: Record<string, ClinicalMeasurement[]>
    savedCuts: SavedClinicalCut[]
}

/** Calcula la distancia mínima en mm desde un implante virtual (eje + radio) hasta los puntos del canal mandibular */
export function computeImplantNerveDistanceMm(
    implant: VirtualImplant,
    nervePoints3D: Vec3[]
): number | null {
    if (nervePoints3D.length === 0) return null
    const p0 = implant.platform3D
    const dir = implant.axis3D
    const L = implant.lengthMm
    const radius = implant.diameterMm * 0.5
    let minCenterDist = Infinity

    for (const pt of nervePoints3D) {
        const vx = pt[0] - p0[0]
        const vy = pt[1] - p0[1]
        const vz = pt[2] - p0[2]
        const t = Math.max(0, Math.min(L, vx * dir[0] + vy * dir[1] + vz * dir[2]))
        const cx = p0[0] + dir[0] * t
        const cy = p0[1] + dir[1] * t
        const cz = p0[2] + dir[2] * t
        const d = Math.hypot(pt[0] - cx, pt[1] - cy, pt[2] - cz)
        if (d < minCenterDist) minCenterDist = d
    }

    if (!Number.isFinite(minCenterDist)) return null
    return Math.max(0, minCenterDist - radius)
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
