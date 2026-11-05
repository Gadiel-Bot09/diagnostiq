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
} from "lucide-react"
import JSZip from "jszip"
import { Dental3DViewer, type VolumeFocus } from "./Dental3DViewer"
import {
    MprViewport,
    type ActiveClinicalTool,
    type ClinicalColorMap,
    type ClinicalMeasurement,
    type ViewportOverlayContext,
} from "./MprViewport"
import {
    extractCbctVolume,
    buildRenderVolume,
    detectDentalArch,
    type RenderVolume,
} from "@/lib/cbctReconstruction"
import {
    createClinicalVolume,
    buildArch,
    archFrame,
    projectToArch,
    archControlPointsFromDetection,
    axialPlane,
    crossPlane,
    renderTangentialSection,
    renderPlane,
    renderPanorama,
    presetWindow,
    imageQuantile,
    sliceIndexFromH,
    type ClinicalVolume,
    type ArchModel,
    type PanoramaImage,
    type WindowLevel,
    type WlPresetId,
} from "@/lib/cbct/mprEngine"
import {
    detectArchiveFormat,
    isDicomSliceEntry,
    extractDicomFilesFromRar,
} from "@/lib/dicomZipCleaner"

export interface DicomViewerModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    zipUrl: string | null
    downloadUrl?: string
    subtitle?: string
}

export type ViewMode = "multi" | "panorama" | "3d" | "tangential" | "cross" | "axial"
type FocusPlane = "axial" | "cross" | "tangential"

