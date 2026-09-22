<template>
  <div ref="rootRef" class="kg">
    <div class="kg-chrome">
      <div class="kg-eyebrow">CONSTELLATION CHART · 关系星图</div>
      <div class="kg-legend">
        <span v-for="c in usedCats" :key="c.idx" class="kg-leg-item">
          <span class="kg-leg-dot" :style="{ background: colorOf(c.idx) }"></span>{{ c.name }}
        </span>
      </div>
    </div>

    <!-- 缓转刻度虚环：独立合成层，GPU 旋转 -->
    <svg class="kg-dial" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <circle cx="500" cy="308" r="300" fill="none" stroke="rgba(36,29,24,.13)" stroke-width="1" stroke-dasharray="2 10" />
    </svg>

    <svg class="kg-svg" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet" @pointerleave="hovered = ''">
      <defs>
        <radialGradient v-for="(c, i) in PALETTE" :key="`g-${i}`" :id="`kgGlow${i}`">
          <stop offset="0%" :stop-color="c" stop-opacity="0.55" />
          <stop offset="45%" :stop-color="c" stop-opacity="0.14" />
          <stop offset="100%" :stop-color="c" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="kgSun">
          <stop offset="0%" stop-color="#E9A24E" stop-opacity="0.7" />
          <stop offset="40%" stop-color="#C0562A" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#C0562A" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- 星盘导星环 -->
      <g fill="none" stroke="rgba(36,29,24,.08)">
        <circle cx="500" cy="308" r="150" />
        <circle cx="500" cy="308" r="240" />
      </g>
      <!-- 背景微星 -->
      <g>
        <circle v-for="(s, i) in bgStars" :key="`bs-${i}`" :cx="s.x" :cy="s.y" :r="s.r" :fill="`rgba(36,29,24,${s.o})`" />
      </g>

      <!-- 星座连线 -->
      <g class="kg-edges">
        <path v-for="(e, i) in laidEdges" :key="`e-${i}`" :d="e.d"
          class="kg-edge" :class="{ dim: hovered && !edgeActive(e), on: edgeActive(e) }" />
      </g>

      <!-- 星辰 -->
      <g class="kg-nodes">
        <g v-for="n in laid" :key="n.id" class="kg-node"
          :class="{ dim: hovered && !nodeActive(n.id), on: hovered === n.id, center: n.isCenter }"
          @pointerenter="hovered = n.id" @click="hovered = hovered === n.id ? '' : n.id">
          <title>{{ n.name }}{{ n.value ? ' · ' + n.value : '' }}</title>
          <!-- 辉光 -->
          <circle :cx="n.x" :cy="n.y" :r="n.isCenter ? 74 : n.r * 3.4" class="kg-glow"
            :fill="n.isCenter ? 'url(#kgSun)' : `url(#kgGlow${n.paletteIdx})`" />
          <!-- 星核 -->
          <circle :cx="n.x" :cy="n.y" :r="n.r" :fill="colorOf(n.category)" class="kg-core"
            :stroke="n.isCenter ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.7)'" :stroke-width="n.isCenter ? 2 : 1.3" />
          <!-- 四芒星芒（中心 + 日程枢纽）：柔和黄铜，不刺眼 -->
          <path v-if="n.isHub" :d="sparkle(n.x, n.y, n.r * 1.22)" :fill="n.isCenter ? 'rgba(233,197,118,.55)' : 'rgba(217,164,65,.42)'" class="kg-spark" />
          <!-- 标签 -->
          <text :x="n.x" :y="n.isCenter ? n.y + 6 : n.y + n.r + 15" text-anchor="middle"
            class="kg-label" :class="{ 'kg-label-center': n.isCenter }">
            <tspan v-if="!n.isCenter" :fill="colorOf(n.category)" font-family="var(--mono,monospace)" font-size="10">{{ n.cat }} </tspan><tspan :fill="n.isCenter ? '#fff' : 'var(--ink,#241D18)'" font-family="var(--serif,Georgia,serif)" :font-weight="n.isCenter ? 700 : 500">{{ n.isCenter ? n.name : (hovered === n.id ? hoverLabel(n.name) : shortLabel(n.name)) }}</tspan>
          </text>
          <text v-if="n.value && (n.isCenter || String(n.value).length <= 14)" :x="n.x" :y="n.isCenter ? n.y + 22 : n.y + n.r + 29" text-anchor="middle"
            class="kg-value" :class="{ show: hovered === n.id || n.isCenter }" font-family="var(--mono,monospace)">{{ n.value }}</text>
        </g>
      </g>

      <!-- 悬停信息卡：完整信息、不遮挡其它节点 -->
      <foreignObject v-if="tip" :x="tip.x" :y="tip.y" :width="tip.w" height="168" class="kg-tip-fo">
        <div xmlns="http://www.w3.org/1999/xhtml" class="kg-tip-card">
          <div class="kg-tip-cat" :style="{ color: colorOf(tip.n.category) }">
            <span class="kg-tip-dot" :style="{ background: colorOf(tip.n.category) }"></span>{{ tip.n.catName }}
          </div>
          <div class="kg-tip-name">{{ tip.n.name }}</div>
          <div v-for="(l, i) in tip.lines" :key="i" class="kg-tip-line">{{ l }}</div>
        </div>
      </foreignObject>
    </svg>
    <div v-if="!hasData" class="kg-empty">暂无关系图谱数据</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { KnowledgeGraphData, GraphNode } from '@/types'

