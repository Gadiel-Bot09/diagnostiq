// @ts-nocheck
"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { Button } from "@/components/ui/button"
import { RotateCcw, Eye, Compass, Box } from "lucide-react"

export interface Dental3DViewerProps {
    sliceIndex: number
    totalSlices: number
    onSliceChange?: (slice: number) => void
    isExpanded?: boolean
    onToggleExpand?: () => void
}

export function Dental3DViewer({
    sliceIndex,
    totalSlices,
    onSliceChange,
    isExpanded,
    onToggleExpand,
}: Dental3DViewerProps) {
    const mountRef = useRef<HTMLDivElement>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const slicePlaneRef = useRef<THREE.Mesh | null>(null)
    const modelGroupRef = useRef<THREE.Group | null>(null)

    // Estado de interacción orbital
    const isDraggingRef = useRef(false)
    const previousMousePositionRef = useRef({ x: 0, y: 0 })
    const rotationVelocityRef = useRef({ x: 0, y: 0 })
    const [viewAngleName, setViewAngleName] = useState("3D Volumétrico")

    useEffect(() => {
        const container = mountRef.current
        if (!container) return

        // 1. Inicializar Escena, Cámara y Renderizador WebGL
        const width = container.clientWidth || 300
        const height = container.clientHeight || 250

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x05070f) // Fondo negro azulado médico
        sceneRef.current = scene

        const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000)
        camera.position.set(0, 35, 140)
        cameraRef.current = camera

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setSize(width, height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.shadowMap.enabled = true
        rendererRef.current = renderer

        container.replaceChildren(renderer.domElement)

        // 2. Iluminación Anatómica Médica
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.85)
        scene.add(ambientLight)

        const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.4)
        keyLight.position.set(50, 80, 80)
        scene.add(keyLight)

        const fillLight = new THREE.DirectionalLight(0x90b0e0, 0.8)
        fillLight.position.set(-60, 20, -50)
        scene.add(fillLight)

        const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.6)
        rimLight.position.set(0, -50, 40)
        scene.add(rimLight)

        // 3. Grupo Principal del Modelo
        const modelGroup = new THREE.Group()
        scene.add(modelGroup)
        modelGroupRef.current = modelGroup

        // 4. Construcción Anatómica del Maxilar, Mandíbula y Dientes
        // Material Óseo y Dental (Textura de Hueso Cortical / Esmalte)
        const boneMaterial = new THREE.MeshStandardMaterial({
            color: 0xdfd3bf, // Tono marfil óseo
            roughness: 0.38,
            metalness: 0.08,
            flatShading: false,
        })

        const teethMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5f3ed, // Tono blanco esmalte dental
            roughness: 0.22,
            metalness: 0.04,
        })

        const internalSinusMaterial = new THREE.MeshStandardMaterial({
            color: 0x8a7d6b,
            roughness: 0.7,
            metalness: 0.05,
        })

        // A. Maxilar Superior y Base del Cráneo Facial
        const maxillaCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-32, 12, -22),
            new THREE.Vector3(-26, 13, -2),
            new THREE.Vector3(-15, 14, 15),
            new THREE.Vector3(0, 14, 20),
            new THREE.Vector3(15, 14, 15),
            new THREE.Vector3(26, 13, -2),
            new THREE.Vector3(32, 12, -22),
        ])
        const maxillaGeo = new THREE.TubeGeometry(maxillaCurve, 40, 6.5, 16, false)
        const maxillaMesh = new THREE.Mesh(maxillaGeo, boneMaterial)
        modelGroup.add(maxillaMesh)

        // Senos Maxilares (Cavidades óseas superiores)
        const sinusGeo = new THREE.SphereGeometry(11, 16, 16)
        sinusGeo.scale(1.2, 0.8, 1.4)
        const leftSinus = new THREE.Mesh(sinusGeo, internalSinusMaterial)
        leftSinus.position.set(-16, 22, -2)
        modelGroup.add(leftSinus)

        const rightSinus = new THREE.Mesh(sinusGeo, internalSinusMaterial)
        rightSinus.position.set(16, 22, -2)
        modelGroup.add(rightSinus)

        // Tabique Nasal y Espina Nasal Anterior
        const septumGeo = new THREE.BoxGeometry(3, 18, 16)
        const septumMesh = new THREE.Mesh(septumGeo, boneMaterial)
        septumMesh.position.set(0, 24, 8)
        modelGroup.add(septumMesh)

        // B. Mandíbula (Hueso Mandibular con Mentón y Ramas Ascendentes)
        const mandibleCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-34, -4, -26),
            new THREE.Vector3(-28, -8, -6),
            new THREE.Vector3(-16, -10, 14),
            new THREE.Vector3(0, -11, 22), // Mentón
            new THREE.Vector3(16, -10, 14),
            new THREE.Vector3(28, -8, -6),
            new THREE.Vector3(34, -4, -26),
        ])
        const mandibleGeo = new THREE.TubeGeometry(mandibleCurve, 40, 6.2, 16, false)
        const mandibleMesh = new THREE.Mesh(mandibleGeo, boneMaterial)
        modelGroup.add(mandibleMesh)

        // Ramas mandibulares ascendentes (hacia cóndilos)
        const ramusGeo = new THREE.CylinderGeometry(4.5, 5.5, 26, 12)
        const leftRamus = new THREE.Mesh(ramusGeo, boneMaterial)
        leftRamus.position.set(-34, 8, -26)
        leftRamus.rotation.x = -0.15
        leftRamus.rotation.z = -0.08
        modelGroup.add(leftRamus)

        const rightRamus = new THREE.Mesh(ramusGeo, boneMaterial)
        rightRamus.position.set(34, 8, -26)
        rightRamus.rotation.x = -0.15
        rightRamus.rotation.z = 0.08
        modelGroup.add(rightRamus)

        // C. Piezas Dentales Individuales (Superiores e Inferiores con Coronas y Raíces)
        const toothCount = 14
        for (let i = 0; i <= toothCount; i++) {
            const t = i / toothCount
            // Dientes Superiores
            const ptSup = maxillaCurve.getPoint(t)
            const toothHeight = 6.5 + Math.sin(t * Math.PI) * 2.5
            const toothRadius = i === 7 ? 2.2 : i > 2 && i < 12 ? 2.0 : 3.0

            const toothGeo = new THREE.ConeGeometry(toothRadius, toothHeight, 10)
            const toothMesh = new THREE.Mesh(toothGeo, teethMaterial)
            toothMesh.position.set(ptSup.x, ptSup.y - 2.5, ptSup.z)
            toothMesh.rotation.x = Math.PI // Apuntando hacia abajo
            toothMesh.rotation.y = (t - 0.5) * 0.4
            modelGroup.add(toothMesh)

            // Dientes Inferiores
            const ptInf = mandibleCurve.getPoint(t)
            const toothInfGeo = new THREE.ConeGeometry(toothRadius * 0.95, toothHeight * 0.95, 10)
            const toothInfMesh = new THREE.Mesh(toothInfGeo, teethMaterial)
            toothInfMesh.position.set(ptInf.x, ptInf.y + 2.5, ptInf.z)
            toothInfMesh.rotation.y = (t - 0.5) * 0.4
            modelGroup.add(toothInfMesh)
        }

        // 5. Caja Delimitadora 3D del Volumen (Bounding Box estilo GALILEOS en amarillo)
        const boxGeo = new THREE.BoxGeometry(76, 68, 76)
        const boxEdges = new THREE.EdgesGeometry(boxGeo)
        const boxLine = new THREE.LineSegments(
            boxEdges,
            new THREE.LineBasicMaterial({ color: 0xeab308, linewidth: 1.5, transparent: true, opacity: 0.65 })
        )
        modelGroup.add(boxLine)

        // 6. Plano de Corte Dinámico 3D (Plano Amarillo que se desplaza con sliceIndex)
        const planeGeo = new THREE.PlaneGeometry(74, 74)
        const planeMat = new THREE.MeshBasicMaterial({
            color: 0xfacc15,
            transparent: true,
            opacity: 0.22,
            side: THREE.DoubleSide,
            depthWrite: false,
        })
        const slicePlane = new THREE.Mesh(planeGeo, planeMat)
        slicePlane.rotation.x = Math.PI / 2
        modelGroup.add(slicePlane)
        slicePlaneRef.current = slicePlane

        // Plano de borde del corte
        const planeEdgeGeo = new THREE.EdgesGeometry(planeGeo)
        const planeEdge = new THREE.LineSegments(
            planeEdgeGeo,
            new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2, transparent: true, opacity: 0.85 })
        )
        slicePlane.add(planeEdge)

        // 7. Bucle de Renderizado
        let animationFrameId: number
        const animate = () => {
            animationFrameId = requestAnimationFrame(animate)

            // Rotación suave automática o inercia
            if (!isDraggingRef.current && modelGroupRef.current) {
                modelGroupRef.current.rotation.y += rotationVelocityRef.current.x
                modelGroupRef.current.rotation.x += rotationVelocityRef.current.y
                rotationVelocityRef.current.x *= 0.94
                rotationVelocityRef.current.y *= 0.94
            }

            renderer.render(scene, camera)
        }
        animate()

        // 8. Manejo de Redimensionamiento
        const handleResize = () => {
            if (!container || !renderer || !camera) return
            const w = container.clientWidth
            const h = container.clientHeight
            camera.aspect = w / h
            camera.updateProjectionMatrix()
            renderer.setSize(w, h)
        }
        window.addEventListener("resize", handleResize)

        return () => {
            cancelAnimationFrame(animationFrameId)
            window.removeEventListener("resize", handleResize)
            renderer.dispose()
            if (container) container.innerHTML = ""
        }
    }, [])

    // Sincronizar plano de corte amarillo en el espacio 3D según el corte actual
    useEffect(() => {
        if (!slicePlaneRef.current || totalSlices <= 1) return
        const normalized = (sliceIndex / Math.max(1, totalSlices - 1)) - 0.5 // Rango [-0.5, 0.5]
        const yPos = -normalized * 60 // Altura dentro de la caja de 68 unidades
        slicePlaneRef.current.position.y = yPos
    }, [sliceIndex, totalSlices])

    // Interacción orbital por arrastre de ratón o toque
    const handlePointerDown = (e: React.PointerEvent) => {
        isDraggingRef.current = true
        previousMousePositionRef.current = { x: e.clientX, y: e.clientY }
        rotationVelocityRef.current = { x: 0, y: 0 }
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current || !modelGroupRef.current) return
        const deltaX = e.clientX - previousMousePositionRef.current.x
        const deltaY = e.clientY - previousMousePositionRef.current.y
        previousMousePositionRef.current = { x: e.clientX, y: e.clientY }

        modelGroupRef.current.rotation.y += deltaX * 0.012
        modelGroupRef.current.rotation.x += deltaY * 0.012

        // Limitar rotación en X para no voltear completamente
        modelGroupRef.current.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, modelGroupRef.current.rotation.x))

        rotationVelocityRef.current = {
            x: deltaX * 0.003,
            y: deltaY * 0.003,
        }
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        isDraggingRef.current = false
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
    }

    // Zoom con rueda de ratón en 3D
    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation()
        if (!cameraRef.current) return
        const zoomDelta = e.deltaY * 0.08
        cameraRef.current.position.z = Math.max(60, Math.min(220, cameraRef.current.position.z + zoomDelta))
    }

    // Vistas Predefinidas (Frente, Derecha, Izquierda, Oclusal)
    const setPresetAngle = (name: string, rotX: number, rotY: number) => {
        if (!modelGroupRef.current) return
        modelGroupRef.current.rotation.set(rotX, rotY, 0)
        rotationVelocityRef.current = { x: 0, y: 0 }
        setViewAngleName(name)
    }

    return (
        <div className="relative w-full h-full flex flex-col bg-slate-950 overflow-hidden select-none">
            {/* Header del Panel 3D */}
            <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border-b border-slate-800 z-10 text-[11px] shrink-0">
                <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 text-[10px]">
                        3D
                    </span>
                    <span className="text-slate-300 font-medium truncate">{viewAngleName}</span>
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => setPresetAngle("Frente", 0, 0)}
                        title="Vista Frontal"
                    >
                        Frente
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => setPresetAngle("Lateral D", 0, -Math.PI / 2)}
                        title="Vista Lateral Derecha"
                    >
                        Der
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => setPresetAngle("Lateral I", 0, Math.PI / 2)}
                        title="Vista Lateral Izquierda"
                    >
                        Izq
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                        onClick={() => setPresetAngle("Oclusal", Math.PI / 2.5, 0)}
                        title="Vista Superior Oclusal"
                    >
                        Oclusal
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
                className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing touch-none"
            />

            {/* HUD / Indicadores de Orientación Anatómica en las esquinas */}
            <div className="absolute top-8 right-2 pointer-events-none z-10 flex flex-col items-center bg-slate-950/70 border border-slate-800 rounded px-1.5 py-1 backdrop-blur-xs text-[9px] font-mono text-amber-400 shadow">
                <Compass className="h-3 w-3 mb-0.5 animate-spin-slow" />
                <span>3D ORBIT</span>
            </div>

            <div className="absolute bottom-2 left-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-400 shadow">
                <span className="text-amber-400 font-bold">S</span> · <span className="text-amber-400 font-bold">P</span> · <span className="text-amber-400 font-bold">L</span>
            </div>

            <div className="absolute bottom-2 right-2 pointer-events-none z-10 bg-slate-950/70 border border-slate-800 rounded px-1.5 py-0.5 text-[9px] text-slate-400">
                Arrastre: Rotar · Rueda: Zoom
            </div>
        </div>
    )
}
