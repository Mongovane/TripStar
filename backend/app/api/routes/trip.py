"""旅行规划 API 路由 - WebSocket 同步 + 轮询兼容模式"""

import asyncio
import json
import os
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError

from ...agents.trip_planner_agent import get_trip_planner_agent
from ...models.schemas import TripPlan, TripPlanResponse, TripRequest
from ...services.knowledge_graph_service import build_knowledge_graph
from ..admin_auth import is_admin

router = APIRouter(prefix="/trip", tags=["旅行规划"])

# 内存任务存储（单实例部署足够）
_tasks: Dict[str, Dict[str, Any]] = {}
# 正在执行的规划协程，用于"取消生成"
_running: Dict[str, "asyncio.Task[Any]"] = {}
_FINAL_TASK_STATUS = {"completed", "failed"}
# 早期版本生成的行程没有记录创建者；默认不在任何人的历史里显示（避免互相看到）。
# 单人自用部署如需找回，可设置 HISTORY_INCLUDE_LEGACY=true。
_INCLUDE_LEGACY_HISTORY = os.getenv("HISTORY_INCLUDE_LEGACY", "false").lower() == "true"
_TASKS_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "trip_tasks"


def _create_task_state(task_id: str) -> Dict[str, Any]:
    """初始化任务状态。"""
    return {
        "task_id": task_id,
        "plan_id": task_id,
        "status": "processing",
        "stage": "submitted",
        "progress": 0,
        "message": "任务已提交，等待执行...",
        "result": None,
        "error": None,
        "request_payload": None,
        "title": "",
        "hidden": False,
        "subscribers": [],  # list[asyncio.Queue]
    }


def _serialize_result(result: Any) -> Any:
    if result is None:
        return None
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    return result


def _task_file_path(task_id: str) -> Path:
    """获取任务持久化文件路径。"""
    return _TASKS_DATA_DIR / f"{task_id}.json"


def _normalize_loaded_task(task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """将磁盘中的任务结构恢复为内存可用格式。"""
    task = _create_task_state(task_id)
    task.update(
        {
            "plan_id": payload.get("plan_id", task_id),
            "status": payload.get("status", "failed"),
            "stage": payload.get("stage", "failed"),
            "progress": payload.get("progress", 100),
            "message": payload.get("message", ""),
            "result": payload.get("result"),
            "error": payload.get("error"),
            "request_payload": payload.get("request_payload"),
            "title": payload.get("title") or "",
            "hidden": bool(payload.get("hidden")),
        }
    )
    task["subscribers"] = []

    # 服务重启后，处理中任务无法恢复执行，直接标记为失败，避免前端无限等待。
    if task["status"] not in _FINAL_TASK_STATUS:
        task["status"] = "failed"
        task["stage"] = "failed"
        task["progress"] = 100
        task["error"] = "服务已重启，未完成的旅行规划任务无法恢复，请重新生成。"
        task["message"] = task["error"]

    return task


def _persist_task_state(task_id: str, task: Dict[str, Any]) -> None:
    """将任务状态持久化到本地 JSON 文件。"""
    try:
        _TASKS_DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "task_id": task_id,
            "plan_id": task.get("plan_id", task_id),
            "status": task.get("status", "processing"),
            "stage": task.get("stage", ""),
            "progress": task.get("progress", 0),
            "message": task.get("message", ""),
            "result": _serialize_result(task.get("result")),
            "error": task.get("error"),
            "request_payload": task.get("request_payload"),
            "title": task.get("title") or "",
            "hidden": bool(task.get("hidden")),
        }
        target = _task_file_path(task_id)
        tmp = target.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp.replace(target)
    except Exception as e:
        print(f"⚠️  持久化任务 {task_id} 失败: {e}")


def _load_task_from_disk(task_id: str) -> Dict[str, Any] | None:
    """从磁盘加载单个任务。"""
    path = _task_file_path(task_id)
    if not path.exists():
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict):
            return None
        task = _normalize_loaded_task(task_id, payload)
        _tasks[task_id] = task
        return task
    except Exception as e:
        print(f"⚠️  读取任务 {task_id} 失败: {e}")
        return None


