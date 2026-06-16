"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Users, UserCheck, UserX, Phone, Shield, Stethoscope, Loader2, UserPlus } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"

const baseRoleLabels: any = {
    LAB_ADMIN: { label: "Administrador", color: "bg-violet-100 text-violet-700 border-violet-200" },
    LAB_STAFF: { label: "Personal", color: "bg-blue-100 text-blue-700 border-blue-200" },
    PATIENT: { label: "Paciente", color: "bg-slate-100 text-slate-600 border-slate-200" },
    SUPER_ADMIN: { label: "Super Admin", color: "bg-amber-100 text-amber-700 border-amber-200" },
    DOCTOR: { label: "Médico", color: "bg-teal-100 text-teal-700 border-teal-200" },
}

export function UsersList() {
    const supabase = createClient()
    const { toast } = useToast()
    
    // States for modals
    const [isCreatingDoctor, setIsCreatingDoctor] = useState(false)
    const [isDoctorOpen, setIsDoctorOpen] = useState(false)
    
    const [isCreatingStaff, setIsCreatingStaff] = useState(false)
    const [isStaffOpen, setIsStaffOpen] = useState(false)

    // Data fetching
    const { data: users, isLoading, refetch } = useQuery({
        queryKey: ["lab-users-extended"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return []
            const { data: profile } = await supabase.from("profiles").select("lab_id").eq("id", user.id).single()
            if (!profile?.lab_id) return []

            // Fetch users
            const { data: profilesData, error } = await supabase
                .from("profiles")
                .select("id, full_name, role, is_active, phone, created_at")
                .eq("lab_id", profile.lab_id)
                .order("role", { ascending: true })

            if (error) throw error

            // Fetch their custom role assignments
            const { data: assignments } = await supabase
                .from("staff_role_assignments")
                .select("profile_id, custom_roles(name)")
                .eq("lab_id", profile.lab_id)

            // Merge custom roles into profiles
            const usersWithCustomRoles = profilesData?.map(user => {
                const assignment = assignments?.find(a => a.profile_id === user.id)
                return {
                    ...user,
                    custom_role_name: (assignment?.custom_roles as any)?.name
                }
            })

            return usersWithCustomRoles || []
        }
    })

    const { data: customRoles } = useQuery({
        queryKey: ["custom-roles-select"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return []
            const { data: profile } = await supabase.from("profiles").select("lab_id").eq("id", user.id).single()
            if (!profile?.lab_id) return []
            const { data } = await supabase.from("custom_roles").select("id, name").eq("lab_id", profile.lab_id)
            return data || []
        }
    })

    // Handlers
    const handleCreateDoctor = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsCreatingDoctor(true)
        const formData = new FormData(e.currentTarget)
        try {
            const res = await fetch("/api/users/create-doctor", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    full_name: formData.get("full_name"),
                    email: formData.get("email"),
                    password: formData.get("password"),
                    specialty: formData.get("specialty"),
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            toast({ title: "Médico creado", description: "El usuario médico fue creado exitosamente." })
            setIsDoctorOpen(false)
            refetch()
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error", description: err.message })
        } finally {
            setIsCreatingDoctor(false)
        }
    }

    const handleInviteStaff = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsCreatingStaff(true)
        const formData = new FormData(e.currentTarget)
        try {
            const res = await fetch("/api/users/create-staff", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    full_name: formData.get("full_name"),
                    email: formData.get("email"),
                    password: formData.get("password"),
                    custom_role_id: formData.get("custom_role_id"),
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            toast({ title: "Personal invitado", description: "El usuario ha sido registrado y se le asignó su rol." })
            setIsStaffOpen(false)
            refetch()
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error", description: err.message })
        } finally {
            setIsCreatingStaff(false)
        }
    }

    const active = users?.filter((u: any) => u.is_active).length || 0
    const total = users?.length || 0

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold">Gestión de Personal</h2>
                    <p className="text-sm text-muted-foreground">Administra el acceso de los empleados y médicos</p>
                </div>
                
                <div className="flex gap-2">
                    {/* Crear Médico Modal */}
                    <Dialog open={isDoctorOpen} onOpenChange={setIsDoctorOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="gap-2 text-teal-700 hover:text-teal-800 border-teal-200 bg-teal-50 hover:bg-teal-100">
                                <Stethoscope className="h-4 w-4" /> Crear Médico
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Crear usuario médico</DialogTitle>
                                <DialogDescription>
                                    Crea un acceso para que un médico pueda consultar los resultados de los pacientes en el portal médico.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleCreateDoctor} className="space-y-4 py-2">
                                <div className="space-y-2">
                                    <Label>Nombre completo</Label>
                                    <Input name="full_name" placeholder="Dr. Juan Pérez" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Correo electrónico (Usuario)</Label>
                                    <Input name="email" type="email" placeholder="doctor@ejemplo.com" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Contraseña temporal</Label>
                                    <Input name="password" type="password" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Especialidad (Opcional)</Label>
                                    <Input name="specialty" placeholder="Medicina General" />
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsDoctorOpen(false)}>Cancelar</Button>
                                    <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white" disabled={isCreatingDoctor}>
                                        {isCreatingDoctor ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Guardar
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>

                    {/* Invitar Personal Modal */}
                    <Dialog open={isStaffOpen} onOpenChange={setIsStaffOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2 bg-primary text-white">
                                <UserPlus className="h-4 w-4" /> Invitar Personal
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Invitar miembro al equipo</DialogTitle>
                                <DialogDescription>
                                    Registra a un nuevo miembro del staff y asígnale un rol personalizado.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleInviteStaff} className="space-y-4 py-2">
                                <div className="space-y-2">
                                    <Label>Nombre completo</Label>
                                    <Input name="full_name" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Correo electrónico (Usuario)</Label>
                                    <Input name="email" type="email" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Contraseña inicial</Label>
                                    <Input name="password" type="password" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Rol Personalizado</Label>
                                    <Select name="custom_role_id" required>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecciona un rol..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {customRoles?.map(role => (
                                                <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsStaffOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={isCreatingStaff}>
                                        {isCreatingStaff ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Invitar
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
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
                        <Shield className="h-4 w-4 text-primary" /> Lista de Empleados
                    </CardTitle>
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
                                const roleInfo = baseRoleLabels[user.role] || baseRoleLabels.LAB_STAFF
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
                                                    
                                                    {/* Mostrar rol personalizado o base */}
                                                    {user.custom_role_name ? (
                                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200">
                                                            {user.custom_role_name}
                                                        </span>
                                                    ) : (
                                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleInfo.color}`}>
                                                            {roleInfo.label}
                                                        </span>
                                                    )}

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
                                                        Registrado el {user.created_at ? format(new Date(user.created_at), "dd MMM yyyy", { locale: es }) : "—"}
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
    )
}
