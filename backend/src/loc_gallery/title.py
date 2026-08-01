# -*- coding: utf-8 -*-
import re
from pathlib import Path

# 匹配 ABC-123、XYZ-540 等编号（有 - 的番号分支，勿改）
_CODE_PATTERN = re.compile(r"[A-Za-z0-9]+-\d+")

# 文件名无括号时的最大字数
_TITLE_NO_CODE_MAX = 14

# 常见电影名里的 (1992) / （2021） 等
_YEAR_PAREN = re.compile(r"[\(（](?:19|20)\d{2}[\)）]")


def _title_without_code(name: str) -> str:
    """无 XXX-NNN 时：有括号则截到年份右括号；否则按字数截取。"""
    name = name.strip()
    if not name:
        return name

    m = _YEAR_PAREN.search(name)
    if m:
        return name[: m.end()].strip()

    for open_ch, close_ch in (("(", ")"), ("（", "）")):
        close_idx = name.find(close_ch)
        if close_idx >= 0:
            return name[: close_idx + 1].strip()

    if len(name) <= _TITLE_NO_CODE_MAX:
        return name
    return name[:_TITLE_NO_CODE_MAX]


def extract_title(filepath: str | Path) -> str:
    """从文件名提取标题：优先匹配 XXX-NNN 格式，否则智能截取文件名。"""
    name = Path(filepath).stem
    match = _CODE_PATTERN.search(name)
    if match:
        return match.group(0).upper()
    return _title_without_code(name)
