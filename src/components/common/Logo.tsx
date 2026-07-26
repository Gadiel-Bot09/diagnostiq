"use client"

import React from "react"
import { cn } from "@/lib/utils"

interface LogoIconProps {
    className?: string
    size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"
    animate?: boolean
}

const iconSizes = {
    xs: "h-6 w-6",
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-11 w-11",
    xl: "h-14 w-14",
    "2xl": "h-20 w-20",
    "3xl": "h-28 w-28",
}

export function LogoIcon({ className, size = "md", animate = true }: LogoIconProps) {
    const sizeClass = iconSizes[size] || iconSizes.md

    return (
        <div className={cn("relative inline-flex items-center justify-center shrink-0 group", sizeClass, className)}>
            {/* Subtle glow aura behind symbol on hover */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-indigo-500/20 via-primary/20 to-emerald-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-md" />

            <svg
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full relative z-10 transform transition-transform duration-300 group-hover:scale-105"
            >
                <defs>
                    <linearGradient id="dq-comp-main" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#4F46E5" />
                        <stop offset="50%" stopColor="#3B82F6" />
                        <stop offset="100%" stopColor="#06B6D4" />
                    </linearGradient>
                    <linearGradient id="dq-comp-pulse" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#06B6D4" />
                        <stop offset="50%" stopColor="#10B981" />
                        <stop offset="100%" stopColor="#34D399" />
                    </linearGradient>
                    <filter id="dq-comp-glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>

                {/* Background Squircle */}
                <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#dq-comp-main)" fillOpacity="0.08" />
                <rect x="6" y="6" width="88" height="88" rx="22" stroke="url(#dq-comp-main)" strokeOpacity="0.15" strokeWidth="1" />

                {/* Q Main Loop */}
                <path
                    d="M 72 44 A 28 28 0 1 0 63.8 63.8"
                    stroke="url(#dq-comp-main)"
                    strokeWidth="7.5"
                    strokeLinecap="round"
                    fill="none"
                />

                {/* Q Diagonal Tail */}
                <path
                    d="M 52 52 L 82 82"
                    stroke="url(#dq-comp-main)"
                    strokeWidth="8.5"
                    strokeLinecap="round"
                />

                {/* EKG Diagnostic Pulse Wave */}
                <path
                    d="M 24 44 L 33 44 L 39 28 L 47 62 L 55 36 L 61 44 L 68 44"
                    stroke="url(#dq-comp-pulse)"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#dq-comp-glow)"
                    className={cn(animate && "animate-pulse")}
                    style={{ animationDuration: "3s" }}
                />

                {/* Precision Dots */}
                <circle cx="39" cy="28" r="2.5" fill="#10B981" />
                <circle cx="82" cy="82" r="3.5" fill="#06B6D4" filter="url(#dq-comp-glow)" />
            </svg>
        </div>
    )
}

interface LogoProps {
    className?: string
    size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"
    variant?: "default" | "light" | "dark" | "gradient"
    showTagline?: boolean
    subtitle?: string
    animate?: boolean
}

const textSizes = {
    xs: "text-base",
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
    xl: "text-3xl",
    "2xl": "text-4xl",
    "3xl": "text-5xl",
}

const subtitleSizes = {
    xs: "text-[9px] tracking-wider",
    sm: "text-[10px] tracking-widest",
    md: "text-xs tracking-widest",
    lg: "text-sm tracking-widest",
    xl: "text-base tracking-widest",
    "2xl": "text-lg tracking-widest",
    "3xl": "text-xl tracking-widest",
}

export function Logo({
    className,
    size = "md",
    variant = "default",
    showTagline = false,
    subtitle,
    animate = true,
}: LogoProps) {
    const titleSize = textSizes[size] || textSizes.md
    const subSize = subtitleSizes[size] || subtitleSizes.md

    const textColorClass =
        variant === "light"
            ? "text-white"
            : variant === "dark"
            ? "text-slate-900"
            : "text-foreground dark:text-white"

    const subColorClass =
        variant === "light"
            ? "text-slate-300"
            : variant === "dark"
            ? "text-slate-600"
            : "text-muted-foreground"

    return (
        <div className={cn("inline-flex items-center gap-3 select-none group", className)}>
            <LogoIcon size={size} animate={animate} />

            <div className="flex flex-col justify-center">
                <div className={cn("font-extrabold tracking-tight flex items-baseline leading-none", titleSize)}>
                    <span className={cn("transition-colors duration-300", textColorClass)}>Diagnosti</span>
                    <span className="bg-gradient-to-r from-indigo-600 via-primary to-emerald-500 bg-clip-text text-transparent font-black">
                        Q
                    </span>
                </div>

                {(showTagline || subtitle) && (
                    <span
                        className={cn(
                            "font-bold uppercase mt-1 transition-colors duration-300",
                            subSize,
                            subColorClass
                        )}
                    >
                        {subtitle || "Laboratorio & Diagnóstico Digital"}
                    </span>
                )}
            </div>
        </div>
    )
}
