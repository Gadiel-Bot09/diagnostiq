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
    UploadCloud
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const sidebarItems = [
    { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
    { name: "Pacientes", href: "/app/patients", icon: Users },
    { name: "Órdenes", href: "/app/orders", icon: FileText },
    { name: "Resultados Directos", href: "/app/direct-results", icon: UploadCloud },
    { name: "Catálogo", href: "/app/catalog", icon: TestTube2 },
    { name: "Usuarios", href: "/app/users", icon: Settings },
    { name: "Auditoría", href: "/app/audit", icon: History },
]

export function AdminSidebar() {
    const pathname = usePathname()

    return (
        <div className="flex h-screen w-64 flex-col border-r bg-card shadow-sm">
            <div className="flex h-16 items-center px-6">
                <Link href="/app/dashboard" className="flex items-center gap-2 font-bold text-primary text-xl">
                    <Microscope className="h-6 w-6" />
                    <span>DiagnostiQ</span>
                </Link>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {sidebarItems.map((item) => {
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
                })}
            </div>

            <div className="p-4 border-t">
                <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-6 text-destructive hover:text-destructive hover:bg-destructive/10">
                    <LogOut className="h-5 w-5" />
                    <span>Cerrar Sesión</span>
                </Button>
            </div>
        </div>
    )
}
