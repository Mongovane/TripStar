<template>
  <div
    id="travel-buddy"
    ref="rootRef"
    :class="{ walking: isWalking, sleeping, 'face-left': facing < 0, happy }"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @click.stop
  >
    <div class="tb-bubble" :class="{ show: bubbleShow }">{{ bubbleText }}</div>
    <div class="tb-zzz" v-if="sleeping">z<span>z</span><span>z</span></div>
    <div class="tb-flip">
      <svg viewBox="0 0 82 96" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="41" cy="90" rx="24" ry="5" fill="rgba(36,29,24,.16)" />
        <g class="tb-leg tb-leg-l" transform="translate(33,66)">
          <line x1="0" y1="0" x2="0" y2="18" stroke="#C0562A" stroke-width="3.4" stroke-linecap="round" />
          <path d="M-6 18 L0 14 L6 18 Z" fill="#C0562A" />
        </g>
        <g class="tb-leg tb-leg-r" transform="translate(49,66)">
          <line x1="0" y1="0" x2="0" y2="18" stroke="#C0562A" stroke-width="3.4" stroke-linecap="round" />
          <path d="M-6 18 L0 14 L6 18 Z" fill="#C0562A" />
        </g>
        <g class="tb-body">
          <ellipse cx="41" cy="56" rx="26" ry="22" fill="#FBF3E2" stroke="#E4D6B8" stroke-width="1.5" />
          <path d="M17 52 q-9 -3 -12 -9 q9 1 13 5 z" fill="#FBF3E2" stroke="#E4D6B8" stroke-width="1.2" />
          <path d="M44 50 q16 2 18 14 q-11 6 -20 -1 q-2 -8 2 -13z" fill="#F3E6C8" stroke="#E4D6B8" stroke-width="1.2" />
          <circle cx="52" cy="34" r="16" fill="#FBF3E2" stroke="#E4D6B8" stroke-width="1.5" />
          <circle cx="47" cy="40" r="3.2" fill="rgba(192,86,42,.22)" />
          <g>
            <circle cx="55" cy="32" r="3.4" fill="#241D18" />
            <circle cx="56.2" cy="30.8" r="1.1" fill="#fff" />
            <rect class="tb-lid" x="51.4" y="28.6" width="7.2" height="7" rx="3.5" fill="#FBF3E2" />
          </g>
          <path d="M64 33 q11 -1 12 4 q-1 5 -12 4 q-3 -4 0 -8z" fill="#E0812F" stroke="#C0562A" stroke-width="1" />
          <path class="tb-star" d="M50 15 l1.6 4 4.2 .2 -3.2 2.6 1.1 4.1 -3.7 -2.3 -3.7 2.3 1.1 -4.1 -3.2 -2.6 4.2 -.2z" fill="#D9A441" stroke="#B08637" stroke-width=".6" />
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits<{ (e: 'open'): void }>()

const rootRef = ref<HTMLElement | null>(null)
const isWalking = ref(false)
const sleeping = ref(false)
const happy = ref(false)
const facing = ref(1)
const bubbleShow = ref(false)
const bubbleText = ref('')

let W = window.innerWidth, H = window.innerHeight
let x = W / 2, y = H * 0.62, tx = x, ty = y
let rafId = 0
let lastStep = 0
let idleMs = 0
let lastT = 0
let blinkTimer = 0
let bubbleTimer = 0
// pointer (tap vs drag)
let downX = 0, downY = 0, downT = 0, moved = false

const quacks = ['嘎嘎～', '咕咕！', '呱！', '嘎!', '咕嘎咕嘎～']

function place() {
  if (rootRef.value) rootRef.value.style.transform = `translate(${x - 41}px, ${y - 88}px)`
}

function say(text: string, ms = 1400) {
  bubbleText.value = text
  bubbleShow.value = true
  clearTimeout(bubbleTimer)
  bubbleTimer = window.setTimeout(() => { bubbleShow.value = false }, ms)
}

function wake() {
  if (sleeping.value) { sleeping.value = false; say('嗯？我醒啦～', 1200) }
  idleMs = 0
}

