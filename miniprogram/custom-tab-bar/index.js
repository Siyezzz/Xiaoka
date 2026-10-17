Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index',  text: '今日', icon: '✨',  activeIcon: '🌻', dot: false },
      { pagePath: '/pages/habits/index', text: '习惯', icon: '🌱',  activeIcon: '✅', dot: false, inboxDot: false },
      { pagePath: '/pages/stats/index',  text: '统计', icon: '📊',  activeIcon: '📈', dot: false },
      { pagePath: '/pages/social/index', text: '好友', icon: '☘️',  activeIcon: '🍀', dot: false, badge: 0 },
    ],
  },
  lifetimes: {
    attached() {
      // Initial badge check — subsequent refreshes handled by each tab page's onShow
      wx.cloud.callFunction({
        name: 'social',
        data: { action: 'getUnreadCount' },
        success: res => {
          const count = res.result?.count || 0;
          this.setData({ 'list[3].dot': count > 0, 'list[3].badge': count });
        },
        fail: () => {},
      });
    },
  },
  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      wx.switchTab({ url: path });
    },
  },
});
