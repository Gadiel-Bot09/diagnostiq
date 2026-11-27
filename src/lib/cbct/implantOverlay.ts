/**
 * Proyección y dibujo calibrado de Implantes Dentales Virtuales 3D sobre cualquier corte MPR o Panorámica CPR.
 * Incluye zona de seguridad periapical (2.0 mm) y alerta visual roja automática si invade la proximidad al Nervio Dentario.
 */

import {
    hFromZ,
    projectToArch,
    projectWorldPointToPlane,
    type ArchModel,
    type ClinicalVolume,
    type PlaneSpec,
    type Vec3,
} from "./mprEngine"
import { computeImplantNerveDistanceMm, type VirtualImplant } from "./clinicalScene"

/** Dibuja todos los implantes virtuales que intersectan (o están cerca de) un plano MPR recto */
export function drawImplantsOnPlane(
    ctx: CanvasRenderingContext2D,
    mmToScreen: (xMm: number, yMm: number) => [number, number],
    scalePxPerMm: number,
    spec: PlaneSpec | null | undefined,
    implants: VirtualImplant[],
    nervePoints3D: Vec3[],
    selectedImplantId?: string | null
) {
    if (!spec || implants.length === 0) return

    ctx.save()
    for (const imp of implants) {
        const p0 = imp.platform3D
        const p1: Vec3 = [
            p0[0] + imp.axis3D[0] * imp.lengthMm,
            p0[1] + imp.axis3D[1] * imp.lengthMm,
            p0[2] + imp.axis3D[2] * imp.lengthMm,
        ]
        const proj0 = projectWorldPointToPlane(spec, p0)
        const proj1 = projectWorldPointToPlane(spec, p1)

        // Comprobar si el plano corta el implante (o está dentro del radio + margen de seguridad)
        const minDist = Math.min(proj0.distMm, proj1.distMm)
        const maxReach = imp.diameterMm * 0.5 + imp.safetyMarginMm + 1.5
        if (minDist > maxReach) continue

        const [sx0, sy0] = mmToScreen(proj0.xMm, proj0.yMm)
        const [sx1, sy1] = mmToScreen(proj1.xMm, proj1.yMm)
        const nerveDist = computeImplantNerveDistanceMm(imp, nervePoints3D)
        const isDanger = nerveDist !== null && nerveDist < imp.safetyMarginMm
        const isSelected = imp.id === selectedImplantId

        const bodyColor = isDanger
            ? "rgba(239, 68, 68, 0.36)"
            : isSelected
            ? "rgba(56, 189, 248, 0.38)"
            : "rgba(99, 102, 241, 0.32)"
        const strokeColor = isDanger ? "#f87171" : isSelected ? "#38bdf8" : "#818cf8"
        const haloColor = isDanger ? "rgba(239, 68, 68, 0.85)" : "rgba(56, 189, 248, 0.5)"

        const dx = sx1 - sx0
        const dy = sy1 - sy0
        const lenPx = Math.hypot(dx, dy)
        const radPx = (imp.diameterMm * 0.5) * scalePxPerMm
        const safetyPx = imp.safetyMarginMm * scalePxPerMm

        if (lenPx < 4) {
            // Vista axial (perpendicular al eje del implante -> se proyecta como círculo calibrado)
            ctx.beginPath()
            ctx.arc(sx0, sy0, Math.max(3, radPx), 0, Math.PI * 2)
            ctx.fillStyle = bodyColor
            ctx.fill()
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = isSelected ? 2 : 1.5
            ctx.stroke()

            // Halo de seguridad 2 mm
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.arc(sx0, sy0, Math.max(4, radPx + safetyPx), 0, Math.PI * 2)
            ctx.strokeStyle = haloColor
            ctx.lineWidth = 1.1
            ctx.stroke()
            ctx.setLineDash([])
        } else {
            // Vista longitudinal (Transversal / Tangencial / Sagital / Coronal -> silueta de implante cónico)
            const ux = dx / lenPx
            const uy = dy / lenPx
            const nx = -uy
            const ny = ux
            const apexRadPx = radPx * 0.78

            // Halo de seguridad periapical (margen de 2 mm alrededor del implante)
            ctx.setLineDash([4, 3])
            ctx.strokeStyle = haloColor
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.moveTo(sx0 + nx * (radPx + safetyPx), sy0 + ny * (radPx + safetyPx))
            ctx.lineTo(
                sx1 + ux * safetyPx + nx * (apexRadPx + safetyPx),
                sy1 + uy * safetyPx + ny * (apexRadPx + safetyPx)
            )
            ctx.lineTo(
                sx1 + ux * safetyPx - nx * (apexRadPx + safetyPx),
                sy1 + uy * safetyPx - ny * (apexRadPx + safetyPx)
            )
            ctx.lineTo(sx0 - nx * (radPx + safetyPx), sy0 - ny * (radPx + safetyPx))
            ctx.closePath()
            ctx.stroke()
            ctx.setLineDash([])

            // Cuerpo principal del implante (plataforma coronal -> ápice)
            ctx.beginPath()
            ctx.moveTo(sx0 + nx * radPx, sy0 + ny * radPx)
            ctx.lineTo(sx1 + nx * apexRadPx, sy1 + ny * apexRadPx)
            ctx.lineTo(sx1 - nx * apexRadPx, sy1 - ny * apexRadPx)
            ctx.lineTo(sx0 - nx * radPx, sy0 - ny * radPx)
            ctx.closePath()
            ctx.fillStyle = bodyColor
            ctx.fill()
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = isSelected ? 2 : 1.5
            ctx.stroke()

            // Líneas internas de rosca del implante para lectura visual instantánea
            const threadSteps = Math.max(3, Math.floor(imp.lengthMm / 2))
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = 0.8
            ctx.beginPath()
            for (let t = 1; t < threadSteps; t++) {
                const f = t / threadSteps
                const cx = sx0 + dx * f
                const cy = sy0 + dy * f
                const r = radPx + (apexRadPx - radPx) * f
                ctx.moveTo(cx - nx * r, cy - ny * r)
                ctx.lineTo(cx + nx * r, cy + ny * r)
            }
            ctx.stroke()

            // Etiqueta de diámetro x longitud + alerta de nervio
            const tag =
                isDanger && nerveDist !== null
                    ? `${imp.diameterMm.toFixed(1)}×${imp.lengthMm.toFixed(0)} · ⚠ ${nerveDist.toFixed(1)}mm`
                    : `${imp.diameterMm.toFixed(1)}×${imp.lengthMm.toFixed(0)} mm`
            ctx.font = "700 9.5px ui-monospace, monospace"
            const tw = ctx.measureText(tag).width
            const lx = Math.min(sx0, sx1) + 4
            const ly = Math.min(sy0, sy1) - 10
            ctx.fillStyle = isDanger ? "rgba(127, 29, 29, 0.92)" : "rgba(15, 23, 42, 0.9)"
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.roundRect(lx - 2, ly - 8, tw + 8, 14, 3)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = isDanger ? "#fecaca" : "#e0f2fe"
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText(tag, lx + 2, ly - 1)
        }
    }
    ctx.restore()
}

