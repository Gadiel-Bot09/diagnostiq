"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, LayoutDashboard, Users, BarChart3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import { AuthShell } from "@/components/auth/AuthShell"
import { WelcomeOverlay } from "@/components/auth/WelcomeOverlay"

const loginSchema = z.object({
    email: z.string().email({ message: "Email inválido" }),
    password: z.string().min(6, { message: "Contraseña demasiado corta" }),
})

export default function LabLoginPage() {
    const router = useRouter()
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [welcomeName, setWelcomeName] = useState<string | null>(null)
    const [welcome, setWelcome] = useState(false)
    const supabase = createClient()

    const form = useForm<z.infer<typeof loginSchema>>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    })

    async function onSubmit(values: z.infer<typeof loginSchema>) {
        setIsLoading(true)
        const { data, error } = await supabase.auth.signInWithPassword({
            email: values.email,
            password: values.password,
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "Error de acceso",
                description: "Credenciales incorrectas o problema de servidor.",
            })
            setIsLoading(false)
            return
        }

        // Nombre para el mensaje de bienvenida y destino por rol
        let name: string | null = data.user?.user_metadata?.full_name || null
        let targetUrl = "/app/dashboard"

        try {
            if (data.user) {
                const { data: profile } = await supabase
                    .from("profiles")
                    .select("full_name, role")
                    .eq("id", data.user.id)
                    .single()

                if (profile?.full_name) name = profile.full_name

                if (profile?.role === "SUPER_ADMIN") {
                    targetUrl = "/superadmin/dashboard"
                } else if (profile?.role === "DOCTOR") {
                    targetUrl = "/doctor"
                } else if (profile?.role === "PATIENT") {
                    targetUrl = "/portal"
                }
            }
        } catch { /* usa el valor por defecto */ }

        setWelcomeName(name)
        setWelcome(true)
        setTimeout(() => {
            window.location.href = targetUrl
        }, 2400)
    }

    return (
        <>
            {welcome && (
                <WelcomeOverlay
                    name={welcomeName}
                    subtitle="Preparando tu panel de control del laboratorio..."
                />
            )}

            <AuthShell
                headline="Gestiona tu laboratorio con"
                highlight="inteligencia digital"
                description="Órdenes, pacientes y resultados en un solo lugar. Entrega informes al instante y proyecta una imagen moderna y confiable."
                features={[
                    { icon: <LayoutDashboard className="h-4 w-4" />, text: "Panel con el estado de tus órdenes en tiempo real" },
                    { icon: <Users className="h-4 w-4" />, text: "Pacientes, personal y roles con permisos a medida" },
                    { icon: <BarChart3 className="h-4 w-4" />, text: "Reportes y tiempos de entrega listos para exportar" },
                ]}
            >
                <div className="rounded-3xl border border-white bg-white/90 p-8 shadow-2xl shadow-indigo-500/10 backdrop-blur">
                    <div className="mb-6 space-y-1.5">
                        <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                            Acceso administrativo
                        </span>
                        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Bienvenido de nuevo</h1>
                        <p className="text-sm text-slate-500">Ingresa tus credenciales para acceder al panel de control.</p>
                    </div>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Correo Electrónico</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-400" />
                                                <Input placeholder="nombre@laboratorio.com" className="h-12 rounded-xl border-indigo-100 bg-indigo-50/40 pl-10 focus-visible:ring-indigo-400" {...field} />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Contraseña</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-400" />
                                                <Input
                                                    type={showPassword ? "text" : "password"}
                                                    className="h-12 rounded-xl border-indigo-100 bg-indigo-50/40 pl-10 pr-11 focus-visible:ring-indigo-400"
                                                    {...field}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(v => !v)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600"
                                                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                                >
                                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button
                                type="submit"
                                disabled={isLoading || welcome}
                                className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-500 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 hover:brightness-110"
                            >
                                {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Iniciando sesión...</> : <>Acceder <ArrowRight className="h-4 w-4" /></>}
                            </Button>
                        </form>
                    </Form>

                    <div className="mt-5 text-center">
                        <Link
                            href="/app/forgot-password"
                            className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-indigo-600 hover:underline"
                        >
                            ¿Olvidaste tu contraseña?
                        </Link>
                    </div>
                </div>

                <p className="text-center text-xs text-slate-500">
                    ¿Eres paciente?{" "}
                    <Link href="/portal/login" className="font-semibold text-indigo-600 hover:underline">Ir al portal de resultados</Link>
                </p>
            </AuthShell>
        </>
    )
}
