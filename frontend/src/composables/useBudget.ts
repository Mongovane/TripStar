import { ref, computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import type { TripPlan, Attraction, Meal, Hotel } from '@/types'

// ===== 预算相关类型（从 Result.vue 抽出）=====
type BudgetItemType = 'attraction' | 'hotel' | 'meal' | 'transport'
type BudgetSortMode = 'amountDesc' | 'amountAsc' | 'dayAsc' | 'dayDesc'

type BudgetDetailItem = {
  id: string
  type: BudgetItemType
  dayIndex: number | null
  dayNumber: number | null
  name: string
  amount: number
  sourceIndex?: number
}

type BudgetRestorePayload =
  | {
      type: 'attraction'
      attraction: Attraction
      insertIndex: number
    }
  | {
      type: 'meal'
      meal: Meal
      insertIndex: number
    }
  | {
      type: 'hotel'
      hotel: Hotel
      accommodation: string
    }
  | {
      type: 'transport'
      transportation: string
    }

type BudgetRestoreItem = {
  uid: string
  base: BudgetDetailItem
  payload: BudgetRestorePayload
}


/**
 * 预算明细 composable：预算列表、筛选/排序、编辑/删除/恢复金额，以及重算合计。
 * 依赖 tripPlan（会就地修改 tripPlan.value.budget / days）。
 */
export function useBudget(
  tripPlan: Ref<TripPlan | null>,
  deps: { getMealLabel: (type: string) => string; destroyCurrentMap: () => void }
) {
  const { t } = useI18n()
  const { getMealLabel, destroyCurrentMap } = deps

const budgetFilterType = ref<'all' | BudgetItemType>('all')
const budgetSortMode = ref<BudgetSortMode>('amountDesc')
const pendingBudgetItems = ref<BudgetRestoreItem[]>([])

const toBudgetNumber = (value: unknown): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return numeric
}

const roundBudgetAmount = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const formatBudgetAmount = (value: number): string => {
  const rounded = roundBudgetAmount(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

const getBudgetTypeLabel = (type: BudgetItemType): string => {
  const labels: Record<BudgetItemType, string> = {
    attraction: t('result.budget.attraction'),
    hotel: t('result.budget.hotel'),
    meal: t('result.budget.meal'),
    transport: t('result.budget.transport'),
  }
  return labels[type]
}

const cloneData = <T>(data: T): T => JSON.parse(JSON.stringify(data)) as T

const recalculateBudgetTotals = (transportationOverride?: number) => {
  if (!tripPlan.value) return

  let attractionTotal = 0
  let hotelTotal = 0
  let mealTotal = 0

  tripPlan.value.days.forEach((day) => {
    day.attractions.forEach((attraction) => {
      attractionTotal += toBudgetNumber(attraction.ticket_price)
    })

    if (day.hotel) {
      hotelTotal += toBudgetNumber(day.hotel.estimated_cost)
    }

    day.meals.forEach((meal) => {
      mealTotal += toBudgetNumber(meal.estimated_cost)
    })
  })

  const transportationTotal = roundBudgetAmount(
    transportationOverride ?? toBudgetNumber(tripPlan.value.budget?.total_transportation)
  )

  tripPlan.value.budget = {
    total_attractions: roundBudgetAmount(attractionTotal),
    total_hotels: roundBudgetAmount(hotelTotal),
    total_meals: roundBudgetAmount(mealTotal),
    total_transportation: transportationTotal,
    total: roundBudgetAmount(attractionTotal + hotelTotal + mealTotal + transportationTotal),
  }
}

const budgetItems = computed<BudgetDetailItem[]>(() => {
  if (!tripPlan.value) return []

  const items: BudgetDetailItem[] = []

  tripPlan.value.days.forEach((day, dayIndex) => {
    const dayNumber = dayIndex + 1

    day.attractions.forEach((attraction, attractionIndex) => {
      const amount = roundBudgetAmount(toBudgetNumber(attraction.ticket_price))
      if (amount <= 0) return
      items.push({
        id: `attraction-${dayIndex}-${attractionIndex}`,
        type: 'attraction',
        dayIndex,
        dayNumber,
        name: attraction.name,
        amount,
        sourceIndex: attractionIndex,
      })
    })

    if (day.hotel) {
      const amount = roundBudgetAmount(toBudgetNumber(day.hotel.estimated_cost))
      if (amount > 0) {
        items.push({
          id: `hotel-${dayIndex}`,
          type: 'hotel',
          dayIndex,
          dayNumber,
          name: day.hotel.name,
          amount,
        })
      }
    }

    day.meals.forEach((meal, mealIndex) => {
      const amount = roundBudgetAmount(toBudgetNumber(meal.estimated_cost))
      if (amount <= 0) return
      items.push({
        id: `meal-${dayIndex}-${mealIndex}`,
        type: 'meal',
        dayIndex,
        dayNumber,
        name: `${getMealLabel(meal.type)} · ${meal.name}`,
        amount,
        sourceIndex: mealIndex,
      })
    })
  })

  const transportTotal = roundBudgetAmount(toBudgetNumber(tripPlan.value.budget?.total_transportation))
  const transportDays = tripPlan.value.days
    .map((day, dayIndex) => ({ day, dayIndex }))
    .filter(({ day }) => Boolean(day.transportation && day.transportation.trim()))

  if (transportTotal > 0 && transportDays.length > 0) {
    const avg = roundBudgetAmount(transportTotal / transportDays.length)
    let remaining = transportTotal

    transportDays.forEach(({ day, dayIndex }, index) => {
      const amount = index === transportDays.length - 1 ? remaining : Math.min(avg, remaining)
      remaining = roundBudgetAmount(remaining - amount)
      items.push({
        id: `transport-${dayIndex}`,
        type: 'transport',
        dayIndex,
        dayNumber: day.day_index + 1,
        name: day.transportation,
        amount: roundBudgetAmount(amount),
      })
    })
  }

  return items
})

const filteredBudgetItems = computed<BudgetDetailItem[]>(() => {
  let items = budgetItems.value

  if (budgetFilterType.value !== 'all') {
    items = items.filter((item) => item.type === budgetFilterType.value)
  }

  const sorted = [...items]
  sorted.sort((a, b) => {
    const dayA = a.dayNumber ?? Number.MAX_SAFE_INTEGER
    const dayB = b.dayNumber ?? Number.MAX_SAFE_INTEGER

    switch (budgetSortMode.value) {
      case 'amountAsc':
        return a.amount - b.amount
      case 'dayAsc':
        return dayA - dayB || b.amount - a.amount
      case 'dayDesc':
        return dayB - dayA || b.amount - a.amount
      case 'amountDesc':
      default:
        return b.amount - a.amount
    }
  })

  return sorted
})

// 行内编辑金额（替代原生 prompt/confirm，体验更顺滑）
const editingBudgetId = ref('')
const editingBudgetValue = ref('')

// 将金额写回行程数据（供行内编辑复用）；成功返回 true
const applyBudgetAmount = (item: BudgetDetailItem, nextAmount: number): boolean => {
  if (!tripPlan.value || item.dayIndex === null) return false
  const day = tripPlan.value.days[item.dayIndex]
  if (!day) return false

  let changed = false
  if (item.type === 'attraction' && typeof item.sourceIndex === 'number' && day.attractions[item.sourceIndex]) {
    day.attractions[item.sourceIndex].ticket_price = nextAmount
    changed = true
  }
  if (item.type === 'meal' && typeof item.sourceIndex === 'number' && day.meals[item.sourceIndex]) {
    day.meals[item.sourceIndex].estimated_cost = nextAmount
    changed = true
  }
  if (item.type === 'hotel' && day.hotel) {
    day.hotel.estimated_cost = nextAmount
    changed = true
  }

  const transportationTotal =
    item.type === 'transport'
      ? Math.max(
          0,
          roundBudgetAmount(toBudgetNumber(tripPlan.value.budget?.total_transportation) - item.amount + nextAmount)
        )
      : undefined
  if (item.type === 'transport' && day.transportation && day.transportation.trim()) {
    changed = true
  }

  if (!changed) return false
  recalculateBudgetTotals(transportationTotal)
  sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))
  return true
}

const startEditBudget = (item: BudgetDetailItem) => {
  editingBudgetId.value = item.id
  editingBudgetValue.value = formatBudgetAmount(item.amount)
}

const cancelEditBudget = () => {
  editingBudgetId.value = ''
  editingBudgetValue.value = ''
}

const commitEditBudget = (item: BudgetDetailItem) => {
  if (editingBudgetId.value !== item.id) return
  const numeric = Number(String(editingBudgetValue.value).trim())
  if (!Number.isFinite(numeric) || numeric < 0) {
    message.warning(t('result.messages.budgetInvalidAmount'))
    return
  }
  const nextAmount = roundBudgetAmount(numeric)
  cancelEditBudget()
  if (nextAmount === roundBudgetAmount(item.amount)) return
  if (applyBudgetAmount(item, nextAmount)) {
    message.success(t('result.messages.budgetAmountUpdated'))
  }
}

const deleteBudgetItem = (item: BudgetDetailItem) => {
  if (!tripPlan.value || item.dayIndex === null) return

  const day = tripPlan.value.days[item.dayIndex]
  if (!day) return

  let changed = false
  let restorePayload: BudgetRestorePayload | null = null

  if (item.type === 'attraction' && typeof item.sourceIndex === 'number') {
    const attraction = day.attractions[item.sourceIndex]
    if (attraction) {
      restorePayload = {
        type: 'attraction',
        attraction: cloneData(attraction),
        insertIndex: item.sourceIndex,
      }
      day.attractions.splice(item.sourceIndex, 1)
      changed = true
    }
  }

  if (item.type === 'meal' && typeof item.sourceIndex === 'number') {
    const meal = day.meals[item.sourceIndex]
    if (meal) {
      restorePayload = {
        type: 'meal',
        meal: cloneData(meal),
        insertIndex: item.sourceIndex,
      }
      day.meals.splice(item.sourceIndex, 1)
      changed = true
    }
  }

  if (item.type === 'hotel') {
    if (day.hotel) {
      restorePayload = {
        type: 'hotel',
        hotel: cloneData(day.hotel),
        accommodation: day.accommodation || '',
      }
      day.hotel = undefined
      day.accommodation = ''
      changed = true
    }
  }

  if (item.type === 'transport') {
    if (day.transportation && day.transportation.trim()) {
      restorePayload = {
        type: 'transport',
        transportation: day.transportation,
      }
      day.transportation = ''
      changed = true
    }
  }

  if (!changed || !restorePayload) return

  pendingBudgetItems.value.unshift({
    uid: `${item.id}-${Date.now()}`,
    base: cloneData(item),
    payload: restorePayload,
  })

  const transportationTotal =
    item.type === 'transport'
      ? Math.max(
          0,
          roundBudgetAmount(
            toBudgetNumber(tripPlan.value.budget?.total_transportation) - roundBudgetAmount(item.amount)
          )
        )
      : undefined

  recalculateBudgetTotals(transportationTotal)
  sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))

  destroyCurrentMap()

  message.success(t('result.messages.budgetItemDeleted'))
}

