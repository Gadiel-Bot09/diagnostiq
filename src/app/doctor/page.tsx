"use client"

import { useState, useRef } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    Search, FileText, Download, User, Hash,
    Calendar, ChevronRight, Microscope, AlertCircle,
    Eye, Badge as BadgeIcon, Loader2, UploadCloud
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"

type Patient = {
    id: string
    full_name: string
    document_number: string
    document_type: string
    email: string | null
}

type ResultFile = {
    id: string
    file_name: string
    mime_type: string
    size_bytes: number
}

type Order = {
    id: string
    order_number: string
    ordered_at: string
    is_direct: boolean
    direct_exam_name: string | null
    order_tests: { id: string; tests: { name: string; category: string } | null }[]
    result_files: ResultFile[]
}

export default function DoctorPage() {
    const { toast } = useToast()
    const inputRef = useRef<HTMLInputElement>(null)

    const [searchDoc, setSearchDoc] = useState("")
    const [isSearching, setIsSearching] = useState(false)
    const [patient, setPatient] = useState<Patient | null>(null)
    const [orders, setOrders] = useState<Order[]>([])
    const [hasSearched, setHasSearched] = useState(false)
    const [downloadingId, setDownloadingId] = useState<string | null>(null)

    // ── Search ──
    const handleSearch = async () => {
        const doc = searchDoc.trim()
        if (!doc) return

        setIsSearching(true)
        setPatient(null)
        setOrders([])
        setHasSearched(false)

        try {
            const res = await fetch(`/api/doctor/patient-results?document_number=${encodeURIComponent(doc)}`)
            const data = await res.json()

            if (!res.ok) {
                toast({
                    variant: "destructive",
                    title: "Paciente no encontrado",
                    description: data.error || "No existe un paciente con ese número de documento.",
                })
            } else {
                setPatient(data.patient)
                setOrders(data.orders)
                setHasSearched(true)
            }
        } catch {
            toast({ variant: "destructive", title: "Error de red", description: "No se pudo conectar al servidor." })
        } finally {
            setIsSearching(false)
        }
    }

    // ── Download file ──
    const handleDownload = async (fileId: string, fileName: string) => {
        setDownloadingId(fileId)
        try {
            const res = await fetch(`/api/results/download?fileId=${fileId}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            window.open(data.url, "_blank")
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error de descarga", description: err.message })
        } finally {
            setDownloadingId(null)
        }
    }

    // ── Helpers ──
    const getExamName = (order: Order) => {
        if (order.is_direct && order.direct_exam_name) return order.direct_exam_name
        if (order.order_tests?.length > 0) {
            const names = order.order_tests
                .map(t => t.tests?.name)
                .filter(Boolean)
                .slice(0, 2)
                .join(", ")
            return names || `Orden #${order.order_number}`
        }
        return `Orden #${order.order_number}`
    }

    return (
        <div className="space-y-8">
            {/* Hero search section */}
            <div className="text-center space-y-4 py-6">
                <div className="flex justify-center">
                    <div className="bg-teal-600 rounded-2xl p-4 shadow-lg shadow-teal-600/25">
                        <Microscope className="h-10 w-10 text-white" />
                    </div>
                </div>
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Portal Médico</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Consulta los resultados de tus pacientes por número de documento</p>
                </div>

                {/* Search bar */}
                <div className="max-w-xl mx-auto mt-4">
                    <div className="flex gap-2 shadow-lg rounded-xl overflow-hidden border bg-white">
                        <div className="flex items-center pl-4">
                            <Hash className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        </div>
                        <Input
                            ref={inputRef}
                            value={searchDoc}
                            onChange={e => setSearchDoc(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSearch()}
                            placeholder="Número de documento del paciente..."
                            className="border-0 shadow-none text-base h-13 focus-visible:ring-0 py-4"
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchDoc.trim()}
                            className="rounded-none rounded-r-xl px-6 h-auto bg-teal-600 hover:bg-teal-700 gap-2"
                        >
                            {isSearching
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Search className="h-4 w-4" />
                            }
                            {isSearching ? "Buscando..." : "Buscar"}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                        Ingresa la cédula, tarjeta de identidad o pasaporte del paciente
                    </p>
                </div>
            </div>

            {/* Results */}
            {hasSearched && patient && (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    {/* Patient card */}
                    <Card className="border-teal-200 bg-teal-50/50">
                        <CardContent className="py-4 px-5">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-full bg-teal-100 border-2 border-teal-300 flex items-center justify-center text-lg font-bold text-teal-700 flex-shrink-0">
                                    {patient.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-lg text-gray-900 truncate">{patient.full_name}</p>
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-sm text-muted-foreground">
                                            {patient.document_type || "DOC"}: <strong>{patient.document_number}</strong>
                                        </span>
                                        {patient.email && (
                                            <span className="text-sm text-muted-foreground truncate">{patient.email}</span>
                                        )}
                                    </div>
                                </div>
                                <Badge className="bg-teal-600 text-white flex-shrink-0">
                                    {orders.length} resultado{orders.length !== 1 ? "s" : ""}
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Orders list */}
                    {orders.length === 0 ? (
                        <div className="text-center py-16 border-2 border-dashed rounded-xl">
                            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                            <p className="text-muted-foreground font-medium">No hay resultados completados para este paciente.</p>
                            <p className="text-sm text-muted-foreground mt-1">Solo aparecen exámenes con estado "Completado".</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                Resultados — más recientes primero
                            </h2>
                            {orders.map((order, idx) => (
                                <Card key={order.id} className="hover:shadow-md transition-shadow duration-200">
                                    <CardContent className="py-4 px-5">
                                        <div className="flex items-start gap-4">
                                            {/* Order number badge */}
                                            <div className="flex-shrink-0 flex flex-col items-center pt-0.5">
                                                <div className="bg-slate-100 rounded-lg p-2.5">
                                                    <FileText className="h-5 w-5 text-slate-500" />
                                                </div>
                                                <span className="text-[10px] text-muted-foreground mt-1.5 font-mono">
                                                    #{idx + 1}
                                                </span>
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                                    <div>
                                                        <p className="font-semibold text-gray-900 text-base leading-tight">
                                                            {getExamName(order)}
                                                        </p>
                                                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                                <Calendar className="h-3 w-3" />
                                                                {format(new Date(order.ordered_at), "PPP 'a las' HH:mm", { locale: es })}
                                                            </span>
                                                            {order.is_direct ? (
                                                                <Badge variant="outline" className="text-[10px] text-violet-600 border-violet-300 bg-violet-50 h-5">
                                                                    <UploadCloud className="h-2.5 w-2.5 mr-1" /> Directo
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 bg-blue-50 h-5">
                                                                    <Microscope className="h-2.5 w-2.5 mr-1" /> Orden
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Files */}
                                                {order.result_files.length > 0 && (
                                                    <div className="mt-3 space-y-1.5">
                                                        {order.result_files.map(file => (
                                                            <div key={file.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <FileText className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
                                                                    <span className="text-sm font-medium truncate max-w-xs">{file.file_name}</span>
                                                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                                                        {(file.size_bytes / 1024).toFixed(0)} KB
                                                                    </span>
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="h-7 gap-1.5 text-xs text-teal-700 hover:text-teal-800 hover:bg-teal-50 flex-shrink-0"
                                                                    onClick={() => handleDownload(file.id, file.file_name)}
                                                                    disabled={downloadingId === file.id}
                                                                >
                                                                    {downloadingId === file.id
                                                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                        : <Download className="h-3 w-3" />
                                                                    }
                                                                    Descargar
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {order.result_files.length === 0 && (
                                                    <p className="text-xs text-muted-foreground mt-2 italic">Sin archivos adjuntos</p>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Empty state before search */}
            {!hasSearched && !isSearching && (
                <div className="text-center py-16 text-muted-foreground">
                    <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="font-medium">Ingresa el número de documento para buscar resultados</p>
                    <p className="text-sm mt-1">Los resultados aparecerán aquí ordenados del más reciente al más antiguo</p>
                </div>
            )}
        </div>
    )
}
