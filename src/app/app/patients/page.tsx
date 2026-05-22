"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus, Search, FileEdit, UserPlus, MoreVertical, History } from "lucide-react"
import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

export default function PatientsPage() {
    const supabase = createClient()
    const [searchTerm, setSearchTerm] = useState("")

    const { data: patients, isLoading } = useQuery({
        queryKey: ["patients", searchTerm],
        queryFn: async () => {
            let query = supabase
                .from("patients")
                .select("*, patient_accounts(id)")
                .order("created_at", { ascending: false })

            if (searchTerm) {
                query = query.ilike("full_name", `%${searchTerm}%`)
            }

            const { data, error } = await query
            if (error) throw error
            return data
        }
    })

    const handleCreatePortalAccount = async (patientId: string, email: string) => {
        if (!email) {
            alert("El paciente debe tener un correo electrónico registrado para crearle una cuenta de portal.")
            return
        }
        
        try {
            const res = await fetch("/api/patients/create-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ patientId, email })
            })
            
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            alert("Cuenta creada y link enviado al paciente.")
            // Ideally trigger query refetch here, assuming a refresh function or reload
            window.location.reload()
        } catch (error: any) {
            alert(error.message)
        }
    }

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Pacientes</h1>
                        <p className="text-muted-foreground">Gestiona la base de datos de pacientes del laboratorio.</p>
                    </div>
                    <Button className="gap-2">
                        <UserPlus className="h-4 w-4" /> Registrar Paciente
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle>Listado Maestro</CardTitle>
                                <CardDescription>Consulta o edita la información de tus pacientes.</CardDescription>
                            </div>
                            <div className="relative w-full md:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por nombre..."
                                    className="pl-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="text-center py-10">Cargando pacientes...</div>
                        ) : patients && patients.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nombre Completo</TableHead>
                                        <TableHead>Identificación</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Teléfono</TableHead>
                                        <TableHead>Estado Portal</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {patients.map((patient: any) => (
                                        <TableRow key={patient.id}>
                                            <TableCell className="font-medium">{patient.full_name}</TableCell>
                                            <TableCell>{patient.document_type} {patient.document_number}</TableCell>
                                            <TableCell className="text-muted-foreground">{patient.email || "N/A"}</TableCell>
                                            <TableCell>{patient.phone || "N/A"}</TableCell>
                                            <TableCell>
                                                {patient.patient_accounts && patient.patient_accounts.length > 0 ? (
                                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                                        Con Acceso
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">
                                                        Sin Acceso
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                                                        <DropdownMenuItem className="gap-2">
                                                            <FileEdit className="h-4 w-4" /> Editar Datos
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="gap-2">
                                                            <History className="h-4 w-4" /> Ver Historial
                                                        </DropdownMenuItem>
                                                        {(!patient.patient_accounts || patient.patient_accounts.length === 0) && (
                                                            <DropdownMenuItem 
                                                                className="gap-2 text-violet-600"
                                                                onClick={() => handleCreatePortalAccount(patient.id, patient.email)}
                                                            >
                                                                <UserPlus className="h-4 w-4" /> Crear Cuenta Portal
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem className="text-destructive gap-2">
                                                            Eliminar
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-20 border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">No se encontraron pacientes registrados.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AdminLayout>
    )
}
