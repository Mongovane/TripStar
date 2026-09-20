<template>
  <div ref="rootRef" class="kg">
    <div class="kg-chrome">
      <div class="kg-eyebrow">KNOWLEDGE GRAPH · 关系图谱</div>
      <div class="kg-legend">
        <span v-for="(c, i) in cats" :key="i" class="kg-leg-item">
          <span class="kg-leg-dot" :style="{ background: colorOf(i) }"></span>{{ c.name }}
        </span>
      </div>
    </div>

    <svg class="kg-svg" :viewBox="`0 0 ${VW} ${VH}`" preserveAspectRatio="xMidYMid meet"
      @pointerleave="hovered = ''">
      <!-- 边 -->
      <g class="kg-edges">
        <g v-for="(e, i) in laidEdges" :key="`e-${i}`" :class="{ dim: hovered && !edgeActive(e), on: edgeActive(e) }">
          <line :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" class="kg-edge" />
          <text v-if="e.label && (edgeActive(e) || !hovered)" :x="(e.x1 + e.x2) / 2" :y="(e.y1 + e.y2) / 2 - 3"
            class="kg-edge-label" text-anchor="middle">{{ e.label }}</text>
        </g>
      </g>
      <!-- 节点 -->
      <g class="kg-nodes">
        <g v-for="n in laid" :key="n.id" class="kg-node"
          :class="{ dim: hovered && !nodeActive(n.id), on: hovered === n.id }"
          @pointerenter="hovered = n.id" @click="hovered = hovered === n.id ? '' : n.id">
          <circle :cx="n.x" :cy="n.y" :r="n.r + 7" class="kg-halo" :fill="colorOf(n.category)" />
          <circle :cx="n.x" :cy="n.y" :r="n.r" :fill="colorOf(n.category)" class="kg-dot"
            stroke="rgba(255,255,255,.7)" stroke-width="1.5" />
          <text :x="n.x" :y="n.y + n.r + 13" text-anchor="middle" class="kg-label"
            font-family="var(--mono,monospace)">{{ n.name }}</text>
          <text v-if="n.value && hovered === n.id" :x="n.x" :y="n.y + n.r + 26" text-anchor="middle"
            class="kg-value" font-family="var(--mono,monospace)">{{ n.value }}</text>
        </g>
      </g>
    </svg>
    <div v-if="!data || !data.nodes || data.nodes.length === 0" class="kg-empty">暂无关系图谱数据</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { KnowledgeGraphData, GraphNode } from '@/types'

const props = defineProps<{ data: KnowledgeGraphData | null }>()

const VW = 900
const VH = 560
const rootRef = ref<HTMLElement | null>(null)
const hovered = ref('')

// 暖色宝石调色板（按分类），与星盘/整站一致，避免深色 echarts 的隔离感
const PALETTE = ['#C0562A', '#1F5460', '#B08637', '#7C6FE0', '#4FC58E', '#D96FA0', '#2FB4C9', '#E0705A']
const colorOf = (cat: number) => PALETTE[((cat || 0) % PALETTE.length + PALETTE.length) % PALETTE.length]

const cats = ref<{ name: string }[]>([])
type LaidNode = GraphNode & { x: number; y: number; r: number }
const laid = ref<LaidNode[]>([])
const laidEdges = ref<{ x1: number; y1: number; x2: number; y2: number; label?: string; s: string; t: string }[]>([])
const adjacency = ref<Record<string, Set<string>>>({})

function nodeActive(id: string) {
  if (!hovered.value) return true
  if (id === hovered.value) return true
  return adjacency.value[hovered.value]?.has(id)
}
function edgeActive(e: { s: string; t: string }) {
  return hovered.value && (e.s === hovered.value || e.t === hovered.value)
}

