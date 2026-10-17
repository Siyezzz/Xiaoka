const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

Page({
  data: {
    statusBarHeight: _statusBarHeight,
    tempAvatarUrl: '',
    tempNickname: '',
    uploading: false,
    saving: false,
    showSuccess: false,
  },

  _uploadedFileID: '',

  async onChooseAvatar(e) {
    const filePath = e.detail.avatarUrl;
    this._uploadedFileID = '';
    this.setData({ tempAvatarUrl: filePath, uploading: true });
    try {
      const openid = getApp().globalData.openid || ('user_' + Date.now());
      const cloudPath = `avatars/${openid}_${Date.now()}.jpg`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath });
      this._uploadedFileID = up.fileID;
    } catch (err) {
      console.error('avatar upload error:', err);
      // Clear preview so save is not blocked; user can re-select
      this.setData({ tempAvatarUrl: '' });
      wx.showToast({ title: '头像上传失败，请重选', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  onNicknameBlur(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  async onSave() {
    if (this.data.saving) return;
    if (this.data.uploading) {
      wx.showToast({ title: '头像上传中，请稍候', icon: 'none' });
      return;
    }
    const name = this.data.tempNickname.trim();
    if (!name) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'users',
        data: {
          action: 'updateProfile',
          displayName: name,
          avatarUrl: this._uploadedFileID || '',
        },
      });
      // Cloud function may return an error object without throwing
      if (res.result && res.result.error) {
        throw new Error(res.result.message || res.result.error);
      }
      getApp().globalData.displayName = name;
      if (this._uploadedFileID) {
        getApp().globalData.avatarUrl = this._uploadedFileID;
      }
      wx.setStorageSync('ht_onboarding_done', true);
      this.setData({ showSuccess: true });
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 2000);
    } catch (e) {
      console.error('onSave error:', e);
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败：' + (e.message || '请重试'), icon: 'none', duration: 3000 });
    }
  },
});
