<template>
  <div class="kg" :class="{ replaying: !!replay }">
    <div class="kg-nebula"></div>

    <!-- 缓转刻度虚环：独立合成层，GPU 旋转 -->
    <svg class="kg-dial" :viewBox="`0 0 ${VW} ${VH}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <circle :cx="CX" :cy="CY" r="338" fill="none" stroke="rgba(36,29,24,.12)" stroke-width="1" stroke-dasharray="2 10" />
    </svg>

    <svg v-if="hasData" class="kg-svg" :viewBox="`0 0 ${VW} ${VH}`" preserveAspectRatio="xMidYMid meet" @pointerleave="hovered = ''">
      <defs>
        <radialGradient v-for="(c, i) in HOUSE_TONES" :key="`g-${i}`" :id="`kgGlow${i}`">
          <stop offset="0%" :stop-color="c" stop-opacity="0.55" />
          <stop offset="45%" :stop-color="c" stop-opacity="0.14" />
          <stop offset="100%" :stop-color="c" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="kgSun">
          <stop offset="0%" stop-color="#E9A24E" stop-opacity="0.7" />
          <stop offset="40%" stop-color="#C0562A" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#C0562A" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="kgSunCore" cx="38%" cy="34%">
          <stop offset="0%" stop-color="#F2B872" />
          <stop offset="60%" stop-color="#C0562A" />
          <stop offset="100%" stop-color="#95401A" />
        </radialGradient>
      </defs>

      <!-- 空白处点击：复位 -->
      <rect x="0" y="0" :width="VW" :height="VH" fill="transparent" @click="reset" />

      <g class="kg-stage" :style="stageStyle">
        <!-- 背景微星 -->
        <g aria-hidden="true" class="kg-deco">
          <circle v-for="(s, i) in bgStars" :key="`bs-${i}`" :cx="s.x" :cy="s.y" :r="s.r" :fill="`rgba(36,29,24,${s.o})`" />
        </g>

        <!-- 宫位：扇区（可点击聚焦）+ 分宫辐线 -->
        <g class="kg-houses">
          <path v-for="h in graph.houses" :key="`w-${h.index}`" :d="h.wedge" class="kg-wedge"
            :class="{ on: focusHouse === h.index }" :style="{ '--tone': h.color }" @click.stop="focusOn(h.index)" />
          <template v-for="h in graph.houses" :key="`sp-${h.index}`">
            <line v-if="h.spoke" v-bind="h.spoke" class="kg-spoke" />
          </template>
        </g>

        <!-- 导星环 -->
        <g class="kg-deco" fill="none" stroke="rgba(36,29,24,.08)">
          <ellipse :cx="CX" :cy="CY" :rx="112 * 1.4" ry="112" />
          <ellipse :cx="CX" :cy="CY" :rx="194 * 1.4" ry="194" stroke-dasharray="1 5" />
          <ellipse :cx="CX" :cy="CY" :rx="262 * 1.4" ry="262" />
        </g>

        <!-- 预算星环 -->
        <g v-if="graph.ledger.length" class="kg-ledger">
          <ellipse :cx="CX" :cy="CY" :rx="324 * 1.4" ry="324" class="kg-ledger-track" />
          <path v-for="a in graph.ledger" :key="`l-${a.key}`" :d="a.d" :stroke="a.color" class="kg-ledger-arc"
            :class="{ on: ledgerHover === a.key, dim: ledgerHover && ledgerHover !== a.key }"
            @pointerenter="ledgerHover = a.key" @pointerleave="ledgerHover = ''" />
        </g>

        <!-- 宫名刻印 -->
        <g class="kg-house-labels">
          <text v-for="h in graph.houses" :key="`hl-${h.index}`" :x="h.label.x" :y="h.label.y + 4" text-anchor="middle"
            class="kg-house-label" :class="{ dim: focusHouse >= 0 && focusHouse !== h.index }">
            <tspan :fill="h.color" class="kg-numeral">{{ h.numeral }}</tspan>
            <tspan dx="5" class="kg-house-date">{{ shortDate(h.day.date) }}{{ multiCity && h.day.city ? ` · ${h.day.city}` : '' }}</tspan>
          </text>
        </g>

        <!-- 星座连线 -->
        <g class="kg-links">
          <path v-for="l in visibleLinks" :key="l.id" :d="l.d" class="kg-link" :class="[`l-${l.kind}`, linkClass(l)]" />
        </g>

        <!-- 航线回放：彗尾 + 彗星 -->
        <g v-if="replay" class="kg-comet" aria-hidden="true">
          <path :d="trail.d" class="kg-trail" />
          <circle :cx="trail.end.x" :cy="trail.end.y" r="16" fill="url(#kgSun)" />
          <circle :cx="trail.end.x" :cy="trail.end.y" r="3.6" fill="#FFF6E4" stroke="#C0562A" stroke-width="1.4" />
        </g>

        <!-- 天气徽记 -->
        <g v-if="!hiddenKinds.includes('day')" class="kg-wx-layer">
          <text v-for="h in graph.houses" v-show="h.weather" :key="`wx-${h.index}`" :x="h.badge.x" :y="h.badge.y + 4"
            text-anchor="middle" class="kg-wx" :class="{ dim: isHouseDimmed(h.index) }">
            <tspan class="kg-wx-glyph">{{ weatherGlyph(h.weather) }}</tspan> {{ h.weather ? `${h.weather.day_temp}°` : '' }}
          </text>
        </g>

        <!-- 星辰 -->
        <g class="kg-nodes">
          <g v-for="n in visibleNodes" :key="n.id" class="kg-node" :class="[`k-${n.kind}`, nodeClass(n)]"
            role="button" tabindex="0" :aria-label="`${kindLabel(n.kind)} · ${n.name}`"
            @pointerenter="hovered = n.id" @pointerleave="hovered = ''" @click.stop="pick(n)" @keydown.enter.prevent="pick(n)">
            <title>{{ n.name }}</title>

            <!-- 太阳 -->
            <template v-if="n.id === SUN_ID">
              <circle :cx="n.x" :cy="n.y" r="82" fill="url(#kgSun)" class="kg-glow kg-sun-glow" />
              <circle :cx="n.x" :cy="n.y" :r="n.r" fill="url(#kgSunCore)" stroke="rgba(255,255,255,.85)" stroke-width="2" class="kg-core" />
              <path :d="sparkle(n.x, n.y, 15)" fill="rgba(255,244,220,.92)" class="kg-spark" />
              <text v-if="!multiCity" :x="n.x" :y="n.y + n.r + 22" text-anchor="middle" class="kg-sun-name">{{ trunc(n.name, 22) }}</text>
              <text :x="n.x" :y="n.y + n.r + (multiCity ? 18 : 38)" text-anchor="middle" class="kg-sun-sub">{{ sunSub }}</text>
            </template>

            <!-- 多城行星：星名放在外侧，避开太阳下方的读数 -->
            <template v-else-if="n.kind === 'city'">
              <ellipse :cx="n.x" :cy="n.y" :rx="n.r * 1.9" :ry="n.r * 0.6" fill="none" stroke="rgba(176,134,55,.7)" stroke-width="1.2" />
              <circle :cx="n.x" :cy="n.y" :r="n.r" :fill="n.color" stroke="rgba(255,255,255,.8)" stroke-width="1.4" class="kg-core" />
              <text :x="n.x + (n.x >= CX ? 1 : -1) * (n.r * 1.9 + 5)" :y="n.y + 4" :text-anchor="n.x >= CX ? 'start' : 'end'"
                class="kg-label kg-label-serif">{{ trunc(n.name, 8) }}</text>
            </template>

            <!-- 日程枢纽：宫主星 -->
            <template v-else-if="n.kind === 'day'">
              <circle :cx="n.x" :cy="n.y" :r="n.r * 2.6" :fill="`url(#kgGlow${n.tone})`" class="kg-glow" />
              <circle :cx="n.x" :cy="n.y" :r="n.r" :fill="KIND_COLORS.day" :stroke="n.color" stroke-width="2.2" class="kg-core" />
              <text :x="n.x" :y="n.y + 4" text-anchor="middle" class="kg-hub-numeral">{{ n.designation }}</text>
            </template>

            <!-- 景点 -->
            <template v-else-if="n.kind === 'attraction'">
              <circle :cx="n.x" :cy="n.y" :r="n.r * 3.2" :fill="`url(#kgGlow${n.tone})`" class="kg-glow" />
              <circle :cx="n.x" :cy="n.y" :r="n.r" :fill="n.color" stroke="rgba(255,255,255,.75)" stroke-width="1.3" class="kg-core" />
              <text :x="n.x" :y="n.y + n.r + 14" text-anchor="middle" class="kg-label">
                <tspan :fill="n.color" class="kg-greek">{{ n.designation.split(' ')[0] }}</tspan>
                <tspan v-if="showName(n)" dx="3" class="kg-label-serif">{{ n.id === activeId ? trunc(n.name, 18) : trunc(n.name, 7) }}</tspan>
              </text>
            </template>

            <!-- 酒店：菱形 -->
            <template v-else-if="n.kind === 'hotel'">
              <path :d="diamond(n.x, n.y, n.r)" :fill="n.color" stroke="rgba(255,255,255,.85)" stroke-width="1.2" class="kg-core" />
              <text v-if="showName(n)" :x="n.x" :y="n.y + n.r + 13" text-anchor="middle" class="kg-label kg-label-serif">{{ trunc(n.name, 12) }}</text>
            </template>

            <!-- 餐饮：空心小环 -->
            <template v-else>
              <circle :cx="n.x" :cy="n.y" r="9" fill="transparent" />
              <circle :cx="n.x" :cy="n.y" :r="n.r" fill="#FBF7EE" :stroke="n.color" stroke-width="2" class="kg-core" />
              <text v-if="showName(n)" :x="n.x" :y="n.y + n.r + 13" text-anchor="middle" class="kg-label kg-label-serif">{{ trunc(n.name, 10) }}</text>
            </template>
          </g>
        </g>
      </g>
    </svg>
    <div v-else class="kg-empty">{{ t('result.graph.empty') }}</div>

    <!-- chrome -->
    <div class="kg-chrome">
      <div class="kg-eyebrow">RELATION ASTROLABE · {{ t('result.graph.title') }}</div>
      <div v-if="hasData" class="kg-plateno">{{ t('result.graph.plate', { stars: starCount, houses: graph.houses.length, links: graph.links.length }) }}</div>
    </div>

    <div v-if="hasData" class="kg-legend">
      <button v-for="k in TOGGLE_KINDS" :key="k" type="button" class="kg-chip" :class="{ off: hiddenKinds.includes(k) }"
        :aria-pressed="!hiddenKinds.includes(k)" @click="toggleKind(k)">
        <svg viewBox="-8 -8 16 16" class="kg-chip-glyph" aria-hidden="true">
          <circle v-if="k === 'day'" r="5.5" :fill="KIND_COLORS.day" stroke="#2FB4C9" stroke-width="1.6" />
          <circle v-else-if="k === 'attraction'" r="4.5" fill="#D96FA0" />
          <path v-else-if="k === 'hotel'" :d="diamond(0, 0, 5.5)" :fill="KIND_COLORS.hotel" />
          <circle v-else r="3.6" fill="#FBF7EE" :stroke="KIND_COLORS.meal" stroke-width="1.8" />
        </svg>
        {{ kindLabel(k) }}
      </button>
    </div>

    <div v-if="hasData && graph.ledger.length" class="kg-readout">
      <template v-if="hoveredLedger">
        <i :style="{ background: hoveredLedger.color }"></i>
        {{ t(`result.graph.ledger.${hoveredLedger.key}`) }} · {{ money(hoveredLedger.amount) }} · {{ Math.round(hoveredLedger.share * 100) }}%
      </template>
      <template v-else>
        <i class="ring"></i>{{ t('result.graph.ledger.title') }} · {{ money(graph.ledgerTotal) }}
      </template>
    </div>

    <div v-if="hasData" class="kg-controls">
      <button v-if="graph.voyage.length" type="button" class="kg-btn" :class="{ on: !!replay }" @click="replay ? stopReplay() : startReplay()">
        <span class="kg-btn-icon">{{ replay ? '■' : '▶' }}</span>{{ replay ? t('result.graph.stop') : t('result.graph.replay') }}
      </button>
      <button v-if="focusHouse >= 0 || selected || replay" type="button" class="kg-btn" @click="reset">
        {{ t('result.graph.reset') }}
      </button>
    </div>
    <div v-if="hasData && !selected && focusHouse < 0 && !replay" class="kg-hint"><span><i></i>{{ t('result.graph.hint') }}</span></div>

    <!-- 星表卡 -->
    <aside class="kg-card" :class="{ show: !!selectedNode }" :aria-hidden="!selectedNode">
      <template v-if="selectedNode">
        <div class="sc-head">
          <span class="k">STAR CATALOGUE · {{ selectedNode.designation }}</span>
          <button type="button" class="sc-close" :aria-label="t('result.graph.reset')" @click="selected = ''">×</button>
        </div>
        <div v-if="cardImage" class="sc-photo">
          <img :src="cardImage" :alt="selectedNode.name" @error="imgFailed = true" />
        </div>
        <div v-else class="sc-band" :style="{ '--tone': selectedNode.color }">
          <span class="sc-band-glyph">{{ KIND_GLYPH[selectedNode.kind] }}</span>
        </div>
        <div class="sc-body">
          <div class="sc-kind"><span class="dot" :style="{ background: selectedNode.color }"></span>{{ kindLabel(selectedNode.kind) }}</div>
          <h3>{{ selectedNode.name }}</h3>
          <p v-if="cardNote" class="sc-note">{{ cardNote }}</p>
          <dl v-if="cardRows.length" class="sc-rows">
            <template v-for="row in cardRows" :key="row.key">
              <dt>{{ row.k }}</dt><dd>{{ row.v }}</dd>
            </template>
          </dl>
          <div v-if="relations.length" class="sc-rel">
            <div class="sc-rel-title">{{ t('result.graph.relations') }}</div>
            <button v-for="r in relations" :key="r.id" type="button" class="sc-rel-chip" @click="pick(r)">
              <span class="dot" :style="{ background: r.color }"></span>{{ trunc(r.name, 10) }}
            </button>
          </div>
          <div v-if="selectedNode.house >= 0" class="sc-foot">
            <button type="button" class="sc-go" @click="emit('select-day', selectedNode.house)">{{ t('result.graph.goDay') }}</button>
          </div>
        </div>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRef, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripPlan, WeatherInfo } from '@/types'
