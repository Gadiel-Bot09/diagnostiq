import React from "react"
import { SuperAdminSidebar } from "@/components/layout/SuperAdminSidebar"

export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-screen bg-slate-900 overflow-hidden">
            <SuperAdminSidebar />
            <main className="flex-1 overflow-y-auto bg-slate-50">
                <div className="p-8">
                    {children}
                </div>
            </main>
        </div>
    )
}
