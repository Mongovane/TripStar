"""管理口令校验（环境变量 ADMIN_TOKEN）。

- 未配置 ADMIN_TOKEN：没有"管理员"概念，is_admin 恒为 False，require_admin 放行（保持自用部署的原行为）。
- 已配置：请求头 X-Admin-Token 与之匹配才视为管理员。
"""

import hmac
import os
from typing import Optional

from fastapi import HTTPException


def admin_token_configured() -> bool:
    return bool(os.getenv("ADMIN_TOKEN", "").strip())


def is_admin(token: Optional[str]) -> bool:
    expected = os.getenv("ADMIN_TOKEN", "").strip()
    if not expected or not token:
        return False
    return hmac.compare_digest(token.strip(), expected)


def require_admin(token: Optional[str]) -> None:
    """修改设置用：配置了口令时必须匹配。"""
    if not admin_token_configured():
        return
    if not is_admin(token):
        raise HTTPException(status_code=401, detail="需要正确的管理口令才能修改设置")
