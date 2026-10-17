"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Hash, Lock, Eye, EyeOff, ArrowRight, Loader2, FileCheck2, Clock, ShieldCheck, KeyRound } from "lucide-react"

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
    document_number: z.string().min(4, { message: "El número de documento es muy corto" }),
    password: z.string().min(4, { message: "La contraseña es muy corta" }),
})

type LoginForm = z.infer<typeof loginSchema>

export default function PatientLoginPage() {
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [welcome, setWelcome] = useState(false)
    const [patientName, setPatientName] = useState<string | null>(null)
    const supabase = createClient()

    const form = useForm<LoginForm>({
        resolver: zodResolver(loginSchema),
        defaultValues: { document_number: "", password: "" },
    })

    async function onSubmit(values: LoginForm) {
        setIsLoading(true)

        try {
            // Step 1: Resolve document number to email (real or synthetic)
            const res = await fetch("/api/portal/patient-login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    document_number: values.document_number,
                    password: values.password,
                }),
            })

            const data = await res.json()

            if (!res.ok) {
                toast({
                    variant: "destructive",
                    title: "Acceso denegado",
                    description: data.error || "No se encontró un paciente con ese número de documento.",
                })
                setIsLoading(false)
                return
            }

            // Step 2: Sign in with the resolved email
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: data.email,
                password: values.password,
            })

            if (signInError) {
                toast({
                    variant: "destructive",
                    title: "Contraseña incorrecta",
                    description: "La contraseña no es correcta. Si es tu primera vez, usa tu número de documento como contraseña.",
                })
                setIsLoading(false)
                return
            }

            // Nombre para el overlay de bienvenida llamativo
            setPatientName(data.full_name || null)
            setWelcome(true)

            // Redirección con breve delay para disfrutar de la bienvenida
            setTimeout(() => {
                window.location.href = "/portal"
            }, 2400)

        } catch (err) {
            toast({
                variant: "destructive",
                title: "Error de conexión",
                description: "No se pudo conectar al servidor. Intenta nuevamente.",
            })
            setIsLoading(false)
        }
    }

    return (
        <>
            {welcome && (
                <WelcomeOverlay
                    name={patientName}
                    subtitle="Cargando tu historial de exámenes y resultados médicos..."
                />
            )}

            <AuthShell
                headline="Tus resultados médicos,"
                highlight="siempre a tu alcance"
                description="Consulta y descarga tus exámenes clínicos y radiológicos en segundos desde cualquier dispositivo, sin filas ni desplazamientos."
                features={[
                    { icon: <FileCheck2 className="h-4 w-4" />, text: "Visualización inmediata de tus exámenes en PDF oficial" },
                    { icon: <Clock className="h-4 w-4" />, text: "Historial completo disponible las 24 horas del día" },
                    { icon: <ShieldCheck className="h-4 w-4" />, text: "Tus datos médicos protegidos bajo confidencialidad digital" },
                ]}
            >
                <div className="rounded-3xl border border-white bg-white/90 p-8 shadow-2xl shadow-indigo-500/10 backdrop-blur">
                    <div className="mb-6 space-y-1.5">
                        <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                            Portal Pacientes
                        </span>
                        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Acceder a mis Resultados</h1>
                        <p className="text-sm text-slate-500">Ingresa tu número de documento para consultar tus estudios.</p>
                    </div>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="document_number"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-slate-700">Número de Documento</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Hash className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-400" />
                                                <Input
                                                    placeholder="Ej: 1033372018"
                                                    className="h-12 rounded-xl border-indigo-100 bg-indigo-50/40 pl-10 focus-visible:ring-indigo-400 text-base"
                                                    {...field}
                                                />
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
                                        <FormLabel className="text-slate-700">Contraseña</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-400" />
                                                <Input
                                                    type={showPassword ? "text" : "password"}
                                                    placeholder="Tu contraseña (o número de documento)"
                                                    className="h-12 rounded-xl border-indigo-100 bg-indigo-50/40 pl-10 pr-11 focus-visible:ring-indigo-400 text-base"
                                                    {...field}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(v => !v)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors"
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
                                {isLoading ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" /> Verificando acceso...</>
                                ) : (
                                    <>Ingresar a mis Resultados <ArrowRight className="h-4 w-4" /></>
                                )}
                            </Button>
                        </form>
                    </Form>

                    <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3.5 flex items-start gap-2.5 text-xs text-indigo-900">
                        <KeyRound className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold text-indigo-950">¿Primera vez ingresando?</span>{" "}
                            Usa tu número de documento como usuario <em>y</em> como contraseña inicial.
                        </div>
                    </div>
                </div>

                <div className="text-center space-y-2">
                    <p className="text-xs text-slate-500">
                        ¿Eres personal o médico de la institución?{" "}
                        <Link href="/app/login" className="font-semibold text-indigo-600 hover:underline">
                            Acceso administrativo
                        </Link>
                    </p>
                    <p className="text-[11px] text-slate-400">
                        Tus datos de salud están protegidos con cifrado de grado médico · DiagnostiQ
                    </p>
                </div>
            </AuthShell>
        </>
    )
}
