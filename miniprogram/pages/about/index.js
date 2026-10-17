const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

Page({
  data: {
    navTopPadding: _statusBarHeight,
    navBarHeightPx: 80,
    currentVersion: '',
    latestVersion: '',
    checking: true,
    hasUpdate: false,
    inboxDot: false,
  },

  _updateManager: null,

  onLoad() {
    const app = getApp();
    const navTopPadding = app.globalData.navTopPadding || _statusBarHeight;
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = sys.windowWidth / 750;
    const navBarHeightPx = navTopPadding + Math.round(90 * ratio);

    let currentVersion = '';
    try {
      currentVersion = wx.getAccountInfoSync().miniProgram.version || '1.0';
    } catch (e) {
      currentVersion = '1.0';
    }

    this.setData({ navTopPadding, navBarHeightPx, currentVersion });

    wx.cloud.callFunction({
      name: 'inbox',
      data: { action: 'getAppVersion', currentVersion },
      success: r => {
        this.setData({ latestVersion: r.result?.latest || '', checking: false });
      },
      fail: () => {
        this.setData({ checking: false });
      },
    });

    if (wx.canIUse('getUpdateManager')) {
      const manager = wx.getUpdateManager();
      manager.onCheckForUpdate(() => {});
      manager.onUpdateReady(() => {
        this._updateManager = manager;
        this.setData({ hasUpdate: true });
      });
      manager.onUpdateFailed(() => {});
    }
  },

  onShow() {
    wx.cloud.callFunction({
      name: 'inbox',
      data: { action: 'getInboxUnreadCount' },
      success: r => {
        const count = r.result?.count || 0;
        this.setData({ inboxDot: count > 0 });
        if (count > 0) {
          // Mark as read and clear 习惯 tab dot
          wx.cloud.callFunction({ name: 'inbox', data: { action: 'markInboxRead' }, fail: () => {} });
          getApp().refreshInboxBadge();
        }
      },
      fail: () => {},
    });
  },

  onBack() { wx.navigateBack(); },

  onGoAuthorMessage() {
    wx.navigateTo({ url: '/pages/author-message/index' });
  },

  onGoInbox() {
    wx.navigateTo({ url: '/pages/inbox/index' });
  },

  onApplyUpdate() {
    if (!this._updateManager) return;
    wx.showModal({
      title: '更新提示',
      content: '新版本已就绪，点击确定立即重启并更新',
      success: res => {
        if (res.confirm) this._updateManager.applyUpdate();
      },
    });
  },
});
