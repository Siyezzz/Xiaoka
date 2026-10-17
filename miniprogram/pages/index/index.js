const { getHabits, getAllHabits, getTodayCheckins, addCheckin, isDueToday, invalidateHabits, invalidateCheckins, getOptCheckins, recordOptCheckin } = require('../../utils/db');
const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

const BAR_THEMES = [
  { gradient: 'linear-gradient(90deg, #6EE7C0, #3AC99E)', shadow: 'rgba(58,201,158,0.45)' },
  { gradient: 'linear-gradient(90deg, #A8E6D4, #56CCF2)', shadow: 'rgba(86,204,242,0.40)' },
  { gradient: 'linear-gradient(90deg, #FCCFE8, #D4B0F0)', shadow: 'rgba(212,176,240,0.42)' },
  { gradient: 'linear-gradient(90deg, #FFE3A3, #FFB997)', shadow: 'rgba(255,185,151,0.45)' },
  { gradient: 'linear-gradient(90deg, #B3D9FF, #8EC5FC)', shadow: 'rgba(142,197,252,0.45)' },
  { gradient: 'linear-gradient(90deg, #FFCDD2, #FFE082, #C8E6C9, #B3E0FF, #E1BEE7)', shadow: 'rgba(200,230,201,0.45)' },
];

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(s) { return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }

const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
// 撒花颜色配置
const CONFETTI_COLORS = [
  '#FFD700', // 金色
  '#FF6B6B', // 珊瑚红
  '#4ECDC4', // 蒂芙尼蓝
  '#95E1D3', // 薄荷绿
  '#F38181', // 浅粉红
  '#AA96DA', // 浅紫色
  '#FCB43A', // 橙黄
  '#FF8C94'  // 粉红
];

