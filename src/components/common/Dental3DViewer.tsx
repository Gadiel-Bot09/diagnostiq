"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { Button } from "@/components/ui/button"
import { Box, Loader2, RotateCcw, AlertCircle, Scissors } from "lucide-react"
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
    /** Altura vertical normalizada (0..1) de la Ventana de cortes */
    hBotNorm?: number
    hTopNorm?: number
}

export interface Implant3DNorm {
    id: string
    p0: [number, number, number]
    p1: [number, number, number]
    radiusNorm: number
    isDanger: boolean
}

export interface Dental3DViewerProps {
    volume: RenderVolume | null
    status?: string
    error?: string | null
    sliceIndex: number
    totalSlices: number
    focus?: VolumeFocus | null
    /** Puntos 3D normalizados [0..1, 0..1, 0..1] del canal mandibular trazado */
    nervePointsNorm?: [number, number, number][]
    /** Implantes virtuales normalizados [0..1] para visualización 3D */
    implantsNorm?: Implant3DNorm[]
    isExpanded?: boolean
    onToggleExpand?: () => void
}

type RenderPreset = "bone" | "teeth" | "soft" | "mip"

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
    uniform int uPreset; // 0 = GALILEOS Hueso, 1 = InVivo Raices/Esmalte, 2 = InVivo Tejido+Hueso, 3 = MIP Rayos X
    uniform bool uFlipZ;
    uniform vec3 uTexel;
    uniform vec3 uClipMin;
    uniform vec3 uClipMax;

    varying vec3 vOrigin;
    varying vec3 vDirection;

    vec2 hitBox(vec3 orig, vec3 dir, vec3 bmin, vec3 bmax) {
        vec3 inv = 1.0 / dir;
        vec3 t0 = (bmin - orig) * inv;
        vec3 t1 = (bmax - orig) * inv;
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

    vec4 evalTransfer(float v) {
        float t = clamp((v - uThreshold) / max(1.0 - uThreshold, 1e-3), 0.0, 1.0);
        if (uPreset == 1) {
            // InVivo "Raíces / Esmalte": hueso alveolar translúcido y dientes/raíces en marfil brillante
            vec3 cBone = vec3(0.55, 0.42, 0.34);
            vec3 cDentin = vec3(0.92, 0.86, 0.72);
            vec3 cEnamel = vec3(1.00, 0.99, 0.96);
            vec3 col = t < 0.55 ? mix(cBone, cDentin, t / 0.55) : mix(cDentin, cEnamel, (t - 0.55) / 0.45);
            float alpha = t < 0.35 ? smoothstep(0.0, 0.35, t) * 0.14 : (0.14 + smoothstep(0.35, 0.78, t) * 0.78);
            return vec4(col, alpha * uOpacity * 1.3);
        }
        if (uPreset == 2) {
            // InVivo "Tejido Blando + Hueso": perfil facial translúcido rosado + hueso debajo
            float softThr = max(0.04, uThreshold * 0.48);
            if (v < uThreshold) {
                float st = clamp((v - softThr) / max(uThreshold - softThr, 1e-3), 0.0, 1.0);
                vec3 cSkin = vec3(0.82, 0.56, 0.48);
                return vec4(cSkin, smoothstep(0.0, 0.6, st) * 0.075);
            }
            vec3 cBone = vec3(0.84, 0.74, 0.60);
            vec3 cTooth = vec3(1.00, 0.98, 0.93);
            vec3 col = mix(cBone, cTooth, smoothstep(0.35, 0.85, t));
            return vec4(col, smoothstep(0.0, 0.18, t) * uOpacity * 1.15);
        }
        // Preset 0: Sirona GALILEOS Hueso / Dientes
        vec3 c0 = vec3(0.52, 0.31, 0.22);
        vec3 c1 = vec3(0.82, 0.64, 0.48);
        vec3 c2 = vec3(1.00, 0.97, 0.91);
        vec3 col = t < 0.45 ? mix(c0, c1, t / 0.45) : mix(c1, c2, clamp((t - 0.45) / 0.35, 0.0, 1.0));
        float a0 = smoothstep(uThreshold, uThreshold + 0.08, v) * uOpacity;
        return vec4(col, a0);
    }

    void main() {
        vec3 rd = normalize(vDirection);
        vec3 clipMinBox = uClipMin - 0.5;
        vec3 clipMaxBox = uClipMax - 0.5;
        vec2 b = hitBox(vOrigin, rd, clipMinBox, clipMaxBox);
        if (b.x > b.y) discard;
        b.x = max(b.x, 0.0);

        float dt = 1.0 / uSteps;
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float t = b.x + dt * jitter;
        vec3 L = normalize(-rd + vec3(0.25, 0.35, 0.15));

        vec4 acc = vec4(0.0);
        float mx = 0.0;
        float activeMin = uPreset == 2 ? max(0.04, uThreshold * 0.48) : uThreshold;

        for (int i = 0; i < 1200; i++) {
            if (t > b.y) break;
            vec3 pos = vOrigin + rd * t + 0.5;
            float v = sampleVol(pos);
            if (uPreset == 3) {
                mx = max(mx, v);
            } else if (v > activeMin) {
                vec4 tf = evalTransfer(v);
                float a = 1.0 - pow(1.0 - clamp(tf.a, 0.0, 0.999), 256.0 / uSteps);
                vec3 g = gradientAt(pos);
                float gl = length(g);
                vec3 n = gl > 1e-4 ? -g / gl : -rd;
                float diff = abs(dot(n, L));
                float spec = pow(max(dot(n, normalize(L - rd)), 0.0), 28.0);
                vec3 c = tf.rgb * (0.34 + 0.76 * diff) + vec3(spec * 0.22);
                acc.rgb += (1.0 - acc.a) * a * c;
                acc.a += (1.0 - acc.a) * a;
                if (acc.a > 0.97) break;
            }
            t += dt;
        }

        if (uPreset == 3) {
            float lo = uThreshold * 0.52;
            float g = clamp((mx - lo) / max(0.98 - lo, 1e-3), 0.0, 1.0);
            gl_FragColor = vec4(vec3(pow(g, 0.88)), 1.0);
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
    nervePointsNorm,
    implantsNorm,
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
    const nerveLineRef = useRef<THREE.Line | null>(null)
    const implantsGroupRef = useRef<THREE.Group | null>(null)
    const needsRenderRef = useRef(true)
    const interactingTimerRef = useRef<any>(null)
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
    const lastPinchRef = useRef<number | null>(null)
    const dragModeRef = useRef<"rotate" | "pan">("rotate")

    const [glError, setGlError] = useState<string | null>(null)
    const [contextRetryKey, setContextRetryKey] = useState<number>(0)
    const contextRetriesRef = useRef<number>(0)
    const [preset, setPreset] = useState<RenderPreset>("bone")
    const [threshold, setThreshold] = useState(0.4)
    const [viewAngleName, setViewAngleName] = useState("3D Volumétrico")

    // Recorte 3D interactivo (Clipping Box estilo InVivoViewer)
    const [showClipControls, setShowClipControls] = useState(false)
    const [clipX, setClipX] = useState<[number, number]>([0, 1])
    const [clipY, setClipY] = useState<[number, number]>([0, 1])
    const [clipZ, setClipZ] = useState<[number, number]>([0, 1])

    const requestRender = () => {
        needsRenderRef.current = true
    }

    const highSteps = () => (isMobile() ? 220 : 320)

    const markInteracting = () => {
        const mat = materialRef.current
        if (mat) mat.uniforms.uSteps.value = isMobile() ? 110 : 170
        requestRender()
        clearTimeout(interactingTimerRef.current)
        interactingTimerRef.current = setTimeout(() => {
            if (materialRef.current) materialRef.current.uniforms.uSteps.value = highSteps()
            requestRender()
        }, 160)
    }

    // 1. Inicialización de escena WebGL2 con recuperación automática ante pérdida de contexto GPU
    useEffect(() => {
        const container = mountRef.current
        if (!container) return

        setGlError(null)
        let renderer: THREE.WebGLRenderer
        try {
            renderer = new THREE.WebGLRenderer({
                antialias: false,
                alpha: false,
                preserveDrawingBuffer: true,
                powerPreference: "high-performance",
            })
            if (!renderer.capabilities.isWebGL2) throw new Error("WebGL2 no disponible")
        } catch {
            setGlError("Su navegador no soporta WebGL2, necesario para el renderizado volumétrico 3D.")
            return
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile() ? 1.2 : 1.5))
        renderer.setClearColor(0x05070f, 1)
        rendererRef.current = renderer
        container.replaceChildren(renderer.domElement)
        renderer.domElement.style.width = "100%"
        renderer.domElement.style.height = "100%"
        renderer.domElement.style.display = "block"

        let retryTimer: any = null
        let contextLost = false
        const handleContextLost = (ev: Event) => {
            ev.preventDefault()
            contextLost = true
            console.warn("[Dental3DViewer] Contexto WebGL2 perdido; intentando recuperación automática...")
            if (contextRetriesRef.current < 2) {
                contextRetriesRef.current += 1
                retryTimer = setTimeout(() => {
                    setContextRetryKey((k) => k + 1)
                }, 450)
            } else {
                setGlError("El acelerador gráfico reinició el contexto 3D. Pulse «Reintentar 3D» para restaurarlo.")
            }
        }
        const handleContextRestored = () => {
            contextLost = false
            setGlError(null)
            const mat = materialRef.current
            if (mat?.uniforms?.uVolume?.value) {
                mat.uniforms.uVolume.value.needsUpdate = true
            }
            requestRender()
        }
        renderer.domElement.addEventListener("webglcontextlost", handleContextLost)
        renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored)

        const scene = new THREE.Scene()
        sceneRef.current = scene
        const camera = new THREE.PerspectiveCamera(35, 1, 1, 3000)
        camera.position.set(0, 0, 270)
        cameraRef.current = camera

        const group = new THREE.Group()
        group.rotation.set(0.12, 0.55, 0)
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
            if (!needsRenderRef.current || contextLost) return
            needsRenderRef.current = false
            renderer.render(scene, camera)
        }
        loop()

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            clearTimeout(interactingTimerRef.current)
            clearTimeout(retryTimer)
            renderer.domElement.removeEventListener("webglcontextlost", handleContextLost)
            renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored)
            renderer.dispose()
            rendererRef.current = null
            if (container) container.innerHTML = ""
        }
    }, [contextRetryKey])

    // 2. Construcción del volumen (textura 3D + shader + overlays)
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
        setClipX([0, 1])
        setClipY([0, 1])
        setClipZ([0, 1])

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uVolume: { value: texture },
                uThreshold: { value: initialThr },
                uOpacity: { value: 0.34 },
                uSteps: { value: highSteps() },
                uPreset: { value: 0 },
                uFlipZ: { value: !volume.zUp },
                uTexel: { value: new THREE.Vector3(1 / dx, 1 / dy, 1 / dz) },
                uClipMin: { value: new THREE.Vector3(0, 0, 0) },
                uClipMax: { value: new THREE.Vector3(1, 1, 1) },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            premultipliedAlpha: true,
        })
        materialRef.current = material

        const frame = new THREE.Object3D()
        const [px, py, pz] = volume.physical
        const maxL = Math.max(px, py, pz)
        frame.scale.set((px / maxL) * 110, (py / maxL) * 110, (pz / maxL) * 110)
        frame.rotation.x = -Math.PI / 2
        frameRef.current = frame

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
        frame.add(mesh)

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
            new THREE.LineBasicMaterial({ color: 0x8a8f9c, transparent: true, opacity: 0.42, depthTest: false })
        )
        edges.renderOrder = 2
        frame.add(edges)

        const sliceGroup = new THREE.Object3D()
        const planeFill = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                color: 0xfacc15,
                transparent: true,
                opacity: 0.08,
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false,
            })
        )
        const planeEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
            new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.88, depthTest: false })
        )
        planeFill.renderOrder = 3
        planeEdges.renderOrder = 3
        sliceGroup.add(planeFill, planeEdges)
        frame.add(sliceGroup)
        slicePlaneRef.current = sliceGroup

        const focusBox = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xeab308, transparent: true, opacity: 0.95, depthTest: false })
        )
        focusBox.renderOrder = 4
        focusBox.visible = false
        frame.add(focusBox)
        focusBoxRef.current = focusBox

        // Línea 3D del canal mandibular (nervio dentario inferior)
        const nerveLine = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.98, depthTest: false })
        )
        nerveLine.renderOrder = 5
        nerveLine.visible = false
        frame.add(nerveLine)
        nerveLineRef.current = nerveLine

        // Grupo 3D de implantes virtuales calibrados
        const implantsGroup = new THREE.Group()
        implantsGroup.renderOrder = 6
        frame.add(implantsGroup)
        implantsGroupRef.current = implantsGroup

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
            nerveLineRef.current = null
            implantsGroupRef.current = null
            requestRender()
        }
    }, [volume, contextRetryKey])

    // 3. Sincronización de uniformes (umbral, preset y recorte 3D)
    useEffect(() => {
        const mat = materialRef.current
        if (!mat) return
        mat.uniforms.uThreshold.value = threshold
        mat.uniforms.uPreset.value =
            preset === "bone" ? 0 : preset === "teeth" ? 1 : preset === "soft" ? 2 : 3
        mat.uniforms.uClipMin.value.set(clipX[0], clipY[0], clipZ[0])
        mat.uniforms.uClipMax.value.set(clipX[1], clipY[1], clipZ[1])
        requestRender()
    }, [threshold, preset, clipX, clipY, clipZ, volume, contextRetryKey])

    // 4. Plano axial según el corte activo
    useEffect(() => {
        const plane = slicePlaneRef.current
        if (!plane || !volume || totalSlices <= 1) return
        const tz = (sliceIndex + 0.5) / totalSlices
        const pz = volume.zUp ? tz : 1 - tz
        plane.position.z = pz - 0.5
        requestRender()
    }, [sliceIndex, totalSlices, volume, contextRetryKey])

    // 5. Caja de la Ventana de cortes sincronizada en X, Y y altura Z [hBotNorm, hTopNorm]
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
        const z0 = (focus.hBotNorm ?? 0) - 0.5
        const z1 = (focus.hTopNorm ?? 1) - 0.5
        const pts: number[] = []
        for (const z of [z0, z1]) {
            for (let k = 0; k < 4; k++) {
                const a = corners2d[k]
                const b = corners2d[(k + 1) % 4]
                pts.push(a[0], a[1], z, b[0], b[1], z)
            }
        }
        for (let k = 0; k < 4; k++) {
            const a = corners2d[k]
            pts.push(a[0], a[1], z0, a[0], a[1], z1)
        }
        box.geometry.dispose()
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        box.geometry = g
        box.visible = true
        requestRender()
    }, [focus, volume, contextRetryKey])

    // 6. Canal del nervio dentario en 3D
    useEffect(() => {
        const line = nerveLineRef.current
        if (!line) return
        if (!nervePointsNorm || nervePointsNorm.length < 2) {
            line.visible = false
            requestRender()
            return
        }
        const pts: number[] = []
        for (const [nx, ny, nh] of nervePointsNorm) {
            pts.push(nx - 0.5, ny - 0.5, nh - 0.5)
        }
        line.geometry.dispose()
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        line.geometry = g
        line.visible = true
        requestRender()
    }, [nervePointsNorm, contextRetryKey])

    // 7. Implantes dentales virtuales en 3D
    useEffect(() => {
        const grp = implantsGroupRef.current
        if (!grp) return
        while (grp.children.length > 0) {
            const ch = grp.children[0] as THREE.Mesh
            ch.geometry?.dispose?.()
            ;(ch.material as THREE.Material)?.dispose?.()
            grp.remove(ch)
        }
        if (implantsNorm && implantsNorm.length > 0) {
            const upAxis = new THREE.Vector3(0, 1, 0)
            for (const imp of implantsNorm) {
                const v0 = new THREE.Vector3(imp.p0[0] - 0.5, imp.p0[1] - 0.5, imp.p0[2] - 0.5)
                const v1 = new THREE.Vector3(imp.p1[0] - 0.5, imp.p1[1] - 0.5, imp.p1[2] - 0.5)
                const dir = new THREE.Vector3().subVectors(v1, v0)
                const len = Math.max(0.01, dir.length())
                const mid = new THREE.Vector3().addVectors(v0, v1).multiplyScalar(0.5)
                const geom = new THREE.CylinderGeometry(imp.radiusNorm, imp.radiusNorm * 0.78, len, 16)
                const mat = new THREE.MeshBasicMaterial({
                    color: imp.isDanger ? 0xef4444 : 0x38bdf8,
                    transparent: true,
                    opacity: 0.78,
                    depthTest: false,
                })
                const mesh = new THREE.Mesh(geom, mat)
                mesh.position.copy(mid)
                mesh.quaternion.setFromUnitVectors(upAxis, dir.clone().normalize())
                mesh.renderOrder = 6
                grp.add(mesh)
            }
        }
        requestRender()
    }, [implantsNorm, contextRetryKey])

    // Interacción táctil y ratón
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
        setClipX([0, 1])
        setClipY([0, 1])
        setClipZ([0, 1])
        setPresetAngle("3D Volumétrico", 0.12, 0.55)
    }

    const stop = (e: React.SyntheticEvent) => e.stopPropagation()
    const isClipped = clipX[0] > 0 || clipX[1] < 1 || clipY[0] > 0 || clipY[1] < 1 || clipZ[0] > 0 || clipZ[1] < 1

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
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-slate-400 hover:text-white" onClick={resetView} title="Restablecer vista y recorte 3D">
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

            {/* Estado de reconstrucción / recuperación de contexto WebGL2 */}
            {(!volume || glError || error) && (
                <div className="absolute inset-0 top-7 flex flex-col items-center justify-center gap-2 bg-slate-950/95 z-20 text-center px-4">
                    {glError || error ? (
                        <>
                            <AlertCircle className="h-6 w-6 text-rose-400" />
                            <p className="text-xs text-slate-300 max-w-xs">{glError || error}</p>
                            {glError && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="mt-1 h-7 px-3 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
                                    onClick={() => {
                                        contextRetriesRef.current = 0
                                        setGlError(null)
                                        setContextRetryKey((k) => k + 1)
                                    }}
                                >
                                    Reintentar vista 3D
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
                            <p className="text-xs text-slate-300">{status || "Preparando reconstrucción volumétrica 3D..."}</p>
                        </>
                    )}
                </div>
            )}

            {/* Panel flotante de Recorte 3D (Clipping Box estilo InVivoViewer) */}
            {volume && !glError && showClipControls && (
                <div
                    className="absolute bottom-11 left-2 z-20 w-56 bg-slate-950/95 border border-slate-700 rounded-lg p-2.5 text-[10px] text-slate-200 shadow-2xl space-y-2 backdrop-blur-md"
                    onPointerDown={stop}
                    onWheel={stop}
                >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                        <span className="font-semibold text-amber-300 flex items-center gap-1">
                            <Scissors className="h-3 w-3" /> Recorte 3D (Clipping)
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setClipX([0, 1])
                                setClipY([0, 1])
                                setClipZ([0, 1])
                            }}
                            className="text-[9px] text-cyan-400 hover:underline"
                        >
                            Restaurar
                        </button>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-slate-400">
                            <span>Izq / Der (X)</span>
                            <span>{Math.round(clipX[0] * 100)}% – {Math.round(clipX[1] * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <input type="range" min={0} max={0.9} step={0.02} value={clipX[0]} onChange={(e) => setClipX([Math.min(parseFloat(e.target.value), clipX[1] - 0.08), clipX[1]])} className="w-1/2 accent-amber-500" />
                            <input type="range" min={0.1} max={1} step={0.02} value={clipX[1]} onChange={(e) => setClipX([clipX[0], Math.max(parseFloat(e.target.value), clipX[0] + 0.08)])} className="w-1/2 accent-amber-500" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-slate-400">
                            <span>Ant / Post (Y)</span>
                            <span>{Math.round(clipY[0] * 100)}% – {Math.round(clipY[1] * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <input type="range" min={0} max={0.9} step={0.02} value={clipY[0]} onChange={(e) => setClipY([Math.min(parseFloat(e.target.value), clipY[1] - 0.08), clipY[1]])} className="w-1/2 accent-amber-500" />
                            <input type="range" min={0.1} max={1} step={0.02} value={clipY[1]} onChange={(e) => setClipY([clipY[0], Math.max(parseFloat(e.target.value), clipY[0] + 0.08)])} className="w-1/2 accent-amber-500" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-slate-400">
                            <span>Inf / Sup (Z)</span>
                            <span>{Math.round(clipZ[0] * 100)}% – {Math.round(clipZ[1] * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <input type="range" min={0} max={0.9} step={0.02} value={clipZ[0]} onChange={(e) => setClipZ([Math.min(parseFloat(e.target.value), clipZ[1] - 0.08), clipZ[1]])} className="w-1/2 accent-amber-500" />
                            <input type="range" min={0.1} max={1} step={0.02} value={clipZ[1]} onChange={(e) => setClipZ([clipZ[0], Math.max(parseFloat(e.target.value), clipZ[0] + 0.08)])} className="w-1/2 accent-amber-500" />
                        </div>
                    </div>
                </div>
            )}

            {/* Controles inferiores: Presets GALILEOS / InVivo + Recorte 3D + Umbral */}
            {volume && !glError && (
                <div
                    className="absolute bottom-2 left-2 z-10 flex flex-wrap items-center gap-1.5 bg-slate-950/85 border border-slate-800 rounded-md px-2 py-1 text-[10px] text-slate-300 backdrop-blur-sm max-w-[95%]"
                    onPointerDown={stop}
                    onWheel={stop}
                >
                    <div className="flex rounded overflow-hidden border border-slate-700">
                        {(
                            [
                                { id: "bone", label: "Hueso", title: "Render óseo/dental estilo GALILEOS" },
                                { id: "teeth", label: "Raíces", title: "Hueso translúcido + raíces y esmalte opacos (estilo InVivo)" },
                                { id: "soft", label: "Tejido", title: "Perfil facial translúcido sobre hueso (estilo InVivo)" },
                                { id: "mip", label: "Rx MIP", title: "Proyección radiográfica MIP (Cefalometría 3D)" },
                            ] as const
                        ).map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`px-1.5 py-0.5 transition-colors ${
                                    preset === item.id ? "bg-amber-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                                }`}
                                onClick={() => setPreset(item.id)}
                                title={item.title}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowClipControls((v) => !v)}
                        className={`px-1.5 py-0.5 rounded border flex items-center gap-1 transition-colors ${
                            showClipControls || isClipped
                                ? "bg-amber-600/30 border-amber-500/60 text-amber-200"
                                : "border-slate-700 text-slate-400 hover:text-white"
                        }`}
                        title="Recortar el volumen 3D para aislar piezas dentales o retirar columna cervical"
                    >
                        <Scissors className="h-2.5 w-2.5" />
                        <span className="hidden sm:inline">Recorte</span>
                    </button>

                    <label className="flex items-center gap-1">
                        <span className="hidden xl:inline text-slate-400">Umbral</span>
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
                            className="w-16 sm:w-24 accent-amber-500"
                            title="Umbral de densidad ósea"
                        />
                    </label>
                </div>
            )}

            <div className="absolute bottom-2 right-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] text-slate-400 hidden xl:block">
                Arrastre: rotar · Shift/Der: mover · Rueda: zoom
            </div>
        </div>
    )
}
