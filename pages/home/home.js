const app = getApp();

const styles = [
  {
    id: "cream",
    name: "奶油描边",
    desc: "聊天最百搭"
  },
  {
    id: "comic",
    name: "漫画气泡",
    desc: "适合朋友梗图"
  },
  {
    id: "brand",
    name: "品牌限定",
    desc: "活动和联名模板"
  }
];

const captions = ["今天也很乖", "收到!", "记得开心", "别催啦", "马上来", "可爱上线"];
const emojis = ["🐶", "🍓", "✍️", "😄", "☕", "🎒"];

Page({
  data: {
    quota: {
      remaining: 5
    },
    styles,
    activeStyle: "cream",
    activeStyleName: "奶油描边",
    recognitionLabel: "人物 / 宠物 / 手写字 / 小物件",
    cameraReady: true,
    isGenerating: false,
    latestSticker: null,
    mockEmoji: "🐶"
  },

  onShow() {
    this.setData({
      quota: app.getQuota()
    });
  },

  onShareAppMessage() {
    return {
      title: "我刚做了一张 AI 随手贴",
      path: "/pages/home/home"
    };
  },

  chooseStyle(event) {
    const activeStyle = event.currentTarget.dataset.id;
    const style = styles.find((item) => item.id === activeStyle);
    this.setData({
      activeStyle,
      activeStyleName: style.name
    });
  },

  onCameraError() {
    this.setData({
      cameraReady: false,
      recognitionLabel: "使用模拟场景体验生成流程"
    });
  },

  captureSticker() {
    if (this.data.isGenerating) {
      return;
    }

    const quota = app.consumeQuota();
    if (!quota) {
      wx.showModal({
        title: "今日免费额度已用完",
        content: "开通会员可继续生成高清贴纸，也可以购买 ¥6 主题贴纸包。",
        confirmText: "查看会员",
        success: (result) => {
          if (result.confirm) {
            this.goSubscribe();
          }
        }
      });
      return;
    }

    this.setData({
      quota,
      isGenerating: true
    });

    if (!this.data.cameraReady) {
      this.finishGeneration();
      return;
    }

    wx.createCameraContext().takePhoto({
      quality: "high",
      success: (result) => {
        this.finishGeneration(result.tempImagePath);
      },
      fail: () => {
        this.setData({
          cameraReady: false
        });
        this.finishGeneration();
      }
    });
  },

  simulateCapture() {
    this.finishGeneration();
  },

  finishGeneration(image) {
    const caption = captions[Math.floor(Math.random() * captions.length)];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    const sticker = {
      id: `sticker-${Date.now()}`,
      title: this.data.activeStyleName,
      caption,
      emoji,
      image: image || "",
      style: this.data.activeStyle,
      createdAt: Date.now()
    };

    app.saveSticker(sticker);
    this.setData({
      latestSticker: sticker,
      mockEmoji: emoji,
      isGenerating: false
    });

    wx.showToast({
      title: "贴纸已生成",
      icon: "success"
    });
  },

  goSubscribe() {
    wx.switchTab({
      url: "/pages/subscribe/subscribe"
    });
  }
});
