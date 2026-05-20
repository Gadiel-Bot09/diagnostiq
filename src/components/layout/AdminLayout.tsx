import { AdminSidebar } from "./AdminSidebar"

export function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex bg-background min-h-screen">
            <AdminSidebar />
            <main className="flex-1 overflow-auto">
                <header className="h-16 border-b bg-card flex items-center justify-between px-8">
                    <h2 className="text-lg font-semibold text-muted-foreground italic">Panel de Control</h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm font-medium">Laboratorio Central</span>
                    </div>
                </header>
                <div className="p-8 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    )
}
