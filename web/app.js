const quotaKey = "capturer.web.quota";
const libraryKey = "capturer.web.library";

const scenes = [
  { title: "宠物表情", hint: "捕捉一只正在营业的小狗", emoji: "🐶", body: "#f7b267", accent: "#4f7cac" },
  { title: "手写小物", hint: "识别手写字和桌面小物件", emoji: "✍️", body: "#f6f3df", accent: "#ff846d" },
  { title: "朋友表情", hint: "自动加描边和文字气泡", emoji: "😄", body: "#8ecae6", accent: "#ffd166" },
  { title: "咖啡时刻", hint: "适合日常聊天和朋友圈", emoji: "☕", body: "#d6a46d", accent: "#6ed1a9" },
];

const styleNames = {
  cream: "奶油描边",
  comic: "漫画气泡",
  brand: "品牌限定",
};

const captions = ["今天也很乖", "收到!", "记得开心", "别催啦", "马上来", "可爱上线"];

const state = {
  quota: getQuota(),
  style: "cream",
  scene: 0,
  stream: null,
  cameraOn: false,
  library: JSON.parse(localStorage.getItem(libraryKey) || "[]"),
};

const camera = document.querySelector("#camera");
const sceneCanvas = document.querySelector("#sceneCanvas");
const sceneCtx = sceneCanvas.getContext("2d");
const stickerCanvas = document.querySelector("#stickerCanvas");
const stickerCtx = stickerCanvas.getContext("2d");
const library = document.querySelector("#library");
const toast = document.querySelector("#toast");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getQuota() {
  const quota = JSON.parse(localStorage.getItem(quotaKey) || "null");
  if (!quota || quota.date !== today()) {
    const nextQuota = { date: today(), remaining: 5 };
    localStorage.setItem(quotaKey, JSON.stringify(nextQuota));
    return nextQuota;
  }
  return quota;
}

function saveQuota() {
  localStorage.setItem(quotaKey, JSON.stringify(state.quota));
  document.querySelector("#quotaText").textContent = `${state.quota.remaining}/5`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawScene() {
  const scene = scenes[state.scene];
  const { width, height } = sceneCanvas;
  const gradient = sceneCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f7fff9");
  gradient.addColorStop(1, "#e2f1ff");
  sceneCtx.fillStyle = gradient;
  sceneCtx.fillRect(0, 0, width, height);

  sceneCtx.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 7; i += 1) {
    sceneCtx.beginPath();
    sceneCtx.arc(80 + i * 96, 110 + (i % 3) * 70, 32, 0, Math.PI * 2);
    sceneCtx.fill();
  }

  sceneCtx.save();
  sceneCtx.translate(width / 2, height / 2 + 30);
  sceneCtx.rotate(-0.05);
  sceneCtx.fillStyle = scene.body;
  roundedRect(sceneCtx, -170, -180, 340, 360, 58);
  sceneCtx.fill();
  sceneCtx.fillStyle = scene.accent;
  sceneCtx.beginPath();
  sceneCtx.arc(-88, -52, 24, 0, Math.PI * 2);
  sceneCtx.arc(88, -52, 24, 0, Math.PI * 2);
  sceneCtx.fill();
  sceneCtx.strokeStyle = "#17211f";
  sceneCtx.lineWidth = 14;
  sceneCtx.beginPath();
  sceneCtx.arc(0, 32, 68, 0.08, Math.PI - 0.08);
  sceneCtx.stroke();
  sceneCtx.font = "96px sans-serif";
  sceneCtx.textAlign = "center";
  sceneCtx.fillText(scene.emoji, 0, 155);
  sceneCtx.restore();

  document.querySelector("#cameraTitle").textContent = state.cameraOn ? "真实相机" : scene.title;
  document.querySelector("#cameraHint").textContent = state.cameraOn ? "点击捕捉当前画面" : scene.hint;
}

