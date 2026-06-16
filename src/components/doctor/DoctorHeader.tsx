"use client"

import Link from "next/link"
import { LogOut, Stethoscope } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function DoctorHeader() {
    const supabase = createClient()

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        window.location.href = "/app/login"
    }

    return (
        <header className="bg-white border-b sticky top-0 z-50">
            <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
                <Link href="/doctor" className="flex items-center gap-2 text-teal-700">
                    <div className="bg-teal-100 p-1.5 rounded-lg">
                        <Stethoscope className="h-5 w-5" />
                    </div>
                    <span className="font-bold text-xl tracking-tight">DiagnostiQ</span>
                    <span className="text-sm font-medium text-teal-600/80 hidden sm:inline-block ml-2">— Portal Médico</span>
                </Link>

                <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-red-600 gap-2">
                    <LogOut className="h-4 w-4" />
                    <span className="hidden sm:inline">Cerrar Sesión</span>
                </Button>
            </div>
        </header>
    )
}
