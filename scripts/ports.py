# -*- coding: utf-8 -*-
"""Loc Gallery Vue 端口（对外仅一个）。"""

# 浏览器只访问这个地址
APP_PORT = 3460
APP_URL = f"http://127.0.0.1:{APP_PORT}"

# 后端 API 仅本机内部，由 Vite 代理 /api，用户无需直接访问
API_PORT = 3461
API_URL = f"http://127.0.0.1:{API_PORT}"

# 兼容旧脚本别名
PRODUCTION_PORT = APP_PORT
PRODUCTION_URL = APP_URL
DEV_FRONTEND_PORT = APP_PORT
DEV_BACKEND_PORT = API_PORT
SOURCE_PORT = 3456
SOURCE_URL = f"http://127.0.0.1:{SOURCE_PORT}"
