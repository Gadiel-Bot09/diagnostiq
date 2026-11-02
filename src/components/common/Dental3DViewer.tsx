"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { Button } from "@/components/ui/button"
import { Box, Loader2, RotateCcw, AlertCircle } from "lucide-react"
import type { RenderVolume } from "@/lib/cbctReconstruction"

export interface VolumeFocus {
    /** Posición normalizada (0..1) en columnas / filas del volumen */
    cx: number
    cy: number
    /** Tangente unitaria del arco en espacio mm */
    tx: number
    ty: number
    halfWidthMm: number
    halfDepthMm: number
}

export interface Dental3DViewerProps {
    volume: RenderVolume | null
    status?: string
    error?: string | null
    sliceIndex: number
    totalSlices: number
    focus?: VolumeFocus | null
    isExpanded?: boolean
    onToggleExpand?: () => void
}

type RenderMode = "dvr" | "mip"

const VERTEX_SHADER = /* glsl */ `
    varying vec3 vOrigin;
    varying vec3 vDirection;
    void main() {
        vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vDirection = position - vOrigin;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    uniform sampler3D uVolume;
    uniform float uThreshold;
    uniform float uOpacity;
    uniform float uSteps;
    uniform int uMode;
    uniform bool uFlipZ;
    uniform vec3 uTexel;

    varying vec3 vOrigin;
    varying vec3 vDirection;

    vec2 hitBox(vec3 orig, vec3 dir) {
        vec3 inv = 1.0 / dir;
        vec3 t0 = (vec3(-0.5) - orig) * inv;
        vec3 t1 = (vec3(0.5) - orig) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
    }

    float sampleVol(vec3 p) {
        if (uFlipZ) p.z = 1.0 - p.z;
        return texture(uVolume, p).r;
    }

    vec3 gradientAt(vec3 p) {
        vec3 e = uTexel * 1.2;
        return vec3(
            sampleVol(p + vec3(e.x, 0.0, 0.0)) - sampleVol(p - vec3(e.x, 0.0, 0.0)),
            sampleVol(p + vec3(0.0, e.y, 0.0)) - sampleVol(p - vec3(0.0, e.y, 0.0)),
            sampleVol(p + vec3(0.0, 0.0, e.z)) - sampleVol(p - vec3(0.0, 0.0, e.z))
        );
    }

    // Función de transferencia: hueso trabecular/cortical (marrón) -> dentina -> esmalte (marfil)
    vec3 transfer(float v) {
        float t = clamp((v - uThreshold) / max(1.0 - uThreshold, 1e-3), 0.0, 1.0);
        vec3 c0 = vec3(0.50, 0.30, 0.22);
        vec3 c1 = vec3(0.80, 0.62, 0.46);
        vec3 c2 = vec3(1.00, 0.97, 0.90);
        return t < 0.45 ? mix(c0, c1, t / 0.45) : mix(c1, c2, clamp((t - 0.45) / 0.35, 0.0, 1.0));
    }

    void main() {
        vec3 rd = normalize(vDirection);
        vec2 b = hitBox(vOrigin, rd);
        if (b.x > b.y) discard;
        b.x = max(b.x, 0.0);

        float dt = 1.0 / uSteps;
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float t = b.x + dt * jitter;
        vec3 L = normalize(-rd + vec3(0.25, 0.35, 0.15));

        vec4 acc = vec4(0.0);
        float mx = 0.0;
        for (int i = 0; i < 1200; i++) {
            if (t > b.y) break;
            vec3 pos = vOrigin + rd * t + 0.5;
            float v = sampleVol(pos);
            if (uMode == 1) {
                mx = max(mx, v);
            } else if (v > uThreshold) {
                float a0 = smoothstep(uThreshold, uThreshold + 0.08, v) * uOpacity;
                float a = 1.0 - pow(1.0 - clamp(a0, 0.0, 0.999), 256.0 / uSteps);
                vec3 g = gradientAt(pos);
                float gl = length(g);
                vec3 n = gl > 1e-4 ? -g / gl : -rd;
                float diff = abs(dot(n, L));
                float spec = pow(max(dot(n, normalize(L - rd)), 0.0), 28.0);
                vec3 c = transfer(v) * (0.32 + 0.78 * diff) + vec3(spec * 0.22);
                acc.rgb += (1.0 - acc.a) * a * c;
                acc.a += (1.0 - acc.a) * a;
                if (acc.a > 0.97) break;
            }
            t += dt;
        }

        if (uMode == 1) {
            float lo = uThreshold * 0.55;
            float g = clamp((mx - lo) / max(0.98 - lo, 1e-3), 0.0, 1.0);
            gl_FragColor = vec4(vec3(pow(g, 0.9)), 1.0);
            return;
        }
        if (acc.a < 0.01) discard;
        gl_FragColor = acc;
    }
`

