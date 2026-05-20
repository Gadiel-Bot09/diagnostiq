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
        },
    })

    async function onSubmit(values: z.infer<typeof patientLoginSchema>) {
        setIsLoading(true)
        const { error } = await supabase.auth.signInWithOtp({
            email: values.email,
            options: {
                emailRedirectTo: `${window.location.origin}/portal`,
            },
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo enviar el link de acceso. Intenta de nuevo.",
            })
            setIsLoading(false)
            return
        }

        setIsSent(true)
        setIsLoading(false)
        toast({
            title: "Link enviado",
            description: "Revisa tu correo electrónico para acceder al portal.",
        })
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
                        {isSent
                            ? "Hemos enviado un link de acceso a tu correo."
                            : "Ingresa tu correo para recibir un link de acceso seguro."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!isSent ? (
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
                                <Button type="submit" className="w-full text-lg py-6" disabled={isLoading}>
                                    {isLoading ? "Enviando..." : "Enviar Link de Acceso"}
                                </Button>
                            </form>
                        </Form>
                    ) : (
                        <div className="text-center py-4 space-y-4">
                            <div className="bg-primary/10 p-4 rounded-lg text-primary text-sm font-medium">
                                Si no recibes el correo en un par de minutos, revisa tu carpeta de SPAM.
                            </div>
                            <Button variant="outline" className="w-full" onClick={() => setIsSent(false)}>
                                Intentar con otro correo
                            </Button>
                        </div>
                    )}
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
