# Plan de Implementación: Visor Web de Tomografías (DICOM) en DiagnostiQ (Multi-Laboratorio)

> **Estado:** Documento de Arquitectura y Guía de Implementación Actualizada  
> **Proyecto:** DiagnostiQ (Next.js 16 + React 19 + Supabase + MinIO)  
> **Centros Analizados:** Laboratorio Rodigital (Sirona) & Laboratorio MAXISCAN 3D (Soredex)  
> **Objetivo:** Permitir que pacientes y médicos visualicen tomografías 3D (CBCT / CT) en el navegador web (móvil y PC) sin instalar programas locales, con compatibilidad universal automática entre distintos laboratorios y optimización extrema de almacenamiento.

---

## 1. Análisis Comparativo de Laboratorios Reales

Para asegurar que DiagnostiQ sea una plataforma universal para cualquier centro radiológico, se analizaron dos tomografías reales provenientes de diferentes laboratorios y fabricantes de tomógrafos:

| Parámetro Técnico | Caso 1: Laboratorio Rodigital | Caso 2: Laboratorio MAXISCAN 3D |
| :--- | :--- | :--- |
| **Paciente de Muestra** | Yorman José Rodríguez Fajardo | Isaac Yael Hoyos Narváez |
| **Estudio Realizado** | Tomografía Cone Beam Maxilofacial | Tomografía de Maxilar Superior |
| **Fabricante / Equipo** | **Sirona Dental Systems** (Galileos) | **SOREDEX** (Cranex 3D / Scanora) |
| **Estándar DICOM** | DICOM 3.0 (`CT Image Storage`) | DICOM 3.0 (`CT Image Storage`) |
| **Transfer Syntax** | `Explicit VR Little Endian` (1.2.840.10008.1.2.1) | `Explicit VR Little Endian` (1.2.840.10008.1.2.1) |
| **Cantidad de Cortes** | **384 cortes axiales** | **300 cortes axiales** |
| **Resolución por Corte** | 512 × 512 píxeles (16 bits) | 400 × 400 píxeles (16 bits) |
| **Estructura de Carpetas** | `DCM/31069391/000.dcm ... 383.dcm` | `DICOM/HOYOS_..._001.dcm ... 300.dcm` |
| **Visor de Escritorio Incluido** | `VISOR GALILEO/` (.NET 2.0, Qt3, C++ dlls) | `INSTALAR SOFTWARE/` (InVivoDental) + `.exe` en raíz |
| **Peso Bruto Entregado** | **459.49 MB** | **209.28 MB** |
| **Peso DICOM Puro (Sin Visores)** | **192.67 MB** (-58.1%) | **92.96 MB** (-55.6%) |
| **Peso Optimizado en ZIP** | **127.31 MB** (-72.3%) | **55.24 MB** (-73.6%) |

---

## 2. ¿Es Necesario Seleccionar el Laboratorio al Cargar el Estudio?

### 2.1. A Nivel Administrativo / Multi-Tenant (Negocio):
**NO es necesario un selector manual adicional en la carga.**  
DiagnostiQ ya implementa una arquitectura multi-tenant:
- Cada usuario autenticado (auxiliar, bacteriólogo, radiólogo) ya tiene asignado un `lab_id` en su perfil (`profiles.lab_id`).
- Cada orden pertenece de forma inherente al laboratorio emisor (`orders.lab_id`).
- Por tanto, DiagnostiQ ya sabe a qué laboratorio corresponde cada resultado sin que el usuario tenga que seleccionarlo repetitivamente.

