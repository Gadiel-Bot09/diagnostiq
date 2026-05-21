// @ts-nocheck
"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "@tanstack/react-query"
import {
    ArrowLeft,
    Search,
    Plus,
    X,
    Microscope,
    User,
    FlaskConical,
    Loader2,
    CheckCircle2,
    UserPlus,
    ChevronDown,
} from "lucide-react"
import { format } from "date-fns"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"

// ─── Types ────────────────────────────────────────────────────────────────────
type Patient = {
    id: string
    full_name: string
    document_type: string
    document_number: string
    email: string | null
    phone: string | null
}

type Test = {
    id: string
    code: string
    name: string
    category: string | null
    units: string | null
}

// ─── Order number generator ───────────────────────────────────────────────────
function generateOrderNumber(): string {
    const now = new Date()
    const datePart = format(now, "yyyyMMdd")
    const timePart = format(now, "HHmm")
    return `${datePart}-${timePart}`
}

export default function NewOrderPage() {
    const router = useRouter()
    const { toast } = useToast()
    const supabase = createClient()

    // Patient search state
    const [patientSearch, setPatientSearch] = useState("")
    const [showPatientDropdown, setShowPatientDropdown] = useState(false)
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
    const patientDropdownRef = useRef<HTMLDivElement>(null)

    // Test search state
    const [testSearch, setTestSearch] = useState("")
    const [showTestDropdown, setShowTestDropdown] = useState(false)
    const [selectedTests, setSelectedTests] = useState<Test[]>([])
    const testDropdownRef = useRef<HTMLDivElement>(null)

    const [orderNumber] = useState(generateOrderNumber)

    // Close dropdowns on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (patientDropdownRef.current && !patientDropdownRef.current.contains(e.target as Node)) {
                setShowPatientDropdown(false)
            }
            if (testDropdownRef.current && !testDropdownRef.current.contains(e.target as Node)) {
                setShowTestDropdown(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    // ─── Fetch patients ───────────────────────────────────────────────────────
    const { data: patients, isLoading: loadingPatients } = useQuery({
        queryKey: ["patients-search", patientSearch],
        queryFn: async () => {
            if (!patientSearch || patientSearch.length < 2) return []
            let query = supabase
                .from("patients")
                .select("id, full_name, document_type, document_number, email, phone")
                .limit(6)

            if (patientSearch) {
                query = query.or(
                    `full_name.ilike.%${patientSearch}%,document_number.ilike.%${patientSearch}%`
                )
            }

            const { data, error } = await query
            if (error) throw error
            return data as Patient[]
        },
        enabled: patientSearch.length >= 2,
    })

    // ─── Fetch tests ──────────────────────────────────────────────────────────
    const { data: tests, isLoading: loadingTests } = useQuery({
        queryKey: ["tests-search", testSearch],
        queryFn: async () => {
            let query = supabase
                .from("tests")
                .select("id, code, name, category, units")
                .order("name")
                .limit(10)

            if (testSearch) {
                query = query.or(`name.ilike.%${testSearch}%,code.ilike.%${testSearch}%`)
            }

            const { data, error } = await query
            if (error) throw error
            return data as Test[]
        },
    })

    // ─── Submit mutation ──────────────────────────────────────────────────────
    const { mutate: createOrder, isPending } = useMutation({
        mutationFn: async () => {
            if (!selectedPatient) throw new Error("Selecciona un paciente.")
            if (selectedTests.length === 0) throw new Error("Agrega al menos un examen.")

            // Get lab_id from profile
            const { data: profile } = await supabase
                .from("profiles")
                .select("lab_id")
                .single()

            if (!profile?.lab_id) throw new Error("No tienes un laboratorio asignado.")

            // Insert order
            const { data: newOrder, error: orderError } = await supabase
                .from("orders")
                .insert({
                    lab_id: profile.lab_id,
                    patient_id: selectedPatient.id,
                    order_number: orderNumber,
                    status: "PENDING",
                })
                .select("id")
                .single()

            if (orderError) throw orderError

            // Insert order_tests (batch)
            const orderTests = selectedTests.map((t) => ({
                order_id: newOrder.id,
                test_id: t.id,
                status: "PENDING",
            }))

            const { error: testsError } = await supabase
                .from("order_tests")
                .insert(orderTests)

            if (testsError) throw testsError

            return newOrder.id
        },
        onSuccess: (orderId) => {
            toast({
                title: "✅ Orden creada exitosamente",
                description: `Orden #${orderNumber} lista para procesar.`,
            })
            router.push(`/app/orders/${orderId}`)
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Error al crear orden",
                description: err.message,
            })
        },
    })

    const addTest = (test: Test) => {
        if (!selectedTests.find((t) => t.id === test.id)) {
            setSelectedTests((prev) => [...prev, test])
        }
        setTestSearch("")
        setShowTestDropdown(false)
    }

    const removeTest = (testId: string) => {
        setSelectedTests((prev) => prev.filter((t) => t.id !== testId))
    }

    const selectPatient = (patient: Patient) => {
        setSelectedPatient(patient)
        setPatientSearch("")
        setShowPatientDropdown(false)
    }

    return (
        <AdminLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <Button variant="ghost" onClick={() => router.back()} className="gap-2 -ml-4">
                    <ArrowLeft className="h-4 w-4" /> Volver a órdenes
                </Button>

                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-3 rounded-xl">
                        <FlaskConical className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Nueva Orden</h1>
                        <p className="text-muted-foreground text-sm">
                            Número de orden: <span className="font-mono font-semibold text-primary">#{orderNumber}</span>
                        </p>
                    </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* LEFT: form */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* ── STEP 1: Seleccionar Paciente ── */}
                        <Card className={selectedPatient ? "border-green-300 bg-green-50/30" : ""}>
                            <CardHeader className="pb-4">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${selectedPatient ? "bg-green-500" : "bg-primary"}`}>
                                        {selectedPatient ? <CheckCircle2 className="h-4 w-4" /> : "1"}
                                    </div>
                                    Seleccionar Paciente
                                </CardTitle>
                                <CardDescription>Busca por nombre o número de documento.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {selectedPatient ? (
                                    <div className="flex items-center gap-4 p-4 bg-white border border-green-200 rounded-xl">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <User className="h-5 w-5 text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm">{selectedPatient.full_name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {selectedPatient.document_type}: {selectedPatient.document_number}
                                                {selectedPatient.phone && ` · ${selectedPatient.phone}`}
                                            </p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0 text-muted-foreground hover:text-destructive"
                                            onClick={() => setSelectedPatient(null)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="relative" ref={patientDropdownRef}>
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                id="patient-search"
                                                placeholder="Escriba el nombre o documento..."
                                                className="pl-9"
                                                value={patientSearch}
                                                onChange={(e) => {
                                                    setPatientSearch(e.target.value)
                                                    setShowPatientDropdown(true)
                                                }}
                                                onFocus={() => setShowPatientDropdown(true)}
                                            />
                                            {showPatientDropdown && patientSearch.length >= 2 && (
                                                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg overflow-hidden">
                                                    {loadingPatients ? (
                                                        <div className="p-4 text-sm text-center text-muted-foreground flex items-center justify-center gap-2">
                                                            <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                                                        </div>
                                                    ) : patients && patients.length > 0 ? (
                                                        patients.map((p) => (
                                                            <button
                                                                key={p.id}
                                                                type="button"
                                                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b last:border-0"
                                                                onClick={() => selectPatient(p)}
                                                            >
                                                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                                    <User className="h-4 w-4 text-primary" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-medium text-sm truncate">{p.full_name}</p>
                                                                    <p className="text-xs text-muted-foreground">{p.document_type}: {p.document_number}</p>
                                                                </div>
                                                            </button>
                                                        ))
                                                    ) : (
                                                        <div className="p-4 text-sm text-center text-muted-foreground">
                                                            No se encontraron pacientes.
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>¿No está registrado?</span>
                                            <Link href="/app/patients/new" className="text-primary font-medium hover:underline flex items-center gap-1">
                                                <UserPlus className="h-3 w-3" /> Registrar nuevo paciente
                                            </Link>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* ── STEP 2: Seleccionar Exámenes ── */}
                        <Card className={selectedTests.length > 0 ? "border-blue-300 bg-blue-50/20" : ""}>
                            <CardHeader className="pb-4">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${selectedTests.length > 0 ? "bg-blue-500" : "bg-primary"}`}>
                                        {selectedTests.length > 0 ? selectedTests.length : "2"}
                                    </div>
                                    Seleccionar Exámenes
                                </CardTitle>
                                <CardDescription>Agrega uno o más exámenes del catálogo del laboratorio.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Test search */}
                                <div className="relative" ref={testDropdownRef}>
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="test-search"
                                        placeholder="Buscar examen por nombre o código..."
                                        className="pl-9 pr-9"
                                        value={testSearch}
                                        onChange={(e) => {
                                            setTestSearch(e.target.value)
                                            setShowTestDropdown(true)
                                        }}
                                        onFocus={() => setShowTestDropdown(true)}
                                    />
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    {showTestDropdown && (
                                        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                                            {loadingTests ? (
                                                <div className="p-4 text-sm text-center text-muted-foreground flex items-center justify-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando catálogo...
                                                </div>
                                            ) : tests && tests.length > 0 ? (
                                                tests.map((t) => {
                                                    const alreadyAdded = selectedTests.some((s) => s.id === t.id)
                                                    return (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            disabled={alreadyAdded}
                                                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b last:border-0 disabled:opacity-40 disabled:cursor-not-allowed"
                                                            onClick={() => addTest(t)}
                                                        >
                                                            <div className="bg-primary/5 p-1.5 rounded-md">
                                                                <Microscope className="h-4 w-4 text-primary" />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-medium text-sm truncate">{t.name}</p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {t.code}{t.category ? ` · ${t.category}` : ""}
                                                                </p>
                                                            </div>
                                                            {alreadyAdded && (
                                                                <Badge variant="secondary" className="text-[10px]">Añadido</Badge>
                                                            )}
                                                        </button>
                                                    )
                                                })
                                            ) : (
                                                <div className="p-4 text-sm text-center text-muted-foreground">
                                                    No se encontraron exámenes.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Selected tests list */}
                                {selectedTests.length > 0 ? (
                                    <div className="space-y-2">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Exámenes seleccionados:</p>
                                        <div className="divide-y border rounded-xl overflow-hidden">
                                            {selectedTests.map((test, i) => (
                                                <div key={test.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                                                    <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                                                    <div className="bg-primary/5 p-1.5 rounded-md">
                                                        <Microscope className="h-4 w-4 text-primary" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium truncate">{test.name}</p>
                                                        {test.category && (
                                                            <p className="text-xs text-muted-foreground">{test.category}</p>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeTest(test.id)}
                                                        className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="border-2 border-dashed rounded-xl p-6 text-center text-muted-foreground">
                                        <Microscope className="h-8 w-8 mx-auto opacity-20 mb-2" />
                                        <p className="text-sm">Busca y agrega los exámenes requeridos.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* RIGHT: summary + submit */}
                    <div className="space-y-6">
                        <Card className="sticky top-4">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Resumen de Orden</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">No. de Orden</span>
                                        <span className="font-mono font-bold text-primary">#{orderNumber}</span>
                                    </div>
                                    <Separator />
                                    <div>
                                        <p className="text-muted-foreground mb-1">Paciente</p>
                                        {selectedPatient ? (
                                            <p className="font-semibold">{selectedPatient.full_name}</p>
                                        ) : (
                                            <p className="italic text-muted-foreground/60">No seleccionado</p>
                                        )}
                                    </div>
                                    <Separator />
                                    <div>
                                        <p className="text-muted-foreground mb-1">Exámenes</p>
                                        {selectedTests.length === 0 ? (
                                            <p className="italic text-muted-foreground/60">Ninguno añadido</p>
                                        ) : (
                                            <ul className="space-y-1">
                                                {selectedTests.map((t) => (
                                                    <li key={t.id} className="flex items-center gap-2 text-xs">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                                                        {t.name}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>

                                <Button
                                    id="btn-create-order"
                                    className="w-full h-11 gap-2 mt-2"
                                    disabled={!selectedPatient || selectedTests.length === 0 || isPending}
                                    onClick={() => createOrder()}
                                >
                                    {isPending ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" /> Creando...
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="h-4 w-4" /> Crear Orden
                                        </>
                                    )}
                                </Button>

                                {(!selectedPatient || selectedTests.length === 0) && (
                                    <p className="text-xs text-center text-muted-foreground">
                                        {!selectedPatient
                                            ? "Selecciona un paciente para continuar"
                                            : "Agrega al menos un examen"}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </AdminLayout>
    )
}
