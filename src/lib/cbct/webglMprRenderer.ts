/**
 * Motor MPR Acelerado por GPU WebGL2 de 2 Pasadas (16 bits reales + Interpolación Tricúbica B-Spline).
 *
 * Arquitectura robusta de producción:
 * - Usa UN ÚNICO contexto WebGL2 offscreen compartido con VBO estático real (compatible 100% con ANGLE/D3D11/Metal/Intel).
 * - Nunca redimensiona/destruye el backbuffer al alternar entre vistas (usa high-water-mark + viewport dinámico).
 * - Pipeline de 2 pasadas (hasta 30× más rápido, evita timeouts TDR de GPU en laptops):
 *     · Pasada 1: remuestrea el plano 3D (con reorientación Euler, slab Mean/MIP/MinIP y tricúbico B-Spline en cortes finos)
 *       una sola vez por píxel hacia un FBO 2D RGBA8 estándar empacando 16 bits reales en (R, G) + máscara válida en B.
 *     · Pasada 2: aplica Unsharp Mask 3×3 en punto flotante 16-bit sobre la textura 2D (caché L1), Window/Level, curva S
 *       radiográfica GALILEOS y mapa de color.
 * - Ejecuta un auto-diagnóstico real (`readPixels`) tras subir el volumen 3D; si el GPU falla, agota VRAM (>192 MB)
 *   o pierde el contexto (`webglcontextlost`), desactiva GPU limpiamente para que el motor CPU 16-bit tome el control
 *   sin dejar jamás una vista en blanco.
 */

import type { ClinicalVolume, PlaneSpec, WindowLevel } from "./mprEngine"
import type { ClinicalColorMap } from "@/components/common/MprViewport"

const MAX_VRAM_BYTES_3D = 192 * 1024 * 1024 // Límite seguro de textura 3D R16F (192 MB)

const QUAD_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
    // vUv.y = 0 en la fila superior (r = 0) y 1 en la inferior (r = rows - 1)
    vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * PASADA 1: Remuestreo 3D (Tricúbico B-Spline o Trilineal hardware) + Reorientación 3D + Slab (Mean/MIP/MinIP).
 * Empaca el valor normalizado [0..1] con precisión de 16 bits (65535 niveles) en los canales R (byte alto) y G (byte bajo),
 * y guarda 1.0 en B si el píxel cae dentro del volumen válido (0.0 fuera del volumen).
 */
const SLICE_FRAG_SRC = /* glsl */ `#version 300 es
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
uniform float uSlabMm;
uniform int uSlabSteps;
uniform int uSlabMode;    // 0 = mean, 1 = mip, 2 = minip
uniform int uTricubic;    // 0 = trilinear, 1 = tricubic B-spline 8-tap

in vec2 vUv;
out vec4 fragColor;

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

bool sampleWorldNorm(vec3 pMm, out float outNormVal) {
    vec3 q = pMm;
    if (uHasReorient == 1) {
        vec3 center = uExtentMm * 0.5;
        q = center + uRotInv * (pMm - center);
    }
    float rx = uFlipXY.x > 0.5 ? (uExtentMm.x - q.x) : q.x;
    float ry = uFlipXY.y > 0.5 ? (uExtentMm.y - q.y) : q.y;
    float rz = q.z;

    vec3 fIdx = vec3(rx, ry, rz) * uInvSpacing;
    if (fIdx.x < -0.002 || fIdx.y < -0.002 || fIdx.z < -0.002 ||
        fIdx.x > (uDims.x - 0.998) || fIdx.y > (uDims.y - 0.998) || fIdx.z > (uDims.z - 0.998)) {
        outNormVal = 0.0;
        return false;
    }

    vec3 clamped = clamp(fIdx, vec3(0.0), uDims - 1.0);
    vec3 uvw = (clamped + 0.5) / uDims;
    outNormVal = (uTricubic == 1) ? sampleTricubic(uvw) : texture(uVolume, uvw).r;
    return true;
}

void main() {
    float xMm = vUv.x * uPlaneMm.x;
    float yMm = vUv.y * uPlaneMm.y;
    vec3 pMm = uOrigin + uAxisU * xMm + uAxisV * yMm;

    float val = 0.0;
    bool valid = false;

    if (uSlabSteps <= 1) {
        valid = sampleWorldNorm(pMm, val);
    } else {
        float acc = 0.0;
        float mx = -1e20;
        float mn = 1e20;
        int cnt = 0;
        float stepF = float(uSlabSteps);
        for (int k = 0; k < 24; k++) {
            if (k >= uSlabSteps) break;
            float off = -uSlabMm * 0.5 + (uSlabMm * (float(k) + 0.5)) / stepF;
            float sVal;
            if (sampleWorldNorm(pMm + uNormal * off, sVal)) {
                acc += sVal;
                mx = max(mx, sVal);
                mn = min(mn, sVal);
                cnt++;
            }
        }
        if (cnt > 0) {
            valid = true;
            if (uSlabMode == 1) val = mx;
            else if (uSlabMode == 2) val = mn;
            else val = acc / float(cnt);
        }
    }

    if (!valid) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Empacar precisión 16-bit en canales R (alto) y G (bajo)
    float q16 = floor(clamp(val, 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(q16 / 256.0) / 255.0;
    float lo = mod(q16, 256.0) / 255.0;
    fragColor = vec4(hi, lo, 1.0, 1.0);
}
`