def _load_persisted_tasks() -> None:
    """服务启动时预加载历史任务。"""
    if not _TASKS_DATA_DIR.exists():
        return

    loaded = 0
    for path in sorted(_TASKS_DATA_DIR.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                continue
            task_id = str(payload.get("task_id") or path.stem)
            _tasks[task_id] = _normalize_loaded_task(task_id, payload)
            loaded += 1
        except Exception as e:
            print(f"⚠️  加载历史任务 {path.name} 失败: {e}")

    if loaded:
        print(f"📦 已加载 {loaded} 个持久化旅行任务")


def _get_task(task_id: str) -> Dict[str, Any] | None:
    """优先从内存读取任务，不存在时回退到磁盘。"""
    return _tasks.get(task_id) or _load_task_from_disk(task_id)


def _task_owner(task_or_payload: Dict[str, Any]) -> str:
    """任务的创建者（前端生成的匿名 user_id）；旧任务没有记录时为空串。"""
    return str((task_or_payload.get("request_payload") or {}).get("user_id") or "").strip()


def _require_owner(task: Dict[str, Any], user_id: str | None, admin_token: str | None = None) -> None:
    """有创建者记录的行程，只允许创建者（或持有管理口令的管理员）修改；旧任务（无记录）保持兼容。"""
    if is_admin(admin_token):
        return
    owner = _task_owner(task)
    if owner and owner != (user_id or "").strip():
        raise HTTPException(status_code=403, detail="只能修改自己创建的行程")


def _build_history_item(task_id: str, payload: Dict[str, Any], updated_at: str) -> Dict[str, Any] | None:
    """从持久化任务中提取首页历史列表所需的摘要。"""
    if payload.get("status") != "completed" or payload.get("hidden"):
        return None

    result = payload.get("result") or {}
    plan = result.get("data") or {}
    request_payload = payload.get("request_payload") or {}

    city = plan.get("city") or request_payload.get("city") or ""
    cities = plan.get("cities") or []
    start_date = plan.get("start_date") or request_payload.get("start_date") or ""
    end_date = plan.get("end_date") or request_payload.get("end_date") or ""
    days = plan.get("days") or []
    travel_days = request_payload.get("travel_days") or (len(days) if isinstance(days, list) else 0)
    overall_suggestions = plan.get("overall_suggestions") or result.get("message") or ""

    if not city and not cities:
        return None

    # 多城市时 city 显示为 "北京 → 西安" 形式
    display_city = ' → '.join(cities) if len(cities) > 1 else city

    return {
        "plan_id": payload.get("plan_id", task_id),
        "task_id": task_id,
        "city": display_city,
        "cities": cities,
        "start_date": start_date,
        "end_date": end_date,
        "travel_days": travel_days,
        "updated_at": updated_at,
        "overall_suggestions": overall_suggestions,
        "title": payload.get("title") or "",
        "owner": _task_owner(payload),
    }


def _load_history_items(limit: int = 10, user_id: str = "", admin: bool = False) -> list[Dict[str, Any]]:
    """按最近更新时间返回已完成的历史计划摘要。"""
    if not _TASKS_DATA_DIR.exists():
        return []

    items: list[Dict[str, Any]] = []
    for path in sorted(_TASKS_DATA_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                continue
            # 历史记录按用户隔离：只返回当前访客自己创建的行程
            owner = _task_owner(payload)
            # 管理员看全部；普通访客只看自己的（可选再加上无创建者记录的旧行程）
            if not admin and owner != user_id and not (not owner and _INCLUDE_LEGACY_HISTORY):
                continue
            updated_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
            item = _build_history_item(str(payload.get("task_id") or path.stem), payload, updated_at)
            if item:
                # 不把他人的 user_id 暴露给前端，只告诉它这条是否属于当前访客
                item["mine"] = bool(owner) and owner == user_id
                item["legacy"] = not owner
                item.pop("owner", None)
                items.append(item)
            if len(items) >= limit:
                break
        except Exception as e:
            print(f"⚠️  读取历史任务 {path.name} 失败: {e}")

    return items


def _build_task_event(task_id: str, task: Dict[str, Any], include_result: bool = True) -> Dict[str, Any]:
    """从任务状态构建对前端可消费的事件对象。"""
    event = {
        "task_id": task_id,
        "plan_id": task.get("plan_id", task_id),
        "status": task.get("status", "processing"),
        "stage": task.get("stage", ""),
        "progress": task.get("progress", 0),
        "message": task.get("message", ""),
    }
    if task.get("error"):
        event["error"] = task["error"]
    if task.get("status") == "failed" and task.get("request_payload") is not None:
        event["request_payload"] = task["request_payload"]
    if include_result and task.get("result") is not None:
        event["result"] = _serialize_result(task["result"])
    return event


def _broadcast_task_event(task_id: str, event: Dict[str, Any]) -> None:
    """将任务事件广播给当前所有 WebSocket 订阅者。"""
    task = _tasks.get(task_id)
    if not task:
        return

    dead_queues = []
    for queue in task.get("subscribers", []):
        try:
            queue.put_nowait(event)
        except Exception:
            dead_queues.append(queue)

    if dead_queues:
        task["subscribers"] = [q for q in task.get("subscribers", []) if q not in dead_queues]


async def _update_task_state(
    task_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    progress: int | None = None,
    message: str | None = None,
    result: Any = None,
    error: str | None = None,
) -> None:
    """更新任务状态并广播事件。"""
    task = _tasks.get(task_id)
    if not task:
        return

    if status is not None:
        task["status"] = status
    if stage is not None:
        task["stage"] = stage
    if progress is not None:
        task["progress"] = progress
    if message is not None:
        task["message"] = message
    if result is not None:
        task["result"] = result
    if error is not None:
        task["error"] = error

    _persist_task_state(task_id, task)
    event = _build_task_event(task_id, task, include_result=True)
    _broadcast_task_event(task_id, event)


@router.post(
    "/plan",
    summary="提交旅行规划任务",
    description="异步提交旅行规划请求，立即返回 task_id；可通过 WebSocket 或 /trip/status/{task_id} 获取执行状态",
)
async def plan_trip(request: TripRequest):
    """提交旅行规划任务（立即返回 task_id）。"""
    task_id = str(uuid.uuid4())[:8]
    _tasks[task_id] = _create_task_state(task_id)
    _tasks[task_id]["request_payload"] = request.model_dump(mode="json")
    _persist_task_state(task_id, _tasks[task_id])

    _city_display = ' → '.join(cs.city for cs in request.cities) if request.cities else request.city
    print(f"\n{'=' * 60}")
    print(f"📥 收到旅行规划请求 (task_id={task_id}):")
    print(f"   城市: {_city_display}")
    print(f"   日期: {request.start_date} - {request.end_date}")
    print(f"   天数: {request.travel_days}")
    print(f"{'=' * 60}\n")

    await _update_task_state(
        task_id,
        status="processing",
        stage="submitted",
        progress=5,
        message="任务已提交，正在初始化流程...",
    )

    # 启动后台任务
    _running[task_id] = asyncio.create_task(_run_trip_planning(task_id, request))

    return {
        "task_id": task_id,
        "plan_id": task_id,
        "status": "processing",
        "ws_url": f"/api/trip/ws/{task_id}",
        "message": f"任务已提交，可通过 WebSocket /api/trip/ws/{task_id} 实时订阅状态",
    }


async def _save_preferences_after_trip(user_id: str, request: TripRequest, trip_plan) -> None:
    """行程生成成功后，异步提取用户偏好并写入记忆库（失败不影响主流程）"""
    try:
        from ...memory import MemoryManager, PreferenceExtractor

        user_query = (
            f"城市: {request.city}; "
            f"偏好: {', '.join(request.preferences) if request.preferences else '无'}; "
            f"额外要求: {request.free_text_input or '无'}"
        )
        if hasattr(trip_plan, "model_dump"):
            trip_content = json.dumps(trip_plan.model_dump(mode="json"), ensure_ascii=False)
        else:
            trip_content = str(trip_plan)

        extractor = PreferenceExtractor()
        prefs = await extractor.extract_preferences(user_query, trip_content)
        mm = MemoryManager.get_instance()
        for content, score in prefs:
            await mm.add_memory(user_id, content, source="implicit", init_weight=score)
        print(f"🧠 用户 {user_id[:8]} 偏好记忆已更新，新增/合并 {len(prefs)} 条")
    except Exception as e:
        print(f"⚠️  偏好记忆提取失败: {e}")


async def _run_trip_planning(task_id: str, request: TripRequest):
    """后台执行旅行规划并推送进度。"""
    try:
        await _update_task_state(
            task_id,
            status="processing",
            stage="initializing",
            progress=10,
            message="正在获取多智能体系统实例...",
        )
        agent = get_trip_planner_agent()

        async def progress_callback(stage: str, message: str, progress: int) -> None:
            await _update_task_state(
                task_id,
                status="processing",
                stage=stage,
                progress=progress,
                message=message,
            )

        trip_plan = await agent.plan_trip(request, progress_callback=progress_callback)

        # 记录预算口径，结果页据此显示人均与预算上限
        try:
            trip_plan.travelers = request.travelers or 1
            trip_plan.budget_limit = request.budget_limit
        except Exception:
            pass

        # 异步提取用户偏好到记忆库（不阻塞主流程）
        _user_id = (getattr(request, "user_id", "") or "").strip()
        if _user_id and os.getenv("ENABLE_USER_MEMORY", "false").lower() == "true":
            asyncio.create_task(_save_preferences_after_trip(_user_id, request, trip_plan))

        await _update_task_state(
            task_id,
            status="processing",
            stage="graph_building",
            progress=95,
            message="正在构建知识图谱...",
        )
        graph_data = build_knowledge_graph(trip_plan, language=getattr(request, 'language', 'zh') or 'zh')

        trip_result = TripPlanResponse(
            success=True,
            message="旅行计划生成成功",
            plan_id=task_id,
            data=trip_plan,
            graph_data=graph_data,
        )

        print(f"✅ 任务 {task_id} 完成")
        await _update_task_state(
            task_id,
            status="completed",
            stage="completed",
            progress=100,
            message="旅行计划生成成功",
            result=trip_result,
        )

    except asyncio.CancelledError:
        print(f"🛑 任务 {task_id} 已被用户取消")
        await _update_task_state(
            task_id,
            status="failed",
            stage="failed",
            progress=100,
            message="已取消生成",
            error="已取消生成",
        )
    except Exception as e:
        print(f"❌ 任务 {task_id} 失败: {e}")
        traceback.print_exc()

        # 针对小红书 Cookie 过期异常做出特殊处理返回给前端
        try:
            from ...services.xhs_service import XHSCookieExpiredError

            if isinstance(e, XHSCookieExpiredError):
                error_msg = f"【认证失败】{str(e)}"
            else:
                error_msg = str(e)
        except ImportError:
            error_msg = str(e)

        await _update_task_state(
            task_id,
            status="failed",
            stage="failed",
            progress=100,
            message=error_msg,
            error=error_msg,
        )
    finally:
        _running.pop(task_id, None)


@router.websocket("/ws/{task_id}")
async def trip_task_ws(websocket: WebSocket, task_id: str):
    """WebSocket 订阅任务状态。"""
    await websocket.accept()
    task = _get_task(task_id)
    if not task:
        await websocket.send_json(
            {
                "task_id": task_id,
                "plan_id": task_id,
                "status": "failed",
                "stage": "failed",
                "progress": 100,
                "message": "任务不存在",
                "error": "任务不存在",
            }
        )
        await websocket.close(code=1008)
        return

    queue: asyncio.Queue = asyncio.Queue()
    task["subscribers"].append(queue)

    # 先发送快照，保证前端后连也能同步当前状态
    snapshot = _build_task_event(task_id, task, include_result=True)
    await websocket.send_json(snapshot)
    if snapshot["status"] in _FINAL_TASK_STATUS:
        try:
            await websocket.close()
        except Exception:
            pass
        task["subscribers"] = [q for q in task.get("subscribers", []) if q is not queue]
        return

    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event.get("status") in _FINAL_TASK_STATUS:
                break
    except WebSocketDisconnect:
        pass
    finally:
        task = _tasks.get(task_id)
        if task:
            task["subscribers"] = [q for q in task.get("subscribers", []) if q is not queue]
        try:
            await websocket.close()
        except Exception:
            pass


class TripPlanUpdatePayload(BaseModel):
    """结果页保存修改时提交的完整行程。"""

    data: Dict[str, Any] = Field(..., description="修改后的 TripPlan")
    user_id: str = Field(default="", description="当前访客的匿名 user_id，用于校验是否为创建者")


@router.put(
    "/plan/{plan_id}",
    summary="保存行程修改",
    description="用户在结果页编辑行程后，将修改写回持久化存储，使历史记录、新标签页和分享链接都能看到最新版本",
)
async def update_trip_plan(plan_id: str, payload: TripPlanUpdatePayload, x_admin_token: Optional[str] = Header(default=None)):
    task = _get_task(plan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="行程不存在")
    if task.get("status") != "completed":
        raise HTTPException(status_code=409, detail="行程尚未生成完成，暂时不能保存修改")
    _require_owner(task, payload.user_id, x_admin_token)

    try:
        plan = TripPlan.model_validate(payload.data)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"行程数据格式不正确: {e.errors()[:3]}") from e

    result = _serialize_result(task.get("result")) or {}
    result["data"] = plan.model_dump(mode="json")
    result["plan_id"] = plan_id
    request_payload = task.get("request_payload") or {}
    try:
        result["graph_data"] = _serialize_result(
            build_knowledge_graph(plan, language=request_payload.get("language") or "zh")
        )
    except Exception as e:  # 图谱失败不影响保存
        print(f"⚠️  重建知识图谱失败: {e}")

    task["result"] = result
    _persist_task_state(plan_id, task)
    return {
        "success": True,
        "message": "行程已保存",
        "plan_id": plan_id,
        "updated_at": datetime.now().isoformat(),
    }


class TripPlanMetaPayload(BaseModel):
    user_id: str = Field(default="")
    title: str = Field(default="", max_length=60, description="历史记录里显示的名称，留空则显示城市名")


@router.patch("/plan/{plan_id}", summary="重命名历史行程")
async def rename_trip_plan(plan_id: str, payload: TripPlanMetaPayload, x_admin_token: Optional[str] = Header(default=None)):
    task = _get_task(plan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="行程不存在")
    _require_owner(task, payload.user_id, x_admin_token)
    task["title"] = payload.title.strip()
    _persist_task_state(plan_id, task)
    return {"success": True, "plan_id": plan_id, "title": task["title"]}


@router.delete("/plan/{plan_id}", summary="从历史记录中移除行程")
async def delete_trip_plan(plan_id: str, user_id: str = "", x_admin_token: Optional[str] = Header(default=None)):
    """软删除：只在历史列表中隐藏，数据文件保留，便于误删后由管理员恢复。"""
    task = _get_task(plan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="行程不存在")
    _require_owner(task, user_id, x_admin_token)
    task["hidden"] = True
    _persist_task_state(plan_id, task)
    return {"success": True, "plan_id": plan_id}


@router.post("/cancel/{task_id}", summary="取消正在生成的行程")
async def cancel_trip_plan(task_id: str, user_id: str = "", x_admin_token: Optional[str] = Header(default=None)):
    task = _get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    _require_owner(task, user_id, x_admin_token)
    if task.get("status") in _FINAL_TASK_STATUS:
        return {"success": True, "status": task.get("status")}
    running = _running.get(task_id)
    if running and not running.done():
        running.cancel()
    else:
        await _update_task_state(task_id, status="failed", stage="failed", progress=100,
                                 message="已取消生成", error="已取消生成")
    return {"success": True, "status": "cancelling"}


@router.get(
    "/history",
    summary="最近历史计划",
    description="返回最近成功生成的旅行计划摘要，供首页快速找回历史计划",
)
async def get_trip_history(limit: int = 10, user_id: str = "", x_admin_token: Optional[str] = Header(default=None)):
    """查询历史计划摘要：普通访客按 user_id 隔离；持有管理口令时返回全部（管理员视图）。"""
    safe_limit = max(1, min(int(limit or 10), 50))
    uid = (user_id or "").strip()
    admin = is_admin(x_admin_token)
    if not uid and not admin:
        return {"items": [], "admin": False}
    return {
        "items": _load_history_items(safe_limit, uid, admin=admin),
        "admin": admin,
    }


@router.get(
    "/status/{task_id}",
    summary="查询任务状态",
    description="轮询旅行规划任务的执行状态和结果（兼容旧客户端）",
)
async def get_task_status(task_id: str):
    """查询任务执行状态。"""
    task = _get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    if task["status"] == "completed":
        return {
            "task_id": task_id,
            "plan_id": task.get("plan_id", task_id),
            "status": "completed",
            "result": _serialize_result(task.get("result")),
        }
    if task["status"] == "failed":
        return {
            "task_id": task_id,
            "plan_id": task.get("plan_id", task_id),
            "status": "failed",
            "error": task.get("error", ""),
            "request_payload": task.get("request_payload"),
        }
    return {
        "task_id": task_id,
        "plan_id": task.get("plan_id", task_id),
        "status": "processing",
        "stage": task.get("stage", ""),
        "progress": task.get("progress", 0),
        "progress_text": task.get("message", "处理中..."),
    }


@router.get(
    "/health",
    summary="健康检查",
    description="检查旅行规划服务是否正常",
)
async def health_check():
    """健康检查。"""
    try:
        agent = get_trip_planner_agent()
        return {
            "status": "healthy",
            "service": "trip-planner",
            "agent_name": agent.planner_agent.name,
            "tools_count": len(agent.weather_agent.list_tools()) + len(agent.hotel_agent.list_tools()),
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"服务不可用: {str(e)}")


_load_persisted_tasks()
