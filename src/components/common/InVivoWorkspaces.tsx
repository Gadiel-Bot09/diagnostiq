"use client"

import React, { useMemo } from "react"
import {
    MprViewport,
    type ActiveClinicalTool,
    type ClinicalColorMap,
    type ClinicalMeasurement,
    type ViewportOverlayContext,
} from "./MprViewport"
import { Dental3DViewer, type Implant3DNorm } from "./Dental3DViewer"
import {
    coronalPlane,
    sagittalPlane,
    crossPlane,
    renderPlane,
    archFrame,
    zFromH,
    planeMmToWorld,
    projectWorldPointToPlane,
    type ClinicalVolume,
    type ArchModel,
    type PanoramaImage,
    type PlaneSpec,
    type WindowLevel,
    type SlabMode,
    type Vec3,
    type ViewImage,
} from "@/lib/cbct/mprEngine"
import type { WebGLMprRenderer } from "@/lib/cbct/webglMprRenderer"
import type { RenderVolume } from "@/lib/cbctReconstruction"
import type { VirtualImplant } from "@/lib/cbct/clinicalScene"
import { drawImplantsOnPanorama, drawImplantsOnPlane } from "@/lib/cbct/implantOverlay"

export interface InVivoMprWorkspaceProps {
    clinicalVol: ClinicalVolume
    gpuRenderer: WebGLMprRenderer | null
    renderVolume: RenderVolume | null
    reconStatus: string
    axialSpec: PlaneSpec | null
    axialImg: ViewImage | null
    axialH: number
    setAxialH: React.Dispatch<React.SetStateAction<number>>
    sagittalX: number
    setSagittalX: React.Dispatch<React.SetStateAction<number>>
    coronalY: number
    setCoronalY: React.Dispatch<React.SetStateAction<number>>
    slabMm: number
    slabMode: SlabMode
    setSlabMode: (m: SlabMode) => void
    sliceWl: WindowLevel
    colorMap: ClinicalColorMap
    sharpen: boolean
    activeTool: ActiveClinicalTool
    isEstimatedCalibration: boolean
    measurementsByView: Record<string, ClinicalMeasurement[]>
    onUpdateViewMeasurements: (viewKey: string, next: ClinicalMeasurement[]) => void
    onAdjustSliceWl: (dW: number, dC: number) => void
    nervePoints3D: Vec3[]
    nervePointsNorm: [number, number, number][]
    onAddNervePoint3D: (pt: Vec3) => void
    implants: VirtualImplant[]
    implantsNorm: Implant3DNorm[]
    selectedImplantId: string | null
    onPlaceImplantAt3D: (pt: Vec3) => void
    currentSliceIndex: number
    totalSlices: number
    resetTrigger: number
    externalZoomStep: number
}

/**
 * Espacio de trabajo "InVivo MPR" (MPR Ortogonal acelerado por GPU WebGL2 16-bit Tricúbico):
 * 4 paneles sincronizados en tiempo real: Axial + Coronal + Sagital + 3D Volumétrico.
 */