const TANGENTIAL_HALF_WIDTH_MM = 21 // Ventana mesio-distal de 42 mm (aprox. 4-5 piezas dentales, proporción 6:5)
const CROSS_HALF_WIDTH_MM = 18 // Ventana buco-lingual de 36 mm (oral <-> labial/bucal, proporción 1:1)
const SLICE_WINDOW_HEIGHT_MM = 35 // Altura vertical de la "Ventana de cortes" estilo Sirona GALILEOS (35 mm)
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
}: DicomViewerModalProps) {
    const hiddenLoaderRef = useRef<HTMLDivElement>(null)
    const dwvAppRef = useRef<any>(null)

    // Estado de carga del estudio
    const [loading, setLoading] = useState(true)
    const [loadStep, setLoadStep] = useState("Conectando con almacenamiento seguro...")
    const [loadProgress, setLoadProgress] = useState(0)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [reconStatus, setReconStatus] = useState<string>("Preparando reconstrucción volumétrica...")

    // Modos de vista y herramientas clínicas
    const [viewMode, setViewMode] = useState<ViewMode>("multi")
    const [focusedPlane, setFocusedPlane] = useState<FocusPlane>("axial")
    const [activeTool, setActiveTool] = useState<ActiveClinicalTool>("navigate")
    const [activeWlPreset, setActiveWlPreset] = useState<WlPresetId>("auto")
    const [activeColorMap, setActiveColorMap] = useState<ClinicalColorMap>("plain")
    const [sharpenEnabled, setSharpenEnabled] = useState<boolean>(true)
    const [filtersMenuOpen, setFiltersMenuOpen] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [resetTrigger, setResetTrigger] = useState(0)
    const [externalZoomStep, setExternalZoomStep] = useState(0)

    // Volúmenes y modelo matemático del arco dental
    const [clinicalVol, setClinicalVol] = useState<ClinicalVolume | null>(null)
    const [renderVolume, setRenderVolume] = useState<RenderVolume | null>(null)
    const [archModel, setArchModel] = useState<ArchModel | null>(null)
    const [panoramaImage, setPanoramaImage] = useState<PanoramaImage | null>(null)

    // Parámetros de reconstrucción panorámica y MPR
    const [panoThickness, setPanoThickness] = useState<number>(18)
    const [panoMode, setPanoMode] = useState<"mean" | "mip">("mean")
    const [mprSlabMm, setMprSlabMm] = useState<number>(1.6)

    // Coordenadas clínicas 3D sincronizadas (en milímetros reales)
    // archS: posición a lo largo de la curva del arco dental (0 .. archModel.length mm)
    // archD: desplazamiento buco-lingual perpendicular al arco (-12 .. +12 mm; negativo=oral, positivo=vestibular)
    // axialH: altura vertical desde el borde inferior del volumen (0 .. clinicalVol.heightMm)
    const [archS, setArchS] = useState<number>(50)
    const [archD, setArchD] = useState<number>(0)
    const [axialH, setAxialH] = useState<number>(22)
    const [dentalBaseH, setDentalBaseH] = useState<number>(22)

    // Ventanas de brillo/contraste independientes para cortes MPR y para la Panorámica CPR
    const [sliceWl, setSliceWl] = useState<WindowLevel>({ center: 800, width: 2200 })
    const [panoWl, setPanoWl] = useState<WindowLevel>({ center: 900, width: 2000 })

    // Mediciones calibradas por cada vista (persisten mientras el estudio está abierto)
    const [measurementsByView, setMeasurementsByView] = useState<Record<string, ClinicalMeasurement[]>>({
        panorama: [],
        tangential: [],
        cross: [],
        axial: [],
    })

    const totalMeasurementsCount = useMemo(
        () =>
            Object.values(measurementsByView).reduce((acc, list) => acc + list.length, 0),
        [measurementsByView]
    )

    const updateViewMeasurements = useCallback((viewKey: string, next: ClinicalMeasurement[]) => {
        setMeasurementsByView((prev) => ({ ...prev, [viewKey]: next }))
    }, [])

    const handleClearAllMeasurements = useCallback(() => {
        setMeasurementsByView({
            panorama: [],
            tangential: [],
            cross: [],
            axial: [],
        })
    }, [])

    // 1. Descarga, descompresión (ZIP/RAR/DICOM) y extracción del volumen 3D de 16 bits
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
        setArchModel(null)
        setPanoramaImage(null)
        setMeasurementsByView({ panorama: [], tangential: [], cross: [], axial: [] })
        setReconStatus("Analizando vóxeles CBCT...")
        setLoadStep("Conectando con almacenamiento seguro...")

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
                setLoadStep("Descomprimiendo cortes tomográficos...")

                const dcmFiles: File[] = []
                const archiveFormat = await detectArchiveFormat(blob)

                if (archiveFormat === "rar") {
                    setLoadStep("Descomprimiendo paquete RAR y filtrando cortes DICOM...")
                    const { dcmFiles: rarFiles } = await extractDicomFilesFromRar(blob, (pct, msg) => {
                        if (!isCancelled) {
                            setLoadStep(msg)
                            setLoadProgress(Math.min(80, 30 + Math.round(pct * 0.5)))
                        }
                    })
                    dcmFiles.push(...rarFiles)
                } else if (
                    archiveFormat === "zip" ||
                    (archiveFormat === "unknown" &&
                        (blob.type.includes("zip") || zipUrl.toLowerCase().includes(".zip")))
                ) {
                    const zip = await JSZip.loadAsync(blob)
                    const validEntries = Object.keys(zip.files).filter((fileName) => {
                        const entry = zip.files[fileName]
                        if (entry.dir) return false
                        return isDicomSliceEntry(fileName)
                    })

                    let processed = 0
                    for (const name of validEntries) {
                        if (isCancelled) return
                        const fileData = await zip.files[name].async("blob")
                        const baseName = name.replace(/\\/g, "/").split("/").pop() || name
                        dcmFiles.push(new File([fileData], baseName, { type: "application/dicom" }))

                        processed++
                        if (processed % 25 === 0 || processed === validEntries.length) {
                            setLoadProgress(32 + Math.round((processed / validEntries.length) * 45))
                        }
                    }
                } else {
                    const baseName = zipUrl.split("/").pop()?.split("?")[0] || "image.dcm"
                    dcmFiles.push(new File([blob], baseName, { type: "application/dicom" }))
                    setLoadProgress(78)
                }

                if (dcmFiles.length === 0) {
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

                // Inicializar DWV en modo headless puro (sin renderizar capas DOM intermedias)
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
                        setLoadStep(`Ensamblando matriz 3D (${loadedSlicesCount} / ${dcmFiles.length} cortes)...`)
                    }
                })

                let hasLoaded = false
                const onLoadEnd = async () => {
                    if (isCancelled || hasLoaded) return
                    hasLoaded = true

                    try {
                        setLoadProgress(92)
                        setLoadStep("Detectando arco dental y generando vistas MPR...")
                        await new Promise((r) => setTimeout(r, 20))
                        if (isCancelled) return

                        const baseVol = extractCbctVolume(app)
                        if (!baseVol) {
                            throw new Error("No se pudo extraer la matriz tridimensional del estudio DICOM.")
                        }

                        const cVol = createClinicalVolume(baseVol, {
                            slope: baseVol.slope ?? 1,
                            intercept: baseVol.intercept ?? 0,
                        })
                        if (isCancelled) return

                        // Ventana inicial automática basada en los percentiles reales del estudio
                        const initSliceWl = presetWindow(cVol.quantile, "auto", cVol.dicomWindow)
                        setSliceWl(initSliceWl)

                        // Construir volumen 3D para ray-casting en GPU y detectar la curva del arco dental
                        const rv = await buildRenderVolume(baseVol, 224, () => isCancelled)
                        if (!rv || isCancelled) return

                        const det = detectDentalArch(rv, baseVol)
                        const ctrlPts = archControlPointsFromDetection(det, cVol, 11)
                        const builtArch = buildArch(ctrlPts)

                        const initH = Math.max(
                            cVol.heightMm * 0.12,
                            Math.min(cVol.heightMm * 0.88, det.zMidNorm * cVol.heightMm)
                        )
                        const initS = builtArch.length * 0.5

                        setClinicalVol(cVol)
                        setRenderVolume(rv)
                        setArchModel(builtArch)
                        setArchS(initS)
                        setArchD(0)
                        setAxialH(initH)
                        setDentalBaseH(initH)
                        setLoading(false)
                        setLoadProgress(100)

                        // Generar la Panorámica CPR isotrópica real
                        setReconStatus("Generando Panorámica CPR de alta resolución...")
                        const pano = await renderPanorama(
                            cVol,
                            builtArch,
                            { thicknessMm: 18, mode: "mean" },
                            () => isCancelled
                        )
                        if (!pano || isCancelled) return

                        const pQuant = imageQuantile(pano.data, cVol.slope, cVol.intercept)
                        setPanoWl(presetWindow(pQuant, "auto"))
                        setPanoramaImage(pano)
                        setReconStatus("")
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
            if (hiddenLoaderRef.current) hiddenLoaderRef.current.innerHTML = ""
        }
    }, [open, zipUrl])

    // 2. Recalcular la Panorámica CPR cuando cambia el grosor en mm o el modo (Rx vs MIP)
    useEffect(() => {
        if (!clinicalVol || !archModel) return
        let cancelled = false
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
            }
        })()
        return () => {
            cancelled = true
        }
    }, [clinicalVol, archModel, panoThickness, panoMode, activeWlPreset])

    // 3. Ventana vertical [hBot, hTop] de la "Ventana de cortes" (35 mm estilo Sirona GALILEOS)
    // y cálculo en tiempo real de los 3 cortes MPR calibrados (Tangencial curvo, Sección Transversal y Axial)
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
    }, [clinicalVol, archModel, archS, archD, mprSlabMm, sliceWindowBounds])

    const crossImg = useMemo(() => {
        if (!clinicalVol || !archModel) return null
        const spec = crossPlane(
            clinicalVol,
            archModel,
            archS,
            CROSS_HALF_WIDTH_MM,
            Math.max(mprSlabMm, 1.5),
            sliceWindowBounds.hBot,
            sliceWindowBounds.hTop
        )
        return renderPlane(clinicalVol, spec)
    }, [clinicalVol, archModel, archS, mprSlabMm, sliceWindowBounds])

    const axialImg = useMemo(() => {
        if (!clinicalVol) return null
        const spec = axialPlane(clinicalVol, axialH, Math.min(mprSlabMm, 1.0))
        return renderPlane(clinicalVol, spec)
    }, [clinicalVol, axialH, mprSlabMm])

    // 4. Sincronización de la caja amarilla de enfoque en el visor 3D
    const volumeFocus = useMemo<VolumeFocus | null>(() => {
        if (!clinicalVol || !archModel) return null
        const f = archFrame(archModel, archS)
        const cxMm = f.x + f.nx * archD
        const cyMm = f.y + f.ny * archD
        return {
            cx: Math.max(0, Math.min(1, cxMm / Math.max(1, clinicalVol.widthMm))),
            cy: Math.max(0, Math.min(1, cyMm / Math.max(1, clinicalVol.depthMm))),
            tx: f.tx,
            ty: f.ty,
            halfWidthMm: TANGENTIAL_HALF_WIDTH_MM,
            halfDepthMm: CROSS_HALF_WIDTH_MM,
        }
    }, [clinicalVol, archModel, archS, archD])

    const currentSliceIndex = useMemo(() => {
        if (!clinicalVol) return 0
        return sliceIndexFromH(clinicalVol, axialH)
    }, [clinicalVol, axialH])

    const totalSlices = clinicalVol?.nz || 0

    // 5. Cambiar preset de densidad ósea (Window/Level basado en percentiles reales del volumen)
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

    const handleResetView = useCallback(() => {
        setResetTrigger((n) => n + 1)
        setActiveColorMap("plain")
        handleWlPresetChange("auto")
        if (clinicalVol && archModel) {
            setArchS(archModel.length * 0.5)
            setArchD(0)
            setAxialH(dentalBaseH)
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
            : viewMode === "cross"
            ? "cross"
            : viewMode === "axial"
            ? "axial"
            : focusedPlane

    const stepFocusedPlane = useCallback(
        (steps: number, plane: FocusPlane = activePlaneAfterViewMode) => {
            if (!clinicalVol || !archModel) return
            if (plane === "axial") {
                const stepMm = Math.max(0.25, clinicalVol.sz)
                setAxialH((h) => Math.max(0, Math.min(clinicalVol.heightMm, h + steps * stepMm)))
            } else if (plane === "cross") {
                const stepMm = 0.5
                setArchS((s) => Math.max(0, Math.min(archModel.length, s + steps * stepMm)))
            } else if (plane === "tangential") {
                const stepMm = 0.25
                setArchD((d) =>
                    Math.max(-MAX_ARCH_OFFSET_D_MM, Math.min(MAX_ARCH_OFFSET_D_MM, d + steps * stepMm))
                )
            }
        },
        [clinicalVol, archModel, activePlaneAfterViewMode]
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

    // 7. Superposiciones gráficas estilo Sirona GALILEOS para cada una de las 4 vistas 2D
    const renderPanoramaOverlay = useCallback(
        ({ ctx, mmToScreen }: ViewportOverlayContext) => {
            if (!panoramaImage || !archModel) return
            const hTop = panoramaImage.hTop
            const yAxialMm = Math.max(0, Math.min(hTop, hTop - axialH))
            const yWinTopMm = Math.max(0, Math.min(hTop, hTop - sliceWindowBounds.hTop))
            const yWinBotMm = Math.max(0, Math.min(hTop, hTop - sliceWindowBounds.hBot))

            const [cx, cy] = mmToScreen(archS, yAxialMm)
            const [leftX, topY] = mmToScreen(
                Math.max(0, archS - TANGENTIAL_HALF_WIDTH_MM),
                yWinTopMm
            )
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

            // Marco celeste de la "Ventana de cortes" estilo Sirona GALILEOS
            const boxW = Math.max(28, rightX - leftX)
            const boxH = Math.max(36, botY - topY)
            const headerH = 16

            ctx.fillStyle = "rgba(56, 189, 248, 0.06)"
            ctx.fillRect(leftX, topY, boxW, boxH)

            ctx.strokeStyle = "rgba(125, 211, 252, 0.9)"
            ctx.lineWidth = 1.5
            ctx.strokeRect(leftX, topY, boxW, boxH)

            // Barra de título de la "Ventana de cortes"
            ctx.fillStyle = "rgba(14, 116, 144, 0.88)"
            ctx.fillRect(leftX, topY, boxW, headerH)
            ctx.fillStyle = "#e0f2fe"
            ctx.font = "600 10px system-ui, -apple-system, sans-serif"
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText("Ventana de cortes", leftX + 5, topY + headerH * 0.5, Math.max(20, boxW - 8))

            // Cruz amarilla interna dentro de la Ventana de cortes
            ctx.strokeStyle = "rgba(250, 204, 21, 0.92)"
            ctx.lineWidth = 1.3
            ctx.beginPath()
            ctx.moveTo(cx, topY + headerH)
            ctx.lineTo(cx, botY)
            ctx.moveTo(leftX, cy)
            ctx.lineTo(rightX, cy)
            ctx.stroke()
        },
        [panoramaImage, archModel, archS, axialH, sliceWindowBounds]
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
            // Línea vertical: centro de la sección transversal (s = archS)
            ctx.moveTo(cx, y0)
            ctx.lineTo(cx, y1)
            // Línea horizontal: nivel del corte axial (h = axialH)
            ctx.moveTo(x0, cy)
            ctx.lineTo(x1, cy)
            ctx.stroke()
        },
        [clinicalVol, axialH, sliceWindowBounds]
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
            // Línea vertical: posición del plano tangencial (d = archD)
            ctx.moveTo(cx, y0)
            ctx.lineTo(cx, y1)
            // Línea horizontal: nivel del corte axial (h = axialH)
            ctx.moveTo(x0, cy)
            ctx.lineTo(x1, cy)
            ctx.stroke()
        },
        [clinicalVol, axialH, archD, sliceWindowBounds]
    )

    const renderAxialOverlay = useCallback(
        ({ ctx, mmToScreen }: ViewportOverlayContext) => {
            if (!archModel) return

            // 1. Curva panorámica del arco dental sobre el corte axial
            const xs = archModel.xs
            const ys = archModel.ys
            if (xs.length > 1) {
                ctx.save()
                ctx.strokeStyle = "rgba(226, 232, 240, 0.75)"
                ctx.lineWidth = 1.4
                ctx.beginPath()
                for (let i = 0; i < xs.length; i++) {
                    const [sx, sy] = mmToScreen(xs[i], ys[i])
                    if (i === 0) ctx.moveTo(sx, sy)
                    else ctx.lineTo(sx, sy)
                }
                ctx.stroke()
                ctx.restore()
            }

            // 2. Caja e intersección amarilla de los planos Tangencial y Sección Transversal en (archS, archD)
            const f = archFrame(archModel, archS)
            const cx = f.x + f.nx * archD
            const cy = f.y + f.ny * archD

            const hw = TANGENTIAL_HALF_WIDTH_MM
            const hd = CROSS_HALF_WIDTH_MM

            // Esquinas del rectángulo de inspección rotado según la tangente del diente actual
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

            // Eje Tangencial (mesio-distal) y Eje Transversal (buco-lingual) en amarillo brillante
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
            ctx.restore()
        },
        [archModel, archS, archD]
    )

    // 8. Handlers de navegación interactiva en cada vista cuando activeTool === "navigate"
    const handleNavigatePanorama = useCallback(
        (xMm: number, yMm: number) => {
            if (!archModel || !panoramaImage || !clinicalVol) return
            setArchS(Math.max(0, Math.min(archModel.length, xMm)))
            setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, panoramaImage.hTop - yMm)))
            // Mantener el corte tangencial centrado sobre las piezas dentales al navegar por Panorama
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
            // Evitar que un clic fuera del arco desplace el plano tangencial hacia el aire palatino/bucal
            if (Math.abs(proj.d) <= 4.5) {
                setArchD(Math.max(-3.5, Math.min(3.5, proj.d * 0.6)))
            } else {
                setArchD(0)
            }
        },
        [archModel]
    )

    // Etiquetas dinámicas para barra superior e inferior
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

                {/* 1. Barra Superior Unificada de Estación de Trabajo PACS / Sirona GALILEOS */}
                <div className="relative z-30 flex flex-wrap items-center justify-between px-2.5 sm:px-4 py-1.5 border-b border-slate-800/90 bg-slate-900/95 shrink-0 gap-1.5">
                    {/* Grupo A: Identificador del Estudio + Selector de Vistas */}
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <DialogTitle
                            className="text-xs sm:text-[13px] font-semibold truncate text-white flex items-center gap-1.5 max-w-[165px] xl:max-w-[220px]"
                            title={title}
                        >
                            <div className="h-6 w-6 rounded-md bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
                                <Layers className="h-3.5 w-3.5 text-blue-400" />
                            </div>
                            <span className="truncate">{title}</span>
                        </DialogTitle>

                        {/* Dock Segmentado de Vistas (5 Vistas vs Individual) */}
                        <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 overflow-x-auto max-w-full">
                            <Button
                                size="sm"
                                variant={viewMode === "multi" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    viewMode === "multi"
                                        ? "bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("multi")}
                                title="Ver las 5 secciones simultáneas estilo GALILEOS: Panorama, 3D, Tangencial, Sección Transversal y Axial"
                            >
                                <LayoutGrid className="h-3 w-3 shrink-0" />
                                <span>5 Vistas</span>
                            </Button>

                            <div className="h-3.5 w-px bg-slate-800 mx-0.5 shrink-0" />

                            <Button
                                size="sm"
                                variant={viewMode === "panorama" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] rounded-md ${
                                    viewMode === "panorama"
                                        ? "bg-blue-600 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("panorama")}
                                title="Vista detallada de Panorámica Dental CPR"
                            >
                                Panorama
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "3d" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] rounded-md ${
                                    viewMode === "3d"
                                        ? "bg-amber-600 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setViewMode("3d")}
                                title="Vista detallada de Reconstrucción 3D Volumétrica"
                            >
                                3D
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "tangential" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] rounded-md ${
                                    viewMode === "tangential"
                                        ? "bg-emerald-600 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => {
                                    setFocusedPlane("tangential")
                                    setViewMode("tangential")
                                }}
                                title="Vista detallada de Corte Tangencial al arco dental"
                            >
                                Tangencial
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "cross" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] rounded-md ${
                                    viewMode === "cross"
                                        ? "bg-purple-600 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => {
                                    setFocusedPlane("cross")
                                    setViewMode("cross")
                                }}
                                title="Vista detallada de Sección Transversal (Buco-Lingual)"
                            >
                                Transversal
                            </Button>

                            <Button
                                size="sm"
                                variant={viewMode === "axial" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] rounded-md ${
                                    viewMode === "axial"
                                        ? "bg-cyan-600 text-white font-semibold"
                                        : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => {
                                    setFocusedPlane("axial")
                                    setViewMode("axial")
                                }}
                                title="Vista detallada de Corte Axial (desde arriba)"
                            >
                                Axial
                            </Button>
                        </div>
                    </div>

                    {/* Grupo B: Dock Clínico Agrupado (Herramientas + Medición Calibrada + Zoom + Filtros) */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Cápsula de Herramientas de Diagnóstico */}
                        <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800">
                            <Button
                                size="sm"
                                variant={activeTool === "navigate" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    activeTool === "navigate"
                                        ? "bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("navigate")}
                                disabled={loading || !!errorMsg}
                                title="Explorar cortes y mover la Ventana de cortes sincronizada en las 5 vistas"
                            >
                                <Layers className="h-3 w-3" />
                                <span>Cortes</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "pan" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    activeTool === "pan"
                                        ? "bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("pan")}
                                disabled={loading || !!errorMsg}
                                title="Arrastrar para encuadrar y usar rueda del ratón para hacer zoom"
                            >
                                <Move className="h-3 w-3" />
                                <span>Mover</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "wl" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    activeTool === "wl"
                                        ? "bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("wl")}
                                disabled={loading || !!errorMsg}
                                title="Ajustar ventana de brillo y contraste arrastrando el ratón"
                            >
                                <Sun className="h-3 w-3" />
                                <span>Contraste</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "ruler" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    activeTool === "ruler"
                                        ? "bg-cyan-600 hover:bg-cyan-700 text-white font-semibold shadow-xs"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("ruler")}
                                disabled={loading || !!errorMsg}
                                title="Regla milimétrica calibrada (funciona en Panorama, Tangencial, Transversal y Axial)"
                            >
                                <Ruler className="h-3 w-3" />
                                <span>Medir (mm)</span>
                            </Button>

                            <Button
                                size="sm"
                                variant={activeTool === "angle" ? "default" : "ghost"}
                                className={`h-6 px-2 text-[11px] gap-1 rounded-md ${
                                    activeTool === "angle"
                                        ? "bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs"
                                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                                }`}
                                onClick={() => setActiveTool("angle")}
                                disabled={loading || !!errorMsg}
                                title="Medir inclinación radicular o eje de implante en grados (°)"
                            >
                                <Compass className="h-3 w-3" />
                                <span className="hidden sm:inline">Ángulo (°)</span>
                            </Button>

                            {totalMeasurementsCount > 0 && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1.5 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/60 gap-1 rounded-md"
                                    onClick={handleClearAllMeasurements}
                                    title="Borrar todas las mediciones y ángulos trazados"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    <span className="hidden xl:inline">Borrar ({totalMeasurementsCount})</span>
                                </Button>
                            )}
                        </div>

                        {/* Cápsula de Zoom y Restauración */}
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
                                title="Restablecer zoom, posición y contraste óptimo"
                            >
                                <RotateCcw className="h-3 w-3" />
                            </Button>
                        </div>

                        {/* Menú Agrupado: Filtros Óseos, Nitidez y Mapa de Color */}
                        <div className="relative">
                            <Button
                                size="sm"
                                variant="outline"
                                className={`h-7 px-2.5 text-[11px] gap-1.5 rounded-lg border ${
                                    activeWlPreset !== "auto" || activeColorMap !== "plain"
                                        ? "border-indigo-500/60 bg-indigo-950/60 text-indigo-200 hover:bg-indigo-900/70"
                                        : "border-slate-800 bg-slate-950/90 text-slate-300 hover:bg-slate-800 hover:text-white"
                                }`}
                                onClick={() => setFiltersMenuOpen((prev) => !prev)}
                                disabled={loading || !!errorMsg}
                                title="Preajustes de densidad ósea, grosor MPR y mapa de color"
                            >
                                <SlidersHorizontal className="h-3 w-3 text-indigo-400" />
                                <span>Filtros:</span>
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
                                                <span>Densidad Ósea (Window/Level)</span>
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
                                                Grosor de Integración MPR (Tangencial / Transversal)
                                            </div>
                                            <div className="grid grid-cols-4 gap-1">
                                                {[
                                                    { mm: 0, label: "0.2 mm (Fino)" },
                                                    { mm: 0.8, label: "0.8 mm" },
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
                                                    Nitidez Cortical: {sharpenEnabled ? "ON" : "OFF"}
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

                    {/* Grupo C: Acciones del Sistema */}
                    <div className="flex items-center gap-1 shrink-0">
                        {downloadUrl && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg"
                                onClick={() => window.open(downloadUrl, "_blank")}
                                title="Descargar paquete DICOM completo para software de escritorio"
                            >
                                <Download className="h-3 w-3" />
                                <span className="hidden md:inline">Descargar</span>
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

                {/* 2. Área Principal de las 5 Vistas Clínicas estilo Sirona GALILEOS */}
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
                                    Reconstrucción isotrópica real (Panorama CPR, 3D, Tangencial, Transversal y Axial)
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

                    {/* CONTENEDOR DE LOS 5 PANELES SINCRONIZADOS */}
                    <div className="flex-1 w-full h-full min-h-0 flex flex-col p-1 gap-1 overflow-hidden">
                        {/* FILA SUPERIOR: Panorama CPR (62%) + 3D Volumétrico (38%) */}
                        <div
                            className={`min-h-0 gap-1 flex flex-col md:flex-row ${
                                viewMode === "multi"
                                    ? "flex-[52]"
                                    : viewMode === "panorama" || viewMode === "3d"
                                    ? "flex-1 h-full"
                                    : "hidden"
                            }`}
                        >
                            {/* PANEL 1: PANORAMA (Reformateo Curvo Isotrópico Real + Regla Calibrada) */}
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
                                        {/* Modo Rx vs MIP */}
                                        <div className="flex items-center bg-slate-950/90 rounded border border-slate-800 p-0.5">
                                            <button
                                                type="button"
                                                onClick={() => setPanoMode("mean")}
                                                className={`px-1.5 py-0.2 text-[9px] rounded font-medium transition-colors ${
                                                    panoMode === "mean"
                                                        ? "bg-blue-600 text-white"
                                                        : "text-slate-400 hover:text-white"
                                                }`}
                                                title="Radiografía Panorámica CPR estándar (integración de rayos)"
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
                                                title="Proyección de Máxima Intensidad (MIP)"
                                            >
                                                MIP
                                            </button>
                                        </div>

                                        {/* Grosor de capa panorámica */}
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
                                                    title={`Grosor de corte panorámico: ${mm} mm`}
                                                >
                                                    {mm}mm
                                                </button>
                                            ))}
                                        </div>

                                        {/* Saltos rápidos por sector dental */}
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
                                            title={
                                                viewMode === "panorama"
                                                    ? "Restaurar 5 Vistas"
                                                    : "Ampliar Panorama"
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
                                    onAdjustWindowLevel={handleAdjustPanoWl}
                                    onWheelStep={(steps) => stepFocusedPlane(steps, "cross")}
                                    onNavigateMm={handleNavigatePanorama}
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
                                    sliceIndex={currentSliceIndex}
                                    totalSlices={totalSlices}
                                    isExpanded={viewMode === "3d"}
                                    onToggleExpand={() =>
                                        setViewMode(viewMode === "multi" ? "3d" : "multi")
                                    }
                                />
                            </div>
                        </div>

                        {/* FILA INFERIOR: Tangencial + Sección Transversal + Axial (desde arriba) */}
                        <div
                            className={`min-h-0 gap-1 flex flex-col md:flex-row ${
                                viewMode === "multi"
                                    ? "flex-[48]"
                                    : viewMode === "tangential" || viewMode === "cross" || viewMode === "axial"
                                    ? "flex-1 h-full"
                                    : "hidden"
                            }`}
                        >
                            {/* PANEL 3: TANGENCIAL (Plano oblicuo tangente al arco dental en s = archS) */}
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
                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px]">
                                            Tangencial
                                        </span>
                                        <span className="text-slate-300 font-medium truncate text-[10px]">
                                            {archD >= 0 ? `+${archD.toFixed(1)} mm (Vest.)` : `${archD.toFixed(1)} mm (Oral)`}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 px-1.5 text-[10px] text-slate-300 hover:text-white gap-1"
                                            onClick={() =>
                                                setViewMode(viewMode === "multi" ? "tangential" : "multi")
                                            }
                                            title={
                                                viewMode === "tangential"
                                                    ? "Restaurar 5 Vistas"
                                                    : "Ampliar Corte Tangencial"
                                            }
                                        >
                                            {viewMode === "tangential" ? (
                                                <>
                                                    <Minimize2 className="h-3 w-3" />
                                                    <span className="hidden sm:inline">5 Vistas</span>
                                                </>
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
                                        onAdjustWindowLevel={handleAdjustSliceWl}
                                        onWheelStep={(steps) => stepFocusedPlane(steps, "tangential")}
                                        onNavigateMm={handleNavigateTangential}
                                        renderOverlay={renderTangentialOverlay}
                                        scaleBarCm={1}
                                        resetTrigger={resetTrigger}
                                        externalZoomStep={externalZoomStep}
                                    />

                                    {/* Barra lateral derecha de desplazamiento tangencial estilo Sirona GALILEOS */}
                                    <div
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="w-5 bg-slate-900/90 border-l border-slate-800/80 flex flex-col items-center justify-between py-1.5 select-none shrink-0"
                                        title="Desplazamiento buco-lingual del corte tangencial (-12 mm a +12 mm)"
                                    >
                                        <span className="text-[8px] font-mono text-slate-400">90°</span>
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

                            {/* PANEL 4: SECCIÓN TRANSVERSAL (Plano perpendicular al arco: oral <-> labial/bucal) */}
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
                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-[10px]">
                                            Sección transversal
                                        </span>
                                        <span className="text-slate-300 font-medium truncate text-[10px]">
                                            {archS.toFixed(1)} / {(archModel?.length || 100).toFixed(0)} mm
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 px-1.5 text-[10px] text-slate-300 hover:text-white gap-1"
                                            onClick={() =>
                                                setViewMode(viewMode === "multi" ? "cross" : "multi")
                                            }
                                            title={
                                                viewMode === "cross"
                                                    ? "Restaurar 5 Vistas"
                                                    : "Ampliar Sección Transversal"
                                            }
                                        >
                                            {viewMode === "cross" ? (
                                                <>
                                                    <Minimize2 className="h-3 w-3" />
                                                    <span className="hidden sm:inline">5 Vistas</span>
                                                </>
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
                                        onAdjustWindowLevel={handleAdjustSliceWl}
                                        onWheelStep={(steps) => stepFocusedPlane(steps, "cross")}
                                        onNavigateMm={handleNavigateCross}
                                        renderOverlay={renderCrossOverlay}
                                        scaleBarCm={1}
                                        leftLabel="oral"
                                        rightLabel="labial/bucal"
                                        resetTrigger={resetTrigger}
                                        externalZoomStep={externalZoomStep}
                                    />

                                    {/* Barra lateral derecha de recorrido por el arco dental estilo Sirona GALILEOS */}
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

                            {/* PANEL 5: AXIAL (Desde arriba + curva del arco + cruz amarilla tangencial/transversal) */}
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
                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-[10px]">
                                            Axial (desde arriba)
                                        </span>
                                        <span className="text-slate-300 font-medium truncate text-[10px]">
                                            Corte {currentSliceIndex + 1} / {totalSlices} ({axialH.toFixed(1)} mm)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 px-1.5 text-[10px] text-slate-300 hover:text-white gap-1"
                                            onClick={() =>
                                                setViewMode(viewMode === "multi" ? "axial" : "multi")
                                            }
                                            title={
                                                viewMode === "axial"
                                                    ? "Restaurar 5 Vistas"
                                                    : "Ampliar Corte Axial"
                                            }
                                        >
                                            {viewMode === "axial" ? (
                                                <>
                                                    <Minimize2 className="h-3 w-3" />
                                                    <span className="hidden sm:inline">5 Vistas</span>
                                                </>
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
                                    onAdjustWindowLevel={handleAdjustSliceWl}
                                    onWheelStep={(steps) => stepFocusedPlane(steps, "axial")}
                                    onNavigateMm={handleNavigateAxial}
                                    renderOverlay={renderAxialOverlay}
                                    scaleBarCm={5}
                                    bottomLeftBadge="R"
                                    resetTrigger={resetTrigger}
                                    externalZoomStep={externalZoomStep}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Barra Inferior Compacta con Reproductor de Cine, Scrubber de Precisión y Saltos Anatómicos */}
                {clinicalVol && archModel && (() => {
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
                    const sliderStep = plane === "tangential" ? 0.25 : plane === "cross" ? 0.5 : Math.max(0.2, clinicalVol.sz)
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
                            {/* Grupo Izquierdo: Selector de Plano Activo + Controles de Cine Loop */}
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setFocusedPlane((p) =>
                                            p === "axial" ? "cross" : p === "cross" ? "tangential" : "axial"
                                        )
                                    }
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border cursor-pointer ${activePlaneBadgeClass}`}
                                    title="Haga clic para alternar qué plano controla esta barra inferior (Axial / Transversal / Tangencial)"
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
                                        title="Retroceder rápido (RePág)"
                                    >
                                        <ChevronsLeft className="h-3.5 w-3.5" />
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                        onClick={() => stepFocusedPlane(-1, plane)}
                                        disabled={loading}
                                        title="Paso anterior (Flecha izquierda/arriba)"
                                    >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant={isPlaying ? "destructive" : "default"}
                                        className={`h-6 px-2.5 text-[11px] gap-1 font-semibold rounded-md ${
                                            isPlaying
                                                ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                                                : "bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
                                        }`}
                                        onClick={() => setIsPlaying(!isPlaying)}
                                        disabled={loading}
                                        title={
                                            isPlaying
                                                ? "Pausar recorrido (Espacio)"
                                                : "Reproducir recorrido continuo (Espacio)"
                                        }
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
                                        title="Paso siguiente (Flecha derecha/abajo)"
                                    >
                                        <ChevronRight className="h-3.5 w-3.5" />
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                        onClick={() => stepFocusedPlane(8, plane)}
                                        disabled={loading}
                                        title="Avanzar rápido (AvPág)"
                                    >
                                        <ChevronsRight className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {/* Grupo Central: Barra Deslizante de Precisión */}
                            <div className="flex-1 min-w-[160px] flex items-center gap-2.5 px-1">
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

                            {/* Grupo Derecho: Saltos Anatómicos Dentales Agrupados */}
                            <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 shrink-0">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
                                    onClick={() =>
                                        setAxialH(Math.min(clinicalVol.heightMm * 0.88, dentalBaseH + 10))
                                    }
                                    disabled={loading}
                                    title="Ir a nivel anatómico superior (Maxilar Superior / Ápices superiores)"
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
                                    title="Ir al plano dental / raíces y coronas"
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
                                    title="Ir a nivel anatómico inferior (Coronas / Mandíbula)"
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