Page({
  data: {
    statusBarHeight: _statusBarHeight,
    dateStr: '',
    weekDay: '',
    greeting: '',
    habits: [],
    freeHabits: [],
    checkins: [],
    progress: 0,
    doneCount: 0,
    totalCount: 0,
    allDoneStreak: 0,
    loading: true,
    isRefreshing: false,
    barThemeIdx: 0,
    barGradient: BAR_THEMES[0].gradient,
    barShadow: BAR_THEMES[0].shadow,
  },

  onLoad() {
    wx.showShareMenu({ menus: ['shareAppMessage'] });
    this._initDate();
    this.setData({ allDoneStreak: wx.getStorageSync('ht_all_done_streak') || 0 });
    const savedIdx = Number(wx.getStorageSync('ht_bar_theme') || 0);
    const theme = BAR_THEMES[savedIdx] || BAR_THEMES[0];
    this.setData({ barThemeIdx: savedIdx, barGradient: theme.gradient, barShadow: theme.shadow });
    if (!wx.getStorageSync('ht_onboarding_done')) {
      // Delay so createUser cloud call can complete and mark existing users as done
      setTimeout(() => {
        if (!wx.getStorageSync('ht_onboarding_done')) {
          wx.navigateTo({ url: '/pages/tutorial/index' });
        }
      }, 1200);
    }
  },

  onShareAppMessage() {
    const app = getApp();
    const code = app.globalData.customId || '';
    const name = app.globalData.displayName || '好友';
    return {
      title: `${name} 邀请你一起元气打卡！`,
      path: `/pages/social/index?fromUid=${code}`,
    };
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    getApp().refreshSocialBadge();
    // Clear any old pending badge notifications (popup removed)
    wx.removeStorageSync('ht_pending_badge_notif');
    // 立即同步刷新计时器状态（无需等网络）
    if (this.data.habits.length > 0 || this.data.freeHabits.length > 0) {
      const mainCount = this.data.habits.length;
      const allWithTimer = this._readTimerStates([...this.data.habits, ...this.data.freeHabits]);
      this.setData({ habits: allWithTimer.slice(0, mainCount), freeHabits: allWithTimer.slice(mainCount) });
      this._startTimerTick();
    }
    const app = getApp();
    if (app.globalData._needsRefresh) {
      app.globalData._needsRefresh = false;
    }
    invalidateCheckins(); // always fetch fresh checkins on every show — avoids stale cache after tab switch
    if (app.globalData._justCheckedHabitId) {
      this._pendingAnimHabitId = app.globalData._justCheckedHabitId;
      app.globalData._justCheckedHabitId = null;
    }
    this._isLoading = false; // allow fresh load even if previous fetch was still in-flight
    this._loadData();
  },

  onHide() {
    this._stopTimerTick();
  },

  async onPullDownRefresh() {
    invalidateHabits();
    invalidateCheckins();
    this._isLoading = false;
    await this._loadData();
    wx.stopPullDownRefresh();
  },

  async onRefresh() {
    this.setData({ isRefreshing: true });
    invalidateHabits();
    invalidateCheckins();
    this._isLoading = false;
    await this._loadData();
    this.setData({ isRefreshing: false });
  },

  onTapBarTheme() {
    const nextIdx = (this.data.barThemeIdx + 1) % BAR_THEMES.length;
    const theme = BAR_THEMES[nextIdx];
    wx.setStorageSync('ht_bar_theme', nextIdx);
    this.setData({ barThemeIdx: nextIdx, barGradient: theme.gradient, barShadow: theme.shadow });
  },

  _initDate() {
    const now = new Date();
    const month = MONTHS[now.getMonth()];
    const day = now.getDate();
    const weekDay = WEEK_DAYS[now.getDay()];
    const hour = now.getHours();
    let greeting = '晚上好，今天辛苦了 🌙';
    if (hour < 6) greeting = '夜深了，早点休息吧 🌛';
    else if (hour < 11) greeting = '早安，新的一天，元气满满 ☀️';
    else if (hour < 14) greeting = '中午好，记得吃饭哦 🍗';
    else if (hour < 18) greeting = '下午好，休息一下，多喝水 🌈';
    this.setData({ dateStr: `${month}${day}日`, weekDay, greeting });
  },



  async _loadData() {
    if (this._isLoading) return;
    this._isLoading = true;
    if (this.data.habits.length === 0) this.setData({ loading: true });
    try {
      const [habits, allHabits, checkins] = await Promise.all([getHabits(), getAllHabits(), getTodayCheckins()]);
      const checkinCountMap = {};
      const checkinDurationMap = {};
      const recentPhotoMap = {};
      checkins.forEach(c => {
        checkinCountMap[c.habitId] = (checkinCountMap[c.habitId] || 0) + 1;
        if (c.duration > 0) checkinDurationMap[c.habitId] = (checkinDurationMap[c.habitId] || 0) + c.duration;
        if (c.photos && c.photos.length > 0) {
          recentPhotoMap[c.habitId] = [...(recentPhotoMap[c.habitId] || []), ...c.photos];
        }
      });
      const durFields = (id) => {
        const min = checkinDurationMap[id] || 0;
        if (!min) return { todayDuration: 0, durPct: 0, durLabel: '' };
        const label = min < 60 ? `${min}min` : min % 60 === 0 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 60)}h${min % 60}min`;
        return { todayDuration: min, durPct: Math.min(Math.round(min / 60 * 100), 100), durLabel: label };
      };

      const freqLabel = h => {
        if (!h.frequency) return '每天';
        if (h.frequency.type === 'daily') return '每天';
        if (h.frequency.type === 'free') return '自由打卡';
        return `每周${(h.frequency.days || []).length}天`;
      };

      // Local optimistic checkins override stale DB reads
      const optCheckins = getOptCheckins();
      const applyOpt = (h) => {
        const c = optCheckins[h._id];
        if (c === undefined) return h;
        if (c === 0) return { ...h, checked: false, todayCount: 0 };
        return { ...h, checked: true, todayCount: Math.max(h.todayCount || 0, c) };
      };

      const allDueToday = habits.filter(h => isDueToday(h));
      const regularToday = allDueToday
        .filter(h => h.frequency.type !== 'free')
        .map(h => applyOpt({ ...h, checked: (checkinCountMap[h._id] || 0) > 0, todayCount: checkinCountMap[h._id] || 0, isArchived: false, freqLabel: freqLabel(h), todayPhotos: recentPhotoMap[h._id] || [], ...durFields(h._id) }));
      const freeToday = allDueToday
        .filter(h => h.frequency.type === 'free')
        .map(h => applyOpt({ ...h, checked: (checkinCountMap[h._id] || 0) > 0, todayCount: checkinCountMap[h._id] || 0, isArchived: false, freqLabel: freqLabel(h), todayPhotos: recentPhotoMap[h._id] || [], ...durFields(h._id) }));

      // Soft-deleted habits that were already checked in today
      const activeIds = new Set(habits.map(h => h._id));
      const archivedToday = allHabits
        .filter(h => h.isActive === false && !activeIds.has(h._id) && checkinCountMap[h._id])
        .map(h => ({ ...h, checked: true, todayCount: checkinCountMap[h._id] || 0, isArchived: true, freqLabel: freqLabel(h), ...durFields(h._id) }));

      // Progress only counts regular + archived (not free)
      const doneCount = [...regularToday, ...archivedToday].filter(h => h.checked).length;
        const totalCount = regularToday.length + archivedToday.length;
        const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
      const prevProgress = this.data.progress;

      const mainCount = regularToday.length + archivedToday.length;
      const allWithTimer = this._readTimerStates([...regularToday, ...archivedToday, ...freeToday]);

      // Preserve in-progress lightup animations — also keep optimistic checked:true
      // if the DB hasn't committed the write yet (race condition guard)
      const curHabits = this.data.habits;
      const curFree = this.data.freeHabits;
      const mergeOne = (h, cur) => {
        if (!cur || !cur.lightup) return h;
        const merged = { ...h, lightup: true };
        if (cur.checked && !h.checked) merged.checked = true; // optimistic wins over stale DB
        return merged;
      };
      const mergedHabits = allWithTimer.slice(0, mainCount).map(h =>
        mergeOne(h, curHabits.find(c => c._id === h._id))
      );
      const mergedFree = allWithTimer.slice(mainCount).map(h =>
        mergeOne(h, curFree.find(c => c._id === h._id))
      );
      
      this.setData({
        habits: mergedHabits,
        freeHabits: mergedFree,
        checkins, doneCount, totalCount, progress, loading: false,
      });
      this._startTimerTick();

      // Persist today's progress to the user profile so friends can read it without querying
      // all checkins. Date-isolated: if today has no entry the value is 0 (automatic reset).
      wx.cloud.callFunction({
        name: 'users',
        data: { action: 'updateTodayProgress', done: doneCount, total: totalCount },
      }).then(res => {
        const streak = (res && res.result && res.result.allDoneStreak) || 0;
        wx.setStorageSync('ht_all_done_streak', streak);
        this.setData({ allDoneStreak: streak });
      }).catch(() => {});

      // If returning from habit-checkin: wait for back-slide transition (~300ms) then animate
      const pendingId = this._pendingAnimHabitId;
      if (pendingId) {
        this._pendingAnimHabitId = null;
        setTimeout(() => {
          this._triggerCheckinAnim(pendingId);
          if (progress === 100 && prevProgress < 100) {
            this._launchConfetti();
          }
        }, 380);
      }
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
    } finally {
      this._isLoading = false;
    }
  },

  async onCheckin(e) {
    const { id } = e.currentTarget.dataset;
    let habit = this.data.habits.find(h => h._id === id);
    const isFree = !habit;
    if (isFree) habit = this.data.freeHabits.find(h => h._id === id);
    if (!habit || habit.isArchived) return;
    const wasAllDone = this.data.habits.every(h => h.checked);

    if (isFree) {
      const freeHabits = this.data.freeHabits.map(h =>
        h._id !== id ? h : { ...h, checked: true, todayCount: (h.todayCount || 0) + 1, lightup: true }
      );
      this.setData({ freeHabits });
      setTimeout(() => {
        const updated = this.data.freeHabits.map(h => h._id !== id ? h : { ...h, lightup: false });
        this.setData({ freeHabits: updated });
      }, 1200);
    } else {
      const habits = this.data.habits.map(h =>
        h._id !== id ? h : { ...h, checked: true, todayCount: (h.todayCount || 0) + 1, lightup: true }
      );
      const doneCount = habits.filter(h => h.checked).length;
      const totalCount = habits.length;
      const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
      const allDone = doneCount === totalCount && totalCount > 0;
      this.setData({ habits, doneCount, totalCount, progress });
      if (allDone && !wasAllDone) this._launchConfetti();
      setTimeout(() => {
        const updated = this.data.habits.map(h => h._id !== id ? h : { ...h, lightup: false });
        this.setData({ habits: updated });
      }, 1200);
    }

    recordOptCheckin(id, (habit.todayCount || 0) + 1);

    try {
      await addCheckin(id);
      getApp().globalData._needsRefresh = true;
      // Push updated progress immediately so friends see it without waiting for next _loadData
      const { doneCount: dc, totalCount: tc } = this.data;
      wx.cloud.callFunction({
        name: 'users',
        data: { action: 'updateTodayProgress', done: dc, total: tc },
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '打卡失败，请重试', icon: 'none' });
      this._isLoading = false;
      this._loadData();
    }
  },

  _launchConfetti() {
    const app = getApp();
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (app.globalData._confettiDate === todayKey) return;
    app.globalData._confettiDate = todayKey;
    wx.showToast({ title: '今日打卡全部完成！🎉', icon: 'none', duration: 2500 });
    wx.createSelectorQuery().in(this)
      .select('#confettiCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;
        const W = info.windowWidth;
        const H = info.windowHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);
        this._runConfetti(canvas, ctx, W, H);
      });
  },

  _runConfetti(canvas, ctx, W, H) {
    const rand = (a, b) => a + Math.random() * (b - a);

    // 生成粒子（飘带 + 圆点 + 小方块）
    const particles = Array.from({ length: 160 }, () => {
      const shape = Math.floor(Math.random() * 3); // 0=ribbon, 1=circle, 2=square
      return {
        x: rand(W * 0.05, W * 0.95),
        y: rand(-180, -10),
        vx: rand(-1.2, 1.2),
        vy: rand(0.6, 2.6),
        w: shape === 1 ? rand(5, 9) : (shape === 2 ? rand(7, 11) : rand(4, 7)),
        h: shape === 0 ? rand(18, 38) : null,
        rot: rand(0, Math.PI * 2),
        vrot: rand(-0.035, 0.035),
        shape,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      };
    });

    const start = Date.now();
    const DURATION = 5800;
    const GRAVITY = 0.038;
    const FADE_AT = DURATION * 0.58;

    const animate = () => {
      const elapsed = Date.now() - start;
      ctx.clearRect(0, 0, W, H);
      if (elapsed < DURATION) {
        const alpha = elapsed > FADE_AT
          ? Math.max(0, 1 - (elapsed - FADE_AT) / (DURATION - FADE_AT))
          : 1;
        ctx.globalAlpha = alpha;
        particles.forEach(p => {
          p.vx += rand(-0.018, 0.018);
          p.x += p.vx;
          p.y += p.vy;
          p.vy += GRAVITY;
          p.vx *= 0.999;
          p.rot += p.vrot;
          if (p.y > H + 60 || p.x < -60 || p.x > W + 60) return;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.shape === 1) {
            ctx.beginPath();
            ctx.arc(0, 0, p.w, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.shape === 2) {
            ctx.fillRect(-p.w / 2, -p.w / 2, p.w, p.w);
          } else {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          }
          ctx.restore();
        });
        ctx.globalAlpha = 1;
        canvas.requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, W, H);
      }
    };

    canvas.requestAnimationFrame(animate);
  },

  _triggerCheckinAnim(id) {
    const applyTo = (arr, key, updateProgress) => {
      const idx = arr.findIndex(h => h._id === id);
      if (idx === -1) return false;
      const h = arr[idx];
      // Optimistically ensure checked + todayCount regardless of DB propagation speed
      const todayCount = Math.max((h.todayCount || 0), 1);
      const updated = arr.map(habit =>
        habit._id !== id ? habit : { ...habit, checked: true, todayCount, lightup: true }
      );
      const patch = { [key]: updated };
      if (updateProgress) {
        const doneCount = updated.filter(h2 => h2.checked).length;
        const totalCount = updated.length;
        patch.doneCount = doneCount;
        patch.totalCount = totalCount;
        patch.progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
      }
      this.setData(patch);
      setTimeout(() => {
        this.setData({ [key]: this.data[key].map(h2 => h2._id !== id ? h2 : { ...h2, lightup: false }) });
      }, 1200);
      return true;
    };
    if (!applyTo(this.data.habits, 'habits', true)) {
      applyTo(this.data.freeHabits, 'freeHabits', false);
    }
  },

  _readTimerStates(habits) {
    this._timerData = {};
    return habits.map(h => {
      const state = wx.getStorageSync(`ht_state_${h._id}`);
      if (!state) return { ...h, timerState: null, timerDisplay: '' };
      const total = wx.getStorageSync(`ht_total_${h._id}`);
      if (!total) return { ...h, timerState: null, timerDisplay: '' };
      if (state === 'running') {
        const startTs = wx.getStorageSync(`ht_ts_${h._id}`);
        if (!startTs) return { ...h, timerState: null, timerDisplay: '' };
        const remaining = Math.max(0, total - Math.floor((Date.now() - startTs) / 1000));
        this._timerData[h._id] = { startTs, total };
        return { ...h, timerState: 'running', timerDisplay: fmtTime(remaining) };
      } else if (state === 'paused') {
        const remaining = wx.getStorageSync(`ht_remaining_${h._id}`) || 0;
        return { ...h, timerState: 'paused', timerDisplay: fmtTime(remaining) };
      }
      return { ...h, timerState: null, timerDisplay: '' };
    });
  },

  _startTimerTick() {
    this._stopTimerTick();
    const allH = [...this.data.habits, ...this.data.freeHabits];
    if (!allH.some(h => h.timerState === 'running')) return;
    this._timerInterval = setInterval(() => {
      const updates = {};
      let anyRunning = false;
      const tick = (arr, key) => {
        arr.forEach((h, i) => {
          if (h.timerState !== 'running') return;
          const td = this._timerData && this._timerData[h._id];
          if (!td) return;
          const remaining = Math.max(0, td.total - Math.floor((Date.now() - td.startTs) / 1000));
          if (remaining <= 0) {
            updates[`${key}[${i}].timerState`] = null;
            updates[`${key}[${i}].timerDisplay`] = '';
            delete this._timerData[h._id];
          } else {
            updates[`${key}[${i}].timerDisplay`] = fmtTime(remaining);
            anyRunning = true;
          }
        });
      };
      tick(this.data.habits, 'habits');
      tick(this.data.freeHabits, 'freeHabits');
      if (Object.keys(updates).length) this.setData(updates);
      if (!anyRunning) this._stopTimerTick();
    }, 1000);
  },

  _stopTimerTick() {
    if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
  },

  onPreviewTodayPhoto(e) {
    const { habitid, index } = e.currentTarget.dataset;
    const habit = [...this.data.habits, ...this.data.freeHabits].find(h => h._id === habitid);
    if (!habit || !habit.todayPhotos || !habit.todayPhotos.length) return;
    wx.previewImage({ current: habit.todayPhotos[Number(index)], urls: habit.todayPhotos });
  },

  onHabitTap(e) {
    const { id, color } = e.currentTarget.dataset;
    const habit = this.data.habits.find(h => h._id === id) || this.data.freeHabits.find(h => h._id === id);
    if (!habit || habit.isArchived) return;
    wx.navigateTo({ url: `/pages/habit-checkin/index?habitId=${id}&color=${encodeURIComponent(color || '#45C5A0')}` });
  },

  onAddHabit() {
    wx.navigateTo({ url: '/pages/add-habit/index' });
  },

});