export function InVivoMprWorkspace({
    clinicalVol,
    gpuRenderer,
    renderVolume,
    reconStatus,
    axialSpec,
    axialImg,
    axialH,
    setAxialH,
    sagittalX,
    setSagittalX,
    coronalY,
    setCoronalY,
    slabMm,
    slabMode,
    setSlabMode,
    sliceWl,
    colorMap,
    sharpen,
    activeTool,
    isEstimatedCalibration,
    measurementsByView,
    onUpdateViewMeasurements,
    onAdjustSliceWl,
    nervePoints3D,
    nervePointsNorm,
    onAddNervePoint3D,
    implants,
    implantsNorm,
    selectedImplantId,
    onPlaceImplantAt3D,
    currentSliceIndex,
    totalSlices,
    resetTrigger,
    externalZoomStep,
}: InVivoMprWorkspaceProps) {
    const useGpu = Boolean(gpuRenderer?.isReady)

    const coronalSpec = useMemo(
        () => coronalPlane(clinicalVol, coronalY, slabMm, slabMode),
        [clinicalVol, coronalY, slabMm, slabMode]
    )
    const coronalImg = useMemo(
        () => (useGpu ? null : renderPlane(clinicalVol, coronalSpec)),
        [useGpu, clinicalVol, coronalSpec]
    )

    const sagittalSpec = useMemo(
        () => sagittalPlane(clinicalVol, sagittalX, slabMm, slabMode),
        [clinicalVol, sagittalX, slabMm, slabMode]
    )
    const sagittalImg = useMemo(
        () => (useGpu ? null : renderPlane(clinicalVol, sagittalSpec)),
        [useGpu, clinicalVol, sagittalSpec]
    )

    const drawNerveOnSpec = (
        ctx: CanvasRenderingContext2D,
        mmToScreen: (x: number, y: number) => [number, number],
        spec: PlaneSpec | null
    ) => {
        if (!spec || nervePoints3D.length === 0) return
        ctx.save()
        for (const pt of nervePoints3D) {
            const proj = projectWorldPointToPlane(spec, pt)
            if (proj.distMm <= Math.max(2.5, slabMm * 1.5)) {
                const [sx, sy] = mmToScreen(proj.xMm, proj.yMm)
                ctx.fillStyle = "rgba(249, 115, 22, 0.85)"
                ctx.strokeStyle = "#fff7ed"
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.arc(sx, sy, 4, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
            }
        }
        ctx.restore()
    }

    const renderAxialCrosshair = ({ ctx, mmToScreen, scalePxPerMm }: ViewportOverlayContext) => {
        const [cx, cy] = mmToScreen(sagittalX, coronalY)
        const [x0, y0] = mmToScreen(0, 0)
        const [x1, y1] = mmToScreen(clinicalVol.widthMm, clinicalVol.depthMm)

        ctx.save()
        ctx.strokeStyle = "rgba(52, 211, 153, 0.8)"
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(cx, y0)
        ctx.lineTo(cx, y1)
        ctx.stroke()

        ctx.strokeStyle = "rgba(192, 132, 252, 0.85)"
        ctx.beginPath()
        ctx.moveTo(x0, cy)
        ctx.lineTo(x1, cy)
        ctx.stroke()
        ctx.restore()

        drawNerveOnSpec(ctx, mmToScreen, axialSpec)
        drawImplantsOnPlane(ctx, mmToScreen, scalePxPerMm, axialSpec, implants, nervePoints3D, selectedImplantId)
    }

    const renderCoronalCrosshair = ({ ctx, mmToScreen, scalePxPerMm }: ViewportOverlayContext) => {
        const yAxialMm = clinicalVol.heightMm - axialH
        const [cx, cy] = mmToScreen(sagittalX, yAxialMm)
        const [x0, y0] = mmToScreen(0, 0)
        const [x1, y1] = mmToScreen(clinicalVol.widthMm, clinicalVol.heightMm)

        ctx.save()
        ctx.strokeStyle = "rgba(52, 211, 153, 0.8)"
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(cx, y0)
        ctx.lineTo(cx, y1)
        ctx.stroke()

        ctx.strokeStyle = "rgba(34, 211, 238, 0.85)"
        ctx.beginPath()
        ctx.moveTo(x0, cy)
        ctx.lineTo(x1, cy)
        ctx.stroke()
        ctx.restore()

        drawNerveOnSpec(ctx, mmToScreen, coronalSpec)
        drawImplantsOnPlane(ctx, mmToScreen, scalePxPerMm, coronalSpec, implants, nervePoints3D, selectedImplantId)
    }

    const renderSagittalCrosshair = ({ ctx, mmToScreen, scalePxPerMm }: ViewportOverlayContext) => {
        const yAxialMm = clinicalVol.heightMm - axialH
        const [cx, cy] = mmToScreen(coronalY, yAxialMm)
        const [x0, y0] = mmToScreen(0, 0)
        const [x1, y1] = mmToScreen(clinicalVol.depthMm, clinicalVol.heightMm)

        ctx.save()
        ctx.strokeStyle = "rgba(192, 132, 252, 0.85)"
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(cx, y0)
        ctx.lineTo(cx, y1)
        ctx.stroke()

        ctx.strokeStyle = "rgba(34, 211, 238, 0.85)"
        ctx.beginPath()
        ctx.moveTo(x0, cy)
        ctx.lineTo(x1, cy)
        ctx.stroke()
        ctx.restore()

        drawNerveOnSpec(ctx, mmToScreen, sagittalSpec)
        drawImplantsOnPlane(ctx, mmToScreen, scalePxPerMm, sagittalSpec, implants, nervePoints3D, selectedImplantId)
    }

    return (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 grid-rows-4 md:grid-rows-2 gap-1 p-1 bg-black">
            {/* PANEL 1: AXIAL */}
            <div
                data-cbct-capture-label={`Axial (Z: ${axialH.toFixed(1)} mm)`}
                className="min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-[#03060c] flex flex-col"
            >
                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 text-[11px] shrink-0">
                    <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-[10px]">
                            Axial
                        </span>
                        <span className="text-slate-300 font-mono text-[10px]">
                            Z: {axialH.toFixed(1)} mm ({currentSliceIndex + 1}/{totalSlices})
                        </span>
                    </div>
                    <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 text-[9px]">
                        {(["mean", "mip", "minip"] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setSlabMode(m)}
                                className={`px-1.5 py-0.2 rounded uppercase ${
                                    slabMode === m ? "bg-cyan-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                                }`}
                            >
                                {m === "mean" ? "Media" : m}
                            </button>
                        ))}
                    </div>
                </div>
                <MprViewport
                    viewId="invivo_axial"
                    image={axialImg}
                    clinicalVol={clinicalVol}
                    planeSpec={axialSpec}
                    gpuRenderer={gpuRenderer}
                    slope={clinicalVol.slope}
                    intercept={clinicalVol.intercept}
                    windowLevel={sliceWl}
                    colorMap={colorMap}
                    sharpen={sharpen}
                    activeTool={activeTool}
                    measurements={measurementsByView.axial || []}
                    onChangeMeasurements={(next) => onUpdateViewMeasurements("axial", next)}
                    currentSliceCoord={axialH}
                    currentSliceLabel={`Axial ${axialH.toFixed(1)} mm`}
                    isEstimatedCalibration={isEstimatedCalibration}
                    onAdjustWindowLevel={onAdjustSliceWl}
                    onWheelStep={(steps) =>
                        setAxialH((h) => Math.max(0, Math.min(clinicalVol.heightMm, h + steps * Math.max(0.25, clinicalVol.sz))))
                    }
                    onNavigateMm={(xMm, yMm) => {
                        setSagittalX(Math.max(0, Math.min(clinicalVol.widthMm, xMm)))
                        setCoronalY(Math.max(0, Math.min(clinicalVol.depthMm, yMm)))
                    }}
                    onAddNervePointMm={(xMm, yMm) => onAddNervePoint3D([xMm, yMm, zFromH(clinicalVol, axialH)])}
                    onPlaceImplantMm={(xMm, yMm) => onPlaceImplantAt3D([xMm, yMm, zFromH(clinicalVol, axialH)])}
                    renderOverlay={renderAxialCrosshair}
                    scaleBarCm={5}
                    leftLabel="R"
                    rightLabel="L"
                    topLabel="A"
                    bottomLabel="P"
                    resetTrigger={resetTrigger}
                    externalZoomStep={externalZoomStep}
                />
            </div>

            {/* PANEL 2: CORONAL */}
            <div
                data-cbct-capture-label={`Coronal (Y: ${coronalY.toFixed(1)} mm)`}
                className="min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-[#03060c] flex flex-col"
            >
                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 text-[11px] shrink-0">
                    <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-[10px]">
                            Coronal
                        </span>
                        <span className="text-slate-300 font-mono text-[10px]">
                            Y: {coronalY.toFixed(1)} / {clinicalVol.depthMm.toFixed(0)} mm
                        </span>
                    </div>
                </div>
                <MprViewport
                    viewId="invivo_coronal"
                    image={coronalImg}
                    clinicalVol={clinicalVol}
                    planeSpec={coronalSpec}
                    gpuRenderer={gpuRenderer}
                    slope={clinicalVol.slope}
                    intercept={clinicalVol.intercept}
                    windowLevel={sliceWl}
                    colorMap={colorMap}
                    sharpen={sharpen}
                    activeTool={activeTool}
                    measurements={measurementsByView.coronal || []}
                    onChangeMeasurements={(next) => onUpdateViewMeasurements("coronal", next)}
                    currentSliceCoord={coronalY}
                    currentSliceLabel={`Coronal ${coronalY.toFixed(1)} mm`}
                    isEstimatedCalibration={isEstimatedCalibration}
                    onAdjustWindowLevel={onAdjustSliceWl}
                    onWheelStep={(steps) =>
                        setCoronalY((y) => Math.max(0, Math.min(clinicalVol.depthMm, y + steps * 0.5)))
                    }
                    onNavigateMm={(xMm, yMm) => {
                        setSagittalX(Math.max(0, Math.min(clinicalVol.widthMm, xMm)))
                        setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, clinicalVol.heightMm - yMm)))
                    }}
                    onAddNervePointMm={(xMm, yMm) => onAddNervePoint3D(planeMmToWorld(coronalSpec, xMm, yMm))}
                    onPlaceImplantMm={(xMm, yMm) => onPlaceImplantAt3D(planeMmToWorld(coronalSpec, xMm, yMm))}
                    renderOverlay={renderCoronalCrosshair}
                    scaleBarCm={5}
                    leftLabel="R"
                    rightLabel="L"
                    topLabel="S"
                    bottomLabel="I"
                    resetTrigger={resetTrigger}
                    externalZoomStep={externalZoomStep}
                />
            </div>

            {/* PANEL 3: SAGITAL */}
            <div
                data-cbct-capture-label={`Sagital (X: ${sagittalX.toFixed(1)} mm)`}
                className="min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-[#03060c] flex flex-col"
            >
                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 text-[11px] shrink-0">
                    <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px]">
                            Sagital
                        </span>
                        <span className="text-slate-300 font-mono text-[10px]">
                            X: {sagittalX.toFixed(1)} / {clinicalVol.widthMm.toFixed(0)} mm
                        </span>
                    </div>
                </div>
                <MprViewport
                    viewId="invivo_sagittal"
                    image={sagittalImg}
                    clinicalVol={clinicalVol}
                    planeSpec={sagittalSpec}
                    gpuRenderer={gpuRenderer}
                    slope={clinicalVol.slope}
                    intercept={clinicalVol.intercept}
                    windowLevel={sliceWl}
                    colorMap={colorMap}
                    sharpen={sharpen}
                    activeTool={activeTool}
                    measurements={measurementsByView.sagittal || []}
                    onChangeMeasurements={(next) => onUpdateViewMeasurements("sagittal", next)}
                    currentSliceCoord={sagittalX}
                    currentSliceLabel={`Sagital ${sagittalX.toFixed(1)} mm`}
                    isEstimatedCalibration={isEstimatedCalibration}
                    onAdjustWindowLevel={onAdjustSliceWl}
                    onWheelStep={(steps) =>
                        setSagittalX((x) => Math.max(0, Math.min(clinicalVol.widthMm, x + steps * 0.5)))
                    }
                    onNavigateMm={(xMm, yMm) => {
                        setCoronalY(Math.max(0, Math.min(clinicalVol.depthMm, xMm)))
                        setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, clinicalVol.heightMm - yMm)))
                    }}
                    onAddNervePointMm={(xMm, yMm) => onAddNervePoint3D(planeMmToWorld(sagittalSpec, xMm, yMm))}
                    onPlaceImplantMm={(xMm, yMm) => onPlaceImplantAt3D(planeMmToWorld(sagittalSpec, xMm, yMm))}
                    renderOverlay={renderSagittalCrosshair}
                    scaleBarCm={5}
                    leftLabel="A"
                    rightLabel="P"
                    topLabel="S"
                    bottomLabel="I"
                    resetTrigger={resetTrigger}
                    externalZoomStep={externalZoomStep}
                />
            </div>

            {/* PANEL 4: 3D VOLUMÉTRICO */}
            <div
                data-cbct-capture-label="3D Volumétrico"
                className="min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-black flex flex-col"
            >
                <Dental3DViewer
                    volume={renderVolume}
                    status={reconStatus}
                    sliceIndex={currentSliceIndex}
                    totalSlices={totalSlices}
                    nervePointsNorm={nervePointsNorm}
                    implantsNorm={implantsNorm}
                />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------------------------