import {
  useTripGraph, VW, VH, CX, CY, HOUSE_TONES, KIND_COLORS, SUN_ID,
  type StarNode, type StarKind, type StarLink, type LedgerKey, type Pt,
} from '@/composables/useTripGraph'

const props = defineProps<{
  plan: TripPlan | null
  getImage?: (name: string) => string
}>()
const emit = defineEmits<{ (e: 'select-day', dayArrayIndex: number): void }>()

const { t } = useI18n()
const { graph } = useTripGraph(toRef(props, 'plan'))

const TOGGLE_KINDS: StarKind[] = ['day', 'attraction', 'hotel', 'meal']
const KIND_GLYPH: Record<StarKind, string> = { city: '☉', day: '✦', attraction: '✧', hotel: '◆', meal: '◎' }

const hovered = ref('')
const selected = ref('')
const focusHouse = ref(-1)
const hiddenKinds = ref<StarKind[]>([])
const ledgerHover = ref<LedgerKey | ''>('')
const imgFailed = ref(false)

const hasData = computed(() => graph.value.nodes.length > 0)
const multiCity = computed(() => (props.plan?.cities?.length || 0) > 1)
const starCount = computed(() => graph.value.nodes.filter((n) => n.id !== SUN_ID).length)

const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s)
const money = (n?: number) => (n ? `¥${Number(n).toLocaleString()}` : '')
const shortDate = (d: string) => (d || '').slice(5).replace('-', '/')
const kindLabel = (k: StarKind) => t(`result.graph.categories.${k === 'day' ? 'schedule' : k}`)

