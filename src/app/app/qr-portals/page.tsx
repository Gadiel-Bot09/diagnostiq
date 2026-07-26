"use client"

import React, { useState, useEffect, useRef } from "react"
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react"
import { 
    QrCode, 
    Printer, 
    Download, 
    Copy, 
    Check, 
    HeartPulse, 
    Stethoscope, 
    ShieldCheck, 
    ExternalLink, 
    Sparkles, 
    Smartphone, 
    Share2, 
    UploadCloud, 
    RefreshCw, 
    Image as ImageIcon, 
    FileText, 
    Layers 
} from "lucide-react"
import { Logo, LogoIcon } from "@/components/common/Logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { usePermissions } from "@/contexts/PermissionsContext"
import { cn } from "@/lib/utils"

interface PortalConfig {
    id: "patient" | "doctor" | "staff"
    title: string
    subtitle: string
    badge: string
    badgeColor: string
    badgeHex: string
    description: string
    path: string
    icon: React.ElementType
    instructions: string[]
    defaultColor: string
    gradient: string
}

const PORTALS: PortalConfig[] = [
    {
        id: "patient",
        title: "Portal de Pacientes",
        subtitle: "Consultas y Descarga de Resultados en Línea",
        badge: "Acceso Público · 24/7",
        badgeColor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300",
        badgeHex: "#059669",
        description: "Permite a los pacientes escanear el código con la cámara de su celular e ingresar con tu número de documento para descargar sus informes en PDF con validez digital.",
        path: "/portal/login",
        icon: HeartPulse,
        instructions: [
            "Abre la cámara web de tu teléfono móvil o tableta.",
            "Apunta hacia el código QR hasta que aparezca el enlace web.",
            "Ingresa con tu número de documento de identidad para ver tus resultados."
        ],
        defaultColor: "#0F172A",
        gradient: "from-emerald-500/10 via-teal-500/5 to-transparent",
    },
    {
        id: "doctor",
        title: "Portal Médico Remitente",
        subtitle: "Historial Clínico y Referencias en Tiempo Real",
        badge: "Profesionales de Salud",
        badgeColor: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-300",
        badgeHex: "#0D9488",
        description: "Acceso confidencial y cifrado para que médicos aliados y especialistas consulten en tiempo real los resultados de los pacientes que han remitido al laboratorio.",
        path: "/doctor",
        icon: Stethoscope,
        instructions: [
            "Acceso exclusivo para médicos y especialistas registrados.",
            "Consulta interactiva de históricos de exámenes y gráficas de evolución.",
            "Descarga de informes con firma digital verificable."
        ],
        defaultColor: "#0F172A",
        gradient: "from-teal-500/10 via-cyan-500/5 to-transparent",
    },
    {
        id: "staff",
        title: "Portal de Laboratorio & Staff",
        subtitle: "Sistema Interno LIS & Administración",
        badge: "Acceso Restringido",
        badgeColor: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-300",
        badgeHex: "#4F46E5",
        description: "Ingreso al panel de control para personal operativo de laboratorio, bacteriólogos, administración, facturación y directores técnicos.",
        path: "/app/login",
        icon: ShieldCheck,
        instructions: [
            "Acceso restringido para personal técnico y administrativo.",
            "Gestión completa del ciclo de vida de órdenes clínicas.",
            "Cargue automatizado y manual de resultados e interfaces de analizadores."
        ],
        defaultColor: "#4F46E5",
        gradient: "from-indigo-500/10 via-blue-500/5 to-transparent",
    }
]

const COLOR_THEMES = [
    { label: "Negro Clásico", value: "#0F172A", bg: "bg-slate-900" },
    { label: "Indigo DiagnostiQ", value: "#4F46E5", bg: "bg-indigo-600" },
    { label: "Esmeralda Clínico", value: "#059669", bg: "bg-emerald-600" },
    { label: "Azul Rey", value: "#2563EB", bg: "bg-blue-600" },
    { label: "Violeta Tech", value: "#7C3AED", bg: "bg-violet-600" },
]

