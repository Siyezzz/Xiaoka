const { getAllHabits, getCheckinHistory, getCheckinsByDateRange, calcStreak, recoverHabit, hardDeleteHabit, invalidateHabits, invalidateCheckins } = require('../../utils/db');
const { BADGES, checkAndAward, getHabitBadges } = require('../../utils/badges');
const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function weeklyAchievement(minutes) {
  if (minutes >= 3000) return '🤩'; // 50h
  if (minutes >= 1800) return '👍'; // 30h
  if (minutes >= 600)  return '☀️'; // 10h
  if (minutes >= 180)  return '❤️'; // 3h
  return '';
}

Page({
  data: {
    habits: [],
    activeHabits: [],
    deletedHabits: [],
    deletedExpanded: false,
    selectedHabit: null,
    selectedHabitId: null,
    streak: 0,
    bestStreak: 0,
    totalCheckins: 0,
    completionRate: 0,
    habitBadges: [],
    displayBadge: null,
    displayBadgeIndex: 0,
    earnedBadgeCount: 0,
    showBadgePicker: false,
    weeklyView: 'total',
    weeklyBars: [],
    weeklyTotalDuration: 0,
    weeklyAchievement: '',
    weeklyDailyDurations: [],
    calendarDays: [],
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarMonthStr: '',
    calendarNextDisabled: true,
    loading: true,
    statsLoading: false,
    weeklyViewToggling: false,
    selectedDay: null,
    selectedDayLabel: '',
    dayDetails: [],
    sheetListHeight: 320,
    statusBarHeight: _statusBarHeight,
  },

  _histories: {},   // { habitId: checkins[] } for streak/stats
  _monthCache: {},  // { 'YYYY-M': { habitId: checkins[] } } for calendar

  onLoad() {
    wx.showShareMenu({ menus: ['shareAppMessage'] });
  },

  onShareAppMessage() {
    const app = getApp();
    const code = app.globalData.customId || '';
    const name = app.globalData.displayName || '我的小伙伴';
    return {
      title: `${name} 邀请你一起元气打卡！`,
      path: code ? `/pages/social/index?code=${code}` : '/pages/index/index',
    };
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    getApp().refreshSocialBadge();
    // Always reload — getAllHabits() has a 60s in-memory cache so this won't
    // hit the DB on every tab switch. Avoids stale habit list when a new
    // habit was added (the _needsRefresh flag gets consumed by the habits page
    // before stats can see it, so the 5s throttle would leave stats stale).
    this._loadData();
  },

  async onPullDownRefresh() {
    invalidateHabits();
    invalidateCheckins();
    this._lastLoadTime = 0;
    this._monthCache = {};
    this._histories = {};
    await this._loadData();
    wx.stopPullDownRefresh();
  },

  async _loadData() {
    if (this.data.habits.length === 0) this.setData({ loading: true });
    try {
      const habits = await getAllHabits();
      if (habits.length === 0) {
        this.setData({ habits: [], activeHabits: [], deletedHabits: [], loading: false });
        return;
      }

      const activeHabits = habits.filter(h => h.isActive !== false);
      const deletedHabits = habits.filter(h => h.isActive === false);

      const now = new Date();
      const calendarYear = now.getFullYear();
      const calendarMonth = now.getMonth() + 1;

      this._monthCache = {};
      this._histories = {};

      this.setData({
        habits,
        activeHabits,
        deletedHabits,
        calendarYear,
        calendarMonth,
        calendarMonthStr: `${calendarYear}年${calendarMonth}月`,
        calendarNextDisabled: true,
      });

      const prevId = this.data.selectedHabitId;
      const preferred = habits.find(h => h._id === prevId);
      const firstId = preferred ? prevId : (activeHabits[0] || habits[0])._id;

      await Promise.all([
        this._reloadCalendar(),
        this._loadHabitStats(firstId),
      ]);
      this._lastLoadTime = Date.now();
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
    }
  },

  async _reloadCalendar() {
    const { calendarYear, calendarMonth, habits } = this.data;
    const key = `${calendarYear}-${calendarMonth}`;

    if (!this._monthCache[key]) {
      const startDate = `${calendarYear}-${pad(calendarMonth)}-01`;
      const lastDay = new Date(calendarYear, calendarMonth, 0).getDate();
      const endDate = `${calendarYear}-${pad(calendarMonth)}-${pad(lastDay)}`;
      const allHistories = await Promise.all(
        habits.map(h => getCheckinsByDateRange(h._id, startDate, endDate))
      );
      const monthData = {};
      habits.forEach((h, i) => { monthData[h._id] = allHistories[i]; });
      this._monthCache[key] = monthData;
    }

    const calendarDays = this._buildMonthCalendar(
      calendarYear, calendarMonth, habits, this._monthCache[key]
    );
    this.setData({ calendarDays });
  },

  _buildMonthCalendar(year, month, habits, monthData) {
    const dateMap = {};
    habits.forEach(habit => {
      const seen = new Set();
      (monthData[habit._id] || []).forEach(c => {
        if (seen.has(c.date)) return; // one dot per habit per day
        seen.add(c.date);
        if (!dateMap[c.date]) dateMap[c.date] = [];
        dateMap[c.date].push({ color: habit.color });
      });
    });

    const todayStr = dateStr(new Date());
    const firstDow = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    const result = [];
    for (let i = 0; i < firstDow; i++) {
      result.push({ _key: result.length, isPadding: true, date: '', day: '', dots: [], extra: 0 });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${pad(month)}-${pad(d)}`;
      const isFuture = ds > todayStr;
      const dots = isFuture ? [] : (dateMap[ds] || []).slice(0, 16);
      const extra = isFuture ? 0 : Math.max(0, (dateMap[ds] || []).length - 16);
      result.push({ _key: result.length, date: ds, day: d, isToday: ds === todayStr, isPadding: false, isFuture, dots, extra });
    }
    while (result.length % 7 !== 0) {
      result.push({ _key: result.length, isPadding: true, date: '', day: '', dots: [], extra: 0 });
    }
    return result;
  },

  async onPrevMonth() {
    let { calendarYear, calendarMonth } = this.data;
    calendarMonth--;
    if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
    const now = new Date();
    const calendarNextDisabled = calendarYear === now.getFullYear() && calendarMonth === now.getMonth() + 1;
    this.setData({
      calendarYear,
      calendarMonth,
      calendarMonthStr: `${calendarYear}年${calendarMonth}月`,
      calendarNextDisabled,
    });
    await this._reloadCalendar();
  },

  async onNextMonth() {
    if (this.data.calendarNextDisabled) return;
    let { calendarYear, calendarMonth } = this.data;
    calendarMonth++;
    if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
    const now = new Date();
    const calendarNextDisabled = calendarYear === now.getFullYear() && calendarMonth === now.getMonth() + 1;
    this.setData({
      calendarYear,
      calendarMonth,
      calendarMonthStr: `${calendarYear}年${calendarMonth}月`,
      calendarNextDisabled,
    });
    await this._reloadCalendar();
  },

  async _loadHabitStats(habitId) {
    const { habits } = this.data;
    const habit = habits.find(h => h._id === habitId);
    if (!habit) return;

    if (!this._histories[habitId]) {
      this._histories[habitId] = await getCheckinHistory(habitId, 90);
    }
    const checkins = this._histories[habitId];
    const checkinDates = new Set(checkins.map(c => c.date));

    const streak = calcStreak(habit, checkins);
    const bestStreak = this._calcBestStreak(habit, checkins);
    const totalCheckins = checkins.length;
    const weeklyBars = this._buildWeeklyBars(habit, checkinDates);
    const weeklyDailyDurations = this._buildWeeklyDurations(checkins, habit.color);
    const weeklyTotalDuration = weeklyDailyDurations.reduce((s, d) => s + d.duration, 0);

    let dueDays = 0, doneDays = 0;
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const due = habit.frequency.type === 'daily' || habit.frequency.type === 'free' || (habit.frequency.days || []).includes(d.getDay());
      if (!due) continue;
      dueDays++;
      if (checkinDates.has(dateStr(d))) doneDays++;
    }
    const completionRate = dueDays > 0 ? Math.round((doneDays / dueDays) * 100) : 0;

    checkAndAward(habit, checkins, null);
    const habitBadges = getHabitBadges();
    const earnedBadgeCount = habitBadges.length;
    const savedId = wx.getStorageSync('ht_display_badge_id') || null;
    const savedIndex = savedId ? habitBadges.findIndex(b => b.id === savedId) : -1;
    let displayBadgeIndex;
    if (savedIndex >= 0) {
      displayBadgeIndex = savedIndex;
    } else if (habitBadges.length > 0) {
      // Auto-select the highest-level earned badge (highest position in BADGES progression)
      let topIdx = 0, topLevel = -1;
      habitBadges.forEach((b, i) => {
        const level = BADGES.findIndex(def => def.id === b.id);
        if (level > topLevel) { topLevel = level; topIdx = i; }
      });
      displayBadgeIndex = topIdx;
    } else {
      displayBadgeIndex = 0;
    }
    const displayBadge = habitBadges[displayBadgeIndex] || null;

    this.setData({
      selectedHabit: habit,
      selectedHabitId: habitId,
      streak,
      bestStreak,
      totalCheckins,
      completionRate,
      weeklyBars,
      weeklyTotalDuration,
      weeklyAchievement: weeklyAchievement(weeklyTotalDuration),
      weeklyDailyDurations,
      habitBadges,
      displayBadge,
      displayBadgeIndex,
      earnedBadgeCount,
      loading: false,
      statsLoading: false,
    });
  },

  _calcBestStreak(habit, checkins) {
    const checkinDates = new Set(checkins.map(c => c.date));
    let best = 0, current = 0;
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const due = habit.frequency.type === 'daily' || habit.frequency.type === 'free' || (habit.frequency.days || []).includes(d.getDay());
      if (!due) continue;
      if (checkinDates.has(dateStr(d))) { current++; if (current > best) best = current; }
      else current = 0;
    }
    return best;
  },

  _buildWeeklyBars(habit, checkinDates) {
    const LABELS = ['日', '一', '二', '三', '四', '五', '六'];
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - i));
      const due = habit.frequency.type === 'daily' || habit.frequency.type === 'free' || (habit.frequency.days || []).includes(d.getDay());
      return {
        label: LABELS[d.getDay()],
        due,
        done: checkinDates.has(dateStr(d)),
        isToday: i === 6,
      };
    });
  },

  _buildWeeklyDurations(checkins, color) {
    // Fixed Mon–Sun display order (一 through 日)
    const LABELS = ['一', '二', '三', '四', '五', '六', '日'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = dateStr(today);
    // Monday of current week (JS getDay: 0=Sun,1=Mon,...,6=Sat)
    const wd = today.getDay();
    const daysFromMon = wd === 0 ? 6 : wd - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysFromMon);
    const durationByDate = {};
    checkins.forEach(c => {
      durationByDate[c.date] = (durationByDate[c.date] || 0) + (c.duration || 0);
    });
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = dateStr(d);
      const isFuture = ds > todayStr;
      const isToday = ds === todayStr;
      return { label: LABELS[i], duration: isFuture ? 0 : (durationByDate[ds] || 0), isToday, isFuture };
    });
    const maxDur = Math.max(...days.map(d => d.duration), 1);
    return days.map(d => {
      const barPct = Math.round((d.duration / maxDur) * 100);
      return { ...d, barPct, barStyle: `height: ${barPct}%; background: ${color};` };
    });
  },

  onOpenBadgePicker() {
    if (this.data.habitBadges.length === 0) return;
    this.setData({ showBadgePicker: true });
  },

  onCloseBadgePicker() {
    this.setData({ showBadgePicker: false });
  },

  onSelectDisplayBadge(e) {
    const index = Number(e.currentTarget.dataset.index);
    const badge = this.data.habitBadges[index];
    if (badge) wx.setStorageSync('ht_display_badge_id', badge.id);
    this.setData({
      displayBadgeIndex: index,
      displayBadge: badge,
      showBadgePicker: false,
    });
  },

  onToggleDeletedFolder() {
    this.setData({ deletedExpanded: !this.data.deletedExpanded });
  },

  onToggleWeeklyView() {
    this.setData({ weeklyView: this.data.weeklyView === 'total' ? 'daily' : 'total', weeklyViewToggling: true });
    setTimeout(() => this.setData({ weeklyViewToggling: false }), 450);
  },

  onSelectHabit(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.selectedHabitId) return;
    const habit = this.data.habits.find(h => h._id === id);
    if (habit) this.setData({ selectedHabitId: id, selectedHabit: habit, statsLoading: true });
    this._loadHabitStats(id);
  },

  onDayTap(e) {
    const { date } = e.currentTarget.dataset;
    if (!date) return;
    const { habits, calendarYear, calendarMonth } = this.data;
    const key = `${calendarYear}-${calendarMonth}`;
    const monthData = this._monthCache[key];
    if (!monthData) return;

    const [, m, d] = date.split('-');
    const selectedDayLabel = `${parseInt(m)}月${parseInt(d)}日`;

    const dayDetails = habits.map(h => {
      const checkin = (monthData[h._id] || []).find(c => c.date === date);
      return {
        _id: h._id,
        name: h.name,
        icon: h.icon,
        color: h.color,
        done: !!checkin,
        duration: checkin ? (checkin.duration || 0) : 0,
        note: checkin ? (checkin.note || '') : '',
      };
    });

    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = info.windowWidth / 750;
    const itemH = Math.round(140 * ratio);
    const spacerH = Math.round(60 * ratio);
    const maxH = Math.round(info.windowHeight * 0.75) - Math.round(130 * ratio);
    const sheetListHeight = Math.min(dayDetails.length * itemH + spacerH, maxH);

    this.setData({ selectedDay: date, selectedDayLabel, dayDetails, sheetListHeight });
  },

  onCloseDayDetail() {
    this.setData({ selectedDay: null });
  },

  onRecoverHabit(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '恢复习惯',
      content: `将「${name}」恢复为活跃习惯，打卡记录和提醒设置均保留。`,
      confirmText: '恢复',
      confirmColor: '#45C5A0',
      success: async res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '恢复中...' });
        try {
          await recoverHabit(id);
          invalidateHabits();
          this._monthCache = {};
          this._histories = {};
          await this._loadData();
          wx.hideLoading();
          wx.showToast({ title: '已恢复', icon: 'success' });
          getApp().globalData._needsRefresh = true;
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '恢复失败', icon: 'none' });
        }
      },
    });
  },

  onHardDeleteHabit(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '彻底删除',
      content: `将删除「${name}」及全部打卡记录，日历上的颜色也会消失，无法恢复。确定吗？`,
      confirmText: '彻底删除',
      confirmColor: '#FF6B6B',
      success: async res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        try {
          await hardDeleteHabit(id);
          this._monthCache = {};
          this._histories = {};
          await this._loadData();
          wx.hideLoading();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  noop() {},
});