// 四芒星芒 / 菱形
const sparkle = (cx: number, cy: number, r: number) => {
  const s = r * 0.3
  return `M ${cx} ${cy - r} L ${cx + s} ${cy - s} L ${cx + r} ${cy} L ${cx + s} ${cy + s} L ${cx} ${cy + r} L ${cx - s} ${cy + s} L ${cx - r} ${cy} L ${cx - s} ${cy - s} Z`
}
const diamond = (cx: number, cy: number, r: number) => `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`

// U+FE0E：强制文字字形，避免被渲染成彩色 emoji
function weatherGlyph(w?: WeatherInfo) {
  const s = w?.day_weather || ''
  const g = /雪|snow/i.test(s) ? '❄' : /雨|rain|shower/i.test(s) ? '☂' : /云|雲|阴|曇|cloud|overcast/i.test(s) ? '☁' : /晴|sun|clear/i.test(s) ? '☀' : '✦'
  return `${g}︎`
}

// 固定背景微星（避开太阳）
const bgStars = (() => {
  let seed = 20260924
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const arr: { x: number; y: number; r: number; o: number }[] = []
  for (let i = 0; i < 80; i++) {
    const x = rnd() * VW, y = rnd() * VH
    if (Math.hypot(x - CX, y - CY) < 120) continue
    arr.push({ x: +x.toFixed(1), y: +y.toFixed(1), r: +(rnd() * 1 + 0.4).toFixed(1), o: +(rnd() * 0.18 + 0.06).toFixed(2) })
  }
  return arr
})()

