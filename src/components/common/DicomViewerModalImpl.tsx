// @ts-nocheck
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
import { Dental3DViewer } from "./Dental3DViewer"
import { DentalPanoramaViewer } from "./DentalPanoramaViewer"

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

    // Estado de cortes de cada ventana ortogonal
    const [slicesInfo, setSlicesInfo] = useState({
        axial: { current: 0, total: 0 },
        tangential: { current: 0, total: 0 },
        cross: { current: 0, total: 0 },
    })

    useEffect(() => {
        sliceIndexRef.current = sliceIndex
    }, [sliceIndex])

    useEffect(() => {
        totalSlicesRef.current = totalSlices
    }, [totalSlices])

    useEffect(() => {
        activeToolRef.current = activeTool
    }, [activeTool])

    // Ajustar resolución de cada contenedor visible al cambiar el modo de vista o redimensionar
    useEffect(() => {
        const timer = setTimeout(() => {
            const app = dwvAppRef.current
            if (app) {
                try {
                    app.fitToContainer()
                    const lgAxial = getDwvLayerGroup(app, "dwv-view-axial")
                    const lgTan = getDwvLayerGroup(app, "dwv-view-tangential")
                    const lgCross = getDwvLayerGroup(app, "dwv-view-cross")
                    if (lgAxial && typeof lgAxial.draw === "function") lgAxial.draw()
                    if (lgTan && typeof lgTan.draw === "function") lgTan.draw()
                    if (lgCross && typeof lgCross.draw === "function") lgCross.draw()
                } catch {}
            }
        }, 80)
        return () => clearTimeout(timer)
    }, [viewMode])

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
                : sliceIndexRef.current

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
                const isZip = blob.type.includes("zip") || zipUrl.toLowerCase().includes(".zip")

                if (isZip) {
                    const zip = await JSZip.loadAsync(blob)

                    // Filtro universal: descarta ejecutables de PC y toma solo cortes tomográficos válidos
                    const validEntries = Object.keys(zip.files).filter((fileName) => {
                        const entry = zip.files[fileName]
                        if (entry.dir) return false
                        const lower = fileName.toLowerCase()
                        const isBanned =
                            lower.endsWith(".exe") ||
                            lower.endsWith(".dll") ||
                            lower.endsWith(".inf") ||
                            lower.endsWith(".docx") ||
                            lower.endsWith(".doc") ||
                            lower.endsWith(".inv") ||
                            lower.endsWith(".sdx") ||
                            lower.endsWith(".pdf") ||
                            lower.endsWith(".manifest") ||
                            lower.endsWith(".txt") ||
                            lower.endsWith(".ini") ||
                            lower.endsWith(".bat") ||
                            lower.endsWith(".sys") ||
                            lower.endsWith(".msi") ||
                            lower.includes("__macosx") ||
                            lower.includes("thumbs.db")

                        if (isBanned) return false
                        return (
                            lower.endsWith(".dcm") ||
                            lower.endsWith(".dcm30") ||
                            lower.includes("/dcm/") ||
                            lower.includes("/dicom/") ||
                            !lower.split("/").pop()?.includes(".")
                        )
                    })

                    let processed = 0
                    for (const name of validEntries) {
                        if (isCancelled) return
                        const fileData = await zip.files[name].async("blob")
                        const baseName = name.split("/").pop() || name
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
                })

                let hasLoaded = false
                const onLoadSuccess = () => {
                    if (isCancelled || hasLoaded) return
                    hasLoaded = true

                    let nSlices = dcmFiles.length
                    try {
                        const image = app.getImage()
                        if (image) {
                            nSlices = image.getGeometry().getSize().getNumberOfSlices()
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
                        app.fitToContainer()
                        const lgAx = getDwvLayerGroup(app, "dwv-view-axial")
                        const lgTan = getDwvLayerGroup(app, "dwv-view-tangential")
                        const lgCro = getDwvLayerGroup(app, "dwv-view-cross")
                        if (lgAx && typeof lgAx.draw === "function") lgAx.draw()
                        if (lgTan && typeof lgTan.draw === "function") lgTan.draw()
                        if (lgCro && typeof lgCro.draw === "function") lgCro.draw()
                    } catch {}

                    // Leer cortes iniciales
                    try {
                        const posHelper = getDwvPositionHelper(app, "dwv-view-axial")
                        if (posHelper && typeof posHelper.getCurrentPositionScrollValue === "function") {
                            const cur = posHelper.getCurrentPositionScrollValue()
                            if (typeof cur === "number" && !isNaN(cur)) {
                                setSliceIndex(cur)
                                sliceIndexRef.current = cur
                            }
                        }
                        const vc = getDwvViewController(app, "dwv-view-axial")
                        if (vc && typeof vc.getWindowLevel === "function") {
                            const wl = vc.getWindowLevel()
                            if (wl) setHudWl({ center: Math.round(wl.center), width: Math.round(wl.width) })
                        }
                        updateSlicesMetrics()
                    } catch (e) {
                        console.warn("Error leyendo cortes iniciales:", e)
                    }
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
                try {
                    dwvAppRef.current.fitToContainer()
                } catch {}
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

    // Sincronizar desde la "Ventana de cortes" en la Panorámica hacia Tangencial y Transversal
    const handleSelectToothRegion = (normalizedX: number) => {
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

            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault()
                goToSliceInDiv(sliceIndexRef.current + 1, focusedViewId)
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault()
                goToSliceInDiv(sliceIndexRef.current - 1, focusedViewId)
            } else if (e.key === "PageDown") {
                e.preventDefault()
                goToSliceInDiv(sliceIndexRef.current + 10, focusedViewId)
            } else if (e.key === "PageUp") {
                e.preventDefault()
                goToSliceInDiv(sliceIndexRef.current - 10, focusedViewId)
            } else if (e.key === " " || e.code === "Space") {
                e.preventDefault()
                setIsPlaying((p) => !p)
            }
        }

        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [open, goToSliceInDiv, focusedViewId])

    // Cine Loop
    useEffect(() => {
        if (!isPlaying) return

        const interval = setInterval(() => {
            const total = totalSlicesRef.current
            if (total <= 1) return

            const app = dwvAppRef.current
            const lg = getDwvLayerGroup(app, focusedViewId)
            const posHelper = getDwvPositionHelper(app, focusedViewId)
            if (!posHelper) return

            const moved = posHelper.incrementPositionAlongScroll()
            if (!moved) {
                while (posHelper.decrementPositionAlongScroll()) {}
            }
            if (lg && typeof lg.draw === "function") lg.draw()
            if (focusedViewId === "dwv-view-axial") {
                const cur = typeof posHelper.getCurrentPositionScrollValue === "function" ? posHelper.getCurrentPositionScrollValue() : sliceIndexRef.current
                setSliceIndex(cur)
                sliceIndexRef.current = cur
            }
            updateSlicesMetrics()
        }, 1000 / playbackFps)

        return () => clearInterval(interval)
    }, [isPlaying, playbackFps, focusedViewId])

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

                    {/* VISTA MULTIVISTA DENTAL (5 PANELES ESTILO GALILEOS) */}
                    <div
                        className={`w-full h-full p-1.5 gap-1.5 flex flex-col ${
                            viewMode === "multi" ? "flex" : "hidden"
                        }`}
                    >
                        {/* FILA SUPERIOR: Panorama (60%) + 3D (40%) */}
                        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-1.5">
                            {/* Panel 1: Panorama */}
                            <div className="flex-[6] min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col">
                                <DentalPanoramaViewer
                                    sliceIndex={sliceIndex}
                                    totalSlices={totalSlices}
                                    onSelectToothRegion={handleSelectToothRegion}
                                    isExpanded={false}
                                    onToggleExpand={() => setViewMode("panorama")}
                                />
                            </div>

                            {/* Panel 2: 3D Interactivo */}
                            <div className="flex-[4] min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col">
                                <Dental3DViewer
                                    sliceIndex={sliceIndex}
                                    totalSlices={totalSlices}
                                    isExpanded={false}
                                    onToggleExpand={() => setViewMode("3d")}
                                />
                            </div>
                        </div>

                        {/* FILA INFERIOR: Tangencial (33%) + Sección Transversal (33%) + Axial (34%) */}
                        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-1.5">
                            {/* Panel 3: Tangencial (Coronal) */}
                            <div className="flex-1 min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col relative">
                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px]">
                                            TANGENCIAL
                                        </span>
                                        <span className="text-slate-300 font-medium truncate">Corte Coronal / Raíces</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {slicesInfo.tangential.current + 1} / {slicesInfo.tangential.total || 512}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 text-slate-400 hover:text-white"
                                            onClick={() => setViewMode("tangential")}
                                            title="Ver Tangencial en pantalla completa"
                                        >
                                            <Maximize2 className="h-3 w-3" />
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
                                        S (Superior) · I (Inferior)
                                    </div>
                                    <div className="absolute bottom-1.5 right-2 pointer-events-none z-10 text-[9px] font-mono text-slate-400">
                                        1 cm
                                    </div>
                                </div>
                            </div>

                            {/* Panel 4: Sección Transversal (Sagital) */}
                            <div className="flex-1 min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col relative">
                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-[10px]">
                                            TRANSVERSAL
                                        </span>
                                        <span className="text-slate-300 font-medium truncate">Buco-Lingual / Reborde</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {slicesInfo.cross.current + 1} / {slicesInfo.cross.total || 512}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 text-slate-400 hover:text-white"
                                            onClick={() => setViewMode("cross")}
                                            title="Ver Sección Transversal en pantalla completa"
                                        >
                                            <Maximize2 className="h-3 w-3" />
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
                                        oral · labial/bucal
                                    </div>
                                    <div className="absolute bottom-1.5 right-2 pointer-events-none z-10 text-[9px] font-mono text-slate-400">
                                        1 cm
                                    </div>
                                </div>
                            </div>

                            {/* Panel 5: Axial (Desde arriba) */}
                            <div className="flex-1 min-w-0 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-black shadow-md flex flex-col relative">
                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border-b border-slate-800 z-10 text-[11px] shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-[10px]">
                                            AXIAL
                                        </span>
                                        <span className="text-slate-300 font-medium truncate">Desde arriba / Arco</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {sliceIndex + 1} / {totalSlices}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 text-slate-400 hover:text-white"
                                            onClick={() => setViewMode("axial")}
                                            title="Ver Axial en pantalla completa"
                                        >
                                            <Maximize2 className="h-3 w-3" />
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

                    {/* VISTA INDIVIDUAL DETALLADA (CUANDO SE MAXIMIZA CUALQUIERA DE LAS 5 SECCIONES) */}
                    {viewMode !== "multi" && (
                        <div className="w-full h-full flex flex-col p-1.5 relative">
                            {/* Panel Panorámico Expandido */}
                            {viewMode === "panorama" && (
                                <DentalPanoramaViewer
                                    sliceIndex={sliceIndex}
                                    totalSlices={totalSlices}
                                    onSelectToothRegion={handleSelectToothRegion}
                                    isExpanded={true}
                                    onToggleExpand={() => setViewMode("multi")}
                                />
                            )}

                            {/* Panel 3D Expandido */}
                            {viewMode === "3d" && (
                                <Dental3DViewer
                                    sliceIndex={sliceIndex}
                                    totalSlices={totalSlices}
                                    isExpanded={true}
                                    onToggleExpand={() => setViewMode("multi")}
                                />
                            )}

                            {/* Panel Tangencial Expandido */}
                            {viewMode === "tangential" && (
                                <div className="w-full h-full flex flex-col bg-black rounded-xl border border-slate-800 overflow-hidden relative">
                                    <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 z-10 shrink-0">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-xs">
                                                TANGENCIAL DETALLADO
                                            </span>
                                            <span className="text-xs text-slate-300">
                                                Corte {slicesInfo.tangential.current + 1} de {slicesInfo.tangential.total || 512} (Plano Coronal Dental)
                                            </span>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 gap-1.5 text-xs text-slate-300 hover:text-white"
                                            onClick={() => setViewMode("multi")}
                                        >
                                            <Minimize2 className="h-3.5 w-3.5" />
                                            <span>Restaurar 5 Vistas</span>
                                        </Button>
                                    </div>
                                    <div
                                        onWheel={(e) => handleViewWheel("dwv-view-tangential", e)}
                                        onPointerDown={(e) => handleViewPointerDown("dwv-view-tangential", e)}
                                        onPointerMove={(e) => handleViewPointerMove("dwv-view-tangential", e)}
                                        onPointerUp={handleViewPointerUp}
                                        className="flex-1 w-full h-full relative cursor-crosshair touch-none"
                                    >
                                        <div className="w-full h-full relative" />
                                        <div className="absolute top-3 left-3 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-emerald-400">
                                            Superior · Inferior (Ápices y Coronas)
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Panel Sección Transversal Expandido */}
                            {viewMode === "cross" && (
                                <div className="w-full h-full flex flex-col bg-black rounded-xl border border-slate-800 overflow-hidden relative">
                                    <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 z-10 shrink-0">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-xs">
                                                SECCIÓN TRANSVERSAL DETALLADA
                                            </span>
                                            <span className="text-xs text-slate-300">
                                                Corte {slicesInfo.cross.current + 1} de {slicesInfo.cross.total || 512} (Buco-Lingual / Altura Ósea)
                                            </span>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 gap-1.5 text-xs text-slate-300 hover:text-white"
                                            onClick={() => setViewMode("multi")}
                                        >
                                            <Minimize2 className="h-3.5 w-3.5" />
                                            <span>Restaurar 5 Vistas</span>
                                        </Button>
                                    </div>
                                    <div
                                        onWheel={(e) => handleViewWheel("dwv-view-cross", e)}
                                        onPointerDown={(e) => handleViewPointerDown("dwv-view-cross", e)}
                                        onPointerMove={(e) => handleViewPointerMove("dwv-view-cross", e)}
                                        onPointerUp={handleViewPointerUp}
                                        className="flex-1 w-full h-full relative cursor-crosshair touch-none"
                                    >
                                        <div className="w-full h-full relative" />
                                        <div className="absolute top-3 left-3 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-purple-400">
                                            oral (palatino/lingual) · labial/bucal
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Panel Axial Expandido */}
                            {viewMode === "axial" && (
                                <div className="w-full h-full flex flex-col bg-black rounded-xl border border-slate-800 overflow-hidden relative">
                                    <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 z-10 shrink-0">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-xs">
                                                CORTE AXIAL DETALLADO
                                            </span>
                                            <span className="text-xs text-slate-300">
                                                Corte {sliceIndex + 1} de {totalSlices} (Arco Dental Horizontal)
                                            </span>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 gap-1.5 text-xs text-slate-300 hover:text-white"
                                            onClick={() => setViewMode("multi")}
                                        >
                                            <Minimize2 className="h-3.5 w-3.5" />
                                            <span>Restaurar 5 Vistas</span>
                                        </Button>
                                    </div>
                                    <div
                                        onWheel={(e) => handleViewWheel("dwv-view-axial", e)}
                                        onPointerDown={(e) => handleViewPointerDown("dwv-view-axial", e)}
                                        onPointerMove={(e) => handleViewPointerMove("dwv-view-axial", e)}
                                        onPointerUp={handleViewPointerUp}
                                        className="flex-1 w-full h-full relative cursor-crosshair touch-none"
                                    >
                                        <div className="w-full h-full relative" />
                                        <div className="absolute top-3 right-3 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-cyan-400">
                                            A (Anterior)
                                        </div>
                                        <div className="absolute bottom-3 right-3 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-cyan-400">
                                            P (Posterior)
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 4. Barra Inferior con Reproductor de Cine y Slider de Navegación */}
                {totalSlices > 1 && (
                    <div className="px-4 sm:px-6 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-center gap-3 shrink-0">
                        {/* Controles de Reproducción y Saltos */}
                        <div className="flex items-center gap-1 shrink-0">
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSliceInDiv(sliceIndex - 10, focusedViewId)}
                                disabled={loading || sliceIndex <= 0}
                                title="Retroceder 10 cortes"
                            >
                                <ChevronsLeft className="h-4 w-4" />
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSliceInDiv(sliceIndex - 1, focusedViewId)}
                                disabled={loading || sliceIndex <= 0}
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
                                onClick={() => goToSliceInDiv(sliceIndex + 1, focusedViewId)}
                                disabled={loading || sliceIndex >= totalSlices - 1}
                                title="Corte siguiente"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSliceInDiv(sliceIndex + 10, focusedViewId)}
                                disabled={loading || sliceIndex >= totalSlices - 1}
                                title="Avanzar 10 cortes"
                            >
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Slider Scrubber */}
                        <div className="flex-1 w-full flex items-center gap-3">
                            <span className="text-xs text-slate-400 font-mono shrink-0">1</span>
                            <Slider
                                value={[sliceIndex]}
                                min={0}
                                max={Math.max(0, totalSlices - 1)}
                                step={1}
                                onValueChange={(val) => goToSliceInDiv(val[0], focusedViewId)}
                                className="flex-1 py-1"
                            />
                            <span className="text-xs font-semibold text-blue-400 font-mono shrink-0 min-w-16 text-right">
                                {sliceIndex + 1} / {totalSlices}
                            </span>
                        </div>

                        {/* Saltos Anatómicos Dentales */}
                        <div className="flex items-center gap-1 shrink-0">
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px] border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSliceInDiv(Math.floor(totalSlices * 0.38), "dwv-view-axial")}
                                disabled={loading}
                                title="Ir a nivel de Maxilar Superior"
                            >
                                Maxilar Sup.
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px] border-blue-600/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/50"
                                onClick={() => goToSliceInDiv(Math.floor(totalSlices * 0.50), "dwv-view-axial")}
                                disabled={loading}
                                title="Ir al plano dental central (Dientes)"
                            >
                                Dientes
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px] border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSliceInDiv(Math.floor(totalSlices * 0.62), "dwv-view-axial")}
                                disabled={loading}
                                title="Ir a nivel de Mandíbula"
                            >
                                Mandíbula
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
