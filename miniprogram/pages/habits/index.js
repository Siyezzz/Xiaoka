const { getHabits, deleteHabit, hardDeleteHabit, isDueToday, getCheckinHistory, calcStreak, invalidateHabits, invalidateCheckins, updateHabit } = require('../../utils/db');
const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

const AUTHOR_OPENID = 'oCzFz3fJmDAZLGJGf0I31CmF8w_c';

Page({
  data: {
    habits: [],
    loading: true,
    manageMode: false,
    statusBarHeight: _statusBarHeight,
    isAuthor: false,
    inboxUnreadCount: 0,
    dragIdx: -1,
    dragging: false,
    dragLastY: 0,
  },

  onLoad() {
    wx.showShareMenu({ menus: ['shareAppMessage'] });
    this._checkAuthor(0);
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._windowHeight = sys.windowHeight;
    this._scrollTop = 0;
  },

  onPageScroll(e) {
    this._scrollTop = e.scrollTop;
  },

  _checkAuthor(tries) {
    const openid = getApp().globalData.openid;
    if (openid) {
      this.setData({ isAuthor: openid === AUTHOR_OPENID });
    } else if (tries < 10) {
      setTimeout(() => this._checkAuthor(tries + 1), 400);
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

  async onPullDownRefresh() {
    if (this._isDragging) {
      wx.stopPullDownRefresh();
      return;
    }
    invalidateHabits();
    invalidateCheckins();
    this._lastLoadTime = 0;
    await this._loadHabits();
    wx.stopPullDownRefresh();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    getApp().refreshSocialBadge();
    getApp().refreshInboxBadge();
    if (!this.data.isAuthor) {
      const openid = getApp().globalData.openid;
      if (openid) this.setData({ isAuthor: openid === AUTHOR_OPENID });
    }
    const app = getApp();
    if (app.globalData._needsRefresh) {
      app.globalData._needsRefresh = false;
      this._loadHabits();
      return;
    }
    const now = Date.now();
    if (!this._lastLoadTime || now - this._lastLoadTime > 5000) {
      this._loadHabits();
    }
    // 加载站内信未读数
    this._loadInboxUnreadCount();
  },

  // 加载站内信未读数
  async _loadInboxUnreadCount() {
    try {
      const r = await wx.cloud.callFunction({
        name: 'inbox',
        data: { action: 'getInboxUnreadCount' },
      });
      const count = r.result?.count || 0;
      this.setData({ inboxUnreadCount: count });
    } catch (e) {
      console.error('Load inbox unread count error:', e);
    }
  },

  async _loadHabits() {
    if (this.data.habits.length === 0) this.setData({ loading: true });
    try {
      const habits = await getHabits();
      const today = new Date();
      const dateCutoff = (() => {
        const d = new Date(today);
        d.setDate(today.getDate() - 6);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      })();

      const enriched = await Promise.all(habits.map(async h => {
        const checkins = await getCheckinHistory(h._id, 60);
        const streak = calcStreak(h, checkins);
        const recentPhotos = checkins
          .filter(c => c.date >= dateCutoff && c.photos && c.photos.length > 0)
          .sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0)
          .flatMap(c => c.photos.map(url => ({
            url,
            date: c.date,
            dateLabel: `${c.date.slice(5, 7)}/${c.date.slice(8, 10)}`,
          })));
        return { ...h, streak, recentPhotos };
      }));
      this._lastLoadTime = Date.now();
      this.setData({ habits: enriched, loading: false });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
    }
  },

  onToggleManage() {
    this.setData({ manageMode: !this.data.manageMode, dragIdx: -1, dragging: false });
  },

  onDragStart(e) {
    this._isDragging = true; // sync flag — data.dragging is async via setData
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ dragging: true, dragIdx: idx, dragLastY: e.touches[0].pageY });
  },

  onDragMove(e) {
    if (!this.data.dragging) return;
    const y = e.touches[0].pageY;
    const delta = y - this.data.dragLastY;

    // Auto-scroll page when finger is near top or bottom edge
    const EDGE = 100;
    const wh = this._windowHeight || 600;
    const scrollTop = this._scrollTop || 0;
    if (y < EDGE && scrollTop > 0) {
      wx.pageScrollTo({ scrollTop: Math.max(0, scrollTop - 70), duration: 120 });
    } else if (y > wh - EDGE) {
      wx.pageScrollTo({ scrollTop: scrollTop + 70, duration: 120 });
    }

    const THRESHOLD = 50;
    const habits = this.data.habits;
    let idx = this.data.dragIdx;
    if (delta < -THRESHOLD && idx > 0) {
      const next = [...habits];
      [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      this.setData({ habits: next, dragIdx: idx - 1, dragLastY: y });
    } else if (delta > THRESHOLD && idx < habits.length - 1) {
      const next = [...habits];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      this.setData({ habits: next, dragIdx: idx + 1, dragLastY: y });
    }
  },

  onDragEnd() {
    this._isDragging = false;
    if (!this.data.dragging) return;
    this.setData({ dragging: false, dragIdx: -1 });
    this._saveSortOrder();
  },

  async _saveSortOrder() {
    const habits = this.data.habits;
    try {
      await Promise.all(habits.map((h, i) => updateHabit(h._id, { sortOrder: i })));
      invalidateHabits();
    } catch (e) {
      console.error('save sort order failed', e);
    }
  },

  onAddHabit() {
    wx.navigateTo({ url: '/pages/add-habit/index' });
  },

  onEditHabit(e) {
    const { id } = e.currentTarget.dataset;
    const habit = this.data.habits.find(h => h._id === id);
    if (habit) getApp().globalData._pendingEdit = habit;
    wx.navigateTo({ url: `/pages/add-habit/index?id=${id}` });
  },

  noop() {},

  onPreviewPhoto(e) {
    const { habitid, index } = e.currentTarget.dataset;
    const habit = this.data.habits.find(h => h._id === habitid);
    if (!habit || !habit.recentPhotos || !habit.recentPhotos.length) return;
    const urls = habit.recentPhotos.map(p => (typeof p === 'string' ? p : p.url));
    wx.previewImage({ current: urls[Number(index)], urls });
  },

  onDeleteHabit(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showActionSheet({
      itemList: ['删除习惯（保留历史记录）', '彻底删除（清除所有记录）'],
      itemColor: '#FF6B6B',
      success: async res => {
        if (res.tapIndex === 0) {
          await deleteHabit(id);
          getApp().globalData._needsRefresh = true;
          this._loadHabits();
          wx.showToast({ title: '已删除，记录已保留', icon: 'none', duration: 2000 });
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '彻底删除',
            content: `将删除「${name}」及其全部打卡记录，无法恢复，确定吗？`,
            confirmText: '彻底删除',
            confirmColor: '#FF6B6B',
            success: async r => {
              if (r.confirm) {
                wx.showLoading({ title: '删除中...' });
                try {
                  await hardDeleteHabit(id);
                  getApp().globalData._needsRefresh = true;
                  this._loadHabits();
                  wx.hideLoading();
                  wx.showToast({ title: '已彻底删除', icon: 'none' });
                } catch (err) {
                  wx.hideLoading();
                  wx.showToast({ title: '删除失败，请重试', icon: 'none' });
                }
              }
            }
          });
        }
      }
    });
  },

  onShowTutorial() {
    wx.navigateTo({ url: '/pages/tutorial/index' });
  },

  onShowAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },
});