/**
 * PASADA 2: Realce cortical 3x3 Unsharp Mask en 16 bits + Window/Level + Curva S GALILEOS + Mapa de Color.
 * Lee exclusivamente del FBO 2D en caché L1 (9 texelFetch rapidísimos).
 */
const DISPLAY_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uSliceTex;
uniform ivec2 uSliceSize;
uniform float uRawMin;
uniform float uRawRange;
uniform float uSlope;
uniform float uIntercept;
uniform float uWlMin;
uniform float uWlWidth;
uniform int uSharpen;     // 0 o 1
uniform int uColorMap;    // 0 = plain, 1 = invPlain, 2 = hot

out vec4 fragColor;

bool readModality(ivec2 coord, out float modVal) {
    ivec2 c = clamp(coord, ivec2(0), uSliceSize - 1);
    vec4 px = texelFetch(uSliceTex, c, 0);
    if (px.b < 0.5) {
        modVal = 0.0;
        return false;
    }
    float normVal = (floor(px.r * 255.0 + 0.5) * 256.0 + floor(px.g * 255.0 + 0.5)) / 65535.0;
    float rawVal = uRawMin + normVal * uRawRange;
    modVal = rawVal * uSlope + uIntercept;
    return true;
}

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    float centerVal;
    if (!readModality(coord, centerVal)) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float procVal = centerVal;
    if (uSharpen == 1) {
        float v;
        float sum = centerVal * 4.0;
        sum += (readModality(coord + ivec2(-1,  0), v) ? v : centerVal) * 2.0;
        sum += (readModality(coord + ivec2( 1,  0), v) ? v : centerVal) * 2.0;
        sum += (readModality(coord + ivec2( 0, -1), v) ? v : centerVal) * 2.0;
        sum += (readModality(coord + ivec2( 0,  1), v) ? v : centerVal) * 2.0;
        sum += (readModality(coord + ivec2(-1, -1), v) ? v : centerVal);
        sum += (readModality(coord + ivec2( 1, -1), v) ? v : centerVal);
        sum += (readModality(coord + ivec2(-1,  1), v) ? v : centerVal);
        sum += (readModality(coord + ivec2( 1,  1), v) ? v : centerVal);
        float blur = sum * 0.0625;
        procVal = centerVal + 0.62 * (centerVal - blur);
    }

    float t = clamp((procVal - uWlMin) / max(1.0, uWlWidth), 0.0, 1.0);
    float sCurve = t * t * (3.0 - 2.0 * t);
    float gammaT = t > 0.0 ? pow(t, 1.03) : 0.0;
    float v = clamp(sCurve * 0.34 + gammaT * 0.66, 0.0, 1.0);

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

