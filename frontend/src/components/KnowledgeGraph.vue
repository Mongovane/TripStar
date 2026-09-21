<template>
  <div ref="rootRef" class="kg">
    <div class="kg-chrome">
      <div class="kg-eyebrow">RELATION ASTROLABE · 关系星盘</div>
      <div class="kg-legend">
        <span v-for="c in usedCats" :key="c.idx" class="kg-leg-item">
          <span class="kg-leg-dot" :style="{ background: colorOf(c.idx) }"></span>{{ c.name }}
        </span>
      </div>
    </div>

    <!-- 缓转刻度虚环：独立合成层，GPU 旋转（呼应星盘、不卡） -->
    <svg class="kg-dial" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <circle cx="400" cy="280" r="252" fill="none" stroke="rgba(36,29,24,.14)" stroke-width="1" stroke-dasharray="2 8" />
    </svg>

    <svg class="kg-svg" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet" @pointerleave="hovered = ''">
      <!-- 静态导星环 -->
      <g fill="none" stroke="rgba(36,29,24,.1)">
        <circle cx="400" cy="280" r="118" />
        <circle cx="400" cy="280" r="196" />
        <circle cx="400" cy="280" r="262" stroke="rgba(36,29,24,.06)" />
      </g>

      <!-- 向心弯曲连线 -->
      <g class="kg-edges" fill="none">
        <path v-for="(e, i) in laidEdges" :key="`e-${i}`" :d="e.d"
          class="kg-edge" :class="{ dim: hovered && !edgeActive(e), on: edgeActive(e) }" />
      </g>

      <!-- 节点 -->
      <g class="kg-nodes">
        <g v-for="n in laid" :key="n.id" class="kg-node"
          :class="{ dim: hovered && !nodeActive(n.id), on: hovered === n.id, center: n.isCenter }"
          @pointerenter="hovered = n.id" @click="hovered = hovered === n.id ? '' : n.id">
          <title>{{ n.name }}{{ n.value ? ' · ' + n.value : '' }}</title>
          <circle :cx="n.x" :cy="n.y" :r="n.r + (n.isCenter ? 14 : 7)" class="kg-halo" :fill="colorOf(n.category)" />
          <circle :cx="n.x" :cy="n.y" :r="n.r" :fill="colorOf(n.category)" class="kg-dot"
            stroke="rgba(255,255,255,.75)" :stroke-width="n.isCenter ? 2 : 1.5" />
          <text :x="n.x" :y="n.isCenter ? n.y + 5 : n.y + n.r + 14" text-anchor="middle"
            class="kg-label" :class="{ 'kg-label-center': n.isCenter }" font-family="var(--mono,monospace)">{{ hovered === n.id ? hoverLabel(n.name) : shortLabel(n.name) }}</text>
          <text v-if="n.value" :x="n.x" :y="n.isCenter ? n.y + 20 : n.y + n.r + 27" text-anchor="middle"
            class="kg-value" :class="{ show: hovered === n.id || n.isCenter }" font-family="var(--mono,monospace)">{{ n.value }}</text>
        </g>
      </g>
    </svg>
    <div v-if="!hasData" class="kg-empty">暂无关系图谱数据</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { KnowledgeGraphData, GraphNode } from '@/types'

const props = defineProps<{ data: KnowledgeGraphData | null }>()

const VW = 800, VH = 560, CX = 400, CY = 280
const rootRef = ref<HTMLElement | null>(null)
const hovered = ref('')

const PALETTE = ['#C0562A', '#1F5460', '#B08637', '#7C6FE0', '#4FC58E', '#D96FA0', '#2FB4C9', '#E0705A']
const colorOf = (cat: number) => PALETTE[((cat || 0) % PALETTE.length + PALETTE.length) % PALETTE.length]

const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s)
const shortLabel = (name: string) => trunc(name, 8)
const hoverLabel = (name: string) => trunc(name, 20)

// 判断“长句/建议”类节点（非实体，移出图谱）
function isNarrative(n: GraphNode, catName: string) {
  if (/建议|偏好|suggestion|tips|preference|好み|おすすめ/i.test(catName)) return true
  if ((n.name || '').length > 16) return true
  return false
}

type LaidNode = GraphNode & { x: number; y: number; r: number; isCenter: boolean }
const laid = ref<LaidNode[]>([])
const laidEdges = ref<{ d: string; s: string; t: string }[]>([])
const usedCats = ref<{ idx: number; name: string }[]>([])
const adjacency = ref<Record<string, Set<string>>>({})
const hasData = computed(() => laid.value.length > 0)

function nodeActive(id: string) {
  if (!hovered.value) return true
  if (id === hovered.value) return true
  return adjacency.value[hovered.value]?.has(id)
}
function edgeActive(e: { s: string; t: string }) {
  return !!hovered.value && (e.s === hovered.value || e.t === hovered.value)
}

