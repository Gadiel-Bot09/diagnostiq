// @ts-nocheck
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import {
    ArrowLeft,
    Building2,
    User,
    Mail,
    Phone,
    MapPin,
    FileText,
    Lock,
    Loader2,
    CheckCircle2,
    Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

const newLabSchema = z.object({
    // Datos del Laboratorio
    lab_name: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    tax_id: z.string().min(5, "Ingresa un NIT válido"),
    lab_email: z.string().email("Email del laboratorio inválido"),
    lab_phone: z.string().optional(),
    lab_address: z.string().optional(),
    plan: z.enum(["FREE", "BASIC", "PRO", "ENTERPRISE"]),
    // Datos del Admin
    admin_name: z.string().min(3, "El nombre completo es requerido"),
    admin_email: z.string().email("Email del administrador inválido"),
    admin_password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
})

type FormData = z.infer<typeof newLabSchema>

const plans = [
    { value: "FREE", label: "Free", description: "Hasta 100 órdenes/mes", color: "border-slate-200 bg-slate-50" },
    { value: "BASIC", label: "Basic", description: "Hasta 500 órdenes/mes", color: "border-blue-200 bg-blue-50" },
    { value: "PRO", label: "Pro", description: "Órdenes ilimitadas", color: "border-violet-200 bg-violet-50" },
    { value: "ENTERPRISE", label: "Enterprise", description: "Multi-sede + soporte", color: "border-amber-200 bg-amber-50" },
]

export default function NewLabPage() {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(false)
    const [selectedPlan, setSelectedPlan] = useState<string>("FREE")

    const {
        register,
        handleSubmit,
        setValue,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(newLabSchema),
        defaultValues: { plan: "FREE" },
    })

    async function onSubmit(data: FormData) {
        setIsLoading(true)
        try {
            const response = await fetch("/api/admin/create-lab", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            })

            const result = await response.json()

            if (!response.ok) {
                toast.error("Error al crear el laboratorio", {
                    description: result.error || "Verifica los datos e intenta de nuevo.",
                })
                return
            }

            toast.success("¡Laboratorio creado exitosamente!", {
                description: `${data.lab_name} está listo. El administrador recibirá sus credenciales.`,
            })
            router.push("/superadmin/labs")
        } catch (e) {
            toast.error("Error inesperado", { description: "Verifica tu conexión e intenta de nuevo." })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <SuperAdminLayout>
            <div className="max-w-3xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Link href="/superadmin/labs">
                        <Button variant="ghost" size="icon" className="rounded-full border border-slate-200 hover:border-violet-300 hover:bg-violet-50">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Crear Laboratorio</h1>
                        <p className="text-slate-500 text-sm">Registra un nuevo tenant y su administrador</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* Datos del Laboratorio */}
                    <Card className="border-0 shadow-sm bg-white overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-violet-500 to-indigo-600" />
                        <CardHeader className="pb-4">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Building2 className="h-4 w-4 text-violet-600" />
                                Datos del Laboratorio
                            </CardTitle>
                            <CardDescription>Información principal del tenant</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="lab_name" className="text-sm font-medium">
                                        Nombre <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="lab_name"
                                            {...register("lab_name")}
                                            placeholder="Laboratorio Clínico XYZ"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                    {errors.lab_name && <p className="text-xs text-red-500">{errors.lab_name.message}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="tax_id" className="text-sm font-medium">
                                        NIT / Tax ID <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="tax_id"
                                            {...register("tax_id")}
                                            placeholder="900.123.456-7"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                    {errors.tax_id && <p className="text-xs text-red-500">{errors.tax_id.message}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="lab_email" className="text-sm font-medium">
                                        Email del Lab <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="lab_email"
                                            {...register("lab_email")}
                                            type="email"
                                            placeholder="contacto@laboratorio.com"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                    {errors.lab_email && <p className="text-xs text-red-500">{errors.lab_email.message}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="lab_phone" className="text-sm font-medium">Teléfono</Label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="lab_phone"
                                            {...register("lab_phone")}
                                            placeholder="+57 300 000 0000"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5 md:col-span-2">
                                    <Label htmlFor="lab_address" className="text-sm font-medium">Dirección</Label>
                                    <div className="relative">
                                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="lab_address"
                                            {...register("lab_address")}
                                            placeholder="Calle 100 # 50-30, Bogotá"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Plan Selector */}
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Plan <span className="text-red-500">*</span></Label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {plans.map((plan) => (
                                        <button
                                            key={plan.value}
                                            type="button"
                                            onClick={() => {
                                                setSelectedPlan(plan.value)
                                                setValue("plan", plan.value as any)
                                            }}
                                            className={`p-3 rounded-lg border-2 text-left transition-all ${
                                                selectedPlan === plan.value
                                                    ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                                                    : `${plan.color} hover:border-violet-300`
                                            }`}
                                        >
                                            <p className={`text-sm font-semibold ${selectedPlan === plan.value ? "text-violet-700" : "text-slate-700"}`}>
                                                {plan.label}
                                            </p>
                                            <p className="text-[11px] text-slate-500 mt-0.5">{plan.description}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Datos del Admin */}
                    <Card className="border-0 shadow-sm bg-white overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-blue-500 to-cyan-600" />
                        <CardHeader className="pb-4">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <User className="h-4 w-4 text-blue-600" />
                                Administrador del Laboratorio
                            </CardTitle>
                            <CardDescription>Se creará una cuenta con rol LAB_ADMIN</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="space-y-1.5 md:col-span-2">
                                    <Label htmlFor="admin_name" className="text-sm font-medium">
                                        Nombre Completo <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="admin_name"
                                            {...register("admin_name")}
                                            placeholder="Dr. Juan Pérez"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                    {errors.admin_name && <p className="text-xs text-red-500">{errors.admin_name.message}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="admin_email" className="text-sm font-medium">
                                        Email <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="admin_email"
                                            {...register("admin_email")}
                                            type="email"
                                            placeholder="admin@laboratorio.com"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                    {errors.admin_email && <p className="text-xs text-red-500">{errors.admin_email.message}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="admin_password" className="text-sm font-medium">
                                        Contraseña Inicial <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="admin_password"
                                            {...register("admin_password")}
                                            type="password"
                                            placeholder="Mínimo 8 caracteres"
                                            className="pl-10 border-slate-200"
                                        />
                                    </div>
                                    {errors.admin_password && <p className="text-xs text-red-500">{errors.admin_password.message}</p>}
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
                                <CheckCircle2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                                <p className="text-xs text-blue-700">
                                    Se creará automáticamente la cuenta del admin, se le asignará el laboratorio y se generará un rol predeterminado con todos los permisos.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3 pb-4">
                        <Link href="/superadmin/labs">
                            <Button variant="outline" type="button" disabled={isLoading}>
                                Cancelar
                            </Button>
                        </Link>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md px-8"
                        >
                            {isLoading ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Creando...</>
                            ) : (
                                <><Sparkles className="h-4 w-4" /> Crear Laboratorio</>
                            )}
                        </Button>
                    </div>
                </form>
            </div>
        </SuperAdminLayout>
    )
}
