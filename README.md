<div align="center">

<img src="docs/images/icon.png" width="128" alt="Xiaoka app icon" />

# Xiaoka · 小卡

**Keep track of your daily habits with your friends.**

A WeChat Mini Program for building habits together — check in daily, track your streaks,
and stay accountable with the people around you.

[![Platform](https://img.shields.io/badge/platform-WeChat%20Mini%20Program-07C160?logo=wechat&logoColor=white)](https://developers.weixin.qq.com/miniprogram/dev/framework/)
[![Backend](https://img.shields.io/badge/backend-WeChat%20Cloud%20Development-45C5A0)](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ Features

- **Daily check-in** — a focused "Today" view showing exactly which habits are due, with one-tap check-in.
- **Habit management** — create habits with an emoji, color, and weekly frequency; edit or archive them anytime.
- **Streaks & stats** — completion rates, current streak, and per-habit history at a glance.
- **Friends & accountability** — add friends, browse their habits, and keep each other honest.
- **Reminders** — scheduled cloud functions send check-in nudges so you don't forget.
- **Share cards** — generate a Mini Program code (`getWXACode`) to invite friends in one scan.
- **Inbox** — friend requests and system messages in one place.

## 📱 Screenshots

> Screenshots are captured from the running Mini Program and will land in `docs/images/`.
> See [Contributing screenshots](#-contributing-screenshots) below for how to add them.

<!--
<p align="center">
  <img src="docs/images/screenshot-today.png" width="200" alt="Today" />
  <img src="docs/images/screenshot-habits.png" width="200" alt="Habits" />
  <img src="docs/images/screenshot-stats.png" width="200" alt="Stats" />
  <img src="docs/images/screenshot-social.png" width="200" alt="Friends" />
</p>
-->

## 🧱 Tech Stack

| Layer | Choice |
| --- | --- |
| Client | Native WeChat Mini Program (WXML / WXSS / JavaScript) |
| Backend | WeChat Cloud Development (cloud functions + cloud database) |
| Auth | `wx.cloud` built-in OpenID, no separate account system |
| Storage | Cloud database collections: `habits`, `checkins`, `users` |

## 📂 Project Structure

```
Xiaoka/
├── miniprogram/              # Mini Program source
│   ├── pages/
│   │   ├── index/            # Today — due habits & one-tap check-in
│   │   ├── habits/           # All habits, create / edit / archive
│   │   ├── stats/            # Streaks, completion rate, history
│   │   ├── social/           # Friends list & friend habits
│   │   ├── add-habit/        # Habit creation form
│   │   ├── habit-checkin/    # Check-in detail
│   │   ├── friend-habits/    # A friend's habit board
│   │   ├── inbox/            # Friend requests & notifications
│   │   ├── profile-setup/    # First-run profile
│   │   ├── tutorial/         # Onboarding
│   │   ├── about/            # About the app
│   │   └── author-message/   # Message from the author
│   ├── components/           # Shared UI components
│   ├── custom-tab-bar/       # Custom bottom navigation
│   ├── images/               # Icons & assets
│   ├── utils/                # db helpers, badge logic
│   ├── app.js / app.json / app.wxss
│   └── sitemap.json
├── cloudfunctions/           # Cloud functions
│   ├── login/                # OpenID bootstrap
│   ├── createUser/           # Profile creation
│   ├── users/                # User queries
│   ├── addFriend/            # Friend requests
│   ├── social/               # Friend feed
│   ├── getStats/             # Aggregated statistics
│   ├── getWXACode/           # Mini Program share code
│   ├── inbox/                # Notifications
│   ├── reminders/            # Scheduled check-in reminders
│   └── initDb/               # Database bootstrap
├── docs/images/              # README assets
├── project.config.json       # WeChat DevTools project config
├── database.rules.json       # Database security rules
├── SETUP.md                  # Detailed Chinese setup guide
└── LICENSE
```

## 🚀 Getting Started

### Prerequisites

- [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) (latest stable)
- A Mini Program AppID with Cloud Development enabled

### 1. Open the project

Import the repository root into WeChat DevTools. `project.config.json` already points
`miniprogramRoot` at `miniprogram/` and `cloudfunctionRoot` at `cloudfunctions/`.

### 2. Configure the cloud environment

Open `miniprogram/app.js` and replace the placeholder with your own environment ID:

```js
wx.cloud.init({ env: 'your-cloud-env-id', traceUser: true })
```

Find the ID in **Cloud Development → Settings → Environment ID**.

### 3. Create database collections

In the Cloud Development console, create:

| Collection | Purpose | Permission |
| --- | --- | --- |
| `habits` | One document per habit | Only creator can read/write |
| `checkins` | One document per check-in | Only creator can read/write |
| `users` | Profile & friend graph | Only creator can read/write |

### 4. Deploy cloud functions

Right-click each folder under `cloudfunctions/` → **Upload and deploy (install dependencies in cloud)**.

At minimum deploy `login` and `createUser` to get a working login flow.

### 5. Run

Compile in DevTools. The first launch routes to `profile-setup`, then to the Today view.

> A more detailed, Chinese-language walkthrough lives in [SETUP.md](SETUP.md).

## 🗄️ Data Model

**`habits`**

```json
{
  "_openid": "auto",
  "name": "Run every morning",
  "icon": "🏃",
  "color": "#45C5A0",
  "frequency": { "type": "weekly", "days": [1, 2, 3, 4, 5] },
  "isActive": true,
  "createdAt": "ServerDate"
}
```

**`checkins`**

```json
{
  "_openid": "auto",
  "habitId": "<habits._id>",
  "date": "2026-10-17",
  "createdAt": "ServerDate"
}
```

## 📸 Contributing screenshots

Screenshots live in `docs/images/` and are referenced from the section above.
To add them, capture the four main tabs from a real device or the DevTools simulator and
name them:

```
docs/images/screenshot-today.png
docs/images/screenshot-habits.png
docs/images/screenshot-stats.png
docs/images/screenshot-social.png
```

Then uncomment the `<p align="center">` block in this README and open a PR.

## 📄 License

Released under the [MIT License](LICENSE).