function computeLayout() {
  const d = props.data
  if (!d || !d.nodes || d.nodes.length === 0) { laid.value = []; laidEdges.value = []; usedCats.value = []; return }
  const catName = (i: number) => (d.categories && d.categories[i] ? d.categories[i].name : '')

  // 过滤掉长句/建议类节点
  const nodes = d.nodes.filter((n) => !isNarrative(n, catName(Number(n.category))))
  const keep = new Set(nodes.map((n) => n.id))
  const edges = (d.edges || []).filter((e) => keep.has(e.source) && keep.has(e.target))

  // 度数 → 选中心（城市/枢纽）
  const deg: Record<string, number> = {}
  nodes.forEach((n) => { deg[n.id] = 0 })
  edges.forEach((e) => { deg[e.source]++; deg[e.target]++ })
  let center = nodes[0]
  nodes.forEach((n) => { if (deg[n.id] > deg[center.id]) center = n })

  const leaves = nodes.filter((n) => n.id !== center.id)
  // 按分类分组、类内相邻
  const byCat: Record<string, GraphNode[]> = {}
  leaves.forEach((n) => { const k = String(n.category); (byCat[k] ||= []).push(n) })
  const catKeys = Object.keys(byCat).sort((a, b) => Number(a) - Number(b))
  const ordered: GraphNode[] = []
  catKeys.forEach((k) => byCat[k].forEach((n) => ordered.push(n)))

  const N = Math.max(ordered.length, 1)
  const map: Record<string, LaidNode> = {}
  const laidNodes: LaidNode[] = []

  const c: LaidNode = { ...center, x: CX, y: CY, r: 24, isCenter: true }
  map[c.id] = c; laidNodes.push(c)

  ordered.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i / N) * Math.PI * 2
    const tier = i % 2
    const R = tier === 0 ? 150 : 210
    const ln: LaidNode = {
      ...n,
      x: CX + Math.cos(ang) * R * 1.28,
      y: CY + Math.sin(ang) * R,
      r: Math.max(9, Math.min(18, (n.symbolSize || 40) * 0.3)),
      isCenter: false,
    }
    map[n.id] = ln; laidNodes.push(ln)
  })

  // 邻接
  const adj: Record<string, Set<string>> = {}
  laidNodes.forEach((n) => { adj[n.id] = new Set() })
  edges.forEach((e) => { adj[e.source].add(e.target); adj[e.target].add(e.source) })
  adjacency.value = adj

  // 向心弯曲弧线
  laidEdges.value = edges.map((e) => {
    const a = map[e.source], b = map[e.target]
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const qx = mx + (CX - mx) * 0.35, qy = my + (CY - my) * 0.35
    return { d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`, s: e.source, t: e.target }
  })

  laid.value = laidNodes
  usedCats.value = catKeys.concat(String(center.category)).filter((v, i, arr) => arr.indexOf(v) === i)
    .map((k) => ({ idx: Number(k), name: catName(Number(k)) || '类别' }))
    .sort((a, b) => a.idx - b.idx)
}

watch(() => props.data, computeLayout, { deep: false })
onMounted(computeLayout)
</script>

<style scoped>
.kg {
  position: relative; width: 100%; min-height: 560px; border-radius: 4px; overflow: hidden;
  background:
    radial-gradient(120% 85% at 50% 40%, rgba(255, 251, 242, .55), transparent 62%),
    radial-gradient(60% 55% at 50% 50%, rgba(217, 164, 65, .09), transparent 66%),
    radial-gradient(150% 120% at 50% 118%, rgba(31, 84, 96, .1), transparent 60%),
    #EFE7D6;
}
.kg::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle, rgba(36, 29, 24, .045) 1px, transparent 1px);
  background-size: 22px 22px; opacity: .38;
}
.kg-chrome { position: absolute; top: 16px; left: 18px; right: 18px; z-index: 3; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; }
.kg-eyebrow { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .18em; color: var(--rust, #C0562A); text-transform: uppercase; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.kg-eyebrow::before { content: ''; width: 22px; height: 1px; background: var(--rust, #C0562A); }
.kg-legend { display: flex; flex-wrap: wrap; gap: 5px 12px; justify-content: flex-end; }
.kg-leg-item { font-family: var(--mono, monospace); font-size: 10px; color: var(--ink-soft, #6B5C4C); display: inline-flex; align-items: center; gap: 5px; }
.kg-leg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

.kg-dial { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; transform-origin: center; will-change: transform; animation: kg-spin 120s linear infinite; }
@keyframes kg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .kg-dial { animation: none; } }

.kg-svg { position: relative; z-index: 1; width: 100%; height: 100%; min-height: 560px; display: block; }

.kg-edge { stroke: rgba(36, 29, 24, .22); stroke-width: 1.1; transition: stroke .2s, opacity .2s, stroke-width .2s; }
.kg-edge.dim { opacity: .1; }
.kg-edge.on { stroke: var(--rust, #C0562A); stroke-width: 1.8; opacity: 1; }

.kg-node { cursor: pointer; transition: opacity .2s; }
.kg-node.dim { opacity: .26; }
.kg-halo { opacity: .16; transition: opacity .2s, transform .2s; transform-box: fill-box; transform-origin: center; }
.kg-dot { transition: transform .2s; transform-box: fill-box; transform-origin: center; }
.kg-node.center .kg-halo { opacity: .28; animation: kg-pulse 3.4s ease-in-out infinite; }
@keyframes kg-pulse { 0%,100% { transform: scale(1); opacity: .28; } 50% { transform: scale(1.18); opacity: .16; } }
.kg-node.on .kg-halo { opacity: .36; transform: scale(1.3); }
.kg-node.on .kg-dot { transform: scale(1.18); }
.kg-label { font-size: 11px; fill: var(--ink, #241D18); pointer-events: none; }
.kg-label-center { font-family: var(--serif, Georgia) !important; font-weight: 600; font-size: 15px; fill: #fff; }
.kg-value { font-size: 9.5px; fill: var(--rust-deep, #95401A); pointer-events: none; opacity: 0; transition: opacity .2s; }
.kg-value.show { opacity: 1; }
.kg-node.center .kg-value { fill: rgba(255,255,255,.92); }

.kg-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-soft, #6B5C4C); font-size: 13px; z-index: 2; }
</style>
