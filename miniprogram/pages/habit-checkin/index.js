const { getDb, getHabits, getTodayCheckins, TODAY, calcStreak, getCheckinHistory, invalidateHabits, invalidateCheckins, recordOptCheckin } = require('../../utils/db');
const { checkAndAward } = require('../../utils/badges');

// Same template as reminder: 打卡类型(phrase1), 打卡时间(date2), 打卡日期(date5)
const TIMER_DONE_TEMPLATE_ID = 'ajelop-5tQ0VP2N3dHtpAH2CXNHpY0Q0vXRcU1MaBmg';

const PRESETS = [
  { label: '15分钟', value: 15 },
  { label: '30分钟', value: 30 },
  { label: '45分钟', value: 45 },
  { label: '1小时', value: 60 },
  { label: '自定义', value: -1 },
];

function pad(n) { return String(n).padStart(2, '0'); }

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${pad(m)}:${pad(s % 60)}`;
}

function fmtPausedFor(ms) {
  const total = Math.floor(ms / 1000);
  if (total < 60) return '刚刚暂停';
  const m = Math.floor(total / 60);
  if (m < 60) return `已暂停 ${m} 分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `已暂停 ${h} 小时 ${rm} 分钟` : `已暂停 ${h} 小时`;
}

function fmtActual(seconds) {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m}分${s}秒`;
  if (m > 0) return `${m}分钟`;
  return `${s}秒`;
}

function formatHistoryDate(ds) {
  const todayStr = TODAY();
  if (ds === todayStr) return '今天';
  const d = new Date(ds + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d.getTime() === yest.getTime()) return '昨天';
  const diff = Math.round((today - d) / 86400000);
  if (diff < 7) return `${diff}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

