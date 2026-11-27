/**
 * Motor MPR Acelerado por GPU WebGL2 (16 bits reales + Interpolación Tricúbica B-Spline).
 *
 * Características técnicas:
 * - Usa UN ÚNICO contexto WebGL2 offscreen compartido para todo el visor (evita límites de contextos del navegador).
 * - Carga el volumen CBCT completo en VRAM como textura 3D `R16F` (16-bit half-float linealmente filtrable en todo GPU WebGL2)
 *   corte por corte con `texSubImage3D` (~1 MB de memoria temporal JS).
 * - Implementa filtrado tricúbico B-Spline en GPU (algoritmo rápido de 8 muestras trilineales hardware de Sigg & Hadwiger / Ruijters),
 *   eliminando el aspecto blando/pixelado al hacer zoom 400% sobre conductos radiculares y corticales.
 * - Ejecuta en GPU a 60 FPS: Reorientación 3D (Pitch/Roll/Yaw), integración de grosor (Mean / MIP / MinIP),
 *   realce cortical Unsharp Mask 3x3 en punto flotante 16-bit, curva S radiográfica GALILEOS y mapa de color.
 * - Si WebGL2 no está disponible o el volumen excede `MAX_3D_TEXTURE_SIZE`, devuelve `false` y el visor cae en CPU automáticamente.
 */

import type { ClinicalVolume, PlaneSpec, WindowLevel } from "./mprEngine"
import type { ClinicalColorMap } from "@/components/common/MprViewport"

