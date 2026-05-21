"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react"

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

const forgotSchema = z.object({
    email: z.string().email({ message: "Email inválido" }),
})

export default function ForgotPasswordPage() {
    const router = useRouter()
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
    const [isSuccess, setIsSuccess] = useState(false)
    const supabase = createClient()

    const form = useForm<z.infer<typeof forgotSchema>>({
        resolver: zodResolver(forgotSchema),
        defaultValues: {
            email: "",
        },
    })

    async function onSubmit(values: z.infer<typeof forgotSchema>) {
        setIsLoading(true)
        
        // El redirectTo debe apuntar a tu URL en producción o localhost según el entorno.
        // Lo dejamos relativo o detectamos el origin dinámicamente si es posible.
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        
        const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
            redirectTo: `${origin}/app/reset-password`,
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "Error al enviar el enlace",
                description: "Verifica que el correo ingresado sea correcto.",
            })
            setIsLoading(false)
            return
        }

        setIsSuccess(true)
        setIsLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
            <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
                <CardHeader className="space-y-1 text-center">
                    <div className="flex justify-center mb-4 text-primary">
                        {isSuccess ? <CheckCircle2 className="h-12 w-12 text-green-500" /> : <Mail className="h-12 w-12" />}
                    </div>
                    <CardTitle className="text-2xl font-bold">Recuperar Contraseña</CardTitle>
                    <CardDescription>
                        {isSuccess 
                            ? "Hemos enviado un enlace de recuperación a tu correo." 
                            : "Ingresa tu correo para recibir un enlace seguro de restablecimiento."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!isSuccess ? (
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Correo Electrónico</FormLabel>
                                            <FormControl>
                                                <Input placeholder="nombre@laboratorio.com" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading ? "Enviando..." : "Enviar enlace de recuperación"}
                                </Button>
                            </form>
                        </Form>
                    ) : (
                        <div className="text-center space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Revisa tu bandeja de entrada o carpeta de spam. El enlace es válido por tiempo limitado.
                            </p>
                            <Button 
                                variant="outline" 
                                className="w-full" 
                                onClick={() => router.push("/app/login")}
                            >
                                Volver al inicio de sesión
                            </Button>
                        </div>
                    )}
                </CardContent>
                {!isSuccess && (
                    <CardFooter className="flex flex-col space-y-2">
                        <Link href="/app/login" passHref>
                            <Button variant="link" className="text-xs text-muted-foreground gap-2">
                                <ArrowLeft className="h-3 w-3" /> Volver al inicio de sesión
                            </Button>
                        </Link>
                    </CardFooter>
                )}
            </Card>
        </div>
    )
}