// Modo InVivo — Cortes Seriados Transaxiales (6 cortes simultáneos acelerados por GPU WebGL2)
// ---------------------------------------------------------------------------------------------

export interface InVivoArchSerialWorkspaceProps {
    clinicalVol: ClinicalVolume
    gpuRenderer: WebGLMprRenderer | null
    archModel: ArchModel
    panoramaImage: PanoramaImage | null
    axialSpec: PlaneSpec | null
    axialImg: ViewImage | null
    archS: number
    setArchS: React.Dispatch<React.SetStateAction<number>>
    axialH: number
    setAxialH: React.Dispatch<React.SetStateAction<number>>
    serialSpacingMm: number
    setSerialSpacingMm: (v: number) => void
    mprSlabMm: number
    crossHalfWidthMm: number
    sliceWindowBounds: { hBot: number; hTop: number; height: number }
    sliceWl: WindowLevel
    panoWl: WindowLevel
    colorMap: ClinicalColorMap
    sharpen: boolean
    activeTool: ActiveClinicalTool
    isEstimatedCalibration: boolean
    measurementsByView: Record<string, ClinicalMeasurement[]>
    onUpdateViewMeasurements: (viewKey: string, next: ClinicalMeasurement[]) => void
    onAdjustSliceWl: (dW: number, dC: number) => void
    onAdjustPanoWl: (dW: number, dC: number) => void
    onMoveArchControlPoint: (idx: number, xMm: number, yMm: number) => void
    nervePoints3D: Vec3[]
    onAddNervePoint3D: (pt: Vec3) => void
    implants: VirtualImplant[]
    selectedImplantId: string | null
    onPlaceImplantAt3D: (pt: Vec3, sOverride?: number) => void
    renderAxialOverlay: (rc: ViewportOverlayContext) => void
    resetTrigger: number
    externalZoomStep: number
}

