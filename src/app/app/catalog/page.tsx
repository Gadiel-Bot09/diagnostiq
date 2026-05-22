// @ts-nocheck
"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { TestTube2, Plus, Search, Pencil, Trash2, X, Loader2, FlaskConical } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

const testSchema = z.object({
    code: z.string().min(1, "El código es requerido"),
    name: z.string().min(2, "El nombre es requerido"),
    category: z.string().optional(),
    units: z.string().optional(),
    reference_range: z.string().optional(),
})
type TestForm = z.infer<typeof testSchema>

export default function CatalogPage() {
    const supabase = createClient()
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")
    const [showForm, setShowForm] = useState(false)
    const [editingTest, setEditingTest] = useState<any>(null)

    const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<TestForm>({
        resolver: zodResolver(testSchema),
    })

    const { data: labId } = useQuery({
        queryKey: ["lab-id"],
        queryFn: async () => {
            const { data } = await supabase.from("profiles").select("lab_id").single()
            return data?.lab_id
        }
    })

    const { data: tests, isLoading } = useQuery({
        queryKey: ["tests", labId],
        enabled: !!labId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("tests")
                .select("*")
                .eq("lab_id", labId)
                .order("category", { ascending: true })
            if (error) throw error
            return data || []
        }
    })

    const saveMutation = useMutation({
        mutationFn: async (values: TestForm) => {
            if (editingTest) {
                const { error } = await supabase.from("tests").update(values).eq("id", editingTest.id)
                if (error) throw error
            } else {
                const { error } = await supabase.from("tests").insert({ ...values, lab_id: labId })
                if (error) throw error
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tests"] })
            toast.success(editingTest ? "Examen actualizado" : "Examen creado")
            reset(); setShowForm(false); setEditingTest(null)
        },
        onError: (e: any) => toast.error("Error", { description: e.message }),
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from("tests").delete().eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tests"] })
            toast.success("Examen eliminado")
        },
        onError: () => toast.error("No se puede eliminar. Está en uso en alguna orden."),
    })

    function openEdit(test: any) {
        setEditingTest(test)
        setValue("code", test.code)
        setValue("name", test.name)
        setValue("category", test.category || "")
        setValue("units", test.units || "")
        setValue("reference_range", test.reference_range || "")
        setShowForm(true)
    }

    const categories = [...new Set(tests?.map((t: any) => t.category).filter(Boolean))]
    const filtered = tests?.filter((t: any) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.code.toLowerCase().includes(search.toLowerCase()) ||
        t.category?.toLowerCase().includes(search.toLowerCase())
    ) || []

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Catálogo de Exámenes</h1>
                        <p className="text-muted-foreground mt-1">Gestiona los exámenes disponibles en tu laboratorio</p>
                    </div>
                    <Button className="gap-2" onClick={() => { setEditingTest(null); reset(); setShowForm(true) }}>
                        <Plus className="h-4 w-4" /> Nuevo Examen
                    </Button>
                </div>

                {/* Form */}
                {showForm && (
                    <Card className="border-t-4 border-t-primary shadow-md">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-base">{editingTest ? "Editar Examen" : "Nuevo Examen"}</CardTitle>
                            <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditingTest(null); reset() }}>
                                <X className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSubmit((v) => saveMutation.mutate(v))} className="grid md:grid-cols-3 gap-4">
                                <div className="space-y-1.5">
                                    <Label>Código *</Label>
                                    <Input {...register("code")} placeholder="HEM-001" />
                                    {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
                                </div>
                                <div className="space-y-1.5 md:col-span-2">
                                    <Label>Nombre *</Label>
                                    <Input {...register("name")} placeholder="Hemograma Completo" />
                                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Categoría</Label>
                                    <Input {...register("category")} placeholder="Hematología" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Unidades</Label>
                                    <Input {...register("units")} placeholder="mg/dL, UI/L, ..." />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Rango de Referencia</Label>
                                    <Input {...register("reference_range")} placeholder="4.5 - 11.0" />
                                </div>
                                <div className="md:col-span-3 flex justify-end gap-2 pt-2">
                                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingTest(null); reset() }}>Cancelar</Button>
                                    <Button type="submit" disabled={saveMutation.isPending} className="gap-2">
                                        {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                                        {editingTest ? "Actualizar" : "Crear Examen"}
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                )}

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por nombre, código o categoría..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
                </div>

                {/* Table */}
                <Card>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                <FlaskConical className="h-10 w-10 text-muted-foreground/40" />
                                <p className="font-medium text-muted-foreground">
                                    {search ? "No se encontraron exámenes" : "No hay exámenes en el catálogo"}
                                </p>
                                {!search && <Button size="sm" onClick={() => setShowForm(true)} className="gap-2"><Plus className="h-3.5 w-3.5" /> Crear el primero</Button>}
                            </div>
                        ) : (
                            <div className="divide-y">
                                {filtered.map((test: any) => (
                                    <div key={test.id} className="flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                                <TestTube2 className="h-4 w-4 text-primary" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium">{test.name}</p>
                                                    <Badge variant="outline" className="text-[10px] font-mono">{test.code}</Badge>
                                                </div>
                                                <div className="flex items-center gap-3 mt-0.5">
                                                    {test.category && <p className="text-xs text-muted-foreground">{test.category}</p>}
                                                    {test.units && <p className="text-xs text-muted-foreground">Unidad: {test.units}</p>}
                                                    {test.reference_range && <p className="text-xs text-muted-foreground">Ref: {test.reference_range}</p>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(test)}>
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon"
                                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={() => { if (confirm("¿Eliminar este examen?")) deleteMutation.mutate(test.id) }}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <p className="text-xs text-muted-foreground text-right">
                    {filtered.length} examen{filtered.length !== 1 ? "es" : ""} · {categories.length} categoría{categories.length !== 1 ? "s" : ""}
                </p>
            </div>
        </AdminLayout>
    )
}
