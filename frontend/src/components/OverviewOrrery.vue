<template>
  <div ref="rootRef" class="orrery">
    <div class="orrery-nebula"></div>
    <svg ref="atlasRef" class="orrery-atlas" preserveAspectRatio="xMidYMid meet"></svg>
    <canvas ref="canvasRef" class="orrery-canvas"></canvas>
    <div class="orrery-scan"></div>

    <!-- almanac plate frame -->
    <svg ref="frameRef" class="orrery-frame" preserveAspectRatio="none"></svg>

    <!-- floating labels -->
    <div ref="labelsRef" class="orrery-labels"></div>

    <!-- chrome -->
    <div class="orrery-chrome">
      <div class="orrery-eyebrow">THE ORRERY · 星盘</div>
      <div class="orrery-plateno">{{ attractions.length }} STARS PLOTTED</div>
    </div>
    <div class="orrery-hint">
      <span><i></i>拖拽转动</span>
      <span><i></i>点铜点看详情</span>
      <span><i></i>滚轮缩放</span>
    </div>

    <!-- field-note card -->
    <div class="orrery-card" :class="{ show: selected >= 0 }">
      <template v-if="selected >= 0 && current">
        <div class="fn-head">
          <span class="k">FIELD NOTE</span>
          <button class="fn-close" @click="closeCard">×</button>
        </div>
        <div class="fn-photo">
          <img v-if="currentImage" :src="currentImage" :alt="current.name" @error="onImgError" />
          <span v-else class="fn-photo-name">{{ current.name }}</span>
          <svg class="fn-wave" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0,0V46c47,22,103,32,158,28,70-5,136-33,207-37,74-4,147,17,218,35,69,18,138,25,209,13,36-6,70-18,104-29C989,25,1113-14,1200,52V0Z" fill="var(--fn-card,#FBF7EE)" opacity=".25"/><path d="M0,0V16c13,21,28,41,48,56,52,39,117,39,177,20,31-10,60-26,90-40,41-19,84-46,130-49,36-3,71,9,99,31,32,25,62,62,103,73,40,11,81-7,119-24s75-39,117-43c60-6,113,23,169,39,30,9,59,6,87-8,22-11,48-27,61-49V0Z" fill="var(--fn-card,#FBF7EE)"/></svg>
        </div>
        <div class="fn-body">
          <div class="fn-idx"><span class="star">✦</span> STOP {{ String(selected + 1).padStart(2, '0') }}</div>
          <h3>{{ current.name }}</h3>
          <p>{{ current.description || current.address || '—' }}</p>
          <div class="fn-meta">
            <span v-if="current.visit_duration" class="chipm">{{ current.visit_duration }} 分钟</span>
            <button class="fn-go" @click="emitSelectDay(current.dayArrayIndex)">查看当日行程 →</button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="failed" class="orrery-fallback">
      <span>无法加载 3D 星盘，请刷新重试。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as THREE from 'three'

interface OrreryItem {
  name: string
  address?: string
  visit_duration?: number
  description?: string
  dayArrayIndex: number
  order?: number
}

const props = defineProps<{
  attractions: OrreryItem[]
  getImage?: (name: string) => string
}>()

const emit = defineEmits<{ (e: 'select-day', dayArrayIndex: number): void }>()

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const labelsRef = ref<HTMLElement | null>(null)
const frameRef = ref<SVGElement | null>(null)
const atlasRef = ref<SVGElement | null>(null)
const selected = ref(-1)
const failed = ref(false)
const imgFailed = ref(false)

const current = computed(() => (selected.value >= 0 ? props.attractions[selected.value] : null))
const currentImage = computed(() => {
  if (imgFailed.value || !current.value || !props.getImage) return ''
  return props.getImage(current.value.name) || ''
})

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ']
const INK = 0x2a2019
const BRASS = 0xb08637
// 炫彩（极光/宝石虹彩）调色板
const AURORA = [0x2FB4C9, 0x7C6FE0, 0xD96FA0, 0xE0A24E, 0x4FC58E, 0xE0705A]
function jewelMat(hex: number, emiss = 0.35) {
  return new THREE.MeshPhongMaterial({ color: hex, specular: 0xffffff, shininess: 100, emissive: hex, emissiveIntensity: emiss, transparent: true, opacity: 1 })
}
let shimmerRings: THREE.Mesh[] = []

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let root: THREE.Group | null = null
let armilla: THREE.Group | null = null
let sun: THREE.Mesh | null = null
let markers: THREE.Group[] = []
let planets: { mesh: THREE.Mesh; r: number; speed: number; tilt: number; phase: number }[] = []
let dust: THREE.Points | null = null
let sunCorona: THREE.Sprite[] = []
let hitTargets: THREE.Object3D[] = []
let labelEls: HTMLElement[] = []
let rafId = 0
let ro: ResizeObserver | null = null
const clock = new THREE.Clock()
const rayc = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const vTmp = new THREE.Vector3()

let camDist = 30
let camDistTarget = 18
let introStart = -1
let yaw = 0.7, pitch = 0.3, tYaw = 0.7, tPitch = 0.3, idle = 0
let dragging = false, moved = false, lastX = 0, lastY = 0, hovered = -1

function glowTexture(rgb: string) {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, `rgba(${rgb},.95)`); grd.addColorStop(.28, `rgba(${rgb},.4)`); grd.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
  const t = new THREE.Texture(c); t.needsUpdate = true; return t
}
let brassGlow: THREE.Texture

