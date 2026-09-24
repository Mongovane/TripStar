<div align="center">

# ✦ TripStar · 旅途星辰

**一个多智能体 AI 旅行规划平台 —— 说出目的地与日期，一队 AI 智能体为你排出可直接照着走的完整行程。**

暖色「Star Almanac（星图年鉴）」设计语言 · 关系星盘 · 会走动的星星小鸭

[![Vue](https://img.shields.io/badge/Vue-3.5-42b883)](https://vuejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-C0562A)](./LICENSE)

</div>

---

## 这是什么

TripStar 是一个「AI 旅行社」。你只需填写**城市、日期、出行/住宿偏好和一句话需求**，后端一队智能体会：并行地从**小红书**挖掘真实游记里的热门景点、查询目的地**天气**、匹配符合预算的**酒店**，再由**规划智能体**融合成逐日行程与一份**诚实的预算清单**，最后生成一张**关系图谱**。全程通过 WebSocket 实时回传进度（轮询兜底），并支持中 / 英 / 日三语。

生成后进入结果页，可查看：行程概览、预算明细、景点地图、每日行程、关系图谱、天气信息，并可与内置 **AI 助手**追问、编辑行程、导出攻略。

## 界面亮点（本项目的设计语言）

整站采用统一的 **Star Almanac（星图年鉴）** 视觉：暖羊皮纸底 + 墨线 + 宝石色 + 同心环 + 编辑部式排版（`Newsreader` 衬线 / `IBM Plex Mono` 等宽 / `Outfit` 正文）。

- **🪐 行程概览 · 星盘 The Orrery** —— 景点化作深空里的宝石星辰，用星座线连成航线；黄铜浑天环缓缓旋转（GPU 合成层，不掉帧），点击星辰弹出羊皮纸「田野笔记」卡片（含实拍图、时长、预约提醒、跳转当日行程）。
- **🌌 关系图谱 · 关系星盘 Relation Astrolabe** —— 城市居中如太阳，**每天占一「宫」**（罗马数字宫名 + 日期 + 天气徽记）：宫主星是当日枢纽，景点按游览顺序以希腊字母编号（`β II` = 第 2 天第 2 站）并用黄铜星座线串起，酒店 ◆ / 餐饮 ◎ 作为外环卫星；最外圈是按占比分度的**预算星环**。可悬停看关联、点星辰翻开「星表卡」（实拍图 / 详情 / 关联星辰 / 跳转当日行程）、点宫位缩放聚焦、按星类筛选，以及 **▶ 航线回放**——彗星沿全程景点飞行、逐颗点亮。关系数据由前端从行程直接推导，编辑行程或切换语言后即时同步。纯 SVG/CSS，无 WebGL、无重型依赖。
- **🐤 星星小鸭 Travel Buddy** —— 一个原创小助手常驻页面：**点哪走哪**、走路撒星星脚印、闲久了打盹、拖它会叫，**轻点它打开 AI 聊天**。
- **暖色卡片体系** —— 预算 / 每日行程 / 天气全部统一到暖色调，金额用陶土橙高亮，文字清晰可读。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Ant Design Vue + vue-i18n（中/英/日）|
| 3D/可视化 | 纯 SVG + CSS（星盘、关系星盘），无 three.js / echarts 依赖 |
| 地图 | 高德地图 JS API 2.0（默认）/ Google Maps（可选）|
| 后端 | FastAPI + 多智能体编排（asyncio 并行）+ WebSocket |
| 数据源 | 小红书（景点/图片）· 高德 MCP（天气/酒店/地理编码）· OpenAI 兼容 LLM |
| 部署 | Docker Compose（前端 vite 构建 + 后端 uvicorn，静态资源开启 gzip）|

## 架构概览

```
用户填写行程需求
      │  POST /api/trip/plan  (+ WebSocket /api/trip/ws/{task})
      ▼
┌─────────────────────── 多智能体编排 (asyncio.gather) ───────────────────────┐
│  ① 景点智能体   小红书 API → LLM 提纯 → 结构化景点（带坐标/预约提醒）        │
│  ② 天气智能体   高德 MCP → 逐城未来天气                （三路并行）          │
│  ③ 酒店智能体   高德 MCP → 符合预算的候选酒店                                │
│                          ▼                                                   │
│  ④ 规划智能体   融合上述结果 → 逐日行程 + 逐项预算（结构化 JSON）            │
│  ⑤ 图谱智能体   行程 → 关系图谱（城市/日程/景点/酒店/餐饮/预算/天气）        │
└─────────────────────────────────────────────────────────────────────────────┘
      │  进度经 WebSocket 实时回传（轮询兜底）
      ▼
结果页：概览星盘 · 预算 · 地图 · 每日行程 · 关系星盘 · 天气 · AI 助手
```

## 快速开始

### 1. 前置条件
- Docker + Docker Compose
- 一个 **OpenAI 兼容** 的 LLM 端点（建议用能力较强的模型，规划环节对结构化 JSON 输出要求较高）
- 高德开放平台的两类 Key（见下）
- （可选）小红书登录 Cookie —— 用于抓取景点与实拍图

### 2. 配置
复制 `.env.example` 为 `.env` 并填写（也可在网页右上角 ⚙️ 设置里运行时配置，无需重建）：

```bash
cp .env.example .env
```

| 配置项 | 说明 |
|---|---|
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | LLM 端点与模型 |
| `AMAP_MAPS_API_KEY` | 高德 **Web 服务** 类型 Key（后端地理编码/天气/酒店用）|
| 高德地图 **JS Key** + **安全密钥(JSCode)** | 高德 **Web端(JS API)** 类型，前端渲染地图用（设置页可运行时配置）|
| `GOOGLE_MAPS_API_KEY` | 可选，填写后优先用 Google Maps |
| `XHS_COOKIE` | 小红书登录 Cookie（`a1=…; web_session=…; webId=…`，或浏览器导出的 JSON 数组）|

> **关于高德的两把 Key：** JS Key 与 Web 服务 Key 是**不同平台类型、互不通用**。JS Key 负责前端画地图（需配对「安全密钥」），Web 服务 Key 负责后端 REST（地理编码/天气/POI）。填错类型会报 `INVALID_USER_KEY`。

### 3. 启动

```bash
docker-compose up -d --build
```

- 前端：`http://<host>:7860`
- API 文档：`http://<host>:8000/docs`

## 使用小贴士

- **景点图片**：来自小红书，Cookie 会**定期失效**（日志出现 `code=-101 无登录信息`）。失效时页面会自动显示统一的**暖色占位图**而非破图；到设置里更新 Cookie 即可恢复实拍图。
- **地图空白**：多为高德 **JS Key 或安全密钥** 未配对；在设置里补全「JS Key + 安全密钥」。
- **规划失败「响应中未找到 JSON」**：多为所用模型过弱、不遵守 JSON 格式；换更强的模型即可。
- 部署在国内服务器时，`three.js`/`echarts` 等已被移除、静态资源开启 gzip，首屏更快。

## 目录结构

```
TripStar/
├── backend/            FastAPI 多智能体后端
│   └── app/
│       ├── agents/     规划/景点/天气/酒店/图谱 智能体
│       ├── services/   小红书、高德、图片代理等服务
│       └── api/        路由（trip / poi / settings …）
├── frontend/           Vue3 前端
│   └── src/
│       ├── views/      Landing（首页）· Result（结果页）
│       └── components/ OverviewOrrery（星盘）· KnowledgeGraph（关系星盘）·
│                        TravelBuddy（星星小鸭）· NavBar · AIChat …
├── docker-compose.yaml
└── Dockerfile
```

## 致谢与许可

- 本项目在开源社区版本基础上进行了完整的 UI 重设计与工程优化。
- 星盘、关系星盘、星星小鸭等视觉元素均为本项目原创设计。
- 许可证：见 [LICENSE](./LICENSE)。

<div align="center">

—— *The Journal of Elsewhere · 每一段旅程，都是一副待点亮的星座* ✦

</div>
