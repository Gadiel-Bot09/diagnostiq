"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { HeartPulse } from "lucide-react"

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

const patientLoginSchema = z.object({
    email: z.string().email({ message: "Email inválido" }),
    password: z.string().min(4, { message: "La contraseña/documento es muy corta" }),
})

export default function PatientLoginPage() {
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
    const [isSent, setIsSent] = useState(false)
    const supabase = createClient()

    const form = useForm<z.infer<typeof patientLoginSchema>>({
        resolver: zodResolver(patientLoginSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    })

    async function onSubmit(values: z.infer<typeof patientLoginSchema>) {
        setIsLoading(true)
        const { error } = await supabase.auth.signInWithPassword({
            email: values.email,
            password: values.password,
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "Error de credenciales",
                description: "Correo o contraseña incorrectos. Verifica que la contraseña sea tu número de documento si es la primera vez que ingresas.",
            })
            setIsLoading(false)
            return
        }

        toast({
            title: "Acceso exitoso",
            description: "Cargando tu portal de resultados...",
        })
        
        // Redirect to portal home
        window.location.href = "/portal"
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-sky-50/50 p-4">
            <Card className="w-full max-w-md shadow-xl border-t-4 border-t-primary">
                <CardHeader className="space-y-1 text-center">
                    <div className="flex justify-center mb-4 text-primary">
                        <HeartPulse className="h-12 w-12" />
                    </div>
                    <CardTitle className="text-2xl font-bold">Portal de Pacientes</CardTitle>
                    <CardDescription>
                        Ingresa con tu correo y contraseña. Si es tu primera vez, tu contraseña es tu número de documento.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Correo Electrónico</FormLabel>
                                        <FormControl>
                                            <Input placeholder="tu@email.com" {...field} />
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
                                        <FormLabel>Contraseña (o N° de Documento)</FormLabel>
                                        <FormControl>
                                            <Input type="password" placeholder="Tu contraseña o documento" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button type="submit" className="w-full text-lg py-6" disabled={isLoading}>
                                {isLoading ? "Ingresando..." : "Ingresar a mis Resultados"}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
                <CardFooter className="justify-center">
                    <p className="text-xs text-muted-foreground text-center">
                        Tus datos de salud están protegidos con encriptación de grado médico.
                    </p>
                </CardFooter>
            </Card>
        </div>
    )
}
