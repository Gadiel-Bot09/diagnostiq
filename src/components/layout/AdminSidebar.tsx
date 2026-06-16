"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    History,
    LayoutDashboard,
    Settings,
    TestTube2,
    Users,
    FileText,
    LogOut,
    Microscope,
    UploadCloud,
    Lock
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { usePermissions } from "@/contexts/PermissionsContext"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"

const sidebarItems = [
    { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard, module: "dashboard" },
    { name: "Pacientes", href: "/app/patients", icon: Users, module: "patients" },
    { name: "Órdenes", href: "/app/orders", icon: FileText, module: "orders" },
    { name: "Resultados Directos", href: "/app/direct-results", icon: UploadCloud, module: "results" },
    { name: "Catálogo", href: "/app/catalog", icon: TestTube2, module: "settings" }, // Reusing settings or catalog module
    { name: "Usuarios", href: "/app/users", icon: Settings, module: "staff" },
    { name: "Auditoría", href: "/app/audit", icon: History, module: "audit" },
]

import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal"

export function AdminSidebar() {
    const pathname = usePathname()
    const { hasPermission, isLoading } = usePermissions()

    // Filter items based on permissions
    const visibleItems = sidebarItems.filter(item => {
        if (item.module === "dashboard") return true // Dashboard is always visible
        return hasPermission(item.module, "view")
    })

    const handleSignOut = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        window.location.href = "/login"
    }

    return (
        <div className="flex h-screen w-64 flex-col border-r bg-card shadow-sm">
            <div className="flex h-16 items-center px-6">
                <Link href="/app/dashboard" className="flex items-center gap-2 font-bold text-primary text-xl">
                    <Microscope className="h-6 w-6" />
                    <span>DiagnostiQ</span>
                </Link>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map(i => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                ) : (
                    visibleItems.map((item) => {
                        const isActive = pathname.startsWith(item.href)
                        return (
                            <Link key={item.name} href={item.href}>
                                <Button
                                    variant={isActive ? "secondary" : "ghost"}
                                    className={cn(
                                        "w-full justify-start gap-3 px-3 py-6",
                                        isActive ? "bg-secondary text-primary font-medium" : "text-muted-foreground"
                                    )}
                                >
                                    <item.icon className={cn("h-5 w-5", isActive ? "text-primary" : "text-muted-foreground")} />
                                    {item.name}
                                </Button>
                            </Link>
                        )
                    })
                )}
            </div>

            <div className="p-4 border-t space-y-2">
                <ChangePasswordModal>
                    <Button 
                        variant="ghost" 
                        className="w-full justify-start gap-3 px-3 py-6 text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                        <Lock className="h-5 w-5" />
                        <span>Cambiar Contraseña</span>
                    </Button>
                </ChangePasswordModal>
                <Button 
                    variant="ghost" 
                    className="w-full justify-start gap-3 px-3 py-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={handleSignOut}
                >
                    <LogOut className="h-5 w-5" />
                    <span>Cerrar Sesión</span>
                </Button>
            </div>
        </div>
    )
}
