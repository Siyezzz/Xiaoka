App({
  onShow(options) {
    // Warm-start: app already running, user tapped a share card or scanned a QR code.
    // Share card: query.fromUid = customId
    // QR code (getwxacodeunlimit): query.scene = customId (the custom scene string)
    const fromUid = options?.query?.fromUid || options?.query?.scene;
    if (fromUid) this.globalData._pendingFromUid = String(fromUid);
  },

  onLaunch(options) {
    // Cold-start: capture fromUid from share link or scene from QR scan.
    // For QR cold-start the page's onLoad also receives options.scene, but
    // capturing it here as a backup covers edge cases (e.g. tabBar page timing).
    const fromUid = options?.query?.fromUid || options?.query?.scene;
    if (fromUid) this.globalData._pendingFromUid = String(fromUid);

    wx.cloud.init({
      env: 'cloud1-d1gk8zc6k0a6f1728',
      traceUser: true,
    });

    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 0;
    let navTopPadding = statusBarHeight + 8;
    try {
      const mb = wx.getMenuButtonBoundingClientRect();
      if (mb && mb.top > 0) navTopPadding = mb.top;
    } catch (e) {}

    this.globalData = {
      openid: null,
      statusBarHeight,
      navTopPadding,
      customId: '',
      displayName: '',
      avatarUrl: '',
      _pendingFromUid: this.globalData?._pendingFromUid || (fromUid ? String(fromUid) : '') || '',
    };

    this._login();
    this._initDb();
    this._initProfile();
  },

  _login() {
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        this.globalData.openid = res.result.openid;
        // Ensure user document exists with a customId
        wx.cloud.callFunction({
          name: 'createUser',
          success: r => {
            const { user, isNew } = r.result || {};
            if (user) {
              this.globalData.customId    = user.customId    || '';
              this.globalData.displayName = user.displayName || '';
              this.globalData.avatarUrl   = user.avatarUrl   || '';
            }
            // Existing user — ensure tutorial/onboarding is never shown again
            if (!isNew) {
              wx.setStorageSync('ht_onboarding_done', true);
            }
          },
          fail: () => {},
        });
      },
      fail: () => {},
    });
  },

  _initDb() {
    wx.cloud.callFunction({ name: 'initDb', fail: () => {} });
  },

  refreshInboxBadge() {
    wx.cloud.callFunction({
      name: 'inbox',
      data: { action: 'getInboxUnreadCount' },
      success: r => {
        const count = r.result?.count || 0;
        const pages = getCurrentPages();
        pages.forEach(p => {
          if (typeof p.getTabBar === 'function' && p.getTabBar()) {
            p.getTabBar().setData({ 
              'list[1].inboxDot': count > 0,
              'list[1].badge': count > 0 ? Math.min(count, 99) : 0
            });
          }
        });
      },
      fail: () => {},
    });
  },

  refreshSocialBadge() {
    wx.cloud.callFunction({
      name: 'social',
      data: { action: 'getUnreadCount' },
      success: r => {
        const count = r.result?.count || 0;
        const pages = getCurrentPages();
        if (!pages.length) return;
        const cur = pages[pages.length - 1];
        if (typeof cur.getTabBar === 'function' && cur.getTabBar()) {
          cur.getTabBar().setData({ 
            'list[3].dot': count > 0,
            'list[3].badge': count > 0 ? Math.min(count, 99) : 0
          });
        }
      },
      fail: () => {},
    });
  },

  _initProfile() {
    wx.cloud.callFunction({
      name: 'social',
      data: { action: 'getOrCreateProfile' },
      success: res => {
        const profile = res.result?.profile;
        if (profile) {
          this.globalData.customId    = profile.customId    || '';
          this.globalData.displayName = profile.displayName || '';
          this.globalData.avatarUrl   = profile.avatarUrl   || '';
          // Merge cloud badges into local — cloud is source of truth on reinstall.
          // Always merge (not just when local is empty) to handle the race where
          // a passive page-load scan populated local before this cloud call returned.
          if (profile.earnedBadges && profile.earnedBadges.length > 0) {
            const local = wx.getStorageSync('ht_earned_badges') || [];
            const localIds = new Set(local.map(b => b.id));
            const toAdd = profile.earnedBadges.filter(b => !localIds.has(b.id));
            if (toAdd.length > 0) {
              wx.setStorageSync('ht_earned_badges', [...local, ...toAdd]);
              // Discard any notifications queued before the cloud sync completed —
              // they may contain badges the user already earned long ago.
              wx.removeStorageSync('ht_pending_badge_notif');
            }
          }
        }
      },
      fail: () => {},
    });
  },

  globalData: { openid: null, statusBarHeight: 0, navTopPadding: 0, customId: '', displayName: '', avatarUrl: '' },
});