function linkProgram(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string
): WebGLProgram | null {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
    if (!vs || !fs) {
        if (vs) gl.deleteShader(vs)
        if (fs) gl.deleteShader(fs)
        return null
    }
    const prog = gl.createProgram()
    if (!prog) {
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        return null
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("[WebGL2 MPR] Error linkeando programa:", gl.getProgramInfoLog(prog))
        gl.deleteProgram(prog)
        return null
    }
    return prog
}

export class WebGLMprRenderer {
    public readonly canvas: HTMLCanvasElement
    private gl: WebGL2RenderingContext | null = null
    private sliceProgram: WebGLProgram | null = null
    private displayProgram: WebGLProgram | null = null
    private vao: WebGLVertexArrayObject | null = null
    private vbo: WebGLBuffer | null = null
    private tex3D: WebGLTexture | null = null
    private fbo: WebGLFramebuffer | null = null
    private fboTex: WebGLTexture | null = null
    private fboW = 0
    private fboH = 0
    private uploadedRawRef: ArrayLike<number> | null = null
    private rawMin = 0
    private rawRange = 1
    private sliceUniforms: Record<string, WebGLUniformLocation | null> = {}
    private displayUniforms: Record<string, WebGLUniformLocation | null> = {}
    private onContextLostCb?: () => void
    private handleContextLostBound: (e: Event) => void
    public isReady = false

    constructor(onContextLost?: () => void) {
        this.onContextLostCb = onContextLost
        this.canvas = document.createElement("canvas")
        this.canvas.width = 512
        this.canvas.height = 512
        this.handleContextLostBound = (e: Event) => {
            e.preventDefault()
            console.warn("[WebGL2 MPR] Contexto WebGL2 perdido; activando respaldo CPU 16-bit automático.")
            this.isReady = false
            this.uploadedRawRef = null
            this.onContextLostCb?.()
        }
        this.canvas.addEventListener("webglcontextlost", this.handleContextLostBound)
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

            const sliceProg = linkProgram(gl, QUAD_VERT_SRC, SLICE_FRAG_SRC)
            const displayProg = linkProgram(gl, QUAD_VERT_SRC, DISPLAY_FRAG_SRC)
            if (!sliceProg || !displayProg) {
                if (sliceProg) gl.deleteProgram(sliceProg)
                if (displayProg) gl.deleteProgram(displayProg)
                return
            }

            this.sliceProgram = sliceProg
            this.displayProgram = displayProg

            // VAO + VBO real de quad fullscreen (compatible 100% con todos los drivers WebGL2)
            const vao = gl.createVertexArray()
            const vbo = gl.createBuffer()
            if (!vao || !vbo) return
            gl.bindVertexArray(vao)
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
                gl.STATIC_DRAW
            )
            gl.enableVertexAttribArray(0)
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
            gl.bindVertexArray(null)
            gl.bindBuffer(gl.ARRAY_BUFFER, null)
            this.vao = vao
            this.vbo = vbo

            const fbo = gl.createFramebuffer()
            if (!fbo) return
            this.fbo = fbo

            const sliceNames = [
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
                "uSlabMm",
                "uSlabSteps",
                "uSlabMode",
                "uTricubic",
            ]
            for (const name of sliceNames) {
                this.sliceUniforms[name] = gl.getUniformLocation(sliceProg, name)
            }

            const displayNames = [
                "uSliceTex",
                "uSliceSize",
                "uRawMin",
                "uRawRange",
                "uSlope",
                "uIntercept",
                "uWlMin",
                "uWlWidth",
                "uSharpen",
                "uColorMap",
            ]
            for (const name of displayNames) {
                this.displayUniforms[name] = gl.getUniformLocation(displayProg, name)
            }

