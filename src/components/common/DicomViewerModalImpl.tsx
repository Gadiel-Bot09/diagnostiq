"use client"

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
    Loader2,
    ZoomIn,
    ZoomOut,
    Sun,
    Ruler,
    Download,
    Layers,
    RotateCcw,
    X,
    AlertCircle,
    Play,
    Pause,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Maximize2,
    Minimize2,
    Move,
    Sparkles,
    Palette,
    Trash2,
    LayoutGrid,
    SlidersHorizontal,
    ChevronDown,
    Check,
    Compass,
    ShieldCheck,
    AlertTriangle,
    Spline,
    Activity,
    Grid2X2,
    Columns3,
    FolderOpen,
    ListChecks,
} from "lucide-react"
import JSZip from "jszip"
import { Dental3DViewer, type VolumeFocus } from "./Dental3DViewer"
import {
    MprViewport,
    getMeasurementSummaryValue,
    type ActiveClinicalTool,
    type ClinicalColorMap,
    type ClinicalMeasurement,
    type ViewportOverlayContext,
} from "./MprViewport"
import { StudyCutsGallery } from "./StudyCutsGallery"
import { InVivoMprWorkspace, InVivoArchSerialWorkspace } from "./InVivoWorkspaces"
import { SavedCutsMenu } from "./SavedCutsMenu"
import type {
    CbctClinicalScene,
    PersistedWorkspace,
    SavedClinicalCut,
} from "@/lib/cbct/clinicalScene"
import {
    buildRenderVolume,
    detectDentalArch,
    type RenderVolume,
} from "@/lib/cbctReconstruction"
import {
    extractAllStudySeries,
    type CalibrationAudit,
    type ClinicalSheetAttachment,
    type SecondaryDicomSeries,
    type VolumetricSeries,
} from "@/lib/cbct/dicomSeriesExtractor"
import {
    createClinicalVolume,
    buildArch,
    archFrame,
    projectToArch,
    archControlPointsFromDetection,
    axialPlane,
    crossPlane,
    tangentialPlane,
    renderTangentialSection,
    renderPlane,
    renderPanorama,
    presetWindow,
    imageQuantile,
    sliceIndexFromH,
    zFromH,
    hFromZ,
    projectWorldPointToPlane,
    type ClinicalVolume,
    type ArchModel,
    type ArchPoint,
    type PanoramaImage,
    type WindowLevel,
    type WlPresetId,
    type SlabMode,
    type Vec3,
} from "@/lib/cbct/mprEngine"
import {
    detectArchiveFormat,
    isDicomSliceEntry,
    isClinicalSheetEntry,
    extractDicomFilesFromRar,
} from "@/lib/dicomZipCleaner"

export interface DicomViewerModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    zipUrl: string | null
    downloadUrl?: string
    subtitle?: string
    /** ID del archivo en `result_files` para cargar y persistir cortes preparados, arco, nervio y mediciones */
    resultFileId?: string | null
}

export type ViewMode =
    | "multi"
    | "panorama"
    | "3d"
    | "tangential"
    | "cross"
    | "axial"
    | "invivo_mpr"
    | "invivo_serial"
    | "study_cuts"

type FocusPlane = "axial" | "cross" | "tangential"

const TANGENTIAL_HALF_WIDTH_MM = 21 // Ventana mesio-distal de 42 mm (aprox. 4-5 piezas dentales)
const CROSS_HALF_WIDTH_MM = 18 // Ventana buco-lingual de 36 mm (oral <-> labial/bucal)
const SLICE_WINDOW_HEIGHT_MM = 35 // Altura vertical de la "Ventana de cortes" estilo Sirona GALILEOS
const MAX_ARCH_OFFSET_D_MM = 12 // Rango de desplazamiento tangencial buco-lingual (-12 a +12 mm)

function getDentalSectorLabel(normPos: number): string {
    if (normPos < 0.18) return "Sector Molar Derecho (Piezas 18-16 / 48-46)"
    if (normPos < 0.34) return "Sector Premolar / Canino Der. (15-13 / 45-43)"
    if (normPos <= 0.66) return "Sector Anterior / Incisivos (12-22 / 42-32)"
    if (normPos <= 0.82) return "Sector Premolar / Canino Izq. (23-25 / 33-35)"
    return "Sector Molar Izquierdo (Piezas 26-28 / 36-38)"
}

