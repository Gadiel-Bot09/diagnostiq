// @ts-nocheck
"use client"

import {
    Shield,
    Lock,
    Eye,
    Database,
    Key,
    CheckCircle2,
    Info,
} from "lucide-react"
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const securityChecks = [
    {
        title: "Row Level Security (RLS)",
        description: "Todas las tablas tienen RLS habilitado. Los datos de cada laboratorio son completamente aislados.",
        status: "active",
        icon: Database,
    },
    {
        title: "Autenticación Supabase",
        description: "Los usuarios se autentican via Supabase Auth con soporte para JWT firmados.",
        status: "active",
        icon: Key,
    },
    {
        title: "Middleware de protección de rutas",
        description: "Las rutas /app/*, /portal/* y /superadmin/* están protegidas por middleware con chequeo de sesión y rol.",
        status: "active",
        icon: Lock,
    },
    {
        title: "Separación de datos multi-tenant",
        description: "Cada query aplica automáticamente lab_id del usuario actual gracias a las funciones get_auth_lab_id() y RLS.",
        status: "active",
        icon: Shield,
    },
    {
        title: "Service Role Key (servidor)",
        description: "La clave de service_role solo se usa en API Routes del servidor. Nunca se expone al cliente.",
        status: "active",
        icon: Eye,
    },
    {
        title: "Recuperación de contraseña",
        description: "Implementada via Supabase resetPasswordForEmail con redireccionamiento seguro.",
        status: "active",
        icon: CheckCircle2,
    },
]

const policies = [
    { table: "labs", policies: ["Super admins: CRUD total", "Staff: solo SELECT su propio lab"] },
    { table: "profiles", policies: ["Usuario: ver/editar su propio perfil", "Lab admin: ver perfiles de su lab"] },
    { table: "patients", policies: ["Lab staff: CRUD pacientes de su lab", "Paciente: ver su propio registro"] },
    { table: "orders", policies: ["Lab staff: CRUD órdenes de su lab", "Paciente: ver sus propias órdenes"] },
    { table: "result_files", policies: ["Lab staff: CRUD archivos de su lab", "Paciente: ver sus propios archivos"] },
    { table: "custom_roles", policies: ["Lab admin: CRUD roles de su lab", "Staff: SELECT roles de su lab"] },
]

export default function SuperAdminSecurityPage() {
    return (
        <SuperAdminLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Seguridad del Sistema</h1>
                    <p className="text-slate-500 mt-1">Estado de las configuraciones de seguridad y políticas RLS</p>
                </div>

                {/* Security checks */}
                <div className="grid md:grid-cols-2 gap-4">
                    {securityChecks.map((check) => (
                        <Card key={check.title} className="border-0 shadow-sm bg-white">
                            <CardContent className="p-5 flex gap-4">
                                <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                                    <check.icon className="h-5 w-5 text-emerald-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold text-slate-800">{check.title}</p>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                            ✓ Activo
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{check.description}</p>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* RLS Policies */}
                <Card className="border-0 shadow-sm bg-white">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Database className="h-4 w-4 text-violet-500" /> Políticas RLS por Tabla
                        </CardTitle>
                        <CardDescription>Resumen de las reglas de acceso a nivel de fila en la base de datos</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {policies.map(p => (
                                <div key={p.table} className="flex gap-4 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                    <div className="shrink-0">
                                        <span className="text-xs font-mono font-bold text-violet-700 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded">
                                            {p.table}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {p.policies.map(pol => (
                                            <span key={pol} className="text-xs text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded">
                                                {pol}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Info note */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
                    <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-700">
                        Las políticas RLS se aplican automáticamente en cada consulta a la base de datos. Los laboratorios nunca pueden acceder a datos de otros laboratorios, garantizando aislamiento completo multi-tenant.
                    </p>
                </div>
            </div>
        </SuperAdminLayout>
    )
}
