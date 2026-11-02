"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
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
    Eye,
    Trash2,
    LayoutGrid,
    Box,
    ArrowLeft,
    Compass,
} from "lucide-react"
import JSZip from "jszip"
import { Dental3DViewer, type VolumeFocus } from "./Dental3DViewer"
import { DentalPanoramaViewer, type ArchSelection } from "./DentalPanoramaViewer"
import {
    extractCbctVolume,
    buildRenderVolume,
    detectDentalArch,
    computePanorama,
    type CbctVolume,
    type RenderVolume,
    type DentalArch,
    type PanoramaData,
    type PanoramaMode,
} from "@/lib/cbctReconstruction"
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

type ToolType = "Scroll" | "ZoomAndPan" | "WindowLevel" | "Draw"
type WlPreset = "default" | "bone" | "enamel" | "soft"
type ColorMapType = "plain" | "invPlain" | "hot" | "rainbow"
export type ViewMode = "multi" | "panorama" | "3d" | "tangential" | "cross" | "axial"

// Helpers para acceder a los controladores internos del motor DWV por cada ventana
function getDwvLayerGroup(app: any, divId?: string) {
    if (!app) return null
    try {
        if (divId && typeof app.getLayerGroupByDivId === "function") {
            const lg = app.getLayerGroupByDivId(divId)
            if (lg) return lg
        }
        if (typeof app.getActiveLayerGroup === "function") {
            const lg = app.getActiveLayerGroup()
            if (lg) return lg
        }
        if (typeof app.getLayerGroupByDivId === "function") {
            const lg = app.getLayerGroupByDivId("dwv-view-axial") || app.getLayerGroupByDivId("dwv-layer-container")
            if (lg) return lg
        }
    } catch {}
    return null
}

function getDwvViewController(app: any, divId?: string) {
    if (!app) return null
    try {
        const lg = getDwvLayerGroup(app, divId)
        if (!lg) return null
        const vl =
            (typeof lg.getActiveViewLayer === "function" && lg.getActiveViewLayer()) ||
            (typeof lg.getBaseViewLayer === "function" && lg.getBaseViewLayer()) ||
            (typeof lg.getViewLayers === "function" && lg.getViewLayers()?.[0]) ||
            null
        return vl && typeof vl.getViewController === "function" ? vl.getViewController() : null
    } catch {}
    return null
}

function getDwvPositionHelper(app: any, divId?: string) {
    if (!app) return null
    try {
        const lg = getDwvLayerGroup(app, divId)
        if (lg && typeof lg.getPositionHelper === "function") {
            const helper = lg.getPositionHelper()
            if (helper) return helper
        }
        const vc = getDwvViewController(app, divId)
        if (vc && typeof vc.getPositionHelper === "function") {
            return vc.getPositionHelper()
        }
    } catch {}
    return null
}