// ===== 可见性 / 邻接 =====
const nodeById = computed(() => Object.fromEntries(graph.value.nodes.map((n) => [n.id, n])) as Record<string, StarNode>)
const visibleNodes = computed(() => graph.value.nodes.filter((n) => !hiddenKinds.value.includes(n.kind)))
const visibleLinks = computed(() => {
  const ids = new Set(visibleNodes.value.map((n) => n.id))
  return graph.value.links.filter((l) => ids.has(l.s) && ids.has(l.t))
})
const adjacency = computed(() => {
  const adj: Record<string, Set<string>> = {}
  graph.value.links.forEach((l) => {
    ;(adj[l.s] ||= new Set()).add(l.t)
    ;(adj[l.t] ||= new Set()).add(l.s)
  })
  return adj
})

const activeId = computed(() => hovered.value || selected.value)
const isLit = (id: string) => !activeId.value || id === activeId.value || !!adjacency.value[activeId.value]?.has(id)
const isHouseDimmed = (house: number) => focusHouse.value >= 0 && house >= 0 && house !== focusHouse.value

function nodeClass(n: StarNode) {
  if (replay.value) {
    const lit = litIds.value.has(n.id)
    return { lit, dim: n.kind === 'attraction' ? !lit : n.id !== SUN_ID }
  }
  return {
    on: n.id === activeId.value,
    sel: n.id === selected.value,
    dim: (!!activeId.value && !isLit(n.id)) || isHouseDimmed(n.house),
  }
}
function linkClass(l: StarLink) {
  if (replay.value) return { dim: true }
  const on = !!activeId.value && (l.s === activeId.value || l.t === activeId.value)
  const s = nodeById.value[l.s], e = nodeById.value[l.t]
  return { on, dim: (!!activeId.value && !on) || (isHouseDimmed(s?.house ?? -1) && isHouseDimmed(e?.house ?? -1)) }
}
function showName(n: StarNode) {
  if (n.id === activeId.value || focusHouse.value === n.house) return true
  return n.kind === 'attraction' && !n.dense
}

// ===== 交互：选中 / 聚焦宫位 / 筛选 =====
function pick(n: StarNode) {
  stopReplay()
  imgFailed.value = false
  selected.value = selected.value === n.id ? '' : n.id
  if (n.kind === 'day' && selected.value) focusHouse.value = n.house
}
function focusOn(house: number) {
  stopReplay()
  selected.value = ''
  hovered.value = ''
  focusHouse.value = focusHouse.value === house ? -1 : house
}
function reset() {
  stopReplay()
  selected.value = ''
  hovered.value = ''
  focusHouse.value = -1
}
function toggleKind(k: StarKind) {
  hiddenKinds.value = hiddenKinds.value.includes(k) ? hiddenKinds.value.filter((x) => x !== k) : [...hiddenKinds.value, k]
  if (selected.value && nodeById.value[selected.value]?.kind === k) selected.value = ''
}

