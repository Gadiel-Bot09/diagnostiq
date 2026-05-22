// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Users, UserCheck, UserX, Mail, Phone, ShieldCheck, Shield } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

const roleLabels: any = {
    LAB_ADMIN: { label: "Administrador", color: "bg-violet-100 text-violet-700 border-violet-200" },
    LAB_STAFF: { label: "Personal", color: "bg-blue-100 text-blue-700 border-blue-200" },
    PATIENT: { label: "Paciente", color: "bg-slate-100 text-slate-600 border-slate-200" },
    SUPER_ADMIN: { label: "Super Admin", color: "bg-amber-100 text-amber-700 border-amber-200" },
}

export default function UsersPage() {
    const supabase = createClient()

    const { data: users, isLoading } = useQuery({
        queryKey: ["lab-users"],
        queryFn: async () => {
            const { data: profile } = await supabase.from("profiles").select("lab_id").single()
            if (!profile?.lab_id) return []

            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, role, is_active, phone, created_at")
                .eq("lab_id", profile.lab_id)
                .order("role", { ascending: true })

            if (error) throw error
            return data || []
        }
    })

    const active = users?.filter((u: any) => u.is_active).length || 0
    const total = users?.length || 0

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Usuarios del Laboratorio</h1>
                        <p className="text-muted-foreground mt-1">Personal registrado y sus roles</p>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                    {[
                        { label: "Total Usuarios", value: total, icon: Users, color: "text-primary" },
                        { label: "Activos", value: active, icon: UserCheck, color: "text-emerald-600" },
                        { label: "Inactivos", value: total - active, icon: UserX, color: "text-red-500" },
                    ].map(s => (
                        <Card key={s.label} className="shadow-sm">
                            <CardContent className="flex items-center gap-4 p-5">
                                <div className={`${s.color} bg-current/10 rounded-lg p-2.5 bg-opacity-10`}>
                                    <s.icon className={`h-5 w-5 ${s.color}`} />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{isLoading ? "—" : s.value}</p>
                                    <p className="text-xs text-muted-foreground">{s.label}</p>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Users List */}
                <Card>
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" /> Personal Registrado
                        </CardTitle>
                        <CardDescription>Para invitar nuevos miembros o cambiar roles, usa el módulo de Gestión de Roles (próximamente).</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                        ) : users?.length === 0 ? (
                            <div className="flex flex-col items-center py-16 gap-3 text-center">
                                <Users className="h-10 w-10 text-muted-foreground/40" />
                                <p className="text-muted-foreground">No hay usuarios registrados en este laboratorio.</p>
                            </div>
                        ) : (
                            <div className="divide-y">
                                {users?.map((user: any) => {
                                    const roleInfo = roleLabels[user.role] || roleLabels.LAB_STAFF
                                    return (
                                        <div key={user.id} className="flex items-center justify-between px-6 py-4 hover:bg-muted/20 transition-colors">
                                            <div className="flex items-center gap-4">
                                                {/* Avatar */}
                                                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-sm font-semibold text-primary border border-primary/20">
                                                    {user.full_name?.charAt(0)?.toUpperCase() || "?"}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-medium">{user.full_name || "Sin nombre"}</p>
                                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleInfo.color}`}>
                                                            {roleInfo.label}
                                                        </span>
                                                        {!user.is_active && (
                                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">
                                                                Inactivo
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-0.5">
                                                        {user.phone && (
                                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                                <Phone className="h-3 w-3" /> {user.phone}
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-muted-foreground">
                                                            Desde {user.created_at ? format(new Date(user.created_at), "dd MMM yyyy", { locale: es }) : "—"}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div>
                                                {user.is_active
                                                    ? <UserCheck className="h-4 w-4 text-emerald-500" />
                                                    : <UserX className="h-4 w-4 text-red-400" />
                                                }
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AdminLayout>
    )
}