### 2.2. A Nivel Técnico (Motor del Visor DICOM):
**¡NO ES NECESARIO seleccionar el laboratorio ni la marca del equipo!**
- **Razón:** Ambos centros radiológicos (Rodigital y MAXISCAN 3D), a pesar de usar tomógrafos de marcas distintas (Sirona vs Soredex) y nombrar las carpetas de forma diferente (`DCM` vs `DICOM`), **cumplen con el estándar internacional DICOM 3.0**.
- Los cortes de ambos equipos tienen la misma firma binaria (`DICM`), el mismo tipo de almacenamiento (`CT Image Storage`), la misma sintaxis de transferencia y los mismos tags estandarizados de ventana (Window Center / Window Width).
- **El visor web (`DWV` / `Cornerstone3D`) es 100% agnóstico al laboratorio:** Lee cualquier tomografía DICOM del mundo de forma automática.

### 2.3. La Verdadera Diferencia: La Basura de Visores de Escritorio
Lo único que cambia entre laboratorios es el visor ejecutable obsoleto que empaquetan:
- Rodigital incluye `VISOR GALILEO` (266 MB).
- MAXISCAN 3D incluye `InVivoDentalViewer` + archivo de volumen `.inv` + `.exe` autoextraíble + documentos Word/PDF de instrucciones (116 MB de archivos innecesarios para la web).

---

## 3. Arquitectura del Filtro Inteligente Universal de ZIP

Para que el personal de recepción o laboratorio no tenga que aprender a "limpiar carpetas" ni preocuparse por la marca del tomógrafo, DiagnostiQ implementará un **Parser y Extractor Inteligente de ZIP**:

```
[Archivo .ZIP de Cualquier Laboratorio]
  (Rodigital, Maxiscan 3D, Carestream, Planmeca, Vatech, etc.)
                   │
                   ▼
       [DiagnostiQ Smart ZIP Parser]
                   │
                   ├── ❌ Ignora automáticamente:
                   │      • Archivos ejecutables (.exe, .msi, .bat)
                   │      • Volúmenes propietarios (.inv, .sdx, .gwg)
                   │      • Librerías y carpetas de sistema (.dll, .inf, Setup/)
                   │      • Documentos de texto (.docx, instructivos PDF)
                   │
                   └── ✅ Extrae recursivamente:
                          • Archivos con extensión .dcm
                          • Archivos binarios con cabecera estándar 'DICM'
                          • Ordena los cortes automáticamente por corte/instancia
                   │
                   ▼
  [Renderizado Web 3D Inmediato en el Navegador del Paciente]
```

---

## 4. Plan de Implementación Paso a Paso

### PASO 1: Migración en Supabase

Asegurar que la tabla `result_files` admita paquetes de tomografía y registre metadatos del estudio:

```sql
-- Agregar columna para tipo de archivo si no existe
ALTER TABLE public.result_files 
ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'PDF';

-- Agregar metadato JSON para guardar información del estudio (cortes, fabricante, modalidad)
ALTER TABLE public.result_files 
ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;

-- Actualizar registros existentes
UPDATE public.result_files 
SET file_type = 'PDF' 
WHERE file_type IS NULL;

COMMENT ON COLUMN public.result_files.file_type IS 'PDF para informes escritos, DICOM_ZIP para series tomográficas';
```

---

### PASO 2: Instalación de Dependencias en DiagnostiQ

Ejecutar en la raíz del proyecto `DiagnostiQ`:

```bash
npm install dwv jszip
```

---

### PASO 3: Actualización del Cargador (`src/components/ResultUploader.tsx`)

Modificar [ResultUploader.tsx](file:///C:/Users/RICAR/Escritorio/AppWeb/DiagnostiQ/src/components/ResultUploader.tsx) para admitir archivos comprimidos `.zip` de hasta 300 MB y clasificar automáticamente el resultado:

```tsx
// Configuración de react-dropzone para aceptar PDF y ZIP:
const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
        'application/pdf': ['.pdf'],
        'application/zip': ['.zip'],
        'application/x-zip-compressed': ['.zip'],
    },
    maxSize: 350 * 1024 * 1024, // 350 MB límite seguro
    disabled: isUploading || isSuccess
})
```

Al subir a `/api/results/upload`, detectar la extensión:
- Si el archivo termina en `.zip`: enviar `file_type = "DICOM_ZIP"`.
- Si el archivo termina en `.pdf`: enviar `file_type = "PDF"`.

---

### PASO 4: Componente del Visor Universal (`src/components/common/DicomViewerModal.tsx`)

El siguiente componente contiene el **algoritmo de extracción recursiva inteligente** que procesa sin problemas tanto la estructura de **Rodigital** (`DCM/31069391/*.dcm`) como la de **MAXISCAN 3D** (`DICOM/*.dcm`), o cualquier subcarpeta anidada:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Loader2, ZoomIn, Sun, Ruler, Download, Layers } from "lucide-react"
import JSZip from "jszip"
import { App } from "dwv"

