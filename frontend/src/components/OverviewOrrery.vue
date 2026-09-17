<template>
  <div ref="rootRef" class="orrery">
    <canvas ref="canvasRef" class="orrery-canvas"></canvas>

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

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let root: THREE.Group | null = null
let armilla: THREE.Group | null = null
let sun: THREE.Mesh | null = null
let markers: THREE.Group[] = []
let hitTargets: THREE.Object3D[] = []
let labelEls: HTMLElement[] = []
let rafId = 0
let ro: ResizeObserver | null = null
const clock = new THREE.Clock()
const rayc = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const vTmp = new THREE.Vector3()

let camDist = 18
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
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 24),
      new THREE.MeshPhongMaterial({ color: 0xc79a45, specular: 0xffffff, shininess: 110, emissive: 0x1a1206, emissiveIntensity: .3 }))
    g.add(bead)
    // subtle glow
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: brassGlow, color: 0xffffff, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.scale.set(1.5, 1.5, 1); g.add(glow)
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 12, 60), brassMat(.9)); ringM.rotation.x = 1.1 + i * 0.2; g.add(ringM)
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 12, 60), brassMat(.55)); ring2.rotation.set(0.4, 0.8 + i, 0); g.add(ring2)
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.78, 10, 10), new THREE.MeshBasicMaterial({ visible: false })); hit.userData = { index: i }; g.add(hit)
    ;(g as any).userData = { index: i, bead, glow, ringM, ring2, phase: Math.random() * 6.28 }
    root!.add(g); markers.push(g); hitTargets.push(hit)
  })

  // labels
  if (labelsRef.value) {
    labelEls = items.map((it, i) => {
      const d = document.createElement('div'); d.className = 'lab'
      d.innerHTML = `<div class="dot"></div><div class="tx"><span class="cat">${GREEK[i % GREEK.length]}</span>${it.name}</div>`
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

function resize() {
  const host = rootRef.value
  if (!host || !renderer || !camera) return
  const w = host.clientWidth, h = host.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h; camera.updateProjectionMatrix()
  drawFrame()
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
function onWheel(e: WheelEvent) { camDist = Math.max(11, Math.min(30, camDist + e.deltaY * 0.012)); e.preventDefault() }
function onClick() { if (moved) return; const i = pick(); if (i >= 0) { imgFailed.value = false; selected.value = i } else closeCard() }

function closeCard() { selected.value = -1 }
function onImgError() { imgFailed.value = true }
function emitSelectDay(d: number) { emit('select-day', d) }

function loop() {
  rafId = requestAnimationFrame(loop)
  if (!renderer || !scene || !camera || !root) return
  const t = clock.getElapsedTime(); idle += 0.016
  if (!dragging && idle > 1.4) tYaw += 0.0011 * 60 * 0.016
  yaw += (tYaw - yaw) * 0.07; pitch += (tPitch - pitch) * 0.07
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw)
  camera.position.set(camDist * cp * sy, camDist * sp, camDist * cp * cy); camera.lookAt(0, 0, 0)
  if (armilla) { armilla.rotation.y = t * 0.05; if (armilla.children[2]) armilla.children[2].rotation.z = t * 0.08 }
  if (sun) sun.rotation.y = t * 0.4

  if (!dragging) { const hp = pick(); if (hp !== hovered) { hovered = hp; if (canvasRef.value) canvasRef.value.style.cursor = hp >= 0 ? 'pointer' : 'grab' } }

  const host = rootRef.value
  markers.forEach((g, i) => {
    const ud = (g as any).userData
    const active = i === hovered || i === selected.value
    const pulse = 1 + Math.sin(t * 1.6 + ud.phase) * 0.05
    ud.bead.scale.setScalar((active ? 1.5 : 1) * pulse)
    ud.bead.material.emissiveIntensity = active ? 0.55 : 0.3
    ud.bead.material.color.setHex(active ? 0xe7ce93 : 0xc79a45)
    ud.glow.scale.setScalar((active ? 2.6 : 1.5) * pulse)
    ud.glow.material.opacity = active ? 0.85 : 0.5
    ud.ringM.rotation.z = t * 0.6 + i; ud.ring2.rotation.z = -t * 0.4 + i
    // label projection
    if (host && labelEls[i] && camera) {
      vTmp.copy(g.position).project(camera)
      const lb = labelEls[i]
      if (vTmp.z > 1) { lb.style.display = 'none' }
      else {
        lb.style.display = 'block'
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

  const ring = (radius: number, tube: number, rx: number, ry: number, rz: number, op: number) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 16, 130), brassMat(op)); m.rotation.set(rx, ry, rz); return m
  }
  armilla.add(ring(6.1, 0.05, Math.PI / 2, 0, 0, .9))
  armilla.add(ring(6.1, 0.05, 0, 0, 0, .9))
  armilla.add(ring(5.4, 0.04, 0.41, 0, 0, .8))
  armilla.add(ring(6.5, 0.03, Math.PI / 2, 0, 0, .5))
  const ticks = new THREE.Group()
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, long = i % 9 === 0
    const tk = new THREE.Mesh(new THREE.BoxGeometry(0.02, long ? 0.34 : 0.16, 0.02), brassMat(.65))
    tk.position.set(Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5); tk.rotation.y = -a; ticks.add(tk)
  }
  ticks.rotation.x = Math.PI / 2; armilla.add(ticks)

  sun = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 24),
    new THREE.MeshPhongMaterial({ color: 0xe7ce93, specular: 0xffffff, shininess: 120, emissive: 0xc0562a, emissiveIntensity: .2 }))
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: brassGlow, color: 0xffe6b0, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }))
  sunGlow.scale.set(2.2, 2.2, 1); sun.add(sunGlow)
  armilla.add(sun)

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
  scene = null; camera = null; root = null; armilla = null; markers = []
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
    radial-gradient(115% 80% at 50% 42%, rgba(255, 251, 242, .5), transparent 60%),
    radial-gradient(120% 90% at 50% -8%, rgba(192, 86, 42, .09), transparent 55%),
    radial-gradient(150% 120% at 50% 120%, rgba(31, 84, 96, .1), transparent 60%),
    #F1EADB;
}
@media (max-width: 640px) { .orrery { height: 420px; } }
.orrery::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, rgba(36, 29, 24, .05) 1px, transparent 1px);
  background-size: 22px 22px; opacity: .5;
}
.orrery-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
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
