const STORAGE_KEY = "capturer_stickers";
const QUOTA_KEY = "capturer_quota";

App({
  globalData: {
    freeDailyQuota: 5,
    storageKey: STORAGE_KEY,
    quotaKey: QUOTA_KEY
  },

  onLaunch() {
    const quota = wx.getStorageSync(QUOTA_KEY);
    if (!quota || quota.date !== this.today()) {
      wx.setStorageSync(QUOTA_KEY, {
        date: this.today(),
        remaining: this.globalData.freeDailyQuota
      });
    }
  },

  today() {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  },

  getQuota() {
    return wx.getStorageSync(QUOTA_KEY) || {
      date: this.today(),
      remaining: this.globalData.freeDailyQuota
    };
  },

  consumeQuota() {
    const quota = this.getQuota();
    if (quota.remaining <= 0) {
      return false;
    }

    const nextQuota = {
      date: quota.date,
      remaining: quota.remaining - 1
    };
    wx.setStorageSync(QUOTA_KEY, nextQuota);
    return nextQuota;
  },

  getStickers() {
    return wx.getStorageSync(STORAGE_KEY) || [];
  },

  saveSticker(sticker) {
    const stickers = this.getStickers();
    const nextStickers = [sticker].concat(stickers).slice(0, 60);
    wx.setStorageSync(STORAGE_KEY, nextStickers);
    return nextStickers;
  }
});
