# 05 — API 对接映射

> 前端 API 模块与后端端点的完整映射表。  
> 所有 API 请求自动附加 `library_id` 查询参数（由 `api/client.ts` 处理）。

---

## 通用约定

- **Base URL**：`/api`
- **Content-Type**：`application/json`（POST/PATCH）
- **库上下文**：`?library_id={activeLibraryId}`
- **错误处理**：非 2xx 抛出 `ApiError(status, message)`

---

## 1. libraries.ts — 视频库管理

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `getLibraries()` | GET | `/libraries` | — | `{ active_library_id, items: Library[] }` |
| `createLibrary(alias, path)` | POST | `/libraries` | `{ alias, path }` | `{ ok, library, active_library_id }` |
| `updateLibrary(id, data)` | PATCH | `/libraries/{id}` | `{ alias?, path? }` | `{ ok, library }` |
| `deleteLibrary(id, deleteData?)` | DELETE | `/libraries/{id}` | `{ delete_data? }` | `{ ok, active_library_id }` |
| `activateLibrary(id)` | POST | `/libraries/{id}/activate` | — | `{ ok, library, active_library_id }` |
| `pickFolder()` | POST | `/libraries/pick-folder` | — | `{ ok, cancelled?, path? }` |

---

## 2. categories.ts — 分类管理

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `getCategories()` | GET | `/categories` | — | `{ items: Category[], sort_mode }` |
| `reorderCategories(order)` | POST | `/categories/reorder` | `{ order: string[] }` | `{ ok, items }` |
| `setCategorySortMode(mode)` | POST | `/categories/sort-mode` | `{ sort_mode }` | `{ ok, sort_mode, items }` |

---

## 3. folders.ts — 文件夹操作

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `getFolders(category)` | GET | `/folders?category={cat}` | — | 文件夹树 |
| `deleteFolder(data)` | POST | `/folders/delete` | `{ category, folder, type? }` | `{ ok, deleted, errors }` |
| `renameFolder(params)` | POST | `/folders/rename` | query: `category, old_path, new_name, type?` | `{ ok, renamed }` |
| `moveFolder(params)` | POST | `/folders/move` | query: `category, src_path, dest_path?, type?` | `{ ok, moved }` |

---

## 4. videos.ts — 视频列表与元数据

| 函数 | 方法 | 路径 | 查询参数 | 响应 |
|------|------|------|----------|------|
| `getVideos(params)` | GET | `/videos` | `category?, folder?, q?, sort?, seed?, page?, page_size?, favorites?, history?, album_id?, format?` | `{ items, total, page, pageSize, totalPages }` |

> **8.1.0**：`sort=random` 时需附加 `seed`（整数）实现确定性随机排序；种子由前端生成并持久化到 localStorage。
| `getVideo(id)` | GET | `/videos/{id}` | — | `Video` |
| `getPlayBadges(ids)` | GET | `/play/badges` | `ids`（逗号分隔） | `{ badges }` |
| `getDurations(ids)` | GET | `/durations` | `ids` | `{ durations }` |
| `getDurationStatus()` | GET | `/duration/status` | — | 时长探测状态 |
| `getFormatStatus()` | GET | `/format/status` | — | 格式索引状态 |
| `scanFormat()` | POST | `/format/scan` | — | `{ ok, queued }` |

---

## 5. favorites.ts — 收藏

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `toggleFavorite(id)` | POST | `/favorites/toggle` | `{ id }` | `{ ok, id, favorited, favoritedAt, count }` |
| `batchFavorites(ids, action)` | POST | `/favorites/batch` | `{ ids, action: "add"\|"remove" }` | `{ ok, added/removed, count }` |

---

## 6. history.ts — 播放历史

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `recordPlay(id)` | POST | `/history/record` | `{ id }` | `{ ok, id, played_at, play_count }` |
| `savePosition(id, pos, dur?)` | POST | `/history/position` | `{ id, position_sec, duration_sec? }` | `{ ok, id, position_sec }` |
| `clearHistory()` | POST | `/history/clear` | — | `{ ok, removed }` |

---

## 7. albums.ts — 专辑

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `getAlbums()` | GET | `/albums` | — | `{ items: Album[] }` |
| `createAlbum(name, desc?)` | POST | `/albums` | `{ name, description? }` | `{ ok, album }` |
| `getAlbum(id)` | GET | `/albums/{id}` | — | `Album + total_duration_sec` |
| `updateAlbum(id, data)` | PATCH | `/albums/{id}` | `{ name?, description?, cover_video_id? }` | `{ ok, album }` |
| `deleteAlbum(id)` | DELETE | `/albums/{id}` | — | `{ ok }` |
| `addVideosToAlbum(albumId, ids)` | POST | `/albums/{id}/videos` | `{ ids }` | `{ ok, album }` |
| `removeVideosFromAlbum(albumId, ids)` | POST | `/albums/{id}/videos/remove` | `{ ids }` | `{ ok, album }` |
| `setAlbumCover(albumId, videoId)` | POST | `/albums/{id}/cover` | `{ video_id }` | `{ ok, album }` |

---

