"use client"

import React from "react"
import { Check, Sparkles } from "lucide-react"
import { Logo } from "@/components/common/Logo"

interface WelcomeOverlayProps {
    name?: string | null
    subtitle: string
}

const CONFETTI_COLORS = ["#6366F1", "#3B82F6", "#06B6D4", "#10B981", "#34D399", "#A5B4FC"]

function greeting() {
    const h = new Date().getHours()
    if (h < 12) return "¡Buenos días"
    if (h < 19) return "¡Buenas tardes"
    return "¡Buenas noches"
}

export function WelcomeOverlay({ name, subtitle }: WelcomeOverlayProps) {
    const firstName = (name || "").trim().split(/\s+/)[0]
    const pieces = React.useMemo(
        () => Array.from({ length: 28 }, (_, i) => ({
            left: `${(i * 37) % 100}%`,
            delay: `${(i % 9) * 0.28}s`,
            duration: `${2.6 + (i % 5) * 0.4}s`,
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            size: 6 + (i % 4) * 3,
            round: i % 3 === 0,
        })),
        []
    )

    return (
        <div className="dq-fade fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-700 via-blue-600 to-cyan-500">
            <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-emerald-300/25 blur-3xl" />

            {pieces.map((p, i) => (
                <span
                    key={i}
                    className="dq-confetti pointer-events-none absolute top-0"
                    style={{
                        left: p.left, width: p.size, height: p.size, background: p.color,
                        borderRadius: p.round ? "9999px" : "2px",
                        animationDelay: p.delay, animationDuration: p.duration,
                    }}
                />
            ))}

            <div className="relative mx-4 w-full max-w-md rounded-3xl border border-white/30 bg-white/95 p-10 text-center shadow-2xl shadow-indigo-900/40 dq-pop">
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-500/40 dq-pop" style={{ animationDelay: ".15s" }}>
                    <Check className="h-10 w-10" strokeWidth={3} />
                </div>
                <p className="dq-rise text-sm font-semibold uppercase tracking-widest text-indigo-500" style={{ animationDelay: ".3s" }}>
                    <Sparkles className="mr-1.5 inline h-4 w-4" /> Acceso exitoso
                </p>
                <h1 className="dq-rise mt-2 text-3xl font-extrabold tracking-tight text-slate-900" style={{ animationDelay: ".4s" }}>
                    {greeting()}
                    {firstName ? <>, <span className="bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text text-transparent">{firstName}</span></> : ""}!
                </h1>
                <p className="dq-rise mt-3 text-sm text-slate-600" style={{ animationDelay: ".55s" }}>{subtitle}</p>

                <div className="dq-rise mt-6 flex flex-col items-center gap-4" style={{ animationDelay: ".7s" }}>
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-indigo-100">
                        <div className="h-full w-full origin-left animate-pulse rounded-full bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400" />
                    </div>
                    <Logo size="sm" />
                </div>
            </div>
        </div>
    )
}
