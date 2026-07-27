"use client"

import { useEffect, useRef } from "react"

const vertexShaderSource = `#version 300 es
void main() {
  vec2 position = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  gl_Position = vec4(position, 0.0, 1.0);
}`

const fragmentShaderSource = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_progress;
uniform float u_energy;
uniform float u_playing;
uniform float u_dark;

out vec4 outColor;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);

  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x),
    local.y
  );
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(point);
    point = point * 2.03 + vec2(17.7, 9.2);
    amplitude *= 0.48;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  float time = u_time * mix(0.12, 0.72, u_playing);
  float textureField = fbm(vec2(uv.x * 5.0 - time * 0.18, uv.y * 2.4 + time * 0.11));
  float fineGrain = noise(vec2(uv.x * 34.0 + time * 0.45, uv.y * 8.0));

  float ribbonCenter = 0.5;
  ribbonCenter += (textureField - 0.5) * (0.13 + u_energy * 0.06);
  ribbonCenter += sin(uv.x * 19.0 - time * 1.25) * 0.018 * u_playing;

  float distanceToRibbon = abs(uv.y - ribbonCenter);
  float ribbon = smoothstep(0.30, 0.015, distanceToRibbon);
  float playheadDistance = abs(uv.x - u_progress);
  float pulseWidth = mix(0.038, 0.085, u_energy);
  float pulse = exp(-pow(playheadDistance / pulseWidth, 2.0));
  float wake = smoothstep(0.42, 0.0, u_progress - uv.x) *
               smoothstep(0.0, 0.03, u_progress - uv.x);
  float played = 1.0 - smoothstep(u_progress - 0.003, u_progress + 0.003, uv.x);

  float baseInk = ribbon * (0.018 + fineGrain * 0.018);
  float settledInk = ribbon * played * 0.025;
  float movingInk = ribbon * wake * textureField * 0.04 * u_playing;
  float pulseInk = smoothstep(0.34, 0.02, distanceToRibbon) * pulse *
                   mix(0.08, 0.24, u_playing) * (0.72 + u_energy * 0.55);
  float filament = exp(-pow(playheadDistance / 0.012, 2.0));
  float filamentInk = smoothstep(0.46, 0.015, distanceToRibbon) * filament *
                      mix(0.035, 0.20, u_playing) * (0.8 + u_energy * 0.4);
  float alpha = clamp(
    baseInk + settledInk + movingInk + pulseInk + filamentInk,
    0.0,
    0.46
  );

  vec3 lightInk = vec3(0.12, 0.115, 0.105);
  vec3 darkInk = vec3(0.95, 0.945, 0.92);
  vec3 ink = mix(lightInk, darkInk, u_dark);
  outColor = vec4(ink * alpha, alpha);
}`

type ShaderRuntime = {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  resolution: WebGLUniformLocation | null
  time: WebGLUniformLocation | null
  progress: WebGLUniformLocation | null
  energy: WebGLUniformLocation | null
  playing: WebGLUniformLocation | null
  dark: WebGLUniformLocation | null
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createRuntime(canvas: HTMLCanvasElement): ShaderRuntime | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: true,
  })
  if (!gl) return null

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  )
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  return {
    gl,
    program,
    resolution: gl.getUniformLocation(program, "u_resolution"),
    time: gl.getUniformLocation(program, "u_time"),
    progress: gl.getUniformLocation(program, "u_progress"),
    energy: gl.getUniformLocation(program, "u_energy"),
    playing: gl.getUniformLocation(program, "u_playing"),
    dark: gl.getUniformLocation(program, "u_dark"),
  }
}

export function WaveformShader({
  progress,
  energy,
  playing,
  dark,
}: {
  progress: number
  energy: number
  playing: boolean
  dark: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<ShaderRuntime | null>(null)
  const progressRef = useRef(progress)
  const playingRef = useRef(playing)
  const darkRef = useRef(dark)
  const reducedMotionRef = useRef(false)
  const visibleRef = useRef(true)
  const energyRef = useRef(energy)
  const frameRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const drawRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    progressRef.current = Math.max(0, Math.min(1, progress || 0))
    energyRef.current = Math.max(0, Math.min(1, energy || 0))
    playingRef.current = playing
    darkRef.current = dark
    drawRef.current?.()
  }, [dark, energy, playing, progress])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotionRef.current = motionQuery.matches
    visibleRef.current = document.visibilityState === "visible"

    function resize() {
      const bounds = canvas!.getBoundingClientRect()
      const density = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(1, Math.round(bounds.width * density))
      const height = Math.max(1, Math.round(bounds.height * density))
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width
        canvas!.height = height
      }
      runtimeRef.current?.gl.viewport(0, 0, width, height)
    }

    function stopFrame() {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }

    function render(timestamp: number) {
      frameRef.current = null
      const runtime = runtimeRef.current
      if (!runtime) return

      if (startedAtRef.current == null) startedAtRef.current = timestamp
      const elapsed = reducedMotionRef.current
        ? 0
        : (timestamp - startedAtRef.current) / 1_000

      const { gl } = runtime
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(runtime.program)
      gl.uniform2f(runtime.resolution, canvas!.width, canvas!.height)
      gl.uniform1f(runtime.time, elapsed)
      gl.uniform1f(runtime.progress, progressRef.current)
      gl.uniform1f(runtime.energy, energyRef.current)
      gl.uniform1f(runtime.playing, playingRef.current ? 1 : 0)
      gl.uniform1f(runtime.dark, darkRef.current ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (
        playingRef.current &&
        visibleRef.current &&
        !reducedMotionRef.current
      ) {
        frameRef.current = requestAnimationFrame(render)
      }
    }

    function draw() {
      stopFrame()
      frameRef.current = requestAnimationFrame(render)
    }

    function initialize() {
      runtimeRef.current = createRuntime(canvas!)
      resize()
      draw()
    }

    function onContextLost(event: Event) {
      event.preventDefault()
      stopFrame()
      runtimeRef.current = null
    }

    function onContextRestored() {
      initialize()
    }

    function onMotionChange(event: MediaQueryListEvent) {
      reducedMotionRef.current = event.matches
      draw()
    }

    function onVisibilityChange() {
      visibleRef.current = document.visibilityState === "visible"
      if (visibleRef.current) draw()
      else stopFrame()
    }

    const resizeObserver = new ResizeObserver(() => {
      resize()
      draw()
    })

    drawRef.current = draw
    canvas.addEventListener("webglcontextlost", onContextLost)
    canvas.addEventListener("webglcontextrestored", onContextRestored)
    motionQuery.addEventListener("change", onMotionChange)
    document.addEventListener("visibilitychange", onVisibilityChange)
    resizeObserver.observe(canvas)
    initialize()

    return () => {
      drawRef.current = null
      stopFrame()
      resizeObserver.disconnect()
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      motionQuery.removeEventListener("change", onMotionChange)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (runtimeRef.current) {
        runtimeRef.current.gl.deleteProgram(runtimeRef.current.program)
        runtimeRef.current = null
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-waveform-shader="graphite-pulse"
      className="pointer-events-none absolute inset-0 z-20 size-full"
    />
  )
}
