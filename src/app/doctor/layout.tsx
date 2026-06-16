import type { ReactNode } from "react"
import { DoctorHeader } from "@/components/doctor/DoctorHeader"

export default function DoctorLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-cyan-50/20">
            <DoctorHeader />
            <main className="max-w-4xl mx-auto px-4 py-8">
                {children}
            </main>
        </div>
    )
}