const props = defineProps<{ data: KnowledgeGraphData | null }>()

const VW = 1000, VH = 620, CX = 500, CY = 308
const rootRef = ref<HTMLElement | null>(null)
const hovered = ref('')

const PALETTE = ['#C0562A', '#1F5460', '#B08637', '#7C6FE0', '#4FC58E', '#D96FA0', '#2FB4C9', '#E0705A']
const colorOf = (cat: number) => PALETTE[((cat || 0) % PALETTE.length + PALETTE.length) % PALETTE.length]

const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s)
const shortLabel = (name: string) => trunc(name, 8)
const hoverLabel = (name: string) => trunc(name, 20)

// 四芒星芒路径
const sparkle = (cx: number, cy: number, r: number) => {
  const s = r * 0.32
  return `M ${cx} ${cy - r} L ${cx + s} ${cy - s} L ${cx + r} ${cy} L ${cx + s} ${cy + s} L ${cx} ${cy + r} L ${cx - s} ${cy + s} L ${cx - r} ${cy} L ${cx - s} ${cy - s} Z`
}

function isNarrative(n: GraphNode, catName: string) {
  if (/建议|偏好|suggestion|tips|preference|好み|おすすめ/i.test(catName)) return true
  if ((n.name || '').length > 16) return true
  return false
}

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π']

type LaidNode = GraphNode & {
  x: number; y: number; r: number; isCenter: boolean; isHub: boolean; paletteIdx: number; cat: string; catName: string
}
const laid = ref<LaidNode[]>([])
const laidEdges = ref<{ d: string; s: string; t: string }[]>([])
const usedCats = ref<{ idx: number; name: string }[]>([])
const adjacency = ref<Record<string, Set<string>>>({})
const hasData = computed(() => laid.value.length > 0)

// 悬停信息卡（完整显示，自动避让）
const hoveredNode = computed(() => laid.value.find((n) => n.id === hovered.value) || null)
const tip = computed(() => {
  const n = hoveredNode.value
  if (!n || n.isCenter) return null
  const lines = String(n.value || '').split(/\s*[|｜]\s*/).map((s) => s.trim()).filter(Boolean)
  const W = 258
  const placeRight = n.x < CX
  const x = placeRight ? Math.min(n.x + n.r + 14, VW - W - 8) : Math.max(n.x - n.r - 14 - W, 8)
  const y = Math.max(8, Math.min(n.y - 26, VH - 168))
  return { n, lines, x, y, w: W }
})

