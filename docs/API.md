# 当前 API 说明

服务默认监听 `http://localhost:3000`。请求和响应均为 JSON，图片通过 Base64 Data URL 包含在提交 JSON 中。

## 认证

登录后返回 `Authorization: Bearer <token>` 使用的令牌。当前令牌只是 Base64 编码的用户 ID，不安全、不可用于生产环境。

## 公共接口

### `POST /api/login`

请求：

```json
{"studentId":"admin","password":"change-me-now"}
```

成功返回令牌、安全用户资料、活动配置和双赛道列表。学生登录成功时还可返回可选的 `plaza` 字段，内容与 `GET /api/plaza?sort=latest&page=1&limit=6` 的首屏一致；前端优先复用该首屏，字段缺失或过期时仍回退到原广场接口。禁用账号返回 403。登录方式和令牌格式仍沿用现有系统。

## 已登录用户

### 任务与提交

- `GET /api/tasks`：读取当前学生赛道已发布任务及本人/本队提交状态。
- `PUT /api/tasks/:id/submission`：保存草稿或最终提交，包含 `intent`、`version`、`images`、`copy`、`mealType`、`isPublic`。
- `GET /api/submissions/history`：自律赛道读取个人历史。
- `GET/POST /api/admin/tasks`、`PUT /api/admin/tasks/:id`：管理员管理任务。
- `PATCH /api/admin/activity-switches`：管理员维护活动和赛道开关。
- `PATCH /api/admin/submissions/:id`：管理员退回或通过材料。

并发版本过期、重复最终提交和同队覆盖均返回 `409`。

### 四校区活动广场

- `GET /api/plaza?sort=latest|hot|monthly&page=1&limit=6&month=YYYY-MM`：分页读取可见帖子。
- `GET /api/plaza/:id`：读取帖子详情。
- `POST /api/plaza/:id/view`：进入详情时登记浏览；同用户同帖子 24 小时内幂等，管理员不计数。
- `POST /api/plaza/:id/like`：请求体 `{"liked":true|false}`，幂等设置点赞状态；每日最多 5 个有效点赞，超额返回 `429`。
- `GET /api/admin/plaza`：管理员读取全部帖子，包括隐藏内容。
- `PATCH /api/admin/plaza/:id`：隐藏或恢复帖子。
- `DELETE /api/admin/plaza/:id`：永久删除帖子。

不存在创建广场帖子的客户端 API；帖子仅由公开的四校区最终任务提交自动生成。

### 排行榜

- `GET /api/rankings?period=day|week|month&key=...`：读取点赞、浏览、综合热度和队伍榜。
- `POST /api/admin/rankings/freeze`：以 `{"month":"YYYY-MM"}` 冻结最终月榜；重复冻结返回 `409`。
- `GET /api/admin/rankings/export?month=YYYY-MM`：管理员导出实时或已冻结月榜 Excel。

综合热度先分别除以周期内最大点赞和最大浏览做归一化，再按 70/30 加权。

### 阶段 8 管理后台

- `GET /api/admin/overview`：返回六项后台看板指标。
- `DELETE /api/admin/submissions/:id`：删除任务提交，并级联清理其广场帖子、点赞和浏览记录。
- `PATCH /api/admin/plaza/:id`：除可见状态外，可设置 `excludedFromRanking`。
- `GET /api/admin/exports/:type`：导出 `users`、`teams`、`checkins`、`missing`、`rankings`、`materials`。

导出接口接受 `date=YYYY-MM-DD` 和 `month=YYYY-MM`，仅管理员可访问。

### 后期材料收集

- `GET /api/material-tasks`：学生读取适用材料任务和本人/本队状态。
- `PUT /api/material-tasks/:id/submission`：提交或在退回后重新提交文件与总结。
- `GET /api/material-files/:fileId`：鉴权下载；仅提交本人、队伍成员或管理员可用。
- `GET/POST /api/admin/material-tasks`：管理员查看或创建材料任务。
- `PATCH /api/admin/material-submissions/:id`：管理员填写原因并退回修改。
- `GET /api/admin/material-tasks/:id/missing-export`：导出未提交个人或队伍名单。

文件接口返回 `private, no-store`，服务端不提供 `material-files/` 静态路由。

### 定时任务与统一编队

- 周期任务提交必须携带服务端返回的 `occurrenceDate`，且必须等于上海时区当天。
- `POST /api/admin/teams/import`：导入 `.xlsx` 并自动创建、编组队伍。
- `POST /api/admin/teams/:id/members`：管理员按学号加入成员。
- `DELETE /api/admin/teams/:id/members/:userId`：管理员踢出成员。
- `POST /api/teams/join`：当 `config.allowSelfJoin=false` 时返回 `403`。

