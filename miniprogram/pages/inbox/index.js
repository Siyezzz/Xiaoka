const _statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 0;

function formatDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const M = date.getMonth() + 1;
  const D = date.getDate();
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${M}月${D}日 ${h}:${m}`;
}

Page({
  data: {
    navTopPadding: _statusBarHeight,
    navBarHeightPx: 80,
    loading: true,
    isAuthor: false,
    messages: [],
    inputText: '',
    sending: false,
    replyingId: '',
    replyText: '',
    sendingReply: false,
  },

  onLoad() {
    const app = getApp();
    const navTopPadding = app.globalData.navTopPadding || _statusBarHeight;
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = sys.windowWidth / 750;
    const navBarHeightPx = navTopPadding + Math.round(90 * ratio);
    this.setData({ navTopPadding, navBarHeightPx });
    this._loadMessages();
  },

  async _loadMessages() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'inbox',
        data: { action: 'getMessages' },
      });
      const { messages = [], isAuthor } = res.result || {};
      const formatted = messages.map(m => ({
        ...m,
        dateStr: formatDate(m.createdAt),
      }));
      this.setData({ messages: formatted, isAuthor: !!isAuthor, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async onSend() {
    const content = this.data.inputText.trim();
    if (!content || this.data.sending) return;
    this.setData({ sending: true });
    try {
      const app = getApp();
      const senderName = app.globalData.displayName || '用户';
      await wx.cloud.callFunction({
        name: 'inbox',
        data: { action: 'sendMessage', content, senderName },
      });
      this.setData({ inputText: '' });
      wx.showToast({ title: '留言已发送', icon: 'none' });
      await this._loadMessages();
    } catch (e) {
      wx.showToast({ title: '发送失败，请重试', icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  },

  onToggleReply(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.replyingId === id) {
      this.setData({ replyingId: '', replyText: '' });
    } else {
      this.setData({ replyingId: id, replyText: '' });
    }
  },

  onReplyInput(e) {
    this.setData({ replyText: e.detail.value });
  },

  async onSendReply(e) {
    const messageId = e.currentTarget.dataset.id;
    const content = this.data.replyText.trim();
    if (!content || this.data.sendingReply) return;
    this.setData({ sendingReply: true });
    try {
      await wx.cloud.callFunction({
        name: 'inbox',
        data: { action: 'reply', messageId, content },
      });
      this.setData({ replyingId: '', replyText: '', sendingReply: false });
      wx.showToast({ title: '回复成功', icon: 'none' });
      await this._loadMessages();
    } catch (e) {
      this.setData({ sendingReply: false });
      wx.showToast({ title: '回复失败', icon: 'none' });
    }
  },

  onBack() { wx.navigateBack(); },
});