// 固定背景微星
const bgStars = (() => {
  let seed = 20260924
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const arr: { x: number; y: number; r: number; o: number }[] = []
  for (let i = 0; i < 70; i++) {
    const x = rnd() * VW, y = rnd() * VH
    if (Math.hypot(x - CX, y - CY) < 120) continue
    arr.push({ x: +x.toFixed(1), y: +y.toFixed(1), r: +(rnd() * 1 + 0.4).toFixed(1), o: +(rnd() * 0.18 + 0.06).toFixed(2) })
  }
  return arr
})()

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

  const nodes = d.nodes.filter((n) => !isNarrative(n, catName(Number(n.category))))
  const keep = new Set(nodes.map((n) => n.id))
  const edges = (d.edges || []).filter((e) => keep.has(e.source) && keep.has(e.target))
  const nodeById: Record<string, GraphNode> = {}
  nodes.forEach((n) => { nodeById[n.id] = n })

  // 邻接
  const adj: Record<string, Set<string>> = {}
  nodes.forEach((n) => { adj[n.id] = new Set() })
  edges.forEach((e) => { adj[e.source].add(e.target); adj[e.target].add(e.source) })
  adjacency.value = adj

  // 选根：城市分类，否则度数最高
  let root = nodes.find((n) => /城市|都市|city/i.test(catName(Number(n.category))))
  if (!root) { root = nodes[0]; nodes.forEach((n) => { if (adj[n.id].size > adj[root!.id].size) root = n }) }

  // BFS 生成树
  const depth: Record<string, number> = { [root.id]: 0 }
  const parent: Record<string, string | null> = { [root.id]: null }
  const children: Record<string, string[]> = {}
  nodes.forEach((n) => { children[n.id] = [] })
  const queue = [root.id]
  const seen = new Set([root.id])
  while (queue.length) {
    const id = queue.shift()!
    Array.from(adj[id]).forEach((nb) => {
      if (!seen.has(nb)) { seen.add(nb); depth[nb] = depth[id] + 1; parent[nb] = id; children[id].push(nb); queue.push(nb) }
    })
  }
  // 孤立点挂到根
  nodes.forEach((n) => { if (!seen.has(n.id)) { seen.add(n.id); depth[n.id] = 1; parent[n.id] = root!.id; children[root!.id].push(n.id) } })

  // 叶子数
  const leaves: Record<string, number> = {}
  const countLeaves = (id: string): number => {
    if (children[id].length === 0) { leaves[id] = 1; return 1 }
    let s = 0; children[id].forEach((c) => { s += countLeaves(c) }); leaves[id] = s; return s
  }
  countLeaves(root.id)

  // 递归分配角度
  const angleOf: Record<string, number> = {}
  const assign = (id: string, a0: number, a1: number) => {
    angleOf[id] = (a0 + a1) / 2
    const kids = children[id]
    if (!kids.length) return
    let a = a0
    kids.forEach((c) => {
      const span = (a1 - a0) * (leaves[c] / leaves[id])
      assign(c, a, a + span)
      a += span
    })
  }
  assign(root.id, -Math.PI / 2, Math.PI * 1.5)

  const RING = [0, 155, 262, 300]
  const catUse = new Set<number>()

  const laidNodes: LaidNode[] = nodes.map((n, i) => {
    const dep = Math.min(depth[n.id], 3)
    const ang = angleOf[n.id]
    const isCenter = n.id === root!.id
    const R = RING[dep]
    catUse.add(Number(n.category))
    return {
      ...n,
      isCenter,
      isHub: isCenter || dep === 1,
      paletteIdx: ((Number(n.category) || 0) % PALETTE.length + PALETTE.length) % PALETTE.length,
      cat: GREEK[i % GREEK.length],
      catName: catName(Number(n.category)) || '',
      r: isCenter ? 30 : dep === 1 ? Math.max(13, Math.min(20, (n.symbolSize || 40) * 0.34)) : Math.max(8, Math.min(14, (n.symbolSize || 40) * 0.26)),
      x: isCenter ? CX : CX + Math.cos(ang) * R * 1.34,
      y: isCenter ? CY : CY + Math.sin(ang) * R,
    }
  })
  const posById: Record<string, LaidNode> = {}
  laidNodes.forEach((n) => { posById[n.id] = n })

  // 星座连线：向心弯曲
  laidEdges.value = edges.map((e) => {
    const a = posById[e.source], b = posById[e.target]
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const qx = mx + (CX - mx) * 0.28, qy = my + (CY - my) * 0.28
    return { d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`, s: e.source, t: e.target }
  })

  laid.value = laidNodes
  usedCats.value = Array.from(catUse).sort((a, b) => a - b).map((k) => ({ idx: k, name: catName(k) || '类别' }))
}

watch(() => props.data, computeLayout, { deep: false })
onMounted(computeLayout)
</script>

<style scoped>
.kg {
  position: relative; width: 100%; min-height: 620px; border-radius: 4px; overflow: hidden;
  background:
    radial-gradient(70% 60% at 50% 44%, rgba(255, 251, 242, 0.65), transparent 62%),
    radial-gradient(120% 120% at 50% 42%, #F3ECDA 0%, #ECE1C8 55%, #E2D5B6 84%, #D9CBA9 100%);
}
.kg::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle, rgba(36, 29, 24, 0.04) 1px, transparent 1px);
  background-size: 24px 24px; opacity: 0.4;
}
.kg-chrome { position: absolute; top: 16px; left: 18px; right: 18px; z-index: 3; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; }
.kg-eyebrow { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: 0.18em; color: var(--rust, #C0562A); text-transform: uppercase; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.kg-eyebrow::before { content: ''; width: 22px; height: 1px; background: var(--rust, #C0562A); }
.kg-legend { display: flex; flex-wrap: wrap; gap: 5px 12px; justify-content: flex-end; }
.kg-leg-item { font-family: var(--mono, monospace); font-size: 10px; color: var(--ink-soft, #6B5C4C); display: inline-flex; align-items: center; gap: 5px; }
.kg-leg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

.kg-dial { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; transform-origin: center; will-change: transform; animation: kg-spin 140s linear infinite; }
@keyframes kg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .kg-dial { animation: none; } }

.kg-svg { position: relative; z-index: 1; width: 100%; height: 100%; min-height: 620px; display: block; }

.kg-edge { fill: none; stroke: rgba(36, 29, 24, 0.2); stroke-width: 1; transition: stroke 0.25s, opacity 0.25s, stroke-width 0.25s; }
.kg-edge.dim { opacity: 0.08; }
.kg-edge.on { stroke: var(--brass, #D9A441); stroke-width: 1.8; opacity: 1; }

.kg-node { cursor: pointer; transition: opacity 0.25s; }
.kg-node.dim { opacity: 0.22; }
.kg-glow { transition: opacity 0.25s, transform 0.25s; transform-box: fill-box; transform-origin: center; }
.kg-core { transition: transform 0.2s; transform-box: fill-box; transform-origin: center; }
.kg-spark { opacity: 0.9; transform-box: fill-box; transform-origin: center; }
.kg-node.center .kg-glow { animation: kg-breathe 4s ease-in-out infinite; }
@keyframes kg-breathe { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.82; } }
.kg-node.on .kg-glow { opacity: 1; transform: scale(1.35); }
.kg-node.on .kg-core { transform: scale(1.2); }
.kg-label { pointer-events: none; }
.kg-label tspan { font-size: 12px; }
.kg-label-center tspan { font-size: 16px; }
.kg-value { font-size: 9.5px; fill: var(--rust-deep, #95401A); pointer-events: none; opacity: 0; transition: opacity 0.2s; }
.kg-value.show { opacity: 1; }
.kg-node.center .kg-value { fill: rgba(255, 255, 255, 0.9); }

.kg-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-soft, #6B5C4C); font-size: 13px; z-index: 2; }

.kg-tip-fo { overflow: visible; pointer-events: none; }
.kg-tip-card {
  background: var(--card, #FBF7EE);
  border: 1px solid rgba(36, 29, 24, 0.16);
  border-radius: 6px;
  box-shadow: 0 12px 30px -12px rgba(36, 29, 24, 0.5);
  padding: 10px 13px;
  font-family: var(--sans, system-ui, sans-serif);
}
.kg-tip-cat {
  font-family: var(--mono, monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.kg-tip-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.kg-tip-name {
  font-family: var(--serif, Georgia, serif);
  font-weight: 600;
  font-size: 15px;
  color: var(--ink, #241D18);
  line-height: 1.25;
  margin-bottom: 4px;
}
.kg-tip-line {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-soft, #6B5C4C);
}
</style>
