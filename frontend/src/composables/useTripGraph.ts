import { computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripPlan, DayPlan, Attraction, Hotel, Meal, WeatherInfo } from '@/types'

// ===== 关系星盘几何：viewBox 1000×700，横向拉伸成椭圆星盘 =====
export const VW = 1000
export const VH = 700
export const CX = 500
export const CY = 350
const SX = 1.4
const RING = { city: 74, day: 112, badge: 148, attraction: 194, satellite: 262, house: 298, ledger: 324 }

// 宫位宝石色（与概览星盘 AURORA 同源）
export const HOUSE_TONES = ['#2FB4C9', '#7C6FE0', '#D96FA0', '#E0A24E', '#4FC58E', '#E0705A']
export const KIND_COLORS = { city: '#C0562A', day: '#1F5460', hotel: '#B08637', meal: '#E0705A' }
export const LEDGER_COLORS = { attraction: '#2FB4C9', hotel: '#B08637', meal: '#E0705A', transport: '#1F5460', interCity: '#7C6FE0' }
export const SUN_ID = 'sun'

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π']

export type StarKind = 'city' | 'day' | 'attraction' | 'hotel' | 'meal'
export type LinkKind = 'orbit' | 'visit' | 'next' | 'stay' | 'dine' | 'voyage'
export type LedgerKey = keyof typeof LEDGER_COLORS

export interface Pt { x: number; y: number }

export interface StarNode extends Pt {
  id: string
  kind: StarKind
  name: string
  house: number        // 所属宫位 = 日程数组下标；太阳与城市为 -1
  tone: number         // HOUSE_TONES 下标
  color: string
  r: number
  designation: string  // 星表编号，如「β II」
  dense: boolean       // 宫位拥挤：默认收起星名，只留希腊字母
  day?: DayPlan
  attraction?: Attraction
  hotel?: Hotel
  meal?: Meal
  city?: string
}

export interface StarLink { id: string; kind: LinkKind; s: string; t: string; d: string }

export interface House {
  index: number
  numeral: string
  color: string
  tone: number
  day: DayPlan
  weather?: WeatherInfo
  mid: number
  wedge: string
  spoke: { x1: number; y1: number; x2: number; y2: number } | null
  label: Pt
  badge: Pt
  focus: Pt
}

export interface LedgerArc { key: LedgerKey; amount: number; share: number; color: string; d: string }

// 航线回放的一段：同日为直线，跨日为向心弧线
export interface VoyageSeg { from: Pt; to: Pt; ctrl?: Pt; len: number; toId: string }

export interface TripGraph {
  nodes: StarNode[]
  links: StarLink[]
  houses: House[]
  ledger: LedgerArc[]
  ledgerTotal: number
  voyage: VoyageSeg[]
  voyageStartId: string
}

const EMPTY: TripGraph = { nodes: [], links: [], houses: [], ledger: [], ledgerTotal: 0, voyage: [], voyageStartId: '' }