export default function QrPortalsPage() {
    const { toast } = useToast()
    const { hasPermission } = usePermissions()
    const canEditLogo = hasPermission("qr", "edit") || hasPermission("qr", "create") || hasPermission("qr", "upload") || hasPermission("settings", "edit")
    const [origin, setOrigin] = useState<string>("https://diagnostiq.sinuhub.com")
    const [selectedTab, setSelectedTab] = useState<string>("patient")
    const [qrColor, setQrColor] = useState<string>("#0F172A")
    const [labName, setLabName] = useState<string>("Laboratorio Clínico DiagnostiQ")
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [isPrinting, setIsPrinting] = useState<boolean>(false)
    const [printPortal, setPrintPortal] = useState<PortalConfig | null>(null)

    // Custom Logo state (defaulting to /favicon.svg)
    const [customLogoUrl, setCustomLogoUrl] = useState<string>("/favicon.svg")
    const [isUploadingLogo, setIsUploadingLogo] = useState<boolean>(false)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Canvas refs for QR canvas grabbing
    const canvasRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})

    useEffect(() => {
        if (typeof window !== "undefined") {
            if (window.location.origin) {
                setOrigin(window.location.origin)
            }
            // Load saved customizations from localStorage
            const savedLogo = localStorage.getItem("diagnostiq_custom_qr_logo")
            if (savedLogo) setCustomLogoUrl(savedLogo)
            const savedLabName = localStorage.getItem("diagnostiq_custom_lab_name")
            if (savedLabName) setLabName(savedLabName)
        }
    }, [])

    const handleLabNameChange = (val: string) => {
        setLabName(val)
        if (typeof window !== "undefined") {
            localStorage.setItem("diagnostiq_custom_lab_name", val)
        }
    }

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!file.type.startsWith("image/")) {
            toast({
                variant: "destructive",
                title: "Formato inválido",
                description: "Por favor sube un archivo de imagen (PNG, JPG, SVG o WEBP).",
            })
            return
        }

        setIsUploadingLogo(true)
        try {
            const formData = new FormData()
            formData.append("file", file)

            const res = await fetch("/api/qr-portals/upload-logo", {
                method: "POST",
                body: formData,
            })

            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || "Error al subir logotipo")
            }

            // Use base64Url for immediate CORS-free canvas rendering
            const targetUrl = data.base64Url || data.url
            setCustomLogoUrl(targetUrl)
            if (typeof window !== "undefined") {
                localStorage.setItem("diagnostiq_custom_qr_logo", targetUrl)
            }

            toast({
                title: "Logotipo de Laboratorio Actualizado",
                description: "El logo ha sido subido a MinIO y se integrará en el centro de todos los códigos QR.",
            })
        } catch (err: any) {
            toast({
                variant: "destructive",
                title: "Error al subir imagen",
                description: err.message || "Ocurrió un error al procesar el logotipo.",
            })
        } finally {
            setIsUploadingLogo(false)
            if (fileInputRef.current) fileInputRef.current.value = ""
        }
    }

    const handleResetLogo = () => {
        setCustomLogoUrl("/favicon.svg")
        if (typeof window !== "undefined") {
            localStorage.removeItem("diagnostiq_custom_qr_logo")
        }
        toast({
            title: "Logotipo Restablecido",
            description: "Se ha vuelto a aplicar el icono oficial de DiagnostiQ.",
        })
    }

    const handleCopyLink = (path: string, id: string) => {
        const fullUrl = `${origin}${path}`
        navigator.clipboard.writeText(fullUrl)
        setCopiedId(id)
        toast({
            title: "Enlace copiado al portapapeles",
            description: `URL: ${fullUrl}`,
        })
        setTimeout(() => setCopiedId(null), 2500)
    }

    // Download JUST the raw square QR code
    const handleDownloadSimpleQR = (portalId: string, title: string) => {
        const container = canvasRefs.current[portalId]
        if (!container) return
        const canvas = container.querySelector("canvas")
        if (!canvas) return

        const pngUrl = canvas.toDataURL("image/png")
        const downloadLink = document.createElement("a")
        downloadLink.href = pngUrl
        downloadLink.download = `QR_Simple_${title.replace(/\s+/g, "_")}.png`
        document.body.appendChild(downloadLink)
        downloadLink.click()
        document.body.removeChild(downloadLink)

        toast({
            title: "QR Simple Descargado",
            description: "Imagen cuadrada del código QR generada.",
        })
    }

    // Generate & Download a Complete Branded Poster / Card in High Resolution (1080x1440)
    const handleDownloadFullPoster = async (portal: PortalConfig) => {
        const container = canvasRefs.current[portal.id]
        if (!container) return
        const qrCanvas = container.querySelector("canvas")
        if (!qrCanvas) {
            toast({ variant: "destructive", title: "Error", description: "No se encontró el lienzo del QR." })
            return
        }

        toast({
            title: "Generando Cartel Completo...",
            description: "Diseñando imagen en alta resolución (1080x1440 px) con identificación de portal.",
        })

        try {
            // Create offscreen canvas 1080x1440 (3:4 ratio)
            const canvas = document.createElement("canvas")
            canvas.width = 1080
            canvas.height = 1440
            const ctx = canvas.getContext("2d")
            if (!ctx) return

            // 1. Background
            ctx.fillStyle = "#FFFFFF"
            ctx.fillRect(0, 0, 1080, 1440)

            // Top colored banner bar
            ctx.fillStyle = portal.badgeHex
            ctx.fillRect(0, 0, 1080, 24)

            // 2. Load custom logo or default logo for top header
            const logoImg = new Image()
            logoImg.crossOrigin = "anonymous"
            logoImg.src = customLogoUrl

            await new Promise((resolve) => {
                logoImg.onload = resolve
                logoImg.onerror = resolve
            })

            // Draw Header Section
            if (logoImg.complete && logoImg.naturalWidth > 0) {
                ctx.drawImage(logoImg, 80, 70, 90, 90)
            }

            ctx.textAlign = "left"
            ctx.fillStyle = "#0F172A"
            ctx.font = "bold 44px sans-serif"
            ctx.fillText("DiagnostiQ", 190, 115)

            ctx.fillStyle = "#64748B"
            ctx.font = "bold 22px sans-serif"
            ctx.fillText(labName.toUpperCase(), 190, 150)

            // Horizontal Separator
            ctx.strokeStyle = "#E2E8F0"
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.moveTo(80, 200)
            ctx.lineTo(1000, 200)
            ctx.stroke()

            // 3. Portal Title & Badge
            ctx.textAlign = "center"
            
            // Badge pill
            ctx.fillStyle = portal.badgeHex + "20" // 12% opacity
            ctx.strokeStyle = portal.badgeHex
            ctx.lineWidth = 2
            const badgeText = portal.badge.toUpperCase()
            ctx.font = "bold 20px sans-serif"
            const badgeWidth = ctx.measureText(badgeText).width + 60
            const badgeX = (1080 - badgeWidth) / 2
            
            ctx.beginPath()
            ctx.roundRect(badgeX, 240, badgeWidth, 46, 23)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = portal.badgeHex
            ctx.fillText(badgeText, 540, 270)

            // Main Portal Title
            ctx.fillStyle = "#0F172A"
            ctx.font = "900 62px sans-serif"
            ctx.fillText(portal.title.toUpperCase(), 540, 360)

            // Subtitle
            ctx.fillStyle = "#475569"
            ctx.font = "bold 26px sans-serif"
            ctx.fillText(portal.subtitle, 540, 405)

            // 4. QR Code Box
            // Outer decorated box
            const qrBoxSize = 580
            const qrBoxX = (1080 - qrBoxSize) / 2
            const qrBoxY = 450
            
            ctx.fillStyle = "#F8FAFC"
            ctx.strokeStyle = "#CBD5E1"
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 40)
            ctx.fill()
            ctx.stroke()

            // Draw the QR Code image from hidden canvas
            ctx.drawImage(qrCanvas, qrBoxX + 30, qrBoxY + 30, qrBoxSize - 60, qrBoxSize - 60)

            // 5. Instructions Section
            ctx.textAlign = "center"
            ctx.fillStyle = "#0F172A"
            ctx.font = "bold 26px sans-serif"
            ctx.fillText("INSTRUCCIONES DE INGRESO RÁPIDO:", 540, 1085)

            ctx.textAlign = "left"
            ctx.font = "22px sans-serif"
            let instY = 1145
            portal.instructions.forEach((inst, idx) => {
                // Circle number
                ctx.fillStyle = portal.badgeHex
                ctx.beginPath()
                ctx.arc(140, instY - 7, 18, 0, Math.PI * 2)
                ctx.fill()

                ctx.fillStyle = "#FFFFFF"
                ctx.font = "bold 20px sans-serif"
                ctx.textAlign = "center"
                ctx.fillText(String(idx + 1), 140, instY)

                // Text
                ctx.textAlign = "left"
                ctx.fillStyle = "#334155"
                ctx.font = "medium 22px sans-serif"
                ctx.fillText(inst, 175, instY)
                instY += 55
            })

            // 6. Footer URL bar
            ctx.fillStyle = "#F1F5F9"
            ctx.strokeStyle = "#E2E8F0"
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.roundRect(100, 1315, 880, 60, 15)
            ctx.fill()
            ctx.stroke()

            ctx.textAlign = "center"
            ctx.fillStyle = "#0F172A"
            ctx.font = "bold 22px monospace"
            ctx.fillText(`${origin}${portal.path}`, 540, 1353)

            // Trigger Download
            const pngUrl = canvas.toDataURL("image/png")
            const downloadLink = document.createElement("a")
            downloadLink.href = pngUrl
            downloadLink.download = `Cartel_${portal.title.replace(/\s+/g, "_")}_DiagnostiQ.png`
            document.body.appendChild(downloadLink)
            downloadLink.click()
            document.body.removeChild(downloadLink)

            toast({
                title: "Cartel Oficial Descargado",
                description: `Imagen PNG completa con identificación del ${portal.title} lista para compartir.`,
            })
        } catch (err: any) {
            console.error("Error generating poster:", err)
            toast({ variant: "destructive", title: "Error", description: "No se pudo generar la imagen del cartel." })
        }
    }

    const handlePrintSign = (portal: PortalConfig) => {
        setPrintPortal(portal)
        setIsPrinting(true)
        setTimeout(() => {
            window.print()
            setIsPrinting(false)
        }, 300)
    }

    return (
        <div className="container mx-auto p-4 md:p-8 space-y-8 max-w-7xl animate-in fade-in-50 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b">
                <div>
                    <div className="flex items-center gap-2 text-primary mb-1">
                        <QrCode className="h-6 w-6" />
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-semibold">
                            Acceso y Distribución Digital
                        </Badge>
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight">Códigos QR de Portales</h1>
                    <p className="text-muted-foreground mt-1 max-w-2xl text-sm md:text-base">
                        Genera carteles completos con identificación clara del portal y logotipo de tu laboratorio (almacenado en MinIO) para colocar en mostradores o redes sociales.
                    </p>
                </div>

                {/* Customizer & Logo Upload Bar */}
                <Card className="bg-muted/40 border p-4 shrink-0 shadow-sm w-full md:w-auto">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 text-xs">
                        {/* Lab Name Input */}
                        <div className="space-y-1 w-full sm:w-auto">
                            <Label htmlFor="labName" className="font-bold text-foreground">Nombre de Laboratorio en Cartel:</Label>
                            <Input 
                                id="labName" 
                                value={labName} 
                                onChange={(e) => handleLabNameChange(e.target.value)} 
                                className="h-8 w-full sm:w-64 text-xs bg-background font-medium"
                                placeholder="Nombre institucional..."
                            />
                        </div>

                        {/* MinIO Custom Logo Uploader */}
                        <div className="space-y-1">
                            <Label className="font-bold text-foreground flex items-center gap-1.5">
                                <span>Logo Central del QR (MinIO):</span>
                            </Label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleLogoUpload}
                                    accept="image/*"
                                    className="hidden"
                                    id="logo-upload-input"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs font-bold gap-1.5 bg-background hover:bg-primary hover:text-white transition-colors"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingLogo || !canEditLogo}
                                    title={!canEditLogo ? "No tienes permisos para cambiar el logotipo del laboratorio" : "Subir nuevo logotipo"}
                                >
                                    {isUploadingLogo ? (
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                                    ) : (
                                        <UploadCloud className="h-3.5 w-3.5 text-primary" />
                                    )}
                                    <span>{isUploadingLogo ? "Subiendo a MinIO..." : "Subir Logo"}</span>
                                </Button>

                                {customLogoUrl !== "/favicon.svg" && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1 px-2"
                                        onClick={handleResetLogo}
                                        title="Volver al logo oficial de DiagnostiQ"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                        <span className="hidden sm:inline">Restablecer</span>
                                    </Button>
                                )}

                                {/* Thumbnail indicator */}
                                <div className="h-8 w-8 rounded-lg border bg-white p-0.5 shadow-inner flex items-center justify-center shrink-0">
                                    <img src={customLogoUrl} alt="Logo QR" className="max-h-full max-w-full object-contain" />
                                </div>
                            </div>
                        </div>

                        {/* QR Color Picker */}
                        <div className="space-y-1">
                            <Label className="font-bold text-foreground">Color QR:</Label>
                            <div className="flex items-center gap-1.5 pt-0.5">
                                {COLOR_THEMES.map((c) => (
                                    <button
                                        key={c.value}
                                        onClick={() => setQrColor(c.value)}
                                        title={c.label}
                                        className={cn(
                                            "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                                            c.bg,
                                            qrColor === c.value ? "border-foreground ring-2 ring-primary ring-offset-2 scale-110" : "border-transparent opacity-80"
                                        )}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Main Tabs */}
            <Tabs defaultValue="patient" value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
                <TabsList className="grid grid-cols-3 w-full max-w-2xl bg-muted p-1.5 rounded-2xl h-14 shadow-sm">
                    {PORTALS.map((p) => {
                        const Icon = p.icon
                        return (
                            <TabsTrigger 
                                key={p.id} 
                                value={p.id}
                                className="rounded-xl gap-2 font-extrabold text-xs md:text-sm data-[state=active]:bg-background data-[state=active]:shadow-md transition-all py-2"
                            >
                                <Icon className="h-4 w-4 shrink-0 text-primary" />
                                <span className="truncate">{p.title}</span>
                            </TabsTrigger>
                        )
                    })}
                </TabsList>

                {PORTALS.map((portal) => {
                    const Icon = portal.icon
                    const fullUrl = `${origin}${portal.path}`

                    return (
                        <TabsContent key={portal.id} value={portal.id} className="focus:outline-none">
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                                {/* Left: Interactive Branded Preview Card */}
                                <div className="lg:col-span-7 space-y-6">
                                    <Card className={cn("overflow-hidden border-2 shadow-2xl bg-gradient-to-b from-background to-muted/20 relative")}>
                                        <div className={cn("absolute inset-0 bg-gradient-to-r opacity-70 pointer-events-none", portal.gradient)} />
                                        
                                        {/* Portal Identification Banner inside card */}
                                        <CardHeader className="relative z-10 pb-4 border-b bg-background/90 backdrop-blur-md">
                                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0 shadow-sm">
                                                        <Icon className="h-7 w-7" />
                                                    </div>
                                                    <div>
                                                        <Badge variant="outline" className={cn("font-bold text-[11px] px-2.5 py-0.5 mb-1 uppercase tracking-wider", portal.badgeColor)}>
                                                            {portal.badge}
                                                        </Badge>
                                                        <CardTitle className="text-2xl font-black text-foreground tracking-tight">{portal.title}</CardTitle>
                                                    </div>
                                                </div>
                                                <div className="text-right hidden sm:block">
                                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest block">Acceso Oficial</span>
                                                    <span className="text-sm font-extrabold text-primary">{labName}</span>
                                                </div>
                                            </div>
                                        </CardHeader>

                                        <CardContent className="p-6 sm:p-8 relative z-10 flex flex-col items-center justify-center text-center space-y-6">
                                            {/* Subtitle */}
                                            <p className="font-bold text-sm md:text-base text-slate-600 dark:text-slate-300 max-w-md">
                                                {portal.subtitle}
                                            </p>

                                            {/* QR Code Container with sleek frame */}
                                            <div 
                                                ref={(el) => { canvasRefs.current[portal.id] = el }}
                                                className="p-8 bg-white rounded-[32px] shadow-2xl border-4 border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center relative group transform transition-transform duration-300 hover:scale-[1.02]"
                                            >
                                                {/* Hidden canvas for super high resolution 1024x1024 grabbing */}
                                                <div className="hidden">
                                                    <QRCodeCanvas
                                                        value={fullUrl}
                                                        size={1024}
                                                        bgColor="#ffffff"
                                                        fgColor={qrColor}
                                                        level="H"
                                                        includeMargin={true}
                                                        imageSettings={{
                                                            src: customLogoUrl,
                                                            x: undefined,
                                                            y: undefined,
                                                            height: 220,
                                                            width: 220,
                                                            excavate: true,
                                                        }}
                                                    />
                                                </div>

                                                <QRCodeSVG
                                                    value={fullUrl}
                                                    size={260}
                                                    bgColor="#ffffff"
                                                    fgColor={qrColor}
                                                    level="H"
                                                    includeMargin={false}
                                                    imageSettings={{
                                                        src: customLogoUrl,
                                                        x: undefined,
                                                        y: undefined,
                                                        height: 58,
                                                        width: 58,
                                                        excavate: true,
                                                    }}
                                                />

                                                <div className="mt-5 pt-3 border-t border-slate-100 w-full flex items-center justify-center gap-1.5 text-xs font-black tracking-wider text-slate-500 uppercase">
                                                    <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                                                    <span>Escanea para ingreso al {portal.title}</span>
                                                </div>
                                            </div>

                                            {/* URL Display */}
                                            <div className="w-full max-w-md bg-muted/80 rounded-xl p-3 border flex items-center justify-between gap-3 text-xs shadow-inner">
                                                <div className="truncate font-mono text-muted-foreground font-bold pl-2">
                                                    {fullUrl}
                                                </div>
                                                <Button 
                                                    variant="secondary" 
                                                    size="sm" 
                                                    className="h-7 shrink-0 text-xs font-bold gap-1.5 hover:bg-primary hover:text-white transition-colors"
                                                    onClick={() => handleCopyLink(portal.path, portal.id)}
                                                >
                                                    {copiedId === portal.id ? (
                                                        <>
                                                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                                                            <span>Copiado</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Copy className="h-3.5 w-3.5" />
                                                            <span>Copiar URL</span>
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </CardContent>

                                        <CardFooter className="bg-muted/40 border-t p-6 flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
                                            <div className="text-xs text-muted-foreground flex items-center gap-2 font-medium">
                                                <Smartphone className="h-4 w-4 text-primary shrink-0" />
                                                <span>Cartel completo con identificación del portal y tu logo.</span>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
                                                {/* Button 1: Download Complete Poster */}
                                                <Button 
                                                    variant="default" 
                                                    className="w-full sm:w-auto font-extrabold gap-2 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/90 hover:to-indigo-600/90 shadow-lg shadow-primary/20 text-white"
                                                    onClick={() => handleDownloadFullPoster(portal)}
                                                >
                                                    <Download className="h-4 w-4" />
                                                    <span>Descargar Cartel Identificado (PNG)</span>
                                                </Button>

                                                {/* Button 2: Download Simple QR */}
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    className="w-full sm:w-auto font-bold gap-1.5 text-xs border-primary/20 hover:bg-primary/5"
                                                    onClick={() => handleDownloadSimpleQR(portal.id, portal.title)}
                                                    title="Descargar únicamente el cuadrado del código QR"
                                                >
                                                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                                                    <span>Solo QR Simple</span>
                                                </Button>

                                                {/* Button 3: Print */}
                                                <Button 
                                                    variant="secondary" 
                                                    size="sm"
                                                    className="w-full sm:w-auto font-bold gap-1.5 text-xs"
                                                    onClick={() => handlePrintSign(portal)}
                                                >
                                                    <Printer className="h-3.5 w-3.5" />
                                                    <span>Imprimir Cartel</span>
                                                </Button>
                                            </div>
                                        </CardFooter>
                                    </Card>
                                </div>

                                {/* Right: Instructions & Uses */}
                                <div className="lg:col-span-5 space-y-6">
                                    <Card className="border shadow-md">
                                        <CardHeader>
                                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                                <Share2 className="h-5 w-5 text-primary" />
                                                ¿Cómo distribuir este Código QR?
                                            </CardTitle>
                                            <CardDescription className="text-xs">
                                                Recomendaciones operativas para maximizar el uso del {portal.title}.
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4 text-sm">
                                            <p className="text-muted-foreground text-xs leading-relaxed">
                                                {portal.description}
                                            </p>

                                            <div className="space-y-3 pt-2">
                                                <h4 className="font-bold text-xs uppercase tracking-wider text-foreground">Instrucciones para el Usuario:</h4>
                                                <ul className="space-y-2.5">
                                                    {portal.instructions.map((inst, idx) => (
                                                        <li key={idx} className="flex items-start gap-2.5 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border">
                                                            <div className="h-5 w-5 rounded-full bg-primary/15 text-primary font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                                                                {idx + 1}
                                                            </div>
                                                            <span className="leading-tight">{inst}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>

                                            <div className="pt-4 border-t space-y-2">
                                                <h4 className="font-bold text-xs uppercase tracking-wider text-foreground">Lugares recomendados de colocación:</h4>
                                                <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                                                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 p-2 rounded-lg font-semibold flex items-center gap-1.5">
                                                        <Check className="h-3 w-3 shrink-0" /> Recepción y Taquilla
                                                    </div>
                                                    <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-800 dark:text-indigo-300 p-2 rounded-lg font-semibold flex items-center gap-1.5">
                                                        <Check className="h-3 w-3 shrink-0" /> Resultados y Facturas
                                                    </div>
                                                    <div className="bg-blue-500/10 border border-blue-500/20 text-blue-800 dark:text-blue-300 p-2 rounded-lg font-semibold flex items-center gap-1.5">
                                                        <Check className="h-3 w-3 shrink-0" /> Consultorios Médicos
                                                    </div>
                                                    <div className="bg-violet-500/10 border border-violet-500/20 text-violet-800 dark:text-violet-300 p-2 rounded-lg font-semibold flex items-center gap-1.5">
                                                        <Check className="h-3 w-3 shrink-0" /> WhatsApp y Correos
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Direct Test button */}
                                    <div className="p-4 rounded-2xl bg-gradient-to-r from-primary/10 via-indigo-500/10 to-emerald-500/10 border border-primary/20 flex items-center justify-between gap-4">
                                        <div>
                                            <h4 className="text-xs font-bold text-foreground">Probar Enlace en Vivo</h4>
                                            <p className="text-[11px] text-muted-foreground">Verifica cómo se ve la interfaz del portal en una nueva ventana.</p>
                                        </div>
                                        <Button 
                                            size="sm" 
                                            variant="outline" 
                                            className="font-bold text-xs shrink-0 gap-1.5 bg-background shadow-sm"
                                            onClick={() => window.open(fullUrl, "_blank")}
                                        >
                                            <span>Abrir Portal</span>
                                            <ExternalLink className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                    )
                })}
            </Tabs>

            {/* PRINT ONLY MODAL/VIEW FOR COUNTER SIGNS (HABLADORES DE MESA) */}
            <div className="hidden print:block fixed inset-0 bg-white text-slate-900 z-[9999] p-12">
                <style jsx global>{`
                    @media print {
                        body * {
                            visibility: hidden;
                        }
                        .print\\:block, .print\\:block * {
                            visibility: visible;
                        }
                        .print\\:block {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 100%;
                            min-height: 100%;
                            background: white !important;
                        }
                        @page {
                            size: portrait;
                            margin: 1.5cm;
                        }
                    }
                `}</style>

                {printPortal && (
                    <div className="max-w-2xl mx-auto border-[6px] border-indigo-900/10 rounded-[40px] p-12 text-center flex flex-col items-center justify-between min-h-[85vh] relative overflow-hidden bg-gradient-to-b from-slate-50/50 via-white to-slate-50/30">
                        {/* Decorative Top Banner */}
                        <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-500" />

                        {/* Lab Logo & Brand */}
                        <div className="pt-6 pb-4 border-b border-slate-200 w-full flex flex-col items-center">
                            <div className="flex items-center justify-center gap-3 mb-2">
                                <img src={customLogoUrl} alt="Lab Logo" className="h-14 w-14 object-contain" />
                                <div className="text-left">
                                    <h1 style={{ margin: 0, fontSize: "36px", fontWeight: 900, color: "#0F172A", letterSpacing: "-1px", lineHeight: 1 }}>
                                        Diagnosti<span style={{ color: "#4F46E5" }}>Q</span>
                                    </h1>
                                    <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "#64748B", letterSpacing: "3px", textTransform: "uppercase", fontWeight: 800 }}>
                                        {labName}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Title of the Sign */}
                        <div className="my-6 space-y-2">
                            <span className="inline-block px-4 py-1.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold text-sm uppercase tracking-widest border border-indigo-200">
                                {printPortal.badge}
                            </span>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight">
                                {printPortal.title}
                            </h2>
                            <p className="text-base text-slate-600 max-w-lg mx-auto font-medium">
                                {printPortal.subtitle}
                            </p>
                        </div>

                        {/* QR Code Container in Print */}
                        <div className="p-8 bg-white rounded-[36px] shadow-2xl border-4 border-slate-200 my-4 inline-block">
                            <QRCodeSVG
                                value={`${origin}${printPortal.path}`}
                                size={320}
                                bgColor="#ffffff"
                                fgColor={qrColor}
                                level="H"
                                includeMargin={false}
                                imageSettings={{
                                    src: customLogoUrl,
                                    x: undefined,
                                    y: undefined,
                                    height: 72,
                                    width: 72,
                                    excavate: true,
                                }}
                            />
                        </div>

                        {/* Simple 3-step instructions */}
                        <div className="w-full max-w-lg mx-auto my-4 bg-slate-50 rounded-2xl p-6 border border-slate-200/80 text-left">
                            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 mb-4 text-center">
                                ¿Cómo ingresar desde tu celular o tableta?
                            </h3>
                            <div className="grid grid-cols-1 gap-3 text-sm font-medium text-slate-700">
                                {printPortal.instructions.map((inst, idx) => (
                                    <div key={idx} className="flex items-center gap-3">
                                        <div className="h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                                            {idx + 1}
                                        </div>
                                        <span>{inst}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Footer in Print */}
                        <div className="pt-6 border-t border-slate-200 w-full text-center text-xs text-slate-400 font-semibold flex items-center justify-between">
                            <div>Plataforma DiagnostiQ · Seguridad y Cifrado Clínico</div>
                            <div className="font-mono text-slate-500">{origin}{printPortal.path}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
