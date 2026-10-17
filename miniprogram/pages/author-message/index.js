const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

Page({
  data: {
    navTopPadding: _statusBarHeight,
    navBarHeightPx: 80,
  },

  onLoad() {
    const app = getApp();
    const navTopPadding = app.globalData.navTopPadding || _statusBarHeight;
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = sys.windowWidth / 750;
    const navBarHeightPx = navTopPadding + Math.round(90 * ratio);
    this.setData({ navTopPadding, navBarHeightPx });
  },

  onBack() { wx.navigateBack(); },
});
