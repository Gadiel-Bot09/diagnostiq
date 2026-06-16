"use client"

import { AdminSidebar } from "./AdminSidebar"
import { usePermissions } from "@/contexts/PermissionsContext"
import { Skeleton } from "@/components/ui/skeleton"

import { usePathname } from "next/navigation"

export function AdminLayout({ children }: { children: React.ReactNode }) {
    const { profile, lab, isLoading, hasPermission } = usePermissions()
    const pathname = usePathname()

    // Determine the required module for the current route
    let requiredModule = ""
    if (pathname.startsWith("/app/patients")) requiredModule = "patients"
    else if (pathname.startsWith("/app/orders")) requiredModule = "orders"
    else if (pathname.startsWith("/app/direct-results")) requiredModule = "results"
    else if (pathname.startsWith("/app/catalog")) requiredModule = "settings"
    else if (pathname.startsWith("/app/users")) requiredModule = "staff"
    else if (pathname.startsWith("/app/audit")) requiredModule = "audit"

    const isAuthorized = isLoading || requiredModule === "" || hasPermission(requiredModule, "view")

    return (
        <div className="flex bg-background min-h-screen">
            <AdminSidebar />
            <main className="flex-1 overflow-auto">
                <header className="h-16 border-b bg-card flex items-center justify-between px-8">
                    <h2 className="text-lg font-semibold text-muted-foreground italic">Panel de Control</h2>
                    <div className="flex items-center gap-2">
                        {isLoading ? (
                            <Skeleton className="h-5 w-40" />
                        ) : (
                            <span className="text-sm font-semibold text-primary">
                                {lab?.name || "Laboratorio Central"}
                            </span>
                        )}
                        {!isLoading && profile && (
                            <div className="flex items-center gap-3 border-l pl-3 ml-1 border-muted">
                                <span className="text-sm text-muted-foreground font-medium">
                                    {profile.full_name}
                                </span>
                                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold uppercase">
                                    {profile.full_name.substring(0, 2)}
                                </div>
                            </div>
                        )}
                    </div>
                </header>
                <div className="p-8 max-w-7xl mx-auto">
                    {isAuthorized ? children : (
                        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                            <h1 className="text-3xl font-bold text-destructive mb-2">Acceso Denegado</h1>
                            <p className="text-muted-foreground max-w-md">
                                No tienes los permisos necesarios para acceder a este módulo. Contacta a un administrador.
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
