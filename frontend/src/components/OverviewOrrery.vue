<template>
  <div ref="rootRef" class="orrery">
    <div class="orrery-nebula"></div>

    <svg class="orrery-chart" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet">
      <!-- ===== 底盘：天球分度盘（静态墨线）===== -->
      <g class="dial" fill="none" stroke="rgba(36,29,24,.16)">
        <circle :cx="CX" :cy="CY" r="248" />
        <circle :cx="CX" :cy="CY" r="222" stroke="rgba(36,29,24,.1)" />
        <circle :cx="CX" :cy="CY" r="130" stroke="rgba(36,29,24,.09)" />
        <line v-for="s in 12" :key="`spoke-${s}`"
          :x1="CX" :y1="CY"
          :x2="CX + Math.cos((s-1)*30*Math.PI/180)*224"
          :y2="CY + Math.sin((s-1)*30*Math.PI/180)*224"
          stroke="rgba(36,29,24,.05)" />
        <line v-for="t in 72" :key="`tick-${t}`"
          :x1="CX + Math.cos((t-1)*5*Math.PI/180)*248"
          :y1="CY + Math.sin((t-1)*5*Math.PI/180)*248"
          :x2="CX + Math.cos((t-1)*5*Math.PI/180)*(248 - ((t-1)%6===0?12:5))"
          :y2="CY + Math.sin((t-1)*5*Math.PI/180)*(248 - ((t-1)%6===0?12:5))"
          :stroke="(t-1)%6===0 ? 'rgba(36,29,24,.3)' : 'rgba(36,29,24,.15)'" />
      </g>
      <g class="dial-labels" fill="var(--ink-faint,#A7967D)" font-family="var(--mono,monospace)" font-size="10" text-anchor="middle">
        <text v-for="d in 12" :key="`deg-${d}`"
          :x="CX + Math.cos((d-1)*30*Math.PI/180)*226"
          :y="CY + Math.sin((d-1)*30*Math.PI/180)*226 + 3">{{ (d-1)*30 }}°</text>
      </g>
      <g class="compass" fill="var(--rust,#C0562A)" font-family="var(--serif,serif)" font-size="15" text-anchor="middle" opacity=".7">
        <text :x="CX" :y="CY-262">N</text>
        <text :x="CX+270" :y="CY+5">E</text>
        <text :x="CX" :y="CY+272">S</text>
        <text :x="CX-270" :y="CY+5">W</text>
      </g>

      <!-- 背景参考星 -->
      <g fill="rgba(36,29,24,.22)">
        <circle v-for="(bs,i) in bgStars" :key="`bg-${i}`" :cx="bs.x" :cy="bs.y" :r="bs.r" />
      </g>

      <!-- ===== 炫彩层（CSS 流光变色）===== -->
      <g class="jewel">
        <!-- 旋转的宝石环 -->
        <g class="ring-spin">
          <ellipse :cx="CX" :cy="CY" rx="238" ry="96" fill="none" :stroke="AURORA[0]" stroke-width="3" opacity=".8" />
          <ellipse :cx="CX" :cy="CY" rx="150" ry="234" fill="none" :stroke="AURORA[1]" stroke-width="3" opacity=".75" transform="rotate(24 400 270)" />
          <ellipse :cx="CX" :cy="CY" rx="210" ry="150" fill="none" :stroke="AURORA[2]" stroke-width="2.5" opacity=".7" transform="rotate(-18 400 270)" />
        </g>

        <!-- 公转行星 -->
        <g class="orbit orbit-1"><circle :cx="CX+96" :cy="CY" r="6" :fill="AURORA[2]" class="planet" /></g>
        <g class="orbit orbit-2"><circle :cx="CX+156" :cy="CY" r="7.5" :fill="AURORA[0]" class="planet" /></g>
        <g class="orbit orbit-3"><circle :cx="CX+205" :cy="CY" r="5.5" :fill="AURORA[1]" class="planet" /></g>

        <!-- 中心日核 -->
        <circle :cx="CX" :cy="CY" r="26" class="sun-glow" :fill="AURORA[3]" />
        <circle :cx="CX" :cy="CY" r="11" class="sun" :fill="AURORA[3]" />

        <!-- 星座连线 -->
        <line v-for="(ln,i) in lines" :key="`ln-${i}`" :x1="ln[0].x" :y1="ln[0].y" :x2="ln[1].x" :y2="ln[1].y"
          stroke="rgba(36,29,24,.4)" stroke-width="1" />

        <!-- 景点星辰 -->
        <g v-for="s in stars" :key="`st-${s.i}`" class="star-node" :class="{ on: selected === s.i }"
          @click="select(s.i)" role="button" tabindex="0" @keydown.enter="select(s.i)">
          <circle :cx="s.x" :cy="s.y" r="20" class="star-halo" :fill="s.color" />
          <circle :cx="s.x" :cy="s.y" r="6.5" class="star-core" :fill="s.color" :style="{ animationDelay: (s.i * 0.4) + 's' }" />
          <text :x="s.x" :y="s.y + 34" text-anchor="middle" class="star-label"
            font-family="var(--mono,monospace)" font-size="12">
            <tspan :fill="s.color" font-weight="600">{{ s.cat }}</tspan> <tspan fill="var(--ink,#241D18)">{{ s.name }}</tspan>
          </text>
        </g>
      </g>
    </svg>

    <!-- chrome -->
    <div class="orrery-chrome">
      <div class="orrery-eyebrow">THE ORRERY · 星盘</div>
    </div>
    <div class="orrery-plateno">{{ attractions.length }} STARS PLOTTED</div>
    <div class="orrery-hint"><span><i></i>点铜点看田野笔记</span></div>

    <!-- 田野笔记卡 -->
    <div class="orrery-card" :class="{ show: selected >= 0 }">
      <template v-if="selected >= 0 && current">
        <div class="fn-head">
          <span class="k">FIELD NOTE</span>
          <button class="fn-close" @click="close">×</button>
        </div>
        <div class="fn-photo">
          <img v-if="currentImage" :src="currentImage" :alt="current.name" @error="onImgError" />
          <span v-else class="fn-photo-name">{{ current.name }}</span>
          <svg class="fn-wave" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0,0V16c13,21,28,41,48,56,52,39,117,39,177,20,31-10,60-26,90-40,41-19,84-46,130-49,36-3,71,9,99,31,32,25,62,62,103,73,40,11,81-7,119-24s75-39,117-43c60-6,113,23,169,39,30,9,59,6,87-8,22-11,48-27,61-49V0Z" fill="var(--fn-card,#FBF7EE)"/></svg>
        </div>
        <div class="fn-body">
          <div class="fn-idx"><span class="star">✦</span> STOP {{ String(selected + 1).padStart(2, '0') }}</div>
          <h3>{{ current.name }}</h3>
          <p>{{ current.description || current.address || '—' }}</p>
          <div class="fn-meta">
            <span v-if="current.visit_duration" class="chipm">{{ current.visit_duration }} 分钟</span>
            <button class="fn-go" @click="go(current.dayArrayIndex)">查看当日行程 →</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

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
const selected = ref(-1)
const imgFailed = ref(false)

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ']
const AURORA = ['#2FB4C9', '#7C6FE0', '#D96FA0', '#E0A24E', '#4FC58E', '#E0705A']
const CX = 400
const CY = 270

const stars = computed(() =>
  props.attractions.map((it, i) => {
    const n = Math.max(props.attractions.length, 1)
    const a = (-90 + i * (360 / n)) * Math.PI / 180
    const rad = 118 + (i % 3) * 30
    return {
      ...it, i,
      x: CX + Math.cos(a) * rad * 1.4,
      y: CY + Math.sin(a) * rad,
      color: AURORA[i % AURORA.length],
      cat: GREEK[i % GREEK.length],
    }
  })
)

const lines = computed(() => {
  const s = stars.value
  const out: { x: number; y: number }[][] = []
  for (let i = 0; i < s.length - 1; i++) out.push([{ x: s[i].x, y: s[i].y }, { x: s[i + 1].x, y: s[i + 1].y }])
  return out
})

// 固定的背景参考星（一次生成）
const bgStars = (() => {
  let seed = 20260924
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const arr: { x: number; y: number; r: number }[] = []
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 800, y = rnd() * 560
    if (Math.hypot(x - CX, y - CY) < 150) continue
    arr.push({ x: +x.toFixed(1), y: +y.toFixed(1), r: +(rnd() * 1 + 0.4).toFixed(1) })
  }
  return arr
})()