function footprint() {
  const s = document.createElement('div')
  s.className = 'tb-footprint'
  s.style.left = `${x + (facing.value < 0 ? 8 : -8)}px`
  s.style.top = `${y - 2}px`
  s.textContent = '✦'
  document.body.appendChild(s)
  window.setTimeout(() => s.remove(), 900)
}

function ripple(px: number, py: number) {
  const r = document.createElement('div')
  r.className = 'tb-ripple'
  r.style.left = `${px}px`; r.style.top = `${py}px`
  document.body.appendChild(r)
  window.setTimeout(() => r.remove(), 520)
}

// 点页面任意位置 → 走过去（排除小鸭自己、聊天面板、以及各类交互控件，避免干扰操作）
function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target || !target.closest) return
  if (target.closest(
    '#travel-buddy, .ai-chat-floating, button, a, input, textarea, select, ' +
    '.ant-btn, .ant-select, .ant-menu, .ant-picker, .ant-input, ' +
    '.top-switch-menu, .top-switch-actions, .landing-navbar, [role="button"], [role="tab"]'
  )) return
  tx = Math.max(34, Math.min(W - 34, e.clientX))
  ty = Math.max(H * 0.24, Math.min(H - 30, e.clientY))
  ripple(e.clientX, e.clientY)
  wake()
}

function onPointerDown(e: PointerEvent) {
  downX = e.clientX; downY = e.clientY; downT = performance.now(); moved = false
}
function onPointerUp(e: PointerEvent) {
  const dist = Math.hypot(e.clientX - downX, e.clientY - downY)
  const dt = performance.now() - downT
  if (dist < 8 && dt < 400) {
    // 轻点 → 打开 AI 聊天
    wake()
    happy.value = false; requestAnimationFrame(() => { happy.value = true })
    emit('open')
  } else {
    // 拖它 → 卖萌叫
    wake()
    say(quacks[Math.floor(Math.random() * quacks.length)], 1200)
    happy.value = false; requestAnimationFrame(() => { happy.value = true })
  }
}

function onResize() { W = window.innerWidth; H = window.innerHeight }

function loop(now: number) {
  rafId = requestAnimationFrame(loop)
  const dt = lastT ? now - lastT : 16
  lastT = now

  const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy)
  if (d > 2 && !sleeping.value) {
    const step = Math.min(3.1, d)
    x += (dx / d) * step; y += (dy / d) * step
    if (Math.abs(dx) > 0.6) { const nf = dx < 0 ? -1 : 1; if (nf !== facing.value) facing.value = nf }
    isWalking.value = true
    idleMs = 0
    if (now - lastStep > 200) { footprint(); lastStep = now }
  } else {
    isWalking.value = false
    idleMs += dt
    // 久了打个盹
    if (!sleeping.value && idleMs > 11000) { sleeping.value = true; say('呼…呼…💤', 1600) }
  }
  place()
}

onMounted(() => {
  place()
  document.addEventListener('click', onDocClick)
  window.addEventListener('resize', onResize)
  // 眨眼
  blinkTimer = window.setInterval(() => {
    if (sleeping.value || !rootRef.value) return
    if (Math.random() < 0.6) { rootRef.value.classList.add('blink'); window.setTimeout(() => rootRef.value && rootRef.value.classList.remove('blink'), 130) }
  }, 2600)
  rafId = requestAnimationFrame(loop)
  window.setTimeout(() => say('嗨，我陪你逛！', 2200), 800)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('resize', onResize)
  clearInterval(blinkTimer)
  clearTimeout(bubbleTimer)
})
</script>

<style scoped>
#travel-buddy {
  position: fixed; left: 0; top: 0; z-index: 998;
  width: 82px; height: 96px; pointer-events: auto; cursor: pointer;
  transform-origin: 50% 100%; will-change: transform; touch-action: none;
  user-select: none; -webkit-user-select: none;
}
.tb-flip { transform-origin: 50% 50%; transition: transform .18s ease; }
#travel-buddy.face-left .tb-flip { transform: scaleX(-1); }

