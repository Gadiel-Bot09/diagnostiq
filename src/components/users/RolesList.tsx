"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Shield, Plus, Loader2, Check, X, Info } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { Checkbox } from "@/components/ui/checkbox"

type ModuleKey = "orders" | "patients" | "results" | "reports" | "staff" | "settings" | "audit"
type ActionKey = "view" | "create" | "edit" | "delete"

const MODULES: { id: ModuleKey, label: string }[] = [
    { id: "orders", label: "Órdenes" },
    { id: "patients", label: "Pacientes" },
    { id: "results", label: "Resultados" },
    { id: "reports", label: "Reportes" },
    { id: "staff", label: "Personal" },
    { id: "settings", label: "Configuración" },
]

export function RolesList() {
    const supabase = createClient()
    const { toast } = useToast()
    
    const [isCreating, setIsCreating] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    
    // Permission Matrix State
    // Format: { "orders": { view: true, create: false, ... } }
    const [permissions, setPermissions] = useState<Record<string, Record<string, boolean>>>({})

    const { data: customRoles, isLoading, refetch } = useQuery({
        queryKey: ["custom-roles"],
        queryFn: async () => {
            const { data: profile } = await supabase.from("profiles").select("lab_id").single()
            if (!profile?.lab_id) return []

            const { data, error } = await supabase
                .from("custom_roles")
                .select("id, name, description, is_default")
                .eq("lab_id", profile.lab_id)
                .order("created_at", { ascending: true })

            if (error) throw error
            return data || []
        }
    })

    const handleTogglePermission = (mod: string, action: string, checked: boolean) => {
        setPermissions(prev => ({
            ...prev,
            [mod]: {
                ...(prev[mod] || {}),
                [action]: checked
            }
        }))
    }

    const handleCreateRole = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsCreating(true)
        const formData = new FormData(e.currentTarget)
        
        try {
            // Flatten permissions into array [{ module, action }]
            const permsArray: { module: string, action: string }[] = []
            Object.entries(permissions).forEach(([mod, actions]) => {
                Object.entries(actions).forEach(([act, isChecked]) => {
                    if (isChecked) {
                        permsArray.push({ module: mod, action: act })
                    }
                })
            })

            const res = await fetch("/api/roles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: formData.get("name"),
                    description: formData.get("description"),
                    permissions: permsArray
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            toast({ title: "Rol creado", description: "El rol fue guardado exitosamente." })
            setIsOpen(false)
            setPermissions({})
            refetch()
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error", description: err.message })
        } finally {
            setIsCreating(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold">Roles Personalizados</h2>
                    <p className="text-sm text-muted-foreground">Define perfiles de acceso con permisos específicos</p>
                </div>
                
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" /> Nuevo Rol
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                        <DialogHeader>
                            <DialogTitle>Crear Rol Personalizado</DialogTitle>
                            <DialogDescription>
                                Asigna un nombre al rol y configura exactamente qué puede hacer en el sistema.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreateRole} className="space-y-6 py-2">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nombre del Rol</Label>
                                    <Input id="name" name="name" placeholder="Ej: Recepcionista" required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="description">Descripción</Label>
                                    <Input id="description" name="description" placeholder="Atención a pacientes y creación de órdenes" />
                                </div>
                            </div>

                            {/* Permissions Matrix */}
                            <div className="border rounded-md">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="p-3 text-left font-medium text-muted-foreground">Módulo</th>
                                            <th className="p-3 text-center font-medium text-muted-foreground">Ver</th>
                                            <th className="p-3 text-center font-medium text-muted-foreground">Crear</th>
                                            <th className="p-3 text-center font-medium text-muted-foreground">Editar</th>
                                            <th className="p-3 text-center font-medium text-muted-foreground">Eliminar</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {MODULES.map(mod => (
                                            <tr key={mod.id} className="hover:bg-muted/30">
                                                <td className="p-3 font-medium">{mod.label}</td>
                                                {["view", "create", "edit", "delete"].map(act => (
                                                    <td key={act} className="p-3 text-center">
                                                        <Checkbox 
                                                            checked={!!permissions[mod.id]?.[act]}
                                                            onCheckedChange={(c) => handleTogglePermission(mod.id, act, !!c)}
                                                        />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                                <Button type="submit" disabled={isCreating}>
                                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Guardar Rol
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {/* Fixed Admin Role */}
                <Card className="border-violet-200 bg-violet-50/30">
                    <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Shield className="h-5 w-5 text-violet-600" />
                                Administrador
                            </CardTitle>
                            <Badge variant="outline" className="bg-violet-100 text-violet-700">Sistema</Badge>
                        </div>
                        <CardDescription>Acceso total irrestricto al sistema</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-2">
                            <Check className="h-4 w-4 text-emerald-500" /> Todos los permisos habilitados
                        </p>
                    </CardContent>
                </Card>

                {isLoading ? (
                    <p className="text-muted-foreground p-4">Cargando roles...</p>
                ) : (
                    customRoles?.map(role => (
                        <Card key={role.id}>
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Shield className="h-5 w-5 text-slate-400" />
                                        {role.name}
                                    </CardTitle>
                                    {role.is_default && <Badge variant="secondary">Por defecto</Badge>}
                                </div>
                                <CardDescription>{role.description || "Sin descripción"}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-2">
                                    <Info className="h-4 w-4" /> Permisos personalizados asignados
                                </p>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    )
}
