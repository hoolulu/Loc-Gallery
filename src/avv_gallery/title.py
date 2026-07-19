# -*- coding: utf-8 -*-
import re
from pathlib import Path

# 匹配 ABC-123、XYZ-540 等编号
_CODE_PATTERN = re.compile(r"[A-Za-z0-9]+-\d+")


def extract_title(filepath: str | Path) -> str:
    """从文件名提取标题：优先匹配 XXX-NNN 格式，否则取前 8 个字符。"""
    name = Path(filepath).stem
    match = _CODE_PATTERN.search(name)
    if match:
        return match.group(0).upper()
    return name[:8]
