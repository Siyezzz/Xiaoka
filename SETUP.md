# 习惯打卡小程序 - 部署步骤

## 1. 开通云开发环境
1. 微信开发者工具 → 云开发 → 开通
2. 记下环境 ID（格式如 `cloud1-xxxxxxxx`）

## 2. 填写环境 ID
编辑 `miniprogram/app.js`，将 `'your-env-id'` 替换为你的环境 ID：
```js
wx.cloud.init({ env: 'cloud1-d1gk8zc6k0a6f1728' })
```

## 3. 创建数据库集合
在云开发控制台 → 数据库，创建两个集合：
- `habits`
- `checkins`

两个集合的权限都设置为：**仅创建者可读写**

## 4. 部署云函数
在开发者工具中，右键 `cloudfunctions/login` 和 `cloudfunctions/getStats`，分别选择**上传并部署（云端安装依赖）**

## 5. Tab Bar 图标
`miniprogram/images/` 目录下需要准备 6 张 81×81 的 PNG 图标（灰色 + 彩色各一张）：
- `tab-today.png` / `tab-today-active.png`
- `tab-habit.png` / `tab-habit-active.png`
- `tab-stats.png` / `tab-stats-active.png`

可以用任意 icon 库导出，或者用 emoji 临时替代（需改 app.json 用 text 方案）。

## 数据结构参考
### habits 集合
```json
{
  "_openid": "自动",
  "name": "每天跑步",
  "icon": "🏃",
  "color": "#6C63FF",
  "frequency": { "type": "weekly", "days": [1,2,3,4,5] },
  "isActive": true,
  "createdAt": "ServerDate"
}
```

### checkins 集合
```json
{
  "_openid": "自动",
  "habitId": "habits 集合的 _id",
  "date": "2026-04-22",
  "createdAt": "ServerDate"
}
```
