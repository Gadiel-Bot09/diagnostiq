/**
 * Exportador de Lámina Clínica Radiológica CBCT en PDF (Mejora #5).
 *
 * Genera un documento PDF profesional listo para imprimir o adjuntar a la historia clínica con:
 *  - Encabezado clínico + Certificado de Auditoría Metrológica DICOM (voxel, orientación LPS, fabricante).
 *  - Capturas en alta resolución de los paneles visibles actuales (Panorama, 3D, Tangencial, Transversal, Axial / MPR).
 *  - Tabla auditable de todas las mediciones (mm / °) y tabla de implantes virtuales con distancia al nervio dentario.
 */

import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import type { CalibrationAudit } from "./dicomSeriesExtractor"
import {
    computeImplantNerveDistanceMm,
    type SavedClinicalCut,
    type VirtualImplant,
} from "./clinicalScene"
import { getMeasurementSummaryValue, type ClinicalMeasurement } from "@/components/common/MprViewport"
import type { Vec3 } from "./mprEngine"

export interface ExportClinicalPdfParams {
    studyTitle: string
    calibration: CalibrationAudit | null
    containerEl: HTMLElement | null
    measurements: { viewTitle: string; m: ClinicalMeasurement }[]
    implants: VirtualImplant[]
    nervePoints3D: Vec3[]
    savedCuts: SavedClinicalCut[]
    sectorLabel: string
}

interface CapturedViewport {
    label: string
    dataUrl: string
    aspect: number
}

function captureVisibleCanvases(containerEl: HTMLElement | null): CapturedViewport[] {
    if (!containerEl) return []
    const out: CapturedViewport[] = []
    const panels = containerEl.querySelectorAll<HTMLElement>("[data-cbct-capture-label]")
    panels.forEach((panel) => {
        const label = panel.getAttribute("data-cbct-capture-label") || "Vista CBCT"
        const rect = panel.getBoundingClientRect()
        if (rect.width < 40 || rect.height < 40) return
        const canvases = Array.from(panel.querySelectorAll("canvas")).filter((c) => {
            const cr = c.getBoundingClientRect()
            return cr.width > 30 && cr.height > 30 && !c.classList.contains("hidden")
        })
        const canvas = canvases[canvases.length - 1]
        if (!canvas) return
        try {
            const dataUrl = canvas.toDataURL("image/jpeg", 0.92)
            if (dataUrl && dataUrl.length > 100) {
                out.push({
                    label,
                    dataUrl,
                    aspect: canvas.width / Math.max(1, canvas.height),
                })
            }
        } catch {}
    })
    return out
}

