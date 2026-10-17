const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;
const TOTAL_STEPS = 9;

Page({
  data: {
    statusBarHeight: _statusBarHeight,
    currentStep: 0,
    totalSteps: TOTAL_STEPS,
  },

  onNext() {
    if (this.data.currentStep < TOTAL_STEPS - 1) {
      this.setData({ currentStep: this.data.currentStep + 1 });
    } else {
      this._finish();
    }
  },

  onPrev() {
    if (this.data.currentStep > 0) {
      this.setData({ currentStep: this.data.currentStep - 1 });
    }
  },

  onSkip() {
    this._finish();
  },

  onSwiperChange(e) {
    this.setData({ currentStep: e.detail.current });
  },

  _finish() {
    wx.setStorageSync('ht_tutorial_done', true);
    if (!wx.getStorageSync('ht_onboarding_done')) {
      wx.redirectTo({ url: '/pages/profile-setup/index' });
    } else {
      wx.navigateBack({ delta: 1 });
    }
  },
});
