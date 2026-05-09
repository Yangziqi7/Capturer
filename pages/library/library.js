const app = getApp();

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

Page({
  data: {
    stickers: []
  },

  onShow() {
    const stickers = app.getStickers().map((item) => ({
      ...item,
      createdText: formatTime(item.createdAt)
    }));
    this.setData({
      stickers
    });
  },

  onShareAppMessage() {
    return {
      title: "我做了一组 AI 随手贴",
      path: "/pages/home/home"
    };
  },

  previewSticker(event) {
    const sticker = this.data.stickers.find((item) => item.id === event.currentTarget.dataset.id);
    if (!sticker) {
      return;
    }

    if (sticker.image) {
      wx.previewImage({
        urls: [sticker.image],
        current: sticker.image
      });
      return;
    }

    wx.showToast({
      title: sticker.caption,
      icon: "none"
    });
  },

  goCapture() {
    wx.switchTab({
      url: "/pages/home/home"
    });
  },

  goSubscribe() {
    wx.switchTab({
      url: "/pages/subscribe/subscribe"
    });
  }
});