.tb-body { transform-origin: 50% 90%; }
#travel-buddy.walking .tb-body { animation: tb-bob .34s ease-in-out infinite; }
#travel-buddy:not(.walking):not(.sleeping) .tb-body { animation: tb-breathe 2.6s ease-in-out infinite; }
#travel-buddy.sleeping .tb-body { animation: tb-sleep 3.4s ease-in-out infinite; }
@keyframes tb-bob { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-3px) rotate(2deg); } }
@keyframes tb-breathe { 0%,100% { transform: translateY(0) scale(1,1); } 50% { transform: translateY(-1px) scale(1.02,.99); } }
@keyframes tb-sleep { 0%,100% { transform: translateY(0) scale(1,1); } 50% { transform: translateY(1px) scale(1.03,.97); } }

.tb-leg { transform-origin: top center; }
#travel-buddy.walking .tb-leg-l { animation: tb-stepL .34s ease-in-out infinite; }
#travel-buddy.walking .tb-leg-r { animation: tb-stepR .34s ease-in-out infinite; }
@keyframes tb-stepL { 0%,100% { transform: rotate(16deg); } 50% { transform: rotate(-16deg); } }
@keyframes tb-stepR { 0%,100% { transform: rotate(-16deg); } 50% { transform: rotate(16deg); } }

.tb-lid { transform-origin: center; transform: scaleY(0); }
#travel-buddy.blink .tb-lid, #travel-buddy.sleeping .tb-lid { transform: scaleY(1); }
.tb-star { transform-origin: center; animation: tb-twinkle 3s ease-in-out infinite; }
@keyframes tb-twinkle { 0%,100% { opacity: .9; transform: rotate(0) scale(1); } 50% { opacity: .5; transform: rotate(20deg) scale(1.15); } }
#travel-buddy.happy .tb-body { animation: tb-hop .5s ease !important; }
@keyframes tb-hop { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-14px); } }

.tb-bubble {
  position: absolute; left: 50%; top: -12px; transform: translate(-50%,-100%) scale(0); transform-origin: bottom center;
  background: #FBF7EE; border: 1px solid rgba(36,29,24,.16); color: #241D18;
  font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 14px; padding: 5px 12px; border-radius: 14px; white-space: nowrap;
  box-shadow: 0 8px 20px -10px rgba(36,29,24,.5); transition: transform .22s cubic-bezier(.34,1.56,.64,1); pointer-events: none;
}
.tb-bubble::after { content: ''; position: absolute; left: 50%; bottom: -6px; transform: translateX(-50%); border: 6px solid transparent; border-top-color: #FBF7EE; }
.tb-bubble.show { transform: translate(-50%,-100%) scale(1); }

.tb-zzz { position: absolute; right: -2px; top: -6px; font-family: 'Newsreader', serif; font-style: italic; color: var(--rust, #C0562A); pointer-events: none; }
.tb-zzz { animation: tb-zzz 2.4s ease-in-out infinite; }
.tb-zzz span { font-size: .85em; opacity: .7; }
@keyframes tb-zzz { 0%,100% { opacity: .4; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-4px); } }

@media (prefers-reduced-motion: reduce) {
  #travel-buddy * { animation: none !important; }
}
</style>

<style>
/* body 级：星星脚印 + 落点涟漪（非 scoped，因元素挂在 body 上） */
.tb-footprint {
  position: fixed; z-index: 997; pointer-events: none; transform: translate(-50%,-50%);
  color: #D9A441; font-size: 13px; text-shadow: 0 0 6px rgba(217,164,65,.5);
  animation: tb-fp .9s ease-out forwards;
}
@keyframes tb-fp { 0% { opacity: .95; transform: translate(-50%,-50%) scale(.6) rotate(0); } 100% { opacity: 0; transform: translate(-50%,-140%) scale(1.1) rotate(40deg); } }
.tb-ripple {
  position: fixed; z-index: 996; pointer-events: none; width: 26px; height: 26px;
  border: 1.5px solid #C0562A; border-radius: 50%; transform: translate(-50%,-50%) scale(.4);
  animation: tb-rip .52s ease-out forwards;
}
@keyframes tb-rip { to { transform: translate(-50%,-50%) scale(1.7); opacity: 0; } }
</style>