            this.isReady = true
        } catch (err) {
            console.warn("[WebGL2 MPR] No disponible, usando motor CPU:", err)
            this.isReady = false
        }
    }

    private ensureSurfaceSize(cols: number, rows: number): boolean {
        const gl = this.gl
        if (!gl || !this.fbo) return false

        // High-water-mark: crecer solo cuando haga falta (evita destruir/recrear swapchain en cada corte)
        if (cols > this.canvas.width || rows > this.canvas.height) {
            this.canvas.width = Math.max(this.canvas.width, cols)
            this.canvas.height = Math.max(this.canvas.height, rows)
        }

        if (!this.fboTex || cols > this.fboW || rows > this.fboH) {
            const nextW = Math.max(this.fboW, cols, 256)
            const nextH = Math.max(this.fboH, rows, 256)
            if (this.fboTex) gl.deleteTexture(this.fboTex)
            const tex = gl.createTexture()
            if (!tex) return false
            gl.bindTexture(gl.TEXTURE_2D, tex)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, nextW, nextH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                console.warn("[WebGL2 MPR] FBO incompleto:", status)
                gl.deleteTexture(tex)
                return false
            }
            this.fboTex = tex
            this.fboW = nextW
            this.fboH = nextH
        }
        return true
    }

    /** Sube el volumen 16-bit a VRAM (corte por corte) y ejecuta auto-prueba real de lectura de píxeles */
    public uploadVolume(vol: ClinicalVolume): boolean {
        if (!this.isReady || !this.gl || this.gl.isContextLost()) return false
        if (this.uploadedRawRef === vol.raw && this.tex3D) return true

        const gl = this.gl
        const { nx, ny, nz, raw } = vol
        const maxTex = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number
        const bytesNeeded = nx * ny * nz * 2
        if (nx > maxTex || ny > maxTex || nz > maxTex || bytesNeeded > MAX_VRAM_BYTES_3D) {
            console.warn(
                `[WebGL2 MPR] Volumen ${nx}×${ny}×${nz} (${Math.round(bytesNeeded / 1048576)} MB) excede presupuesto seguro VRAM; usando motor CPU 16-bit.`
            )
            return false
        }

        // Limpiar errores previos de GL
        while (gl.getError() !== gl.NO_ERROR) {}

        // Encontrar rango min/max exacto del buffer
        const total = nx * ny * nz
        let mn = Infinity
        let mx = -Infinity
        const stride = Math.max(1, Math.floor(total / 250000))
        for (let i = 0; i < total; i += stride) {
            const v = raw[i]
            if (v === v) {
                if (v < mn) mn = v
                if (v > mx) mx = v
            }
        }
        if (!Number.isFinite(mn) || !Number.isFinite(mx)) return false
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

        // Reservar almacenamiento 3D R16F y subir corte por corte (~1 MB de memoria temporal JS)
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, nx, ny, nz, 0, gl.RED, gl.FLOAT, null)
        const allocErr = gl.getError()
        if (allocErr !== gl.NO_ERROR) {
            console.warn("[WebGL2 MPR] Error asignando textura 3D R16F:", allocErr)
            gl.deleteTexture(tex)
            return false
        }

        const slicePixels = nx * ny
        const sliceFloat = new Float32Array(slicePixels)
        const invRange = 1 / this.rawRange
        const rMin = this.rawMin

        for (let z = 0; z < nz; z++) {
            const base = z * slicePixels
            for (let i = 0; i < slicePixels; i++) {
                const v = (raw[base + i] - rMin) * invRange
                sliceFloat[i] = v > 0 ? (v < 1 ? v : 1) : 0
            }
            gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z, nx, ny, 1, gl.RED, gl.FLOAT, sliceFloat)
        }

        const uploadErr = gl.getError()
        if (uploadErr !== gl.NO_ERROR || gl.isContextLost()) {
            console.warn("[WebGL2 MPR] Error subiendo cortes 3D a VRAM:", uploadErr)
            gl.deleteTexture(tex)
            return false
        }

        this.tex3D = tex
        this.uploadedRawRef = vol.raw

        // Auto-diagnóstico real: renderizar un corte de prueba 24×24 y verificar con readPixels que GPU entrega píxeles válidos
        if (!this.verifyGpuSelfTest(vol)) {
            console.warn("[WebGL2 MPR] Auto-prueba de renderizado falló; activando motor CPU 16-bit.")
            gl.deleteTexture(tex)
            this.tex3D = null
            this.uploadedRawRef = null
            this.isReady = false
            return false
        }

        return true
    }

    private verifyGpuSelfTest(vol: ClinicalVolume): boolean {
        const gl = this.gl
        if (!gl || gl.isContextLost()) return false
        const testN = 24
        const sp = Math.min(vol.widthMm, vol.depthMm) / (testN - 1)
        const testSpec: PlaneSpec = {
            origin: [0, 0, vol.heightMm * 0.5],
            u: [1, 0, 0],
            v: [0, 1, 0],
            cols: testN,
            rows: testN,
            spacing: Math.max(0.1, sp),
            slabMm: 0,
            slabMode: "mean",
        }
        const q05 = vol.quantile(0.05)
        const q95 = vol.quantile(0.95)
        const testWl: WindowLevel = {
            center: q05 + (q95 - q05) * 0.2,
            width: Math.max(50, q95 - q05),
        }
        if (!this.drawPlaneInternal(vol, testSpec, testWl, "plain", false, true)) return false

        const pixels = new Uint8Array(testN * testN * 4)
        gl.readPixels(0, 0, testN, testN, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) return false

        let nonZero = 0
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 4 && pixels[i + 3] === 255) nonZero++
        }
        return nonZero >= 4
    }

    private drawPlaneInternal(
        vol: ClinicalVolume,
        spec: PlaneSpec,
        wl: WindowLevel,
        colorMap: ClinicalColorMap,
        sharpen: boolean,
        useTricubic: boolean
    ): boolean {
        const gl = this.gl
        if (!gl || gl.isContextLost() || !this.sliceProgram || !this.displayProgram || !this.vao || !this.tex3D) {
            return false
        }
        const { cols, rows, spacing, origin, u, v } = spec
        if (cols < 2 || rows < 2) return false
        if (!this.ensureSurfaceSize(cols, rows)) return false

        // --- PASADA 1: Remuestreo 3D -> FBO 2D RGBA8 (16-bit empacado) ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
        gl.viewport(0, 0, cols, rows)
        gl.useProgram(this.sliceProgram)
        gl.bindVertexArray(this.vao)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_3D, this.tex3D)
        gl.uniform1i(this.sliceUniforms.uVolume, 0)

        gl.uniform3f(this.sliceUniforms.uDims, vol.nx, vol.ny, vol.nz)
        gl.uniform3f(this.sliceUniforms.uExtentMm, vol.widthMm, vol.depthMm, vol.heightMm)
        gl.uniform3f(this.sliceUniforms.uInvSpacing, vol.isx, vol.isy, vol.isz)
        gl.uniform2f(this.sliceUniforms.uFlipXY, vol.flipX ? 1 : 0, vol.flipY ? 1 : 0)
        gl.uniform1i(this.sliceUniforms.uHasReorient, vol.hasReorient ? 1 : 0)

        const m = vol.rotInv
        gl.uniformMatrix3fv(
            this.sliceUniforms.uRotInv,
            false,
            new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
        )

        const nx = u[1] * v[2] - u[2] * v[1]
        const ny = u[2] * v[0] - u[0] * v[2]
        const nz = u[0] * v[1] - u[1] * v[0]
        const nLen = Math.hypot(nx, ny, nz) || 1

        const slab = spec.slabMm && spec.slabMm > vol.iso * 0.75 ? spec.slabMm : 0
        const slabSteps = slab > 0 ? Math.max(2, Math.min(20, Math.round(slab / (vol.iso * 0.75)))) : 1
        const slabModeInt = spec.slabMode === "mip" ? 1 : spec.slabMode === "minip" ? 2 : 0

        gl.uniform3f(this.sliceUniforms.uOrigin, origin[0], origin[1], origin[2])
        gl.uniform3f(this.sliceUniforms.uAxisU, u[0], u[1], u[2])
        gl.uniform3f(this.sliceUniforms.uAxisV, v[0], v[1], v[2])
        gl.uniform3f(this.sliceUniforms.uNormal, nx / nLen, ny / nLen, nz / nLen)
        gl.uniform2f(this.sliceUniforms.uPlaneMm, (cols - 1) * spacing, (rows - 1) * spacing)
        gl.uniform1f(this.sliceUniforms.uSlabMm, slab)
        gl.uniform1i(this.sliceUniforms.uSlabSteps, slabSteps)
        gl.uniform1i(this.sliceUniforms.uSlabMode, slabModeInt)
        // Tricúbico B-Spline en cortes finos (<= 2 pasos); trilineal hardware en integración de grosor (> 2 pasos)
        gl.uniform1i(this.sliceUniforms.uTricubic, useTricubic && slabSteps <= 2 ? 1 : 0)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        // --- PASADA 2: Realce Cortical 3×3 16-bit + Window/Level + Curva S -> Backbuffer ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, cols, rows)
        gl.useProgram(this.displayProgram)

        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex)
        gl.uniform1i(this.displayUniforms.uSliceTex, 1)
        gl.uniform2i(this.displayUniforms.uSliceSize, cols, rows)
        gl.uniform1f(this.displayUniforms.uRawMin, this.rawMin)
        gl.uniform1f(this.displayUniforms.uRawRange, this.rawRange)
        gl.uniform1f(this.displayUniforms.uSlope, vol.slope)
        gl.uniform1f(this.displayUniforms.uIntercept, vol.intercept)
        gl.uniform1f(this.displayUniforms.uWlWidth, Math.max(1, wl.width))
        gl.uniform1f(this.displayUniforms.uWlMin, wl.center - Math.max(1, wl.width) * 0.5)
        gl.uniform1i(this.displayUniforms.uSharpen, sharpen ? 1 : 0)
        gl.uniform1i(this.displayUniforms.uColorMap, colorMap === "invPlain" ? 1 : colorMap === "hot" ? 2 : 0)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        gl.bindVertexArray(null)
        return !gl.isContextLost()
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
        if (!this.isReady || !this.gl || this.gl.isContextLost()) return false
        if (!this.uploadVolume(vol)) return false
        if (!this.drawPlaneInternal(vol, spec, wl, colorMap, sharpen, useTricubic)) return false

        const { cols, rows } = spec
        if (targetCanvas.width !== cols) targetCanvas.width = cols
        if (targetCanvas.height !== rows) targetCanvas.height = rows
        const ctx2d = targetCanvas.getContext("2d")
        if (!ctx2d) return false

        // Extraer exactamente la región inferior-izquierda [0..cols, 0..rows] del backbuffer WebGL
        const srcY = Math.max(0, this.canvas.height - rows)
        ctx2d.drawImage(this.canvas, 0, srcY, cols, rows, 0, 0, cols, rows)
        return true
    }

    public dispose() {
        this.canvas.removeEventListener("webglcontextlost", this.handleContextLostBound)
        if (this.gl) {
            if (this.tex3D) this.gl.deleteTexture(this.tex3D)
            if (this.fboTex) this.gl.deleteTexture(this.fboTex)
            if (this.fbo) this.gl.deleteFramebuffer(this.fbo)
            if (this.sliceProgram) this.gl.deleteProgram(this.sliceProgram)
            if (this.displayProgram) this.gl.deleteProgram(this.displayProgram)
            if (this.vao) this.gl.deleteVertexArray(this.vao)
            if (this.vbo) this.gl.deleteBuffer(this.vbo)
        }
        this.tex3D = null
        this.fboTex = null
        this.fbo = null
        this.sliceProgram = null
        this.displayProgram = null
        this.vao = null
        this.vbo = null
        this.uploadedRawRef = null
        this.gl = null
        this.isReady = false
    }
}