## 8. thumbs.ts — 缩略图

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `getThumbStatus(params?)` | GET | `/thumb/status` | query: `category?, page_ids?` | 缩略图队列状态 |
| `getThumbFailed()` | GET | `/thumb/failed` | — | `{ items, total }` |
| `thumbUrl(id, version?)` | GET | `/thumb/{id}` | — | JPEG 图片 URL |
| `priorityThumbs(ids, autoSelect?)` | POST | `/thumb/priority` | `{ ids, auto_select? }` | `{ queued }` |
| `regenerateThumb(params)` | POST | `/thumb/regenerate` | `{ ids?, thumb_position?, thumb_random? }` | `{ regenerated, versions }` |
| `regenerateFailed()` | POST | `/thumb/regenerate-failed` | — | `{ regenerated, versions }` |
| `batchRegenerate(ids, autoSelect?)` | POST | `/thumb/batch-regenerate` | `{ ids, auto_select? }` | `{ regenerated, versions }` |
| `pauseThumbs()` | POST | `/thumb/pause` | — | `{ paused: true }` |
| `resumeThumbs()` | POST | `/thumb/resume` | — | `{ paused: false }` |
| `getCandidates(id, jitter?)` | POST | `/thumb/{id}/candidates` | query: `jitter?` | `{ ok, version, candidates[] }` |
| `pickCandidate(id, index)` | POST | `/thumb/{id}/pick` | `{ index }` | `{ ok, version }` |
| `candidateUrl(id, index)` | GET | `/thumb/{id}/candidate/{index}` | — | JPEG 图片 URL |

---

## 9. play.ts — 播放与流媒体

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `streamUrl(id)` | GET | `/stream/{id}` | — | 视频字节流 URL |
| `getPlayInfo(id)` | GET | `/play/info/{id}` | — | `PlayInfo` |
| `preparePlay(id)` | POST | `/play/prepare/{id}` | — | HLS 准备状态 |
| `getPlayStatus(id)` | GET | `/play/status/{id}` | — | 切片进度 |
| `stopPlay()` | POST | `/play/stop` | — | `{ ok, was_active }` |
| `pauseSlice()` | POST | `/play/pause` | — | `{ ok, paused }` |
| `resumeSlice()` | POST | `/play/resume` | — | `{ ok, resumed }` |
| `catchupSlice(id, position)` | POST | `/play/catchup/{id}` | `{ position_sec }` | catchup 结果 |
| `hlsUrl(id, filename)` | GET | `/hls/{id}/{filename}` | — | m3u8/ts URL |
| `playExternal(id)` | POST | `/play-external/{id}` | — | `{ ok, path }` |
| `openFolder(id)` | POST | `/open-folder/{id}` | — | `{ ok, folder }` |
| `startRemux(id)` | POST | `/videos/{id}/remux` | — | remux 状态 |
| `getRemuxStatus(id)` | GET | `/videos/{id}/remux` | — | remux 进度 |
| `beginBatchRemux()` | POST | `/remux/batch/begin` | — | `{ ok }` |
| `endBatchRemux()` | POST | `/remux/batch/end` | — | `{ ok }` |

---

## 10. files.ts — 文件操作

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `deleteVideos(ids)` | POST | `/videos/delete` | `{ ids }` | `{ deleted[], errors? }` |
| `renameVideo(id, newName)` | POST | `/videos/rename` | `{ id, new_name }` | `{ ok, old_id, id, title }` |
| `moveVideos(ids, category)` | POST | `/videos/move` | `{ ids, category }` | `{ moved[] }` |
| `rescan()` | POST | `/rescan` | — | `{ version, count }` |

---

## 11. settings.ts — 设置与服务

| 函数 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| `getSettings(scope?)` | GET | `/settings` | query: `scope=merged\|global\|library` | `Settings` |
| `saveSettings(data, scope?)` | POST | `/settings` | `SettingsUpdate + scope` | `Settings` |
| `getHealth()` | GET | `/health` | — | `{ ok, boot_id }` |
| `restartService()` | POST | `/service/restart` | — | `{ ok, queued, boot_id }` |

---

## 12. events.ts — SSE

| 连接 | 路径 | 事件类型 |
|------|------|----------|
| `connectSSE(libraryId)` | `GET /api/events?library_id={id}` | `version:{libId}:{ver}` / `progress:{libId}` |

### SSE 事件处理映射

| 事件 | 前端动作 |
|------|----------|
| `version` | debounce 500ms → 重载分类 + 视频列表 |
| `progress` | 更新缩略图进度条 |

---

## 13. 缩略图 URL 构建

```typescript
function thumbUrl(videoId: string, version?: number): string {
  const lib = useLibraryStore().activeLibraryId
  let url = `/api/thumb/${videoId}?library_id=${lib}`
  if (version) url += `&v=${version}`
  return url
}
```

## 14. 流式播放 URL 构建

```typescript
function streamUrl(videoId: string): string {
  const lib = useLibraryStore().activeLibraryId
  return `/api/stream/${videoId}?library_id=${lib}`
}

function hlsPlaylistUrl(videoId: string): string {
  const lib = useLibraryStore().activeLibraryId
  return `/api/hls/${videoId}/index.m3u8?library_id=${lib}`
}
```

---

## 15. 前端未使用但需保留的 API

以下端点源项目前端未调用，但 API 层应实现以备后续使用：

| 端点 | 原因 |
|------|------|
| `POST /api/categories/star` | 7.0 移除星标 UI，API 仍存在 |
| `GET /api/favorites/summary` | 可用于顶栏角标 |
| `GET /api/history/summary` | 可用于顶栏角标 |
| `POST /api/albums/reorder` | 专辑拖拽排序 |
| `POST /api/albums/{id}/videos/reorder` | 专辑内视频排序 |
| `POST /api/duration/scan` | 手动触发时长扫描 |
| `POST /api/thumb/cleanup` | 清理孤立缩略图 |
| `POST /api/play/{id}` | 统一播放入口（PotPlayer 用 play-external） |
