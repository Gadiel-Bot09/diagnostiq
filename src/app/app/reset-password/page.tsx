"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Lock, CheckCircle2 } from "lucide-react"

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"

const resetSchema = z.object({
    password: z.string().min(6, { message: "La contraseña debe tener al menos 6 caracteres" }),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
})

export default function ResetPasswordPage() {
    const router = useRouter()
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
    const [isSuccess, setIsSuccess] = useState(false)
    const supabase = createClient()

    const form = useForm<z.infer<typeof resetSchema>>({
        resolver: zodResolver(resetSchema),
        defaultValues: {
            password: "",
            confirmPassword: "",
        },
    })

    async function onSubmit(values: z.infer<typeof resetSchema>) {
        setIsLoading(true)
        
        // Supabase intercepta el hash o el token de la URL en la inicialización
        // del cliente si es de tipo PKCE o fragment. Lo único que hay que hacer
        // es enviar updateUser con el nuevo password.
        const { error } = await supabase.auth.updateUser({
            password: values.password
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "Error al actualizar",
                description: "El enlace puede haber expirado. Intenta solicitar uno nuevo.",
            })
            setIsLoading(false)
            return
        }

        setIsSuccess(true)
        setIsLoading(false)
        
        // Redirigir al login tras unos segundos
        setTimeout(() => {
            router.push("/app/login")
        }, 3000)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
            <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
                <CardHeader className="space-y-1 text-center">
                    <div className="flex justify-center mb-4 text-primary">
                        {isSuccess ? <CheckCircle2 className="h-12 w-12 text-green-500" /> : <Lock className="h-12 w-12" />}
                    </div>
                    <CardTitle className="text-2xl font-bold">Nueva Contraseña</CardTitle>
                    <CardDescription>
                        {isSuccess 
                            ? "Tu contraseña ha sido actualizada con éxito." 
                            : "Ingresa tu nueva contraseña a continuación."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!isSuccess ? (
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nueva Contraseña</FormLabel>
                                            <FormControl>
                                                <Input type="password" placeholder="••••••••" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="confirmPassword"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Confirmar Contraseña</FormLabel>
                                            <FormControl>
                                                <Input type="password" placeholder="••••••••" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading ? "Actualizando..." : "Actualizar Contraseña"}
                                </Button>
                            </form>
                        </Form>
                    ) : (
                        <div className="text-center space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Serás redirigido al inicio de sesión en unos segundos...
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
