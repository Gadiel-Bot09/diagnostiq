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
    Share2 
} from "lucide-react"
import { Logo, LogoIcon } from "@/components/common/Logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

interface PortalConfig {
    id: "patient" | "doctor" | "staff"
    title: string
    subtitle: string
    badge: string
    badgeColor: string
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
    const [origin, setOrigin] = useState<string>("https://diagnostiq.sinuhub.com")
    const [selectedTab, setSelectedTab] = useState<string>("patient")
    const [qrColor, setQrColor] = useState<string>("#0F172A")
    const [labName, setLabName] = useState<string>("Laboratorio Clínico DiagnostiQ")
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [isPrinting, setIsPrinting] = useState<boolean>(false)
    const [printPortal, setPrintPortal] = useState<PortalConfig | null>(null)

    // Canvas refs for downloading PNGs
    const canvasRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})

    useEffect(() => {
        if (typeof window !== "undefined" && window.location.origin) {
            setOrigin(window.location.origin)
        }
    }, [])

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

    const handleDownloadPNG = (portalId: string, title: string) => {
        const container = canvasRefs.current[portalId]
        if (!container) return

        const canvas = container.querySelector("canvas")
        if (!canvas) {
            toast({
                variant: "destructive",
                title: "Error al generar imagen",
                description: "No se encontró el lienzo del código QR.",
            })
            return
        }

        const pngUrl = canvas.toDataURL("image/png")
        const downloadLink = document.createElement("a")
        downloadLink.href = pngUrl
        downloadLink.download = `QR_DiagnostiQ_${title.replace(/\s+/g, "_")}.png`
        document.body.appendChild(downloadLink)
        downloadLink.click()
        document.body.removeChild(downloadLink)

        toast({
            title: "Código QR Descargado",
            description: "Imagen PNG generada en alta resolución lista para impresión o redes sociales.",
        })
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
                        Genera, personaliza e imprime habladores de mesa y códigos QR oficiales con el logotipo de DiagnostiQ para facilitar el ingreso instantáneo a tus pacientes y médicos.
                    </p>
                </div>

                {/* Quick actions / Customizer Bar */}
                <Card className="bg-muted/40 border p-4 shrink-0 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 text-xs">
                        <div className="space-y-1">
                            <Label htmlFor="labName" className="font-bold text-foreground">Nombre en Hablador / Cartel:</Label>
                            <Input 
                                id="labName" 
                                value={labName} 
                                onChange={(e) => setLabName(e.target.value)} 
                                className="h-8 w-60 text-xs bg-background"
                                placeholder="Nombre institucional..."
                            />
                        </div>

                        <div className="space-y-1">
                            <Label className="font-bold text-foreground">Color del Código QR:</Label>
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
                <TabsList className="grid grid-cols-3 w-full max-w-xl bg-muted p-1 rounded-xl h-12">
                    {PORTALS.map((p) => {
                        const Icon = p.icon
                        return (
                            <TabsTrigger 
                                key={p.id} 
                                value={p.id}
                                className="rounded-lg gap-2 font-bold text-xs md:text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
                            >
                                <Icon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{p.title.replace("Portal de ", "").replace("Portal ", "")}</span>
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
                                {/* Left: Interactive Preview & QR Card */}
                                <div className="lg:col-span-7 space-y-6">
                                    <Card className={cn("overflow-hidden border-2 shadow-xl bg-gradient-to-b from-background to-muted/20 relative")}>
                                        <div className={cn("absolute inset-0 bg-gradient-to-r opacity-60 pointer-events-none", portal.gradient)} />
                                        
                                        <CardHeader className="relative z-10 pb-4 border-b bg-background/80 backdrop-blur-sm">
                                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                                        <Icon className="h-6 w-6" />
                                                    </div>
                                                    <div>
                                                        <CardTitle className="text-xl font-extrabold">{portal.title}</CardTitle>
                                                        <CardDescription className="font-semibold text-xs text-muted-foreground">{portal.subtitle}</CardDescription>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className={cn("font-bold text-xs px-3 py-1", portal.badgeColor)}>
                                                    {portal.badge}
                                                </Badge>
                                            </div>
                                        </CardHeader>

                                        <CardContent className="p-6 sm:p-8 relative z-10 flex flex-col items-center justify-center text-center space-y-6">
                                            {/* Brand Logo Header inside card */}
                                            <div className="pt-2">
                                                <Logo size="lg" showTagline subtitle={labName} />
                                            </div>

                                            {/* QR Code Container with sleek border */}
                                            <div 
                                                ref={(el) => { canvasRefs.current[portal.id] = el }}
                                                className="p-6 bg-white rounded-3xl shadow-2xl border-4 border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center relative group transform transition-transform duration-300 hover:scale-[1.02]"
                                            >
                                                {/* Hidden canvas for PNG export, and visible SVG for rendering sharpness */}
                                                <div className="hidden">
                                                    <QRCodeCanvas
                                                        value={fullUrl}
                                                        size={1024} // Super high resolution for download
                                                        bgColor="#ffffff"
                                                        fgColor={qrColor}
                                                        level="H"
                                                        includeMargin={true}
                                                        imageSettings={{
                                                            src: "/favicon.svg",
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
                                                        src: "/favicon.svg",
                                                        x: undefined,
                                                        y: undefined,
                                                        height: 56,
                                                        width: 56,
                                                        excavate: true,
                                                    }}
                                                />

                                                <div className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-center gap-1.5 text-[11px] font-black tracking-wider text-slate-400 uppercase">
                                                    <Sparkles className="h-3 w-3 text-emerald-500" />
                                                    <span>Escanea para ingreso automático</span>
                                                </div>
                                            </div>

                                            {/* URL Display */}
                                            <div className="w-full max-w-md bg-muted/60 rounded-xl p-3 border flex items-center justify-between gap-3 text-xs">
                                                <div className="truncate font-mono text-muted-foreground font-medium pl-1">
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

                                        <CardFooter className="bg-muted/30 border-t p-6 flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
                                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                                                <Smartphone className="h-4 w-4 text-primary shrink-0" />
                                                <span>Listo para colocar en mostradores, facturas o volantes informativos.</span>
                                            </div>

                                            <div className="flex items-center gap-3 w-full sm:w-auto">
                                                <Button 
                                                    variant="outline" 
                                                    className="w-full sm:w-auto font-bold gap-2 border-primary/20 hover:bg-primary/5"
                                                    onClick={() => handleDownloadPNG(portal.id, portal.title)}
                                                >
                                                    <Download className="h-4 w-4 text-primary" />
                                                    <span>Descargar PNG</span>
                                                </Button>

                                                <Button 
                                                    variant="default" 
                                                    className="w-full sm:w-auto font-bold gap-2 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/90 hover:to-indigo-600/90 shadow-md shadow-primary/20 text-white"
                                                    onClick={() => handlePrintSign(portal)}
                                                >
                                                    <Printer className="h-4 w-4" />
                                                    <span>Imprimir Hablador / Cartel</span>
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
                                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "54px", height: "54px" }}>
                                    <rect x="6" y="6" width="88" height="88" rx="22" fill="#4F46E5" fillOpacity="0.1" />
                                    <path d="M 72 44 A 28 28 0 1 0 63.8 63.8" stroke="#4F46E5" strokeWidth="7.5" strokeLinecap="round" fill="none" />
                                    <path d="M 52 52 L 82 82" stroke="#4F46E5" strokeWidth="8.5" strokeLinecap="round" />
                                    <path d="M 24 44 L 33 44 L 39 28 L 47 62 L 55 36 L 61 44 L 68 44" stroke="#10B981" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
                                    <circle cx="39" cy="28" r="2.5" fill="#10B981" />
                                    <circle cx="82" cy="82" r="3.5" fill="#06B6D4" />
                                </svg>
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
                                    src: "/favicon.svg",
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
