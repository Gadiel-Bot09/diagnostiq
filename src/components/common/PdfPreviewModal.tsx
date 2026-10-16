"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FileText, Download, ExternalLink, Loader2 } from "lucide-react"

interface PdfPreviewModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    url: string | null
    subtitle?: string
    isLoading?: boolean
}

export function PdfPreviewModal({
    open,
    onOpenChange,
    title,
    url,
    subtitle,
    isLoading = false,
}: PdfPreviewModalProps) {
    const [iframeLoading, setIframeLoading] = useState(true)

    const handleOpenInNewTab = () => {
        if (url) window.open(url, "_blank")
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl border-0 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-white shrink-0">
                    <div className="flex items-center gap-3 min-w-0 pr-4">
                        <div className="h-10 w-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                            <FileText className="h-5 w-5 text-rose-600" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-base font-bold truncate text-slate-900">
                                {title || "Documento PDF"}
                            </DialogTitle>
                            {subtitle ? (
                                <DialogDescription className="text-xs text-muted-foreground truncate">
                                    {subtitle}
                                </DialogDescription>
                            ) : (
                                <DialogDescription className="text-xs text-muted-foreground">
                                    Previsualización del resultado médico
                                </DialogDescription>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pr-8">
                        {url && (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 h-8 text-xs font-medium"
                                    onClick={handleOpenInNewTab}
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Nueva pestaña</span>
                                </Button>
                                <Button
                                    size="sm"
                                    className="gap-1.5 h-8 text-xs font-medium bg-primary text-white hover:bg-primary/90"
                                    onClick={() => {
                                        const a = document.createElement("a")
                                        a.href = url
                                        a.download = title || "documento.pdf"
                                        a.target = "_blank"
                                        a.click()
                                    }}
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Descargar</span>
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Body / PDF Viewer */}
                <div className="flex-1 w-full bg-slate-100/90 relative overflow-hidden flex items-center justify-center">
                    {isLoading ? (
                        <div className="flex flex-col items-center gap-3 text-slate-500">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm font-medium">Cargando documento seguro...</p>
                        </div>
                    ) : url ? (
                        <>
                            <iframe
                                src={`${url}#toolbar=1&view=FitH`}
                                className="w-full h-full border-0 bg-white"
                                title={title}
                                onLoad={() => setIframeLoading(false)}
                            />
                            {/* Fallback floating button if browser blocks inline iframe */}
                            <div className="absolute bottom-3 right-4 bg-white/95 backdrop-blur px-3 py-1.5 rounded-lg border text-xs text-slate-600 shadow-md sm:hidden flex items-center gap-2">
                                <span>¿Problemas para visualizar?</span>
                                <Button variant="link" size="sm" className="p-0 h-auto text-xs text-primary" onClick={handleOpenInNewTab}>
                                    Abrir aquí
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-400 p-8 text-center">
                            <FileText className="h-10 w-10 opacity-30" />
                            <p className="text-sm">No se pudo cargar el archivo para previsualización.</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
