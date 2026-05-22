"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useRouter } from "next/navigation"
import {
    LayoutDashboard,
    Building2,
    Users,
    BarChart3,
    Shield,
    LogOut,
    ChevronRight,
    Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"

const navItems = [
    {
        label: "General",
        items: [
            { name: "Dashboard", href: "/superadmin/dashboard", icon: LayoutDashboard },
        ]
    },
    {
        label: "Gestión",
        items: [
            { name: "Laboratorios", href: "/superadmin/labs", icon: Building2 },
            { name: "Usuarios", href: "/superadmin/users", icon: Users },
        ]
    },
    {
        label: "Sistema",
        items: [
            { name: "Reportes", href: "/superadmin/reports", icon: BarChart3 },
            { name: "Seguridad", href: "/superadmin/security", icon: Shield },
        ]
    },
]

export function SuperAdminSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const supabase = createClient()

    async function handleSignOut() {
        await supabase.auth.signOut()
        router.push("/app/login")
    }

    return (
        <div className="flex h-screen w-64 flex-col bg-slate-950 text-slate-100 border-r border-slate-800 shadow-2xl shrink-0">
            {/* Logo / Brand */}
            <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg">
                    <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                    <p className="text-sm font-bold text-white tracking-wide">DiagnostiQ</p>
                    <p className="text-[10px] text-violet-400 font-semibold uppercase tracking-widest">Super Admin</p>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
                {navItems.map((group) => (
                    <div key={group.label}>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 px-3 mb-2">
                            {group.label}
                        </p>
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const isActive = pathname.startsWith(item.href)
                                return (
                                    <Link
                                        key={item.name}
                                        href={item.href}
                                        className={cn(
                                            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group",
                                            isActive
                                                ? "bg-violet-600/20 text-violet-300 font-medium border border-violet-500/30"
                                                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                                        )}
                                    >
                                        <item.icon className={cn(
                                            "h-4 w-4 shrink-0",
                                            isActive ? "text-violet-400" : "text-slate-500 group-hover:text-slate-300"
                                        )} />
                                        <span className="flex-1">{item.name}</span>
                                        {isActive && <ChevronRight className="h-3.5 w-3.5 text-violet-400" />}
                                    </Link>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Footer */}
            <div className="p-3 border-t border-slate-800">
                <button
                    onClick={handleSignOut}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150"
                >
                    <LogOut className="h-4 w-4" />
                    <span>Cerrar Sesión</span>
                </button>
            </div>
        </div>
    )
}
