import { format } from "date-fns"

export interface ReportSheet {
    /** Nombre de la hoja / título de la sección */
    name: string
    columns: string[]
    rows: (string | number)[][]
}

export interface ReportData {
    title: string
    period: string
    labName?: string
    sheets: ReportSheet[]
}

const BRAND_INDIGO = "4F46E5"

function fileStamp() {
    return format(new Date(), "yyyy-MM-dd_HHmm")
}

function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

/** Excel real (.xlsx) con encabezados de marca, filtros y columnas ajustadas. */
export async function exportReportXlsx(data: ReportData, fileBase: string) {
    const ExcelJS = (await import("exceljs")).default
    const wb = new ExcelJS.Workbook()
    wb.creator = "DiagnostiQ"
    wb.created = new Date()

    data.sheets.forEach((sheet) => {
        // Excel limita el nombre de hoja a 31 caracteres y prohíbe algunos símbolos
        const safeName = sheet.name.replace(/[\\/?*[\]:]/g, "-").slice(0, 31)
        const ws = wb.addWorksheet(safeName)
        const colCount = Math.max(sheet.columns.length, 1)

        ws.mergeCells(1, 1, 1, colCount)
        const t = ws.getCell(1, 1)
        t.value = `${data.title} — ${sheet.name}`
        t.font = { bold: true, size: 14, color: { argb: "FF" + BRAND_INDIGO } }

        ws.mergeCells(2, 1, 2, colCount)
        ws.getCell(2, 1).value = `${data.labName ? data.labName + " · " : ""}Período: ${data.period} · Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}`
        ws.getCell(2, 1).font = { italic: true, color: { argb: "FF64748B" } }

        const header = ws.getRow(4)
        sheet.columns.forEach((c, i) => {
            const cell = header.getCell(i + 1)
            cell.value = c
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND_INDIGO } }
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
        })
        header.height = 22

        sheet.rows.forEach((r, ri) => {
            const row = ws.getRow(5 + ri)
            r.forEach((v, ci) => {
                const cell = row.getCell(ci + 1)
                cell.value = v
                if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FF" } }
                cell.border = { bottom: { style: "hair", color: { argb: "FFCBD5E1" } } }
            })
        })

        sheet.columns.forEach((c, i) => {
            const maxLen = Math.max(c.length, ...sheet.rows.map((r) => String(r[i] ?? "").length))
            ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 12), 50)
        })
        ws.views = [{ state: "frozen", ySplit: 4 }]
        if (sheet.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + sheet.rows.length, column: colCount } }
    })

    const buffer = await wb.xlsx.writeBuffer()
    download(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${fileBase}_${fileStamp()}.xlsx`
    )
}

/** PDF real descargable con tablas de resumen y detalle. */
export async function exportReportPdf(data: ReportData, fileBase: string) {
    const { jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
    const pageWidth = doc.internal.pageSize.getWidth()

    const drawHeader = () => {
        doc.setFillColor(79, 70, 229)
        doc.rect(0, 0, pageWidth, 6, "F")
        doc.setFont("helvetica", "bold")
        doc.setFontSize(16)
        doc.setTextColor(15, 23, 42)
        doc.text("DiagnostiQ", 40, 36)
        doc.setFontSize(11)
        doc.setTextColor(79, 70, 229)
        doc.text(data.title, 40, 54)
        doc.setFont("helvetica", "normal")
        doc.setFontSize(9)
        doc.setTextColor(100, 116, 139)
        doc.text(
            `${data.labName ? data.labName + " · " : ""}Período: ${data.period} · Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}`,
            pageWidth - 40, 36, { align: "right" }
        )
    }
    drawHeader()

    let startY = 72
    data.sheets.forEach((sheet, idx) => {
        if (idx > 0 && startY > doc.internal.pageSize.getHeight() - 140) {
            doc.addPage()
            drawHeader()
            startY = 72
        }
        doc.setFont("helvetica", "bold")
        doc.setFontSize(11)
        doc.setTextColor(15, 23, 42)
        doc.text(sheet.name, 40, startY + 8)

        autoTable(doc, {
            startY: startY + 16,
            head: [sheet.columns],
            body: sheet.rows.length ? sheet.rows.map((r) => r.map((v) => String(v ?? ""))) : [["Sin datos para el período seleccionado"]],
            styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
            headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 247, 255] },
            margin: { left: 40, right: 40, top: 72 },
            didDrawPage: () => drawHeader(),
        })
        startY = ((doc as any).lastAutoTable?.finalY ?? startY) + 28
    })

    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(148, 163, 184)
        doc.text(`Página ${i} de ${pages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" })
    }

    doc.save(`${fileBase}_${fileStamp()}.pdf`)
}
