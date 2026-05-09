Page({
  showPaymentStub() {
    wx.showModal({
      title: "支付能力待接入",
      content: "MVP 已放置商业化入口。正式上线时需要接入微信支付、订阅权益校验和订单回调。",
      showCancel: false,
      confirmText: "知道了"
    });
  }
});
