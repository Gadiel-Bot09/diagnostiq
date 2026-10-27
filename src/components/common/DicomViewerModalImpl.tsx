// @ts-nocheck
"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
    Loader2,
    ZoomIn,
    Sun,
    Ruler,
    Download,
    Layers,
    RotateCcw,
    X,
    AlertCircle,
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

    const [loading, setLoading] = useState(true)
    const [loadStep, setLoadStep] = useState("Conectando con almacenamiento seguro...")
    const [loadProgress, setLoadProgress] = useState(0)
    const [sliceIndex, setSliceIndex] = useState(0)
    const [totalSlices, setTotalSlices] = useState(0)
    const [activeTool, setActiveTool] = useState<"Scroll" | "ZoomAndPan" | "WindowLevel" | "Draw">("Scroll")
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    useEffect(() => {
        if (!open || !zipUrl) return

        let isCancelled = false
        setLoading(true)
        setErrorMsg(null)
        setLoadProgress(5)
        setSliceIndex(0)
        setTotalSlices(0)
        setLoadStep("Conectando con almacenamiento seguro...")

        const loadDicomZip = async () => {
            try {
                // 1. Descarga el archivo desde MinIO / URL prefirmada
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

                // Determinar si es un archivo .zip o un .dcm directo
                const isZip = blob.type.includes("zip") || zipUrl.toLowerCase().includes(".zip")

                if (isZip) {
                    // Descomprimir en memoria con JSZip
                    const zip = await JSZip.loadAsync(blob)

                    // Filtro inteligente universal:
                    // Descarta ejecutables, librerías, volúmenes propietarios y documentos
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
                        if (processed % 20 === 0 || processed === validEntries.length) {
                            setLoadProgress(35 + Math.round((processed / validEntries.length) * 45))
                        }
                    }
                } else {
                    // Archivo DICOM directo
                    const baseName = zipUrl.split("/").pop()?.split("?")[0] || "image.dcm"
                    dcmFiles.push(new File([blob], baseName, { type: "application/dicom" }))
                    setLoadProgress(80)
                }

                if (dcmFiles.length === 0) {
                    throw new Error("No se detectaron cortes tomográficos DICOM válidos en el archivo comprimido.")
                }

                // 2. Ordenamiento numérico inteligente (compatible con 000.dcm, HOYOS_001.dcm, etc.)
                dcmFiles.sort((a, b) => {
                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
                })

                if (isCancelled) return
                setLoadProgress(85)
                setLoadStep("Inicializando motor gráfico 3D...")

                // Limpiar contenedor previo
                if (containerRef.current) {
                    containerRef.current.innerHTML = ""
                }

                // 3. Importación dinámica de DWV (solo en cliente)
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

                const onLoadSuccess = () => {
                    if (isCancelled) return
                    try {
                        const image = app.getImage()
                        if (image) {
                            const size = image.getGeometry().getSize()
                            const nSlices = size.getNumberOfSlices()
                            setTotalSlices(nSlices)
                        } else {
                            setTotalSlices(dcmFiles.length)
                        }
                    } catch {
                        setTotalSlices(dcmFiles.length)
                    }

                    setLoading(false)
                    setLoadProgress(100)
                    app.setTool("Scroll")
                    setActiveTool("Scroll")

                    try {
                        app.fitToContainer()
                    } catch {}
                }

                // Suscripción a eventos de carga (DWV emite 'load' y 'loadend')
                app.addEventListener("load", onLoadSuccess)
                app.addEventListener("loadend", onLoadSuccess)

                // Eventos de cambio de corte / posición
                app.addEventListener("positionchange", (event: any) => {
                    if (event?.value?.[0]?.[2] !== undefined) {
                        setSliceIndex(event.value[0][2])
                    }
                })
                app.addEventListener("slicechange", (event: any) => {
                    if (typeof event?.value === "number") {
                        setSliceIndex(event.value)
                    }
                })

                // Manejo de errores de carga
                app.addEventListener("error", (event: any) => {
                    console.error("DWV error:", event)
                })

                // Cargar los cortes en el visor
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

        // Redimensionar al cambiar tamaño de ventana
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

    const handleToolChange = (tool: "Scroll" | "ZoomAndPan" | "WindowLevel" | "Draw") => {
        setActiveTool(tool)
        if (dwvAppRef.current) {
            dwvAppRef.current.setTool(tool)
            if (tool === "Draw") {
                dwvAppRef.current.setToolFeatures({ shapeName: "Ruler" })
            }
        }
    }

    const handleSliceSlider = (value: number[]) => {
        const nextSlice = value[0]
        setSliceIndex(nextSlice)
        if (dwvAppRef.current && dwvModuleRef.current) {
            const vc = dwvAppRef.current.getViewController()
            if (vc) {
                const IndexClass = dwvModuleRef.current.Index
                try {
                    vc.setCurrentIndex(new IndexClass([0, 0, nextSlice]))
                } catch {
                    try {
                        const geometry = dwvAppRef.current.getImage()?.getGeometry()
                        if (geometry) {
                            const pos = geometry.indexToWorld(new IndexClass([0, 0, nextSlice]))
                            vc.setCurrentPosition(pos)
                        }
                    } catch {}
                }
            }
        }
    }

    const handleResetView = () => {
        if (dwvAppRef.current) {
            try {
                dwvAppRef.current.resetViews()
                dwvAppRef.current.fitToContainer()
            } catch {}
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-6xl w-[98vw] sm:w-[94vw] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-950 text-white rounded-2xl border-slate-800 shadow-2xl focus:outline-hidden"
                showCloseButton={false}
            >
                {/* Header con Herramientas Médicas */}
                <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 border-b border-slate-800 bg-slate-900/95 shrink-0 gap-2">
                    <div className="min-w-0 pr-2">
                        <DialogTitle className="text-sm font-semibold truncate text-white flex items-center gap-2">
                            <Layers className="h-4 w-4 text-blue-400 shrink-0" />
                            <span className="truncate">{title}</span>
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-400 truncate mt-0.5">
                            {subtitle ? `${subtitle} · ` : ""}
                            {loading
                                ? loadStep
                                : totalSlices > 0
                                ? `Corte ${sliceIndex + 1} de ${totalSlices} (Tomografía Computarizada 3D)`
                                : "Visor DICOM"}
                        </DialogDescription>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap shrink-0">
                        <Button
                            size="sm"
                            variant={activeTool === "Scroll" ? "default" : "outline"}
                            className={`h-8 text-xs gap-1 ${
                                activeTool === "Scroll"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("Scroll")}
                            disabled={loading || !!errorMsg}
                            title="Desplazarse entre cortes axiales"
                        >
                            <Layers className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Cortes</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeTool === "WindowLevel" ? "default" : "outline"}
                            className={`h-8 text-xs gap-1 ${
                                activeTool === "WindowLevel"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("WindowLevel")}
                            disabled={loading || !!errorMsg}
                            title="Ajustar contraste y brillo (Window / Level)"
                        >
                            <Sun className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Contraste</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeTool === "ZoomAndPan" ? "default" : "outline"}
                            className={`h-8 text-xs gap-1 ${
                                activeTool === "ZoomAndPan"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("ZoomAndPan")}
                            disabled={loading || !!errorMsg}
                            title="Zoom y desplazamiento"
                        >
                            <ZoomIn className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Zoom</span>
                        </Button>

                        <Button
                            size="sm"
                            variant={activeTool === "Draw" ? "default" : "outline"}
                            className={`h-8 text-xs gap-1 ${
                                activeTool === "Draw"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                            }`}
                            onClick={() => handleToolChange("Draw")}
                            disabled={loading || !!errorMsg}
                            title="Medición milimétrica (Regla)"
                        >
                            <Ruler className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Medir (mm)</span>
                        </Button>

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                            onClick={handleResetView}
                            disabled={loading || !!errorMsg}
                            title="Restablecer vista original"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </Button>

                        {downloadUrl && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium ml-1"
                                onClick={() => window.open(downloadUrl, "_blank")}
                                title="Descargar paquete completo del estudio"
                            >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">Descargar DICOM</span>
                            </Button>
                        )}

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

                {/* Lienzo de Renderizado WebGL / Canvas */}
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-20 gap-3.5 p-6 text-center">
                            <div className="relative">
                                <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                    <Layers className="h-8 w-8 text-blue-400 animate-pulse" />
                                </div>
                                <Loader2 className="h-6 w-6 animate-spin text-blue-500 absolute -bottom-1 -right-1" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-semibold text-slate-200">{loadStep}</p>
                                <p className="text-xs text-slate-400">Descomprimiendo y procesando cortes volumétricos</p>
                            </div>
                            <div className="w-64 max-w-[80vw] bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/50">
                                <div
                                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-300 rounded-full"
                                    style={{ width: `${loadProgress}%` }}
                                />
                            </div>
                            <span className="text-xs font-mono text-slate-400">{loadProgress}%</span>
                        </div>
                    )}

                    {errorMsg && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-20 gap-3 p-6 text-center max-w-md mx-auto">
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

                    {/* Contenedor DWV */}
                    <div
                        id="dwv-layer-container"
                        ref={containerRef}
                        className="w-full h-full relative flex items-center justify-center [&_canvas]:max-h-full [&_canvas]:max-w-full [&_canvas]:object-contain"
                    />
                </div>

                {/* Scrubber / Slider de Navegación de Cortes */}
                {totalSlices > 1 && (
                    <div className="px-6 py-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-4 shrink-0">
                        <span className="text-xs text-slate-400 shrink-0 font-mono">Corte 1</span>
                        <Slider
                            value={[sliceIndex]}
                            min={0}
                            max={Math.max(0, totalSlices - 1)}
                            step={1}
                            onValueChange={handleSliceSlider}
                            className="flex-1 py-1"
                        />
                        <span className="text-xs text-slate-400 shrink-0 font-mono">
                            {sliceIndex + 1} / {totalSlices}
                        </span>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