function brassMat(op = 1) {
  return new THREE.MeshPhongMaterial({ color: BRASS, specular: 0xf0d9a0, shininess: 90, emissive: 0x140d03, emissiveIntensity: .35, transparent: op < 1, opacity: op })
}

function positionsFor(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const th = i * golden
    const rad = 3.4 + (i % 3) * 0.5
    out.push(new THREE.Vector3(Math.cos(th) * r * rad, y * 2.6, Math.sin(th) * r * rad))
  }
  return out
}

function clearMarkers() {
  markers.forEach((g) => root && root.remove(g))
  markers = []; hitTargets = []
  if (labelsRef.value) labelsRef.value.innerHTML = ''
  labelEls = []
}

function buildMarkers() {
  if (!root || !scene) return
  clearMarkers()
  introStart = -1 // 重放开场点亮
  const items = props.attractions || []
  const pos = positionsFor(items.length)

  // ink route (through itinerary order)
  const routePts: THREE.Vector3[] = []
  for (let i = 0; i < items.length - 1; i++) { routePts.push(pos[i].clone(), pos[i + 1].clone()) }
  if (routePts.length) {
    const geo = new THREE.BufferGeometry().setFromPoints(routePts)
    root.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: .4 })))
  }

  items.forEach((_, i) => {
    const g = new THREE.Group(); g.position.copy(pos[i])
    const col = AURORA[i % AURORA.length]
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), jewelMat(col, 0.55))
    g.add(bead)
    // subtle colored glow (kept small so it doesn't wash out)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: brassGlow, color: col, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.scale.set(1.15, 1.15, 1); g.add(glow)
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 14, 64), jewelMat(col, 0.4)); ringM.rotation.x = 1.1 + i * 0.2; g.add(ringM)
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.012, 12, 60), jewelMat(col, 0.3)); (ring2.material as THREE.MeshPhongMaterial).opacity = .6; ring2.rotation.set(0.4, 0.8 + i, 0); g.add(ring2)
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.78, 10, 10), new THREE.MeshBasicMaterial({ visible: false })); hit.userData = { index: i }; g.add(hit)
    ;(g as any).userData = { index: i, bead, glow, ringM, ring2, color: col, phase: Math.random() * 6.28 }
    root!.add(g); markers.push(g); hitTargets.push(hit)
  })

  // labels
  if (labelsRef.value) {
    labelEls = items.map((it, i) => {
      const d = document.createElement('div'); d.className = 'lab'
      d.innerHTML = `<div class="dot"></div><div class="tx"><span class="cat">${GREEK[i % GREEK.length]}</span>${it.name}</div>`
      const dot = d.querySelector('.dot') as HTMLElement | null
      if (dot) dot.style.borderColor = '#' + AURORA[i % AURORA.length].toString(16).padStart(6, '0')
      labelsRef.value!.appendChild(d); return d
    })
  }
}