const r1 = (n: number) => Math.round(n * 10) / 10
const at = (angle: number, R: number): Pt => ({ x: r1(CX + Math.cos(angle) * R * SX), y: r1(CY + Math.sin(angle) * R) })
const bend = (a: Pt, b: Pt, k: number): Pt => {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  return { x: r1(mx + (CX - mx) * k), y: r1(my + (CY - my) * k) }
}
const curve = (a: Pt, b: Pt, k: number) => {
  const c = bend(a, b, k)
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`
}
const line = (a: Pt, b: Pt) => `M ${a.x} ${a.y} L ${b.x} ${b.y}`

// 椭圆弧 / 扇形（星盘被横向拉伸，所以是轴对齐椭圆）
function arcPath(a0: number, a1: number, R: number) {
  const p0 = at(a0, R), p1 = at(a1, R)
  return `M ${p0.x} ${p0.y} A ${r1(R * SX)} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x} ${p1.y}`
}
function sectorPath(a0: number, a1: number, R: number) {
  const rx = r1(R * SX)
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return `M ${CX - rx} ${CY} A ${rx} ${R} 0 1 1 ${CX + rx} ${CY} A ${rx} ${R} 0 1 1 ${CX - rx} ${CY} Z`
  }
  return `M ${CX} ${CY} L ${arcPath(a0, a1, R).slice(2)} Z`
}

// 在扇区内均匀排布 k 个角度（两端留白，避免跨宫贴边）
function spread(a0: number, a1: number, k: number) {
  const pad = Math.min((a1 - a0) * 0.1, 0.12)
  const w = (a1 - a0 - pad * 2) / Math.max(k, 1)
  return Array.from({ length: k }, (_, i) => a0 + pad + w * (i + 0.5))
}

export function toRoman(n: number) {
  const table: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of table) while (n >= v) { out += s; n -= v }
  return out
}

function findWeather(plan: TripPlan, day: DayPlan) {
  return (plan.weather_info || []).find((w) => w.date === day.date && (!w.city || !day.city || w.city === day.city))
}

function buildTripGraph(plan: TripPlan, dayName: (n: number) => string): TripGraph {
  const days = plan.days || []
  if (!days.length) return EMPTY

  const nodes: StarNode[] = []
  const links: StarLink[] = []
  const houses: House[] = []
  const byId: Record<string, StarNode> = {}
  const addNode = (n: StarNode) => { nodes.push(n); byId[n.id] = n }
  const addLink = (kind: LinkKind, s: string, t: string, d: string) => links.push({ id: `${kind}:${s}>${t}`, kind, s, t, d })

  // ---- 太阳：城市 / 多城航线 ----
  const cities = plan.cities && plan.cities.length > 1 ? plan.cities : []
  addNode({
    id: SUN_ID, kind: 'city', name: cities.length ? cities.join(' → ') : plan.city,
    x: CX, y: CY, r: 34, house: -1, tone: 0, color: KIND_COLORS.city, designation: '☉', dense: false,
    city: plan.city,
  })

  // ---- 宫位：每天一宫，自正上方顺时针 ----
  const D = days.length
  const span = (Math.PI * 2) / D
  const cityDays: Record<string, number[]> = {}

  days.forEach((day, di) => {
    const a0 = -Math.PI / 2 + di * span, a1 = a0 + span, mid = (a0 + a1) / 2
    const tone = di % HOUSE_TONES.length
    const color = HOUSE_TONES[tone]
    const numeral = toRoman(di + 1)
    const s0 = at(a0, RING.day - 36), s1 = at(a0, RING.house - 12)
    houses.push({
      index: di, numeral, color, tone, day, weather: findWeather(plan, day), mid,
      wedge: sectorPath(a0, a1, RING.house + 10),
      spoke: D > 1 ? { x1: s0.x, y1: s0.y, x2: s1.x, y2: s1.y } : null,
      label: at(mid, RING.house), badge: at(mid, RING.badge), focus: at(mid, 186),
    })
    if (cities.length) (cityDays[day.city || plan.city] ||= []).push(di)

    const hub = at(mid, RING.day)
    const dayId = `day-${di}`
    addNode({ id: dayId, kind: 'day', name: dayName(di + 1), ...hub, r: 15, house: di, tone, color, designation: numeral, dense: false, day })

    // 景点：宫内按游览顺序排开，拥挤时交错半径
    const attrs = day.attractions || []
    const angles = spread(a0, a1, attrs.length)
    const arcPx = attrs.length ? ((span * 0.8) / attrs.length) * RING.attraction * (SX + 1) / 2 : Infinity
    const dense = arcPx < 88
    attrs.forEach((a, i) => {
      const R = dense ? RING.attraction + (i % 2 ? 16 : -12) : RING.attraction
      addNode({
        id: `attr-${di}-${i}`, kind: 'attraction', name: a.name, ...at(angles[i], R), r: dense ? 7 : 8.5,
        house: di, tone, color, designation: `${GREEK[i % GREEK.length]} ${numeral}`, dense, day, attraction: a,
      })
    })

    // 卫星：酒店 + 餐饮，挂在宫位外环
    const sats: { id: string; kind: 'hotel' | 'meal'; name: string; hotel?: Hotel; meal?: Meal }[] = []
    ;(day.meals || []).forEach((m, j) => { if (m.name) sats.push({ id: `meal-${di}-${j}`, kind: 'meal', name: m.name, meal: m }) })
    if (day.hotel?.name) sats.push({ id: `hotel-${di}`, kind: 'hotel', name: day.hotel.name, hotel: day.hotel })
    const satAngles = spread(a0, a1, sats.length)
    sats.forEach((s, j) => {
      addNode({
        ...s, ...at(satAngles[j], RING.satellite), r: s.kind === 'hotel' ? 7 : 4.5,
        house: di, tone, color: KIND_COLORS[s.kind], designation: numeral, dense: true, day,
      })
    })
  })

  // ---- 多城市：内圈行星 ----
  Object.entries(cityDays).forEach(([city, dis]) => {
    const mid = dis.reduce((s, di) => s + houses[di].mid, 0) / dis.length
    const id = `city-${city}`
    addNode({ id, kind: 'city', name: city, ...at(mid, RING.city), r: 10, house: -1, tone: 0, color: KIND_COLORS.day, designation: '♁', dense: false, city })
    addLink('orbit', SUN_ID, id, line(byId[SUN_ID], byId[id]))
  })

  // ---- 关系 ----
  const voyagePts: StarNode[] = []
  days.forEach((day, di) => {
    const hub = byId[`day-${di}`]
    const parent = byId[`city-${day.city || plan.city}`] || byId[SUN_ID]
    addLink('orbit', parent.id, hub.id, curve(parent, hub, 0))
    ;(day.attractions || []).forEach((_, i) => {
      const a = byId[`attr-${di}-${i}`]
      addLink('visit', hub.id, a.id, curve(hub, a, 0.18))
      if (i > 0) { const p = byId[`attr-${di}-${i - 1}`]; addLink('next', p.id, a.id, line(p, a)) }
      voyagePts.push(a)
    })
    nodes.filter((n) => n.house === di && (n.kind === 'hotel' || n.kind === 'meal')).forEach((s) => {
      addLink(s.kind === 'hotel' ? 'stay' : 'dine', hub.id, s.id, curve(hub, s, 0.22))
    })
  })

  // ---- 航线：串起全部景点，跨日处向心弯折 ----
  const voyage: VoyageSeg[] = []
  for (let i = 1; i < voyagePts.length; i++) {
    const a = voyagePts[i - 1], b = voyagePts[i]
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    if (a.house === b.house) {
      voyage.push({ from: a, to: b, len: chord, toId: b.id })
    } else {
      const c = bend(a, b, 0.45)
      voyage.push({ from: a, to: b, ctrl: c, len: (chord + Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y)) / 2, toId: b.id })
      addLink('voyage', a.id, b.id, `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`)
    }
  }

  // ---- 预算星环：外缘分度弧，弧长 = 占比 ----
  const b = plan.budget
  const parts: [LedgerKey, number][] = b
    ? ([['attraction', b.total_attractions], ['hotel', b.total_hotels], ['meal', b.total_meals],
        ['transport', b.total_transportation], ['interCity', b.total_inter_city_transport || 0]] as [LedgerKey, number][])
        .filter(([, v]) => Number(v) > 0)
    : []
  const sum = parts.reduce((s, [, v]) => s + Number(v), 0)
  const ledger: LedgerArc[] = []
  if (sum > 0) {
    const gap = parts.length > 1 ? 0.03 : 0
    let a = -Math.PI / 2
    parts.forEach(([key, v]) => {
      const sweep = (Number(v) / sum) * Math.PI * 2
      const a1 = parts.length > 1 ? a + sweep - gap : a + sweep - 0.001
      ledger.push({ key, amount: Number(v), share: Number(v) / sum, color: LEDGER_COLORS[key], d: arcPath(a + gap / 2, a1, RING.ledger) })
      a += sweep
    })
  }

  return {
    nodes, links, houses, ledger,
    ledgerTotal: b?.total || sum,
    voyage,
    voyageStartId: voyagePts[0]?.id || '',
  }
}

// 从行程直接推导关系星盘：编辑行程 / 切换语言后即时同步，无需后端重建
export function useTripGraph(plan: Ref<TripPlan | null>) {
  const { t } = useI18n()
  const graph = computed<TripGraph>(() =>
    plan.value ? buildTripGraph(plan.value, (n) => t('common.dayNumber', { day: n })) : EMPTY
  )
  return { graph }
}
