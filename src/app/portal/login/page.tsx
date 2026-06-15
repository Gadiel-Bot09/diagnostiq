"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { HeartPulse, Hash, Lock, Microscope } from "lucide-react"

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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"

const loginSchema = z.object({
    document_number: z.string().min(4, { message: "El número de documento es muy corto" }),
    password: z.string().min(4, { message: "La contraseña es muy corta" }),
})

type LoginForm = z.infer<typeof loginSchema>

export default function PatientLoginPage() {
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
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

            toast({
                title: "¡Acceso exitoso!",
                description: "Cargando tus resultados...",
            })

            window.location.href = "/portal"

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
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-blue-100 p-4">
            <div className="w-full max-w-md space-y-6">
                {/* Logo */}
                <div className="text-center space-y-2">
                    <div className="flex justify-center">
                        <div className="bg-primary rounded-2xl p-4 shadow-lg shadow-primary/30">
                            <Microscope className="h-10 w-10 text-white" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">DiagnostiQ</h1>
                    <p className="text-sm text-muted-foreground">Portal de Resultados Médicos</p>
                </div>

                <Card className="shadow-2xl border-0 bg-white/90 backdrop-blur">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl font-bold text-center">Acceder a mis Resultados</CardTitle>
                        <CardDescription className="text-center text-sm">
                            Ingresa con tu número de documento. Si es tu primera vez, la contraseña también es tu número de documento.
                        </CardDescription>
                    </CardHeader>

                    <CardContent>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="document_number"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex items-center gap-1.5">
                                                <Hash className="h-3.5 w-3.5" /> Número de Documento
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="Ej: 1033372018"
                                                    className="text-base h-11"
                                                    {...field}
                                                />
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
                                            <FormLabel className="flex items-center gap-1.5">
                                                <Lock className="h-3.5 w-3.5" /> Contraseña
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="password"
                                                    placeholder="Tu contraseña (o número de documento)"
                                                    className="text-base h-11"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <Button
                                    type="submit"
                                    className="w-full h-12 text-base font-semibold mt-2"
                                    disabled={isLoading}
                                >
                                    {isLoading ? "Verificando..." : "Ingresar a mis Resultados →"}
                                </Button>
                            </form>
                        </Form>
                    </CardContent>

                    <CardFooter className="flex-col gap-2 pt-0">
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 w-full text-center">
                            <p className="text-xs text-blue-700">
                                🔑 <strong>Primera vez:</strong> Usa tu número de documento como usuario <em>y</em> contraseña.
                            </p>
                        </div>
                        <p className="text-[11px] text-muted-foreground text-center">
                            Tus datos de salud están protegidos con cifrado de grado médico.
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </div>
    )
}
