// @ts-nocheck
"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Users, Building2, ShieldCheck, ShieldOff, Search, Edit2, Mail, Loader2 } from "lucide-react"
import { useState } from "react"

import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"

const roleLabels: any = {
    SUPER_ADMIN: { label: "Super Admin", color: "bg-amber-100 text-amber-700 border-amber-200" },
    LAB_ADMIN:   { label: "Admin Lab",   color: "bg-violet-100 text-violet-700 border-violet-200" },
    LAB_STAFF:   { label: "Personal",    color: "bg-blue-100 text-blue-700 border-blue-200" },
    PATIENT:     { label: "Paciente",    color: "bg-slate-100 text-slate-600 border-slate-200" },
}

export default function SuperAdminUsersPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")

    const [editUser, setEditUser] = useState<any>(null)
    const [editName, setEditName] = useState("")
    const [editEmail, setEditEmail] = useState("")

    const { data: users, isLoading } = useQuery({
        queryKey: ["superadmin-all-users"],
        queryFn: async () => {
            const res = await fetch('/api/admin/users')
            if (!res.ok) throw new Error("Failed to fetch users")
            return res.json()
        }
    })

    const updateMutation = useMutation({
        mutationFn: async (data: { id: string, full_name: string, email: string }) => {
            const res = await fetch('/api/admin/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(error.error || "Error al actualizar")
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["superadmin-all-users"] })
            toast({ title: "Usuario actualizado", description: "Los datos del usuario han sido actualizados." })
            setEditUser(null)
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" })
        }
    })

    const handleEditClick = (user: any) => {
        setEditUser(user)
        setEditName(user.full_name || "")
        setEditEmail(user.email || "")
    }

    const filtered = users?.filter((u: any) =>
        u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
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
                        placeholder="Buscar por nombre, correo, rol o laboratorio..."
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
                                                <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                                    <Mail className="h-3 w-3" /> {user.email}
                                                </p>
                                                {labName && (
                                                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                                        <Building2 className="h-3 w-3" /> {labName}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end shrink-0 gap-2">
                                                <div className="flex items-center gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => handleEditClick(user)} className="h-8 border-slate-200">
                                                        <Edit2 className="h-3.5 w-3.5 mr-1" /> Editar
                                                    </Button>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                                    <span>{user.created_at ? format(new Date(user.created_at), "dd MMM yyyy", { locale: es }) : "—"}</span>
                                                    {user.is_active
                                                        ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                                        : <ShieldOff className="h-3.5 w-3.5 text-red-400" />
                                                    }
                                                </div>
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

            {/* Edit User Modal */}
            <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar Usuario</DialogTitle>
                        <DialogDescription>
                            Modifica el nombre y el correo electrónico del usuario.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nombre Completo</Label>
                            <Input 
                                value={editName} 
                                onChange={(e) => setEditName(e.target.value)} 
                                placeholder="Ej. Juan Pérez"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Correo Electrónico</Label>
                            <Input 
                                type="email"
                                value={editEmail} 
                                onChange={(e) => setEditEmail(e.target.value)} 
                                placeholder="usuario@correo.com"
                            />
                            <p className="text-xs text-muted-foreground mt-1">Este correo se actualizará en las credenciales de inicio de sesión.</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline" disabled={updateMutation.isPending}>Cancelar</Button>
                        </DialogClose>
                        <Button 
                            disabled={updateMutation.isPending || !editName || !editEmail} 
                            onClick={() => updateMutation.mutate({ id: editUser.id, full_name: editName, email: editEmail })}
                        >
                            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Guardar Cambios
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </SuperAdminLayout>
    )
}
