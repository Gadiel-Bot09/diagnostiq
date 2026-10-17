"use client"

import React from "react"
import { Logo } from "@/components/common/Logo"
import { FileCheck2, ShieldCheck, Zap, Leaf, Activity, FlaskConical, Bell } from "lucide-react"

interface AuthShellProps {
    children: React.ReactNode
    headline: string
    highlight: string
    description: string
    features?: { icon: React.ReactNode; text: string }[]
}

const DEFAULT_FEATURES = [
    { icon: <Zap className="h-4 w-4" />, text: "Resultados disponibles al instante, sin esperas" },
    { icon: <Leaf className="h-4 w-4" />, text: "Cero papel, cero correos y cero WhatsApp sueltos" },
    { icon: <ShieldCheck className="h-4 w-4" />, text: "Datos protegidos con cifrado de grado médico" },
]

/** Ilustración: tarjeta de resultado con pulso EKG y elementos flotantes */
function Illustration() {
    return (
        <div className="relative mx-auto h-72 w-full max-w-sm">
            {/* halo */}
            <div className="absolute inset-6 rounded-full bg-cyan-300/20 blur-3xl" />

            {/* tarjeta principal */}
            <div className="dq-float absolute left-1/2 top-4 w-64 -translate-x-1/2 rounded-3xl border border-white/30 bg-white/95 p-5 shadow-2xl shadow-indigo-900/40">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white">
                        <FileCheck2 className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-900">Resultado listo</p>
                        <p className="text-[11px] text-slate-500">Hemograma completo</p>
                    </div>
                </div>
                <svg viewBox="0 0 220 60" className="mt-4 h-14 w-full" fill="none">
                    <path
                        className="dq-draw"
                        d="M0 32 H55 L68 8 L86 52 L104 18 L118 32 H220"
                        stroke="url(#ekg)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                    <defs>
                        <linearGradient id="ekg" x1="0" x2="1">
                            <stop offset="0" stopColor="#6366F1" />
                            <stop offset="1" stopColor="#10B981" />
                        </linearGradient>
                    </defs>
                </svg>
                <div className="mt-2 flex gap-2">
                    <div className="h-2 flex-1 rounded-full bg-indigo-100"><div className="h-2 w-4/5 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500" /></div>
                    <div className="h-2 flex-1 rounded-full bg-emerald-100"><div className="h-2 w-2/3 rounded-full bg-emerald-500" /></div>
                </div>
            </div>

            {/* notificación flotante */}
            <div className="dq-float-slow absolute -right-1 bottom-10 flex items-center gap-2 rounded-2xl border border-white/30 bg-white/95 px-3 py-2 shadow-xl">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Bell className="h-4 w-4" /></div>
                <div>
                    <p className="text-[11px] font-bold text-slate-900">¡Nuevo resultado!</p>
                    <p className="text-[10px] text-slate-500">Hace un momento</p>
                </div>
            </div>

            {/* insignias */}
            <div className="dq-float-slow absolute -left-2 bottom-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/30 bg-white/90 text-indigo-600 shadow-xl">
                <FlaskConical className="h-7 w-7" />
            </div>
            <div className="dq-float absolute -right-2 top-0 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/30 bg-white/90 text-cyan-600 shadow-xl">
                <Activity className="h-6 w-6" />
            </div>
        </div>
    )
}

export function AuthShell({ children, headline, highlight, description, features = DEFAULT_FEATURES }: AuthShellProps) {
    return (
        <div className="grid min-h-screen lg:grid-cols-2">
            {/* Panel de anuncio */}
            <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-700 via-blue-600 to-cyan-500 p-12 text-white lg:flex lg:flex-col lg:justify-between">
                <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-emerald-300/20 blur-3xl" />
                <div
                    className="pointer-events-none absolute inset-0 opacity-[0.07]"
                    style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "26px 26px" }}
                />

                <div className="relative dq-fade">
                    <Logo size="lg" variant="light" showTagline />
                </div>

                <div className="relative space-y-8">
                    <div className="space-y-4 dq-rise">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> Laboratorio digital
                        </span>
                        <h2 className="text-4xl font-extrabold leading-tight tracking-tight xl:text-5xl">
                            {headline}{" "}
                            <span className="bg-gradient-to-r from-cyan-200 to-emerald-200 bg-clip-text text-transparent">{highlight}</span>
                        </h2>
                        <p className="max-w-md text-base text-indigo-50/90">{description}</p>
                    </div>

                    <Illustration />

                    <ul className="space-y-2.5">
                        {features.map((f, i) => (
                            <li key={i} className="dq-rise flex items-center gap-3 text-sm text-indigo-50" style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur">{f.icon}</span>
                                {f.text}
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="relative text-xs text-indigo-100/70">© {new Date().getFullYear()} DiagnostiQ · Diagnóstico digital y seguro</p>
            </aside>

            {/* Formulario */}
            <main className="relative flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/60 to-cyan-50 p-6">
                <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-indigo-200/40 blur-3xl lg:hidden" />
                <div className="relative w-full max-w-md space-y-6 dq-rise">
                    <div className="flex justify-center lg:hidden">
                        <Logo size="xl" showTagline />
                    </div>
                    {children}
                </div>
            </main>
        </div>
    )
}
