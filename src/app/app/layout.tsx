"use client"

import { PermissionsProvider } from "@/contexts/PermissionsContext"

export default function AppLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <PermissionsProvider>
            {children}
        </PermissionsProvider>
    )
}