const SERIAL_OFFSETS_INDICES = [-2, -1, 0, 1, 2, 3]

export function InVivoArchSerialWorkspace({
    clinicalVol,
    gpuRenderer,
    archModel,
    panoramaImage,
    axialSpec,
    axialImg,
    archS,
    setArchS,
    axialH,
    setAxialH,
    serialSpacingMm,
    setSerialSpacingMm,
    mprSlabMm,
    crossHalfWidthMm,
    sliceWindowBounds,
    sliceWl,
    panoWl,
    colorMap,
    sharpen,
    activeTool,
    isEstimatedCalibration,
    measurementsByView,
    onUpdateViewMeasurements,
    onAdjustSliceWl,
    onAdjustPanoWl,
    onMoveArchControlPoint,
    nervePoints3D,
    onAddNervePoint3D,
    implants,
    selectedImplantId,
    onPlaceImplantAt3D,
    renderAxialOverlay,
    resetTrigger,
    externalZoomStep,
}: InVivoArchSerialWorkspaceProps) {
    const useGpu = Boolean(gpuRenderer?.isReady)

    const serialSlices = useMemo(() => {
        return SERIAL_OFFSETS_INDICES.map((offsetIdx, i) => {
            const sMm = Math.max(0, Math.min(archModel.length, archS + offsetIdx * serialSpacingMm))
            const spec = crossPlane(
                clinicalVol,
                archModel,
                sMm,
                crossHalfWidthMm,
                Math.max(mprSlabMm, 1.0),
                sliceWindowBounds.hBot,
                sliceWindowBounds.hTop
            )
            const img = useGpu ? null : renderPlane(clinicalVol, spec)
            return {
                num: i + 1,
                isCenter: offsetIdx === 0,
                sMm,
                spec,
                img,
            }
        })
    }, [useGpu, clinicalVol, archModel, archS, serialSpacingMm, mprSlabMm, crossHalfWidthMm, sliceWindowBounds])

    const renderSerialPanoramaOverlay = ({ ctx, mmToScreen, scalePxPerMm }: ViewportOverlayContext) => {
        if (!panoramaImage) return
        const hTop = panoramaImage.hTop
        const yAxialMm = Math.max(0, Math.min(hTop, hTop - axialH))
        const yWinTopMm = Math.max(0, Math.min(hTop, hTop - sliceWindowBounds.hTop))
        const yWinBotMm = Math.max(0, Math.min(hTop, hTop - sliceWindowBounds.hBot))

        const [imgLeftX, cy] = mmToScreen(0, yAxialMm)
        const [imgRightX] = mmToScreen(archModel.length, yAxialMm)

        ctx.save()
        ctx.strokeStyle = "rgba(34, 211, 238, 0.55)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(imgLeftX, cy)
        ctx.lineTo(imgRightX, cy)
        ctx.stroke()

        for (const sl of serialSlices) {
            const [sx, topY] = mmToScreen(sl.sMm, yWinTopMm)
            const [, botY] = mmToScreen(sl.sMm, yWinBotMm)
            ctx.strokeStyle = sl.isCenter ? "rgba(250, 204, 21, 0.95)" : "rgba(56, 189, 248, 0.72)"
            ctx.lineWidth = sl.isCenter ? 1.8 : 1.1
            ctx.beginPath()
            ctx.moveTo(sx, topY)
            ctx.lineTo(sx, botY)
            ctx.stroke()

            ctx.fillStyle = sl.isCenter ? "#facc15" : "#7dd3fc"
            ctx.font = "700 10px ui-monospace, monospace"
            ctx.textAlign = "center"
            ctx.fillText(String(sl.num), sx, Math.max(12, topY - 4))
        }
        ctx.restore()

        drawImplantsOnPanorama(
            ctx,
            mmToScreen,
            scalePxPerMm,
            archModel,
            clinicalVol,
            hTop,
            implants,
            nervePoints3D,
            selectedImplantId
        )
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-1 p-1 bg-black">
            {/* FILA SUPERIOR: Panorama con líneas numeradas 1..6 + Axial */}
            <div className="flex-[44] min-h-0 flex flex-col md:flex-row gap-1">
                <div
                    data-cbct-capture-label="Panorama Seriados 6×"
                    className="flex-[65] min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-[#03060c] flex flex-col"
                >
                    <div className="flex flex-wrap items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 text-[11px] shrink-0 gap-1">
                        <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30 text-[10px]">
                                Cortes Seriados (InVivo GPU)
                            </span>
                            <span className="text-slate-300 text-[10px] font-mono">
                                Centro: {archS.toFixed(1)} mm · 6 cortes
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400">Paso:</span>
                            {[0.5, 1.0, 1.5, 2.0, 3.0].map((step) => (
                                <button
                                    key={step}
                                    type="button"
                                    onClick={() => setSerialSpacingMm(step)}
                                    className={`px-1.5 py-0.2 text-[9px] rounded font-mono ${
                                        serialSpacingMm === step
                                            ? "bg-indigo-600 text-white font-semibold"
                                            : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                                    }`}
                                >
                                    {step.toFixed(1)}mm
                                </button>
                            ))}
                        </div>
                    </div>
                    <MprViewport
                        viewId="serial_panorama"
                        image={panoramaImage}
                        slope={clinicalVol.slope}
                        intercept={clinicalVol.intercept}
                        windowLevel={panoWl}
                        colorMap={colorMap}
                        sharpen={sharpen}
                        activeTool={activeTool}
                        measurements={measurementsByView.panorama || []}
                        onChangeMeasurements={(next) => onUpdateViewMeasurements("panorama", next)}
                        isEstimatedCalibration={isEstimatedCalibration}
                        isCurvedProjection
                        onAdjustWindowLevel={onAdjustPanoWl}
                        onWheelStep={(steps) =>
                            setArchS((s) => Math.max(0, Math.min(archModel.length, s + steps * serialSpacingMm)))
                        }
                        onNavigateMm={(xMm, yMm) => {
                            setArchS(Math.max(0, Math.min(archModel.length, xMm)))
                            if (panoramaImage) {
                                setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, panoramaImage.hTop - yMm)))
                            }
                        }}
                        renderOverlay={renderSerialPanoramaOverlay}
                        scaleBarCm={1}
                        bottomLeftBadge="R"
                        resetTrigger={resetTrigger}
                        externalZoomStep={externalZoomStep}
                    />
                </div>

                <div
                    data-cbct-capture-label="Axial · Curva del Arco"
                    className="flex-[35] min-w-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden bg-[#03060c] flex flex-col"
                >
                    <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 text-[11px] shrink-0">
                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-[10px]">
                            Axial · Curva del Arco
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">H: {axialH.toFixed(1)} mm</span>
                    </div>
                    <MprViewport
                        viewId="serial_axial"
                        image={axialImg}
                        clinicalVol={clinicalVol}
                        planeSpec={axialSpec}
                        gpuRenderer={gpuRenderer}
                        slope={clinicalVol.slope}
                        intercept={clinicalVol.intercept}
                        windowLevel={sliceWl}
                        colorMap={colorMap}
                        sharpen={sharpen}
                        activeTool={activeTool}
                        measurements={measurementsByView.axial || []}
                        onChangeMeasurements={(next) => onUpdateViewMeasurements("axial", next)}
                        currentSliceCoord={axialH}
                        currentSliceLabel={`Axial ${axialH.toFixed(1)} mm`}
                        isEstimatedCalibration={isEstimatedCalibration}
                        archControlPoints={archModel.ctrl}
                        onMoveArchControlPoint={onMoveArchControlPoint}
                        onAdjustWindowLevel={onAdjustSliceWl}
                        onWheelStep={(steps) =>
                            setAxialH((h) => Math.max(0, Math.min(clinicalVol.heightMm, h + steps * Math.max(0.25, clinicalVol.sz))))
                        }
                        onPlaceImplantMm={(xMm, yMm) => onPlaceImplantAt3D([xMm, yMm, zFromH(clinicalVol, axialH)])}
                        renderOverlay={renderAxialOverlay}
                        scaleBarCm={5}
                        bottomLeftBadge="R"
                        resetTrigger={resetTrigger}
                        externalZoomStep={externalZoomStep}
                    />
                </div>
            </div>

            {/* FILA INFERIOR: Grilla de 6 Cortes Transversales Seriados Simultáneos (1..6) */}
            <div className="flex-[56] min-h-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1">
                {serialSlices.map((sl) => (
                    <div
                        key={sl.num}
                        data-cbct-capture-label={`Corte #${sl.num} (${sl.sMm.toFixed(1)} mm)`}
                        className={`min-w-0 min-h-0 rounded-lg overflow-hidden bg-[#03060c] flex flex-col border ${
                            sl.isCenter ? "border-amber-400/80 shadow-[0_0_8px_rgba(250,204,21,0.2)]" : "border-slate-800"
                        }`}
                    >
                        <div className="flex items-center justify-between px-2 py-0.5 bg-slate-900/95 border-b border-slate-800 text-[10px] shrink-0">
                            <span className={`font-bold font-mono ${sl.isCenter ? "text-amber-300" : "text-cyan-300"}`}>
                                #{sl.num} · {sl.sMm.toFixed(1)} mm
                            </span>
                            <span className="text-[9px] text-slate-500">O↔V</span>
                        </div>
                        <MprViewport
                            viewId={`serial_cross_${sl.num}`}
                            image={sl.img}
                            clinicalVol={clinicalVol}
                            planeSpec={sl.spec}
                            gpuRenderer={gpuRenderer}
                            slope={clinicalVol.slope}
                            intercept={clinicalVol.intercept}
                            windowLevel={sliceWl}
                            colorMap={colorMap}
                            sharpen={sharpen}
                            activeTool={activeTool}
                            measurements={measurementsByView.cross || []}
                            onChangeMeasurements={(next) => onUpdateViewMeasurements("cross", next)}
                            currentSliceCoord={sl.sMm}
                            sliceAnchorToleranceMm={Math.max(0.45, serialSpacingMm * 0.45)}
                            currentSliceLabel={`Transversal #${sl.num} (${sl.sMm.toFixed(1)} mm)`}
                            isEstimatedCalibration={isEstimatedCalibration}
                            compact
                            onAdjustWindowLevel={onAdjustSliceWl}
                            onWheelStep={(steps) =>
                                setArchS((s) => Math.max(0, Math.min(archModel.length, s + steps * serialSpacingMm)))
                            }
                            onNavigateMm={(_xMm, yMm) => {
                                setArchS(sl.sMm)
                                setAxialH(Math.max(0, Math.min(clinicalVol.heightMm, sliceWindowBounds.hTop - yMm)))
                            }}
                            onAddNervePointMm={(xMm, yMm) => {
                                onAddNervePoint3D(planeMmToWorld(sl.spec, xMm, yMm))
                            }}
                            onPlaceImplantMm={(xMm, yMm) => {
                                onPlaceImplantAt3D(planeMmToWorld(sl.spec, xMm, yMm), sl.sMm)
                            }}
                            renderOverlay={({ ctx, mmToScreen, scalePxPerMm }) => {
                                const yAx = Math.max(0, Math.min(sliceWindowBounds.height, sliceWindowBounds.hTop - axialH))
                                const [x0, cy] = mmToScreen(0, yAx)
                                const [x1] = mmToScreen(crossHalfWidthMm * 2, yAx)
                                ctx.strokeStyle = "rgba(34, 211, 238, 0.45)"
                                ctx.lineWidth = 0.9
                                ctx.beginPath()
                                ctx.moveTo(x0, cy)
                                ctx.lineTo(x1, cy)
                                ctx.stroke()

                                if (nervePoints3D.length > 0) {
                                    ctx.save()
                                    for (const pt of nervePoints3D) {
                                        const proj = projectWorldPointToPlane(sl.spec, pt)
                                        if (proj.distMm <= Math.max(1.8, serialSpacingMm * 0.9)) {
                                            const [nx, ny] = mmToScreen(proj.xMm, proj.yMm)
                                            ctx.fillStyle = "rgba(249, 115, 22, 0.9)"
                                            ctx.strokeStyle = "#fff7ed"
                                            ctx.lineWidth = 1.4
                                            ctx.beginPath()
                                            ctx.arc(nx, ny, 4.2, 0, Math.PI * 2)
                                            ctx.fill()
                                            ctx.stroke()
                                        }
                                    }
                                    ctx.restore()
                                }

                                drawImplantsOnPlane(
                                    ctx,
                                    mmToScreen,
                                    scalePxPerMm,
                                    sl.spec,
                                    implants,
                                    nervePoints3D,
                                    selectedImplantId
                                )
                            }}
                            resetTrigger={resetTrigger}
                            externalZoomStep={externalZoomStep}
                        />
                    </div>
                ))}
            </div>
        </div>
    )
}
