"""POI相关API路由"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from ...services.amap_service import get_amap_service

router = APIRouter(prefix="/poi", tags=["POI"])


class POIDetailResponse(BaseModel):
    """POI详情响应"""
    success: bool
    message: str
    data: Optional[dict] = None


@router.get(
    "/detail/{poi_id}",
    response_model=POIDetailResponse,
    summary="获取POI详情",
    description="根据POI ID获取详细信息,包括图片"
)
async def get_poi_detail(poi_id: str):
    """
    获取POI详情
    
    Args:
        poi_id: POI ID
        
    Returns:
        POI详情响应
    """
    try:
        amap_service = get_amap_service()
        
        # 调用高德地图POI详情API
        result = amap_service.get_poi_detail(poi_id)
        
        return POIDetailResponse(
            success=True,
            message="获取POI详情成功",
            data=result
        )
        
    except Exception as e:
        print(f"❌ 获取POI详情失败: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"获取POI详情失败: {str(e)}"
        )


@router.get(
    "/search",
    summary="搜索POI",
    description="根据关键词搜索POI"
)
async def search_poi(keywords: str, city: str = "北京"):
    """
    搜索POI

    Args:
        keywords: 搜索关键词
        city: 城市名称

    Returns:
        搜索结果
    """
    try:
        amap_service = get_amap_service()
        result = amap_service.search_poi(keywords, city)

        return {
            "success": True,
            "message": "搜索成功",
            "data": result
        }

    except Exception as e:
        print(f"❌ 搜索POI失败: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"搜索POI失败: {str(e)}"
        )


@router.get(
    "/image",
    summary="代理获取小红书图片",
    description="按景点名从缓存取图（miss 自动重搜新直链并立即下载），或代理白名单内的小红书稳定直链，规避 CDN 防盗链与时效签名（issue #28）"
)
async def proxy_attraction_image(name: Optional[str] = None, url: Optional[str] = None):
    """
    代理小红书图片，二选一传参：

    - name: 景点名。优先读关键词磁盘缓存；miss 时自动重搜新直链并立即下载
      （搜索返回的直链约 1 分钟即失效，浏览器直接引用必然 403）。
    - url: 小红书稳定格式图片直链（仅限 *.xiaohongshu.com / *.xhscdn.com），
      用于代理行程数据中内嵌的直链。
    """
    from fastapi.responses import Response
    from ...services.xhs_service import (
        XHSImageProxyError,
        fetch_xhs_image_bytes,
        get_photo_bytes_from_xhs,
    )

    def _placeholder(label: str = "") -> Response:
        """取图失败/Cookie 过期时的统一暖色占位图（与卡片深青星图一致），避免破图。"""
        import html as _html
        safe = _html.escape((label or "").strip())[:14]
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#1f4450"/><stop offset="1" stop-color="#14232a"/>'
            '</linearGradient></defs>'
            '<rect width="400" height="300" fill="url(#g)"/>'
            '<path d="M200 116l7 19 20 .6-15.8 12.4 5.6 19.4L200 176l-16.4 11.4 5.6-19.4L173.2 155.6l20-.6z" '
            'fill="#D9A441" opacity=".85"/>'
            + (f'<text x="200" y="212" fill="#EBCB85" font-family="Georgia,serif" font-size="19" '
               f'text-anchor="middle">{safe}</text>' if safe else '')
            + '<text x="200" y="238" fill="rgba(234,224,203,.55)" font-family="monospace" '
              'font-size="11" letter-spacing="1" text-anchor="middle">暂无实拍图</text>'
            '</svg>'
        )
        return Response(
            content=svg.encode("utf-8"),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=600", "X-Image-Status": "fallback"},
        )

    def _google_place_photo(place_name: str):
        """若配置了 Google Maps Key，则用 Google Places 取实拍图（海外/整体更可靠）。返回 (bytes, content_type) 或 None。"""
        try:
            from ...config import settings
        except Exception:
            return None
        key = getattr(settings, "google_maps_api_key", "") or ""
        if not key:
            return None
        try:
            import requests
            proxies = None
            proxy = getattr(settings, "google_maps_proxy", "") or ""
            if proxy:
                proxies = {"http": proxy, "https": proxy}
            # 1) 文本搜索找地点
            r = requests.get(
                "https://maps.googleapis.com/maps/api/place/textsearch/json",
                params={"query": place_name, "key": key, "language": "zh-CN"},
                proxies=proxies, timeout=8,
            )
            results = (r.json() or {}).get("results") or []
            if not results:
                return None
            photos = results[0].get("photos") or []
            if not photos:
                return None
            ref = photos[0].get("photo_reference")
            if not ref:
                return None
            # 2) 取照片
            pr = requests.get(
                "https://maps.googleapis.com/maps/api/place/photo",
                params={"maxwidth": 720, "photo_reference": ref, "key": key},
                proxies=proxies, timeout=10, allow_redirects=True,
            )
            ct = pr.headers.get("Content-Type", "")
            if pr.status_code == 200 and pr.content and ct.startswith("image"):
                return pr.content, ct
        except Exception as e:
            print(f"⚠️ Google Places 取图失败: {place_name} - {e}")
        return None

    if name:
        # 优先 Google Places（配置了 Key 时更可靠，海外景点也有图）
        g = _google_place_photo(name)
        if g is not None:
            data, content_type = g
            return Response(
                content=data,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400", "X-Image-Source": "google"},
            )
        try:
            result = await get_photo_bytes_from_xhs(f"{name} 风景")
        except Exception as e:
            print(f"⚠️ 景点图获取失败（占位兜底）: {name} - {e}")
            result = None
        if result is None:
            return _placeholder(name)
        data, content_type = result
        return Response(
            content=data,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )

    if url:
        try:
            data, content_type = fetch_xhs_image_bytes(url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            print(f"⚠️ 图片代理失败（占位兜底）: {e}")
            return _placeholder()
        return Response(
            content=data,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )

    raise HTTPException(status_code=400, detail="必须提供 name 或 url 查询参数")


@router.get(
    "/photo",
    summary="获取景点图片",
    description="根据景点名称从小红书获取图片"
)
async def get_attraction_photo(name: str, city: Optional[str] = None):
    """
    获取景点图片

    Args:
        name: 景点名称
        city: 所在城市

    Returns:
        图片URL
    """
    try:
        from ...services.xhs_service import get_photo_from_xhs
        
        # 为了避免同名的流行歌曲（如许嵩的《断桥残雪》）、小说或人名干扰
        # 强制带上前缀“景点”，能够绝对限定搜索范围在旅游打卡贴内
        query_kw = f"{name} 风景"
        photo_url = await get_photo_from_xhs(query_kw)

        if not photo_url:
            # 兜底：交由前端展示默认占位图
            print(f"⚠️ 无法为 {name} 找到对应的小红书景点图片，返回空")
            photo_url = ""
            
        return {
            "success": True,
            "message": "获取图片成功",
            "data": {
                "name": name,
                "photo_url": photo_url
            }
        }

    except Exception as e:
        print(f"❌ 获取景点图片失败: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"获取景点图片失败: {str(e)}"
        )