export function DicomViewerModalImpl({
    open,
    onOpenChange,
    title,
    zipUrl,
    downloadUrl,
    resultFileId,
}: DicomViewerModalProps) {
    const hiddenLoaderRef = useRef<HTMLDivElement>(null)
    const dwvAppRef = useRef<any>(null)
    const objectUrlsRef = useRef<string[]>([])
    const pendingSceneRef = useRef<CbctClinicalScene | null>(null)
    const sceneAppliedRef = useRef<boolean>(false)

    // Estado de persistencia clínica (Fase 4: Cortes específicos preparados + Escena CBCT en Supabase)
    const [savedCuts, setSavedCuts] = useState<SavedClinicalCut[]>([])
    const [canEditScene, setCanEditScene] = useState<boolean>(false)
    const [sceneMeta, setSceneMeta] = useState<{ updatedByName?: string; updatedAt?: string } | null>(null)
    const [isSavingScene, setIsSavingScene] = useState<boolean>(false)
    const [saveFeedback, setSaveFeedback] = useState<"idle" | "saved" | "error">("idle")
    const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null)
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false)
    const [activeCutId, setActiveCutId] = useState<string | null>(null)

    // Estado de carga del estudio
    const [loading, setLoading] = useState(true)
    const [loadStep, setLoadStep] = useState("Conectando con almacenamiento seguro...")
    const [loadProgress, setLoadProgress] = useState(0)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [reconStatus, setReconStatus] = useState<string>("Preparando reconstrucción volumétrica...")

    // Series multi-serie descubiertas en el estudio (Volúmenes 3D + Cortes Específicos DICOM + Láminas)
    const [volumetricSeriesList, setVolumetricSeriesList] = useState<VolumetricSeries[]>([])
    const [activeVolumeId, setActiveVolumeId] = useState<string>("")
    const [secondarySeriesList, setSecondarySeriesList] = useState<SecondaryDicomSeries[]>([])
    const [clinicalSheets, setClinicalSheets] = useState<ClinicalSheetAttachment[]>([])
    const [calibrationAudit, setCalibrationAudit] = useState<CalibrationAudit | null>(null)

    // Modos de vista y herramientas clínicas
    const [viewMode, setViewMode] = useState<ViewMode>("multi")
    const [focusedPlane, setFocusedPlane] = useState<FocusPlane>("axial")
    const [activeTool, setActiveTool] = useState<ActiveClinicalTool>("navigate")
    const [activeWlPreset, setActiveWlPreset] = useState<WlPresetId>("auto")
    const [activeColorMap, setActiveColorMap] = useState<ClinicalColorMap>("plain")
    const [sharpenEnabled, setSharpenEnabled] = useState<boolean>(true)
    const [filtersMenuOpen, setFiltersMenuOpen] = useState(false)
    const [calibrationMenuOpen, setCalibrationMenuOpen] = useState(false)
    const [measuresMenuOpen, setMeasuresMenuOpen] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [resetTrigger, setResetTrigger] = useState(0)
    const [externalZoomStep, setExternalZoomStep] = useState(0)

    // Volúmenes y modelo matemático del arco dental
    const [clinicalVol, setClinicalVol] = useState<ClinicalVolume | null>(null)
    const [renderVolume, setRenderVolume] = useState<RenderVolume | null>(null)
    const [archCtrlPts, setArchCtrlPts] = useState<ArchPoint[]>([])
    const [initialArchCtrlPts, setInitialArchCtrlPts] = useState<ArchPoint[]>([])
    const [panoramaImage, setPanoramaImage] = useState<PanoramaImage | null>(null)

    // Modelo spline del arco derivado en vivo de archCtrlPts (permite edición interactiva en Axial)
    const archModel = useMemo<ArchModel | null>(() => {
        if (archCtrlPts.length < 3) return null
        return buildArch(archCtrlPts)
    }, [archCtrlPts])

    // Parámetros de reconstrucción panorámica, GALILEOS e InVivo
    const [panoThickness, setPanoThickness] = useState<number>(18)
    const [panoMode, setPanoMode] = useState<"mean" | "mip">("mean")
    const [mprSlabMm, setMprSlabMm] = useState<number>(1.6)
    const [invivoSlabMode, setInvivoSlabMode] = useState<SlabMode>("mean")
    const [tangentialMode, setTangentialMode] = useState<"flat" | "curved">("flat")
    const [tangentialTiltDeg, setTangentialTiltDeg] = useState<number>(0)
    const [crossTiltDeg, setCrossTiltDeg] = useState<number>(0)
    const [serialSpacingMm, setSerialSpacingMm] = useState<number>(1.5)

    // Coordenadas clínicas 3D sincronizadas (en milímetros reales LPS)
    const [archS, setArchS] = useState<number>(50)
    const [archD, setArchD] = useState<number>(0)
    const [axialH, setAxialH] = useState<number>(22)
    const [dentalBaseH, setDentalBaseH] = useState<number>(22)
    const [sagittalX, setSagittalX] = useState<number>(40)
    const [coronalY, setCoronalY] = useState<number>(40)

    // Trazado del Nervio Alveolar Inferior (coordenadas 3D mundo en mm)
    const [nervePoints3D, setNervePoints3D] = useState<Vec3[]>([])

    // Ventanas de brillo/contraste independientes para cortes MPR y para la Panorámica CPR
    const [sliceWl, setSliceWl] = useState<WindowLevel>({ center: 800, width: 2200 })
    const [panoWl, setPanoWl] = useState<WindowLevel>({ center: 900, width: 2000 })

    // Mediciones calibradas por cada vista (ancladas a cada corte real)
    const [measurementsByView, setMeasurementsByView] = useState<Record<string, ClinicalMeasurement[]>>({
        panorama: [],
        tangential: [],
        cross: [],
        axial: [],
        coronal: [],
        sagittal: [],
    })

    const allMeasurementsFlat = useMemo(() => {
        const list: { viewKey: string; viewTitle: string; m: ClinicalMeasurement }[] = []
        const labels: Record<string, string> = {
            panorama: "Panorama",
            tangential: "Tangencial",
            cross: "Transversal",
            axial: "Axial",
            coronal: "Coronal",
            sagittal: "Sagital",
        }
        for (const [vk, arr] of Object.entries(measurementsByView)) {
            for (const m of arr) {
                list.push({ viewKey: vk, viewTitle: labels[vk] || vk, m })
            }
        }
        return list
    }, [measurementsByView])

    const totalMeasurementsCount = allMeasurementsFlat.length
    const isEstimatedCalibration = calibrationAudit?.status === "estimated_isotropic"

    const updateViewMeasurements = useCallback((viewKey: string, next: ClinicalMeasurement[]) => {
        setMeasurementsByView((prev) => ({ ...prev, [viewKey]: next }))
        setHasUnsavedChanges(true)
    }, [])

    const handleDeleteSingleMeasurement = useCallback((viewKey: string, id: string) => {
        setMeasurementsByView((prev) => ({
            ...prev,
            [viewKey]: (prev[viewKey] || []).filter((item) => item.id !== id),
        }))
        setHasUnsavedChanges(true)
    }, [])

    const handleClearAllMeasurements = useCallback(() => {
        setMeasurementsByView({
            panorama: [],
            tangential: [],
            cross: [],
            axial: [],
            coronal: [],
            sagittal: [],
        })
        setHasUnsavedChanges(true)
    }, [])

    const handleJumpToMeasurement = useCallback(
        (viewKey: string, m: ClinicalMeasurement) => {
            if (m.sliceAnchor !== undefined) {
                if (viewKey === "cross") {
                    setArchS(m.sliceAnchor)
                    setFocusedPlane("cross")
                    if (viewMode === "invivo_mpr" || viewMode === "study_cuts") setViewMode("multi")
                } else if (viewKey === "tangential") {
                    setArchD(m.sliceAnchor)
                    setFocusedPlane("tangential")
                    if (viewMode === "invivo_mpr" || viewMode === "study_cuts") setViewMode("multi")
                } else if (viewKey === "axial") {
                    setAxialH(m.sliceAnchor)
                    setFocusedPlane("axial")
                } else if (viewKey === "coronal") {
                    setCoronalY(m.sliceAnchor)
                    setViewMode("invivo_mpr")
                } else if (viewKey === "sagittal") {
                    setSagittalX(m.sliceAnchor)
                    setViewMode("invivo_mpr")
                }
            }
            setMeasuresMenuOpen(false)
        },
        [viewMode]
    )

    const handleAddNervePoint3D = useCallback((pt: Vec3) => {
        setNervePoints3D((prev) => [...prev, pt])
        setHasUnsavedChanges(true)
    }, [])

    // Aplicar una escena clínica guardada sobre el volumen recién cargado
    const applyClinicalScene = useCallback((scene: CbctClinicalScene, cVol: ClinicalVolume) => {
        if (scene.archCtrlPts && scene.archCtrlPts.length >= 3) {
            const clampedArch = scene.archCtrlPts.map((pt) => ({
                x: Math.max(2, Math.min(cVol.widthMm - 2, pt.x)),
                y: Math.max(2, Math.min(cVol.depthMm - 2, pt.y)),
            }))
            setArchCtrlPts(clampedArch)
        }
        if (scene.activeCoords) {
            setArchS(Math.max(0, scene.activeCoords.archS))
            setArchD(
                Math.max(-MAX_ARCH_OFFSET_D_MM, Math.min(MAX_ARCH_OFFSET_D_MM, scene.activeCoords.archD))
            )
            setAxialH(Math.max(0, Math.min(cVol.heightMm, scene.activeCoords.axialH)))
            setSagittalX(Math.max(0, Math.min(cVol.widthMm, scene.activeCoords.sagittalX)))
            setCoronalY(Math.max(0, Math.min(cVol.depthMm, scene.activeCoords.coronalY)))
        }
        if (scene.sliceSettings) {
            setPanoThickness(scene.sliceSettings.panoThickness || 18)
            setPanoMode(scene.sliceSettings.panoMode || "mean")
            setMprSlabMm(scene.sliceSettings.mprSlabMm ?? 1.6)
            setInvivoSlabMode(scene.sliceSettings.invivoSlabMode || "mean")
            setTangentialMode(scene.sliceSettings.tangentialMode || "flat")
            setTangentialTiltDeg(scene.sliceSettings.tangentialTiltDeg || 0)
            setCrossTiltDeg(scene.sliceSettings.crossTiltDeg || 0)
            setSerialSpacingMm(scene.sliceSettings.serialSpacingMm || 1.5)
        }
        if (scene.windowLevel?.sliceWl?.width > 0) {
            setSliceWl(scene.windowLevel.sliceWl)
            setActiveWlPreset(scene.windowLevel.activeWlPreset || "auto")
        }
        if (scene.windowLevel?.panoWl?.width > 0) {
            setPanoWl(scene.windowLevel.panoWl)
        }
        if (Array.isArray(scene.nervePoints3D)) {
            setNervePoints3D(scene.nervePoints3D)
        }
        if (scene.measurementsByView && typeof scene.measurementsByView === "object") {
            setMeasurementsByView({
                panorama: scene.measurementsByView.panorama || [],
                tangential: scene.measurementsByView.tangential || [],
                cross: scene.measurementsByView.cross || [],
                axial: scene.measurementsByView.axial || [],
                coronal: scene.measurementsByView.coronal || [],
                sagittal: scene.measurementsByView.sagittal || [],
            })
        }
        if (Array.isArray(scene.savedCuts)) {
            setSavedCuts(scene.savedCuts)
        }
        if (scene.defaultWorkspace) {
            setViewMode(scene.defaultWorkspace)
        }
        setSceneMeta({
            updatedByName: scene.updatedByName,
            updatedAt: scene.updatedAt,
        })
        setHasUnsavedChanges(false)
        sceneAppliedRef.current = true
    }, [])

    // Cargar escena clínica guardada desde Supabase (en paralelo a la decodificación DICOM)
    useEffect(() => {
        if (!open || !resultFileId) {
            setSavedCuts([])
            setCanEditScene(false)
            setSceneMeta(null)
            pendingSceneRef.current = null
            sceneAppliedRef.current = false
            setHasUnsavedChanges(false)
            setActiveCutId(null)
            return
        }

        let cancelled = false
        pendingSceneRef.current = null
        sceneAppliedRef.current = false
        setSaveFeedback("idle")
        setSaveErrorMsg(null)

        ;(async () => {
            try {
                const res = await fetch(`/api/results/scene?fileId=${encodeURIComponent(resultFileId)}`)
                if (!res.ok || cancelled) return
                const data = await res.json()
                if (cancelled) return
                setCanEditScene(Boolean(data.canEdit))
                if (data.scene) {
                    pendingSceneRef.current = data.scene as CbctClinicalScene
                    setSavedCuts(data.scene.savedCuts || [])
                    setSceneMeta({
                        updatedByName: data.scene.updatedByName,
                        updatedAt: data.scene.updatedAt,
                    })
                }
            } catch (e) {
                console.warn("[DicomViewer] No se pudo consultar escena guardada:", e)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [open, resultFileId])

    // Aplicar escena pendiente tan pronto como clinicalVol esté listo
    useEffect(() => {
        if (!clinicalVol || sceneAppliedRef.current || !pendingSceneRef.current) return
        applyClinicalScene(pendingSceneRef.current, clinicalVol)
    }, [clinicalVol, applyClinicalScene])

    const handleAddCurrentCut = useCallback(
        (name: string, note: string) => {
            const ws: PersistedWorkspace = viewMode === "study_cuts" ? "multi" : viewMode
            const newCut: SavedClinicalCut = {
                id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name,
                note: note || undefined,
                workspace: ws,
                archS,
                archD,
                axialH,
                sagittalX,
                coronalY,
                tangentialMode,
                tangentialTiltDeg,
                crossTiltDeg,
                serialSpacingMm,
                createdAt: new Date().toISOString(),
            }
            setSavedCuts((prev) => [...prev, newCut])
            setActiveCutId(newCut.id)
            setHasUnsavedChanges(true)
        },
        [
            viewMode,
            archS,
            archD,
            axialH,
            sagittalX,
            coronalY,
            tangentialMode,
            tangentialTiltDeg,
            crossTiltDeg,
            serialSpacingMm,
        ]
    )

    const handleApplySavedCut = useCallback(
        (cut: SavedClinicalCut) => {
            setViewMode(cut.workspace)
            setArchS(cut.archS)
            setArchD(cut.archD)
            setAxialH(cut.axialH)
            setSagittalX(cut.sagittalX)
            setCoronalY(cut.coronalY)
            setTangentialMode(cut.tangentialMode || "flat")
            setTangentialTiltDeg(cut.tangentialTiltDeg || 0)
            setCrossTiltDeg(cut.crossTiltDeg || 0)
            setSerialSpacingMm(cut.serialSpacingMm || 1.5)
            setActiveCutId(cut.id)
        },
        []
    )

    const handleDeleteSavedCut = useCallback((id: string) => {
        setSavedCuts((prev) => prev.filter((c) => c.id !== id))
        setActiveCutId((curr) => (curr === id ? null : curr))
        setHasUnsavedChanges(true)
    }, [])

    const handleSaveClinicalScene = useCallback(async () => {
        if (!resultFileId || !canEditScene || !clinicalVol) return
        setIsSavingScene(true)
        setSaveFeedback("idle")
        setSaveErrorMsg(null)

        try {
            const defaultWs: PersistedWorkspace = viewMode === "study_cuts" ? "multi" : viewMode
            const payload: CbctClinicalScene = {
                version: 1,
                updatedAt: new Date().toISOString(),
                defaultWorkspace: defaultWs,
                archCtrlPts,
                activeCoords: { archS, archD, axialH, sagittalX, coronalY },
                sliceSettings: {
                    panoThickness,
                    panoMode,
                    mprSlabMm,
                    invivoSlabMode,
                    tangentialMode,
                    tangentialTiltDeg,
                    crossTiltDeg,
                    serialSpacingMm,
                },
                windowLevel: {
                    sliceWl,
                    panoWl,
                    activeWlPreset,
                },
                nervePoints3D,
                measurementsByView,
                savedCuts,
            }

            const res = await fetch("/api/results/scene", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileId: resultFileId, scene: payload }),
            })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || "No se pudo guardar la escena clínica")
            }

            setHasUnsavedChanges(false)
            setSaveFeedback("saved")
            if (data.scene) {
                setSceneMeta({
                    updatedByName: data.scene.updatedByName,
                    updatedAt: data.scene.updatedAt,
                })
            }
            setTimeout(() => setSaveFeedback("idle"), 2800)
        } catch (err: any) {
            setSaveFeedback("error")
            setSaveErrorMsg(err.message || "Error al guardar escena")
            setTimeout(() => setSaveFeedback("idle"), 4000)
        } finally {
            setIsSavingScene(false)
        }
    }, [
        resultFileId,
        canEditScene,
        clinicalVol,
        viewMode,
        archCtrlPts,
        archS,
        archD,
        axialH,
        sagittalX,
        coronalY,
        panoThickness,
        panoMode,
        mprSlabMm,
        invivoSlabMode,
        tangentialMode,
        tangentialTiltDeg,
        crossTiltDeg,
        serialSpacingMm,
        sliceWl,
        panoWl,
        activeWlPreset,
        nervePoints3D,
        measurementsByView,
        savedCuts,
    ])

    // Activar una serie volumétrica 3D concreta (soporta estudios con múltiples volúmenes CBCT)
    const activateVolumetricSeries = useCallback(
        async (series: VolumetricSeries, isCancelledRef?: () => boolean) => {
            const checkCancelled = isCancelledRef ?? (() => false)
            const cal = series.calibration
            const cVol = createClinicalVolume(
                series.volume,
                {
                    slope: series.volume.slope ?? 1,
                    intercept: series.volume.intercept ?? 0,
                },
                series.dicomWindow,
                {
                    preserveExactSz: true,
                    flipX: cal.flipX,
                    flipY: cal.flipY,
                }
            )
            if (checkCancelled()) return

            const initSliceWl = presetWindow(cVol.quantile, "auto", cVol.dicomWindow)
            setSliceWl(initSliceWl)
            setCalibrationAudit(cal)
            setActiveVolumeId(series.id)

            const rv = await buildRenderVolume(series.volume, 240, checkCancelled)
            if (!rv || checkCancelled()) return

            const det = detectDentalArch(rv, series.volume)
            const ctrlPts = archControlPointsFromDetection(det, cVol, 11)
            const builtArch = buildArch(ctrlPts)

            const initH = Math.max(
                cVol.heightMm * 0.12,
                Math.min(cVol.heightMm * 0.88, det.zMidNorm * cVol.heightMm)
            )
            const initS = builtArch.length * 0.5

            setClinicalVol(cVol)
            setRenderVolume(rv)
            setArchCtrlPts(ctrlPts)
            setInitialArchCtrlPts(ctrlPts)
            setArchS(initS)
            setArchD(0)
            setAxialH(initH)
            setDentalBaseH(initH)
            setSagittalX(cVol.widthMm * 0.5)
            setCoronalY(cVol.depthMm * 0.5)
            setTangentialTiltDeg(0)
            setCrossTiltDeg(0)
            setNervePoints3D([])
            setLoading(false)
            setLoadProgress(100)
        },
        []
    )

    // 1. Descarga, descompresión multi-serie (ZIP/RAR/DICOM + Láminas Clínicas) y auditoría metrológica
    useEffect(() => {
        if (!open || !zipUrl) return

        let isCancelled = false
        setLoading(true)
        setErrorMsg(null)
        setLoadProgress(5)
        setIsPlaying(false)
        setActiveTool("navigate")
        setActiveWlPreset("auto")
        setActiveColorMap("plain")
        setViewMode("multi")
        setClinicalVol(null)
        setRenderVolume(null)
        setArchCtrlPts([])
        setInitialArchCtrlPts([])
        setPanoramaImage(null)
        setVolumetricSeriesList([])
        setSecondarySeriesList([])
        setClinicalSheets([])
        setCalibrationAudit(null)
        setNervePoints3D([])
        setMeasurementsByView({
            panorama: [],
            tangential: [],
            cross: [],
            axial: [],
            coronal: [],
            sagittal: [],
        })
        setReconStatus("Analizando vóxeles CBCT y orientación LPS...")
        setLoadStep("Conectando con almacenamiento seguro...")

        // Limpiar URLs temporales previas
        for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
        objectUrlsRef.current = []

        const loadStudy = async () => {
            try {
                setLoadStep("Descargando estudio tomográfico...")
                setLoadProgress(15)

                const response = await fetch(zipUrl)
                if (!response.ok) {
                    throw new Error(`Error HTTP al descargar el estudio (${response.status})`)
                }

                const blob = await response.blob()
                if (isCancelled) return

                setLoadProgress(32)
                setLoadStep("Descomprimiendo series DICOM y láminas clínicas...")

                const dcmFiles: File[] = []
                const extractedSheets: ClinicalSheetAttachment[] = []
                const archiveFormat = await detectArchiveFormat(blob)

                if (archiveFormat === "rar") {
                    setLoadStep("Descomprimiendo paquete RAR y separando series DICOM...")
                    const { dcmFiles: rarFiles, clinicalSheets: rarSheets } = await extractDicomFilesFromRar(
                        blob,
                        (pct, msg) => {
                            if (!isCancelled) {
                                setLoadStep(msg)
                                setLoadProgress(Math.min(80, 30 + Math.round(pct * 0.5)))
                            }
                        }
                    )
                    dcmFiles.push(...rarFiles)
                    for (let i = 0; i < rarSheets.length; i++) {
                        const sh = rarSheets[i]
                        const mime =
                            sh.kind === "pdf"
                                ? "application/pdf"
                                : sh.name.toLowerCase().endsWith(".png")
                                ? "image/png"
                                : "image/jpeg"
                        const url = URL.createObjectURL(new Blob([new Uint8Array(sh.data)], { type: mime }))
                        objectUrlsRef.current.push(url)
                        extractedSheets.push({ id: `sheet_${i}`, name: sh.name, kind: sh.kind, url })
                    }
                } else if (
                    archiveFormat === "zip" ||
                    (archiveFormat === "unknown" &&
                        (blob.type.includes("zip") || zipUrl.toLowerCase().includes(".zip")))
                ) {
                    const zip = await JSZip.loadAsync(blob)
                    const allFiles = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
                    const validDicomEntries = allFiles.filter((fileName) => isDicomSliceEntry(fileName))
                    const sheetEntries = allFiles.filter(
                        (fileName) => !isDicomSliceEntry(fileName) && isClinicalSheetEntry(fileName)
                    )

                    let processed = 0
                    for (const name of validDicomEntries) {
                        if (isCancelled) return
                        const fileData = await zip.files[name].async("blob")
                        // Mantener nombre único con ruta para evitar colisiones entre series distintas
                        const safeUniqueName = name.replace(/\\/g, "/").replace(/\//g, "__")
                        dcmFiles.push(new File([fileData], safeUniqueName, { type: "application/dicom" }))

                        processed++
                        if (processed % 25 === 0 || processed === validDicomEntries.length) {
                            setLoadProgress(32 + Math.round((processed / Math.max(1, validDicomEntries.length)) * 45))
                        }
                    }

                    for (let i = 0; i < sheetEntries.length; i++) {
                        if (isCancelled) return
                        const name = sheetEntries[i]
                        const fileData = await zip.files[name].async("blob")
                        if (fileData.size > 25 * 1024 * 1024) continue
                        const baseName = name.replace(/\\/g, "/").split("/").pop() || name
                        const lower = baseName.toLowerCase()
                        const kind: "pdf" | "image" = lower.endsWith(".pdf") ? "pdf" : "image"
                        const mime =
                            kind === "pdf"
                                ? "application/pdf"
                                : lower.endsWith(".png")
                                ? "image/png"
                                : "image/jpeg"
                        const url = URL.createObjectURL(new Blob([fileData], { type: mime }))
                        objectUrlsRef.current.push(url)
                        extractedSheets.push({ id: `sheet_${i}`, name: baseName, kind, url })
                    }
                } else {
                    const baseName = zipUrl.split("/").pop()?.split("?")[0] || "image.dcm"
                    dcmFiles.push(new File([blob], baseName, { type: "application/dicom" }))
                    setLoadProgress(78)
                }

                if (!isCancelled) {
                    setClinicalSheets(extractedSheets)
                }

                if (dcmFiles.length === 0) {
                    if (extractedSheets.length > 0) {
                        setViewMode("study_cuts")
                        setLoading(false)
                        setLoadProgress(100)
                        return
                    }
                    throw new Error("No se detectaron cortes tomográficos DICOM válidos en el archivo.")
                }

                dcmFiles.sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
                )

                if (isCancelled) return
                setLoadProgress(80)
                setLoadStep(`Decodificando ${dcmFiles.length} cortes DICOM...`)

                const dwv = await import("dwv")
                if (isCancelled) return

                const app = new dwv.App()
                dwvAppRef.current = app

                app.init({
                    dataViewConfigs: {},
                    viewOnFirstLoadItem: false,
                } as any)

                let loadedSlicesCount = 0
                app.addEventListener("loaditem", () => {
                    if (isCancelled) return
                    loadedSlicesCount++
                    if (loadedSlicesCount % 20 === 0 || loadedSlicesCount === dcmFiles.length) {
                        const pct = 80 + Math.round((loadedSlicesCount / Math.max(1, dcmFiles.length)) * 12)
                        setLoadProgress(Math.min(92, pct))
                        setLoadStep(`Ensamblando series DICOM (${loadedSlicesCount} / ${dcmFiles.length})...`)
                    }
                })

                let hasLoaded = false
                const onLoadEnd = async () => {
                    if (isCancelled || hasLoaded) return
                    hasLoaded = true

                    try {
                        setLoadProgress(92)
                        setLoadStep("Auditando calibración LPS y separando series del estudio...")
                        await new Promise((r) => setTimeout(r, 20))
                        if (isCancelled) return

                        const bundle = extractAllStudySeries(app)
                        setVolumetricSeriesList(bundle.volumetricSeries)
                        setSecondarySeriesList(bundle.secondarySeries)

                        if (bundle.volumetricSeries.length === 0) {
                            if (bundle.secondarySeries.length > 0 || extractedSheets.length > 0) {
                                setViewMode("study_cuts")
                                setLoading(false)
                                setLoadProgress(100)
                                return
                            }
                            throw new Error("No se pudo extraer ninguna matriz volumétrica ni cortes DICOM válidos.")
                        }

                        await activateVolumetricSeries(bundle.volumetricSeries[0], () => isCancelled)
                    } catch (e: any) {
                        console.error("Error procesando volumen clínico:", e)
                        if (!isCancelled) {
                            setErrorMsg(e.message || "Error al construir el volumen tomográfico.")
                            setLoading(false)
                        }
                    }
                }

                app.addEventListener("load", onLoadEnd)
                app.addEventListener("loadend", onLoadEnd)
                app.addEventListener("error", (ev: any) => {
                    console.error("DWV load error:", ev)
                })

                app.loadFiles(dcmFiles)
            } catch (err: any) {
                console.error("Error al cargar visor DICOM:", err)
                if (!isCancelled) {
                    setErrorMsg(err.message || "Error al procesar el archivo tomográfico.")
                    setLoading(false)
                }
            }
        }

        loadStudy()

        return () => {
            isCancelled = true
            if (dwvAppRef.current) {
                try {
                    dwvAppRef.current.reset()
                } catch {}
                dwvAppRef.current = null
            }
            for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
            objectUrlsRef.current = []
            if (hiddenLoaderRef.current) hiddenLoaderRef.current.innerHTML = ""
        }
    }, [open, zipUrl, activateVolumetricSeries])

    // 2. Recalcular la Panorámica CPR cuando cambia el volumen, el arco editado, el grosor o el modo (Rx vs MIP)
    useEffect(() => {
        if (!clinicalVol || !archModel) return
        let cancelled = false
        setReconStatus("Reconstruyendo Panorámica CPR de alta resolución...")
        ;(async () => {
            const pano = await renderPanorama(
                clinicalVol,
                archModel,
                { thicknessMm: panoThickness, mode: panoMode },
                () => cancelled
            )
            if (!cancelled && pano) {
                const pQuant = imageQuantile(pano.data, clinicalVol.slope, clinicalVol.intercept)
                setPanoWl(presetWindow(pQuant, activeWlPreset === "auto" ? "auto" : activeWlPreset))
                setPanoramaImage(pano)
                setReconStatus("")
            }
        })()
        return () => {
            cancelled = true
        }
    }, [clinicalVol, archModel, panoThickness, panoMode, activeWlPreset])

    // 3. Ventana vertical [hBot, hTop] de la "Ventana de cortes" (35 mm estilo GALILEOS) y cortes MPR calibrados
    const sliceWindowBounds = useMemo(() => {
        if (!clinicalVol) return { hBot: 0, hTop: SLICE_WINDOW_HEIGHT_MM, height: SLICE_WINDOW_HEIGHT_MM }
        const totalH = clinicalVol.heightMm
        const winH = Math.min(totalH, SLICE_WINDOW_HEIGHT_MM)
        const hBot = Math.max(0, Math.min(totalH - winH, axialH - winH * 0.5))
        const hTop = hBot + winH
        return { hBot, hTop, height: Math.max(1, hTop - hBot) }
    }, [clinicalVol, axialH])

    const tangentialImg = useMemo(() => {
        if (!clinicalVol || !archModel) return null
        if (tangentialMode === "flat") {
            const spec = tangentialPlane(
                clinicalVol,
                archModel,
                archS,
                archD,
                TANGENTIAL_HALF_WIDTH_MM,
                Math.max(mprSlabMm, 2.0),
                sliceWindowBounds.hBot,
                sliceWindowBounds.hTop,
                tangentialTiltDeg
            )
            return renderPlane(clinicalVol, spec)
        }
        return renderTangentialSection(
            clinicalVol,
            archModel,
            archS,
            archD,
            TANGENTIAL_HALF_WIDTH_MM,
            Math.max(mprSlabMm, 2.0),
            sliceWindowBounds.hBot,
            sliceWindowBounds.hTop
        )
    }, [clinicalVol, archModel, archS, archD, mprSlabMm, sliceWindowBounds, tangentialMode, tangentialTiltDeg])

    const crossImg = useMemo(() => {
        if (!clinicalVol || !archModel) return null
        const spec = crossPlane(
            clinicalVol,
            archModel,
            archS,
            CROSS_HALF_WIDTH_MM,
            Math.max(mprSlabMm, 1.5),
            sliceWindowBounds.hBot,
            sliceWindowBounds.hTop,
            crossTiltDeg
        )
        return renderPlane(clinicalVol, spec)
    }, [clinicalVol, archModel, archS, mprSlabMm, sliceWindowBounds, crossTiltDeg])

    const axialImg = useMemo(() => {
        if (!clinicalVol) return null
        const spec = axialPlane(clinicalVol, axialH, Math.min(mprSlabMm, 1.0), invivoSlabMode)
        return renderPlane(clinicalVol, spec)
    }, [clinicalVol, axialH, mprSlabMm, invivoSlabMode])

    // 4. Sincronización de la caja amarilla de enfoque y nervio dentario en el visor 3D
    const volumeFocus = useMemo<VolumeFocus | null>(() => {
        if (!clinicalVol || !archModel) return null
        const f = archFrame(archModel, archS)
        const cxMm = f.x + f.nx * archD
        const cyMm = f.y + f.ny * archD
        const totalH = Math.max(1, clinicalVol.heightMm)
        return {
            cx: Math.max(0, Math.min(1, cxMm / Math.max(1, clinicalVol.widthMm))),
            cy: Math.max(0, Math.min(1, cyMm / Math.max(1, clinicalVol.depthMm))),
            tx: f.tx,
            ty: f.ty,
            halfWidthMm: TANGENTIAL_HALF_WIDTH_MM,
            halfDepthMm: CROSS_HALF_WIDTH_MM,
            hBotNorm: Math.max(0, Math.min(1, sliceWindowBounds.hBot / totalH)),
            hTopNorm: Math.max(0, Math.min(1, sliceWindowBounds.hTop / totalH)),
        }
    }, [clinicalVol, archModel, archS, archD, sliceWindowBounds])

    const nervePointsNorm = useMemo<[number, number, number][]>(() => {
        if (!clinicalVol || nervePoints3D.length === 0) return []
        const W = Math.max(1, clinicalVol.widthMm)
        const D = Math.max(1, clinicalVol.depthMm)
        const H = Math.max(1, clinicalVol.heightMm)
        return nervePoints3D.map(([x, y, z]) => [
            Math.max(0, Math.min(1, x / W)),
            Math.max(0, Math.min(1, y / D)),
            Math.max(0, Math.min(1, hFromZ(clinicalVol, z) / H)),
        ])
    }, [clinicalVol, nervePoints3D])

    const currentSliceIndex = useMemo(() => {
        if (!clinicalVol) return 0
        return sliceIndexFromH(clinicalVol, axialH)
    }, [clinicalVol, axialH])

    const totalSlices = clinicalVol?.nz || 0

    // 5. Cambiar preset de densidad ósea
    const handleWlPresetChange = useCallback(
        (preset: WlPresetId) => {
            setActiveWlPreset(preset)
            if (!clinicalVol) return
            setSliceWl(presetWindow(clinicalVol.quantile, preset, clinicalVol.dicomWindow))
            if (panoramaImage) {
                const pq = imageQuantile(panoramaImage.data, clinicalVol.slope, clinicalVol.intercept)
                setPanoWl(presetWindow(pq, preset))
            }
        },
        [clinicalVol, panoramaImage]
    )

    const handleAdjustSliceWl = useCallback((dWidth: number, dCenter: number) => {
        setSliceWl((prev) => ({
            width: Math.max(20, Math.round(prev.width + dWidth)),
            center: Math.round(prev.center + dCenter),
        }))
    }, [])

    const handleAdjustPanoWl = useCallback((dWidth: number, dCenter: number) => {
        setPanoWl((prev) => ({
            width: Math.max(20, Math.round(prev.width + dWidth)),
            center: Math.round(prev.center + dCenter),
        }))
    }, [])

    const handleMoveArchControlPoint = useCallback(
        (idx: number, xMm: number, yMm: number) => {
            if (!clinicalVol) return
            setArchCtrlPts((prev) =>
                prev.map((pt, i) =>
                    i === idx
                        ? {
                              x: Math.max(2, Math.min(clinicalVol.widthMm - 2, xMm)),
                              y: Math.max(2, Math.min(clinicalVol.depthMm - 2, yMm)),
                          }
                        : pt
                )
            )
            setHasUnsavedChanges(true)
        },
        [clinicalVol]
    )

    const handleResetView = useCallback(() => {
        setResetTrigger((n) => n + 1)
        setActiveColorMap("plain")
        handleWlPresetChange("auto")
        setTangentialTiltDeg(0)
        setCrossTiltDeg(0)
        if (clinicalVol && archModel) {
            setArchS(archModel.length * 0.5)
            setArchD(0)
            setAxialH(dentalBaseH)
            setSagittalX(clinicalVol.widthMm * 0.5)
            setCoronalY(clinicalVol.depthMm * 0.5)
        }
    }, [clinicalVol, archModel, dentalBaseH, handleWlPresetChange])

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
            setIsFullscreen(true)
        } else {
            document.exitFullscreen().catch(() => {})
            setIsFullscreen(false)
        }
    }

    // 6. Navegación por teclado y Cine Loop sobre el plano enfocado
    const activePlaneAfterViewMode: FocusPlane =
        viewMode === "tangential"
            ? "tangential"
            : viewMode === "cross" || viewMode === "invivo_serial"
            ? "cross"
            : viewMode === "axial" || viewMode === "invivo_mpr"
            ? "axial"
            : focusedPlane

    const stepFocusedPlane = useCallback(
        (steps: number, plane: FocusPlane = activePlaneAfterViewMode) => {
            if (!clinicalVol || !archModel) return
            if (plane === "axial") {
                const stepMm = Math.max(0.25, clinicalVol.sz)
                setAxialH((h) => Math.max(0, Math.min(clinicalVol.heightMm, h + steps * stepMm)))
            } else if (plane === "cross") {
                const stepMm = viewMode === "invivo_serial" ? serialSpacingMm : 0.5
                setArchS((s) => Math.max(0, Math.min(archModel.length, s + steps * stepMm)))
            } else if (plane === "tangential") {
                const stepMm = 0.25
                setArchD((d) =>
                    Math.max(-MAX_ARCH_OFFSET_D_MM, Math.min(MAX_ARCH_OFFSET_D_MM, d + steps * stepMm))
                )
            }
        },
        [clinicalVol, archModel, activePlaneAfterViewMode, viewMode, serialSpacingMm]
    )

    useEffect(() => {
        if (!open || !clinicalVol || !archModel) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault()
                stepFocusedPlane(1)
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault()
                stepFocusedPlane(-1)
            } else if (e.key === "PageDown") {
                e.preventDefault()
                stepFocusedPlane(8)
            } else if (e.key === "PageUp") {
                e.preventDefault()
                stepFocusedPlane(-8)
            } else if (e.key === " " || e.code === "Space") {
                e.preventDefault()
                setIsPlaying((p) => !p)
            } else if (e.key === "Escape") {
                setFiltersMenuOpen(false)
                setCalibrationMenuOpen(false)
                setMeasuresMenuOpen(false)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [open, clinicalVol, archModel, stepFocusedPlane])

    useEffect(() => {
        if (!isPlaying || !clinicalVol || !archModel) return
        const interval = setInterval(() => {
            if (activePlaneAfterViewMode === "axial") {
                const stepMm = Math.max(0.3, clinicalVol.sz)
                setAxialH((h) => (h + stepMm > clinicalVol.heightMm ? 0 : h + stepMm))
            } else if (activePlaneAfterViewMode === "cross") {
                setArchS((s) => (s + 0.6 > archModel.length ? 0 : s + 0.6))
            } else {
                setArchD((d) => (d + 0.3 > MAX_ARCH_OFFSET_D_MM ? -MAX_ARCH_OFFSET_D_MM : d + 0.3))
            }
        }, 65)
        return () => clearInterval(interval)
    }, [isPlaying, clinicalVol, archModel, activePlaneAfterViewMode])

    // 7. Superposiciones gráficas estilo Sirona GALILEOS + proyección del canal del nervio dentario
    const renderPanoramaOverlay = useCallback(
        ({ ctx, mmToScreen }: ViewportOverlayContext) => {
            if (!panoramaImage || !archModel || !clinicalVol) return
            const hTop = panoramaImage.hTop
            const yAxialMm = Math.max(0, Math.min(hTop, hTop - axialH))
            const yWinTopMm = Math.max(0, Math.min(hTop, hTop - sliceWindowBounds.hTop))
            const yWinBotMm = Math.max(0, Math.min(hTop, hTop - sliceWindowBounds.hBot))

            const [cx, cy] = mmToScreen(archS, yAxialMm)
            const [leftX, topY] = mmToScreen(Math.max(0, archS - TANGENTIAL_HALF_WIDTH_MM), yWinTopMm)
            const [rightX, botY] = mmToScreen(
                Math.min(archModel.length, archS + TANGENTIAL_HALF_WIDTH_MM),
                yWinBotMm
            )
            const [imgLeftX] = mmToScreen(0, 0)
            const [imgRightX] = mmToScreen(archModel.length, 0)

            // Línea amarilla horizontal (nivel del corte Axial)
            ctx.strokeStyle = "rgba(250, 204, 21, 0.55)"
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.moveTo(imgLeftX, cy)
            ctx.lineTo(imgRightX, cy)
            ctx.stroke()

            // Proyectar el canal del nervio dentario inferior en la Panorámica
            if (nervePoints3D.length > 0) {
                ctx.save()
                ctx.strokeStyle = "#f97316"
                ctx.lineWidth = 2.2
                ctx.beginPath()
                nervePoints3D.forEach((pt, idx) => {
                    const proj = projectToArch(archModel, pt[0], pt[1])
                    const h = hFromZ(clinicalVol, pt[2])
                    const [nx, ny] = mmToScreen(proj.s, hTop - h)
                    if (idx === 0) ctx.moveTo(nx, ny)
                    else ctx.lineTo(nx, ny)
                })
                ctx.stroke()
                for (const pt of nervePoints3D) {
                    const proj = projectToArch(archModel, pt[0], pt[1])
                    const h = hFromZ(clinicalVol, pt[2])
                    const [nx, ny] = mmToScreen(proj.s, hTop - h)
                    ctx.fillStyle = "#f97316"
                    ctx.beginPath()
                    ctx.arc(nx, ny, 3.2, 0, Math.PI * 2)
                    ctx.fill()
                }
                ctx.restore()
            }

            // Marco celeste de la "Ventana de cortes" estilo Sirona GALILEOS
            const boxW = Math.max(28, rightX - leftX)
            const boxH = Math.max(36, botY - topY)
            const headerH = 16

            ctx.fillStyle = "rgba(56, 189, 248, 0.06)"
            ctx.fillRect(leftX, topY, boxW, boxH)

            ctx.strokeStyle = "rgba(125, 211, 252, 0.9)"
            ctx.lineWidth = 1.5
            ctx.strokeRect(leftX, topY, boxW, boxH)

            ctx.fillStyle = "rgba(14, 116, 144, 0.88)"
            ctx.fillRect(leftX, topY, boxW, headerH)
            ctx.fillStyle = "#e0f2fe"
            ctx.font = "600 10px system-ui, -apple-system, sans-serif"
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText("Ventana de cortes", leftX + 5, topY + headerH * 0.5, Math.max(20, boxW - 8))

            ctx.strokeStyle = "rgba(250, 204, 21, 0.92)"
            ctx.lineWidth = 1.3
            ctx.beginPath()
            ctx.moveTo(cx, topY + headerH)
            ctx.lineTo(cx, botY)
            ctx.moveTo(leftX, cy)
            ctx.lineTo(rightX, cy)
            ctx.stroke()
        },
        [panoramaImage, archModel, clinicalVol, archS, axialH, sliceWindowBounds, nervePoints3D]
    )

    const renderTangentialOverlay = useCallback(
        ({ ctx, mmToScreen }: ViewportOverlayContext) => {
            if (!clinicalVol) return
            const winHeight = sliceWindowBounds.height
            const yAxialMm = Math.max(0, Math.min(winHeight, sliceWindowBounds.hTop - axialH))
            const [cx, cy] = mmToScreen(TANGENTIAL_HALF_WIDTH_MM, yAxialMm)
            const [x0, y0] = mmToScreen(0, 0)
            const [x1, y1] = mmToScreen(TANGENTIAL_HALF_WIDTH_MM * 2, winHeight)

            ctx.strokeStyle = "rgba(250, 204, 21, 0.65)"
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.moveTo(cx, y0)
            ctx.lineTo(cx, y1)
            ctx.moveTo(x0, cy)
            ctx.lineTo(x1, cy)
            ctx.stroke()

            // Proyectar nervio en el plano tangencial recto
            if (tangentialImg?.planeSpec && nervePoints3D.length > 0) {
                ctx.save()
                for (const pt of nervePoints3D) {
                    const proj = projectWorldPointToPlane(tangentialImg.planeSpec, pt)
                    if (proj.distMm <= 4.0) {
                        const [nx, ny] = mmToScreen(proj.xMm, proj.yMm)
                        ctx.fillStyle = "rgba(249, 115, 22, 0.9)"
                        ctx.strokeStyle = "#fff7ed"
                        ctx.lineWidth = 1.3
                        ctx.beginPath()
                        ctx.arc(nx, ny, 4, 0, Math.PI * 2)
                        ctx.fill()
                        ctx.stroke()
                    }
                }
                ctx.restore()
            }
        },
        [clinicalVol, axialH, sliceWindowBounds, tangentialImg, nervePoints3D]
    )

    const renderCrossOverlay = useCallback(
        ({ ctx, mmToScreen }: ViewportOverlayContext) => {
            if (!clinicalVol) return
            const winHeight = sliceWindowBounds.height
            const yAxialMm = Math.max(0, Math.min(winHeight, sliceWindowBounds.hTop - axialH))
            const xTanMm = Math.max(0, Math.min(CROSS_HALF_WIDTH_MM * 2, CROSS_HALF_WIDTH_MM + archD))
            const [cx, cy] = mmToScreen(xTanMm, yAxialMm)
            const [x0, y0] = mmToScreen(0, 0)
            const [x1, y1] = mmToScreen(CROSS_HALF_WIDTH_MM * 2, winHeight)

            ctx.strokeStyle = "rgba(250, 204, 21, 0.65)"
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.moveTo(cx, y0)
            ctx.lineTo(cx, y1)
            ctx.moveTo(x0, cy)
            ctx.lineTo(x1, cy)
            ctx.stroke()

            // Línea punteada inclinada mostrando el plano tangencial inclinado (si tangentialTiltDeg !== 0)
            if (Math.abs(tangentialTiltDeg) >= 1) {
                const rad = (tangentialTiltDeg * Math.PI) / 180
                const dxMm = Math.tan(rad) * (winHeight * 0.5)
                const [taX, taY] = mmToScreen(xTanMm - dxMm, 0)
                const [tbX, tbY] = mmToScreen(xTanMm + dxMm, winHeight)
                ctx.save()
                ctx.strokeStyle = "rgba(52, 211, 153, 0.85)"
                ctx.lineWidth = 1.2
                ctx.setLineDash([4, 3])
                ctx.beginPath()
                ctx.moveTo(taX, taY)
                ctx.lineTo(tbX, tbY)
                ctx.stroke()
                ctx.restore()
            }

            // Proyectar nervio en la sección transversal (círculo naranja calibrado)
            if (crossImg?.planeSpec && nervePoints3D.length > 0) {
                ctx.save()
                for (const pt of nervePoints3D) {
                    const proj = projectWorldPointToPlane(crossImg.planeSpec, pt)
                    if (proj.distMm <= 2.5) {
                        const [nx, ny] = mmToScreen(proj.xMm, proj.yMm)
                        ctx.fillStyle = "rgba(249, 115, 22, 0.9)"
                        ctx.strokeStyle = "#fff7ed"
                        ctx.lineWidth = 1.4
                        ctx.beginPath()
                        ctx.arc(nx, ny, 4.5, 0, Math.PI * 2)
                        ctx.fill()
                        ctx.stroke()
                    }
                }
                ctx.restore()
            }
        },
        [clinicalVol, axialH, archD, sliceWindowBounds, tangentialTiltDeg, crossImg, nervePoints3D]
    )

    const renderAxialOverlay = useCallback(
        ({ ctx, mmToScreen }: ViewportOverlayContext) => {
            if (!archModel) return

            // 1. Curva panorámica del arco dental sobre el corte axial
            const xs = archModel.xs
            const ys = archModel.ys
            if (xs.length > 1) {
                ctx.save()
                ctx.strokeStyle = activeTool === "editArch" ? "rgba(34, 211, 238, 0.95)" : "rgba(226, 232, 240, 0.78)"
                ctx.lineWidth = activeTool === "editArch" ? 2 : 1.4
                ctx.beginPath()
                for (let i = 0; i < xs.length; i++) {
                    const [sx, sy] = mmToScreen(xs[i], ys[i])
                    if (i === 0) ctx.moveTo(sx, sy)
                    else ctx.lineTo(sx, sy)
                }
                ctx.stroke()
                ctx.restore()
            }

            // 2. Caja e intersección amarilla de los planos Tangencial y Sección Transversal
            const f = archFrame(archModel, archS)
            const cx = f.x + f.nx * archD
            const cy = f.y + f.ny * archD

            const hw = TANGENTIAL_HALF_WIDTH_MM
            const hd = CROSS_HALF_WIDTH_MM

            const c1 = mmToScreen(cx - f.tx * hw - f.nx * hd, cy - f.ty * hw - f.ny * hd)
            const c2 = mmToScreen(cx + f.tx * hw - f.nx * hd, cy + f.ty * hw - f.ny * hd)
            const c3 = mmToScreen(cx + f.tx * hw + f.nx * hd, cy + f.ty * hw + f.ny * hd)
            const c4 = mmToScreen(cx - f.tx * hw + f.nx * hd, cy - f.ty * hw + f.ny * hd)

            ctx.save()
            ctx.strokeStyle = "rgba(250, 204, 21, 0.45)"
            ctx.lineWidth = 1
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.moveTo(c1[0], c1[1])
            ctx.lineTo(c2[0], c2[1])
            ctx.lineTo(c3[0], c3[1])
            ctx.lineTo(c4[0], c4[1])
            ctx.closePath()
            ctx.stroke()
            ctx.setLineDash([])

            const tA = mmToScreen(cx - f.tx * hw, cy - f.ty * hw)
            const tB = mmToScreen(cx + f.tx * hw, cy + f.ty * hw)
            const nA = mmToScreen(f.x - f.nx * hd, f.y - f.ny * hd)
            const nB = mmToScreen(f.x + f.nx * hd, f.y + f.ny * hd)

            ctx.strokeStyle = "rgba(250, 204, 21, 0.92)"
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.moveTo(tA[0], tA[1])
            ctx.lineTo(tB[0], tB[1])
            ctx.moveTo(nA[0], nA[1])
            ctx.lineTo(nB[0], nB[1])
            ctx.stroke()

            const [scx, scy] = mmToScreen(cx, cy)
            ctx.fillStyle = "#facc15"
            ctx.beginPath()
            ctx.arc(scx, scy, 2.8, 0, Math.PI * 2)
            ctx.fill()

            // Proyectar nervio en vista Axial
            if (nervePoints3D.length > 0) {
                ctx.strokeStyle = "#f97316"
                ctx.lineWidth = 2
                ctx.beginPath()
                nervePoints3D.forEach((pt, i) => {
                    const [nx, ny] = mmToScreen(pt[0], pt[1])
                    if (i === 0) ctx.moveTo(nx, ny)
                    else ctx.lineTo(nx, ny)
                })
                ctx.stroke()
            }
            ctx.restore()
        },
        [archModel, archS, archD, activeTool, nervePoints3D]
    )

    // 8. Handlers de navegación interactiva
    const handleNavigatePanorama = useCallback(
        (xMm: number, yMm: number) => {
            if (!archModel || !panoramaImage || !clinicalVol) return
            setArchS(Math.max(0, Math.min(archModel.length, xMm)))
            setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, panoramaImage.hTop - yMm)))
            setArchD((d) => (Math.abs(d) > 3.5 ? 0 : d))
        },
        [archModel, panoramaImage, clinicalVol]
    )

    const handleNavigateTangential = useCallback(
        (xMm: number, yMm: number) => {
            setFocusedPlane("tangential")
            if (!archModel || !clinicalVol) return
            const deltaS = xMm - TANGENTIAL_HALF_WIDTH_MM
            setArchS((s) => Math.max(0, Math.min(archModel.length, s + deltaS * 0.25)))
            setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, sliceWindowBounds.hTop - yMm)))
        },
        [archModel, clinicalVol, sliceWindowBounds]
    )

    const handleNavigateCross = useCallback(
        (xMm: number, yMm: number) => {
            setFocusedPlane("cross")
            if (!clinicalVol) return
            const newD = xMm - CROSS_HALF_WIDTH_MM
            setArchD(Math.max(-MAX_ARCH_OFFSET_D_MM, Math.min(MAX_ARCH_OFFSET_D_MM, newD)))
            setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, sliceWindowBounds.hTop - yMm)))
        },
        [clinicalVol, sliceWindowBounds]
    )

    const handleNavigateAxial = useCallback(
        (xMm: number, yMm: number) => {
            setFocusedPlane("axial")
            if (!archModel) return
            const proj = projectToArch(archModel, xMm, yMm)
            setArchS(Math.max(0, Math.min(archModel.length, proj.s)))
            if (Math.abs(proj.d) <= 4.5) {
                setArchD(Math.max(-3.5, Math.min(3.5, proj.d * 0.6)))
            } else {
                setArchD(0)
            }
        },
        [archModel]
    )

    // Etiquetas dinámicas
    const activePresetLabel =
        activeWlPreset === "bone"
            ? "Hueso"
            : activeWlPreset === "enamel"
            ? "Esmalte"
            : activeWlPreset === "soft"
            ? "Tejidos"
            : "Óptimo"

    const activeColorLabel =
        activeColorMap === "hot"
            ? " · Térmico"
            : activeColorMap === "invPlain"
            ? " · Invertido"
            : ""

    const normArchPos = archModel && archModel.length > 0 ? archS / archModel.length : 0.5
    const selectedToothLabel = getDentalSectorLabel(normArchPos)
    const studyCutsBadgeCount = secondarySeriesList.length + clinicalSheets.length
    const hasMultipleVolumes = volumetricSeriesList.length > 1

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[98vw] max-w-[98vw] w-[98vw] h-[96vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-950 text-white rounded-2xl border-slate-800 shadow-2xl focus:outline-hidden"
                showCloseButton={false}
            >
                {/* Contenedor auxiliar fuera de pantalla para decodificación DICOM */}
                <div
                    id="dwv-hidden-loader"
                    ref={hiddenLoaderRef}
                    className="fixed -left-[9999px] -top-[9999px] w-64 h-64 opacity-0 pointer-events-none"
                />

                {/* 1. Barra Superior Unificada de Estación de Trabajo PACS (GALILEOS + InVivoViewer) */}
                <div className="relative z-30 flex flex-wrap items-center justify-between px-2.5 sm:px-3.5 py-1.5 border-b border-slate-800/90 bg-slate-900/95 shrink-0 gap-1.5">
                    {/* Grupo A: Título + Espacios de Trabajo (GALILEOS / InVivo MPR / Cortes Seriados / Cortes del Estudio) */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <DialogTitle
                            className="text-xs font-semibold truncate text-white flex items-center gap-1.5 max-w-[140px] xl:max-w-[190px]"
                            title={title}
                        >
                            <div className="h-6 w-6 rounded-md bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
                                <Layers className="h-3.5 w-3.5 text-blue-400" />
                            </div>
                            <span className="truncate">{title}</span>
                        </DialogTitle>

                        {/* Selector de Espacio de Trabajo */}
                        <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 overflow-x-auto max-w-full">
                            <Button
                                size="sm"
                                variant={viewMode === "multi" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    viewMode === "multi"
                                        ? "bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("multi")}
                                title="Espacio de trabajo estilo Sirona GALILEOS: 5 Vistas simultáneas"
                            >
                                <LayoutGrid className="h-3 w-3 shrink-0" />
                                <span>GALILEOS</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "invivo_mpr" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    viewMode === "invivo_mpr"
                                        ? "bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("invivo_mpr")}
                                disabled={!clinicalVol}
                                title="Espacio de trabajo estilo InVivoViewer: MPR Ortogonal (Axial, Coronal, Sagital y 3D)"
                            >
                                <Grid2X2 className="h-3 w-3 shrink-0" />
                                <span>InVivo MPR</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "invivo_serial" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    viewMode === "invivo_serial"
                                        ? "bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("invivo_serial")}
                                disabled={!clinicalVol || !archModel}
                                title="Cortes transversales seriados (6 cortes simultáneos estilo InVivoViewer)"
                            >
                                <Columns3 className="h-3 w-3 shrink-0" />
                                <span>Seriados 6×</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "study_cuts" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    viewMode === "study_cuts"
                                        ? "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                        : studyCutsBadgeCount > 0 || hasMultipleVolumes
                                        ? "text-emerald-300 hover:text-white"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("study_cuts")}
                                disabled={loading}
                                title="Explorar todas las series DICOM específicas y láminas clínicas originales incluidas en el estudio"
                            >
                                <FolderOpen className="h-3 w-3 shrink-0" />
                                <span>Series</span>
                                {(studyCutsBadgeCount > 0 || hasMultipleVolumes) && (
                                    <span className="px-1 py-0 rounded-full bg-emerald-500/25 border border-emerald-400/40 text-[9px] font-mono text-emerald-200">
                                        {volumetricSeriesList.length + studyCutsBadgeCount}
                                    </span>
                                )}
                            </Button>
                        </div>

                        {/* Badge Metrológico de Calibración DICOM Auditada */}
                        {calibrationAudit && (
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCalibrationMenuOpen((v) => !v)
                                        setFiltersMenuOpen(false)
                                        setMeasuresMenuOpen(false)
                                    }}
                                    className={`h-6 px-2 rounded-md border text-[10px] font-mono font-semibold flex items-center gap-1 transition-colors ${
                                        calibrationAudit.status === "estimated_isotropic" || calibrationAudit.hasGaps
                                            ? "bg-amber-950/70 border-amber-500/50 text-amber-300 hover:bg-amber-900/60"
                                            : "bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50"
                                    }`}
                                    title="Auditoría metrológica DICOM: clic para ver fuentes exactas de calibración y orientación LPS"
                                >
                                    {calibrationAudit.status === "estimated_isotropic" || calibrationAudit.hasGaps ? (
                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                    ) : (
                                        <ShieldCheck className="h-3 w-3 shrink-0" />
                                    )}
                                    <span>
                                        {calibrationAudit.sx.toFixed(2)}×{calibrationAudit.sz.toFixed(2)} mm
                                    </span>
                                </button>

                                {calibrationMenuOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-40"
                                            onClick={() => setCalibrationMenuOpen(false)}
                                        />
                                        <div className="absolute left-0 mt-1.5 w-80 rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur-xl shadow-2xl p-3 z-50 text-[11px] space-y-2">
                                            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                                                <span className="font-bold text-white flex items-center gap-1.5">
                                                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                                    Auditoría Metrológica DICOM
                                                </span>
                                                <span className="text-[9px] font-mono text-slate-400">PS3.3 LPS</span>
                                            </div>
                                            <p
                                                className={`text-[10px] leading-snug p-2 rounded-md border ${
                                                    calibrationAudit.status === "estimated_isotropic"
                                                        ? "bg-amber-950/50 border-amber-500/40 text-amber-200"
                                                        : "bg-emerald-950/40 border-emerald-500/30 text-emerald-200"
                                                }`}
                                            >
                                                <strong>{calibrationAudit.label}</strong>
                                                <br />
                                                {calibrationAudit.detail}
                                            </p>
                                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-300 font-mono">
                                                <span className="text-slate-500">Matriz:</span>
                                                <span>{calibrationAudit.matrixDims.join(" × ")}</span>
                                                <span className="text-slate-500">Fuente X/Y:</span>
                                                <span className="truncate" title={calibrationAudit.pixelSpacingSource}>
                                                    {calibrationAudit.pixelSpacingSource}
                                                </span>
                                                <span className="text-slate-500">Fuente Z:</span>
                                                <span className="truncate" title={calibrationAudit.zSpacingSource}>
                                                    {calibrationAudit.zSpacingSource}
                                                </span>
                                                <span className="text-slate-500">Orientación:</span>
                                                <span>
                                                    {calibrationAudit.orientationName}{" "}
                                                    {calibrationAudit.lpsVerified ? "(LPS ✓)" : ""}
                                                </span>
                                                <span className="text-slate-500">Continuidad:</span>
                                                <span className={calibrationAudit.hasGaps ? "text-amber-300" : "text-emerald-300"}>
                                                    {calibrationAudit.hasGaps
                                                        ? `${calibrationAudit.gapCount} salto(s) máx ${calibrationAudit.maxGapMm.toFixed(2)} mm`
                                                        : "Uniforme sin saltos"}
                                                </span>
                                                <span className="text-slate-500">Equipo:</span>
                                                <span className="truncate" title={calibrationAudit.manufacturer}>
                                                    {calibrationAudit.manufacturer}
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Grupo B: Herramientas Clínicas + Medición + Nervio + Arco + Filtros */}
                    <div className="flex items-center gap-1 flex-wrap">
                        <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800">
                            <Button
                                size="sm"
                                variant={activeTool === "navigate" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "navigate"
                                        ? "bg-blue-600 text-white font-medium"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("navigate")}
                                disabled={loading || !!errorMsg}
                                title="Explorar cortes y mover la Ventana de cortes sincronizada"
                            >
                                <Layers className="h-3 w-3" />
                                <span className="hidden xl:inline">Cortes</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "pan" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "pan"
                                        ? "bg-blue-600 text-white font-medium"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("pan")}
                                disabled={loading || !!errorMsg}
                                title="Mover encuadre y hacer zoom con la rueda"
                            >
                                <Move className="h-3 w-3" />
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "wl" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "wl"
                                        ? "bg-blue-600 text-white font-medium"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("wl")}
                                disabled={loading || !!errorMsg}
                                title="Ajustar brillo y contraste (Window/Level)"
                            >
                                <Sun className="h-3 w-3" />
                            </Button>

                            <div className="h-3.5 w-px bg-slate-800 mx-0.5" />

                            <Button
                                size="sm"
                                variant={activeTool === "ruler" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    activeTool === "ruler"
                                        ? "bg-cyan-600 text-white font-semibold"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("ruler")}
                                disabled={loading || !!errorMsg}
                                title="Regla calibrada en mm con lupa 3× de precisión y densidad ósea"
                            >
                                <Ruler className="h-3 w-3" />
                                <span>Medir</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "angle" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "angle"
                                        ? "bg-amber-600 text-white font-semibold"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("angle")}
                                disabled={loading || !!errorMsg}
                                title="Goniómetro: medir inclinación radicular o eje de implante (°)"
                            >
                                <Compass className="h-3 w-3" />
                                <span className="hidden 2xl:inline">Ángulo</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "polyline" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "polyline"
                                        ? "bg-emerald-600 text-white font-semibold"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("polyline")}
                                disabled={loading || !!errorMsg}
                                title="Polilínea curva (mm): medir longitud real de conductos radiculares curvos"
                            >
                                <Spline className="h-3 w-3" />
                                <span className="hidden 2xl:inline">Conducto</span>
                            </Button>

                            <div className="h-3.5 w-px bg-slate-800 mx-0.5" />

                            <Button
                                size="sm"
                                variant={activeTool === "nerve" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "nerve"
                                        ? "bg-orange-600 text-white font-semibold"
                                        : nervePoints3D.length > 0
                                        ? "text-orange-300 hover:text-white hover:bg-slate-800"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool(activeTool === "nerve" ? "navigate" : "nerve")}
                                disabled={loading || !!errorMsg}
                                title="Trazar canal del Nervio Dentario Inferior (visible simultáneamente en 3D, Panorama y Transversales)"
                            >
                                <Activity className="h-3 w-3" />
                                <span className="hidden lg:inline">Nervio</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "editArch" ? "default" : "ghost"}
                                className={`h-6 px-1.5 text-[11px] gap-1 rounded-md ${
                                    activeTool === "editArch"
                                        ? "bg-sky-600 text-white font-semibold"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool(activeTool === "editArch" ? "navigate" : "editArch")}
                                disabled={loading || !!errorMsg || !archModel}
                                title="Editar manualmente los puntos de la curva del arco dental en la vista Axial"
                            >
                                <span className="text-[10px] font-bold">Arco</span>
                            </Button>

                            {/* Lista Auditable de Medidas y Nervio */}
                            {(totalMeasurementsCount > 0 || nervePoints3D.length > 0) && (
                                <div className="relative">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-1.5 text-[11px] text-cyan-300 hover:text-white hover:bg-slate-800 gap-1 rounded-md"
                                        onClick={() => {
                                            setMeasuresMenuOpen((v) => !v)
                                            setFiltersMenuOpen(false)
                                            setCalibrationMenuOpen(false)
                                        }}
                                        title="Ver lista auditable de mediciones y saltar a cada corte exacto"
                                    >
                                        <ListChecks className="h-3 w-3" />
                                        <span className="font-mono">{totalMeasurementsCount}</span>
                                    </Button>

                                    {measuresMenuOpen && (
                                        <>
                                            <div
                                                className="fixed inset-0 z-40"
                                                onClick={() => setMeasuresMenuOpen(false)}
                                            />
                                            <div className="absolute right-0 mt-1.5 w-72 rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur-xl shadow-2xl p-2.5 z-50 text-xs space-y-2">
                                                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                                                    <span className="font-semibold text-white">
                                                        Mediciones ({totalMeasurementsCount})
                                                    </span>
                                                    {totalMeasurementsCount > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={handleClearAllMeasurements}
                                                            className="text-[10px] text-rose-400 hover:underline"
                                                        >
                                                            Borrar todas
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="max-h-52 overflow-y-auto space-y-1">
                                                    {allMeasurementsFlat.map((item, idx) => (
                                                        <div
                                                            key={item.m.id}
                                                            className="flex items-center justify-between gap-1.5 p-1.5 rounded bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40"
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => handleJumpToMeasurement(item.viewKey, item.m)}
                                                                className="flex-1 text-left min-w-0"
                                                                title="Clic para saltar al corte exacto de esta medición"
                                                            >
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="font-mono font-bold text-cyan-300">
                                                                        #{idx + 1} · {getMeasurementSummaryValue(item.m)}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[9px] text-slate-400 truncate">
                                                                    {item.m.sliceLabel || item.viewTitle}
                                                                </div>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleDeleteSingleMeasurement(item.viewKey, item.m.id)
                                                                }
                                                                className="p-1 text-slate-500 hover:text-rose-400"
                                                                title="Eliminar medición"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>

                                                {nervePoints3D.length > 0 && (
                                                    <div className="border-t border-slate-800 pt-1.5 flex items-center justify-between text-[10px]">
                                                        <span className="text-orange-300 font-medium">
                                                            Nervio Dentario: {nervePoints3D.length} punto(s)
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setNervePoints3D([])}
                                                            className="text-rose-400 hover:underline"
                                                        >
                                                            Limpiar
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Zoom y Reset */}
                        <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                onClick={() => setExternalZoomStep((s) => s - 1)}
                                disabled={loading || !!errorMsg}
                                title="Alejar (-)"
                            >
                                <ZoomOut className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                onClick={() => setExternalZoomStep((s) => s + 1)}
                                disabled={loading || !!errorMsg}
                                title="Acercar (+)"
                            >
                                <ZoomIn className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                onClick={handleResetView}
                                disabled={loading || !!errorMsg}
                                title="Restablecer zoom, posición, inclinación y contraste óptimo"
                            >
                                <RotateCcw className="h-3 w-3" />
                            </Button>
                        </div>

                        {/* Menú Agrupado: Filtros Óseos, Grosor MPR y Mapa de Color */}
                        <div className="relative">
                            <Button
                                size="sm"
                                variant="outline"
                                className={`h-7 px-2 text-[11px] gap-1 rounded-lg border ${
                                    activeWlPreset !== "auto" || activeColorMap !== "plain"
                                        ? "border-indigo-500/60 bg-indigo-950/60 text-indigo-200 hover:bg-indigo-900/70"
                                        : "border-slate-800 bg-slate-950/90 text-slate-300 hover:bg-slate-800 hover:text-white"
                                }`}
                                onClick={() => {
                                    setFiltersMenuOpen((prev) => !prev)
                                    setCalibrationMenuOpen(false)
                                    setMeasuresMenuOpen(false)
                                }}
                                disabled={loading || !!errorMsg}
                                title="Preajustes de densidad ósea, grosor MPR, nitidez cortical 16-bit y mapa de color"
                            >
                                <SlidersHorizontal className="h-3 w-3 text-indigo-400" />
                                <span className="font-semibold text-white">
                                    {activePresetLabel}
                                    {activeColorLabel}
                                </span>
                                <ChevronDown
                                    className={`h-3 w-3 text-slate-400 transition-transform ${
                                        filtersMenuOpen ? "rotate-180" : ""
                                    }`}
                                />
                            </Button>

                            {filtersMenuOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setFiltersMenuOpen(false)}
                                    />
                                    <div className="absolute right-0 mt-1.5 w-72 rounded-xl border border-slate-700/90 bg-slate-900/98 backdrop-blur-xl shadow-2xl p-3 z-50 text-xs space-y-3">
                                        <div>
                                            <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                <span>Densidad Ósea (16-bit W/L)</span>
                                                <span className="font-mono text-[9px] text-indigo-400">
                                                    W:{sliceWl.width} L:{sliceWl.center}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-1">
                                                {[
                                                    { id: "auto" as WlPresetId, label: "Óptimo CBCT", desc: "Balance raíces/cortical" },
                                                    { id: "bone" as WlPresetId, label: "Dientes / Hueso", desc: "Trabécula y ligamento" },
                                                    { id: "enamel" as WlPresetId, label: "Esmalte / Metal", desc: "Conductos e implantes" },
                                                    { id: "soft" as WlPresetId, label: "Tejidos / Senos", desc: "Mucosa y vías aéreas" },
                                                ].map((item) => (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        onClick={() => {
                                                            handleWlPresetChange(item.id)
                                                            setFiltersMenuOpen(false)
                                                        }}
                                                        className={`flex flex-col items-start px-2 py-1.5 rounded-lg border text-left transition-all ${
                                                            activeWlPreset === item.id
                                                                ? "bg-indigo-600/25 border-indigo-500 text-white"
                                                                : "bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800"
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between w-full">
                                                            <span className="font-semibold text-[11px]">{item.label}</span>
                                                            {activeWlPreset === item.id && (
                                                                <Check className="h-3 w-3 text-indigo-400 shrink-0" />
                                                            )}
                                                        </div>
                                                        <span className="text-[9px] text-slate-400">{item.desc}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="border-t border-slate-800 pt-2">
                                            <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                Grosor de Integración MPR
                                            </div>
                                            <div className="grid grid-cols-4 gap-1">
                                                {[
                                                    { mm: 0, label: "0.2 mm" },
                                                    { mm: 1.0, label: "1.0 mm" },
                                                    { mm: 2.0, label: "2.0 mm" },
                                                    { mm: 5.0, label: "5.0 mm" },
                                                ].map((opt) => (
                                                    <button
                                                        key={opt.mm}
                                                        type="button"
                                                        onClick={() => setMprSlabMm(opt.mm)}
                                                        className={`py-1 px-1.5 rounded-md border text-[10px] font-mono ${
                                                            mprSlabMm === opt.mm
                                                                ? "bg-cyan-600/30 border-cyan-500 text-cyan-200 font-semibold"
                                                                : "bg-slate-950/70 border-slate-800 text-slate-400 hover:text-white"
                                                        }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="border-t border-slate-800 pt-2">
                                            <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                <span>Mapa de Color y Nitidez</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSharpenEnabled((s) => !s)}
                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                                        sharpenEnabled
                                                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                                                            : "bg-slate-800 border-slate-700 text-slate-400"
                                                    }`}
                                                >
                                                    Nitidez 16-bit: {sharpenEnabled ? "ON" : "OFF"}
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-3 gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveColorMap("plain")
                                                        setFiltersMenuOpen(false)
                                                    }}
                                                    className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-medium ${
                                                        activeColorMap === "plain"
                                                            ? "bg-blue-600/25 border-blue-500 text-white"
                                                            : "bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800"
                                                    }`}
                                                >
                                                    <span>Grises</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveColorMap(activeColorMap === "hot" ? "plain" : "hot")
                                                        setFiltersMenuOpen(false)
                                                    }}
                                                    className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-medium ${
                                                        activeColorMap === "hot"
                                                            ? "bg-amber-600/30 border-amber-500 text-amber-200"
                                                            : "bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800"
                                                    }`}
                                                >
                                                    <Sparkles className="h-3 w-3 text-amber-400" />
                                                    <span>Térmico</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveColorMap(
                                                            activeColorMap === "invPlain" ? "plain" : "invPlain"
                                                        )
                                                        setFiltersMenuOpen(false)
                                                    }}
                                                    className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-medium ${
                                                        activeColorMap === "invPlain"
                                                            ? "bg-slate-700 border-slate-400 text-white"
                                                            : "bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800"
                                                    }`}
                                                >
                                                    <Palette className="h-3 w-3 text-cyan-400" />
                                                    <span>Invertir</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Grupo C: Cortes Preparados + Guardar Escena + Descarga + Pantalla Completa + Cerrar */}
                    <div className="flex items-center gap-1 shrink-0">
                        {resultFileId && clinicalVol && (canEditScene || savedCuts.length > 0) && (
                            <SavedCutsMenu
                                savedCuts={savedCuts}
                                canEdit={canEditScene}
                                isSaving={isSavingScene}
                                saveFeedback={saveFeedback}
                                saveErrorMsg={saveErrorMsg}
                                hasUnsavedChanges={hasUnsavedChanges}
                                suggestedCutName={`${selectedToothLabel.split("(")[0].trim()} · ${archS.toFixed(1)} mm`}
                                lastSavedBy={sceneMeta?.updatedByName}
                                lastSavedAt={sceneMeta?.updatedAt}
                                onAddCurrentCut={handleAddCurrentCut}
                                onApplyCut={handleApplySavedCut}
                                onDeleteCut={handleDeleteSavedCut}
                                onSaveScene={handleSaveClinicalScene}
                            />
                        )}

                        {downloadUrl && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg"
                                onClick={() => window.open(downloadUrl, "_blank")}
                                title="Descargar paquete DICOM completo"
                            >
                                <Download className="h-3 w-3" />
                                <span className="hidden xl:inline">Descargar</span>
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 border-slate-800 bg-slate-950/90 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
                            onClick={toggleFullscreen}
                            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                        >
                            {isFullscreen ? (
                                <Minimize2 className="h-3.5 w-3.5" />
                            ) : (
                                <Maximize2 className="h-3.5 w-3.5" />
                            )}
                        </Button>

                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-rose-950/60 hover:text-rose-300 rounded-lg"
                            onClick={() => onOpenChange(false)}
                            title="Cerrar visor"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Franja compacta de acceso rápido a Cortes Específicos Preparados (solo visible si el estudio tiene cortes guardados) */}
                {!loading && !errorMsg && savedCuts.length > 0 && (
                    <div className="px-3 py-1 bg-sky-950/35 border-b border-sky-900/60 flex items-center gap-1.5 overflow-x-auto shrink-0">
                        <span className="text-[10px] font-semibold text-sky-300 shrink-0 flex items-center gap-1">
                            Cortes preparados{sceneMeta?.updatedByName ? ` (${sceneMeta.updatedByName})` : ""}:
                        </span>
                        {savedCuts.map((cut, idx) => (
                            <button
                                key={cut.id}
                                type="button"
                                onClick={() => handleApplySavedCut(cut)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors shrink-0 ${
                                    activeCutId === cut.id
                                        ? "bg-sky-600 border-sky-400 text-white font-semibold"
                                        : "bg-slate-900/90 border-slate-700 text-slate-200 hover:border-sky-500/60 hover:text-white"
                                }`}
                                title={cut.note ? `${cut.name} — ${cut.note}` : cut.name}
                            >
                                {idx + 1}. {cut.name}
                            </button>
                        ))}
                    </div>
                )}

                {/* 2. Área Principal de Espacios de Trabajo Clínicos */}
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none touch-none">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-40 gap-3.5 p-6 text-center">
                            <div className="relative">
                                <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-lg">
                                    <Layers className="h-8 w-8 text-blue-400 animate-pulse" />
                                </div>
                                <Loader2 className="h-6 w-6 animate-spin text-blue-500 absolute -bottom-1 -right-1" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-semibold text-slate-200">{loadStep}</p>
                                <p className="text-xs text-slate-400">
                                    Auditoría metrológica LPS + Reconstrucción 16-bit (GALILEOS e InVivoViewer)
                                </p>
                            </div>
                            <div className="w-64 max-w-[80vw] bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/50">
                                <div
                                    className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-full transition-all duration-300 rounded-full"
                                    style={{ width: `${loadProgress}%` }}
                                />
                            </div>
                            <span className="text-xs font-mono text-slate-400">{loadProgress}%</span>
                        </div>
                    )}

                    {errorMsg && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-40 gap-3 p-6 text-center max-w-md mx-auto">
                            <AlertCircle className="h-12 w-12 text-rose-500" />
                            <h4 className="text-base font-semibold text-white">No se pudo cargar la tomografía</h4>
                            <p className="text-xs text-slate-400">{errorMsg}</p>
                            {downloadUrl && (
                                <Button
                                    size="sm"
                                    className="mt-2 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                                    onClick={() => window.open(downloadUrl, "_blank")}
                                >
                                    <Download className="h-4 w-4" />
                                    Descargar archivo DICOM para visor local
                                </Button>
                            )}
                        </div>
                    )}

                    {/* WORKSPACE A: Cortes del Estudio (Series Secundarias + Láminas PDF/JPG + Selector de Volúmenes) */}
                    {!loading && !errorMsg && viewMode === "study_cuts" && (
                        <StudyCutsGallery
                            volumetricSeries={volumetricSeriesList}
                            activeVolumeId={activeVolumeId}
                            onSelectVolume={(id) => {
                                const found = volumetricSeriesList.find((s) => s.id === id)
                                if (found) activateVolumetricSeries(found)
                            }}
                            secondarySeries={secondarySeriesList}
                            clinicalSheets={clinicalSheets}
                            onBackTo3D={() => setViewMode("multi")}
                        />
                    )}

                    {/* WORKSPACE B: InVivo MPR Ortogonal (Axial + Coronal + Sagital + 3D) */}
                    {!loading && !errorMsg && viewMode === "invivo_mpr" && clinicalVol && (
                        <InVivoMprWorkspace
                            clinicalVol={clinicalVol}
                            renderVolume={renderVolume}
                            reconStatus={reconStatus}
                            axialImg={axialImg}
                            axialH={axialH}
                            setAxialH={setAxialH}
                            sagittalX={sagittalX}
                            setSagittalX={setSagittalX}
                            coronalY={coronalY}
                            setCoronalY={setCoronalY}
                            slabMm={mprSlabMm}
                            slabMode={invivoSlabMode}
                            setSlabMode={setInvivoSlabMode}
                            sliceWl={sliceWl}
                            colorMap={activeColorMap}
                            sharpen={sharpenEnabled}
                            activeTool={activeTool}
                            isEstimatedCalibration={isEstimatedCalibration}
                            measurementsByView={measurementsByView}
                            onUpdateViewMeasurements={updateViewMeasurements}
                            onAdjustSliceWl={handleAdjustSliceWl}
                            nervePoints3D={nervePoints3D}
                            nervePointsNorm={nervePointsNorm}
                            onAddNervePoint3D={handleAddNervePoint3D}
                            currentSliceIndex={currentSliceIndex}
                            totalSlices={totalSlices}
                            resetTrigger={resetTrigger}
                            externalZoomStep={externalZoomStep}
                        />
                    )}

                    {/* WORKSPACE C: InVivo Cortes Seriados (Panorama + Axial + 6 Cortes Transversales Consecutivos) */}
                    {!loading && !errorMsg && viewMode === "invivo_serial" && clinicalVol && archModel && (
                        <InVivoArchSerialWorkspace
                            clinicalVol={clinicalVol}
                            archModel={archModel}
                            panoramaImage={panoramaImage}
                            axialImg={axialImg}
                            archS={archS}
                            setArchS={setArchS}
                            axialH={axialH}
                            setAxialH={setAxialH}
                            serialSpacingMm={serialSpacingMm}
                            setSerialSpacingMm={setSerialSpacingMm}
                            mprSlabMm={mprSlabMm}
                            crossHalfWidthMm={CROSS_HALF_WIDTH_MM}
                            sliceWindowBounds={sliceWindowBounds}
                            sliceWl={sliceWl}
                            panoWl={panoWl}
                            colorMap={activeColorMap}
                            sharpen={sharpenEnabled}
                            activeTool={activeTool}
                            isEstimatedCalibration={isEstimatedCalibration}
                            measurementsByView={measurementsByView}
                            onUpdateViewMeasurements={updateViewMeasurements}
                            onAdjustSliceWl={handleAdjustSliceWl}
                            onAdjustPanoWl={handleAdjustPanoWl}
                            onMoveArchControlPoint={handleMoveArchControlPoint}
                            nervePoints3D={nervePoints3D}
                            onAddNervePoint3D={handleAddNervePoint3D}
                            renderAxialOverlay={renderAxialOverlay}
                            resetTrigger={resetTrigger}
                            externalZoomStep={externalZoomStep}
                        />
                    )}

                    {/* WORKSPACE D: Modo GALILEOS (5 Vistas simultáneas o vista individual expandida) */}
                    {viewMode !== "study_cuts" &&
                        viewMode !== "invivo_mpr" &&
                        viewMode !== "invivo_serial" && (
                            <div className="w-full h-full flex flex-col p-1 gap-1 bg-black">
                                {/* FILA SUPERIOR: Panorama (62%) + 3D Volumétrico (38%) */}
                                <div
                                    className={`min-h-0 gap-1 flex flex-col md:flex-row ${
                                        viewMode === "multi"
                                            ? "flex-[52]"
                                            : viewMode === "panorama" || viewMode === "3d"
                                            ? "flex-1 h-full"
                                            : "hidden"
                                    }`}
                                >
                                    {/* PANEL 1: PANORAMA */}
                                    <div
                                        className={`min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-[#03060c] shadow-md flex flex-col ${
                                            viewMode === "multi"
                                                ? "flex-[62]"
                                                : viewMode === "panorama"
                                                ? "w-full h-full flex-1"
                                                : "hidden"
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 z-20 text-[11px] shrink-0 gap-1">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30 text-[10px] shrink-0">
                                                    Panorama
                                                </span>
                                                <span className="text-slate-300 font-medium truncate text-[11px]">
                                                    {selectedToothLabel}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1 flex-wrap">
                                                <div className="flex items-center bg-slate-950/90 rounded border border-slate-800 p-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPanoMode("mean")}
                                                        className={`px-1.5 py-0.2 text-[9px] rounded font-medium transition-colors ${
                                                            panoMode === "mean"
                                                                ? "bg-blue-600 text-white"
                                                                : "text-slate-400 hover:text-white"
                                                        }`}
                                                    >
                                                        Rx
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setPanoMode("mip")}
                                                        className={`px-1.5 py-0.2 text-[9px] rounded font-medium transition-colors ${
                                                            panoMode === "mip"
                                                                ? "bg-blue-600 text-white"
                                                                : "text-slate-400 hover:text-white"
                                                        }`}
                                                    >
                                                        MIP
                                                    </button>
                                                </div>

                                                <div className="hidden sm:flex items-center bg-slate-950/90 rounded border border-slate-800 p-0.5">
                                                    {[2, 12, 18, 25].map((mm) => (
                                                        <button
                                                            key={mm}
                                                            type="button"
                                                            onClick={() => setPanoThickness(mm)}
                                                            className={`px-1.5 py-0.2 text-[9px] rounded font-mono transition-colors ${
                                                                panoThickness === mm
                                                                    ? "bg-cyan-600 text-white"
                                                                    : "text-slate-400 hover:text-white"
                                                            }`}
                                                        >
                                                            {mm}mm
                                                        </button>
                                                    ))}
                                                </div>

                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                                                    onClick={() => {
                                                        if (archModel) {
                                                            setArchS(archModel.length * 0.16)
                                                            setArchD(0)
                                                        }
                                                    }}
                                                >
                                                    Molares Der.
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                                                    onClick={() => {
                                                        if (archModel) {
                                                            setArchS(archModel.length * 0.5)
                                                            setArchD(0)
                                                        }
                                                    }}
                                                >
                                                    Incisivos
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                                                    onClick={() => {
                                                        if (archModel) {
                                                            setArchS(archModel.length * 0.84)
                                                            setArchD(0)
                                                        }
                                                    }}
                                                >
                                                    Molares Izq.
                                                </Button>

                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 w-5 p-0 text-slate-400 hover:text-white"
                                                    onClick={() =>
                                                        setViewMode(viewMode === "multi" ? "panorama" : "multi")
                                                    }
                                                >
                                                    {viewMode === "panorama" ? (
                                                        <Minimize2 className="h-3 w-3" />
                                                    ) : (
                                                        <Maximize2 className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>

                                        <MprViewport
                                            viewId="panorama"
                                            image={panoramaImage}
                                            slope={clinicalVol?.slope ?? 1}
                                            intercept={clinicalVol?.intercept ?? 0}
                                            windowLevel={panoWl}
                                            colorMap={activeColorMap}
                                            sharpen={sharpenEnabled}
                                            activeTool={activeTool}
                                            measurements={measurementsByView.panorama}
                                            onChangeMeasurements={(next) => updateViewMeasurements("panorama", next)}
                                            currentSliceLabel="Panorama CPR"
                                            isEstimatedCalibration={isEstimatedCalibration}
                                            isCurvedProjection
                                            onAdjustWindowLevel={handleAdjustPanoWl}
                                            onWheelStep={(steps) => stepFocusedPlane(steps, "cross")}
                                            onNavigateMm={handleNavigatePanorama}
                                            onAddNervePointMm={(xMm, yMm) => {
                                                if (!archModel || !clinicalVol || !panoramaImage) return
                                                const f = archFrame(archModel, xMm)
                                                const h = Math.max(0, Math.min(clinicalVol.heightMm, panoramaImage.hTop - yMm))
                                                handleAddNervePoint3D([f.x, f.y, zFromH(clinicalVol, h)])
                                            }}
                                            renderOverlay={renderPanoramaOverlay}
                                            scaleBarCm={1}
                                            bottomLeftBadge="R"
                                            emptyText={reconStatus || "Reconstruyendo Panorámica CPR..."}
                                            resetTrigger={resetTrigger}
                                            externalZoomStep={externalZoomStep}
                                        />
                                    </div>

                                    {/* PANEL 2: 3D VOLUMÉTRICO INTERACTIVO */}
                                    <div
                                        className={`min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-black shadow-md flex flex-col ${
                                            viewMode === "multi"
                                                ? "flex-[38]"
                                                : viewMode === "3d"
                                                ? "w-full h-full flex-1"
                                                : "hidden"
                                        }`}
                                    >
                                        <Dental3DViewer
                                            volume={renderVolume}
                                            status={reconStatus}
                                            focus={volumeFocus}
                                            nervePointsNorm={nervePointsNorm}
                                            sliceIndex={currentSliceIndex}
                                            totalSlices={totalSlices}
                                            isExpanded={viewMode === "3d"}
                                            onToggleExpand={() =>
                                                setViewMode(viewMode === "multi" ? "3d" : "multi")
                                            }
                                        />
                                    </div>
                                </div>

                                {/* FILA INFERIOR: Tangencial + Sección Transversal + Axial */}
                                <div
                                    className={`min-h-0 gap-1 flex flex-col md:flex-row ${
                                        viewMode === "multi"
                                            ? "flex-[48]"
                                            : viewMode === "tangential" ||
                                              viewMode === "cross" ||
                                              viewMode === "axial"
                                            ? "flex-1 h-full"
                                            : "hidden"
                                    }`}
                                >
                                    {/* PANEL 3: TANGENCIAL (Plano 3D Certificado vs Curvo + Inclinación) */}
                                    <div
                                        onPointerDown={() => setFocusedPlane("tangential")}
                                        className={`min-w-0 min-h-0 border rounded-lg overflow-hidden bg-[#03060c] shadow-md flex flex-col relative ${
                                            focusedPlane === "tangential" && viewMode === "multi"
                                                ? "border-emerald-500/70"
                                                : "border-slate-800"
                                        } ${
                                            viewMode === "multi"
                                                ? "flex-1"
                                                : viewMode === "tangential"
                                                ? "w-full h-full flex-1"
                                                : "hidden"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between px-2 py-1 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0 gap-1">
                                            <div className="flex items-center gap-1 min-w-0">
                                                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px] shrink-0">
                                                    Tangencial
                                                </span>
                                                <span className="text-slate-300 font-mono truncate text-[10px]">
                                                    {archD >= 0 ? `+${archD.toFixed(1)}` : archD.toFixed(1)} mm
                                                    {tangentialTiltDeg !== 0 ? ` · ${tangentialTiltDeg}°` : ""}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {/* Toggle Plano 3D Certificado (para medir) vs Curvo */}
                                                <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 text-[9px]">
                                                    <button
                                                        type="button"
                                                        onClick={() => setTangentialMode("flat")}
                                                        className={`px-1 py-0.2 rounded ${
                                                            tangentialMode === "flat"
                                                                ? "bg-emerald-600 text-white font-semibold"
                                                                : "text-slate-400 hover:text-white"
                                                        }`}
                                                        title="Plano 3D recto certificado (distancias euclidianas 100% reales al medir)"
                                                    >
                                                        Plano
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setTangentialMode("curved")}
                                                        className={`px-1 py-0.2 rounded ${
                                                            tangentialMode === "curved"
                                                                ? "bg-emerald-600 text-white font-semibold"
                                                                : "text-slate-400 hover:text-white"
                                                        }`}
                                                        title="Corte curvo siguiendo el arco para ver 4-5 piezas simultáneas en foco"
                                                    >
                                                        Curvo
                                                    </button>
                                                </div>

                                                {tangentialMode === "flat" && (
                                                    <input
                                                        type="range"
                                                        min={-25}
                                                        max={25}
                                                        step={1}
                                                        value={tangentialTiltDeg}
                                                        onChange={(e) => setTangentialTiltDeg(parseInt(e.target.value, 10))}
                                                        className="w-12 accent-emerald-400 cursor-pointer hidden xl:block"
                                                        title={`Inclinación buco-lingual del plano tangencial (${tangentialTiltDeg}°)`}
                                                    />
                                                )}

                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1 text-[10px] text-slate-300 hover:text-white gap-1"
                                                    onClick={() =>
                                                        setViewMode(viewMode === "multi" ? "tangential" : "multi")
                                                    }
                                                >
                                                    {viewMode === "tangential" ? (
                                                        <Minimize2 className="h-3 w-3" />
                                                    ) : (
                                                        <Maximize2 className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="flex-1 min-h-0 flex flex-row relative">
                                            <MprViewport
                                                viewId="tangential"
                                                image={tangentialImg}
                                                slope={clinicalVol?.slope ?? 1}
                                                intercept={clinicalVol?.intercept ?? 0}
                                                windowLevel={sliceWl}
                                                colorMap={activeColorMap}
                                                sharpen={sharpenEnabled}
                                                activeTool={activeTool}
                                                measurements={measurementsByView.tangential}
                                                onChangeMeasurements={(next) =>
                                                    updateViewMeasurements("tangential", next)
                                                }
                                                currentSliceCoord={archD}
                                                currentSliceLabel={`Tangencial ${archD >= 0 ? "+" : ""}${archD.toFixed(1)} mm`}
                                                isEstimatedCalibration={isEstimatedCalibration}
                                                isCurvedProjection={tangentialMode === "curved"}
                                                onAdjustWindowLevel={handleAdjustSliceWl}
                                                onWheelStep={(steps) => stepFocusedPlane(steps, "tangential")}
                                                onNavigateMm={handleNavigateTangential}
                                                onAddNervePointMm={(xMm, yMm) => {
                                                    if (!tangentialImg?.planeSpec) return
                                                    const sp = tangentialImg.planeSpec
                                                    const pt: Vec3 = [
                                                        sp.origin[0] + sp.u[0] * xMm + sp.v[0] * yMm,
                                                        sp.origin[1] + sp.u[1] * xMm + sp.v[1] * yMm,
                                                        sp.origin[2] + sp.u[2] * xMm + sp.v[2] * yMm,
                                                    ]
                                                    handleAddNervePoint3D(pt)
                                                }}
                                                renderOverlay={renderTangentialOverlay}
                                                scaleBarCm={1}
                                                resetTrigger={resetTrigger}
                                                externalZoomStep={externalZoomStep}
                                            />

                                            <div
                                                onPointerDown={(e) => e.stopPropagation()}
                                                className="w-5 bg-slate-900/90 border-l border-slate-800/80 flex flex-col items-center justify-between py-1.5 select-none shrink-0"
                                                title="Desplazamiento buco-lingual del corte tangencial (-12 a +12 mm)"
                                            >
                                                <span className="text-[8px] font-mono text-slate-400">V</span>
                                                <input
                                                    type="range"
                                                    min={-MAX_ARCH_OFFSET_D_MM}
                                                    max={MAX_ARCH_OFFSET_D_MM}
                                                    step={0.25}
                                                    value={archD}
                                                    onChange={(e) => setArchD(parseFloat(e.target.value))}
                                                    className="h-24 w-3 accent-cyan-400 cursor-pointer"
                                                    style={{ writingMode: "vertical-lr", direction: "rtl" }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setArchD(0)}
                                                    className="text-[8px] font-mono text-cyan-400 hover:underline"
                                                    title="Centrar en el arco (0 mm)"
                                                >
                                                    0
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* PANEL 4: SECCIÓN TRANSVERSAL */}
                                    <div
                                        onPointerDown={() => setFocusedPlane("cross")}
                                        className={`min-w-0 min-h-0 border rounded-lg overflow-hidden bg-[#03060c] shadow-md flex flex-col relative ${
                                            focusedPlane === "cross" && viewMode === "multi"
                                                ? "border-purple-500/70"
                                                : "border-slate-800"
                                        } ${
                                            viewMode === "multi"
                                                ? "flex-1"
                                                : viewMode === "cross"
                                                ? "w-full h-full flex-1"
                                                : "hidden"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between px-2 py-1 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0 gap-1">
                                            <div className="flex items-center gap-1 min-w-0">
                                                <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-[10px] shrink-0">
                                                    Transversal
                                                </span>
                                                <span className="text-slate-300 font-mono truncate text-[10px]">
                                                    {archS.toFixed(1)} / {(archModel?.length || 100).toFixed(0)} mm
                                                    {crossTiltDeg !== 0 ? ` · ${crossTiltDeg}°` : ""}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <input
                                                    type="range"
                                                    min={-25}
                                                    max={25}
                                                    step={1}
                                                    value={crossTiltDeg}
                                                    onChange={(e) => setCrossTiltDeg(parseInt(e.target.value, 10))}
                                                    className="w-12 accent-purple-400 cursor-pointer hidden xl:block"
                                                    title={`Inclinación mesio-distal del eje radicular (${crossTiltDeg}°)`}
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1 text-[10px] text-slate-300 hover:text-white gap-1"
                                                    onClick={() =>
                                                        setViewMode(viewMode === "multi" ? "cross" : "multi")
                                                    }
                                                >
                                                    {viewMode === "cross" ? (
                                                        <Minimize2 className="h-3 w-3" />
                                                    ) : (
                                                        <Maximize2 className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="flex-1 min-h-0 flex flex-row relative">
                                            <MprViewport
                                                viewId="cross"
                                                image={crossImg}
                                                slope={clinicalVol?.slope ?? 1}
                                                intercept={clinicalVol?.intercept ?? 0}
                                                windowLevel={sliceWl}
                                                colorMap={activeColorMap}
                                                sharpen={sharpenEnabled}
                                                activeTool={activeTool}
                                                measurements={measurementsByView.cross}
                                                onChangeMeasurements={(next) =>
                                                    updateViewMeasurements("cross", next)
                                                }
                                                currentSliceCoord={archS}
                                                currentSliceLabel={`Transversal ${archS.toFixed(1)} mm`}
                                                isEstimatedCalibration={isEstimatedCalibration}
                                                onAdjustWindowLevel={handleAdjustSliceWl}
                                                onWheelStep={(steps) => stepFocusedPlane(steps, "cross")}
                                                onNavigateMm={handleNavigateCross}
                                                onAddNervePointMm={(xMm, yMm) => {
                                                    if (!crossImg?.planeSpec) return
                                                    const sp = crossImg.planeSpec
                                                    const pt: Vec3 = [
                                                        sp.origin[0] + sp.u[0] * xMm + sp.v[0] * yMm,
                                                        sp.origin[1] + sp.u[1] * xMm + sp.v[1] * yMm,
                                                        sp.origin[2] + sp.u[2] * xMm + sp.v[2] * yMm,
                                                    ]
                                                    handleAddNervePoint3D(pt)
                                                }}
                                                renderOverlay={renderCrossOverlay}
                                                scaleBarCm={1}
                                                leftLabel="oral"
                                                rightLabel="labial/bucal"
                                                resetTrigger={resetTrigger}
                                                externalZoomStep={externalZoomStep}
                                            />

                                            <div
                                                onPointerDown={(e) => e.stopPropagation()}
                                                className="w-5 bg-slate-900/90 border-l border-slate-800/80 flex flex-col items-center justify-between py-1.5 select-none shrink-0"
                                                title="Recorrer posición a lo largo del arco dental (mm)"
                                            >
                                                <span className="text-[8px] font-mono text-slate-400">R</span>
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={Math.max(1, archModel?.length || 100)}
                                                    step={0.5}
                                                    value={archS}
                                                    onChange={(e) => setArchS(parseFloat(e.target.value))}
                                                    className="h-24 w-3 accent-cyan-400 cursor-pointer"
                                                    style={{ writingMode: "vertical-lr" }}
                                                />
                                                <span className="text-[8px] font-mono text-slate-400">L</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* PANEL 5: AXIAL (Con Edición Interactiva de Nodos del Arco Dental) */}
                                    <div
                                        onPointerDown={() => setFocusedPlane("axial")}
                                        className={`min-w-0 min-h-0 border rounded-lg overflow-hidden bg-[#03060c] shadow-md flex flex-col relative ${
                                            focusedPlane === "axial" && viewMode === "multi"
                                                ? "border-cyan-500/70"
                                                : "border-slate-800"
                                        } ${
                                            viewMode === "multi"
                                                ? "flex-1"
                                                : viewMode === "axial"
                                                ? "w-full h-full flex-1"
                                                : "hidden"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between px-2 py-1 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0 gap-1">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-[10px] shrink-0">
                                                    Axial
                                                </span>
                                                <span className="text-slate-300 font-mono truncate text-[10px]">
                                                    {currentSliceIndex + 1}/{totalSlices} ({axialH.toFixed(1)} mm)
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {activeTool === "editArch" && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setArchCtrlPts(initialArchCtrlPts)}
                                                        className="px-1.5 py-0.2 rounded bg-slate-800 text-[9px] text-cyan-300 hover:bg-slate-700"
                                                        title="Restaurar curva automática del arco dental"
                                                    >
                                                        Auto
                                                    </button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1 text-[10px] text-slate-300 hover:text-white"
                                                    onClick={() =>
                                                        setViewMode(viewMode === "multi" ? "axial" : "multi")
                                                    }
                                                >
                                                    {viewMode === "axial" ? (
                                                        <Minimize2 className="h-3 w-3" />
                                                    ) : (
                                                        <Maximize2 className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>

                                        <MprViewport
                                            viewId="axial"
                                            image={axialImg}
                                            slope={clinicalVol?.slope ?? 1}
                                            intercept={clinicalVol?.intercept ?? 0}
                                            windowLevel={sliceWl}
                                            colorMap={activeColorMap}
                                            sharpen={sharpenEnabled}
                                            activeTool={activeTool}
                                            measurements={measurementsByView.axial}
                                            onChangeMeasurements={(next) => updateViewMeasurements("axial", next)}
                                            currentSliceCoord={axialH}
                                            currentSliceLabel={`Axial ${axialH.toFixed(1)} mm`}
                                            isEstimatedCalibration={isEstimatedCalibration}
                                            archControlPoints={archCtrlPts}
                                            onMoveArchControlPoint={handleMoveArchControlPoint}
                                            onAdjustWindowLevel={handleAdjustSliceWl}
                                            onWheelStep={(steps) => stepFocusedPlane(steps, "axial")}
                                            onNavigateMm={handleNavigateAxial}
                                            onAddNervePointMm={(xMm, yMm) => {
                                                if (!clinicalVol) return
                                                handleAddNervePoint3D([xMm, yMm, zFromH(clinicalVol, axialH)])
                                            }}
                                            renderOverlay={renderAxialOverlay}
                                            scaleBarCm={5}
                                            bottomLeftBadge="R"
                                            rightLabel="L"
                                            topLabel="A"
                                            resetTrigger={resetTrigger}
                                            externalZoomStep={externalZoomStep}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                </div>

                {/* 3. Barra Inferior Compacta con Reproductor de Cine, Scrubber de Precisión y Saltos Anatómicos */}
                {clinicalVol &&
                    archModel &&
                    viewMode !== "study_cuts" &&
                    (() => {
                        const plane = activePlaneAfterViewMode

                        const activePlaneName =
                            plane === "tangential"
                                ? "TANGENCIAL"
                                : plane === "cross"
                                ? "TRANSVERSAL"
                                : "AXIAL"

                        const activePlaneBadgeClass =
                            plane === "tangential"
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : plane === "cross"
                                ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                                : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"

                        const sliderMin = plane === "tangential" ? -MAX_ARCH_OFFSET_D_MM : 0
                        const sliderMax =
                            plane === "tangential"
                                ? MAX_ARCH_OFFSET_D_MM
                                : plane === "cross"
                                ? Math.max(1, archModel.length)
                                : Math.max(1, clinicalVol.heightMm)
                        const sliderStep =
                            plane === "tangential" ? 0.25 : plane === "cross" ? 0.5 : Math.max(0.2, clinicalVol.sz)
                        const sliderVal =
                            plane === "tangential" ? archD : plane === "cross" ? archS : axialH

                        const handleSliderChange = (val: number) => {
                            if (plane === "tangential") setArchD(val)
                            else if (plane === "cross") setArchS(val)
                            else setAxialH(val)
                        }

                        const statusReadout =
                            plane === "axial"
                                ? `Corte ${currentSliceIndex + 1} / ${totalSlices}`
                                : plane === "cross"
                                ? `Arco ${archS.toFixed(1)} / ${archModel.length.toFixed(0)} mm`
                                : `Offset ${archD >= 0 ? "+" : ""}${archD.toFixed(1)} mm`

                        return (
                            <div className="px-2.5 sm:px-4 py-1.5 bg-slate-900/95 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setFocusedPlane((p) =>
                                                p === "axial" ? "cross" : p === "cross" ? "tangential" : "axial"
                                            )
                                        }
                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border cursor-pointer ${activePlaneBadgeClass}`}
                                        title="Clic para alternar qué plano controla esta barra (Axial / Transversal / Tangencial)"
                                    >
                                        {activePlaneName}
                                    </button>

                                    <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                            onClick={() => stepFocusedPlane(-8, plane)}
                                            disabled={loading}
                                        >
                                            <ChevronsLeft className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                            onClick={() => stepFocusedPlane(-1, plane)}
                                            disabled={loading}
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={isPlaying ? "destructive" : "default"}
                                            className={`h-6 px-2.5 text-[11px] gap-1 font-semibold rounded-md ${
                                                isPlaying
                                                    ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                                                    : "bg-blue-600 hover:bg-blue-700 text-white"
                                            }`}
                                            onClick={() => setIsPlaying(!isPlaying)}
                                            disabled={loading}
                                        >
                                            {isPlaying ? (
                                                <Pause className="h-3 w-3" />
                                            ) : (
                                                <Play className="h-3 w-3 fill-current" />
                                            )}
                                            <span>{isPlaying ? "Pausa" : "Reproducir"}</span>
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                            onClick={() => stepFocusedPlane(1, plane)}
                                            disabled={loading}
                                        >
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                            onClick={() => stepFocusedPlane(8, plane)}
                                            disabled={loading}
                                        >
                                            <ChevronsRight className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex-1 min-w-[150px] flex items-center gap-2.5 px-1">
                                    <Slider
                                        value={[sliderVal]}
                                        min={sliderMin}
                                        max={sliderMax}
                                        step={sliderStep}
                                        onValueChange={(val) => handleSliderChange(val[0])}
                                        className="flex-1 py-1 cursor-pointer"
                                    />
                                    <span className="px-2 py-0.5 rounded-md bg-slate-950/90 border border-slate-800 text-[11px] font-semibold text-blue-400 font-mono shrink-0 text-center">
                                        {statusReadout}
                                    </span>
                                </div>

                                <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 shrink-0">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                        onClick={() =>
                                            setAxialH(Math.min(clinicalVol.heightMm * 0.88, dentalBaseH + 10))
                                        }
                                        disabled={loading}
                                    >
                                        Maxilar Sup.
                                    </Button>
                                    <div className="h-3.5 w-px bg-slate-800" />
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-[11px] bg-blue-950/50 text-blue-300 hover:bg-blue-900/60 hover:text-white font-medium rounded-md"
                                        onClick={() => {
                                            setAxialH(dentalBaseH)
                                            setArchD(0)
                                        }}
                                        disabled={loading}
                                    >
                                        Dientes
                                    </Button>
                                    <div className="h-3.5 w-px bg-slate-800" />
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                        onClick={() =>
                                            setAxialH(Math.max(clinicalVol.heightMm * 0.1, dentalBaseH - 9))
                                        }
                                        disabled={loading}
                                    >
                                        Mandíbula
                                    </Button>
                                </div>
                            </div>
                        )
                    })()}
            </DialogContent>
        </Dialog>
    )
}
