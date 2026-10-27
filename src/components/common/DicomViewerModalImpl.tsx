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
    Move,
    Sparkles,
    Palette,
    Eye,
} from "lucide-react"
import JSZip from "jszip"

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

// Helpers para acceder a los controladores internos del motor DWV
function getDwvLayerGroup(app: any) {
    if (!app) return null
    try {
        if (typeof app.getActiveLayerGroup === "function") {
            const lg = app.getActiveLayerGroup()
            if (lg) return lg
        }
        if (typeof app.getLayerGroupByDivId === "function") {
            const lg = app.getLayerGroupByDivId("dwv-layer-container")
            if (lg) return lg
        }
    } catch {}
    return null
}

function getDwvViewController(app: any) {
    if (!app) return null
    try {
        const lg = getDwvLayerGroup(app)
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

function getDwvPositionHelper(app: any) {
    if (!app) return null
    try {
        const lg = getDwvLayerGroup(app)
        if (lg && typeof lg.getPositionHelper === "function") {
            const helper = lg.getPositionHelper()
            if (helper) return helper
        }
        const vc = getDwvViewController(app)
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
    const containerRef = useRef<HTMLDivElement>(null)
    const dwvAppRef = useRef<any>(null)
    const dwvModuleRef = useRef<any>(null)
    const sliceIndexRef = useRef<number>(0)
    const totalSlicesRef = useRef<number>(0)

    const [loading, setLoading] = useState(true)
    const [loadStep, setLoadStep] = useState("Conectando con almacenamiento seguro...")
    const [loadProgress, setLoadProgress] = useState(0)
    const [sliceIndex, setSliceIndex] = useState(0)
    const [totalSlices, setTotalSlices] = useState(0)
    const [activeTool, setActiveTool] = useState<ToolType>("Scroll")
    const [activeWlPreset, setActiveWlPreset] = useState<WlPreset>("default")
    const [activeColorMap, setActiveColorMap] = useState<ColorMapType>("plain")
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackFps, setPlaybackFps] = useState<number>(25)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    // Mantener la referencia actualizada de sliceIndex para eventos de rueda de ratón y teclado
    useEffect(() => {
        sliceIndexRef.current = sliceIndex
    }, [sliceIndex])

    // Mantener la referencia actualizada de totalSlices
    useEffect(() => {
        totalSlicesRef.current = totalSlices
    }, [totalSlices])

    // Función principal para cambiar de corte usando el PositionHelper nativo de DWV
    const goToSlice = useCallback((targetSlice: number) => {
        const total = totalSlicesRef.current
        const app = dwvAppRef.current
        if (!app || total <= 0) return

        const clamped = Math.max(0, Math.min(total - 1, targetSlice))
        const lg = getDwvLayerGroup(app)
        const vc = getDwvViewController(app)
        const posHelper = getDwvPositionHelper(app)

        try {
            if (posHelper && typeof posHelper.getCurrentPositionAtScrollValue === "function") {
                const targetPos = posHelper.getCurrentPositionAtScrollValue(clamped)
                if (targetPos) {
                    if (typeof posHelper.setCurrentPositionSafe === "function") {
                        posHelper.setCurrentPositionSafe(targetPos)
                    } else if (vc && typeof vc.setCurrentPosition === "function") {
                        vc.setCurrentPosition(targetPos)
                    }
                    if (lg && typeof lg.draw === "function") {
                        lg.draw()
                    }
                    setSliceIndex(clamped)
                    sliceIndexRef.current = clamped
                    return
                }
            }

            // Fallback: Modificar la dimensión de scroll del índice preservando todas las dimensiones del volumen
            if (vc && typeof vc.getCurrentIndex === "function") {
                const curIndex = vc.getCurrentIndex()
                if (curIndex) {
                    const vals = curIndex.getValues()
                    const scrollDim = typeof vc.getScrollDimIndex === "function" ? vc.getScrollDimIndex() : 2
                    vals[scrollDim] = clamped
                    const dwv = dwvModuleRef.current
                    if (dwv && dwv.Index) {
                        const newIndex = new dwv.Index(vals)
                        const geometry = app.getImage()?.getGeometry()
                        if (geometry) {
                            const worldPos = geometry.indexToWorld(newIndex)
                            vc.setCurrentPosition(worldPos)
                            if (lg && typeof lg.draw === "function") {
                                lg.draw()
                            }
                            setSliceIndex(clamped)
                            sliceIndexRef.current = clamped
                            return
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Error al navegar corte DICOM:", err)
        }
    }, [])

    // Carga inicial y montaje de cortes DICOM
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
                setLoadStep("Inicializando motor de visualización...")

                if (containerRef.current) {
                    containerRef.current.innerHTML = ""
                }

                const dwv = await import("dwv")
                if (isCancelled) return
                dwvModuleRef.current = dwv

                const app = new dwv.App()
                dwvAppRef.current = app

                app.init({
                    dataViewConfigs: {
                        "*": [{ divId: "dwv-layer-container" } as any],
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

                    try {
                        app.fitToContainer()
                    } catch {}

                    // Iniciar automáticamente en el centro de la tomografía (Zona Dental / Maxilar)
                    const middleSlice = Math.floor(nSlices / 2)
                    setSliceIndex(middleSlice)
                    sliceIndexRef.current = middleSlice
                    try {
                        const vc = getDwvViewController(app)
                        const posHelper = getDwvPositionHelper(app)
                        const lg = getDwvLayerGroup(app)
                        if (posHelper && typeof posHelper.getCurrentPositionAtScrollValue === "function") {
                            const midPos = posHelper.getCurrentPositionAtScrollValue(middleSlice)
                            if (midPos && vc) {
                                vc.setCurrentPosition(midPos)
                                if (lg && typeof lg.draw === "function") lg.draw()
                            }
                        }
                    } catch (e) {
                        console.warn("Error setting initial middle slice:", e)
                    }
                }

                app.addEventListener("loadend", onLoadSuccess)

                app.addEventListener("positionchange", (event: any) => {
                    try {
                        const vc = getDwvViewController(app)
                        const scrollDim = typeof vc?.getScrollDimIndex === "function" ? vc.getScrollDimIndex() : 2
                        if (event?.value?.[0]?.[scrollDim] !== undefined) {
                            const idx = event.value[0][scrollDim]
                            setSliceIndex(idx)
                            sliceIndexRef.current = idx
                        } else if (typeof event?.value === "number") {
                            setSliceIndex(event.value)
                            sliceIndexRef.current = event.value
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
            if (containerRef.current) {
                containerRef.current.innerHTML = ""
            }
        }
    }, [open, zipUrl])

    // Navegación secuencial precisa con el PositionHelper nativo
    const handleNextSlice = useCallback(() => {
        const app = dwvAppRef.current
        const lg = getDwvLayerGroup(app)
        const posHelper = getDwvPositionHelper(app)

        if (posHelper && typeof posHelper.incrementPositionAlongScroll === "function") {
            const moved = posHelper.incrementPositionAlongScroll()
            if (lg && typeof lg.draw === "function") lg.draw()
            if (moved) return
        }
        goToSlice(sliceIndexRef.current + 1)
    }, [goToSlice])

    const handlePrevSlice = useCallback(() => {
        const app = dwvAppRef.current
        const lg = getDwvLayerGroup(app)
        const posHelper = getDwvPositionHelper(app)

        if (posHelper && typeof posHelper.decrementPositionAlongScroll === "function") {
            const moved = posHelper.decrementPositionAlongScroll()
            if (lg && typeof lg.draw === "function") lg.draw()
            if (moved) return
        }
        goToSlice(sliceIndexRef.current - 1)
    }, [goToSlice])

    // MEJORA CLAVE 2: Rueda del Ratón Universal en el Lienzo (Mouse Wheel Ultra-Fluido)
    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (totalSlicesRef.current <= 1) return

            const app = dwvAppRef.current
            const lg = getDwvLayerGroup(app)
            const posHelper = getDwvPositionHelper(app)

            if (e.deltaY > 0) {
                if (posHelper && typeof posHelper.incrementPositionAlongScroll === "function") {
                    posHelper.incrementPositionAlongScroll()
                    if (lg && typeof lg.draw === "function") lg.draw()
                } else {
                    goToSlice(sliceIndexRef.current + 1)
                }
            } else {
                if (posHelper && typeof posHelper.decrementPositionAlongScroll === "function") {
                    posHelper.decrementPositionAlongScroll()
                    if (lg && typeof lg.draw === "function") lg.draw()
                } else {
                    goToSlice(sliceIndexRef.current - 1)
                }
            }
        }

        el.addEventListener("wheel", onWheel, { passive: false })
        return () => el.removeEventListener("wheel", onWheel)
    }, [goToSlice])

    // MEJORA CLAVE 3: Navegación por Teclado (Flechas, Espacio para Play, PageUp/Down)
    useEffect(() => {
        if (!open) return

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault()
                handleNextSlice()
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault()
                handlePrevSlice()
            } else if (e.key === "PageDown") {
                e.preventDefault()
                goToSlice(sliceIndexRef.current + 10)
            } else if (e.key === "PageUp") {
                e.preventDefault()
                goToSlice(sliceIndexRef.current - 10)
            } else if (e.key === " " || e.code === "Space") {
                e.preventDefault()
                setIsPlaying((p) => !p)
            } else if (e.key === "Home") {
                e.preventDefault()
                goToSlice(0)
            } else if (e.key === "End") {
                e.preventDefault()
                goToSlice(totalSlicesRef.current - 1)
            }
        }

        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [open, goToSlice, handleNextSlice, handlePrevSlice])

    // MEJORA CLAVE 4: Reproductor de Cine Automático (Cine Loop Nativo 3D)
    useEffect(() => {
        if (!isPlaying) return

        const interval = setInterval(() => {
            const total = totalSlicesRef.current
            if (total <= 1) return

            const app = dwvAppRef.current
            const lg = getDwvLayerGroup(app)
            const vc = getDwvViewController(app)
            const posHelper = getDwvPositionHelper(app)

            if (posHelper && typeof posHelper.incrementPositionAlongScroll === "function") {
                const moved = posHelper.incrementPositionAlongScroll()
                if (!moved) {
                    // Si llegó al último corte, volver al primer corte para bucle continuo
                    const startPos = posHelper.getCurrentPositionAtScrollValue(0)
                    if (startPos && vc) vc.setCurrentPosition(startPos)
                }
                if (lg && typeof lg.draw === "function") lg.draw()
                return
            }

            const next = sliceIndexRef.current + 1 >= total ? 0 : sliceIndexRef.current + 1
            goToSlice(next)
        }, 1000 / playbackFps)

        return () => clearInterval(interval)
    }, [isPlaying, playbackFps, goToSlice])

    // Cambio de herramienta de interacción
    const handleToolChange = (tool: ToolType) => {
        setActiveTool(tool)
        const app = dwvAppRef.current
        if (app) {
            try {
                app.setTool(tool)
                if (tool === "Draw") {
                    app.setToolFeatures({ shapeName: "Ruler" })
                }
            } catch (err) {
                console.warn("Error changing tool:", err)
            }
        }
    }

    // Presets de Contraste Médico y Odontológico (Window / Level)
    const handleWlPresetChange = (preset: WlPreset) => {
        setActiveWlPreset(preset)
        const app = dwvAppRef.current
        if (!app) return
        const vc = getDwvViewController(app)
        const lg = getDwvLayerGroup(app)
        if (!vc) return

        try {
            if (preset === "default") {
                vc.resetWindowLevel()
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
            }
            if (lg && typeof lg.draw === "function") lg.draw()
        } catch (e) {
            console.warn("Error setting WL preset:", e)
        }
    }

    // Mapas de Color / Pseudo-3D
    const handleColorMapChange = (cm: ColorMapType) => {
        setActiveColorMap(cm)
        const app = dwvAppRef.current
        if (!app) return
        const vc = getDwvViewController(app)
        const lg = getDwvLayerGroup(app)

        try {
            if (vc && typeof vc.setColourMap === "function") {
                vc.setColourMap(cm)
            } else if (typeof app.setColourMap === "function") {
                app.setColourMap(cm)
            }
            if (lg && typeof lg.draw === "function") lg.draw()
        } catch (e) {
            console.warn("Error setting colour map:", e)
        }
    }

    // Zoom interactivo centrado con botones
    const handleZoomIn = () => {
        const app = dwvAppRef.current
        const el = containerRef.current
        const lg = getDwvLayerGroup(app)
        if (app && el) {
            try {
                const cx = el.clientWidth / 2
                const cy = el.clientHeight / 2
                app.zoom(0.2, cx, cy)
                if (lg && typeof lg.draw === "function") lg.draw()
            } catch {}
        }
    }

    const handleZoomOut = () => {
        const app = dwvAppRef.current
        const el = containerRef.current
        const lg = getDwvLayerGroup(app)
        if (app && el) {
            try {
                const cx = el.clientWidth / 2
                const cy = el.clientHeight / 2
                app.zoom(-0.2, cx, cy)
                if (lg && typeof lg.draw === "function") lg.draw()
            } catch {}
        }
    }

    const handleResetView = () => {
        const app = dwvAppRef.current
        if (app) {
            try {
                app.resetZoomPan()
                app.fitToContainer()
                const lg = getDwvLayerGroup(app)
                if (lg && typeof lg.draw === "function") lg.draw()
                handleWlPresetChange("default")
                handleColorMapChange("plain")
            } catch {}
        }
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
                {/* 1. Header Superior con Título y Estado */}
                <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-2.5 border-b border-slate-800 bg-slate-900/95 shrink-0 gap-2">
                    <div className="min-w-0 pr-2">
                        <DialogTitle className="text-sm font-semibold truncate text-white flex items-center gap-2">
                            <Layers className="h-4 w-4 text-blue-400 shrink-0" />
                            <span className="truncate">{title}</span>
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/30">
                                3D CBCT
                            </span>
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-400 truncate mt-0.5">
                            {subtitle ? `${subtitle} · ` : ""}
                            {loading
                                ? loadStep
                                : totalSlices > 0
                                ? `Corte ${sliceIndex + 1} de ${totalSlices} (Tomografía Computarizada Axial)`
                                : "Visor Tomográfico Profesional"}
                        </DialogDescription>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                        {downloadUrl && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                                onClick={() => window.open(downloadUrl, "_blank")}
                                title="Descargar paquete DICOM completo para software de escritorio"
                            >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">Descargar Estudio</span>
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700"
                            onClick={toggleFullscreen}
                            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                        >
                            <Maximize2 className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg ml-1"
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
                        <span className="text-[11px] font-semibold text-slate-400 mr-1 hidden sm:inline">Modo:</span>

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
                            title="Desplazarse entre cortes axiales con clic o arrastre"
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
                            title="Arrastrar para mover o hacer zoom en la imagen"
                        >
                            <Move className="h-3.5 w-3.5" />
                            <span>Mover / Zoom</span>
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

                        <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

                        {/* Botones de Zoom rápido */}
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
                        <span className="text-[11px] font-semibold text-slate-400 mr-1 hidden lg:inline">Filtro:</span>

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
                            <span>Térmico 3D</span>
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

                {/* 3. Lienzo de Renderizado WebGL con HUD Médico */}
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-30 gap-3.5 p-6 text-center">
                            <div className="relative">
                                <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-lg">
                                    <Layers className="h-8 w-8 text-blue-400 animate-pulse" />
                                </div>
                                <Loader2 className="h-6 w-6 animate-spin text-blue-500 absolute -bottom-1 -right-1" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-semibold text-slate-200">{loadStep}</p>
                                <p className="text-xs text-slate-400">Descomprimiendo y renderizando cortes volumétricos</p>
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
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-30 gap-3 p-6 text-center max-w-md mx-auto">
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

                    {/* HUD Médico en Vivo (Overlays Anatómicos) */}
                    {!loading && !errorMsg && totalSlices > 0 && (
                        <>
                            {/* HUD Superior Izquierdo: Info del corte */}
                            <div className="absolute top-3 left-3 z-10 pointer-events-none bg-slate-950/70 border border-slate-800/80 rounded-lg px-2.5 py-1.5 backdrop-blur-xs text-[11px] font-mono text-slate-300 space-y-0.5 shadow-md">
                                <div className="text-blue-400 font-bold">Corte: {sliceIndex + 1} / {totalSlices}</div>
                                <div className="text-[10px] text-slate-400">
                                    Profundidad: {Math.round(((sliceIndex + 1) / totalSlices) * 100)}%
                                </div>
                            </div>

                            {/* HUD Superior Derecho: Orientación Anterior */}
                            <div className="absolute top-3 right-3 z-10 pointer-events-none bg-slate-950/70 border border-slate-800/80 rounded-lg px-2.5 py-1 backdrop-blur-xs text-xs font-bold text-amber-400 font-mono shadow-md">
                                A (Anterior)
                            </div>

                            {/* HUD Inferior Derecho: Orientación Posterior */}
                            <div className="absolute bottom-3 right-3 z-10 pointer-events-none bg-slate-950/70 border border-slate-800/80 rounded-lg px-2.5 py-1 backdrop-blur-xs text-xs font-bold text-amber-400 font-mono shadow-md">
                                P (Posterior)
                            </div>

                            {/* HUD Lateral Izquierdo: R (Derecha del paciente) */}
                            <div className="absolute top-1/2 left-3 -translate-y-1/2 z-10 pointer-events-none bg-slate-950/70 border border-slate-800/80 rounded-lg px-2 py-1 backdrop-blur-xs text-xs font-bold text-amber-400 font-mono shadow-md">
                                R
                            </div>

                            {/* HUD Lateral Derecho: L (Izquierda del paciente) */}
                            <div className="absolute top-1/2 right-3 -translate-y-1/2 z-10 pointer-events-none bg-slate-950/70 border border-slate-800/80 rounded-lg px-2 py-1 backdrop-blur-xs text-xs font-bold text-amber-400 font-mono shadow-md">
                                L
                            </div>

                            {/* Guía de Rueda y Teclado */}
                            <div className="absolute bottom-3 left-3 z-10 pointer-events-none hidden sm:flex items-center gap-1.5 bg-slate-950/70 border border-slate-800/80 rounded-lg px-2.5 py-1 backdrop-blur-xs text-[10px] text-slate-400 font-sans shadow-md">
                                <span>Rueda del ratón: desplazar cortes</span>
                                <span>·</span>
                                <span>Espacio: Reproducir</span>
                            </div>
                        </>
                    )}

                    {/* Contenedor DWV */}
                    <div
                        id="dwv-layer-container"
                        ref={containerRef}
                        className="w-full h-full relative overflow-hidden flex items-center justify-center cursor-crosshair"
                    />
                </div>

                {/* 4. Barra Inferior con Reproductor de Cine, Saltos Anatómicos y Slider */}
                {totalSlices > 1 && (
                    <div className="px-4 sm:px-6 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-center gap-3 shrink-0">
                        {/* Controles de Reproducción y Saltos */}
                        <div className="flex items-center gap-1 shrink-0">
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSlice(sliceIndex - 10)}
                                disabled={loading || sliceIndex <= 0}
                                title="Retroceder 10 cortes"
                            >
                                <ChevronsLeft className="h-4 w-4" />
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                onClick={handlePrevSlice}
                                disabled={loading || sliceIndex <= 0}
                                title="Corte anterior"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>

                            {/* Botón Cine Play/Pausa */}
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
                                onClick={handleNextSlice}
                                disabled={loading || sliceIndex >= totalSlices - 1}
                                title="Corte siguiente"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSlice(sliceIndex + 10)}
                                disabled={loading || sliceIndex >= totalSlices - 1}
                                title="Avanzar 10 cortes"
                            >
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Slider Scrubber con feedback visual */}
                        <div className="flex-1 w-full flex items-center gap-3">
                            <span className="text-xs text-slate-400 font-mono shrink-0">1</span>
                            <Slider
                                value={[sliceIndex]}
                                min={0}
                                max={Math.max(0, totalSlices - 1)}
                                step={1}
                                onValueChange={(val) => goToSlice(val[0])}
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
                                onClick={() => goToSlice(Math.floor(totalSlices * 0.38))}
                                disabled={loading}
                                title="Ir a nivel de Maxilar Superior"
                            >
                                Maxilar Sup.
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px] border-blue-600/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/50"
                                onClick={() => goToSlice(Math.floor(totalSlices * 0.50))}
                                disabled={loading}
                                title="Ir al plano dental central (Dientes)"
                            >
                                Dientes
                            </Button>

                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px] border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                                onClick={() => goToSlice(Math.floor(totalSlices * 0.62))}
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