const isMobile = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches

export function Dental3DViewer({
    volume,
    status,
    error,
    sliceIndex,
    totalSlices,
    focus,
    isExpanded,
    onToggleExpand,
}: Dental3DViewerProps) {
    const mountRef = useRef<HTMLDivElement>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const groupRef = useRef<THREE.Group | null>(null)
    const frameRef = useRef<THREE.Object3D | null>(null)
    const materialRef = useRef<THREE.ShaderMaterial | null>(null)
    const slicePlaneRef = useRef<THREE.Object3D | null>(null)
    const focusBoxRef = useRef<THREE.LineSegments | null>(null)
    const needsRenderRef = useRef(true)
    const interactingTimerRef = useRef<any>(null)
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
    const lastPinchRef = useRef<number | null>(null)
    const dragModeRef = useRef<"rotate" | "pan">("rotate")

    const [glError, setGlError] = useState<string | null>(null)
    const [mode, setMode] = useState<RenderMode>("dvr")
    const [threshold, setThreshold] = useState(0.4)
    const [viewAngleName, setViewAngleName] = useState("3D Volumétrico")

    const requestRender = () => {
        needsRenderRef.current = true
    }

    const highSteps = () => (isMobile() ? 260 : 440)

    // Calidad adaptativa: menos muestras mientras se interactúa, máxima calidad en reposo
    const markInteracting = () => {
        const mat = materialRef.current
        if (mat) mat.uniforms.uSteps.value = isMobile() ? 120 : 180
        requestRender()
        clearTimeout(interactingTimerRef.current)
        interactingTimerRef.current = setTimeout(() => {
            if (materialRef.current) materialRef.current.uniforms.uSteps.value = highSteps()
            requestRender()
        }, 160)
    }

    // 1. Inicialización de escena WebGL2
    useEffect(() => {
        const container = mountRef.current
        if (!container) return

        let renderer: THREE.WebGLRenderer
        try {
            renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" })
            if (!renderer.capabilities.isWebGL2) throw new Error("WebGL2 no disponible")
        } catch (e) {
            setGlError("Su navegador no soporta WebGL2, necesario para el renderizado volumétrico 3D.")
            return
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile() ? 1.25 : 1.75))
        renderer.setClearColor(0x05070f, 1)
        rendererRef.current = renderer
        container.replaceChildren(renderer.domElement)
        renderer.domElement.style.width = "100%"
        renderer.domElement.style.height = "100%"
        renderer.domElement.style.display = "block"

        const scene = new THREE.Scene()
        sceneRef.current = scene
        const camera = new THREE.PerspectiveCamera(35, 1, 1, 3000)
        camera.position.set(0, 0, 270)
        cameraRef.current = camera

        const group = new THREE.Group()
        group.rotation.set(0.12, 0.55, 0) // vista 3/4 anterolateral derecha (similar a GALILEOS)
        scene.add(group)
        groupRef.current = group

        const resize = () => {
            const w = container.clientWidth
            const h = container.clientHeight
            if (w <= 0 || h <= 0) return
            renderer.setSize(w, h, false)
            camera.aspect = w / h
            camera.updateProjectionMatrix()
            requestRender()
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(container)

        let raf = 0
        const loop = () => {
            raf = requestAnimationFrame(loop)
            if (!needsRenderRef.current) return
            needsRenderRef.current = false
            renderer.render(scene, camera)
        }
        loop()

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            clearTimeout(interactingTimerRef.current)
            renderer.dispose()
            rendererRef.current = null
            if (container) container.innerHTML = ""
        }
    }, [])

    // 2. Construcción del volumen (textura 3D + material de ray casting + overlays)
    useEffect(() => {
        const group = groupRef.current
        if (!group || !volume) return

        const [dx, dy, dz] = volume.dims
        const texture = new THREE.Data3DTexture(volume.data, dx, dy, dz)
        texture.format = THREE.RedFormat
        texture.type = THREE.UnsignedByteType
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.unpackAlignment = 1
        texture.needsUpdate = true

        const initialThr = volume.suggestedThreshold
        setThreshold(initialThr)

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uVolume: { value: texture },
                uThreshold: { value: initialThr },
                uOpacity: { value: 0.32 },
                uSteps: { value: highSteps() },
                uMode: { value: 0 },
                uFlipZ: { value: !volume.zUp },
                uTexel: { value: new THREE.Vector3(1 / dx, 1 / dy, 1 / dz) },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            premultipliedAlpha: true,
        })
        materialRef.current = material

        // Marco con proporciones físicas reales. Local: x=columnas, y=filas (posterior), z=cortes.
        // Rotación -90° en X: cortes -> eje vertical (superior arriba), filas -> profundidad (anterior hacia la cámara).
        const frame = new THREE.Object3D()
        const [px, py, pz] = volume.physical
        const maxL = Math.max(px, py, pz)
        frame.scale.set((px / maxL) * 110, (py / maxL) * 110, (pz / maxL) * 110)
        frame.rotation.x = -Math.PI / 2
        frameRef.current = frame

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
        frame.add(mesh)

        // Caja delimitadora (estilo GALILEOS)
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
            new THREE.LineBasicMaterial({ color: 0x8a8f9c, transparent: true, opacity: 0.45, depthTest: false })
        )
        edges.renderOrder = 2
        frame.add(edges)

        // Plano axial del corte actual
        const sliceGroup = new THREE.Object3D()
        const planeFill = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
        )
        const planeEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
            new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9, depthTest: false })
        )
        planeFill.renderOrder = 3
        planeEdges.renderOrder = 3
        sliceGroup.add(planeFill, planeEdges)
        frame.add(sliceGroup)
        slicePlaneRef.current = sliceGroup

        // Caja de la "Ventana de cortes" sincronizada con la panorámica
        const focusBox = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xeab308, transparent: true, opacity: 0.95, depthTest: false })
        )
        focusBox.renderOrder = 4
        focusBox.visible = false
        frame.add(focusBox)
        focusBoxRef.current = focusBox

        group.add(frame)
        requestRender()

        return () => {
            group.remove(frame)
            frame.traverse((obj: any) => {
                obj.geometry?.dispose?.()
                obj.material?.dispose?.()
            })
            texture.dispose()
            materialRef.current = null
            frameRef.current = null
            slicePlaneRef.current = null
            focusBoxRef.current = null
            requestRender()
        }
    }, [volume])

    // 3. Sincronización de uniformes
    useEffect(() => {
        const mat = materialRef.current
        if (!mat) return
        mat.uniforms.uThreshold.value = threshold
        mat.uniforms.uMode.value = mode === "mip" ? 1 : 0
        requestRender()
    }, [threshold, mode, volume])

    // 4. Plano axial según el corte activo
    useEffect(() => {
        const plane = slicePlaneRef.current
        if (!plane || !volume || totalSlices <= 1) return
        const tz = (sliceIndex + 0.5) / totalSlices
        const pz = volume.zUp ? tz : 1 - tz
        plane.position.z = pz - 0.5
        requestRender()
    }, [sliceIndex, totalSlices, volume])

    // 5. Caja de la ventana de cortes
    useEffect(() => {
        const box = focusBoxRef.current
        if (!box || !volume) return
        if (!focus) {
            box.visible = false
            requestRender()
            return
        }
        const [Lx, Ly] = volume.physical
        const cx = focus.cx - 0.5
        const cy = focus.cy - 0.5
        const tX = (focus.tx * focus.halfWidthMm) / Lx
        const tY = (focus.ty * focus.halfWidthMm) / Ly
        const nX = (-focus.ty * focus.halfDepthMm) / Lx
        const nY = (focus.tx * focus.halfDepthMm) / Ly
        const corners2d = [
            [cx - tX - nX, cy - tY - nY],
            [cx + tX - nX, cy + tY - nY],
            [cx + tX + nX, cy + tY + nY],
            [cx - tX + nX, cy - tY + nY],
        ]
        const pts: number[] = []
        const zs = [-0.5, 0.5]
        for (const z of zs) {
            for (let k = 0; k < 4; k++) {
                const a = corners2d[k]
                const b = corners2d[(k + 1) % 4]
                pts.push(a[0], a[1], z, b[0], b[1], z)
            }
        }
        for (let k = 0; k < 4; k++) {
            const a = corners2d[k]
            pts.push(a[0], a[1], -0.5, a[0], a[1], 0.5)
        }
        box.geometry.dispose()
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        box.geometry = g
        box.visible = true
        requestRender()
    }, [focus, volume])

    // Interacción: rotar (1 dedo / clic izq.), desplazar (clic der. o Shift), zoom (rueda / pellizco)
    const handlePointerDown = (e: React.PointerEvent) => {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        dragModeRef.current = e.button === 2 || e.shiftKey ? "pan" : "rotate"
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        const pts = pointersRef.current
        const prev = pts.get(e.pointerId)
        if (!prev) return
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY })

        const group = groupRef.current
        const camera = cameraRef.current
        if (!group || !camera) return

        if (pts.size >= 2) {
            const [a, b] = Array.from(pts.values())
            const dist = Math.hypot(a.x - b.x, a.y - b.y)
            if (lastPinchRef.current) {
                const ratio = lastPinchRef.current / dist
                camera.position.z = Math.max(80, Math.min(600, camera.position.z * ratio))
            }
            lastPinchRef.current = dist
            markInteracting()
            return
        }

        if (dragModeRef.current === "pan") {
            const k = camera.position.z / 600
            camera.position.x -= dx * k
            camera.position.y += dy * k
        } else {
            group.rotation.y += dx * 0.01
            group.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, group.rotation.x + dy * 0.01))
            setViewAngleName("3D Volumétrico")
        }
        markInteracting()
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        pointersRef.current.delete(e.pointerId)
        if (pointersRef.current.size < 2) lastPinchRef.current = null
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
    }

    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation()
        const camera = cameraRef.current
        if (!camera) return
        camera.position.z = Math.max(80, Math.min(600, camera.position.z * (1 + e.deltaY * 0.001)))
        markInteracting()
    }

    const setPresetAngle = (name: string, rotX: number, rotY: number) => {
        const group = groupRef.current
        const camera = cameraRef.current
        if (!group || !camera) return
        group.rotation.set(rotX, rotY, 0)
        camera.position.set(0, 0, camera.position.z)
        setViewAngleName(name)
        requestRender()
    }

    const resetView = () => {
        const camera = cameraRef.current
        if (camera) camera.position.set(0, 0, 270)
        if (volume) setThreshold(volume.suggestedThreshold)
        setPresetAngle("3D Volumétrico", 0.12, 0.55)
    }

    const stop = (e: React.SyntheticEvent) => e.stopPropagation()

    return (
        <div className="relative w-full h-full flex flex-col bg-slate-950 overflow-hidden select-none">
            {/* Header del Panel 3D */}
            <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border-b border-slate-800 z-10 text-[11px] shrink-0 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 text-[10px]">
                        3D
                    </span>
                    <span className="text-slate-300 font-medium truncate">{viewAngleName}</span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white" onClick={() => setPresetAngle("Frente", 0, 0)} title="Vista frontal">
                        Frente
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white" onClick={() => setPresetAngle("Lateral derecha", 0, Math.PI / 2)} title="Vista lateral derecha">
                        Der
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white" onClick={() => setPresetAngle("Lateral izquierda", 0, -Math.PI / 2)} title="Vista lateral izquierda">
                        Izq
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white" onClick={() => setPresetAngle("Axial (desde arriba)", Math.PI / 2, 0)} title="Vista superior">
                        Sup
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white" onClick={() => setPresetAngle("Desde abajo", -Math.PI / 2, 0)} title="Vista inferior">
                        Inf
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-slate-400 hover:text-white" onClick={resetView} title="Restablecer vista">
                        <RotateCcw className="h-3 w-3" />
                    </Button>
                    {onToggleExpand && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0 text-slate-400 hover:text-white ml-0.5"
                            onClick={onToggleExpand}
                            title={isExpanded ? "Volver a Multivista" : "Ver 3D en pantalla completa"}
                        >
                            <Box className="h-3 w-3" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Canvas 3D Interactivo */}
            <div
                ref={mountRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
                className="flex-1 w-full min-h-0 relative cursor-grab active:cursor-grabbing touch-none"
            />

            {/* Estado de reconstrucción */}
            {(!volume || glError || error) && (
                <div className="absolute inset-0 top-7 flex flex-col items-center justify-center gap-2 bg-slate-950/90 z-20 text-center px-4 pointer-events-none">
                    {glError || error ? (
                        <>
                            <AlertCircle className="h-6 w-6 text-rose-400" />
                            <p className="text-xs text-slate-300 max-w-xs">{glError || error}</p>
                        </>
                    ) : (
                        <>
                            <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
                            <p className="text-xs text-slate-300">{status || "Preparando reconstrucción volumétrica 3D..."}</p>
                        </>
                    )}
                </div>
            )}

            {/* Controles de render (umbral óseo y modo) */}
            {volume && !glError && (
                <div
                    className="absolute bottom-2 left-2 z-10 flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-md px-2 py-1 text-[10px] text-slate-300 backdrop-blur-sm"
                    onPointerDown={stop}
                    onWheel={stop}
                >
                    <div className="flex rounded overflow-hidden border border-slate-700">
                        <button
                            className={`px-1.5 py-0.5 ${mode === "dvr" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"}`}
                            onClick={() => setMode("dvr")}
                            title="Renderizado volumétrico con superficies óseas"
                        >
                            Volumen
                        </button>
                        <button
                            className={`px-1.5 py-0.5 ${mode === "mip" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"}`}
                            onClick={() => setMode("mip")}
                            title="Proyección de máxima intensidad (tipo radiografía)"
                        >
                            MIP
                        </button>
                    </div>
                    <label className="flex items-center gap-1">
                        <span className="hidden sm:inline">Umbral</span>
                        <input
                            type="range"
                            min={0.05}
                            max={0.9}
                            step={0.005}
                            value={threshold}
                            onChange={(e) => {
                                setThreshold(parseFloat(e.target.value))
                                markInteracting()
                            }}
                            className="w-20 sm:w-28 accent-amber-500"
                            title="Umbral de densidad: menor = más tejido visible, mayor = solo dientes y hueso cortical"
                        />
                    </label>
                </div>
            )}

            <div className="absolute bottom-2 right-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] text-slate-400 hidden sm:block">
                Arrastre: rotar · Clic der./Shift: mover · Rueda: zoom
            </div>
        </div>
    )
}