公开四校区提交包含独立 `plazaCopy`；选择公开时该字段必填。

### `GET /api/me`

返回当前用户自己的只读资料、配置、双赛道列表、上海时区日期和时间。响应不包含密码。

### `GET /api/checkins?date=YYYY-MM-DD`

返回当前用户指定日期的打卡记录。学生只能读取自己的记录。

### `POST /api/checkins`

仅学生可用。请求包含：

```json
{
  "slotId": "breakfast",
  "date": "2026-09-12",
  "photos": ["data:image/jpeg;base64,..."],
  "summary": "data:image/png;base64,...",
  "note": "可选备注"
}
```

服务端要求：

- 日期必须是上海时区当天。
- 当前时间必须处于对应时段。
- 至少一张餐食图片。
- 个人打卡图片上限以任务的 `memberImageLimit` 为准；旧任务缺少该字段时回退到 `imageLimit`，前端有效范围为 1～8 张。
- 请求文本上限约 25 MB。

同一用户、日期、时段再次提交会替换记录，但旧文件不会删除。

## 管理员接口

所有 `/api/admin/*` 接口要求 `role === "admin"`。

## 四校区互动赛道队伍接口

### `GET /api/teams`

仅四校区互动赛道普通用户可用。返回队伍名称、成员数量、人数限制和满员状态，不公开邀请码或成员资料。

### `GET /api/teams/me`

返回当前学生所属队伍、邀请码和成员安全资料。未加入队伍时返回 `team: null`。

### `POST /api/teams/join`

请求：

```json
{"inviteCode":"A1B2C3D4"}
```

服务端验证：

- 用户属于四校区互动赛道。
- 用户当前未加入其他队伍。
- 邀请码存在。
- 队伍尚未满员。

### `GET /api/admin/teams`

返回最大队伍数、现有队伍数、邀请码和成员安全资料。

### `PATCH /api/admin/team-capacity`

请求：

```json
{"maxTeams":60}
```

接受 0–500 的整数，但不得低于当前已有队伍数量。

### `POST /api/admin/teams`

请求：

```json
{"name":"四校同心队","memberLimit":4}
```

队伍总数达到数据库中的 `config.maxTeams` 时拒绝创建。

### `PUT /api/admin/teams/:id`

修改队伍名称和人数限制。人数限制不得低于当前成员数，队伍名称必须唯一。

### `DELETE /api/admin/teams/:id/members/:userId`

从队伍中移除指定成员。

### `DELETE /api/admin/teams/:id`

解散空队伍。有成员的队伍返回 409，禁止直接删除。

### `GET /api/admin/dashboard?date=YYYY-MM-DD`

返回配置及全部学生在指定日期的时段记录。当前使用对象展开返回完整学生记录，包含明文密码，必须在上线前修复。

### `GET /api/admin/users`

返回全部普通用户的安全资料及赛道列表，不包含密码。

### `POST /api/admin/users`

创建学生：

```json
{
  "studentId": "学号",
  "name": "姓名",
  "password": "初始密码",
  "campus": "校区",
  "trackId": "health",
  "status": "active"
}
```

服务端验证姓名、学号、校区、赛道、状态、初始密码和学号唯一性。

### `PUT /api/admin/users/:id`

管理员编辑普通用户的姓名、学号、校区、所属赛道和账号状态，可选重置密码。角色和创建时间不可修改。

### `PATCH /api/admin/users/:id/status`

请求：

```json
{"status":"disabled"}
```

只接受 `active` 或 `disabled`。禁用后旧令牌立即失效。

### `POST /api/admin/users/import`

上传 Base64 编码的 `.xlsx`。首行必须包含“姓名、学号、校区、所属赛道、初始密码”，可选“账号状态”。服务端整批校验；任一行错误则不写入任何用户。

### `PUT /api/admin/config`

将请求体浅合并到当前配置。当前没有严格 schema 校验。

### `PUT /api/admin/checkins/:id`

请求：

```json
{"status":"approved","reviewNote":"可选"}
```

除 `approved` 外的状态都会保存为 `rejected`。

## 静态文件

- `/`、`/app.js`、`/style.css` 来自 `public/`
- `/uploads/:filename` 直接返回图片，没有登录或权限检查

## 建议的 API 演进

- API 永不返回密码哈希或其他认证材料。
- 使用签名会话和 HttpOnly Cookie。
- 为请求/响应增加 schema 校验和一致错误码。
- 上传改为受鉴权的 multipart 或 R2 直传流程。
- 图片读取必须验证当前用户是文件所有者或管理员。
- 管理员操作写入审计日志。
- 明确定义分页、批量导入、导出和异常重试行为。
