// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Users, Building2, ShieldCheck, ShieldOff, Search } from "lucide-react"
import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

const roleLabels: any = {
    SUPER_ADMIN: { label: "Super Admin", color: "bg-amber-100 text-amber-700 border-amber-200" },
    LAB_ADMIN:   { label: "Admin Lab",   color: "bg-violet-100 text-violet-700 border-violet-200" },
    LAB_STAFF:   { label: "Personal",    color: "bg-blue-100 text-blue-700 border-blue-200" },
    PATIENT:     { label: "Paciente",    color: "bg-slate-100 text-slate-600 border-slate-200" },
}

export default function SuperAdminUsersPage() {
    const supabase = createClient()
    const [search, setSearch] = useState("")

    const { data: users, isLoading } = useQuery({
        queryKey: ["superadmin-all-users"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, role, is_active, created_at, lab_id, labs(name)")
                .order("created_at", { ascending: false })
            if (error) throw error
            return data || []
        }
    })

    const filtered = users?.filter((u: any) =>
        u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.role?.toLowerCase().includes(search.toLowerCase()) ||
        (u.labs as any)?.name?.toLowerCase().includes(search.toLowerCase())
    ) || []

    const totals = {
        total: users?.length || 0,
        active: users?.filter((u: any) => u.is_active).length || 0,
        admins: users?.filter((u: any) => u.role === "LAB_ADMIN").length || 0,
    }

    return (
        <SuperAdminLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Usuarios del Sistema</h1>
                    <p className="text-slate-500 mt-1">Todos los usuarios registrados en todos los laboratorios</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                    {[
                        { label: "Total Usuarios", value: totals.total, icon: Users, color: "from-violet-500 to-indigo-600" },
                        { label: "Activos", value: totals.active, icon: ShieldCheck, color: "from-emerald-500 to-teal-600" },
                        { label: "Administradores", value: totals.admins, icon: Building2, color: "from-blue-500 to-cyan-600" },
                    ].map(s => (
                        <Card key={s.label} className="border-0 shadow-sm bg-white relative overflow-hidden">
                            <CardContent className="p-5 flex items-center gap-4">
                                <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center shadow-md shrink-0`}>
                                    <s.icon className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-slate-800">{isLoading ? "—" : s.value}</p>
                                    <p className="text-xs text-slate-500">{s.label}</p>
                                </div>
                            </CardContent>
                            <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r ${s.color}`} />
                        </Card>
                    ))}
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Buscar por nombre, rol o laboratorio..."
                        className="pl-10 bg-white border-slate-200"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                {/* Users list */}
                <Card className="border-0 shadow-sm bg-white">
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6 space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center py-16 gap-3">
                                <Users className="h-10 w-10 text-slate-300" />
                                <p className="text-slate-400">{search ? "Sin resultados" : "No hay usuarios"}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {filtered.map((user: any) => {
                                    const roleInfo = roleLabels[user.role] || roleLabels.PATIENT
                                    const labName = (user.labs as any)?.name
                                    return (
                                        <div key={user.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-500/10 flex items-center justify-center text-sm font-bold text-violet-700 border border-violet-100 shrink-0">
                                                {user.full_name?.charAt(0)?.toUpperCase() || "?"}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-sm font-semibold text-slate-800 truncate">{user.full_name || "Sin nombre"}</p>
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleInfo.color}`}>
                                                        {roleInfo.label}
                                                    </span>
                                                    {!user.is_active && (
                                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">Inactivo</span>
                                                    )}
                                                </div>
                                                {labName && (
                                                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                                        <Building2 className="h-3 w-3" /> {labName}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs text-slate-400">
                                                    {user.created_at ? format(new Date(user.created_at), "dd MMM yyyy", { locale: es }) : "—"}
                                                </p>
                                                {user.is_active
                                                    ? <ShieldCheck className="h-4 w-4 text-emerald-500 ml-auto mt-1" />
                                                    : <ShieldOff className="h-4 w-4 text-red-400 ml-auto mt-1" />
                                                }
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
                <p className="text-xs text-slate-400 text-right">{filtered.length} usuario{filtered.length !== 1 ? "s" : ""}</p>
            </div>
        </SuperAdminLayout>
    )
}