Page({
  data: {
    habit: null,
    checkin: null,
    checked: false,
    streak: 0,
    recentDays: [],
    loading: true,
    loadError: false,
    saving: false,
    editingHistId: '',
    editingNote: '',
    editingMinutes: '',
    editingPhotos: [],
    uploadingEditPhoto: false,
    savingEdit: false,

    presets: PRESETS,
    selectedPreset: -2,   // -2=未选, -1=自定义, >0=预设分钟
    customMinutes: '',
    presetTimeDisplay: '00:00',  // idle 圆环里显示选中时长的预览

    // timerState: idle | running | paused | done | skip
    timerState: 'idle',
    totalSeconds: 0,
    remainingSeconds: 0,
    timeDisplay: '00:00',
    timerProgress: 100,    // 0-100, 用于圆形进度
    actualSeconds: 0,
    actualTimeStr: '',
    pausedForStr: '',      // "已暂停 X 分钟"

    note: '',
    photos: [],
    uploadingPhoto: false,
    manualMinutes: '',
    newBadge: null,
    showBadgePopup: false,
    historyItems: [],
    statusBarHeight: 0,
    navTopPadding: 0,
    navBarHeightPx: 80,
    navBgStyle: 'background: #45C5A0;',
    navBg: '#45C5A0',
    initialColor: '#45C5A0',
  },

  _interval: null,
  _startTs: 0,

  onBack() { wx.navigateBack(); },

  onLoad(options) {
    const app = getApp();
    const navTopPadding = app.globalData.navTopPadding || app.globalData.statusBarHeight || 0;
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = sys.windowWidth / 750;
    const navBarHeightPx = Math.round(navTopPadding + 72 * ratio);
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 0,
      navTopPadding,
      navBarHeightPx,
    });
    this._habitId = options.habitId;
    if (options.color) {
      const color = decodeURIComponent(options.color);
      this.setData({ initialColor: color, navBg: color, navBgStyle: `background: ${color};` });
    }
  },

  onShow() {
    this._recoverTimer();
    const app = getApp();
    if (app.globalData._needsRefresh) {
      app.globalData._needsRefresh = false;
      this._lastLoadTime = 0; // force reload
    }
    if (!this.data.habit || !this._lastLoadTime || Date.now() - this._lastLoadTime > 3000) {
      this._loadData();
    }
  },

  async onPullDownRefresh() {
    invalidateHabits();
    invalidateCheckins(this._habitId);
    this._lastLoadTime = 0;
    await this._loadData();
    wx.stopPullDownRefresh();
  },

  onHide() {
    // 停掉 UI tick，storage 保持 running 状态 + startTs 不变
    // onShow/_recoverTimer 重新用时间差恢复，息屏/切后台/切页面均适用
    this._clearInterval();
    try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) {}
  },

  onUnload() {
    // 页面销毁时同样只停 tick，保留 storage，下次进入可用时间差恢复
    this._clearInterval();
    try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) {}
  },

  _clearInterval() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  },

  _recoverTimer() {
    if (!this._habitId) return;
    const state = wx.getStorageSync(`ht_state_${this._habitId}`);
    const totalSec = wx.getStorageSync(`ht_total_${this._habitId}`);
    if (!state || !totalSec) return;

    if (state === 'running') {
      const startTs = wx.getStorageSync(`ht_ts_${this._habitId}`);
      if (!startTs) return;
      const elapsed = Math.floor((Date.now() - startTs) / 1000);
      const remaining = totalSec - elapsed;
      if (remaining <= 0) {
        this._clearTimer();
        this.setData({
          timerState: 'done',
          totalSeconds: totalSec,
          remainingSeconds: 0,
          timeDisplay: '00:00',
          timerProgress: 0,
          actualSeconds: totalSec,
          actualTimeStr: fmtActual(totalSec),
        });
        this._alarm();
        // Timer finished while away — auto check-in once habit is guaranteed loaded
        if (!this._autoCheckinFired) {
          this._autoCheckinFired = true;
          if (this.data.habit) {
            setTimeout(() => this.onCheckin(), 600);
          } else {
            // _loadData() is still in flight; let it trigger onCheckin when done
            this._pendingAutoCheckin = true;
          }
        }
      } else {
        this._startTs = startTs;
        const progress = Math.round((remaining / totalSec) * 100);
        this.setData({
          timerState: 'running',
          totalSeconds: totalSec,
          remainingSeconds: remaining,
          timeDisplay: fmtTime(remaining),
          timerProgress: progress,
        });
        this._tick();
        try { wx.setKeepScreenOn({ keepScreenOn: true }); } catch (e) {}
      }
    } else if (state === 'paused') {
      const remaining = wx.getStorageSync(`ht_remaining_${this._habitId}`);
      if (!remaining) return;
      const pauseTs = wx.getStorageSync(`ht_pause_ts_${this._habitId}`);
      const pausedForStr = pauseTs ? fmtPausedFor(Date.now() - pauseTs) : '';
      const progress = Math.round((remaining / totalSec) * 100);
      this.setData({
        timerState: 'paused',
        totalSeconds: totalSec,
        remainingSeconds: remaining,
        timeDisplay: fmtTime(remaining),
        timerProgress: progress,
        pausedForStr,
      });
    }
  },

  _clearTimer() {
    this._clearInterval();
    if (this._habitId) {
      wx.removeStorageSync(`ht_ts_${this._habitId}`);
      wx.removeStorageSync(`ht_total_${this._habitId}`);
      wx.removeStorageSync(`ht_remaining_${this._habitId}`);
      wx.removeStorageSync(`ht_state_${this._habitId}`);
      wx.removeStorageSync(`ht_pause_ts_${this._habitId}`);
    }
    try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) {}
  },

  _alarm() {
    wx.showToast({ title: '⏰ 时间到！', icon: 'none', duration: 2500 });
    if (!TIMER_DONE_TEMPLATE_ID) return;
    const habit = this.data.habit;
    if (!habit) return;
    const now = new Date();
    const endTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const totalMinutes = Math.round((this.data.totalSeconds || 0) / 60);
    // Cancel the cloud-scheduled notification (it was a backup for screen-off case)
    // then send immediately since the app is now foregrounded
    wx.cloud.callFunction({
      name: 'reminders',
      data: { action: 'cancelTimerSchedule' },
    }).catch(err => console.error('[alarm] cancelTimerSchedule err', err));
    wx.cloud.callFunction({
      name: 'reminders',
      data: {
        action: 'sendTimerDone',
        habitId: habit._id,
        habitName: habit.name,
        endTime,
        color: habit.color || '#45C5A0',
        duration: totalMinutes,
      },
    }).then(res => {
      console.log('[alarm] sendTimerDone result:', JSON.stringify(res && res.result));
    }).catch(err => {
      console.error('[alarm] sendTimerDone err:', err);
    });
  },

  async _loadData() {
    if (!this._habitId) return;
    // 首次加载才显示 loading，已有数据时静默刷新
    if (!this.data.habit) this.setData({ loading: true });
    try {
      const [habits, checkins, history] = await Promise.all([
        getHabits(),
        getTodayCheckins(),
        getCheckinHistory(this._habitId, 30),
      ]);

      const habit = habits.find(h => h._id === this._habitId);
      if (!habit) {
        wx.showToast({ title: '习惯不存在', icon: 'error' });
        wx.navigateBack();
        return;
      }

      const todayCheckin = checkins.find(c => c.habitId === this._habitId) || null;
      const streak = calcStreak(habit, history);

      const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
      const recentDays = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        recentDays.push({
          date: ds,
          label: i === 0 ? '今' : dayNames[d.getDay()],
          done: history.some(c => c.date === ds),
          isToday: i === 0,
        });
      }


      wx.setNavigationBarTitle({ title: habit.name });

      // Keep whatever the user is currently composing; don't overwrite with old checkin data
      const note = this.data.note || '';
      const photos = this.data.photos || [];
      const timerState = this.data.timerState;
      const actualSeconds = this.data.actualSeconds;
      const actualTimeStr = this.data.actualTimeStr;

      const todayStr = TODAY();
      const historyItems = [...history]
        .filter(c => c.date === todayStr)
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ta - tb;
        })
        .slice(0, 10)
        .map((c) => {
          let timeStr = '--:--';
          if (c.createdAt) {
            const d = new Date(c.createdAt);
            timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          return {
            _id: c._id,
            timeStr,
            durationStr: c.duration ? `${c.duration}分钟` : '未记录时长',
            rawMinutes: c.duration || '',
            note: c.note || '',
            photos: c.photos || [],
          };
        });

      this._lastLoadTime = Date.now();
      this.setData({
        habit,
        checkin: todayCheckin,
        checked: !!todayCheckin,
        streak,
        recentDays,
        note,
        photos,
        timerState,
        actualSeconds,
        actualTimeStr,
        historyItems,
        loading: false,
        navBg: habit.color,
        navBgStyle: `background: ${habit.color};`,
      });
      // If auto-checkin was requested before habit loaded, trigger it now
      if (this._pendingAutoCheckin) {
        this._pendingAutoCheckin = false;
        setTimeout(() => this.onCheckin(), 300);
      }
    } catch (e) {
      console.error('habit-checkin _loadData error:', e);
      this.setData({ loading: false, loadError: true });
    }
  },

  onSelectPreset(e) {
    const value = e.currentTarget.dataset.value;
    const presetTimeDisplay = value > 0 ? fmtTime(value * 60) : '00:00';
    this.setData({ selectedPreset: value, presetTimeDisplay });
    if (value !== -1) this.setData({ customMinutes: '' });
  },

  onCustomInput(e) {
    this.setData({ customMinutes: e.detail.value });
  },

  _getMinutes() {
    const { selectedPreset, customMinutes } = this.data;
    if (selectedPreset === -1) {
      const v = parseInt(customMinutes);
      return isNaN(v) || v <= 0 ? 0 : v;
    }
    return selectedPreset > 0 ? selectedPreset : 0;
  },

  onStartTimer() {
    const minutes = this._getMinutes();
    if (minutes <= 0) {
      wx.showToast({ title: '请先选择时长', icon: 'none' });
      return;
    }
    const total = minutes * 60;
    const startTs = Date.now();
    // Must use callback style — Promise wrapper loses the tap event context in WeChat
    if (TIMER_DONE_TEMPLATE_ID) {
      wx.requestSubscribeMessage({
        tmplIds: [TIMER_DONE_TEMPLATE_ID],
        success: (res) => {
          console.log('[subscribe] result:', JSON.stringify(res));
          if (res[TIMER_DONE_TEMPLATE_ID] === 'accept') {
            const habit = this.data.habit;
            wx.cloud.callFunction({
              name: 'reminders',
              data: {
                action: 'scheduleTimerDone',
                endTimestamp: startTs + total * 1000,
                habitId: this._habitId,
                habitName: habit && habit.name,
                color: (habit && habit.color) || '#45C5A0',
                duration: minutes,
              },
            }).then(r => console.log('[subscribe] scheduleTimerDone:', JSON.stringify(r && r.result)))
              .catch(e => console.error('[subscribe] scheduleTimerDone err:', e));
          }
        },
        fail: (err) => { console.error('[subscribe] fail:', JSON.stringify(err)); },
      });
    }
    this._autoCheckinFired = false;
    this._pendingAutoCheckin = false;
    this._startTs = startTs;
    wx.setStorageSync(`ht_state_${this._habitId}`, 'running');
    wx.setStorageSync(`ht_ts_${this._habitId}`, this._startTs);
    wx.setStorageSync(`ht_total_${this._habitId}`, total);
    try { wx.setKeepScreenOn({ keepScreenOn: true }); } catch (e) {}

    this.setData({
      timerState: 'running',
      totalSeconds: total,
      remainingSeconds: total,
      timeDisplay: fmtTime(total),
      timerProgress: 100,
    });
    this._tick();
  },

  _tick() {
    this._clearInterval();
    this._interval = setInterval(() => {
      if (this.data.timerState !== 'running') return;
      const elapsed = Math.floor((Date.now() - this._startTs) / 1000);
      const remaining = Math.max(0, this.data.totalSeconds - elapsed);
      const progress = Math.round((remaining / this.data.totalSeconds) * 100);

      if (remaining <= 0) {
        this._clearTimer();
        const actualStr = fmtActual(this.data.totalSeconds);
        this.setData({
          timerState: 'done',
          remainingSeconds: 0,
          timeDisplay: '00:00',
          timerProgress: 0,
          actualSeconds: this.data.totalSeconds,
          actualTimeStr: actualStr,
        });
        this._alarm();
        // Auto check-in after showing "done" ring for 1.5s
        if (!this._autoCheckinFired) {
          this._autoCheckinFired = true;
          setTimeout(() => this.onCheckin(), 1500);
        }
      } else {
        this.setData({ remainingSeconds: remaining, timeDisplay: fmtTime(remaining), timerProgress: progress });
      }
    }, 500);
  },

  onTogglePause() {
    if (this.data.timerState === 'running') {
      this._clearInterval();
      const pauseTs = Date.now();
      wx.setStorageSync(`ht_state_${this._habitId}`, 'paused');
      wx.setStorageSync(`ht_remaining_${this._habitId}`, this.data.remainingSeconds);
      wx.setStorageSync(`ht_pause_ts_${this._habitId}`, pauseTs);
      wx.removeStorageSync(`ht_ts_${this._habitId}`);
      this.setData({ timerState: 'paused', pausedForStr: '刚刚暂停' });
    } else if (this.data.timerState === 'paused') {
      const consumed = this.data.totalSeconds - this.data.remainingSeconds;
      this._startTs = Date.now() - consumed * 1000;
      wx.setStorageSync(`ht_state_${this._habitId}`, 'running');
      wx.setStorageSync(`ht_ts_${this._habitId}`, this._startTs);
      wx.setStorageSync(`ht_total_${this._habitId}`, this.data.totalSeconds);
      wx.removeStorageSync(`ht_remaining_${this._habitId}`);
      wx.removeStorageSync(`ht_pause_ts_${this._habitId}`);
      this.setData({ timerState: 'running', pausedForStr: '' });
      this._tick();
    }
  },

  onAbandon() {
    wx.showModal({
      title: '取消计时',
      content: '确定取消本次计时？',
      confirmText: '取消',
      confirmColor: '#EB5757',
      success: (res) => {
        if (!res.confirm) return;
        const consumed = this.data.totalSeconds - this.data.remainingSeconds;
        this._clearTimer();
        // Cancel any scheduled cloud notification since the timer was abandoned
        wx.cloud.callFunction({
          name: 'reminders',
          data: { action: 'cancelTimerSchedule' },
        }).catch(() => {});
        const actualTimeStr = fmtActual(consumed);
        this.setData({
          timerState: 'skip',
          actualSeconds: consumed,
          actualTimeStr,
        });
      },
    });
  },

  onSkipTimer() {
    this.setData({ timerState: 'skip', actualSeconds: 0, actualTimeStr: '' });
  },

  onDiscardTimer() {
    this._autoCheckinFired = false;
    this._pendingAutoCheckin = false;
    this._clearTimer();
    this.setData({
      timerState: 'idle',
      actualSeconds: 0,
      actualTimeStr: '',
      selectedPreset: -2,
      customMinutes: '',
      presetTimeDisplay: '00:00',
    });
  },

  onManualMinutesInput(e) {
    this.setData({ manualMinutes: e.detail.value });
  },

  onDirectCheckin() {
    const v = parseInt(this.data.manualMinutes);
    if (!v || v <= 0) {
      wx.showToast({ title: '请输入打卡时长', icon: 'none' });
      return;
    }
    const actualSeconds = v * 60;
    this.setData({
      timerState: 'skip',
      actualSeconds,
      actualTimeStr: fmtActual(actualSeconds),
      manualMinutes: '',
    });
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  async onAddPhoto() {
    if (this.data.uploadingPhoto) return;
    try {
      const res = await wx.chooseMedia({
        count: 9 - this.data.photos.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });
      if (!res.tempFiles || res.tempFiles.length === 0) return;
      this.setData({ uploadingPhoto: true });
      wx.showLoading({ title: '上传中...' });
      const uploaded = [];
      for (const file of res.tempFiles) {
        const ext = (file.tempFilePath.match(/\.(\w+)$/) || ['', 'jpg'])[1];
        const cloudPath = `checkin-photos/${this._habitId}/${TODAY()}/${Date.now()}.${ext}`;
        const upRes = await wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath });
        // 保存图片信息：url + 拍摄时间（用户手机本地时间）
        const shootTime = file.lastModifiedDate ? file.lastModifiedDate.toISOString() : new Date().toISOString();
        uploaded.push({
          url: upRes.fileID,
          shootTime: shootTime
        });
      }
      wx.hideLoading();
      this.setData({ photos: [...this.data.photos, ...uploaded], uploadingPhoto: false });
    } catch (e) {
      wx.hideLoading();
      this.setData({ uploadingPhoto: false });
      const msg = e.errMsg || '';
      if (msg.includes('auth deny') || msg.includes('authorize') || msg.includes('permission')) {
        wx.showModal({
          title: '需要权限',
          content: '请前往系统设置开启相册/相机权限',
          confirmText: '去设置',
          cancelText: '取消',
          success: res => { if (res.confirm) wx.openSetting(); },
        });
      } else if (!msg.includes('cancel')) {
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    }
  },

  onRemovePhoto(e) {
    const { index } = e.currentTarget.dataset;
    const photos = this.data.photos.filter((_, i) => i !== Number(index));
    this.setData({ photos });
  },

  onPreviewCheckinPhoto(e) {
    const { index } = e.currentTarget.dataset;
    wx.previewImage({ current: this.data.photos[index], urls: this.data.photos });
  },


  async onCheckin() {
    if (this.data.saving) return;
    if (!this.data.habit) {
      // habit not yet loaded — signal _loadData to re-invoke once done
      this._pendingAutoCheckin = true;
      return;
    }
    const { timerState, totalSeconds, remainingSeconds } = this.data;
    // 计时进行中时警告，确认后视为取消计时
    if (timerState === 'running' || timerState === 'paused') {
      const confirmed = await new Promise(resolve => {
        wx.showModal({
          title: '取消计时',
          content: '确定取消本次计时并保存打卡记录？',
          confirmText: '取消计时',
          confirmColor: '#EB5757',
          success: res => resolve(res.confirm),
        });
      });
      if (!confirmed) return;
      const consumed = totalSeconds - remainingSeconds;
      this._clearTimer();
      this.setData({
        timerState: 'skip',
        actualSeconds: consumed,
        actualTimeStr: fmtActual(consumed),
      });
    }

    const { habit, note, photos, actualSeconds } = this.data;
    // Capture count BEFORE any async ops — _loadData() started below may update historyItems
    const prevHistoryCount = (this.data.historyItems || []).length;
    this.setData({ saving: true });
    try {
      const db = getDb();
      const duration = actualSeconds > 0 ? Math.max(1, Math.round(actualSeconds / 60)) : null;
      // 保存用户本地打卡时间，解决时区问题
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const minute = String(now.getMinutes()).padStart(2, '0');
      const localTimeStr = `${month}/${day} ${hour}:${minute}`;
      
      await db.collection('checkins').add({
        data: {
          habitId: habit._id,
          date: TODAY(),
          createdAt: new Date(),
          ...(duration !== null ? { duration } : {}),
          note: note || '',
          photos,
          localTimeStr: localTimeStr, // 存储用户当地时间字符串
        },
      });
      invalidateCheckins(habit._id);
      getApp().globalData._needsRefresh = true;
      // Refresh history section immediately (visible in badge-popup case; also primes cache for back-navigation)
      this._loadData().catch(() => {});

      // Check for newly unlocked badges
      let earnedBadge = false;
      try {
        const fullHistory = await getCheckinHistory(habit._id, 400);
        const newBadges = checkAndAward(habit, fullHistory, duration);
        if (newBadges.length > 0) {
          wx.removeStorageSync('ht_pending_badge_notif'); // showing it here, don't double-show on index
          this.setData({ newBadge: newBadges[0], showBadgePopup: true });
          earnedBadge = true;
        }
      } catch (e) { /* non-critical */ }

      recordOptCheckin(habit._id, prevHistoryCount + 1);

      if (!earnedBadge) {
        getApp().globalData._justCheckedHabitId = habit._id;
        setTimeout(() => wx.navigateBack(), 300);
      }
    } catch (e) {
      console.error('onCheckin error:', e);
      const msg = e.errMsg || e.message || JSON.stringify(e);
      wx.showModal({ title: '操作失败', content: msg, showCancel: false });
    } finally {
      this.setData({ saving: false });
    }
  },

  onCloseBadgePopup() {
    this.setData({ showBadgePopup: false });
    getApp().globalData._justCheckedHabitId = this.data.habit ? this.data.habit._id : null;
    wx.navigateBack();
  },

  noop() {},

  onQuickCheckin() {
    this.setData({ timerState: 'skip', actualSeconds: 0, actualTimeStr: '' });
    setTimeout(() => this.onCheckin(), 50);
  },

  onUncheckinItem(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '取消打卡',
      content: '确定取消这条打卡记录吗？',
      confirmText: '取消打卡',
      confirmColor: '#EB5757',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const db = getDb();
          await db.collection('checkins').doc(id).remove();
          invalidateCheckins(this.data.habit._id);
          const remaining = Math.max(0, (this.data.historyItems || []).length - 1);
          recordOptCheckin(this.data.habit._id, remaining); // 0 means explicitly unchecked
          const app = getApp();
          app.globalData._needsRefresh = true;
          app.globalData._confettiDate = null;
          wx.navigateBack();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'error' });
        }
      },
    });
  },

  onEditHistItem(e) {
    const { id } = e.currentTarget.dataset;
    const item = (this.data.historyItems || []).find(h => h._id === id);
    if (!item) return;
    this.setData({
      editingHistId: id,
      editingNote: item.note || '',
      editingMinutes: item.rawMinutes ? String(item.rawMinutes) : '',
      editingPhotos: [...(item.photos || [])],
    });
  },

  onHideEditItem() {
    this.setData({ editingHistId: '', editingNote: '', editingMinutes: '', editingPhotos: [] });
  },

  onEditNoteInput(e) {
    this.setData({ editingNote: e.detail.value });
  },

  onEditMinutesInput(e) {
    this.setData({ editingMinutes: e.detail.value });
  },

  async onAddEditPhoto() {
    if (this.data.uploadingEditPhoto) return;
    try {
      const res = await wx.chooseMedia({
        count: 9 - this.data.editingPhotos.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });
      if (!res.tempFiles || res.tempFiles.length === 0) return;
      this.setData({ uploadingEditPhoto: true });
      wx.showLoading({ title: '上传中...' });
      const uploaded = [];
      for (const file of res.tempFiles) {
        // 第一步：前端本地压缩图片
        let compressedPath = file.tempFilePath;
        try {
          const compressRes = await wx.compressImage({
            src: file.tempFilePath,
            quality: 80, // 80%质量兼顾大小和清晰度
          });
          compressedPath = compressRes.tempFilePath;
        } catch (e) {
          console.error('Compress image error:', e);
        }
        
        const ext = (compressedPath.match(/\.(\w+)$/) || ['', 'jpg'])[1];
        const cloudPath = `checkin-photos/${this._habitId}/${TODAY()}/${Date.now()}.${ext}`;
        const upRes = await wx.cloud.uploadFile({ cloudPath, filePath: compressedPath });
        uploaded.push(upRes.fileID);
      }
      wx.hideLoading();
      this.setData({ editingPhotos: [...this.data.editingPhotos, ...uploaded], uploadingEditPhoto: false });
    } catch (e) {
      wx.hideLoading();
      this.setData({ uploadingEditPhoto: false });
      if (!(e.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    }
  },

  onRemoveEditPhoto(e) {
    const { index } = e.currentTarget.dataset;
    const editingPhotos = this.data.editingPhotos.filter((_, i) => i !== Number(index));
    this.setData({ editingPhotos });
  },

  onPreviewEditPhoto(e) {
    const { index } = e.currentTarget.dataset;
    wx.previewImage({ current: this.data.editingPhotos[index], urls: this.data.editingPhotos });
  },

  async onSaveHistItem() {
    const { editingHistId, editingNote, editingMinutes, editingPhotos, savingEdit } = this.data;
    if (!editingHistId || savingEdit) return;
    this.setData({ savingEdit: true });
    try {
      const db = getDb();
      const mins = parseInt(editingMinutes);
      const update = {
        note: editingNote.trim(),
        photos: editingPhotos,
      };
      if (mins > 0) update.duration = mins;
      else update.duration = null;
      await db.collection('checkins').doc(editingHistId).update({ data: update });
      invalidateCheckins(this.data.habit._id);
      this.setData({ editingHistId: '', editingNote: '', editingMinutes: '', editingPhotos: [], savingEdit: false });
      this._loadData().catch(() => {});
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      this.setData({ savingEdit: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
