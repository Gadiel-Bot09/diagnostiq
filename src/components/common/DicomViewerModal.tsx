"use client"

import dynamic from "next/dynamic"
import type { DicomViewerModalProps } from "./DicomViewerModalImpl"

export type { DicomViewerModalProps }

/**
 * Visor Web Universal de Tomografías 3D (DICOM).
 * Cargado dinámicamente con ssr: false para garantizar compatibilidad con WebGL y WebAssembly.
 */
export const DicomViewerModal = dynamic<DicomViewerModalProps>(
    () => import("./DicomViewerModalImpl").then((m) => m.DicomViewerModalImpl),
    {
        ssr: false,
    }
)
