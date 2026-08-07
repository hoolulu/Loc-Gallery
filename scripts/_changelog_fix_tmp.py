import io, re

p = r"F:\Loc-Gallery\CHANGELOG.md"
s = io.open(p, encoding="utf-8").read()

# 1) 删除重复的 12.0.0 区块（第二个，即第一次出现的第二个）
i_first_12 = s.find("## [12.0.0]")
i_second_12 = s.find("## [12.0.0]", i_first_12 + 1)
i_11_01 = s.find("## [11.0.1]")
assert -1 not in (i_first_12, i_second_12, i_11_01), "markers not found"
# 删除第二个 12.0.0 区块：从 i_second_12 到 i_11_01
s = s[:i_second_12] + s[i_11_01:]

# 2) 删除重复的 11.0.1 区块（第二个）
i_first_1101 = s.find("## [11.0.1]")
i_second_1101 = s.find("## [11.0.1]", i_first_1101 + 1)
i_1100 = s.find("## [11.0.0]")
assert -1 not in (i_first_1101, i_second_1101, i_1100), "11.0.1 markers not found"
s = s[:i_second_1101] + s[i_1100:]

# 3) 在保留的 12.0.0 区块「修复」段补充悬停预览后续变更
addition = """- **悬停预览比例自适应**：预览区按原视频真实宽高比显示（竖屏/超宽屏不再被压成 16:9），浮层宽度跟随视频宽度收缩、无黑边；视频 `object-fit: contain` 完整显示不裁切
- **预览区等视频比例就绪后才渲染**：竖屏视频首现即竖屏，彻底消除「横屏占位 → 竖屏」的跳变；加载背景配色改为暖灰（深色模式 `#6e6a5e`，亮度贴近视频平均亮度与肤色色温），淡入视频过渡自然
- **浮层一次定位不跳变**：浮层在视频比例就绪前挂起（不可见），就绪后以最终尺寸一次性定位——靠边视频不再闪现不完整浮层、不再位置跳动
- **卡片间切换黑屏系列修复**：每次预览新建独立 `<video>` 元素（消除复用残留）、事件回调校验当前活动元素（杜绝旧元素延迟事件误触发）、video 挂载到浮层后才开始加载/播放（未挂载播放无画面输出）、显示时机等浏览器实际渲染首帧（`requestVideoFrameCallback`）、`stopNow` 不再误杀新预览的启动定时器、`previewFailed` 状态防异步污染——「卡片间直接移动必黑屏」彻底解决
"""

anchor = "- 悬停预览过渡优化：220ms 淡入 → 500ms 长淡入；移除「首段对齐缩略图截帧位置」方案（缩略图截帧位置不可靠）"
assert anchor in s, "anchor not found"
s = s.replace(anchor, anchor + "\n" + addition, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("CHANGELOG fixed, lines:", s.count("\n") + 1)