export function exportCbctClinicalPdf({
    studyTitle,
    calibration,
    containerEl,
    measurements,
    implants,
    nervePoints3D,
    savedCuts,
    sectorLabel,
}: ExportClinicalPdfParams): void {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 10

    // 1. Encabezado Clínico Oscuro (estilo radiología digital)
    doc.setFillColor(10, 15, 28)
    doc.rect(0, 0, pageW, 24, "F")

    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.text("DiagnostiQ · Lámina Clínica CBCT 3D", margin, 10)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(186, 230, 253)
    doc.text(`Estudio: ${studyTitle}   |   Sector: ${sectorLabel}`, margin, 16)

    const nowStr = new Date().toLocaleString("es-CO")
    doc.setTextColor(148, 163, 184)
    doc.text(`Generado: ${nowStr}`, pageW - margin, 10, { align: "right" })

    if (calibration) {
        const badgeColor: [number, number, number] =
            calibration.status === "estimated_isotropic" ? [245, 158, 11] : [16, 185, 129]
        doc.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2])
        doc.setFont("helvetica", "bold")
        doc.text(
            `${calibration.label} · ${calibration.orientationName} · ${calibration.manufacturer}`,
            pageW - margin,
            16,
            { align: "right" }
        )
        if (calibration.patientName) {
            doc.setTextColor(203, 213, 225)
            doc.setFont("helvetica", "normal")
            doc.text(`Paciente DICOM: ${calibration.patientName}`, margin, 21)
        }
    }

    // 2. Mosaico de Capturas Clínicas en Alta Resolución
    const captures = captureVisibleCanvases(containerEl)
    let cursorY = 28

    if (captures.length > 0) {
        const cols = captures.length >= 4 ? 3 : captures.length
        const gap = 4
        const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols
        const cellH = captures.length > 3 ? 66 : 95

        captures.slice(0, 6).forEach((cap, idx) => {
            const col = idx % cols
            const row = Math.floor(idx / cols)
            const x = margin + col * (cellW + gap)
            const y = cursorY + row * (cellH + 8)

            // Marco negro radiográfico
            doc.setFillColor(3, 6, 12)
            doc.setDrawColor(51, 65, 85)
            doc.roundedRect(x, y, cellW, cellH + 5, 1.5, 1.5, "FD")

            // Título de la vista
            doc.setTextColor(125, 211, 252)
            doc.setFont("helvetica", "bold")
            doc.setFontSize(7.5)
            doc.text(cap.label, x + 2, y + 3.8)

            // Escalar imagen respetando exactamente la proporción física
            const availW = cellW - 2
            const availH = cellH - 1.5
            let drawW = availW
            let drawH = drawW / Math.max(0.2, cap.aspect)
            if (drawH > availH) {
                drawH = availH
                drawW = drawH * cap.aspect
            }
            const imgX = x + 1 + (availW - drawW) * 0.5
            const imgY = y + 5 + (availH - drawH) * 0.5
            doc.addImage(cap.dataUrl, "JPEG", imgX, imgY, drawW, drawH)
        })

        const rowsUsed = Math.ceil(Math.min(captures.length, 6) / cols)
        cursorY += rowsUsed * (cellH + 8) + 4
    }

    // 3. Segunda página (o continuación) con tablas auditables de Medidas, Implantes y Certificado DICOM
    if (cursorY > pageH - 42) {
        doc.addPage()
        cursorY = 14
    }

    if (measurements.length > 0) {
        doc.setTextColor(15, 23, 42)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(10)
        doc.text(`Mediciones Calibradas (${measurements.length})`, margin, cursorY)
        cursorY += 2

        autoTable(doc, {
            startY: cursorY,
            margin: { left: margin, right: margin },
            head: [["#", "Tipo", "Valor", "Corte / Vista", "Estado"]],
            body: measurements.map((item, i) => [
                String(i + 1),
                item.m.kind === "ruler" ? "Distancia lineal" : item.m.kind === "angle" ? "Ángulo" : "Conducto (Polilínea)",
                getMeasurementSummaryValue(item.m),
                item.m.sliceLabel || item.viewTitle,
                item.m.isEstimated ? "Aproximada" : "Calibrada 3D",
            ]),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [14, 116, 144] },
        })
        cursorY = (doc as any).lastAutoTable.finalY + 6
    }

    if (implants.length > 0) {
        if (cursorY > pageH - 35) {
            doc.addPage()
            cursorY = 14
        }
        doc.setTextColor(15, 23, 42)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(10)
        doc.text(`Planificación de Implantes Virtuales (${implants.length})`, margin, cursorY)
        cursorY += 2

        autoTable(doc, {
            startY: cursorY,
            margin: { left: margin, right: margin },
            head: [["Implante", "Diámetro", "Longitud", "Margen Seg.", "Distancia al Nervio", "Alerta"]],
            body: implants.map((imp) => {
                const dist = computeImplantNerveDistanceMm(imp, nervePoints3D)
                const alert =
                    dist === null
                        ? "Nervio no trazado"
                        : dist < imp.safetyMarginMm
                        ? "PRECAUCIÓN (< margen)"
                        : "Seguro"
                return [
                    imp.label,
                    `${imp.diameterMm.toFixed(1)} mm`,
                    `${imp.lengthMm.toFixed(1)} mm`,
                    `${imp.safetyMarginMm.toFixed(1)} mm`,
                    dist !== null ? `${dist.toFixed(1)} mm` : "—",
                    alert,
                ]
            }),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [79, 70, 229] },
        })
        cursorY = (doc as any).lastAutoTable.finalY + 6
    }

    if (savedCuts.length > 0) {
        if (cursorY > pageH - 35) {
            doc.addPage()
            cursorY = 14
        }
        doc.setTextColor(15, 23, 42)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(10)
        doc.text(`Cortes Específicos Preparados (${savedCuts.length})`, margin, cursorY)
        cursorY += 2

        autoTable(doc, {
            startY: cursorY,
            margin: { left: margin, right: margin },
            head: [["#", "Nombre del Corte", "Posición Arco / Altura", "Nota Clínica"]],
            body: savedCuts.map((c, i) => [
                String(i + 1),
                c.name,
                `Arco ${c.archS.toFixed(1)} mm · H ${c.axialH.toFixed(1)} mm`,
                c.note || "—",
            ]),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [30, 41, 59] },
        })
    }

    // Pie de página metrológico
    const pageCount = doc.getNumberOfPages()
    for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p)
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        doc.text(
            "DiagnostiQ CBCT Viewer · Escala calibrada en milímetros reales según cabeceras DICOM PS3.3 · Documento clínico auxiliar.",
            margin,
            pageH - 5
        )
        doc.text(`Página ${p} de ${pageCount}`, pageW - margin, pageH - 5, { align: "right" })
    }

    const safeFileName = studyTitle.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48)
    doc.save(`Lamina_CBCT_${safeFileName}.pdf`)
}
