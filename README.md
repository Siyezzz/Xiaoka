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
- **Share cards** — generate a Mini Program code to invite friends in one scan.
- **Inbox** — friend requests and system messages in one place.

## 📱 Screenshots

<p align="center">
  <img src="docs/images/screenshot-today.png" width="152" alt="Today" />
  &nbsp;
  <img src="docs/images/screenshot-habits.png" width="152" alt="Habits" />
  &nbsp;
  <img src="docs/images/screenshot-stats.png" width="152" alt="Stats" />
  &nbsp;
  <img src="docs/images/screenshot-social.png" width="152" alt="Friends" />
  &nbsp;
  <img src="docs/images/screenshot-achievement.png" width="152" alt="Achievement unlocked" />
</p>

## 🧱 Built with

| Layer | Choice |
| --- | --- |
| Client | Native WeChat Mini Program (WXML / WXSS / JavaScript) |
| Backend | WeChat Cloud Development (cloud functions + cloud database) |
| Auth | `wx.cloud` built-in OpenID, no separate account system |
| Data | Cloud database collections for habits, check-ins, and profiles |

## 📄 License

Released under the [MIT License](LICENSE).

---

<div align="center">
<sub>A product showcase — the Mini Program is not open for external development.</sub>
</div>