const restoreBudgetItem = (pendingItem: BudgetRestoreItem) => {
  if (!tripPlan.value || pendingItem.base.dayIndex === null) return

  const day = tripPlan.value.days[pendingItem.base.dayIndex]
  if (!day) return

  let changed = false

  if (pendingItem.payload.type === 'attraction') {
    const insertAt = Math.max(0, Math.min(pendingItem.payload.insertIndex, day.attractions.length))
    day.attractions.splice(insertAt, 0, cloneData(pendingItem.payload.attraction))
    changed = true
  }

  if (pendingItem.payload.type === 'meal') {
    const insertAt = Math.max(0, Math.min(pendingItem.payload.insertIndex, day.meals.length))
    day.meals.splice(insertAt, 0, cloneData(pendingItem.payload.meal))
    changed = true
  }

  if (pendingItem.payload.type === 'hotel') {
    day.hotel = cloneData(pendingItem.payload.hotel)
    day.accommodation = pendingItem.payload.accommodation
    changed = true
  }

  if (pendingItem.payload.type === 'transport') {
    day.transportation = pendingItem.payload.transportation
    changed = true
  }

  if (!changed) return

  const transportationTotal =
    pendingItem.base.type === 'transport'
      ? roundBudgetAmount(toBudgetNumber(tripPlan.value.budget?.total_transportation) + pendingItem.base.amount)
      : undefined

  recalculateBudgetTotals(transportationTotal)
  pendingBudgetItems.value = pendingBudgetItems.value.filter((item) => item.uid !== pendingItem.uid)
  sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))

  destroyCurrentMap()

  message.success(t('result.messages.budgetItemRestored'))
}

  return {
    budgetFilterType,
    budgetSortMode,
    pendingBudgetItems,
    budgetItems,
    filteredBudgetItems,
    toBudgetNumber,
    roundBudgetAmount,
    formatBudgetAmount,
    getBudgetTypeLabel,
    recalculateBudgetTotals,
    editingBudgetId,
    editingBudgetValue,
    startEditBudget,
    commitEditBudget,
    cancelEditBudget,
    deleteBudgetItem,
    restoreBudgetItem,
  }
}