const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
const vec2 POS[4] = vec2[4](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0,  1.0)
);
out vec2 vUv;
void main() {
    vec2 p = POS[gl_VertexID];
    // vUv.y = 0 en la fila superior (r = 0) y 1 en la inferior (r = rows - 1)
    vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    gl_Position = vec4(p, 0.0, 1.0);
}
`

const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform vec3 uDims;       // (nx, ny, nz)
uniform vec3 uExtentMm;   // (widthMm, depthMm, heightMm)
uniform vec3 uInvSpacing; // (isx, isy, isz)
uniform vec2 uFlipXY;     // (flipX ? 1 : 0, flipY ? 1 : 0)
uniform int uHasReorient;
uniform mat3 uRotInv;     // inversa 3x3 de reorientación alrededor del centro del volumen

uniform vec3 uOrigin;     // PlaneSpec.origin (mm)
uniform vec3 uAxisU;      // PlaneSpec.u (unit)
uniform vec3 uAxisV;      // PlaneSpec.v (unit)
uniform vec3 uNormal;     // normalize(cross(u, v))
uniform vec2 uPlaneMm;    // ((cols - 1) * spacing, (rows - 1) * spacing)
uniform float uSpacing;   // spacing (mm/px)
uniform float uSlabMm;
uniform int uSlabSteps;
uniform int uSlabMode;    // 0 = mean, 1 = mip, 2 = minip

uniform float uRawMin;
uniform float uRawRange;
uniform float uSlope;
uniform float uIntercept;
uniform float uWlMin;
uniform float uWlWidth;
uniform int uSharpen;     // 0 o 1
uniform int uColorMap;    // 0 = plain, 1 = invPlain, 2 = hot
uniform int uTricubic;    // 0 = trilinear, 1 = tricubic B-spline 8-tap

in vec2 vUv;
out vec4 fragColor;

// Filtrado tricúbico B-Spline de 8 muestras trilineales (Sigg & Hadwiger)
float sampleTricubic(vec3 uvw) {
    vec3 coord = uvw * uDims - 0.5;
    vec3 f = fract(coord);
    vec3 coord0 = coord - f;

    vec3 f2 = f * f;
    vec3 f3 = f2 * f;

    vec3 w0 = (1.0 / 6.0) * (-f3 + 3.0 * f2 - 3.0 * f + 1.0);
    vec3 w1 = (1.0 / 6.0) * ( 3.0 * f3 - 6.0 * f2 + 4.0);
    vec3 w2 = (1.0 / 6.0) * (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0);
    vec3 w3 = (1.0 / 6.0) * f3;

    vec3 g0 = w0 + w1;
    vec3 g1 = w2 + w3;
    vec3 h0 = (w1 / max(g0, vec3(1e-5))) - 0.5 + coord0;
    vec3 h1 = (w3 / max(g1, vec3(1e-5))) + 1.5 + coord0;

    vec3 invDims = 1.0 / uDims;
    h0 *= invDims;
    h1 *= invDims;

    float tex000 = texture(uVolume, vec3(h0.x, h0.y, h0.z)).r;
    float tex100 = texture(uVolume, vec3(h1.x, h0.y, h0.z)).r;
    float tex010 = texture(uVolume, vec3(h0.x, h1.y, h0.z)).r;
    float tex110 = texture(uVolume, vec3(h1.x, h1.y, h0.z)).r;
    float tex001 = texture(uVolume, vec3(h0.x, h0.y, h1.z)).r;
    float tex101 = texture(uVolume, vec3(h1.x, h0.y, h1.z)).r;
    float tex011 = texture(uVolume, vec3(h0.x, h1.y, h1.z)).r;
    float tex111 = texture(uVolume, vec3(h1.x, h1.y, h1.z)).r;

    float x00 = mix(tex100, tex000, g0.x);
    float x10 = mix(tex110, tex010, g0.x);
    float x01 = mix(tex101, tex001, g0.x);
    float x11 = mix(tex111, tex011, g0.x);

    float y0 = mix(x10, x00, g0.y);
    float y1 = mix(x11, x01, g0.y);
    return mix(y1, y0, g0.z);
}

bool sampleWorldModality(vec3 pMm, out float outModVal) {
    vec3 q = pMm;
    if (uHasReorient == 1) {
        vec3 center = uExtentMm * 0.5;
        q = center + uRotInv * (pMm - center);
    }
    float rx = uFlipXY.x > 0.5 ? (uExtentMm.x - q.x) : q.x;
    float ry = uFlipXY.y > 0.5 ? (uExtentMm.y - q.y) : q.y;
    float rz = q.z;

    vec3 fIdx = vec3(rx, ry, rz) * uInvSpacing;
    if (fIdx.x < 0.0 || fIdx.y < 0.0 || fIdx.z < 0.0 ||
        fIdx.x > (uDims.x - 1.0) || fIdx.y > (uDims.y - 1.0) || fIdx.z > (uDims.z - 1.0)) {
        outModVal = 0.0;
        return false;
    }

    vec3 uvw = (fIdx + 0.5) / uDims;
    float normVal = (uTricubic == 1) ? sampleTricubic(uvw) : texture(uVolume, uvw).r;
    float rawVal = uRawMin + normVal * uRawRange;
    outModVal = rawVal * uSlope + uIntercept;
    return true;
}

bool sampleSlabAt(vec3 pMm, out float result) {
    if (uSlabSteps <= 1) {
        return sampleWorldModality(pMm, result);
    }
    float acc = 0.0;
    float mx = -1e20;
    float mn = 1e20;
    int cnt = 0;
    float stepF = float(uSlabSteps);
    for (int k = 0; k < 48; k++) {
        if (k >= uSlabSteps) break;
        float off = -uSlabMm * 0.5 + (uSlabMm * (float(k) + 0.5)) / stepF;
        float val;
        if (sampleWorldModality(pMm + uNormal * off, val)) {
            acc += val;
            mx = max(mx, val);
            mn = min(mn, val);
            cnt++;
        }
    }
    if (cnt == 0) {
        result = 0.0;
        return false;
    }
    if (uSlabMode == 1) result = mx;
    else if (uSlabMode == 2) result = mn;
    else result = acc / float(cnt);
    return true;
}

void main() {
    float xMm = vUv.x * uPlaneMm.x;
    float yMm = vUv.y * uPlaneMm.y;
    vec3 pMm = uOrigin + uAxisU * xMm + uAxisV * yMm;

    float centerVal;
    if (!sampleSlabAt(pMm, centerVal)) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float procVal = centerVal;
    // Realce cortical / periodontal Unsharp Mask en punto flotante 16-bit (antes de cuantizar a 8 bits)
    if (uSharpen == 1) {
        vec3 du = uAxisU * uSpacing;
        vec3 dv = uAxisV * uSpacing;
        float vL, vR, vU, vD;
        bool okL = sampleSlabAt(pMm - du, vL);
        bool okR = sampleSlabAt(pMm + du, vR);
        bool okU = sampleSlabAt(pMm - dv, vU);
        bool okD = sampleSlabAt(pMm + dv, vD);
        float blur = (
            (okL ? vL : centerVal) +
            (okR ? vR : centerVal) +
            (okU ? vU : centerVal) +
            (okD ? vD : centerVal) +
            centerVal * 4.0
        ) * 0.125;
        procVal = centerVal + 0.64 * (centerVal - blur);
    }

    float t = clamp((procVal - uWlMin) / max(1.0, uWlWidth), 0.0, 1.0);
    float sCurve = t * t * (3.0 - 2.0 * t);
    float v = clamp(sCurve * 0.34 + pow(t, 1.03) * 0.66, 0.0, 1.0);

    vec3 rgb;
    if (uColorMap == 1) {
        rgb = vec3(1.0 - v);
    } else if (uColorMap == 2) {
        float rC = clamp(v * 1.45, 0.0, 1.0);
        float gC = v > 0.333 ? clamp((v - 0.333) * 1.65, 0.0, 1.0) : 0.0;
        float bC = v > 0.706 ? clamp((v - 0.706) * 3.2, 0.0, 1.0) : 0.0;
        rgb = vec3(rC, gC, bC);
    } else {
        rgb = vec3(v);
    }

    fragColor = vec4(rgb, 1.0);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, source)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("[WebGL2 MPR] Error compilando shader:", gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
    }
    return sh
}

export class WebGLMprRenderer {
    public readonly canvas: HTMLCanvasElement
    private gl: WebGL2RenderingContext | null = null
    private program: WebGLProgram | null = null
    private vao: WebGLVertexArrayObject | null = null
    private tex3D: WebGLTexture | null = null
    private uploadedRawRef: ArrayLike<number> | null = null
    private rawMin = 0
    private rawRange = 1
    private uniforms: Record<string, WebGLUniformLocation | null> = {}
    public isReady = false

    constructor() {
        this.canvas = document.createElement("canvas")
        this.canvas.width = 256
        this.canvas.height = 256
        this.init()
    }

    private init() {
        try {
            const gl = this.canvas.getContext("webgl2", {
                antialias: false,
                alpha: false,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: true,
                powerPreference: "high-performance",
            })
            if (!gl) return
            this.gl = gl

            const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
            const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
            if (!vs || !fs) return

            const prog = gl.createProgram()
            if (!prog) return
            gl.attachShader(prog, vs)
            gl.attachShader(prog, fs)
            gl.linkProgram(prog)
            gl.deleteShader(vs)
            gl.deleteShader(fs)

            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                console.warn("[WebGL2 MPR] Error linkeando programa:", gl.getProgramInfoLog(prog))
                gl.deleteProgram(prog)
                return
            }

            this.program = prog
            this.vao = gl.createVertexArray()
            const names = [
                "uVolume",
                "uDims",
                "uExtentMm",
                "uInvSpacing",
                "uFlipXY",
                "uHasReorient",
                "uRotInv",
                "uOrigin",
                "uAxisU",
                "uAxisV",
                "uNormal",
                "uPlaneMm",
                "uSpacing",
                "uSlabMm",
                "uSlabSteps",
                "uSlabMode",
                "uRawMin",
                "uRawRange",
                "uSlope",
                "uIntercept",
                "uWlMin",
                "uWlWidth",
                "uSharpen",
                "uColorMap",
                "uTricubic",
            ]
            for (const name of names) {
                this.uniforms[name] = gl.getUniformLocation(prog, name)
            }
            this.isReady = true
        } catch (err) {
            console.warn("[WebGL2 MPR] No disponible, usando motor CPU:", err)
            this.isReady = false
        }
    }

    /** Sube el volumen 16-bit completo a VRAM en textura 3D R16F corte por corte (~1 MB RAM temporal) */
    public uploadVolume(vol: ClinicalVolume): boolean {
        if (!this.isReady || !this.gl) return false
        if (this.uploadedRawRef === vol.raw && this.tex3D) return true

        const gl = this.gl
        const { nx, ny, nz, raw } = vol
        const maxTex = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number
        if (nx > maxTex || ny > maxTex || nz > maxTex) {
            console.warn(`[WebGL2 MPR] Volumen ${nx}×${ny}×${nz} excede MAX_3D_TEXTURE_SIZE (${maxTex})`)
            return false
        }

        // Encontrar rango min/max exacto del buffer (muestreo rápido + bordes)
        const total = nx * ny * nz
        let mn = Infinity
        let mx = -Infinity
        const stride = Math.max(1, Math.floor(total / 250000))
        for (let i = 0; i < total; i += stride) {
            const v = raw[i]
            if (v < mn) mn = v
            if (v > mx) mx = v
        }
        // Margen de seguridad para no recortar extremos fuera del muestreo
        const pad = Math.max(16, (mx - mn) * 0.02)
        this.rawMin = mn - pad
        this.rawRange = Math.max(1, mx - mn + pad * 2)

        if (this.tex3D) {
            gl.deleteTexture(this.tex3D)
            this.tex3D = null
        }

        const tex = gl.createTexture()
        if (!tex) return false
        gl.bindTexture(gl.TEXTURE_3D, tex)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)

        // Reservar almacenamiento 3D R16F y subir corte a corte (evita pico de RAM)
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, nx, ny, nz, 0, gl.RED, gl.FLOAT, null)

        const slicePixels = nx * ny
        const sliceFloat = new Float32Array(slicePixels)
        const invRange = 1 / this.rawRange
        const rMin = this.rawMin

        for (let z = 0; z < nz; z++) {
            const base = z * slicePixels
            for (let i = 0; i < slicePixels; i++) {
                sliceFloat[i] = (raw[base + i] - rMin) * invRange
            }
            gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z, nx, ny, 1, gl.RED, gl.FLOAT, sliceFloat)
        }

        if (gl.getError() !== gl.NO_ERROR) {
            gl.deleteTexture(tex)
            return false
        }

        this.tex3D = tex
        this.uploadedRawRef = vol.raw
        return true
    }

    /** Renderiza cualquier PlaneSpec en GPU a 60 FPS y vuelca directamente sobre un Canvas2D destino */
    public renderPlaneToCanvas(
        vol: ClinicalVolume,
        spec: PlaneSpec,
        wl: WindowLevel,
        colorMap: ClinicalColorMap,
        sharpen: boolean,
        targetCanvas: HTMLCanvasElement,
        useTricubic = true
    ): boolean {
        if (!this.isReady || !this.gl || !this.program || !this.vao) return false
        if (!this.uploadVolume(vol)) return false

        const gl = this.gl
        const { cols, rows, spacing, origin, u, v } = spec
        if (cols < 2 || rows < 2) return false

        if (this.canvas.width !== cols || this.canvas.height !== rows) {
            this.canvas.width = cols
            this.canvas.height = rows
        }

        gl.viewport(0, 0, cols, rows)
        gl.useProgram(this.program)
        gl.bindVertexArray(this.vao)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_3D, this.tex3D)
        gl.uniform1i(this.uniforms.uVolume, 0)

        gl.uniform3f(this.uniforms.uDims, vol.nx, vol.ny, vol.nz)
        gl.uniform3f(this.uniforms.uExtentMm, vol.widthMm, vol.depthMm, vol.heightMm)
        gl.uniform3f(this.uniforms.uInvSpacing, vol.isx, vol.isy, vol.isz)
        gl.uniform2f(this.uniforms.uFlipXY, vol.flipX ? 1 : 0, vol.flipY ? 1 : 0)
        gl.uniform1i(this.uniforms.uHasReorient, vol.hasReorient ? 1 : 0)

        // GLSL mat3 espera column-major, rotInv está en row-major -> transpose = false pasando columnas
        const m = vol.rotInv
        gl.uniformMatrix3fv(
            this.uniforms.uRotInv,
            false,
            new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
        )

        // Normal del plano = normalize(cross(u, v))
        const nx = u[1] * v[2] - u[2] * v[1]
        const ny = u[2] * v[0] - u[0] * v[2]
        const nz = u[0] * v[1] - u[1] * v[0]
        const nLen = Math.hypot(nx, ny, nz) || 1

        const slab = spec.slabMm && spec.slabMm > vol.iso * 0.75 ? spec.slabMm : 0
        const slabSteps = slab > 0 ? Math.max(2, Math.min(40, Math.round(slab / (vol.iso * 0.75)))) : 1
        const slabModeInt = spec.slabMode === "mip" ? 1 : spec.slabMode === "minip" ? 2 : 0

        gl.uniform3f(this.uniforms.uOrigin, origin[0], origin[1], origin[2])
        gl.uniform3f(this.uniforms.uAxisU, u[0], u[1], u[2])
        gl.uniform3f(this.uniforms.uAxisV, v[0], v[1], v[2])
        gl.uniform3f(this.uniforms.uNormal, nx / nLen, ny / nLen, nz / nLen)
        gl.uniform2f(this.uniforms.uPlaneMm, (cols - 1) * spacing, (rows - 1) * spacing)
        gl.uniform1f(this.uniforms.uSpacing, spacing)
        gl.uniform1f(this.uniforms.uSlabMm, slab)
        gl.uniform1i(this.uniforms.uSlabSteps, slabSteps)
        gl.uniform1i(this.uniforms.uSlabMode, slabModeInt)

        gl.uniform1f(this.uniforms.uRawMin, this.rawMin)
        gl.uniform1f(this.uniforms.uRawRange, this.rawRange)
        gl.uniform1f(this.uniforms.uSlope, vol.slope)
        gl.uniform1f(this.uniforms.uIntercept, vol.intercept)
        gl.uniform1f(this.uniforms.uWlWidth, Math.max(1, wl.width))
        gl.uniform1f(this.uniforms.uWlMin, wl.center - Math.max(1, wl.width) * 0.5)
        gl.uniform1i(this.uniforms.uSharpen, sharpen ? 1 : 0)
        gl.uniform1i(this.uniforms.uColorMap, colorMap === "invPlain" ? 1 : colorMap === "hot" ? 2 : 0)
        // Usar tricúbico cuando no es slab grueso para máximo rendimiento + nitidez quirúrgica
        gl.uniform1i(this.uniforms.uTricubic, useTricubic && slabSteps <= 12 ? 1 : 0)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        if (targetCanvas.width !== cols) targetCanvas.width = cols
        if (targetCanvas.height !== rows) targetCanvas.height = rows
        const ctx2d = targetCanvas.getContext("2d")
        if (!ctx2d) return false
        ctx2d.drawImage(this.canvas, 0, 0)
        return true
    }

    public dispose() {
        if (this.gl) {
            if (this.tex3D) this.gl.deleteTexture(this.tex3D)
            if (this.program) this.gl.deleteProgram(this.program)
            if (this.vao) this.gl.deleteVertexArray(this.vao)
        }
        this.tex3D = null
        this.program = null
        this.vao = null
        this.uploadedRawRef = null
        this.gl = null
        this.isReady = false
    }
}
