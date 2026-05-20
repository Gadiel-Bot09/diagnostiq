"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { ArrowLeft, UserPlus, Loader2 } from "lucide-react"

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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"

const patientSchema = z.object({
    document_type: z.string().min(1, "Requerido"),
    document_number: z.string().min(5, "Mínimo 5 caracteres"),
    full_name: z.string().min(3, "Nombre muy corto"),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    phone: z.string().optional(),
    dob: z.string().optional(),
    sex: z.string().optional(),
})

export default function NewPatientPage() {
    const router = useRouter()
    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState(false)
    const supabase = createClient()

    const form = useForm<z.infer<typeof patientSchema>>({
        resolver: zodResolver(patientSchema),
        defaultValues: {
            document_type: "CC",
            document_number: "",
            full_name: "",
            email: "",
            phone: "",
            dob: "",
            sex: "OTRO",
        },
    })

    async function onSubmit(values: z.infer<typeof patientSchema>) {
        setIsLoading(true)
        try {
            const { data: profile } = await supabase.from('profiles').select('lab_id').single()
            if (!profile?.lab_id) throw new Error("No tienes un laboratorio asignado")

            const { error } = await supabase.from("patients").insert({
                lab_id: profile.lab_id,
                ...values,
                email: values.email || null,
                dob: values.dob || null,
            })

            if (error) throw error

            toast({
                title: "Paciente registrado",
                description: `${values.full_name} ha sido agregado correctamente.`,
            })
            router.push("/app/patients")
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error al registrar",
                description: error.message || "No se pudo crear el paciente.",
            })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <AdminLayout>
            <div className="max-w-2xl mx-auto space-y-6">
                <Button variant="ghost" onClick={() => router.back()} className="gap-2 -ml-4">
                    <ArrowLeft className="h-4 w-4" /> Volver a lista
                </Button>

                <Card className="border-t-4 border-t-primary shadow-lg">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <UserPlus className="h-6 w-6 text-primary" />
                            Nuevo Paciente
                        </CardTitle>
                        <CardDescription>
                            Registra los datos básicos del paciente para emitir órdenes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="document_type"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Tipo de Documento</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Seleccionar" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="CC">Cédula de Ciudadanía</SelectItem>
                                                        <SelectItem value="TI">Tarjeta de Identidad</SelectItem>
                                                        <SelectItem value="CE">Cédula de Extranjería</SelectItem>
                                                        <SelectItem value="PA">Pasaporte</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="document_number"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Número de Documento</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="123456" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="full_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nombre Completo</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Juan Pérez" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="email"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Correo Electrónico (Opcional)</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="juan@gmail.com" type="email" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="phone"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Teléfono</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="3001234567" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="dob"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Fecha de Nacimiento</FormLabel>
                                                <FormControl>
                                                    <Input type="date" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="sex"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Sexo</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Seleccionar" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="MASCULINO">Masculino</SelectItem>
                                                        <SelectItem value="FEMENINO">Femenino</SelectItem>
                                                        <SelectItem value="OTRO">Otro</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <Button type="submit" className="w-full h-12 text-lg" disabled={isLoading}>
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Registrando...
                                        </>
                                    ) : "Registrar Paciente"}
                                </Button>
                            </form>
                        </Form>
                    </CardContent>
                </Card>
            </div>
        </AdminLayout>
    )
}