const current = computed(() => (selected.value >= 0 ? props.attractions[selected.value] : null))
const currentImage = computed(() => {
  if (imgFailed.value || !current.value || !props.getImage) return ''
  return props.getImage(current.value.name) || ''
})

function select(i: number) { imgFailed.value = false; selected.value = i }
function close() { selected.value = -1 }
function onImgError() { imgFailed.value = true }
function go(d: number) { emit('select-day', d) }
</script>

<style scoped>
.orrery {
  --fn-card: #FBF7EE;
  position: relative; width: 100%; height: 500px; overflow: hidden; border-radius: 4px;
  background:
    radial-gradient(120% 85% at 50% 44%, rgba(255, 251, 242, .6), transparent 62%),
    radial-gradient(90% 70% at 50% 46%, rgba(217, 164, 65, .1), transparent 60%),
    radial-gradient(120% 90% at 50% -8%, rgba(192, 86, 42, .1), transparent 55%),
    radial-gradient(150% 120% at 50% 118%, rgba(31, 84, 96, .12), transparent 60%),
    #EFE7D6;
}
@media (max-width: 640px) { .orrery { height: 420px; } }
.orrery::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 3;
  background:
    repeating-linear-gradient(to bottom, rgba(36,29,24,.045) 0, rgba(36,29,24,.045) 1px, transparent 2px, transparent 4px),
    radial-gradient(circle, rgba(36,29,24,.05) 1px, transparent 1px);
  background-size: 100% 4px, 22px 22px; opacity: .5; mix-blend-mode: multiply;
}
.orrery-nebula {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(34% 42% at 50% 48%, rgba(224, 164, 90, .18), transparent 70%);
  filter: blur(2px);
}
.orrery-chart { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }

/* 炫彩流光：整层缓慢色相流转 */
.jewel { animation: orr-hue 26s linear infinite; transform-origin: center; }
@keyframes orr-hue { to { filter: hue-rotate(360deg); } }

.ring-spin { transform-box: view-box; transform-origin: 400px 270px; animation: orr-spin 60s linear infinite; }
@keyframes orr-spin { to { transform: rotate(360deg); } }

.orbit { transform-box: view-box; transform-origin: 400px 270px; }
.orbit-1 { animation: orr-spin 14s linear infinite; }
.orbit-2 { animation: orr-spin 22s linear infinite reverse; }
.orbit-3 { animation: orr-spin 30s linear infinite; }
.planet { filter: drop-shadow(0 0 4px currentColor); }

.sun { animation: orr-sun 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.sun-glow { opacity: .4; animation: orr-sunglow 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes orr-sun { 0%,100% { opacity: 1; } 50% { opacity: .82; } }
@keyframes orr-sunglow { 0%,100% { transform: scale(1); opacity: .4; } 50% { transform: scale(1.25); opacity: .22; } }

.star-node { cursor: pointer; outline: none; }
.star-halo { opacity: .18; transform-box: fill-box; transform-origin: center; }
.star-core { transform-box: fill-box; transform-origin: center; animation: orr-star 2.6s ease-in-out infinite; filter: drop-shadow(0 0 3px currentColor); }
@keyframes orr-star { 0%,100% { transform: scale(1); } 50% { transform: scale(1.18); } }
.star-node:hover .star-halo, .star-node.on .star-halo { opacity: .34; transform: scale(1.25); }
.star-node:hover .star-core, .star-node.on .star-core { transform: scale(1.5); }
.star-label { pointer-events: none; opacity: .85; }
.star-node:hover .star-label, .star-node.on .star-label { opacity: 1; }

.orrery-chrome { position: absolute; top: 16px; left: 18px; z-index: 4; pointer-events: none; }
.orrery-eyebrow { font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .18em; color: var(--rust, #C0562A); text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.orrery-eyebrow::before { content: ''; width: 22px; height: 1px; background: var(--rust, #C0562A); }
.orrery-plateno { position: absolute; top: 16px; right: 18px; z-index: 4; font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .12em; color: var(--ink-faint, #A7967D); pointer-events: none; }
.orrery-hint { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); z-index: 4; font-family: var(--mono, monospace); font-size: 10px; letter-spacing: .08em; color: var(--ink-faint, #A7967D); pointer-events: none; display: flex; gap: 8px; align-items: center; }
.orrery-hint i { width: 5px; height: 5px; border-radius: 50%; background: var(--rust, #C0562A); display: inline-block; }

.orrery-card {
  position: absolute; right: 18px; top: 50%; transform: translateY(-50%) translateX(24px);
  width: min(300px, 84%); background: var(--fn-card); color: var(--ink, #241D18);
  border: 1px solid rgba(36, 29, 24, .14); box-shadow: 12px 16px 0 -6px rgba(36, 29, 24, .06), 0 30px 60px -34px rgba(36, 29, 24, .5);
  opacity: 0; pointer-events: none; z-index: 6; transition: opacity .38s cubic-bezier(.22,1,.36,1), transform .38s cubic-bezier(.22,1,.36,1);
}
.orrery-card.show { opacity: 1; transform: translateY(-50%) translateX(0); pointer-events: auto; }
@media (max-width: 640px) {
  .orrery-card { right: 12px; left: 12px; top: auto; bottom: 40px; width: auto; transform: translateY(16px); }
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

@media (prefers-reduced-motion: reduce) {
  .jewel, .ring-spin, .orbit, .sun, .sun-glow, .star-core { animation: none !important; }
}
</style>