function drawSticker(sourceImage) {
  const scene = scenes[state.scene];
  const caption = captions[Math.floor(Math.random() * captions.length)];
  const { width, height } = stickerCanvas;
  stickerCtx.clearRect(0, 0, width, height);
  stickerCtx.fillStyle = state.style === "comic" ? "#fff3f0" : state.style === "brand" ? "#eef7ff" : "#fffdf5";
  stickerCtx.fillRect(0, 0, width, height);

  stickerCtx.save();
  stickerCtx.translate(width / 2, height / 2 - 18);

  if (sourceImage) {
    stickerCtx.beginPath();
    stickerCtx.arc(0, 0, 205, 0, Math.PI * 2);
    stickerCtx.clip();
    stickerCtx.drawImage(sourceImage, -245, -245, 490, 490);
    stickerCtx.restore();
    stickerCtx.strokeStyle = state.style === "comic" ? "#17211f" : "#ffffff";
    stickerCtx.lineWidth = 34;
    stickerCtx.beginPath();
    stickerCtx.arc(width / 2, height / 2 - 18, 218, 0, Math.PI * 2);
    stickerCtx.stroke();
  } else {
    stickerCtx.rotate(state.style === "comic" ? -0.12 : 0.05);
    stickerCtx.strokeStyle = state.style === "brand" ? "#7eb8ff" : state.style === "comic" ? "#17211f" : "#ffffff";
    stickerCtx.lineWidth = 34;
    roundedRect(stickerCtx, -175, -180, 350, 360, 58);
    stickerCtx.stroke();
    stickerCtx.fillStyle = scene.body;
    stickerCtx.fill();
    stickerCtx.fillStyle = scene.accent;
    stickerCtx.beginPath();
    stickerCtx.arc(-88, -52, 24, 0, Math.PI * 2);
    stickerCtx.arc(88, -52, 24, 0, Math.PI * 2);
    stickerCtx.fill();
    stickerCtx.strokeStyle = "#17211f";
    stickerCtx.lineWidth = 12;
    stickerCtx.beginPath();
    stickerCtx.arc(0, 32, 68, 0.08, Math.PI - 0.08);
    stickerCtx.stroke();
    stickerCtx.font = "96px sans-serif";
    stickerCtx.textAlign = "center";
    stickerCtx.fillText(scene.emoji, 0, 155);
    stickerCtx.restore();
  }

  stickerCtx.save();
  stickerCtx.translate(width / 2, height - 112);
  stickerCtx.rotate(-0.04);
  stickerCtx.fillStyle = state.style === "comic" ? "#ffd166" : "#ffffff";
  stickerCtx.strokeStyle = "#17211f";
  stickerCtx.lineWidth = 7;
  roundedRect(stickerCtx, -176, -42, 352, 84, 22);
  stickerCtx.fill();
  stickerCtx.stroke();
  stickerCtx.fillStyle = "#17211f";
  stickerCtx.font = "900 38px sans-serif";
  stickerCtx.textAlign = "center";
  stickerCtx.fillText(state.style === "brand" ? "CITY POP-UP" : caption, 0, 14);
  stickerCtx.restore();

  const image = stickerCanvas.toDataURL("image/png");
  const sticker = {
    id: Date.now(),
    image,
    caption: state.style === "brand" ? "CITY POP-UP" : caption,
  };
  state.library.unshift(sticker);
  state.library = state.library.slice(0, 9);
  localStorage.setItem(libraryKey, JSON.stringify(state.library));
  renderLibrary();
  document.querySelector("#resultTitle").textContent = styleNames[state.style];
  document.querySelector("#resultHint").textContent = "已保存到网页测试贴纸库。长按图片可尝试保存。";
}

function drawPlaceholderSticker() {
  const { width, height } = stickerCanvas;
  stickerCtx.clearRect(0, 0, width, height);
  stickerCtx.fillStyle = "#fffdf5";
  stickerCtx.fillRect(0, 0, width, height);
  stickerCtx.strokeStyle = "#dfe6df";
  stickerCtx.lineWidth = 4;
  stickerCtx.setLineDash([16, 14]);
  roundedRect(stickerCtx, 86, 86, width - 172, height - 172, 34);
  stickerCtx.stroke();
  stickerCtx.setLineDash([]);
  stickerCtx.fillStyle = "#66736e";
  stickerCtx.font = "800 32px sans-serif";
  stickerCtx.textAlign = "center";
  stickerCtx.fillText("点击捕捉成贴", width / 2, height / 2 - 10);
  stickerCtx.font = "500 24px sans-serif";
  stickerCtx.fillText("生成结果会出现在这里", width / 2, height / 2 + 34);
}

function renderLibrary() {
  if (state.library.length === 0) {
    library.innerHTML = '<div class="library-empty">还没有贴纸，先捕捉一张试试。</div>';
    return;
  }

  library.innerHTML = state.library
    .map(
      (item) => `
        <button class="library-item" type="button" data-id="${item.id}">
          <img src="${item.image}" alt="${item.caption}" />
          <span>${item.caption}</span>
        </button>
      `,
    )
    .join("");
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    camera.srcObject = state.stream;
    camera.style.display = "block";
    state.cameraOn = true;
    drawScene();
    showToast("摄像头已开启");
  } catch (error) {
    state.cameraOn = false;
    camera.style.display = "none";
    showToast("摄像头权限未开启，已使用模拟场景");
  }
}

function captureSticker() {
  if (state.quota.remaining <= 0) {
    showToast("今日免费额度已用完，可查看会员入口");
    return;
  }

  state.quota.remaining -= 1;
  saveQuota();

  if (state.cameraOn && camera.videoWidth > 0) {
    const photo = document.createElement("canvas");
    photo.width = camera.videoWidth;
    photo.height = camera.videoHeight;
    const photoCtx = photo.getContext("2d");
    photoCtx.translate(photo.width, 0);
    photoCtx.scale(-1, 1);
    photoCtx.drawImage(camera, 0, 0, photo.width, photo.height);
    drawSticker(photo);
  } else {
    drawSticker();
    state.scene = (state.scene + 1) % scenes.length;
    drawScene();
  }

  stickerCanvas.animate(
    [
      { transform: "scale(0.96) rotate(-1deg)" },
      { transform: "scale(1.02) rotate(1deg)" },
      { transform: "scale(1)" },
    ],
    { duration: 420, easing: "ease-out" },
  );
  showToast("贴纸已生成");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1600);
}

document.querySelector("#cameraButton").addEventListener("click", startCamera);
document.querySelector("#captureButton").addEventListener("click", captureSticker);
document.querySelector("#clearButton").addEventListener("click", () => {
  state.library = [];
  localStorage.removeItem(libraryKey);
  renderLibrary();
  showToast("贴纸库已清空");
});
document.querySelector("#subscribeButton").addEventListener("click", () => {
  showToast("测试版暂未接入支付：正式版接微信支付");
});
document.querySelectorAll(".style-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".style-tab").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.style = button.dataset.style;
    document.querySelector("#styleTitle").textContent = styleNames[state.style];
    showToast(`已切换到${styleNames[state.style]}`);
  });
});

saveQuota();
drawScene();
drawPlaceholderSticker();
renderLibrary();