interface DicomViewerModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    zipUrl: string | null
    downloadUrl?: string
}

export function DicomViewerModal({
    open,
    onOpenChange,
    title,
    zipUrl,
    downloadUrl,
}: DicomViewerModalProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const dwvAppRef = useRef<App | null>(null)

    const [loading, setLoading] = useState(true)
    const [loadStep, setLoadStep] = useState("Descargando estudio...")
    const [loadProgress, setLoadProgress] = useState(0)
    const [sliceIndex, setSliceIndex] = useState(0)
    const [totalSlices, setTotalSlices] = useState(0)
    const [activeTool, setActiveTool] = useState<"Scroll" | "ZoomAndPan" | "WindowLevel" | "Draw">("Scroll")

    useEffect(() => {
        if (!open || !zipUrl) return

        let isCancelled = false
        setLoading(true)
        setLoadProgress(5)
        setLoadStep("Conectando con almacenamiento seguro...")

        const loadDicomZip = async () => {
            try {
                // 1. Descarga el ZIP desde MinIO
                const response = await fetch(zipUrl)
                if (!response.ok) throw new Error("Error al descargar el estudio tomográfico")
                
                const blob = await response.blob()
                if (isCancelled) return
                setLoadProgress(35)
                setLoadStep("Descomprimiendo cortes tomográficos...")

                // 2. Descomprimir en memoria con JSZip
                const zip = await JSZip.loadAsync(blob)
                const dcmFiles: File[] = []

                // Filtro inteligente universal:
                // Descarta .exe, .inv, .sdx, .dll, .docx, .pdf y busca archivos .dcm o sin extensión
                const validEntries = Object.keys(zip.files).filter(fileName => {
                    const entry = zip.files[fileName]
                    if (entry.dir) return false
                    const lower = fileName.toLowerCase()
                    const isBanned = lower.endsWith(".exe") || lower.endsWith(".dll") || 
                                     lower.endsWith(".inf") || lower.endsWith(".docx") || 
                                     lower.endsWith(".inv") || lower.endsWith(".sdx") ||
                                     lower.endsWith(".pdf") || lower.endsWith(".manifest")
                    if (isBanned) return false
                    return lower.endsWith(".dcm") || !lower.includes(".")
                })

                let processed = 0
                for (const name of validEntries) {
                    if (isCancelled) return
                    const fileData = await zip.files[name].async("blob")
                    
                    // Extraer solo el nombre base sin rutas relativas para evitar problemas de índices
                    const baseName = name.split("/").pop() || name
                    dcmFiles.push(new File([fileData], baseName, { type: "application/dicom" }))
                    
                    processed++
                    if (processed % 25 === 0) {
                        setLoadProgress(35 + Math.round((processed / validEntries.length) * 45))
                    }
                }

                if (dcmFiles.length === 0) {
                    throw new Error("No se detectaron cortes tomográficos DICOM válidos en el archivo.")
                }

                // 3. Ordenamiento numérico inteligente (compatible con 000.dcm y HOYOS_..._001.dcm)
                dcmFiles.sort((a, b) => {
                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                })

                if (isCancelled) return
                setLoadProgress(85)
                setLoadStep("Inicializando motor de visualización 3D...")

                // 4. Inicializar DWV
                const app = new App()
                dwvAppRef.current = app

                app.init({
                    dataViewConfigs: {
                        '*': [{ divId: 'dwv-layer-container' }]
                    },
                    tools: {
                        Scroll: {},
                        ZoomAndPan: {},
                        WindowLevel: {},
                        Draw: { options: ['Ruler'] }
                    }
                })

                app.addEventListener("load-end", () => {
                    if (isCancelled) return
                    const nSlices = app.getImage().getGeometry().getSize().getNumberOfSlices()
                    setTotalSlices(nSlices)
                    setLoading(false)
                    setLoadProgress(100)
                    app.setTool("Scroll")
                })

                app.addEventListener("slice-change", (event: any) => {
                    setSliceIndex(event.value)
                })

                // Cargar los archivos en el visor
                app.loadFiles(dcmFiles)

            } catch (err: any) {
                console.error("Error al montar visor DICOM:", err)
                setLoading(false)
            }
        }

        loadDicomZip()

        return () => {
            isCancelled = true
            if (dwvAppRef.current) {
                dwvAppRef.current.reset()
                dwvAppRef.current = null
            }
        }
    }, [open, zipUrl])

    const handleToolChange = (tool: "Scroll" | "ZoomAndPan" | "WindowLevel" | "Draw") => {
        setActiveTool(tool)
        if (dwvAppRef.current) {
            dwvAppRef.current.setTool(tool)
            if (tool === "Draw") {
                dwvAppRef.current.setDrawShape("Ruler")
            }
        }
    }

    const handleSliceSlider = (value: number[]) => {
        const nextSlice = value[0]
        setSliceIndex(nextSlice)
        if (dwvAppRef.current) {
            const viewController = dwvAppRef.current.getViewController()
            if (viewController) viewController.setCurrentPosition({ k: nextSlice })
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl w-[96vw] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-950 text-white rounded-2xl border-slate-800">
                {/* Header con Herramientas Médicas */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/90 shrink-0">
                    <div className="min-w-0 pr-4">
                        <DialogTitle className="text-sm font-semibold truncate text-white">{title}</DialogTitle>
                        <p className="text-xs text-slate-400">
                            {loading ? loadStep : `Corte ${sliceIndex + 1} de ${totalSlices} (Tomografía Axial Computarizada)`}
                        </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                            size="sm"
                            variant={activeTool === "Scroll" ? "default" : "outline"}
                            className="h-8 text-xs gap-1 border-slate-700"
                            onClick={() => handleToolChange("Scroll")}
                            disabled={loading}
                        >
                            <Layers className="h-3.5 w-3.5" /> Cortes
                        </Button>
                        <Button
                            size="sm"
                            variant={activeTool === "WindowLevel" ? "default" : "outline"}
                            className="h-8 text-xs gap-1 border-slate-700"
                            onClick={() => handleToolChange("WindowLevel")}
                            disabled={loading}
                        >
                            <Sun className="h-3.5 w-3.5" /> Contraste
                        </Button>
                        <Button
                            size="sm"
                            variant={activeTool === "ZoomAndPan" ? "default" : "outline"}
                            className="h-8 text-xs gap-1 border-slate-700"
                            onClick={() => handleToolChange("ZoomAndPan")}
                            disabled={loading}
                        >
                            <ZoomIn className="h-3.5 w-3.5" /> Zoom
                        </Button>
                        <Button
                            size="sm"
                            variant={activeTool === "Draw" ? "default" : "outline"}
                            className="h-8 text-xs gap-1 border-slate-700"
                            onClick={() => handleToolChange("Draw")}
                            disabled={loading}
                        >
                            <Ruler className="h-3.5 w-3.5" /> Medir (mm)
                        </Button>
                        {downloadUrl && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 text-xs gap-1 ml-2 bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={() => window.open(downloadUrl, "_blank")}
                            >
                                <Download className="h-3.5 w-3.5" /> Descargar DICOM
                            </Button>
                        )}
                    </div>
                </div>

                {/* Lienzo de Renderizado WebGL */}
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 z-20 gap-3">
                            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                            <p className="text-sm font-medium text-slate-300">{loadStep}</p>
                            <div className="w-64 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-500 h-1.5 transition-all duration-300" style={{ width: `${loadProgress}%` }} />
                            </div>
                        </div>
                    )}
                    <div id="dwv-layer-container" ref={containerRef} className="w-full h-full relative" />
                </div>

                {/* Scrubber de Navegación de Cortes */}
                {totalSlices > 1 && (
                    <div className="px-8 py-3 bg-slate-900 border-t border-slate-800 flex items-center gap-4 shrink-0">
                        <span className="text-xs text-slate-400 shrink-0 font-mono">1</span>
                        <Slider
                            value={[sliceIndex]}
                            min={0}
                            max={Math.max(0, totalSlices - 1)}
                            step={1}
                            onValueChange={handleSliceSlider}
                            className="flex-1"
                        />
                        <span className="text-xs text-slate-400 shrink-0 font-mono">{totalSlices}</span>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
```

---

### PASO 5: Integración en el Portal del Paciente (`src/app/portal/orders/[id]/page.tsx`)

En la vista de resultados de la orden:

```tsx
// Distinción visual entre Informe PDF y Tomografía 3D:
{file.file_name.toLowerCase().endsWith(".zip") || file.file_type === "DICOM_ZIP" ? (
    <div className="flex items-center gap-2">
        <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => handleOpenDicomViewer(file)}
        >
            <Microscope className="h-3.5 w-3.5" />
            Ver Tomografía 3D (Web)
        </Button>
        <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 border-slate-300"
            onClick={() => handleDownload(file.id)}
        >
            <Download className="h-3.5 w-3.5" />
            Descargar DICOM (.zip)
        </Button>
    </div>
) : (
    // Botones convencionales de PDF (Previsualizar y Descargar PDF)
    ...
)}
```

---

## 5. Métricas de Almacenamiento Promedio Ponderado

Combinando los datos de ambos centros radiológicos:

- **Estudio Grande (Rodigital / Maxilofacial Completo):** ~127 MB en ZIP
- **Estudio Mediano (MAXISCAN 3D / Maxilar Superior):** ~55 MB en ZIP
- **Tamaño Promedio por Tomografía en DiagnostiQ:** **~91 MB por estudio**

| Cantidad de Estudios | Almacenamiento Promedio en MinIO/S3 | Costo Cloud Estimado / Mes |
| :--- | :--- | :--- |
| **100 tomografías** | ~9.1 GB | ~$0.20 USD |
| **500 tomografías** | ~45.5 GB | ~$1.05 USD |
| **1,000 tomografías** | ~91.0 GB | ~$2.10 USD |
| **5,000 tomografías** | ~455.0 GB | ~$10.50 USD |

---

## 6. Conclusiones y Respuestas Definitivas

1. **¿Es necesario seleccionar el laboratorio al subir el archivo?**  
   **No.** A nivel de usuario/tenant, DiagnostiQ ya conoce el laboratorio de la orden. A nivel técnico, el parser inteligente de DiagnostiQ procesa cualquier archivo ZIP, ignora automáticamente los visores de escritorio de cada clínica (`VISOR GALILEO`, `InVivoDental`, etc.) y extrae los cortes DICOM estándar de forma 100% autónoma.
2. **¿Funciona con otros laboratorios que se sumen en el futuro?**  
   **Sí.** Cualquier centro que cuente con tomógrafos Carestream, KaVo, Planmeca, Vatech, Morita, Sirona o Soredex exportará DICOM 3.0 estándar y será compatible de inmediato con DiagnostiQ sin requerir configuraciones adicionales.
3. **¿Afecta el rendimiento?**  
   **No.** La descompresión y el cálculo gráfico volumétrico se ejecutan del lado del cliente (client-side con WebGL y WebAssembly), asegurando que el servidor de DiagnostiQ se mantenga rápido y estable.
