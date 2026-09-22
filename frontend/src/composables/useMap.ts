import { ref, nextTick, computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Loader as GoogleMapsLoader } from '@googlemaps/js-api-loader'
import {
  getRuntimeMapJsKey,
  getRuntimeMapSecurityCode,
  getRuntimeGoogleMapsApiKey,
  setRuntimeGoogleMapsApiKey,
  getBackendRuntimeSettings,
} from '@/services/api'
import type { TripPlan } from '@/types'

/**
 * 地图 composable：高德 / Google 地图初始化、标记、路线、刷新、销毁、截图。
 * 依赖 tripPlan；escapeHtml 由外部注入（与导出功能共用）。
 */
export function useMap(
  tripPlan: Ref<TripPlan | null>,
  deps: { escapeHtml: (value: unknown) => string }
) {
  const { t, locale } = useI18n()
  const { escapeHtml } = deps

  // Google 地图语言（由 i18n locale 推导）
  const localeTag = computed(() => {
    const c = String(locale.value || 'en').toLowerCase()
    if (c.startsWith('zh')) return 'zh-CN'
    if (c.startsWith('ja')) return 'ja-JP'
    return 'en-US'
  })

  // 是否海外行程（高德地图海外几乎无瓦片覆盖）
  const tripIsForeign = (): boolean => {
    if (!tripPlan.value) return false
    for (const day of tripPlan.value.days) {
      for (const a of day.attractions) {
        const lat = a.location?.latitude
        const lng = a.location?.longitude
        if (typeof lat === 'number' && typeof lng === 'number') {
          if (lat < 18 || lat > 54 || lng < 73 || lng > 135) return true
        }
      }
    }
    return false
  }

  // ---- 状态 ----
const mapRefreshing = ref(false)
const mapNotice = ref('')
let map: any = null
let googleMap: google.maps.Map | null = null
let googleMarkers: google.maps.Marker[] = []
let googlePolylines: google.maps.Polyline[] = []
let googleInfoWindows: google.maps.InfoWindow[] = []
let googleDirectionsRenderers: google.maps.DirectionsRenderer[] = []
const mapProviderType = ref<'google' | 'amap'>('amap')
let mapInitGeneration = 0

  // ---- 标记 / 路线 / 初始化 ----
const buildMarkerContent = (dayNo: number, stopNo: number): string => {
  return `
    <div class="tripstar-map-marker">
      <span class="tripstar-map-marker__core" aria-hidden="true">
        <svg fill="#ffffff" width="30px" height="30px" viewBox="0 0 256 256" id="Flat" xmlns="http://www.w3.org/2000/svg">
          <path d="M231.4248,109.2041,169.36426,86.63574,146.7959,24.57422a19.99984,19.99984,0,0,0-37.5918.001L86.63574,86.63574,24.57422,109.2041a19.99984,19.99984,0,0,0,.001,37.5918l62.06054,22.56836,22.56836,62.06152a19.99984,19.99984,0,0,0,37.5918-.001l22.56836-62.06054,62.06152-22.56836a19.99984,19.99984,0,0,0-.001-37.5918Zm-72.01562,38.24219a19.95591,19.95591,0,0,0-11.96289,11.96289l.001-.001L128,212.88672l-19.44629-53.47754A19.95279,19.95279,0,0,0,96.5918,147.44727L43.11328,128l53.47754-19.44629A19.95279,19.95279,0,0,0,108.55273,96.5918L128,43.11328l19.44629,53.47754a19.95279,19.95279,0,0,0,11.96191,11.96191L212.88672,128Z"/>
        </svg>
      </span>
      <span class="tripstar-map-marker__index" aria-hidden="true">${dayNo}-${stopNo}</span>
    </div>
  `
}

const buildInfoWindowContent = (attraction: any): string => {
  const name = escapeHtml(attraction.name || t('common.noData'))
  const address = escapeHtml(attraction.address || t('common.noData'))
  const visitDuration = Number.isFinite(attraction.visit_duration) ? attraction.visit_duration : '—'
  const dayAttractionText = escapeHtml(
    t('result.mapInfo.dayAttraction', { day: attraction.dayIndex + 1, index: attraction.attrIndex + 1 })
  )
  const minuteUnit = escapeHtml(t('result.minuteUnit'))

  return `
    <div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${name}</p>
      <p class="tripstar-map-tooltip__line">${dayAttractionText}</p>
      <p class="tripstar-map-tooltip__line">${address}</p>
      <p class="tripstar-map-tooltip__line">${visitDuration}${minuteUnit}</p>
    </div>
  `
}

type RouteMode = 'driving' | 'walking' | 'straight'
type RoutePoint = [number, number]

const ROUTE_STYLE_PRESETS: Record<
  RouteMode,
  {
    strokeColor: string
    strokeWeight: number
    strokeOpacity: number
    strokeStyle: 'solid' | 'dashed'
    strokeDasharray?: number[]
    lineJoin?: 'round' | 'miter' | 'bevel'
    lineCap?: 'butt' | 'round' | 'square'
    outlineColor?: string
    borderWeight?: number
  }
> = {
  driving: {
    strokeColor: '#37b4ff',
    strokeWeight: 3.5,
    strokeOpacity: 0.92,
    strokeStyle: 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(4, 19, 32, 0.7)',
    borderWeight: 1,
  },
  walking: {
    strokeColor: '#6ad38f',
    strokeWeight: 3,
    strokeOpacity: 0.9,
    strokeStyle: 'dashed',
    strokeDasharray: [12, 8],
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(8, 32, 20, 0.5)',
    borderWeight: 0.8,
  },
  straight: {
    strokeColor: '#ffffff',
    strokeWeight: 1.5,
    strokeOpacity: 0.62,
    strokeStyle: 'solid',
    strokeDasharray: [10, 10],
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(33, 17, 8, 0.45)',
    borderWeight: 0.8,
  },
}

const detectRouteMode = (transportation: string): RouteMode => {
  const normalized = (transportation || '').toLowerCase()
  if (/(步行|徒步|散步|walk|walking)/i.test(normalized)) return 'walking'
  if (/(驾车|开车|自驾|打车|出租车|car|drive|driving|taxi)/i.test(normalized)) return 'driving'
  return 'driving'
}

const toRoutePoint = (raw: any): RoutePoint | null => {
  if (!raw) return null

  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = Number(raw[0])
    const lat = Number(raw[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if (typeof raw.getLng === 'function' && typeof raw.getLat === 'function') {
    const lng = Number(raw.getLng())
    const lat = Number(raw.getLat())
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if ('lng' in raw && 'lat' in raw) {
    const lng = Number(raw.lng)
    const lat = Number(raw.lat)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if ('longitude' in raw && 'latitude' in raw) {
    const lng = Number(raw.longitude)
    const lat = Number(raw.latitude)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  return null
}

const parsePolylineString = (polyline: string): RoutePoint[] => {
  if (!polyline) return []

  return polyline
    .split(';')
    .map((pair) => pair.split(','))
    .map((parts) => {
      const lng = Number(parts[0])
      const lat = Number(parts[1])
      return Number.isFinite(lng) && Number.isFinite(lat) ? ([lng, lat] as RoutePoint) : null
    })
    .filter((point): point is RoutePoint => Boolean(point))
}

const dedupeRoutePath = (points: RoutePoint[]): RoutePoint[] => {
  if (points.length <= 1) return points
  return points.filter((point, index, array) => {
    if (index === 0) return true
    const prev = array[index - 1]
    return point[0] !== prev[0] || point[1] !== prev[1]
  })
}

const extractRoutePath = (result: any): RoutePoint[] => {
  const route =
    result?.routes?.[0] ||
    result?.route?.paths?.[0] ||
    result?.route?.routes?.[0] ||
    null

  if (!route) return []

  const steps = route.steps || []
  const points: RoutePoint[] = []

  steps.forEach((step: any) => {
    if (Array.isArray(step?.path)) {
      step.path.forEach((node: any) => {
        const point = toRoutePoint(node)
        if (point) points.push(point)
      })
      return
    }

    if (typeof step?.polyline === 'string') {
      points.push(...parsePolylineString(step.polyline))
    }
  })

  if (points.length > 1) return dedupeRoutePath(points)

  if (typeof route?.polyline === 'string') {
    const fromRoute = dedupeRoutePath(parsePolylineString(route.polyline))
    if (fromRoute.length > 1) return fromRoute
  }

  return []
}

const searchRoutePath = (
  AMap: any,
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint
): Promise<RoutePoint[] | null> => {
  return new Promise((resolve) => {
    const ServiceCtor = mode === 'walking' ? AMap.Walking : AMap.Driving
    if (!ServiceCtor) {
      resolve(null)
      return
    }

    const service =
      mode === 'driving'
        ? new ServiceCtor({
            policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0,
          })
        : new ServiceCtor({})

    service.search(start, end, (status: string, result: any) => {
      if (status !== 'complete') {
        resolve(null)
        return
      }
      const path = extractRoutePath(result)
      resolve(path.length > 1 ? path : null)
    })
  })
}

// 初始化地图入口
const initMap = async () => {
  const generation = ++mapInitGeneration

  // 1. 先尝试从 localStorage 读取 Google Maps API Key
  let googleKey = getRuntimeGoogleMapsApiKey()

  // 2. 如果 localStorage 没有缓存，主动从后端拉取一次
  if (!googleKey) {
    try {
      const backendSettings = await getBackendRuntimeSettings()
      if (backendSettings.google_maps_api_key) {
        googleKey = backendSettings.google_maps_api_key
        // 同步到 localStorage，下次不再需要请求后端
        setRuntimeGoogleMapsApiKey(googleKey)
      }
    } catch (err) {
      console.warn('从后端获取 Google Maps 配置失败:', err)
    }
  }

  if (generation !== mapInitGeneration) return

  // 3. 尝试初始化 Google Maps
  if (googleKey) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      // 超时控制：如果 5 秒内未加载完，强制 reject 以触发降级
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Google Maps 加载超时，可能由于网络环境限制')), 5000)
      })
      const initPromise = initGoogleMap(googleKey, generation)
      await Promise.race([initPromise, timeoutPromise])
      return
    } catch (error) {
      console.warn('Google Maps 加载失败，即将降级到高德地图:', error)
      if (generation !== mapInitGeneration) return
      destroyCurrentMap()
      // 等待 DOM 更新，确保高德容器可以显示
      await nextTick()
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  if (generation !== mapInitGeneration) return

  // 4. 降级/默认：初始化高德地图
  await initAMap()
}

// 初始化 Google Maps
const initGoogleMap = async (apiKey: string, generation: number) => {
  mapProviderType.value = 'google'
  const loader = new GoogleMapsLoader({
    apiKey,
    version: 'weekly',
    language: localeTag.value,
  })

  // 这会抛出异常，如由于网络、无代理引起等，正好会被上层捕捉
  const googleApi = await loader.importLibrary('maps')
  const { Map } = googleApi as google.maps.MapsLibrary

  // 加载可能用到的模块
  await loader.importLibrary('routes')
  await loader.importLibrary('marker')

  if (generation !== mapInitGeneration) return

  const container = document.getElementById('google-map-container')
  if (!container) throw new Error('Cannot find google-map-container')

  googleMap = new Map(container, {
    center: { lat: 39.916527, lng: 116.397128 },
    zoom: 12,
    mapTypeId: 'roadmap',
    // 隐藏默认控件，让其风格更接近我们的自定义风格
    disableDefaultUI: true,
    zoomControl: true,
    styles: [
      // Star Almanac 暖色古地图风：羊皮纸地、墨色地名、黄铜路网、柔和青水
      { elementType: 'geometry', stylers: [{ color: '#EFE7D6' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#5C4A37' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#F4EEE1' }, { weight: 2 }] },
      { elementType: 'labels.icon', stylers: [{ saturation: -60 }, { lightness: 10 }] },
      { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#CDB78F' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#95401A' }] },
      { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#A7967D' }] },
      { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#E9E0CB' }] },
      { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8A7355' }] },
      { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D9DEC6' }] },
      { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6B7A56' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E4D6B8' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#D6C39A' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6B5C4C' }] },
      { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#E7D9B6' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#E0C68A' }] },
      { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#C9A96A' }] },
      { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#7A5A2E' }] },
      { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#DFD3B8' }] },
      { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#95401A' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#BBD1CE' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4A6E70' }] },
      { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#DCEBE8' }] },
    ],
  })

  // 添加景点标记
  await addGoogleAttractionMarkers(generation)

  if (generation !== mapInitGeneration) return

  mapNotice.value = ''
  message.success(t('result.messages.mapLoaded'))
}

// 添加 Google Maps 景点标记
const addGoogleAttractionMarkers = async (generation: number) => {
  if (!tripPlan.value || !googleMap) return

  const allAttractions: any[] = []
  let globalIndex = 0

  tripPlan.value.days.forEach((day, dayIndex) => {
    day.attractions.forEach((attraction, attrIndex) => {
      globalIndex++
      if (attraction.location && attraction.location.longitude && attraction.location.latitude) {
        allAttractions.push({
          ...attraction,
          dayIndex,
          attrIndex,
          globalIndex,
        })
      }
    })
  })

  const bounds = new google.maps.LatLngBounds()

  allAttractions.forEach((attraction, index) => {
    const position = { lat: attraction.location.latitude, lng: attraction.location.longitude }
    bounds.extend(position)

    // 这里如果想完全复用 DOM 较为复杂，我们可以直接采用原生的 google.maps.Marker 与自定义 icon
    // 用一个简单的 SVG data URI 画一个有数字的 icon
    const markerText = `${attraction.dayIndex + 1}-${attraction.attrIndex + 1}`
    const svgIcon = `data:image/svg+xml;charset=UTF-8,` + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
        <path d="M17 0C7.6 0 0 7.6 0 17C0 29.8 17 42 17 42C17 42 34 29.8 34 17C34 7.6 26.4 0 17 0Z" fill="#C0562A" stroke="#fff" stroke-width="2"/>
        <text x="17" y="22" font-family="sans-serif" font-size="12" font-weight="bold" fill="white" text-anchor="middle">${markerText}</text>
      </svg>
    `)

    const marker = new google.maps.Marker({
      position,
      map: googleMap,
      icon: {
        url: svgIcon,
        scaledSize: new google.maps.Size(34, 42),
        anchor: new google.maps.Point(17, 42),
      },
      zIndex: 120 + index
    })

    const infoWindow = new google.maps.InfoWindow({
      content: buildInfoWindowContent(attraction),
      disableAutoPan: true,
    })

    marker.addListener('mouseover', () => { infoWindow.open({ anchor: marker, map: googleMap }) })
    marker.addListener('mouseout', () => { infoWindow.close() })
    marker.addListener('click', () => { infoWindow.open({ anchor: marker, map: googleMap }) })

    googleMarkers.push(marker)
    googleInfoWindows.push(infoWindow)
  })

  // 绘制 Google Maps 路线
  if (generation !== mapInitGeneration) return
  await drawGoogleRoutes(allAttractions)

  if (generation !== mapInitGeneration) return

  if (allAttractions.length > 0 && googleMap) {
    googleMap.fitBounds(bounds)
    // 防止过于放大
    const currentZoom = googleMap.getZoom()
    if (currentZoom && currentZoom > 15) googleMap.setZoom(15)
  }
}

// 绘制 Google Maps 路线
const drawGoogleRoutes = async (attractions: any[]) => {
  if (attractions.length < 2 || !tripPlan.value || !googleMap) return

  const dayGroups: Record<number, any[]> = {}
  attractions.forEach(attr => {
    if (!dayGroups[attr.dayIndex]) dayGroups[attr.dayIndex] = []
    dayGroups[attr.dayIndex].push(attr)
  })

  const directionsService = new google.maps.DirectionsService()

  for (const dayAttractions of Object.values(dayGroups)) {
    if (dayAttractions.length < 2) continue

    dayAttractions.sort((a: any, b: any) => a.attrIndex - b.attrIndex)
    const dayIndex = dayAttractions[0].dayIndex
    const transportation = tripPlan.value.days?.[dayIndex]?.transportation || ''
    const preferredMode = detectRouteMode(transportation)

    let gTravelMode = google.maps.TravelMode.DRIVING
    if (preferredMode === 'walking') gTravelMode = google.maps.TravelMode.WALKING

    for (let i = 0; i < dayAttractions.length - 1; i++) {
      const start = dayAttractions[i]
      const end = dayAttractions[i + 1]
      const origin = { lat: start.location.latitude, lng: start.location.longitude }
      const destination = { lat: end.location.latitude, lng: end.location.longitude }

      if (preferredMode === 'straight') {
        const poly = new google.maps.Polyline({
          path: [origin, destination],
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          strokeOpacity: 0.62,
          map: googleMap,
          zIndex: 90,
        })
        googlePolylines.push(poly)
        continue
      }

      try {
        const response = await directionsService.route({
          origin,
          destination,
          travelMode: gTravelMode,
        })

        const renderer = new google.maps.DirectionsRenderer({
          map: googleMap,
          directions: response,
          suppressMarkers: true, // 我们已经有了自定义 Marker
          polylineOptions: {
            strokeColor: preferredMode === 'walking' ? '#6ad38f' : '#37b4ff',
            strokeWeight: preferredMode === 'walking' ? 3 : 3.5,
            zIndex: 90,
          }
        })
        googleDirectionsRenderers.push(renderer)
      } catch (err: any) {
        console.warn('Google 路线规划失败, 降级为直线:', err)
        const poly = new google.maps.Polyline({
          path: [origin, destination],
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          strokeOpacity: 0.62,
          map: googleMap,
          zIndex: 90,
        })
        googlePolylines.push(poly)
      }
    }
  }
}

// 初始化高德地图
const initAMap = async () => {
  try {
    mapProviderType.value = 'amap'
    const mapJsKey = getRuntimeMapJsKey()
    if (!mapJsKey) {
      message.warning('请先在设置中配置高德地图 JS Key')
      return
    }
    // 运行时注入高德安全密钥（与 JS Key 成对使用）；未配置则沿用构建期注入的值
    const mapSecurityCode = getRuntimeMapSecurityCode()
    if (mapSecurityCode) {
      ;(window as any)._AMapSecurityConfig = { securityJsCode: mapSecurityCode }
    }
    const AMap = await AMapLoader.load({
      key: mapJsKey,  // 高德地图Web端(JS API) Key
      version: '2.0',
      plugins: ['AMap.Marker', 'AMap.Polyline', 'AMap.InfoWindow', 'AMap.Driving', 'AMap.Walking']
    })

    // 创建地图实例
    map = new AMap.Map('amap-container', {
      zoom: 12,
      center: [116.397128, 39.916527], // 默认中心点(北京)
      viewMode: '3D',
      mapStyle: 'amap://styles/whitesmoke',
      // 开启 preserveDrawingBuffer 才能让 html2canvas 在 WebGL 下截屏成功！
      WebGLParams: {
        preserveDrawingBuffer: true
      }
    })

    // 添加景点标记
    await addAttractionMarkers(AMap)

    // 高德海外无瓦片：给出明确提示，而非莫名空白
    mapNotice.value = tripIsForeign()
      ? '此行程位于海外，高德地图暂无地图覆盖。请在 ⚙️ 设置中配置 Google Maps Key 后点「刷新地图」查看完整地图。'
      : ''

    message.success(t('result.messages.mapLoaded'))
  } catch (error) {
    console.error('地图加载失败:', error)
    message.error(t('result.messages.mapLoadFailed'))
  }
}

// 添加景点标记
const addAttractionMarkers = async (AMap: any) => {
  if (!tripPlan.value) return

  const markers: any[] = []
  const allAttractions: any[] = []

  // 收集所有景点（保留全局编号）
  let globalIndex = 0
  tripPlan.value.days.forEach((day, dayIndex) => {
    day.attractions.forEach((attraction, attrIndex) => {
      globalIndex++
      if (attraction.location && attraction.location.longitude && attraction.location.latitude) {
        allAttractions.push({
          ...attraction,
          dayIndex,
          attrIndex,
          globalIndex   // 全局编号（从1开始）
        })
      }
    })
  })

  // 创建标记
  allAttractions.forEach((attraction, index) => {
    const marker = new AMap.Marker({
      position: [attraction.location.longitude, attraction.location.latitude],
      content: buildMarkerContent(attraction.dayIndex + 1, attraction.attrIndex + 1),
      anchor: 'center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 120 + index,
    })

    // 创建信息窗口
    const infoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: buildInfoWindowContent(attraction),
      offset: new AMap.Pixel(0, -18),
      closeWhenClickMap: true,
    })

    // 悬停显示纯文本tooltip，移出关闭
    marker.on('mouseover', () => {
      infoWindow.open(map, marker.getPosition())
    })
    marker.on('mouseout', () => {
      infoWindow.close()
    })
    // 点击也显示，兼容触屏设备
    marker.on('click', () => {
      infoWindow.open(map, marker.getPosition())
    })

    markers.push(marker)
  })

  // 添加标记到地图
  map.add(markers)

  // 绘制路线（优先真实道路路线，失败时回退直线）
  const routePolylines = await drawRoutes(AMap, allAttractions)

  // 自动调整视野以包含所有标记
  if (allAttractions.length > 0) {
    const overlaysForFit = routePolylines.length > 0 ? [...markers, ...routePolylines] : markers
    map.setFitView(overlaysForFit)
  }
}

// 绘制路线：根据交通方式选择 driving / walking；失败时降级为直线
const drawRoutes = async (AMap: any, attractions: any[]): Promise<any[]> => {
  if (attractions.length < 2 || !tripPlan.value) return []

  // 按天分组绘制路线
  const dayGroups: Record<number, any[]> = {}
  attractions.forEach(attr => {
    if (!dayGroups[attr.dayIndex]) {
      dayGroups[attr.dayIndex] = []
    }
    dayGroups[attr.dayIndex].push(attr)
  })

  const polylines: any[] = []

  // 为每天的景点逐段绘制路线
  for (const dayAttractions of Object.values(dayGroups)) {
    if (dayAttractions.length < 2) continue

    dayAttractions.sort((a: any, b: any) => a.attrIndex - b.attrIndex)
    const dayIndex = dayAttractions[0].dayIndex
    const transportation = tripPlan.value.days?.[dayIndex]?.transportation || ''
    const preferredMode = detectRouteMode(transportation)

    for (let i = 0; i < dayAttractions.length - 1; i++) {
      const start = dayAttractions[i]
      const end = dayAttractions[i + 1]
      const startPoint: RoutePoint = [start.location.longitude, start.location.latitude]
      const endPoint: RoutePoint = [end.location.longitude, end.location.latitude]

      const plannedPath =
        preferredMode === 'straight'
          ? null
          : await searchRoutePath(AMap, preferredMode as Exclude<RouteMode, 'straight'>, startPoint, endPoint)

      const usePlannedRoute = Array.isArray(plannedPath) && plannedPath.length > 1
      const routeModeForStyle: RouteMode = usePlannedRoute ? preferredMode : 'straight'
      const path = usePlannedRoute ? plannedPath : [startPoint, endPoint]
      const style = ROUTE_STYLE_PRESETS[routeModeForStyle]

      const polyline = new AMap.Polyline({
        path,
        ...style,
        showDir: true,
        zIndex: 90,
      })

      polylines.push(polyline)
    }
  }

  if (polylines.length > 0) {
    map.add(polylines)
  }

  return polylines
}

  // ---- 生命周期：销毁 / 就绪 / 刷新 ----
const destroyCurrentMap = () => {
  // 清理 Google Maps
  googleInfoWindows.forEach((iw) => { try { iw.close() } catch {} })
  googleInfoWindows = []
  googleMarkers.forEach((m) => { try { m.setMap(null) } catch {} })
  googleMarkers = []
  googlePolylines.forEach((p) => { try { p.setMap(null) } catch {} })
  googlePolylines = []
  googleDirectionsRenderers.forEach((r) => { try { r.setMap(null) } catch {} })
  googleDirectionsRenderers = []
  googleMap = null

  // 清理高德地图
  if (map) {
    try { map.destroy() } catch {}
    map = null
  }
}

const ensureMapReady = async () => {
  await nextTick()
  // Google Maps 优先检测
  if (mapProviderType.value === 'google' && googleMap) {
    google.maps.event.trigger(googleMap, 'resize')
    return
  }
  if (mapProviderType.value === 'amap' && map) {
    if (typeof map.resize === 'function') {
      map.resize()
    }
    return
  }
  // 都不存在则初始化
  await initMap()
}

const refreshMap = async () => {
  if (mapRefreshing.value) return
  mapRefreshing.value = true
  try {
    destroyCurrentMap()
    await nextTick()
    await initMap()
  } catch (error) {
    console.error('刷新地图失败:', error)
    message.error(t('result.messages.mapLoadFailed'))
  } finally {
    mapRefreshing.value = false
  }
}

  // ---- 截图（导出用）----
const captureMapScreenshot = async (): Promise<string> => {
  try {
    // 根据当前地图供应商选择对应的 DOM 容器
    const containerId = mapProviderType.value === 'google' ? 'google-map-container' : 'amap-container'
    const mapEl = document.getElementById(containerId)
    if (!mapEl || mapEl.clientHeight === 0) {
      console.warn('⚠️ 地图容器不可见或未初始化，跳过地图截图')
      return ''
    }

    // 临时将地图容器显示出来以便截图（可能被 v-show 隐藏）
    const parentCard = document.querySelector('.right-map') as HTMLElement | null
    const wasHidden = parentCard && parentCard.style.display === 'none'
    if (parentCard && wasHidden) {
      parentCard.style.display = 'block'
      parentCard.style.position = 'absolute'
      parentCard.style.left = '-9999px'
    }

    // 等待一帧让渲染生效
    await new Promise(resolve => setTimeout(resolve, 300))

    const html2canvas = (await import('html2canvas')).default
    const mapCanvas = await html2canvas(mapEl, {
      backgroundColor: '#EFE7D6',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true,
      ignoreElements: (element) => {
        // 忽略地图控制组件（比如 Google 的 +- 缩放按钮、高德控制条）
        // html2canvas 对地图原生 SVG UI 的渲染支持极差，容易出现白底色块
        if (element && element.className && typeof element.className === 'string') {
          if (element.className.includes('gmnoprint') || element.className.includes('amap-controls')) {
            return true
          }
        }
        return false
      }
    })

    // 还原隐藏状态
    if (parentCard && wasHidden) {
      parentCard.style.display = 'none'
      parentCard.style.position = ''
      parentCard.style.left = ''
    }

    return mapCanvas.toDataURL('image/png')
  } catch (err) {
    console.warn('⚠️ 地图截图失败，导出将不包含地图:', err)
    return ''
  }
}

  return {
    mapRefreshing,
    mapNotice,
    mapProviderType,
    refreshMap,
    ensureMapReady,
    destroyCurrentMap,
    captureMapScreenshot,
  }
}