export function DicomViewerModalImpl({
    open,
    onOpenChange,
    title,
    zipUrl,
    downloadUrl,
    subtitle,
}: DicomViewerModalProps) {
    // Referencias a los contenedores DWV ortogonales
    const axialRef = useRef<HTMLDivElement>(null)
    const tangentialRef = useRef<HTMLDivElement>(null)
    const crossRef = useRef<HTMLDivElement>(null)

    const dwvAppRef = useRef<any>(null)
    const dwvModuleRef = useRef<any>(null)
    const sliceIndexRef = useRef<number>(0)
    const totalSlicesRef = useRef<number>(0)
    const activeToolRef = useRef<ToolType>("Scroll")

    // Modo de visualización: "multi" (5 vistas estilo GALILEOS) o vista individual detallada
    const [viewMode, setViewMode] = useState<ViewMode>("multi")
    const [focusedViewId, setFocusedViewId] = useState<string>("dwv-view-axial")

    // Refs para interacción táctil y ratón ultra-fluida
    const isPointerDownRef = useRef(false)
    const activePointerIdRef = useRef<number | null>(null)
    const pointerLastRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
    const accumulatedDragPxRef = useRef(0)
    const initialPinchDistRef = useRef<number | null>(null)

    const [loading, setLoading] = useState(true)
    const [loadStep, setLoadStep] = useState("Conectando con almacenamiento seguro...")
    const [loadProgress, setLoadProgress] = useState(0)
    const [sliceIndex, setSliceIndex] = useState(0)
    const [totalSlices, setTotalSlices] = useState(0)
    const [activeTool, setActiveTool] = useState<ToolType>("Scroll")
    const [activeWlPreset, setActiveWlPreset] = useState<WlPreset>("default")
    const [activeColorMap, setActiveColorMap] = useState<ColorMapType>("plain")
    const [hudWl, setHudWl] = useState<{ center: number; width: number } | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackFps, setPlaybackFps] = useState<number>(25)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    // Estado de reconstrucción volumétrica real (Panorama CPR + Volumen 3D WebGL2)
    const [renderVolume, setRenderVolume] = useState<RenderVolume | null>(null)
    const [panoramaData, setPanoramaData] = useState<PanoramaData | null>(null)
    const [reconStatus, setReconStatus] = useState<string>("Preparando reconstrucción volumétrica...")
    const [panoThickness, setPanoThickness] = useState<number>(18)
    const [panoMode, setPanoMode] = useState<PanoramaMode>("xray")
    const [volumeFocus, setVolumeFocus] = useState<VolumeFocus | null>(null)

    const cbctVolRef = useRef<CbctVolume | null>(null)
    const dentalArchRef = useRef<DentalArch | null>(null)

    // Estado de cortes de cada ventana ortogonal
    const [slicesInfo, setSlicesInfo] = useState({
        axial: { current: 0, total: 0 },
        tangential: { current: 0, total: 0 },
        cross: { current: 0, total: 0 },
    })

    const slicesInfoRef = useRef(slicesInfo)
    useEffect(() => {
        slicesInfoRef.current = slicesInfo
    }, [slicesInfo])

    useEffect(() => {
        sliceIndexRef.current = sliceIndex
    }, [sliceIndex])

    useEffect(() => {
        totalSlicesRef.current = totalSlices
    }, [totalSlices])

    useEffect(() => {
        activeToolRef.current = activeTool
    }, [activeTool])

    // Ajuste seguro de resolución de un contenedor DWV específico sin lanzar excepciones por divs ocultos
    const safeFitView = useCallback((divId: string) => {
        const app = dwvAppRef.current
        if (!app) return
        try {
            const div = document.getElementById(divId)
            if (!div || div.offsetWidth <= 0 || div.offsetHeight <= 0) return
            const lg = getDwvLayerGroup(app, divId)
            if (!lg) return
            if (typeof lg.getDivToWorldSizeRatio === "function" && typeof lg.fitToContainer === "function") {
                const ratio = lg.getDivToWorldSizeRatio()
                if (typeof ratio === "number" && !isNaN(ratio) && ratio > 0) {
                    lg.fitToContainer(ratio)
                }
            }
            if (typeof lg.draw === "function") {
                lg.draw()
            }
        } catch (e) {
            console.warn(`Error al ajustar contenedor ${divId}:`, e)
        }
    }, [])

    // Ajustar resolución de cada contenedor visible al cambiar el modo de vista
    useEffect(() => {
        if (viewMode === "tangential") {
            setFocusedViewId("dwv-view-tangential")
        } else if (viewMode === "cross") {
            setFocusedViewId("dwv-view-cross")
        } else if (viewMode === "axial") {
            setFocusedViewId("dwv-view-axial")
        }

        const timer = setTimeout(() => {
            if (viewMode === "multi") {
                safeFitView("dwv-view-axial")
                safeFitView("dwv-view-tangential")
                safeFitView("dwv-view-cross")
            } else if (viewMode === "tangential") {
                safeFitView("dwv-view-tangential")
            } else if (viewMode === "cross") {
                safeFitView("dwv-view-cross")
            } else if (viewMode === "axial") {
                safeFitView("dwv-view-axial")
            }
        }, 50)
        return () => clearTimeout(timer)
    }, [viewMode, safeFitView])

    // Observador de redimensionamiento automático para adaptar los lienzos DICOM al tamaño visible
    useEffect(() => {
        const axialEl = axialRef.current
        const tanEl = tangentialRef.current
        const crossEl = crossRef.current

        if (!axialEl && !tanEl && !crossEl) return

        let resizeTimeout: any = null
        const ro = new ResizeObserver((entries) => {
            clearTimeout(resizeTimeout)
            resizeTimeout = setTimeout(() => {
                for (const entry of entries) {
                    if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                        const targetId = entry.target.id
                        if (targetId) safeFitView(targetId)
                    }
                }
            }, 40)
        })

        if (axialEl) ro.observe(axialEl)
        if (tanEl) ro.observe(tanEl)
        if (crossEl) ro.observe(crossEl)

        return () => {
            clearTimeout(resizeTimeout)
            ro.disconnect()
        }
    }, [open, safeFitView])

    // Función principal para cambiar de corte en una ventana específica
    const goToSliceInDiv = useCallback((targetSlice: number, divId = "dwv-view-axial") => {
        const app = dwvAppRef.current
        if (!app) return

        const lg = getDwvLayerGroup(app, divId)
        const posHelper = getDwvPositionHelper(app, divId)
        if (!posHelper) return

        try {
            const current = typeof posHelper.getCurrentPositionScrollValue === "function"
                ? posHelper.getCurrentPositionScrollValue()
                : (divId === "dwv-view-tangential"
                    ? slicesInfoRef.current.tangential.current
                    : divId === "dwv-view-cross"
                    ? slicesInfoRef.current.cross.current
                    : sliceIndexRef.current)

            const diff = targetSlice - current
            if (diff > 0) {
                for (let i = 0; i < diff; i++) {
                    if (!posHelper.incrementPositionAlongScroll()) break
                }
            } else if (diff < 0) {
                for (let i = 0; i < Math.abs(diff); i++) {
                    if (!posHelper.decrementPositionAlongScroll()) break
                }
            }
            if (lg && typeof lg.draw === "function") lg.draw()
            const finalSlice = typeof posHelper.getCurrentPositionScrollValue === "function"
                ? posHelper.getCurrentPositionScrollValue()
                : targetSlice

            if (divId === "dwv-view-axial") {
                setSliceIndex(finalSlice)
                sliceIndexRef.current = finalSlice
            }

            // Actualizar estado general de cortes
            updateSlicesMetrics()
        } catch (err) {
            console.error("Error al navegar corte:", err)
        }
    }, [])

    const updateSlicesMetrics = () => {
        const app = dwvAppRef.current
        if (!app) return
        try {
            const getMetrics = (divId: string) => {
                const lg = getDwvLayerGroup(app, divId)
                if (!lg) return { current: 0, total: 0 }
                const ph = lg.getPositionHelper()
                const cur = typeof ph?.getCurrentPositionScrollValue === "function" ? ph.getCurrentPositionScrollValue() : 0
                const vl = lg.getActiveViewLayer() || lg.getBaseViewLayer()
                const vc = vl?.getViewController()
                const scrollDim = typeof vc?.getScrollDimIndex === "function" ? vc.getScrollDimIndex() : 2
                const total = vc?.getImageSize()?.get(scrollDim) || totalSlicesRef.current || 0
                return { current: cur, total }
            }
            setSlicesInfo({
                axial: getMetrics("dwv-view-axial"),
                tangential: getMetrics("dwv-view-tangential"),
                cross: getMetrics("dwv-view-cross"),
            })
        } catch {}
    }

    // Carga inicial de archivos DICOM y configuración de los 3 planos ortogonales de DWV
    useEffect(() => {
        if (!open || !zipUrl) return

        let isCancelled = false
        setLoading(true)
        setErrorMsg(null)
        setLoadProgress(5)
        setSliceIndex(0)
        setTotalSlices(0)
        setIsPlaying(false)
        setActiveTool("Scroll")
        setActiveWlPreset("default")
        setActiveColorMap("plain")
        setViewMode("multi")
        setRenderVolume(null)
        setPanoramaData(null)
        setVolumeFocus(null)
        cbctVolRef.current = null
        dentalArchRef.current = null
        setReconStatus("Analizando vóxeles CBCT...")
        setLoadStep("Conectando con almacenamiento seguro...")

        const loadDicomZip = async () => {
            try {
                setLoadStep("Descargando estudio tomográfico...")
                setLoadProgress(15)

                const response = await fetch(zipUrl)
                if (!response.ok) {
                    throw new Error(`Error HTTP al descargar el estudio (${response.status})`)
                }

                const blob = await response.blob()
                if (isCancelled) return

                setLoadProgress(35)
                setLoadStep("Descomprimiendo cortes tomográficos...")

                const dcmFiles: File[] = []
                const archiveFormat = await detectArchiveFormat(blob)

                if (archiveFormat === "rar") {
                    setLoadStep("Descomprimiendo paquete RAR y filtrando cortes DICOM...")
                    const { dcmFiles: rarFiles } = await extractDicomFilesFromRar(blob, (pct, msg) => {
                        if (!isCancelled) {
                            setLoadStep(msg)
                            setLoadProgress(Math.min(82, 30 + Math.round(pct * 0.52)))
                        }
                    })
                    dcmFiles.push(...rarFiles)
                } else if (archiveFormat === "zip" || (archiveFormat === "unknown" && (blob.type.includes("zip") || zipUrl.toLowerCase().includes(".zip")))) {
                    const zip = await JSZip.loadAsync(blob)

                    // Filtro universal: descarta ejecutables de PC y toma solo cortes tomográficos válidos
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
                            setLoadProgress(35 + Math.round((processed / validEntries.length) * 45))
                        }
                    }
                } else {
                    const baseName = zipUrl.split("/").pop()?.split("?")[0] || "image.dcm"
                    dcmFiles.push(new File([blob], baseName, { type: "application/dicom" }))
                    setLoadProgress(80)
                }

                if (dcmFiles.length === 0) {
                    throw new Error("No se detectaron cortes tomográficos DICOM válidos en el archivo.")
                }

                // Ordenamiento numérico inteligente
                dcmFiles.sort((a, b) => {
                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
                })

                if (isCancelled) return
                setLoadProgress(85)
                setLoadStep("Configurando planos ortogonales (Axial, Tangencial, Transversal)...")

                if (axialRef.current) axialRef.current.innerHTML = ""
                if (tangentialRef.current) tangentialRef.current.innerHTML = ""
                if (crossRef.current) crossRef.current.innerHTML = ""

                const dwv = await import("dwv")
                if (isCancelled) return
                dwvModuleRef.current = dwv

                const app = new dwv.App()
                dwvAppRef.current = app

                // Inicializar DWV con los 3 planos ortogonales de reconstrucción médica
                app.init({
                    dataViewConfigs: {
                        "*": [
                            { divId: "dwv-view-axial", orientation: "axial" },
                            { divId: "dwv-view-tangential", orientation: "coronal" },
                            { divId: "dwv-view-cross", orientation: "sagittal" },
                        ],
                    },
                    tools: {
                        Scroll: {},
                        ZoomAndPan: {},
                        WindowLevel: {},
                        Draw: { options: ["Ruler"] },
                    },
                } as any)

                let hasLoaded = false
                const onLoadSuccess = () => {
                    if (isCancelled || hasLoaded) return
                    hasLoaded = true

                    let nSlices = dcmFiles.length
                    try {
                        const ids = typeof app.getDataIds === "function" ? app.getDataIds() : []
                        const image = ids.length > 0 ? app.getImage(ids[0]) : (app as any).getImage?.(0)
                        if (image) {
                            const sz = image.getGeometry().getSize()
                            nSlices = sz.get(2) || (sz as any).getNumberOfSlices?.() || dcmFiles.length
                        }
                    } catch {}

                    totalSlicesRef.current = nSlices
                    setTotalSlices(nSlices)
                    setLoading(false)
                    setLoadProgress(100)

                    app.setTool("Scroll")
                    setActiveTool("Scroll")
                    activeToolRef.current = "Scroll"

                    try {
                        safeFitView("dwv-view-axial")
                        safeFitView("dwv-view-tangential")
                        safeFitView("dwv-view-cross")
                    } catch {}

                    // Posicionar inicialmente el corte axial en el plano dental central (~48%) en lugar del borde vacío (corte 1)
                    try {
                        const initialAxial = Math.max(0, Math.floor(nSlices * 0.48))
                        goToSliceInDiv(initialAxial, "dwv-view-axial")

                        const vc = getDwvViewController(app, "dwv-view-axial")
                        if (vc && typeof vc.getWindowLevel === "function") {
                            const wl = vc.getWindowLevel()
                            if (wl) setHudWl({ center: Math.round(wl.center), width: Math.round(wl.width) })
                        }
                        updateSlicesMetrics()
                    } catch (e) {
                        console.warn("Error leyendo cortes iniciales:", e)
                    }

                    // Reajustar lienzos tras cerrar el overlay de carga
                    setTimeout(() => {
                        if (isCancelled) return
                        safeFitView("dwv-view-axial")
                        safeFitView("dwv-view-tangential")
                        safeFitView("dwv-view-cross")
                    }, 80)

                    // Pipeline asíncrono de Reconstrucción Volumétrica Real (Panorama CPR + Volumen 3D WebGL2)
                    ;(async () => {
                        try {
                            setReconStatus("Extrayendo matriz volumétrica DICOM...")
                            await new Promise((r) => setTimeout(r, 20))
                            if (isCancelled) return

                            const vol = extractCbctVolume(app)
                            if (!vol || isCancelled) return
                            cbctVolRef.current = vol

                            setReconStatus("Construyendo volumen 3D en GPU...")
                            const rv = await buildRenderVolume(vol, 224, () => isCancelled)
                            if (!rv || isCancelled) return
                            setRenderVolume(rv)

                            setReconStatus("Detectando arco dental y calculando Panorámica CPR...")
                            await new Promise((r) => setTimeout(r, 15))
                            if (isCancelled) return

                            const arch = detectDentalArch(rv, vol)
                            dentalArchRef.current = arch

                            const pano = await computePanorama(
                                vol,
                                arch,
                                { thicknessMm: 18, mode: "xray" },
                                () => isCancelled
                            )
                            if (!pano || isCancelled) return
                            setPanoramaData(pano)
                            setReconStatus("")

                            // Enfocar corte axial, tangencial, transversal y caja 3D en el centro del arco dental
                            try {
                                const zNorm = typeof arch.zMidNorm === "number" && !isNaN(arch.zMidNorm) ? arch.zMidNorm : 0.48
                                const targetAxial = Math.max(0, Math.min(vol.nz - 1, Math.round(zNorm * (vol.nz - 1))))
                                goToSliceInDiv(targetAxial, "dwv-view-axial")

                                if (pano.columns && pano.width > 0) {
                                    const midCol = Math.floor(pano.width / 2)
                                    const base = midCol * 4
                                    const midX = pano.columns[base]
                                    const midY = pano.columns[base + 1]
                                    const midTx = pano.columns[base + 2]
                                    const midTy = pano.columns[base + 3]

                                    goToSliceInDiv(Math.max(0, Math.min(vol.nx - 1, Math.round(midX))), "dwv-view-cross")
                                    goToSliceInDiv(Math.max(0, Math.min(vol.ny - 1, Math.round(midY))), "dwv-view-tangential")
                                    setVolumeFocus({
                                        cx: midX / Math.max(1, vol.nx),
                                        cy: midY / Math.max(1, vol.ny),
                                        tx: midTx,
                                        ty: midTy,
                                        halfWidthMm: 14,
                                        halfDepthMm: 12,
                                    })
                                }
                            } catch (navErr) {
                                console.warn("Aviso al posicionar cortes iniciales sobre el arco:", navErr)
                            }
                        } catch (reconErr) {
                            console.error("Error en reconstrucción volumétrica CBCT:", reconErr)
                            setReconStatus("No fue posible reconstruir el volumen.")
                        }
                    })()
                }

                app.addEventListener("loadend", onLoadSuccess)

                app.addEventListener("drawlayeradd", () => {
                    try {
                        const lgs = ["dwv-view-axial", "dwv-view-tangential", "dwv-view-cross"]
                        lgs.forEach((id) => {
                            const lg = getDwvLayerGroup(app, id)
                            if (lg && typeof lg.getNumberOfLayers === "function" && lg.getNumberOfLayers() > 1) {
                                if (activeToolRef.current === "Draw") {
                                    lg.setActiveLayer(1)
                                }
                            }
                        })
                    } catch {}
                })

                app.addEventListener("positionchange", (event: any) => {
                    try {
                        updateSlicesMetrics()
                        const posHelper = getDwvPositionHelper(app, "dwv-view-axial")
                        if (posHelper && typeof posHelper.getCurrentPositionScrollValue === "function") {
                            const idx = posHelper.getCurrentPositionScrollValue()
                            if (typeof idx === "number" && !isNaN(idx)) {
                                setSliceIndex(idx)
                                sliceIndexRef.current = idx
                            }
                        }
                    } catch {}
                })

                app.addEventListener("error", (event: any) => {
                    console.error("DWV error:", event)
                })

                app.loadFiles(dcmFiles)
            } catch (err: any) {
                console.error("Error al montar visor DICOM:", err)
                if (!isCancelled) {
                    setErrorMsg(err.message || "Error al procesar el archivo tomográfico.")
                    setLoading(false)
                }
            }
        }

        loadDicomZip()

        const handleResize = () => {
            if (dwvAppRef.current) {
                if (viewMode === "multi") {
                    safeFitView("dwv-view-axial")
                    safeFitView("dwv-view-tangential")
                    safeFitView("dwv-view-cross")
                } else if (viewMode === "tangential") {
                    safeFitView("dwv-view-tangential")
                } else if (viewMode === "cross") {
                    safeFitView("dwv-view-cross")
                } else if (viewMode === "axial") {
                    safeFitView("dwv-view-axial")
                }
            }
        }
        window.addEventListener("resize", handleResize)

        return () => {
            isCancelled = true
            window.removeEventListener("resize", handleResize)
            if (dwvAppRef.current) {
                try {
                    dwvAppRef.current.reset()
                } catch {}
                dwvAppRef.current = null
            }
            if (axialRef.current) axialRef.current.innerHTML = ""
            if (tangentialRef.current) tangentialRef.current.innerHTML = ""
            if (crossRef.current) crossRef.current.innerHTML = ""
        }
    }, [open, zipUrl])

    // Recalcular Panorámica CPR cuando el especialista cambia el grosor en mm o el modo (Rx / MIP)
    useEffect(() => {
        const vol = cbctVolRef.current
        const arch = dentalArchRef.current
        if (!vol || !arch) return

        let cancelled = false
        ;(async () => {
            try {
                const pano = await computePanorama(
                    vol,
                    arch,
                    { thicknessMm: panoThickness, mode: panoMode },
                    () => cancelled
                )
                if (!cancelled && pano) {
                    setPanoramaData(pano)
                }
            } catch (e) {
                console.warn("Error recalculando panorámica:", e)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [panoThickness, panoMode])

    // Sincronizar desde las coordenadas reales del arco en la Panorámica hacia 3D, Tangencial y Transversal
    const handleSelectArchPoint = useCallback(
        (sel: ArchSelection) => {
            const vol = cbctVolRef.current
            if (vol) {
                setVolumeFocus({
                    cx: sel.voxelX / Math.max(1, vol.nx),
                    cy: sel.voxelY / Math.max(1, vol.ny),
                    tx: sel.tx,
                    ty: sel.ty,
                    halfWidthMm: 14,
                    halfDepthMm: Math.max(10, panoThickness * 0.7),
                })
                goToSliceInDiv(Math.max(0, Math.min(vol.nx - 1, Math.round(sel.voxelX))), "dwv-view-cross")
                goToSliceInDiv(Math.max(0, Math.min(vol.ny - 1, Math.round(sel.voxelY))), "dwv-view-tangential")
            }
        },
        [goToSliceInDiv, panoThickness]
    )

    // Sincronizar desde la "Ventana de cortes" en la Panorámica hacia Tangencial y Transversal
    const handleSelectToothRegion = (normalizedX: number) => {
        if (cbctVolRef.current && panoramaData) {
            return
        }
        const app = dwvAppRef.current
        if (!app) return

        // 1. Sincronizar Sección Transversal (Sagital Left-Right)
        const lgCross = getDwvLayerGroup(app, "dwv-view-cross")
        if (lgCross) {
            const vl = lgCross.getActiveViewLayer() || lgCross.getBaseViewLayer()
            const vc = vl?.getViewController()
            const scrollDim = typeof vc?.getScrollDimIndex === "function" ? vc.getScrollDimIndex() : 0
            const totalCross = vc?.getImageSize()?.get(scrollDim) || 512
            const targetCross = Math.round(normalizedX * (totalCross - 1))
            goToSliceInDiv(targetCross, "dwv-view-cross")
        }

        // 2. Sincronizar Tangencial (Coronal Anterior-Posterior)
        const lgTangential = getDwvLayerGroup(app, "dwv-view-tangential")
        if (lgTangential) {
            const vl = lgTangential.getActiveViewLayer() || lgTangential.getBaseViewLayer()
            const vc = vl?.getViewController()
            const scrollDim = typeof vc?.getScrollDimIndex === "function" ? vc.getScrollDimIndex() : 1
            const totalTangential = vc?.getImageSize()?.get(scrollDim) || 512
            const distFromCenter = Math.abs(normalizedX - 0.5) * 2 // 0 en incisivos, 1 en molares
            const targetTangential = Math.round((0.32 + distFromCenter * 0.32) * (totalTangential - 1))
            goToSliceInDiv(targetTangential, "dwv-view-tangential")
        }
    }

    // Navegación por rueda en cualquier ventana
    const handleViewWheel = (divId: string, e: React.WheelEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const app = dwvAppRef.current
        if (!app) return
        const lg = getDwvLayerGroup(app, divId)
        if (!lg) return
        const posHelper = lg.getPositionHelper()
        if (!posHelper) return

        let moved = false
        if (e.deltaY > 0) {
            moved = posHelper.incrementPositionAlongScroll()
        } else {
            moved = posHelper.decrementPositionAlongScroll()
        }

        if (moved) {
            if (typeof lg.draw === "function") lg.draw()
            if (divId === "dwv-view-axial") {
                const cur = typeof posHelper.getCurrentPositionScrollValue === "function"
                    ? posHelper.getCurrentPositionScrollValue()
                    : sliceIndexRef.current
                setSliceIndex(cur)
                sliceIndexRef.current = cur
            }
            updateSlicesMetrics()
        }
    }

    // Interacción táctil / arrastre por ventana
    const handleViewPointerDown = (divId: string, e: React.PointerEvent) => {
        if (loading || !!errorMsg) return
        setFocusedViewId(divId)
        if (activeToolRef.current === "Draw") return

        isPointerDownRef.current = true
        activePointerIdRef.current = e.pointerId
        pointerLastRef.current = { x: e.clientX, y: e.clientY }
        accumulatedDragPxRef.current = 0

        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
    }

    const handleViewPointerMove = (divId: string, e: React.PointerEvent) => {
        if (!isPointerDownRef.current || activePointerIdRef.current !== e.pointerId) return
        if (activeToolRef.current === "Draw") return

        const app = dwvAppRef.current
        const lg = getDwvLayerGroup(app, divId)
        const dx = e.clientX - pointerLastRef.current.x
        const dy = e.clientY - pointerLastRef.current.y
        pointerLastRef.current = { x: e.clientX, y: e.clientY }

        if (activeToolRef.current === "Scroll") {
            accumulatedDragPxRef.current += dy
            const threshold = 12

            const posHelper = getDwvPositionHelper(app, divId)
            if (!posHelper) return

            let moved = false
            while (accumulatedDragPxRef.current <= -threshold) {
                if (!posHelper.incrementPositionAlongScroll()) break
                accumulatedDragPxRef.current += threshold
                moved = true
            }
            while (accumulatedDragPxRef.current >= threshold) {
                if (!posHelper.decrementPositionAlongScroll()) break
                accumulatedDragPxRef.current -= threshold
                moved = true
            }

            if (moved) {
                if (lg && typeof lg.draw === "function") lg.draw()
                if (divId === "dwv-view-axial") {
                    const cur = typeof posHelper.getCurrentPositionScrollValue === "function"
                        ? posHelper.getCurrentPositionScrollValue()
                        : sliceIndexRef.current
                    setSliceIndex(cur)
                    sliceIndexRef.current = cur
                }
                updateSlicesMetrics()
            }
        } else if (activeToolRef.current === "ZoomAndPan") {
            if (app && typeof app.translate === "function") {
                app.translate(dx, dy)
            }
        } else if (activeToolRef.current === "WindowLevel") {
            const vc = getDwvViewController(app, divId)
            const dwv = dwvModuleRef.current
            if (vc && dwv?.WindowLevel) {
                const cur = vc.getWindowLevel()
                if (cur) {
                    const scale = 5
                    const newCenter = cur.center - (dy * scale)
                    const newWidth = Math.max(10, cur.width + (dx * scale))
                    vc.setWindowLevel(new dwv.WindowLevel(newCenter, newWidth))
                    if (lg && typeof lg.draw === "function") lg.draw()
                    setHudWl({ center: Math.round(newCenter), width: Math.round(newWidth) })
                }
            }
        }
    }

    const handleViewPointerUp = (e: React.PointerEvent) => {
        if (activePointerIdRef.current === e.pointerId) {
            isPointerDownRef.current = false
            activePointerIdRef.current = null
            try {
                e.currentTarget.releasePointerCapture(e.pointerId)
            } catch {}
        }
    }

    // Teclado
    useEffect(() => {
        if (!open) return

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            const targetDivId =
                viewMode === "tangential"
                    ? "dwv-view-tangential"
                    : viewMode === "cross"
                    ? "dwv-view-cross"
                    : focusedViewId || "dwv-view-axial"

            const targetCur =
                targetDivId === "dwv-view-tangential"
                    ? slicesInfoRef.current.tangential.current
                    : targetDivId === "dwv-view-cross"
                    ? slicesInfoRef.current.cross.current
                    : sliceIndexRef.current

            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault()
                goToSliceInDiv(targetCur + 1, targetDivId)
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault()
                goToSliceInDiv(targetCur - 1, targetDivId)
            } else if (e.key === "PageDown") {
                e.preventDefault()
                goToSliceInDiv(targetCur + 10, targetDivId)
            } else if (e.key === "PageUp") {
                e.preventDefault()
                goToSliceInDiv(targetCur - 10, targetDivId)
            } else if (e.key === " " || e.code === "Space") {
                e.preventDefault()
                setIsPlaying((p) => !p)
            }
        }

        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [open, goToSliceInDiv, focusedViewId, viewMode])

    // Cine Loop
    useEffect(() => {
        if (!isPlaying) return

        const interval = setInterval(() => {
            const targetDivId =
                viewMode === "tangential"
                    ? "dwv-view-tangential"
                    : viewMode === "cross"
                    ? "dwv-view-cross"
                    : focusedViewId || "dwv-view-axial"

            const app = dwvAppRef.current
            const lg = getDwvLayerGroup(app, targetDivId)
            const posHelper = getDwvPositionHelper(app, targetDivId)
            if (!posHelper) return

            const moved = posHelper.incrementPositionAlongScroll()
            if (!moved) {
                while (posHelper.decrementPositionAlongScroll()) {}
            }
            if (lg && typeof lg.draw === "function") lg.draw()
            if (targetDivId === "dwv-view-axial") {
                const cur = typeof posHelper.getCurrentPositionScrollValue === "function" ? posHelper.getCurrentPositionScrollValue() : sliceIndexRef.current
                setSliceIndex(cur)
                sliceIndexRef.current = cur
            }
            updateSlicesMetrics()
        }, 1000 / playbackFps)

        return () => clearInterval(interval)
    }, [isPlaying, playbackFps, focusedViewId, viewMode])

    // Cambio de herramienta de interacción
    const handleToolChange = (tool: ToolType) => {
        setActiveTool(tool)
        activeToolRef.current = tool
        const app = dwvAppRef.current
        if (!app) return

        try {
            app.setTool(tool)
            const lgs = ["dwv-view-axial", "dwv-view-tangential", "dwv-view-cross"]
            lgs.forEach((id) => {
                const lg = getDwvLayerGroup(app, id)
                if (!lg) return
                if (tool === "Draw") {
                    app.setToolFeatures({ shapeName: "Ruler" })
                    if (typeof lg.getNumberOfLayers === "function" && lg.getNumberOfLayers() > 1) {
                        lg.setActiveLayer(1)
                    }
                } else {
                    if (typeof lg.setActiveLayer === "function") {
                        lg.setActiveLayer(0)
                    }
                }
            })
        } catch (err) {
            console.warn("Error changing tool:", err)
        }
    }

    const handleClearDrawings = () => {
        const app = dwvAppRef.current
        if (!app) return
        const lgs = ["dwv-view-axial", "dwv-view-tangential", "dwv-view-cross"]
        lgs.forEach((id) => {
            const lg = getDwvLayerGroup(app, id)
            if (!lg) return
            try {
                const drawLayers = typeof lg.getDrawLayers === "function" ? lg.getDrawLayers() : []
                drawLayers.forEach((dl: any) => {
                    if (typeof dl.deleteDraws === "function") dl.deleteDraws()
                })
                if (typeof lg.draw === "function") lg.draw()
            } catch {}
        })
    }

    // Presets de Contraste
    const handleWlPresetChange = (preset: WlPreset) => {
        setActiveWlPreset(preset)
        const app = dwvAppRef.current
        if (!app) return

        const lgs = ["dwv-view-axial", "dwv-view-tangential", "dwv-view-cross"]
        lgs.forEach((id) => {
            const vc = getDwvViewController(app, id)
            const lg = getDwvLayerGroup(app, id)
            if (!vc) return

            try {
                if (preset === "default") {
                    vc.resetWindowLevel()
                    setHudWl(null)
                } else {
                    const dwv = dwvModuleRef.current
                    const WindowLevelClass = dwv?.WindowLevel
                    if (!WindowLevelClass) return

                    let center = 400
                    let width = 1800
                    if (preset === "bone") {
                        center = 400
                        width = 1800
                    } else if (preset === "enamel") {
                        center = 800
                        width = 2500
                    } else if (preset === "soft") {
                        center = 40
                        width = 400
                    }
                    vc.setWindowLevel(new WindowLevelClass(center, width))
                    setHudWl({ center, width })
                }
                if (lg && typeof lg.draw === "function") lg.draw()
            } catch {}
        })
    }

    // Mapas de Color
    const handleColorMapChange = (cm: ColorMapType) => {
        setActiveColorMap(cm)
        const app = dwvAppRef.current
        if (!app) return
        const lgs = ["dwv-view-axial", "dwv-view-tangential", "dwv-view-cross"]
        lgs.forEach((id) => {
            const vc = getDwvViewController(app, id)
            const lg = getDwvLayerGroup(app, id)
            try {
                if (vc && typeof vc.setColourMap === "function") {
                    vc.setColourMap(cm)
                }
                if (lg && typeof lg.draw === "function") lg.draw()
            } catch {}
        })
    }

    const handleZoomIn = () => {
        const app = dwvAppRef.current
        if (!app) return
        try {
            app.zoom(0.2, 200, 200)
        } catch {}
    }

    const handleZoomOut = () => {
        const app = dwvAppRef.current
        if (!app) return
        try {
            app.zoom(-0.2, 200, 200)
        } catch {}
    }

    const handleResetView = () => {
        const app = dwvAppRef.current
        if (!app) return
        try {
            app.resetZoomPan()
            app.fitToContainer()
            handleWlPresetChange("default")
            handleColorMapChange("plain")
        } catch {}
    }

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
            setIsFullscreen(true)
        } else {
            document.exitFullscreen().catch(() => {})
            setIsFullscreen(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-7xl w-[98vw] h-[95vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-950 text-white rounded-2xl border-slate-800 shadow-2xl focus:outline-hidden"
                showCloseButton={false}
            >
                {/* 1. Header Superior con Selector de Vista Multivista / Individual */}
                <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-2 border-b border-slate-800 bg-slate-900/95 shrink-0 gap-2">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                        <DialogTitle className="text-sm font-semibold truncate text-white flex items-center gap-2">
                            <Layers className="h-4 w-4 text-blue-400 shrink-0" />
                            <span className="truncate">{title}</span>
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/30">
                                CBCT 3D DENTAL
                            </span>
                        </DialogTitle>
                    </div>

                    {/* SELECTOR DE MODOS DE VISTA (GALILEOS MULTIVIEW VS INDIVIDUAL) */}
                    <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
                        <Button
                            size="sm"
                            variant={viewMode === "multi" ? "default" : "ghost"}
                            className={`h-7 px-2.5 text-xs gap-1.5 ${
                                viewMode === "multi"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
                                    : "text-slate-400 hover:text-white"
                            }`}
                            onClick={() => setViewMode("multi")}
                            title="Ver las 5 secciones simultáneas: Panorama, 3D, Tangencial, Transversal y Axial"
                        >
                            <LayoutGrid className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">Multivista (5 Vistas)</span>
                        </Button>

                        <div className="h-3.5 w-px bg-slate-800 mx-0.5" />

                        <Button
                            size="sm"
                            variant={viewMode === "panorama" ? "default" : "ghost"}
                            className={`h-7 px-2 text-xs ${
                                viewMode === "panorama" ? "bg-blue-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                            }`}
                            onClick={() => setViewMode("panorama")}
                            title="Vista detallada de Panorámica Dental"
                        >
                            Panorama
                        </Button>

                        <Button
                            size="sm"
                            variant={viewMode === "3d" ? "default" : "ghost"}
                            className={`h-7 px-2 text-xs ${
                                viewMode === "3d" ? "bg-amber-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                            }`}
                            onClick={() => setViewMode("3d")}
                            title="Vista detallada de Volumen 3D Interactivo"
                        >
                            3D
                        </Button>

                        <Button
                            size="sm"
                            variant={viewMode === "tangential" ? "default" : "ghost"}
                            className={`h-7 px-2 text-xs ${
                                viewMode === "tangential" ? "bg-emerald-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                            }`}
                            onClick={() => setViewMode("tangential")}
                            title="Vista detallada de Corte Tangencial"
                        >
                            Tangencial
                        </Button>

                        <Button
                            size="sm"
                            variant={viewMode === "cross" ? "default" : "ghost"}
                            className={`h-7 px-2 text-xs ${
                                viewMode === "cross" ? "bg-purple-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                            }`}
                            onClick={() => setViewMode("cross")}
                            title="Vista detallada de Sección Transversal"
                        >
                            Transversal
                        </Button>

                        <Button
                            size="sm"
                            variant={viewMode === "axial" ? "default" : "ghost"}
                            className={`h-7 px-2 text-xs ${
                                viewMode === "axial" ? "bg-cyan-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                            }`}
                            onClick={() => setViewMode("axial")}
                            title="Vista detallada de Corte Axial"
                        >
                            Axial
                        </Button>
                    </div>

                    {/* Botones de Acción Superiores */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {viewMode !== "multi" && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1 border-blue-500/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/60"
                                onClick={() => setViewMode("multi")}
                                title="Volver a la vista combinada de 5 secciones"
                            >
                                <ArrowLeft className="h-3 w-3" />
                                <span>Volver a 5 Vistas</span>
                            </Button>
                        )}

                        {downloadUrl && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                                onClick={() => window.open(downloadUrl, "_blank")}
                                title="Descargar paquete DICOM completo para software de escritorio"
                            >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden lg:inline">Descargar</span>
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700"
                            onClick={toggleFullscreen}
                            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                        >
                            <Maximize2 className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg ml-0.5"
                            onClick={() => onOpenChange(false)}
                            title="Cerrar visor"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* 2. Barra de Herramientas Médicas y Odontológicas */}
                <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-1.5 border-b border-slate-800 bg-slate-900/80 gap-2 shrink-0 text-xs">
                    {/* Herramientas de Interacción */}
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[11px] font-semibold text-slate-400 mr-1 hidden sm:inline">Herramienta:</span>

                        <Button
                            size="sm"
                            variant={activeTool === "Scroll" ? "default" : "outline"}
                            className={`h-7 px-2.5 text-xs gap-1.5 ${
                                activeTool === "Scroll"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                    : "border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("Scroll")}
                            disabled={loading || !!errorMsg}
                            title="Desplazarse entre cortes axiales con rueda o arrastre"
                        >
                            <Layers className="h-3.5 w-3.5" />
                            <span>Cortes</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeTool === "ZoomAndPan" ? "default" : "outline"}
                            className={`h-7 px-2.5 text-xs gap-1.5 ${
                                activeTool === "ZoomAndPan"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                    : "border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("ZoomAndPan")}
                            disabled={loading || !!errorMsg}
                            title="Arrastrar para mover o encuadrar la imagen"
                        >
                            <Move className="h-3.5 w-3.5" />
                            <span>Mover</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeTool === "WindowLevel" ? "default" : "outline"}
                            className={`h-7 px-2.5 text-xs gap-1.5 ${
                                activeTool === "WindowLevel"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                    : "border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("WindowLevel")}
                            disabled={loading || !!errorMsg}
                            title="Ajustar brillo y contraste arrastrando el ratón"
                        >
                            <Sun className="h-3.5 w-3.5" />
                            <span>Contraste</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeTool === "Draw" ? "default" : "outline"}
                            className={`h-7 px-2.5 text-xs gap-1.5 ${
                                activeTool === "Draw"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                    : "border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("Draw")}
                            disabled={loading || !!errorMsg}
                            title="Medición milimétrica calibrada en el hueso"
                        >
                            <Ruler className="h-3.5 w-3.5" />
                            <span>Medir (mm)</span>
                        </Button>

                        {activeTool === "Draw" && (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 gap-1 border border-rose-500/20"
                                onClick={handleClearDrawings}
                                title="Borrar todas las medidas realizadas"
                            >
                                <Trash2 className="h-3 w-3" />
                                <span>Borrar Medidas</span>
                            </Button>
                        )}

                        <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            onClick={handleZoomIn}
                            disabled={loading || !!errorMsg}
                            title="Acercar (+)"
                        >
                            <ZoomIn className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            onClick={handleZoomOut}
                            disabled={loading || !!errorMsg}
                            title="Alejar (-)"
                        >
                            <ZoomOut className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
                            onClick={handleResetView}
                            disabled={loading || !!errorMsg}
                            title="Restablecer vista original"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                    </div>

                    {/* Presets Dentales y Color */}
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[11px] font-semibold text-slate-400 mr-1 hidden lg:inline">Filtro Óseo:</span>

                        <Button
                            size="sm"
                            variant={activeWlPreset === "bone" ? "default" : "outline"}
                            className={`h-7 px-2 text-[11px] ${
                                activeWlPreset === "bone"
                                    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                    : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                            }`}
                            onClick={() => handleWlPresetChange("bone")}
                            disabled={loading || !!errorMsg}
                            title="Contraste para Hueso y Raíces Dentales"
                        >
                            Dientes/Hueso
                        </Button>

                        <Button
                            size="sm"
                            variant={activeWlPreset === "enamel" ? "default" : "outline"}
                            className={`h-7 px-2 text-[11px] ${
                                activeWlPreset === "enamel"
                                    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                    : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                            }`}
                            onClick={() => handleWlPresetChange("enamel")}
                            disabled={loading || !!errorMsg}
                            title="Esmalte, Conductos e Implantes de alta densidad"
                        >
                            Esmalte/Metal
                        </Button>

                        <Button
                            size="sm"
                            variant={activeWlPreset === "soft" ? "default" : "outline"}
                            className={`h-7 px-2 text-[11px] ${
                                activeWlPreset === "soft"
                                    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                    : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                            }`}
                            onClick={() => handleWlPresetChange("soft")}
                            disabled={loading || !!errorMsg}
                            title="Tejidos blandos y senos maxilares"
                        >
                            Tejidos
                        </Button>

                        <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

                        <Button
                            size="sm"
                            variant={activeColorMap === "hot" ? "default" : "outline"}
                            className={`h-7 px-2 text-[11px] gap-1 ${
                                activeColorMap === "hot"
                                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                                    : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                            }`}
                            onClick={() => handleColorMapChange(activeColorMap === "hot" ? "plain" : "hot")}
                            disabled={loading || !!errorMsg}
                            title="Mapa térmico de densidad ósea (Pseudo-3D)"
                        >
                            <Sparkles className="h-3 w-3" />
                            <span>Térmico</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeColorMap === "invPlain" ? "default" : "outline"}
                            className={`h-7 px-2 text-[11px] gap-1 ${
                                activeColorMap === "invPlain"
                                    ? "bg-slate-600 hover:bg-slate-700 text-white"
                                    : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                            }`}
                            onClick={() => handleColorMapChange(activeColorMap === "invPlain" ? "plain" : "invPlain")}
                            disabled={loading || !!errorMsg}
                            title="Invertir colores (Fondo blanco tipo radiografía)"
                        >
                            <Palette className="h-3 w-3" />
                            <span>Invertir</span>
                        </Button>
                    </div>
                </div>

                {/* 3. Área Principal: Multivista Dental (5 Paneles estilo GALILEOS) o Vista Detallada */}
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none touch-none">
                    {/* Estilos globales requeridos por las capas DWV */}
                    <style jsx global>{`
                        #dwv-view-axial, #dwv-view-tangential, #dwv-view-cross {
                            touch-action: none !important;
                            user-select: none !important;
                            -webkit-user-select: none !important;
                        }
                        #dwv-view-axial .layerGroup, #dwv-view-tangential .layerGroup, #dwv-view-cross .layerGroup {
                            position: relative !important;
                            width: 100% !important;
                            height: 100% !important;
                            display: flex !important;
                            justify-content: center !important;
                            align-items: center !important;
                            touch-action: none !important;
                        }
                        #dwv-view-axial .layer, #dwv-view-tangential .layer, #dwv-view-cross .layer {
                            position: absolute !important;
                            top: 0 !important;
                            left: 0 !important;
                            width: 100% !important;
                            height: 100% !important;
                            display: flex !important;
                            justify-content: center !important;
                            align-items: center !important;
                            touch-action: none !important;
                        }
                        #dwv-view-axial canvas, #dwv-view-tangential canvas, #dwv-view-cross canvas {
                            touch-action: none !important;
                            display: block !important;
                            margin: auto !important;
                        }
                    `}</style>

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
                                <p className="text-xs text-slate-400">Generando reconstrucción volumétrica ortogonal y dental</p>
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

                    {/* CONTENEDOR PRINCIPAL DE VISTAS (MULTIVISTA O VISTA INDIVIDUAL DETALLADA) */}
                    <div className="flex-1 w-full h-full min-h-0 flex flex-col p-1.5 gap-1.5 overflow-hidden">
                        {/* FILA SUPERIOR: Panorama (60%) + 3D (40%) */}
                        <div
                            className={`min-h-0 gap-1.5 flex flex-col md:flex-row ${
                                viewMode === "multi"
                                    ? "flex-1"
                                    : viewMode === "panorama" || viewMode === "3d"
                                    ? "flex-1 h-full"
                                    : "hidden"
                            }`}
                        >
                            {/* Panel 1: Panorama */}
                            <div
                                className={`min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col ${
                                    viewMode === "multi"
                                        ? "flex-[6]"
                                        : viewMode === "panorama"
                                        ? "w-full h-full flex-1"
                                        : "hidden"
                                }`}
                            >
                                <DentalPanoramaViewer
                                    panorama={panoramaData}
                                    status={reconStatus}
                                    sliceIndex={sliceIndex}
                                    totalSlices={totalSlices}
                                    thicknessMm={panoThickness}
                                    mode={panoMode}
                                    onChangeThickness={setPanoThickness}
                                    onChangeMode={setPanoMode}
                                    onSelectToothRegion={handleSelectToothRegion}
                                    onSelectArchPoint={handleSelectArchPoint}
                                    onSelectSlice={(s) => goToSliceInDiv(s, "dwv-view-axial")}
                                    isExpanded={viewMode === "panorama"}
                                    onToggleExpand={() => setViewMode(viewMode === "multi" ? "panorama" : "multi")}
                                />
                            </div>

                            {/* Panel 2: 3D Interactivo */}
                            <div
                                className={`min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col ${
                                    viewMode === "multi"
                                        ? "flex-[4]"
                                        : viewMode === "3d"
                                        ? "w-full h-full flex-1"
                                        : "hidden"
                                }`}
                            >
                                <Dental3DViewer
                                    volume={renderVolume}
                                    status={reconStatus}
                                    focus={volumeFocus}
                                    sliceIndex={sliceIndex}
                                    totalSlices={totalSlices}
                                    isExpanded={viewMode === "3d"}
                                    onToggleExpand={() => setViewMode(viewMode === "multi" ? "3d" : "multi")}
                                />
                            </div>
                        </div>

                        {/* FILA INFERIOR: Tangencial + Transversal + Axial */}
                        <div
                            className={`min-h-0 gap-1.5 flex flex-col md:flex-row ${
                                viewMode === "multi"
                                    ? "flex-1"
                                    : viewMode === "tangential" || viewMode === "cross" || viewMode === "axial"
                                    ? "flex-1 h-full"
                                    : "hidden"
                            }`}
                        >
                            {/* Panel 3: Tangencial (Coronal) */}
                            <div
                                className={`min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col relative ${
                                    viewMode === "multi"
                                        ? "flex-1"
                                        : viewMode === "tangential"
                                        ? "w-full h-full flex-1"
                                        : "hidden"
                                }`}
                            >
                                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-xs">
                                            {viewMode === "tangential" ? "TANGENCIAL DETALLADO" : "TANGENCIAL"}
                                        </span>
                                        <span className="text-slate-300 font-medium truncate">
                                            {viewMode === "tangential"
                                                ? `Corte ${slicesInfo.tangential.current + 1} de ${slicesInfo.tangential.total || 512} (Plano Coronal Dental)`
                                                : "Corte Coronal / Raíces"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {slicesInfo.tangential.current + 1} / {slicesInfo.tangential.total || 512}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-1.5 text-xs text-slate-300 hover:text-white gap-1"
                                            onClick={() => setViewMode(viewMode === "multi" ? "tangential" : "multi")}
                                            title={viewMode === "tangential" ? "Restaurar 5 Vistas" : "Ver Tangencial en pantalla completa"}
                                        >
                                            {viewMode === "tangential" ? (
                                                <>
                                                    <Minimize2 className="h-3.5 w-3.5" />
                                                    <span className="hidden sm:inline">Restaurar 5 Vistas</span>
                                                </>
                                            ) : (
                                                <Maximize2 className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    onWheel={(e) => handleViewWheel("dwv-view-tangential", e)}
                                    onPointerDown={(e) => handleViewPointerDown("dwv-view-tangential", e)}
                                    onPointerMove={(e) => handleViewPointerMove("dwv-view-tangential", e)}
                                    onPointerUp={handleViewPointerUp}
                                    className="flex-1 w-full h-full relative cursor-crosshair touch-none"
                                >
                                    <div id="dwv-view-tangential" ref={tangentialRef} className="w-full h-full relative" />
                                    <div className="absolute top-2 left-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] font-mono text-emerald-400">
                                        Superior · Inferior (Ápices y Coronas)
                                    </div>
                                    <div className="absolute bottom-1.5 right-2 pointer-events-none z-10 text-[9px] font-mono text-slate-400">
                                        1 cm
                                    </div>
                                </div>
                            </div>

                            {/* Panel 4: Sección Transversal (Sagital) */}
                            <div
                                className={`min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col relative ${
                                    viewMode === "multi"
                                        ? "flex-1"
                                        : viewMode === "cross"
                                        ? "w-full h-full flex-1"
                                        : "hidden"
                                }`}
                            >
                                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-xs">
                                            {viewMode === "cross" ? "SECCIÓN TRANSVERSAL DETALLADA" : "TRANSVERSAL"}
                                        </span>
                                        <span className="text-slate-300 font-medium truncate">
                                            {viewMode === "cross"
                                                ? `Corte ${slicesInfo.cross.current + 1} de ${slicesInfo.cross.total || 512} (Buco-Lingual / Altura Ósea)`
                                                : "Buco-Lingual / Reborde"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {slicesInfo.cross.current + 1} / {slicesInfo.cross.total || 512}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-1.5 text-xs text-slate-300 hover:text-white gap-1"
                                            onClick={() => setViewMode(viewMode === "multi" ? "cross" : "multi")}
                                            title={viewMode === "cross" ? "Restaurar 5 Vistas" : "Ver Transversal en pantalla completa"}
                                        >
                                            {viewMode === "cross" ? (
                                                <>
                                                    <Minimize2 className="h-3.5 w-3.5" />
                                                    <span className="hidden sm:inline">Restaurar 5 Vistas</span>
                                                </>
                                            ) : (
                                                <Maximize2 className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    onWheel={(e) => handleViewWheel("dwv-view-cross", e)}
                                    onPointerDown={(e) => handleViewPointerDown("dwv-view-cross", e)}
                                    onPointerMove={(e) => handleViewPointerMove("dwv-view-cross", e)}
                                    onPointerUp={handleViewPointerUp}
                                    className="flex-1 w-full h-full relative cursor-crosshair touch-none"
                                >
                                    <div id="dwv-view-cross" ref={crossRef} className="w-full h-full relative" />
                                    <div className="absolute top-2 left-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] font-mono text-purple-400">
                                        oral (palatino/lingual) · labial/bucal
                                    </div>
                                    <div className="absolute bottom-1.5 right-2 pointer-events-none z-10 text-[9px] font-mono text-slate-400">
                                        1 cm
                                    </div>
                                </div>
                            </div>

                            {/* Panel 5: Axial (Horizontal) */}
                            <div
                                className={`min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col relative ${
                                    viewMode === "multi"
                                        ? "flex-1"
                                        : viewMode === "axial"
                                        ? "w-full h-full flex-1"
                                        : "hidden"
                                }`}
                            >
                                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-xs">
                                            {viewMode === "axial" ? "CORTE AXIAL DETALLADO" : "AXIAL"}
                                        </span>
                                        <span className="text-slate-300 font-medium truncate">
                                            {viewMode === "axial"
                                                ? `Corte ${sliceIndex + 1} de ${totalSlices} (Arco Dental Horizontal)`
                                                : "Desde arriba / Arco"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {sliceIndex + 1} / {totalSlices}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-1.5 text-xs text-slate-300 hover:text-white gap-1"
                                            onClick={() => setViewMode(viewMode === "multi" ? "axial" : "multi")}
                                            title={viewMode === "axial" ? "Restaurar 5 Vistas" : "Ver Axial en pantalla completa"}
                                        >
                                            {viewMode === "axial" ? (
                                                <>
                                                    <Minimize2 className="h-3.5 w-3.5" />
                                                    <span className="hidden sm:inline">Restaurar 5 Vistas</span>
                                                </>
                                            ) : (
                                                <Maximize2 className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    onWheel={(e) => handleViewWheel("dwv-view-axial", e)}
                                    onPointerDown={(e) => handleViewPointerDown("dwv-view-axial", e)}
                                    onPointerMove={(e) => handleViewPointerMove("dwv-view-axial", e)}
                                    onPointerUp={handleViewPointerUp}
                                    className="flex-1 w-full h-full relative cursor-crosshair touch-none"
                                >
                                    <div id="dwv-view-axial" ref={axialRef} className="w-full h-full relative" />
                                    <div className="absolute top-2 right-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] font-mono text-cyan-400">
                                        A (Anterior)
                                    </div>
                                    <div className="absolute bottom-2 right-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] font-mono text-cyan-400">
                                        P (Posterior)
                                    </div>
                                    <div className="absolute bottom-1.5 left-2 pointer-events-none z-10 text-[9px] font-mono text-slate-400">
                                        5 cm
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. Barra Inferior con Reproductor de Cine y Slider de Navegación */}
                {totalSlices > 1 && (() => {
                    const activeDivId =
                        viewMode === "tangential"
                            ? "dwv-view-tangential"
                            : viewMode === "cross"
                            ? "dwv-view-cross"
                            : focusedViewId || "dwv-view-axial"

                    const currentActiveSlice =
                        activeDivId === "dwv-view-tangential"
                            ? slicesInfo.tangential.current
                            : activeDivId === "dwv-view-cross"
                            ? slicesInfo.cross.current
                            : sliceIndex

                    const currentActiveTotal =
                        activeDivId === "dwv-view-tangential"
                            ? slicesInfo.tangential.total || 512
                            : activeDivId === "dwv-view-cross"
                            ? slicesInfo.cross.total || 512
                            : totalSlices || 698

                    return (
                        <div className="px-4 sm:px-6 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-center gap-3 shrink-0">
                            {/* Controles de Reproducción y Saltos */}
                            <div className="flex items-center gap-1 shrink-0">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                    onClick={() => goToSliceInDiv(currentActiveSlice - 10, activeDivId)}
                                    disabled={loading || currentActiveSlice <= 0}
                                    title="Retroceder 10 cortes"
                                >
                                    <ChevronsLeft className="h-4 w-4" />
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                    onClick={() => goToSliceInDiv(currentActiveSlice - 1, activeDivId)}
                                    disabled={loading || currentActiveSlice <= 0}
                                    title="Corte anterior"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>

                                <Button
                                    size="sm"
                                    variant={isPlaying ? "destructive" : "default"}
                                    className={`h-8 px-3 text-xs gap-1.5 font-semibold ${
                                        isPlaying
                                            ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                                            : "bg-blue-600 hover:bg-blue-700 text-white shadow-md"
                                    }`}
                                    onClick={() => setIsPlaying(!isPlaying)}
                                    disabled={loading}
                                    title={isPlaying ? "Pausar animación" : "Reproducir cortes continuamente (Cine Loop)"}
                                >
                                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                                    <span>{isPlaying ? "Pausa" : "Reproducir"}</span>
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                    onClick={() => goToSliceInDiv(currentActiveSlice + 1, activeDivId)}
                                    disabled={loading || currentActiveSlice >= currentActiveTotal - 1}
                                    title="Corte siguiente"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                    onClick={() => goToSliceInDiv(currentActiveSlice + 10, activeDivId)}
                                    disabled={loading || currentActiveSlice >= currentActiveTotal - 1}
                                    title="Avanzar 10 cortes"
                                >
                                    <ChevronsRight className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* Slider Scrubber */}
                            <div className="flex-1 w-full flex items-center gap-3">
                                <span className="text-xs text-slate-400 font-mono shrink-0">1</span>
                                <Slider
                                    value={[currentActiveSlice]}
                                    min={0}
                                    max={Math.max(0, currentActiveTotal - 1)}
                                    step={1}
                                    onValueChange={(val) => goToSliceInDiv(val[0], activeDivId)}
                                    className="flex-1 py-1"
                                />
                                <span className="text-xs font-semibold text-blue-400 font-mono shrink-0 min-w-16 text-right">
                                    {currentActiveSlice + 1} / {currentActiveTotal}
                                </span>
                            </div>

                            {/* Saltos Anatómicos Dentales */}
                            <div className="flex items-center gap-1 shrink-0">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px] border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                                    onClick={() => goToSliceInDiv(Math.floor(currentActiveTotal * 0.38), activeDivId)}
                                    disabled={loading}
                                    title="Ir a nivel superior"
                                >
                                    Maxilar Sup.
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px] border-blue-600/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/50"
                                    onClick={() => goToSliceInDiv(Math.floor(currentActiveTotal * 0.50), activeDivId)}
                                    disabled={loading}
                                    title="Ir al plano dental central (Dientes)"
                                >
                                    Dientes
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px] border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                                    onClick={() => goToSliceInDiv(Math.floor(currentActiveTotal * 0.62), activeDivId)}
                                    disabled={loading}
                                    title="Ir a nivel inferior"
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
