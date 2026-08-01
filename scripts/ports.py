# -*- coding: utf-8 -*-
"""Loc Gallery Vue 端口规划（与源项目 F:\\Loc-Gallery :3456 隔离）。"""

# 源项目（只读对照，不修改）
SOURCE_PORT = 3456

# 本项目生产模式（restart.py，后端托管 dist）
PRODUCTION_PORT = 3460

# 开发模式
DEV_FRONTEND_PORT = 3457  # Vite
DEV_BACKEND_PORT = 3458   # FastAPI only

PRODUCTION_URL = f"http://127.0.0.1:{PRODUCTION_PORT}"
SOURCE_URL = f"http://127.0.0.1:{SOURCE_PORT}"
