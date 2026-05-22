// @ts-nocheck
"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    Building2,
    Plus,
    Search,
    MoreHorizontal,
    CheckCircle2,
    XCircle,
    AlertCircle,
    ArrowUpRight,
    Eye,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

export default function SuperAdminLabsPage() {
    const [search, setSearch] = useState("")
    const supabase = createClient()

    const { data: labs, isLoading } = useQuery({
        queryKey: ["superadmin-labs"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("labs")
                .select("id, name, tax_id, email, phone, address, status, plan, created_at")
                .order("created_at", { ascending: false })

            if (error) throw error
            return data || []
        }
    })

    const filtered = labs?.filter(lab =>
        lab.name.toLowerCase().includes(search.toLowerCase()) ||
        lab.tax_id?.toLowerCase().includes(search.toLowerCase()) ||
        lab.email?.toLowerCase().includes(search.toLowerCase())
    ) || []

    const statusIcon: any = {
        ACTIVE: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
        INACTIVE: <XCircle className="h-3.5 w-3.5 text-red-500" />,
        SUSPENDED: <AlertCircle className="h-3.5 w-3.5 text-amber-500" />,
    }
    const statusClass: any = {
        ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
        INACTIVE: "border-red-200 bg-red-50 text-red-700",
        SUSPENDED: "border-amber-200 bg-amber-50 text-amber-700",
    }
    const planClass: any = {
        FREE: "border-slate-200 bg-slate-50 text-slate-600",
        BASIC: "border-blue-200 bg-blue-50 text-blue-700",
        PRO: "border-violet-200 bg-violet-50 text-violet-700",
        ENTERPRISE: "border-amber-200 bg-amber-50 text-amber-700",
    }

    return (
        <SuperAdminLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Laboratorios</h1>
                        <p className="text-slate-500 mt-1">Gestión de todos los tenants del sistema</p>
                    </div>
                    <Link href="/superadmin/labs/new">
                        <Button className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md">
                            <Plus className="h-4 w-4" /> Nuevo Laboratorio
                        </Button>
                    </Link>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Buscar por nombre, NIT o correo..."
                        className="pl-10 bg-white border-slate-200 h-10"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                {/* Labs Grid */}
                {isLoading ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <Card className="border-0 shadow-sm bg-white">
                        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                                <Building2 className="h-8 w-8 text-slate-400" />
                            </div>
                            <div className="text-center">
                                <p className="font-semibold text-slate-700">No hay laboratorios</p>
                                <p className="text-sm text-slate-400 mt-1">
                                    {search ? "Ningún lab coincide con tu búsqueda." : "Crea el primer laboratorio para empezar."}
                                </p>
                            </div>
                            {!search && (
                                <Link href="/superadmin/labs/new">
                                    <Button className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600">
                                        <Plus className="h-4 w-4" /> Crear Laboratorio
                                    </Button>
                                </Link>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filtered.map((lab) => (
                            <Card key={lab.id} className="border-0 shadow-sm bg-white hover:shadow-md transition-shadow group relative overflow-hidden">
                                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-indigo-600" />
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center border border-violet-100 shrink-0">
                                                <Building2 className="h-5 w-5 text-violet-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <CardTitle className="text-sm font-semibold text-slate-800 truncate">{lab.name}</CardTitle>
                                                <p className="text-xs text-slate-400 truncate">NIT: {lab.tax_id}</p>
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3 pt-0">
                                    <div className="text-xs text-slate-500 space-y-1">
                                        {lab.email && <p className="truncate">✉ {lab.email}</p>}
                                        {lab.phone && <p>📞 {lab.phone}</p>}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex gap-1.5">
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${statusClass[lab.status] || statusClass.ACTIVE}`}>
                                                {statusIcon[lab.status] || statusIcon.ACTIVE}
                                                {lab.status || "ACTIVE"}
                                            </span>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${planClass[lab.plan] || planClass.FREE}`}>
                                                {lab.plan || "FREE"}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-slate-400">
                                            {lab.created_at ? format(new Date(lab.created_at), "dd/MM/yy") : "—"}
                                        </span>
                                    </div>

                                    <Link href={`/superadmin/labs/${lab.id}`} className="block">
                                        <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors">
                                            <Eye className="h-3.5 w-3.5" /> Ver Detalles
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </SuperAdminLayout>
    )
}
