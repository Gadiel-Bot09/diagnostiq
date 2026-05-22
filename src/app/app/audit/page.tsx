// @ts-nocheck
"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    History,
    LogIn,
    Upload,
    Eye,
    Download,
    Trash2,
    Search,
    Filter,
    ShieldAlert,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

const actionConfig: any = {
    LOGIN:    { label: "Inicio sesión",  icon: LogIn,     color: "bg-blue-50 text-blue-600 border-blue-200" },
    UPLOAD:   { label: "Subida",         icon: Upload,    color: "bg-violet-50 text-violet-600 border-violet-200" },
    VIEW:     { label: "Vista",          icon: Eye,       color: "bg-slate-50 text-slate-600 border-slate-200" },
    DOWNLOAD: { label: "Descarga",       icon: Download,  color: "bg-emerald-50 text-emerald-600 border-emerald-200" },
    DELETE:   { label: "Eliminación",    icon: Trash2,    color: "bg-red-50 text-red-600 border-red-200" },
}

export default function AuditPage() {
    const supabase = createClient()
    const [search, setSearch] = useState("")

    const { data: events, isLoading } = useQuery({
        queryKey: ["audit-events"],
        queryFn: async () => {
            const { data: profile } = await supabase.from("profiles").select("lab_id").single()
            if (!profile?.lab_id) return []

            const { data, error } = await supabase
                .from("audit_events")
                .select("*")
                .eq("lab_id", profile.lab_id)
                .order("created_at", { ascending: false })
                .limit(200)

            if (error) throw error
            return data || []
        }
    })

    const filtered = events?.filter((e: any) =>
        e.action?.toLowerCase().includes(search.toLowerCase()) ||
        e.entity_type?.toLowerCase().includes(search.toLowerCase()) ||
        e.actor_role?.toLowerCase().includes(search.toLowerCase())
    ) || []

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Auditoría</h1>
                    <p className="text-muted-foreground mt-1">Registro de todas las acciones realizadas en el laboratorio</p>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por acción, entidad o rol..."
                        className="pl-10"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                <Card>
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-primary" />
                            Eventos Recientes
                        </CardTitle>
                        <CardDescription>Últimas 200 acciones registradas en el sistema</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6 space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center py-16 gap-3 text-center">
                                <History className="h-10 w-10 text-muted-foreground/40" />
                                <p className="text-muted-foreground">
                                    {search ? "No se encontraron eventos" : "No hay eventos de auditoría registrados aún."}
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y">
                                {filtered.map((event: any) => {
                                    const cfg = actionConfig[event.action] || { label: event.action, icon: History, color: "bg-slate-50 text-slate-600 border-slate-200" }
                                    const Icon = cfg.icon
                                    return (
                                        <div key={event.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/20 transition-colors">
                                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center border shrink-0 ${cfg.color}`}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>
                                                        {cfg.label}
                                                    </span>
                                                    <span className="text-sm font-medium truncate">{event.entity_type}</span>
                                                    {event.entity_id && (
                                                        <span className="text-[10px] text-muted-foreground font-mono truncate hidden sm:block">
                                                            #{event.entity_id?.slice(0, 8)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {event.actor_role && (
                                                        <span className="text-xs text-muted-foreground">{event.actor_role}</span>
                                                    )}
                                                    {event.ip && (
                                                        <span className="text-xs text-muted-foreground hidden sm:block">· {event.ip}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                                                {event.created_at
                                                    ? format(new Date(event.created_at), "dd MMM, HH:mm", { locale: es })
                                                    : "—"}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
                <p className="text-xs text-muted-foreground text-right">{filtered.length} evento{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}</p>
            </div>
        </AdminLayout>
    )
}