// 轻量力导向布局（一次性计算，无依赖）
function computeLayout() {
  const d = props.data
  if (!d || !d.nodes || d.nodes.length === 0) { laid.value = []; laidEdges.value = []; cats.value = []; return }
  cats.value = d.categories || []

  let seed = 20260924
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

  const nodes: LaidNode[] = d.nodes.map((n, i) => {
    const a = (i / d.nodes.length) * Math.PI * 2
    return {
      ...n,
      r: Math.max(9, Math.min(24, (n.symbolSize || 40) * 0.34)),
      x: VW / 2 + Math.cos(a) * 150 + (rnd() - 0.5) * 30,
      y: VH / 2 + Math.sin(a) * 130 + (rnd() - 0.5) * 30,
    }
  })
  const map: Record<string, LaidNode> = {}
  nodes.forEach((n) => { map[n.id] = n })
  const vel: Record<string, { vx: number; vy: number }> = {}
  nodes.forEach((n) => { vel[n.id] = { vx: 0, vy: 0 } })

  const edges = (d.edges || []).filter((e) => map[e.source] && map[e.target])
  const adj: Record<string, Set<string>> = {}
  nodes.forEach((n) => { adj[n.id] = new Set() })
  edges.forEach((e) => { adj[e.source].add(e.target); adj[e.target].add(e.source) })
  adjacency.value = adj

  for (let it = 0; it < 320; it++) {
    const cool = 1 - it / 320
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        let dx = a.x - b.x, dy = a.y - b.y
        let dist = Math.hypot(dx, dy) || 0.1
        const rep = 3200 / (dist * dist)
        const fx = (dx / dist) * rep, fy = (dy / dist) * rep
        vel[a.id].vx += fx; vel[a.id].vy += fy
        vel[b.id].vx -= fx; vel[b.id].vy -= fy
      }
    }
    edges.forEach((e) => {
      const a = map[e.source], b = map[e.target]
      let dx = b.x - a.x, dy = b.y - a.y
      let dist = Math.hypot(dx, dy) || 0.1
      const spring = (dist - 104) * 0.03
      const fx = (dx / dist) * spring, fy = (dy / dist) * spring
      vel[a.id].vx += fx; vel[a.id].vy += fy
      vel[b.id].vx -= fx; vel[b.id].vy -= fy
    })
    nodes.forEach((n) => {
      vel[n.id].vx += (VW / 2 - n.x) * 0.01
      vel[n.id].vy += (VH / 2 - n.y) * 0.01
      n.x += Math.max(-10, Math.min(10, vel[n.id].vx)) * cool
      n.y += Math.max(-10, Math.min(10, vel[n.id].vy)) * cool
      vel[n.id].vx *= 0.86; vel[n.id].vy *= 0.86
    })
  }

  // 归一化到画布（留边距）
  const pad = 60
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  nodes.forEach((n) => { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y) })
  const sx = (VW - pad * 2) / Math.max(maxX - minX, 1)
  const sy = (VH - pad * 2) / Math.max(maxY - minY, 1)
  const s = Math.min(sx, sy)
  const ox = (VW - (maxX - minX) * s) / 2 - minX * s
  const oy = (VH - (maxY - minY) * s) / 2 - minY * s
  nodes.forEach((n) => { n.x = n.x * s + ox; n.y = n.y * s + oy })

  laid.value = nodes
  laidEdges.value = edges.map((e) => ({
    x1: map[e.source].x, y1: map[e.source].y, x2: map[e.target].x, y2: map[e.target].y,
    label: e.label, s: e.source, t: e.target,
  }))
}

watch(() => props.data, computeLayout, { deep: false })
onMounted(computeLayout)
</script>

<style scoped>
.kg {
  position: relative; width: 100%; min-height: 560px; border-radius: 4px; overflow: hidden;
  background:
    radial-gradient(120% 85% at 50% 40%, rgba(255, 251, 242, .55), transparent 62%),
    radial-gradient(90% 70% at 50% 46%, rgba(217, 164, 65, .08), transparent 60%),
    radial-gradient(150% 120% at 50% 118%, rgba(31, 84, 96, .1), transparent 60%),
    #EFE7D6;
}
.kg::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle, rgba(36, 29, 24, .045) 1px, transparent 1px);
  background-size: 22px 22px; opacity: .4;
}
.kg-chrome { position: absolute; top: 16px; left: 18px; right: 18px; z-index: 2; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; }
.kg-eyebrow { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .18em; color: var(--rust, #C0562A); text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.kg-eyebrow::before { content: ''; width: 22px; height: 1px; background: var(--rust, #C0562A); }
.kg-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: flex-end; max-width: 60%; }
.kg-leg-item { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--ink-soft, #6B5C4C); display: inline-flex; align-items: center; gap: 6px; }
.kg-leg-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }

.kg-svg { position: relative; z-index: 1; width: 100%; height: 100%; min-height: 560px; display: block; }

.kg-edge { stroke: rgba(36, 29, 24, .28); stroke-width: 1.2; }
.kg-edge-label { font-family: var(--mono, monospace); font-size: 9.5px; fill: var(--ink-faint, #A7967D); }
.kg-edges g { transition: opacity .2s; }
.kg-edges g.dim { opacity: .12; }
.kg-edges g.on .kg-edge { stroke: var(--rust, #C0562A); stroke-width: 1.8; }

.kg-node { cursor: pointer; transition: opacity .2s; }
.kg-node.dim { opacity: .28; }
.kg-halo { opacity: .16; transition: opacity .2s, transform .2s; transform-box: fill-box; transform-origin: center; }
.kg-dot { transition: transform .2s; transform-box: fill-box; transform-origin: center; }
.kg-node.on .kg-halo { opacity: .34; transform: scale(1.3); }
.kg-node.on .kg-dot { transform: scale(1.18); }
.kg-label { font-size: 11px; fill: var(--ink, #241D18); pointer-events: none; }
.kg-value { font-size: 10px; fill: var(--rust-deep, #95401A); pointer-events: none; }

.kg-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-soft, #6B5C4C); font-size: 13px; z-index: 2; }
</style>