// 聚焦：整层平移缩放，宫位移到盘心
const stageStyle = computed(() => {
  const h = graph.value.houses[focusHouse.value]
  if (!h || graph.value.houses.length < 2) return { transform: 'translate(0px, 0px) scale(1)' }
  const s = graph.value.houses.length > 4 ? 1.7 : 1.4
  return { transform: `translate(${CX - s * h.focus.x}px, ${CY - s * h.focus.y}px) scale(${s})` }
})

// ===== 航线回放：彗星沿景点顺序飞行，逐颗点亮 =====
const replay = ref<{ seg: number; u: number } | null>(null)
let raf = 0

const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
const trail = computed(() => {
  const segs = graph.value.voyage
  const r = replay.value
  if (!r || !segs.length) return { d: '', end: { x: CX, y: CY } }
  let d = `M ${segs[0].from.x} ${segs[0].from.y}`
  let end: Pt = segs[0].from
  for (let i = 0; i <= r.seg; i++) {
    const g = segs[i], u = i < r.seg ? 1 : r.u
    if (g.ctrl) {
      const p01 = lerp(g.from, g.ctrl, u), pu = lerp(p01, lerp(g.ctrl, g.to, u), u)
      d += ` Q ${p01.x.toFixed(1)} ${p01.y.toFixed(1)} ${pu.x.toFixed(1)} ${pu.y.toFixed(1)}`
      end = pu
    } else {
      end = lerp(g.from, g.to, u)
      d += ` L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
    }
  }
  return { d, end }
})
const litIds = computed(() => {
  const r = replay.value
  const out = new Set<string>()
  if (!r) return out
  out.add(graph.value.voyageStartId)
  graph.value.voyage.forEach((g, i) => { if (i < r.seg || (i === r.seg && r.u >= 1)) out.add(g.toId) })
  return out
})

function startReplay() {
  const segs = graph.value.voyage
  if (!segs.length) return
  stopReplay()
  selected.value = ''
  hovered.value = ''
  focusHouse.value = -1
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    replay.value = { seg: segs.length - 1, u: 1 }
    return
  }
  const total = segs.reduce((s, g) => s + g.len, 0)
  const duration = Math.min(14000, Math.max(4500, total * 6))
  const t0 = performance.now()
  const tick = (now: number) => {
    let d = Math.min(1, (now - t0) / duration) * total
    let i = 0
    while (i < segs.length - 1 && d > segs[i].len) { d -= segs[i].len; i++ }
    replay.value = { seg: i, u: segs[i].len ? Math.min(1, d / segs[i].len) : 1 }
    raf = now - t0 < duration ? requestAnimationFrame(tick) : 0
  }
  raf = requestAnimationFrame(tick)
}
function stopReplay() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  replay.value = null
}

// 行程被编辑后：清掉已失效的状态
watch(graph, (g) => {
  stopReplay()
  if (selected.value && !g.nodes.some((n) => n.id === selected.value)) selected.value = ''
  if (focusHouse.value >= g.houses.length) focusHouse.value = -1
})

// Esc 复位（宫位扇区不可聚焦，所以挂在 window 上，只在有状态时响应）
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && (selected.value || focusHouse.value >= 0 || replay.value)) reset()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  stopReplay()
})

// ===== 预算读数 / 太阳副标 =====
const hoveredLedger = computed(() => graph.value.ledger.find((a) => a.key === ledgerHover.value) || null)
const sunSub = computed(() => {
  const p = props.plan
  if (!p) return ''
  return graph.value.ledgerTotal ? `${money(graph.value.ledgerTotal)} · ${p.days.length}D` : `${p.start_date} ~ ${p.end_date}`
})

// ===== 星表卡 =====
const selectedNode = computed(() => (selected.value ? nodeById.value[selected.value] || null : null))
const cardImage = computed(() => {
  const n = selectedNode.value
  if (imgFailed.value || n?.kind !== 'attraction' || !props.getImage) return ''
  return props.getImage(n.name) || ''
})
const cardNote = computed(() => {
  const n = selectedNode.value
  if (!n) return ''
  if (n.id === SUN_ID) return props.plan?.overall_suggestions || ''
  if (n.kind === 'day') return n.day?.is_transfer_day && n.day.transfer_info ? n.day.transfer_info : n.day?.description || ''
  return n.attraction?.description || n.meal?.description || ''
})
const cardRows = computed(() => {
  const n = selectedNode.value
  const p = props.plan
  if (!n || !p) return []
  const rows: { key: string; k: string; v: string }[] = []
  const push = (key: string, v: unknown) => { if (v !== undefined && v !== null && v !== '' && v !== 0) rows.push({ key, k: t(`result.graph.fields.${key}`), v: String(v) }) }
  if (n.id === SUN_ID) {
    push('dates', `${p.start_date} ~ ${p.end_date}`)
    push('days', p.days.length)
    if (multiCity.value) push('route', (p.cities || []).join(' → '))
    push('budget', money(p.budget?.total))
  } else if (n.kind === 'city') {
    push('days', p.days.filter((d) => (d.city || p.city) === n.city).length)
  } else if (n.kind === 'day' && n.day) {
    const w = graph.value.houses[n.house]?.weather
    push('date', n.day.date)
    push('city', n.day.city)
    if (w) {
      push('weather', `${w.day_weather} ${w.day_temp}° / ${w.night_weather} ${w.night_temp}°`)
      push('wind', `${w.wind_direction} ${w.wind_power}`.trim())
    }
    push('transport', n.day.transportation)
    push('stay', n.day.hotel?.name || n.day.accommodation)
  } else if (n.attraction) {
    push('address', n.attraction.address)
    push('duration', n.attraction.visit_duration ? t('result.graph.minutes', { n: n.attraction.visit_duration }) : '')
    push('ticket', money(n.attraction.ticket_price))
    push('rating', n.attraction.rating)
  } else if (n.hotel) {
    push('address', n.hotel.address)
    push('priceRange', n.hotel.price_range)
    push('cost', n.hotel.estimated_cost ? t('result.graph.perNight', { n: money(n.hotel.estimated_cost) }) : '')
    push('rating', n.hotel.rating)
    push('distance', n.hotel.distance)
  } else if (n.meal) {
    push('mealType', t(`result.meals.${n.meal.type}`))
    push('address', n.meal.address)
    push('cost', money(n.meal.estimated_cost))
  }
  return rows
})
const KIND_ORDER: StarKind[] = ['city', 'day', 'attraction', 'hotel', 'meal']
const relations = computed(() => {
  const adj = adjacency.value[selected.value]
  if (!adj) return []
  return Array.from(adj)
    .map((id) => nodeById.value[id])
    .filter((n): n is StarNode => !!n && !hiddenKinds.value.includes(n.kind))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .slice(0, 12)
})
</script>

<style scoped>
.kg {
  --fn-card: #FBF7EE;
  position: relative; width: 100%; aspect-ratio: 10 / 7; min-height: 560px; max-height: 760px; border-radius: 4px; overflow: hidden;
  background:
    radial-gradient(70% 60% at 50% 48%, rgba(255, 251, 242, 0.65), transparent 62%),
    radial-gradient(120% 90% at 50% -8%, rgba(192, 86, 42, 0.08), transparent 55%),
    radial-gradient(150% 120% at 50% 118%, rgba(31, 84, 96, 0.1), transparent 60%),
    radial-gradient(120% 120% at 50% 46%, #F3ECDA 0%, #ECE1C8 55%, #E2D5B6 84%, #D9CBA9 100%);
}
.kg::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: radial-gradient(circle, rgba(36, 29, 24, 0.04) 1px, transparent 1px);
  background-size: 24px 24px; opacity: 0.4;
}
.kg-nebula {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(30% 36% at 50% 50%, rgba(224, 164, 90, 0.16), transparent 70%);
}
@media (max-width: 640px) { .kg { aspect-ratio: auto; min-height: 480px; } }

.kg-dial { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; transform-origin: center; will-change: transform; animation: kg-spin 140s linear infinite; }
@keyframes kg-spin { to { transform: rotate(360deg); } }

.kg-svg { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; display: block; }
.kg-stage { transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1); }
.kg-deco { pointer-events: none; }

/* 宫位 */
.kg-wedge { fill: var(--tone); fill-opacity: 0; cursor: zoom-in; transition: fill-opacity 0.3s; }
.kg-wedge:hover { fill-opacity: 0.045; }
.kg-wedge.on { fill-opacity: 0.07; cursor: zoom-out; }
.kg-spoke { stroke: rgba(36, 29, 24, 0.12); stroke-dasharray: 2 6; pointer-events: none; }
.kg-house-labels { pointer-events: none; }
.kg-house-label { transition: opacity 0.3s; }
.kg-house-label.dim { opacity: 0.3; }
.kg-numeral { font-family: var(--serif, 'Newsreader', Georgia, serif); font-size: 15px; font-weight: 600; font-style: italic; }
.kg-house-date { font-family: var(--mono, 'IBM Plex Mono', monospace); font-size: 10px; fill: var(--ink-soft, #6B5C4C); letter-spacing: 0.06em; }

/* 预算星环 */
.kg-ledger-track { fill: none; stroke: rgba(36, 29, 24, 0.07); stroke-width: 7; pointer-events: none; }
.kg-ledger-arc { fill: none; stroke-width: 5; stroke-linecap: round; cursor: help; opacity: 0.78; transition: stroke-width 0.2s, opacity 0.2s; }
.kg-ledger-arc.on { stroke-width: 9; opacity: 1; }
.kg-ledger-arc.dim { opacity: 0.3; }

/* 连线 */
.kg-links { pointer-events: none; }
.kg-link { fill: none; stroke: rgba(36, 29, 24, 0.18); stroke-width: 1; transition: stroke 0.25s, opacity 0.25s, stroke-width 0.25s; }
.kg-link.l-orbit { stroke: rgba(31, 84, 96, 0.28); stroke-width: 1.2; }
.kg-link.l-next { stroke: rgba(176, 134, 55, 0.7); stroke-width: 1.4; }
.kg-link.l-voyage { stroke: rgba(192, 86, 42, 0.42); stroke-width: 1.2; stroke-dasharray: 4 5; }
.kg-link.l-stay, .kg-link.l-dine { stroke-dasharray: 1 3; }
.kg-link.dim { opacity: 0.08; }
.kg-link.on { stroke: var(--brass, #D9A441); stroke-width: 1.9; opacity: 1; stroke-dasharray: none; }

/* 彗星 */
.kg-comet { pointer-events: none; }
.kg-trail { fill: none; stroke: #C0562A; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }

/* 天气 */
.kg-wx { font-family: var(--mono, monospace); font-size: 10px; fill: var(--ink-soft, #6B5C4C); pointer-events: none; transition: opacity 0.3s; }
.kg-wx-glyph { font-size: 12px; fill: var(--rust, #C0562A); }
.kg-wx.dim, .replaying .kg-wx { opacity: 0.25; }

/* 星辰 */
.kg-node { cursor: pointer; outline: none; transition: opacity 0.25s; }
.kg-node.dim { opacity: 0.2; }
.kg-node:focus-visible .kg-core { stroke: var(--rust, #C0562A); stroke-width: 2.5; }
.kg-glow, .kg-core, .kg-spark { transform-box: fill-box; transform-origin: center; }
.kg-glow { transition: opacity 0.25s, transform 0.25s; }
.kg-core { transition: transform 0.2s; }
.kg-sun-glow { animation: kg-breathe 4s ease-in-out infinite; }
@keyframes kg-breathe { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.82; } }
.kg-node.on .kg-glow, .kg-node.sel .kg-glow { transform: scale(1.35); }
.kg-node.on .kg-core, .kg-node.sel .kg-core { transform: scale(1.22); }
.kg-node.lit .kg-glow { animation: kg-flare 0.9s ease-out; }
@keyframes kg-flare { 0% { transform: scale(2.2); opacity: 0.2; } 100% { transform: scale(1); opacity: 1; } }

.kg-label { pointer-events: none; font-size: 12px; }
.kg-label-serif { font-family: var(--serif, 'Newsreader', Georgia, serif); font-weight: 500; fill: var(--ink, #241D18); font-size: 12px; }
.kg-greek { font-family: var(--mono, monospace); font-size: 10.5px; font-weight: 600; }
.kg-hub-numeral { font-family: var(--serif, 'Newsreader', Georgia, serif); font-style: italic; font-weight: 600; font-size: 12px; fill: #F4EEE1; pointer-events: none; }
.kg-sun-name { font-family: var(--serif, 'Newsreader', Georgia, serif); font-weight: 700; font-size: 17px; fill: var(--ink, #241D18); pointer-events: none; }
.kg-sun-sub { font-family: var(--mono, monospace); font-size: 10.5px; fill: var(--rust-deep, #95401A); letter-spacing: 0.06em; pointer-events: none; }

.kg-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-soft, #6B5C4C); font-size: 13px; z-index: 3; }

/* chrome */
.kg-chrome { position: absolute; top: 16px; left: 18px; right: 18px; z-index: 4; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; }
.kg-eyebrow { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: 0.18em; color: var(--rust, #C0562A); text-transform: uppercase; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.kg-eyebrow::before { content: ''; width: 22px; height: 1px; background: var(--rust, #C0562A); }
.kg-plateno { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: 0.12em; color: var(--ink-faint, #A7967D); text-transform: uppercase; white-space: nowrap; }

.kg-legend { position: absolute; top: 40px; left: 18px; z-index: 4; display: flex; flex-wrap: wrap; gap: 6px; max-width: 60%; }
.kg-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px 3px 6px; cursor: pointer;
  font-family: var(--mono, monospace); font-size: 10.5px; color: var(--ink-soft, #6B5C4C);
  background: rgba(251, 247, 238, 0.7); border: 1px solid rgba(36, 29, 24, 0.14); border-radius: 2px;
  transition: opacity 0.2s, border-color 0.2s;
}
.kg-chip:hover { border-color: var(--rust, #C0562A); }
.kg-chip.off { opacity: 0.4; text-decoration: line-through; }
.kg-chip-glyph { width: 12px; height: 12px; }

.kg-readout { position: absolute; left: 18px; bottom: 16px; z-index: 4; font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: 0.06em; color: var(--ink-soft, #6B5C4C); display: flex; align-items: center; gap: 7px; pointer-events: none; }
.kg-readout i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.kg-readout i.ring { border: 2px solid var(--brass, #D9A441); width: 7px; height: 7px; }

.kg-controls { position: absolute; right: 18px; bottom: 14px; z-index: 4; display: flex; gap: 8px; }
.kg-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer;
  font-family: var(--mono, monospace); font-size: 11px; letter-spacing: 0.06em;
  color: var(--ink, #241D18); background: var(--fn-card); border: 1px solid rgba(36, 29, 24, 0.18); border-radius: 2px;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.kg-btn:hover { border-color: var(--rust, #C0562A); color: var(--rust, #C0562A); }
.kg-btn.on { background: var(--rust, #C0562A); color: #F4EEE1; border-color: var(--rust, #C0562A); }
.kg-btn-icon { font-size: 9px; }

.kg-hint { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 4; font-family: var(--mono, monospace); font-size: 10px; letter-spacing: 0.08em; color: var(--ink-faint, #A7967D); pointer-events: none; white-space: nowrap; }
.kg-hint span { display: flex; gap: 8px; align-items: center; }
.kg-hint i { width: 5px; height: 5px; border-radius: 50%; background: var(--rust, #C0562A); display: inline-block; }
@media (max-width: 900px) { .kg-hint { display: none; } }

/* 星表卡（与概览星盘「田野笔记」同一套卡片语言） */
.kg-card {
  position: absolute; right: 18px; top: 64px; max-height: calc(100% - 122px); transform: translateX(24px);
  width: min(300px, 84%); display: flex; flex-direction: column;
  background: var(--fn-card); color: var(--ink, #241D18);
  border: 1px solid rgba(36, 29, 24, 0.14); box-shadow: 12px 16px 0 -6px rgba(36, 29, 24, 0.06), 0 30px 60px -34px rgba(36, 29, 24, 0.5);
  opacity: 0; pointer-events: none; z-index: 6; transition: opacity 0.38s cubic-bezier(0.22, 1, 0.36, 1), transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}
.kg-card.show { opacity: 1; transform: translateX(0); pointer-events: auto; }
@media (max-width: 640px) {
  .kg-card { right: 12px; left: 12px; top: auto; bottom: 52px; max-height: 64%; width: auto; transform: translateY(16px); }
  .kg-card.show { transform: translateY(0); }
}
.sc-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid rgba(36, 29, 24, 0.09); flex: none; }
.sc-head .k { font-family: var(--mono, monospace); font-size: 10px; letter-spacing: 0.16em; color: var(--rust, #C0562A); }
.sc-close { width: 22px; height: 22px; border: 1px solid rgba(36, 29, 24, 0.16); background: none; color: var(--ink-soft, #6B5C4C); cursor: pointer; font-size: 13px; line-height: 1; display: grid; place-items: center; }
.sc-close:hover { border-color: var(--rust, #C0562A); color: var(--rust, #C0562A); }
.sc-photo { height: 118px; overflow: hidden; background: linear-gradient(160deg, #1f4450, #14232a); flex: none; }
.sc-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sc-band {
  height: 54px; flex: none; display: flex; align-items: center; justify-content: flex-end; padding: 0 18px;
  background:
    radial-gradient(60% 140% at 85% 50%, color-mix(in srgb, var(--tone) 45%, transparent), transparent 70%),
    linear-gradient(160deg, #1f4450, #14232a);
}
.sc-band-glyph { font-size: 22px; color: #EBCB85; text-shadow: 0 0 14px var(--tone); }
.sc-body { padding: 14px 18px 16px; overflow-y: auto; flex: 1; }
.sc-kind { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--ink-faint, #A7967D); letter-spacing: 0.1em; display: flex; align-items: center; gap: 6px; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; }
.sc-body h3 { font-family: var(--serif, 'Newsreader', Georgia, serif); font-weight: 600; font-size: 1.35rem; margin: 6px 0 6px; line-height: 1.2; color: var(--ink, #241D18); }
.sc-note { font-size: 12.5px; line-height: 1.62; color: var(--ink-soft, #6B5C4C); margin: 0 0 10px; white-space: pre-line; }
.sc-rows { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; padding-top: 10px; border-top: 1px dashed rgba(36, 29, 24, 0.12); }
.sc-rows dt { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--ink-faint, #A7967D); letter-spacing: 0.06em; padding-top: 1px; }
.sc-rows dd { margin: 0; font-size: 12.5px; color: var(--ink, #241D18); line-height: 1.45; word-break: break-word; }
.sc-rel { margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(36, 29, 24, 0.12); display: flex; flex-wrap: wrap; gap: 5px; }
.sc-rel-title { width: 100%; font-family: var(--mono, monospace); font-size: 10px; letter-spacing: 0.14em; color: var(--rust, #C0562A); margin-bottom: 2px; }
.sc-rel-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--ink-soft, #6B5C4C); background: none; border: 1px solid rgba(36, 29, 24, 0.14); padding: 3px 8px; cursor: pointer; border-radius: 2px; font-family: inherit; }
.sc-rel-chip:hover { border-color: var(--rust, #C0562A); color: var(--rust, #C0562A); }
.sc-foot { margin-top: 14px; display: flex; justify-content: flex-end; }
.sc-go { background: var(--rust, #C0562A); color: #F4EEE1; border: none; padding: 7px 13px; font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer; border-radius: 2px; transition: background 0.2s; }
.sc-go:hover { background: var(--rust-deep, #95401A); }

@media (prefers-reduced-motion: reduce) {
  .kg-dial, .kg-sun-glow, .kg-node.lit .kg-glow { animation: none; }
  .kg-stage { transition: none; }
}
</style>