function drawFrame() {
  const svg = frameRef.value, host = rootRef.value
  if (!svg || !host) return
  const w = host.clientWidth, h = host.clientHeight, m = 18
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  let s = `<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="rgba(36,29,24,.2)" stroke-width="1"/>`
  ;([[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]] as number[][]).forEach((c) => {
    s += `<path d="M${c[0]} ${c[1] + c[3] * 14} L${c[0]} ${c[1]} L${c[0] + c[2] * 14} ${c[1]}" fill="none" stroke="var(--rust,#C0562A)" stroke-width="1.4"/>`
  })
  const n = Math.max(6, Math.floor((w - 2 * m) / 24))
  for (let i = 0; i <= n; i++) { const x = m + (w - 2 * m) * i / n, lg = i % 5 === 0
    s += `<line x1="${x}" y1="${m}" x2="${x}" y2="${m + (lg ? 8 : 4)}" stroke="rgba(36,29,24,.26)" stroke-width="1"/>`
  }
  svg.innerHTML = s
}

function drawAtlas() {
  const svg = atlasRef.value, host = rootRef.value
  if (!svg || !host) return
  const w = host.clientWidth, h = host.clientHeight
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  const ink = 'rgba(36,29,24,'
  let s = ''
  // scattered reference stars + a few 4-point star glyphs (seeded pseudo-random)
  let seed = 20260924
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let i = 0; i < 120; i++) {
    const x = rnd() * w, y = rnd() * h
    if (Math.hypot(x - cx, y - cy) < R * 0.62) continue
    const r = rnd() * 1.1 + 0.4
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${ink}.28)"/>`
  }
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w, y = rnd() * h
    if (Math.hypot(x - cx, y - cy) < R * 0.7) continue
    const a = 4
    s += `<path d="M${x} ${y - a} L${x + 1} ${y - 1} L${x + a} ${y} L${x + 1} ${y + 1} L${x} ${y + a} L${x - 1} ${y + 1} L${x - a} ${y} L${x - 1} ${y - 1} Z" fill="${ink}.34)"/>`
  }
  // a couple of faint constellation figures (corners)
  const figs = [[[w * 0.14, h * 0.24], [w * 0.2, h * 0.34], [w * 0.28, h * 0.3], [w * 0.31, h * 0.42], [w * 0.24, h * 0.5]],
    [[w * 0.86, h * 0.7], [w * 0.8, h * 0.62], [w * 0.9, h * 0.56], [w * 0.83, h * 0.5]]]
  figs.forEach((f) => {
    for (let i = 0; i < f.length - 1; i++) s += `<line x1="${f[i][0]}" y1="${f[i][1]}" x2="${f[i + 1][0]}" y2="${f[i + 1][1]}" stroke="${ink}.16)" stroke-width="1" stroke-dasharray="2 4"/>`
    f.forEach((p) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="1.6" fill="${ink}.3)"/>` })
  })
  // central graduated dial
  s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ink}.16)" stroke-width="1"/>`
  s += `<circle cx="${cx}" cy="${cy}" r="${R * 0.9}" fill="none" stroke="${ink}.1)" stroke-width="1"/>`
  s += `<circle cx="${cx}" cy="${cy}" r="${R * 0.52}" fill="none" stroke="${ink}.09)" stroke-width="1"/>`
  // 360 ticks
  for (let i = 0; i < 360; i += 2) {
    const a = i * Math.PI / 180, lg = i % 30 === 0, len = lg ? 12 : (i % 10 === 0 ? 7 : 3.5)
    const x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R
    const x2 = cx + Math.cos(a) * (R - len), y2 = cy + Math.sin(a) * (R - len)
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${ink}${lg ? '.3' : '.16'})" stroke-width="1"/>`
  }
  // degree labels every 30
  for (let i = 0; i < 360; i += 30) {
    const a = i * Math.PI / 180, x = cx + Math.cos(a) * (R - 26), y = cy + Math.sin(a) * (R - 26)
    s += `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-size="9" fill="${ink}.32)">${i}°</text>`
  }
  // radial spokes
  for (let i = 0; i < 12; i++) { const a = i * 30 * Math.PI / 180
    s += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * R * 0.9).toFixed(1)}" y2="${(cy + Math.sin(a) * R * 0.9).toFixed(1)}" stroke="${ink}.05)" stroke-width="1"/>`
  }
  // compass rose points N/E/S/W
  const rose = R + 16
  ;[['N', -90], ['E', 0], ['S', 90], ['W', 180]].forEach((d) => {
    const a = (d[1] as number) * Math.PI / 180, x = cx + Math.cos(a) * rose, y = cy + Math.sin(a) * rose
    s += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-family="'Newsreader',serif" font-size="14" fill="var(--rust,#C0562A)" opacity=".7">${d[0]}</text>`
  })
  svg.innerHTML = s
}

function resize() {
  const host = rootRef.value
  if (!host || !renderer || !camera) return
  const w = host.clientWidth, h = host.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h; camera.updateProjectionMatrix()
  drawFrame()
  drawAtlas()
}

function pointer(e: MouseEvent | TouchEvent) {
  const host = rootRef.value; if (!host) return
  const r = host.getBoundingClientRect()
  const t = 'touches' in e ? e.touches[0] : e
  mouse.x = ((t.clientX - r.left) / r.width) * 2 - 1
  mouse.y = -((t.clientY - r.top) / r.height) * 2 + 1
}
function pick(): number {
  if (!camera) return -1
  rayc.setFromCamera(mouse, camera)
  const h = rayc.intersectObjects(hitTargets, false)
  return h.length ? (h[0].object.userData as any).index : -1
}

function onDown(e: MouseEvent | TouchEvent) { dragging = true; moved = false; const t = 'touches' in e ? e.touches[0] : e; lastX = t.clientX; lastY = t.clientY; idle = 0 }
function onMove(e: MouseEvent | TouchEvent) {
  pointer(e)
  if (dragging) { const t = 'touches' in e ? e.touches[0] : e; const dx = t.clientX - lastX, dy = t.clientY - lastY; lastX = t.clientX; lastY = t.clientY
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
    tYaw += dx * 0.006; tPitch = Math.max(-1.15, Math.min(1.15, tPitch + dy * 0.006)); idle = 0 }
}
function onUp() { dragging = false }
function onWheel(e: WheelEvent) { camDistTarget = Math.max(11, Math.min(30, camDistTarget + e.deltaY * 0.012)); e.preventDefault() }
function onClick() { if (moved) return; const i = pick(); if (i >= 0) { imgFailed.value = false; selected.value = i; camDistTarget = 13.5 } else closeCard() }

function closeCard() { selected.value = -1; camDistTarget = 18 }
function onImgError() { imgFailed.value = true }
function emitSelectDay(d: number) { emit('select-day', d) }

function loop() {
  rafId = requestAnimationFrame(loop)
  if (!renderer || !scene || !camera || !root) return
  // 被 v-show 隐藏（切到其它标签）时暂停渲染，避免隐藏画布仍持续吃 GPU
  if (!rootRef.value || rootRef.value.offsetParent === null) return
  const t = clock.getElapsedTime(); idle += 0.016
  if (introStart < 0) introStart = t
  const ip = Math.min(1, (t - introStart) / 2.4) // 开场推进 0→1
  camDist += (camDistTarget - camDist) * 0.06
  if (!dragging && idle > 1.4) tYaw += 0.0011 * 60 * 0.016
  yaw += (tYaw - yaw) * 0.07; pitch += (tPitch - pitch) * 0.07
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw)
  camera.position.set(camDist * cp * sy, camDist * sp, camDist * cp * cy); camera.lookAt(0, 0, 0)
  if (armilla) { armilla.rotation.y = t * 0.05; if (armilla.children[2]) armilla.children[2].rotation.z = t * 0.08 }
  if (sun) { sun.rotation.y = t * 0.4; const h = (t * 0.03) % 1; (sun.material as THREE.MeshPhongMaterial).color.setHSL(h, 0.62, 0.6); (sun.material as THREE.MeshPhongMaterial).emissive.setHSL(h, 0.6, 0.42) }
  sunCorona.forEach((sp) => { const p = 1 + Math.sin(t * 1.2) * 0.06; sp.scale.set(2.0 * p, 2.0 * p, 1) })
  // 宝石环随时间缓慢流转（炫彩流光）
  shimmerRings.forEach((m, i) => { const h = (t * 0.02 + i * 0.3) % 1; const mat = m.material as THREE.MeshPhongMaterial; mat.color.setHSL(h, 0.55, 0.58); mat.emissive.setHSL(h, 0.55, 0.4) })
  planets.forEach((pl) => {
    const a = t * pl.speed + pl.phase
    pl.mesh.position.set(Math.cos(a) * pl.r, Math.sin(a) * pl.r * Math.sin(pl.tilt), Math.sin(a) * pl.r * Math.cos(pl.tilt))
  })
  if (dust) { dust.rotation.y = t * 0.02; dust.rotation.x = Math.sin(t * 0.08) * 0.04 }

  if (!dragging) { const hp = pick(); if (hp !== hovered) { hovered = hp; if (canvasRef.value) canvasRef.value.style.cursor = hp >= 0 ? 'pointer' : 'grab' } }

  const host = rootRef.value
  markers.forEach((g, i) => {
    const ud = (g as any).userData
    const active = i === hovered || i === selected.value
    const pulse = 1 + Math.sin(t * 1.6 + ud.phase) * 0.05
    // 开场按序点亮
    const sipRaw = (ip - i * 0.08) / 0.24
    const sip = sipRaw <= 0 ? 0 : sipRaw >= 1 ? 1 : sipRaw * sipRaw * (3 - 2 * sipRaw)
    ud.bead.scale.setScalar((active ? 1.5 : 1) * pulse * sip)
    ud.bead.material.emissiveIntensity = (active ? 0.85 : 0.55) * sip
    ud.glow.scale.setScalar((active ? 1.9 : 1.15) * pulse * sip)
    ud.glow.material.opacity = (active ? 0.6 : 0.35) * sip
    ud.ringM.rotation.z = t * 0.6 + i; ud.ring2.rotation.z = -t * 0.4 + i
    ;(ud.ringM.material as THREE.MeshPhongMaterial).opacity = 0.9 * sip
    ;(ud.ring2.material as THREE.MeshPhongMaterial).opacity = 0.6 * sip
    // label projection
    if (host && labelEls[i] && camera) {
      vTmp.copy(g.position).project(camera)
      const lb = labelEls[i]
      if (vTmp.z > 1 || sip < 0.2) { lb.style.display = 'none' }
      else {
        lb.style.display = 'block'
        lb.style.opacity = ip < 1 ? String(sip) : ''
        lb.style.left = `${(vTmp.x * 0.5 + 0.5) * host.clientWidth}px`
        lb.style.top = `${(-vTmp.y * 0.5 + 0.5) * host.clientHeight - 26}px`
        lb.className = 'lab' + (active ? ' on' : (selected.value >= 0 ? ' dim' : ''))
      }
    }
  })
  renderer.render(scene, camera)
}

function initScene() {
  const host = rootRef.value, cv = canvasRef.value
  if (!host || !cv) return
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0xf1eadb, 0.021)
  camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 200)
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight, false)

  scene.add(new THREE.AmbientLight(0xeadfc9, 0.75))
  const key = new THREE.DirectionalLight(0xffeac6, 1.15); key.position.set(5, 9, 7); scene.add(key)
  const rim = new THREE.DirectionalLight(0xc0562a, 0.4); rim.position.set(-7, -4, -4); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x9fc0c7, 0.25); fill.position.set(-4, 3, -6); scene.add(fill)

  brassGlow = glowTexture('217,164,65')

  root = new THREE.Group(); scene.add(root)
  armilla = new THREE.Group(); scene.add(armilla)

  const ring = (radius: number, tube: number, rx: number, ry: number, rz: number, op: number, color: number, shimmer = false) => {
    const mat = jewelMat(color, 0.5); mat.opacity = op
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 18, 150), mat); m.rotation.set(rx, ry, rz)
    if (shimmer) shimmerRings.push(m)
    return m
  }
  armilla.add(ring(6.1, 0.06, Math.PI / 2, 0, 0, .92, AURORA[0], true))   // 青
  armilla.add(ring(6.1, 0.06, 0, 0, 0, .92, AURORA[1], true))             // 紫
  armilla.add(ring(5.4, 0.05, 0.41, 0, 0, .85, AURORA[2], true))          // 玫瑰
  armilla.add(ring(6.5, 0.03, Math.PI / 2, 0, 0, .5, AURORA[3]))          // 琥珀 外圈刻度环
  const ticks = new THREE.Group()
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, long = i % 9 === 0
    const tk = new THREE.Mesh(new THREE.BoxGeometry(0.02, long ? 0.34 : 0.16, 0.02), brassMat(.65))
    tk.position.set(Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5); tk.rotation.y = -a; ticks.add(tk)
  }
  ticks.rotation.x = Math.PI / 2; armilla.add(ticks)

  sun = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 32), jewelMat(AURORA[3], 0.65))
  sunCorona = []
  const sc = new THREE.Sprite(new THREE.SpriteMaterial({ map: brassGlow, color: 0xffffff, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false }))
  sc.scale.set(2.0, 2.0, 1); sun.add(sc); sunCorona.push(sc)
  armilla.add(sun)

  // decorative orbiting planets (the orrery comes alive)
  planets = []
  const planetDefs = [
    { r: 2.3, speed: 0.5, tilt: 0.2, color: AURORA[2], size: 0.12 },
    { r: 3.5, speed: 0.32, tilt: -0.5, color: AURORA[0], size: 0.15 },
    { r: 4.7, speed: 0.22, tilt: 0.34, color: AURORA[1], size: 0.11 },
  ]
  planetDefs.forEach((d) => {
    // dotted orbit path
    const path = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.007, 8, 120), new THREE.MeshBasicMaterial({ color: 0x6B5C4C, transparent: true, opacity: .24 }))
    path.rotation.x = Math.PI / 2 + d.tilt; armilla!.add(path)
    const m = new THREE.Mesh(new THREE.SphereGeometry(d.size, 20, 20), jewelMat(d.color, 0.45))
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: brassGlow, color: d.color, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false }))
    g.scale.set(d.size * 5, d.size * 5, 1); m.add(g)
    armilla!.add(m)
    planets.push({ mesh: m, r: d.r, speed: d.speed, tilt: d.tilt, phase: Math.random() * 6.28 })
  })

  // golden drifting dust
  const DN = 130, darr = new Float32Array(DN * 3)
  for (let i = 0; i < DN; i++) { darr[i * 3] = (Math.random() - .5) * 22; darr[i * 3 + 1] = (Math.random() - .5) * 16; darr[i * 3 + 2] = (Math.random() - .5) * 16 }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(darr, 3))
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xD9A441, size: 0.13, map: brassGlow, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }))
  scene.add(dust)

  // faint ink reference stars
  const N = 200, arr = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) { const r = 8 + Math.random() * 7, th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1)
    arr[i * 3] = r * Math.sin(ph) * Math.cos(th); arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); arr[i * 3 + 2] = r * Math.cos(ph) }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: INK, size: 0.06, transparent: true, opacity: .32, sizeAttenuation: true })))

  buildMarkers()

  cv.addEventListener('mousedown', onDown)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  cv.addEventListener('touchstart', onDown, { passive: true })
  cv.addEventListener('touchmove', onMove, { passive: true })
  cv.addEventListener('touchend', onUp)
  cv.addEventListener('wheel', onWheel, { passive: false })
  cv.addEventListener('click', onClick)
  cv.style.cursor = 'grab'

  drawFrame()
  drawAtlas()
  ro = new ResizeObserver(resize); ro.observe(host)
  loop()
}

onMounted(async () => {
  await nextTick()
  try { initScene() } catch (e) { console.error('orrery init failed', e); failed.value = true }
})

watch(() => props.attractions, () => { if (root) { imgFailed.value = false; selected.value = -1; buildMarkers() } })

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  if (ro) ro.disconnect()
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  const cv = canvasRef.value
  if (cv) { cv.removeEventListener('mousedown', onDown); cv.removeEventListener('touchstart', onDown); cv.removeEventListener('touchmove', onMove); cv.removeEventListener('touchend', onUp); cv.removeEventListener('wheel', onWheel); cv.removeEventListener('click', onClick) }
  if (renderer) { renderer.dispose(); renderer = null }
  scene = null; camera = null; root = null; armilla = null; markers = []; planets = []; dust = null; sunCorona = []; shimmerRings = []
})
</script>

<style scoped>
.orrery {
  --fn-card: #FBF7EE;
  position: relative;
  width: 100%;
  height: 500px;
  overflow: hidden;
  border-radius: 4px;
  background:
    radial-gradient(120% 85% at 50% 44%, rgba(255, 251, 242, .6), transparent 62%),
    radial-gradient(90% 70% at 50% 46%, rgba(217, 164, 65, .1), transparent 60%),
    radial-gradient(120% 90% at 50% -8%, rgba(192, 86, 42, .1), transparent 55%),
    radial-gradient(150% 120% at 50% 118%, rgba(31, 84, 96, .12), transparent 60%),
    #EFE7D6;
}
@media (max-width: 640px) { .orrery { height: 420px; } }
.orrery::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background-image: radial-gradient(circle, rgba(36, 29, 24, .05) 1px, transparent 1px);
  background-size: 22px 22px; opacity: .45;
}
.orrery-nebula {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(38% 46% at 50% 48%, rgba(224, 164, 90, .16), transparent 70%),
    radial-gradient(60% 60% at 50% 50%, rgba(31, 84, 96, .06), transparent 72%);
  filter: blur(2px);
}
.orrery-atlas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; opacity: .9; }
.orrery-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 1; }
.orrery-scan {
  position: absolute; inset: 0; pointer-events: none; z-index: 2; mix-blend-mode: multiply; opacity: .5;
  background:
    repeating-linear-gradient(to bottom, rgba(36,29,24,.05) 0, rgba(36,29,24,.05) 1px, transparent 2px, transparent 4px),
    radial-gradient(120% 100% at 50% 50%, transparent 58%, rgba(31,84,96,.14) 88%, rgba(36,29,24,.22) 100%);
}
.orrery-frame { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.orrery-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 3; }

.orrery-labels :deep(.lab) { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; transition: opacity .3s, color .3s; }
.orrery-labels :deep(.lab .dot) { width: 5px; height: 5px; border: 1px solid var(--rust, #C0562A); border-radius: 50%; margin: 0 auto 5px; background: #F1EADB; }
.orrery-labels :deep(.lab .tx) { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .05em; color: var(--ink-soft, #6B5C4C); }
.orrery-labels :deep(.lab .tx .cat) { color: var(--rust, #C0562A); margin-right: 5px; }
.orrery-labels :deep(.lab.on .tx) { color: var(--ink, #241D18); font-weight: 500; }
.orrery-labels :deep(.lab.on .dot) { background: var(--rust, #C0562A); }
.orrery-labels :deep(.lab.dim) { opacity: .3; }

.orrery-chrome { position: absolute; top: 16px; left: 18px; z-index: 4; pointer-events: none; }
.orrery-eyebrow { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .18em; color: var(--rust, #C0562A); text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.orrery-eyebrow::before { content: ''; width: 22px; height: 1px; background: var(--rust, #C0562A); }
.orrery-plateno { position: absolute; top: 16px; right: 18px; font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .12em; color: var(--ink-faint, #A7967D); }
.orrery-chrome, .orrery-plateno { }
.orrery-hint { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; gap: 16px; font-family: var(--mono, monospace); font-size: 10px; letter-spacing: .08em; color: var(--ink-faint, #A7967D); pointer-events: none; }
.orrery-hint span { display: inline-flex; align-items: center; gap: 6px; }
.orrery-hint i { width: 5px; height: 5px; border-radius: 50%; background: var(--rust, #C0562A); }

.orrery-card {
  position: absolute; right: 18px; top: 50%; transform: translateY(-50%) translateX(24px);
  width: min(300px, 84%); background: var(--fn-card); color: var(--ink, #241D18);
  border: 1px solid rgba(36, 29, 24, .14); box-shadow: 12px 16px 0 -6px rgba(36, 29, 24, .06), 0 30px 60px -34px rgba(36, 29, 24, .5);
  opacity: 0; pointer-events: none; z-index: 6; transition: opacity .38s cubic-bezier(.22,1,.36,1), transform .38s cubic-bezier(.22,1,.36,1);
}
.orrery-card.show { opacity: 1; transform: translateY(-50%) translateX(0); pointer-events: auto; }
@media (max-width: 640px) {
  .orrery-card { right: 12px; left: 12px; top: auto; bottom: 44px; width: auto; transform: translateY(16px); }
  .orrery-card.show { transform: translateY(0); }
}
.fn-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid rgba(36, 29, 24, .09); }
.fn-head .k { font-family: var(--mono, monospace); font-size: 10px; letter-spacing: .16em; color: var(--rust, #C0562A); }
.fn-close { width: 22px; height: 22px; border: 1px solid rgba(36, 29, 24, .16); background: none; color: var(--ink-soft, #6B5C4C); cursor: pointer; font-size: 13px; line-height: 1; display: grid; place-items: center; }
.fn-close:hover { border-color: var(--rust, #C0562A); color: var(--rust, #C0562A); }
.fn-photo { position: relative; height: 118px; overflow: hidden; background: linear-gradient(160deg, #1f4450, #14232a); display: flex; align-items: center; justify-content: center; }
.fn-photo img { width: 100%; height: 100%; object-fit: cover; }
.fn-photo-name { font-family: var(--serif, Georgia); font-weight: 600; color: #EBCB85; font-size: 1.1rem; }
.fn-wave { position: absolute; bottom: -1px; left: 0; width: 100%; height: 34px; }
.fn-body { padding: 14px 18px 18px; }
.fn-idx { font-family: var(--mono, monospace); font-size: 11px; color: var(--ink-faint, #A7967D); letter-spacing: .1em; }
.fn-idx .star { color: var(--rust, #C0562A); }
.fn-body h3 { font-family: var(--serif, Georgia); font-weight: 600; font-size: 1.45rem; margin: 6px 0 4px; line-height: 1.15; color: var(--ink, #241D18); }
.fn-body p { font-size: 13px; line-height: 1.62; color: var(--ink-soft, #6B5C4C); }
.fn-meta { margin-top: 13px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px dashed rgba(36, 29, 24, .09); }
.chipm { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--ink-soft, #6B5C4C); border: 1px solid rgba(36, 29, 24, .14); padding: 3px 9px; }
.fn-go { margin-left: auto; background: var(--rust, #C0562A); color: #F4EEE1; border: none; padding: 7px 13px; font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer; border-radius: 2px; transition: background .2s; }
.fn-go:hover { background: var(--rust-deep, #95401A); }

.orrery-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-soft, #6B5C4C); font-size: 13px; z-index: 7; }
</style>