/** Proyecta implantes virtuales sobre la Panorámica CPR */
export function drawImplantsOnPanorama(
    ctx: CanvasRenderingContext2D,
    mmToScreen: (xMm: number, yMm: number) => [number, number],
    scalePxPerMm: number,
    archModel: ArchModel,
    vol: ClinicalVolume,
    hTop: number,
    implants: VirtualImplant[],
    nervePoints3D: Vec3[],
    selectedImplantId?: string | null
) {
    if (implants.length === 0) return
    ctx.save()
    for (const imp of implants) {
        const p0 = imp.platform3D
        const p1: Vec3 = [
            p0[0] + imp.axis3D[0] * imp.lengthMm,
            p0[1] + imp.axis3D[1] * imp.lengthMm,
            p0[2] + imp.axis3D[2] * imp.lengthMm,
        ]
        const pr0 = projectToArch(archModel, p0[0], p0[1])
        const pr1 = projectToArch(archModel, p1[0], p1[1])
        const [sx0, sy0] = mmToScreen(pr0.s, hTop - hFromZ(vol, p0[2]))
        const [sx1, sy1] = mmToScreen(pr1.s, hTop - hFromZ(vol, p1[2]))
        const nerveDist = computeImplantNerveDistanceMm(imp, nervePoints3D)
        const isDanger = nerveDist !== null && nerveDist < imp.safetyMarginMm
        const isSelected = imp.id === selectedImplantId

        const dx = sx1 - sx0
        const dy = sy1 - sy0
        const lenPx = Math.hypot(dx, dy) || 1
        const nx = -dy / lenPx
        const ny = dx / lenPx
        const radPx = (imp.diameterMm * 0.5) * scalePxPerMm

        ctx.beginPath()
        ctx.moveTo(sx0 + nx * radPx, sy0 + ny * radPx)
        ctx.lineTo(sx1 + nx * radPx * 0.78, sy1 + ny * radPx * 0.78)
        ctx.lineTo(sx1 - nx * radPx * 0.78, sy1 - ny * radPx * 0.78)
        ctx.lineTo(sx0 - nx * radPx, sy0 - ny * radPx)
        ctx.closePath()
        ctx.fillStyle = isDanger ? "rgba(239, 68, 68, 0.35)" : "rgba(99, 102, 241, 0.35)"
        ctx.fill()
        ctx.strokeStyle = isDanger ? "#f87171" : isSelected ? "#38bdf8" : "#818cf8"
        ctx.lineWidth = isSelected ? 1.8 : 1.3
        ctx.stroke()
    }
    ctx.restore()
}
