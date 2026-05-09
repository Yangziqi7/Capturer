const video = document.querySelector("#camera");
const frameCanvas = document.querySelector("#frameCanvas");
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
const overlayCanvas = document.querySelector("#overlayCanvas");
const overlayCtx = overlayCanvas.getContext("2d");
const stickerCanvas = document.querySelector("#stickerCanvas");
const stickerCtx = stickerCanvas.getContext("2d");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const detailText = document.querySelector("#detailText");
const stickerText = document.querySelector("#stickerText");
const retryButton = document.querySelector("#retryButton");

const state = {
  cameraReady: false,
  lastAnalyzeAt: 0,
  lastStickerAt: 0,
  stableFrames: 0,
  activeBox: null,
  smoothedBox: null,
  previousSignature: null,
  mockTick: 0,
};

const analysis = {
  cols: 28,
  rows: 36,
  minBoxRatio: 0.18,
  maxBoxRatio: 0.72,
};

function setStatus(kind, title, detail) {
  statusDot.classList.toggle("is-ready", kind === "ready");
  statusDot.classList.toggle("is-error", kind === "error");
  statusText.textContent = title;
  detailText.textContent = detail;
}

function resizeCanvases() {
  const aspect = window.innerHeight / Math.max(1, window.innerWidth);
  const width = 360;
  const height = Math.max(520, Math.min(760, Math.round(width * aspect)));
  [frameCanvas, overlayCanvas].forEach((canvas) => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  });
}

async function startCamera() {
  retryButton.classList.remove("is-visible");
  setStatus("busy", "正在请求摄像头", "授权后会自动识别画面中心主体");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("error", "浏览器不支持摄像头", "已切换为模拟画面");
    retryButton.classList.add("is-visible");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 1920 },
      },
    });
    video.srcObject = stream;
    await video.play();
    state.cameraReady = true;
    video.style.display = "block";
    setStatus("ready", "正在自动识别", "把物体放在画面中心");
  } catch (error) {
    state.cameraReady = false;
    video.style.display = "none";
    setStatus("error", "摄像头未开启", "本地模拟仍会展示自动提取效果");
    retryButton.classList.add("is-visible");
  }
}

function drawVideoCover() {
  const cw = frameCanvas.width;
  const ch = frameCanvas.height;
  frameCtx.clearRect(0, 0, cw, ch);

  if (state.cameraReady && video.videoWidth > 0 && video.videoHeight > 0) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    frameCtx.drawImage(video, dx, dy, dw, dh);
    return;
  }

  drawMockFrame(cw, ch);
}

function drawMockFrame(width, height) {
  state.mockTick += 0.018;
  const gradient = frameCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#20282b");
  gradient.addColorStop(1, "#111516");
  frameCtx.fillStyle = gradient;
  frameCtx.fillRect(0, 0, width, height);

  const cx = width / 2 + Math.sin(state.mockTick) * width * 0.08;
  const cy = height / 2 + Math.cos(state.mockTick * 0.8) * height * 0.04;
  const size = Math.min(width, height) * 0.32;

  frameCtx.fillStyle = "#273334";
  for (let i = 0; i < 8; i += 1) {
    frameCtx.beginPath();
    frameCtx.arc((i + 0.5) * width / 8, height * (0.18 + (i % 3) * 0.2), size * 0.18, 0, Math.PI * 2);
    frameCtx.fill();
  }

  frameCtx.save();
  frameCtx.translate(cx, cy);
  frameCtx.rotate(Math.sin(state.mockTick * 0.7) * 0.08);
  frameCtx.fillStyle = "#f2b469";
  roundedRect(frameCtx, -size * 0.48, -size * 0.54, size * 0.96, size * 1.08, size * 0.18);
  frameCtx.fill();
  frameCtx.fillStyle = "#2c5d8b";
  frameCtx.beginPath();
  frameCtx.arc(-size * 0.18, -size * 0.16, size * 0.055, 0, Math.PI * 2);
  frameCtx.arc(size * 0.18, -size * 0.16, size * 0.055, 0, Math.PI * 2);
  frameCtx.fill();
  frameCtx.strokeStyle = "#16201f";
  frameCtx.lineWidth = Math.max(6, size * 0.035);
  frameCtx.beginPath();
  frameCtx.arc(0, size * 0.08, size * 0.18, 0.08, Math.PI - 0.08);
  frameCtx.stroke();
  frameCtx.restore();
}

function analyzeFrame() {
  const width = frameCanvas.width;
  const height = frameCanvas.height;
  if (width < 10 || height < 10) return null;

  const image = frameCtx.getImageData(0, 0, width, height);
  const data = image.data;
  const cols = analysis.cols;
  const rows = analysis.rows;
  const cellW = width / cols;
  const cellH = height / rows;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDistance = Math.hypot(width * 0.5, height * 0.5);
  const cells = [];
  let bg = { r: 0, g: 0, b: 0, l: 0, count: 0 };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const sample = sampleCell(data, width, height, x * cellW, y * cellH, cellW, cellH);
      cells.push(sample);
      const edgeCell = x < 3 || x > cols - 4 || y < 4 || y > rows - 5;
      if (edgeCell) {
        bg.r += sample.r;
        bg.g += sample.g;
        bg.b += sample.b;
        bg.l += sample.l;
        bg.count += 1;
      }
    }
  }

  bg = {
    r: bg.r / bg.count,
    g: bg.g / bg.count,
    b: bg.b / bg.count,
    l: bg.l / bg.count,
  };

  let thresholdSum = 0;
  let thresholdCount = 0;
  const scores = cells.map((cell, index) => {
    const x = index % cols;
    const y = Math.floor(index / cols);
    const px = (x + 0.5) * cellW;
    const py = (y + 0.5) * cellH;
    const colorDistance = Math.hypot(cell.r - bg.r, cell.g - bg.g, cell.b - bg.b) / 255;
    const lumDistance = Math.abs(cell.l - bg.l) / 255;
    const saturation = getSaturation(cell.r, cell.g, cell.b);
    const edge = localContrast(cells, x, y, cols, rows) / 255;
    const centerWeight = Math.max(0, 1 - Math.hypot(px - centerX, py - centerY) / (maxDistance * 0.74));
    const score = (colorDistance * 0.34 + lumDistance * 0.18 + saturation * 0.18 + edge * 0.3) * (0.45 + centerWeight * 0.9);
    thresholdSum += score;
    thresholdCount += 1;
    return score;
  });

  const average = thresholdSum / thresholdCount;
  const threshold = Math.max(0.08, average * 1.35);
  const centerRadiusX = width * 0.34;
  const centerRadiusY = height * 0.36;
  let minX = cols;
  let minY = rows;
  let maxX = -1;
  let maxY = -1;
  let weight = 0;
  let signature = 0;

  scores.forEach((score, index) => {
    const x = index % cols;
    const y = Math.floor(index / cols);
    const px = (x + 0.5) * cellW;
    const py = (y + 0.5) * cellH;
    const inCenterZone = Math.abs(px - centerX) < centerRadiusX && Math.abs(py - centerY) < centerRadiusY;
    if (inCenterZone && score > threshold) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      weight += score;
      signature += score * (index + 1);
    }
  });

  if (weight < 1.2 || maxX < minX || maxY < minY) {
    return centeredFallbackBox(width, height, signature);
  }

  const padX = Math.max(2, Math.round((maxX - minX + 1) * 0.22));
  const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.24));
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(cols - 1, maxX + padX);
  maxY = Math.min(rows - 1, maxY + padY);

  let box = {
    x: minX * cellW,
    y: minY * cellH,
    w: (maxX - minX + 1) * cellW,
    h: (maxY - minY + 1) * cellH,
    confidence: Math.min(1, weight / 8),
    signature,
  };
  return constrainBox(box, width, height);
}

function sampleCell(data, width, height, x, y, w, h) {
  const samples = 5;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let sy = 1; sy <= samples; sy += 1) {
    for (let sx = 1; sx <= samples; sx += 1) {
      const px = Math.min(width - 1, Math.max(0, Math.round(x + (w * sx) / (samples + 1))));
      const py = Math.min(height - 1, Math.max(0, Math.round(y + (h * sy) / (samples + 1))));
      const index = (py * width + px) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      count += 1;
    }
  }
  r /= count;
  g /= count;
  b /= count;
  return { r, g, b, l: r * 0.299 + g * 0.587 + b * 0.114 };
}

function getSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function localContrast(cells, x, y, cols, rows) {
  const current = cells[y * cols + x];
  let total = 0;
  let count = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      total += Math.abs(current.l - cells[ny * cols + nx].l);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function centeredFallbackBox(width, height, signature) {
  const size = Math.min(width, height) * 0.48;
  return {
    x: (width - size) / 2,
    y: (height - size) / 2,
    w: size,
    h: size,
    confidence: 0.34,
    signature,
  };
}

function constrainBox(box, width, height) {
  const minSize = Math.min(width, height) * analysis.minBoxRatio;
  const maxSize = Math.min(width, height) * analysis.maxBoxRatio;
  const targetW = Math.min(maxSize, Math.max(minSize, box.w));
  const targetH = Math.min(maxSize, Math.max(minSize, box.h));
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  return {
    ...box,
    x: Math.max(0, Math.min(width - targetW, centerX - targetW / 2)),
    y: Math.max(0, Math.min(height - targetH, centerY - targetH / 2)),
    w: targetW,
    h: targetH,
  };
}

function smoothBox(nextBox) {
  if (!state.smoothedBox) {
    state.smoothedBox = nextBox;
    return nextBox;
  }
  const alpha = 0.22;
  state.smoothedBox = {
    ...nextBox,
    x: state.smoothedBox.x * (1 - alpha) + nextBox.x * alpha,
    y: state.smoothedBox.y * (1 - alpha) + nextBox.y * alpha,
    w: state.smoothedBox.w * (1 - alpha) + nextBox.w * alpha,
    h: state.smoothedBox.h * (1 - alpha) + nextBox.h * alpha,
  };
  return state.smoothedBox;
}

function drawOverlay(box) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!box) return;

  const radius = Math.min(box.w, box.h) * 0.12;
  overlayCtx.save();
  overlayCtx.lineWidth = Math.max(4, overlayCanvas.width * 0.005);
  overlayCtx.strokeStyle = "rgba(113, 240, 184, 0.94)";
  overlayCtx.shadowColor = "rgba(113, 240, 184, 0.72)";
  overlayCtx.shadowBlur = 18;
  roundedRect(overlayCtx, box.x, box.y, box.w, box.h, radius);
  overlayCtx.stroke();
  overlayCtx.restore();

  overlayCtx.save();
  overlayCtx.fillStyle = "rgba(0, 0, 0, 0.16)";
  overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.globalCompositeOperation = "destination-out";
  roundedRect(overlayCtx, box.x, box.y, box.w, box.h, radius);
  overlayCtx.fill();
  overlayCtx.restore();
}

function updateStability(box) {
  const signature = Math.round((box.signature || 0) / 2000);
  if (state.previousSignature === null || Math.abs(signature - state.previousSignature) < 28) {
    state.stableFrames += 1;
  } else {
    state.stableFrames = Math.max(0, state.stableFrames - 2);
  }
  state.previousSignature = signature;
}

function maybeExtractSticker(now, box) {
  if (!box) return;
  updateStability(box);
  if (state.stableFrames < 2) {
    stickerText.textContent = "等待主体稳定";
    return;
  }
  if (now - state.lastStickerAt < 1200) return;
  state.lastStickerAt = now;
  extractSticker(box);
  stickerText.textContent = box.confidence > 0.48 ? "已提取中心主体" : "已提取中心区域";
}

function extractSticker(box) {
  const output = 512;
  const padding = 0.2;
  const sourceSize = Math.max(box.w, box.h) * (1 + padding);
  const sourceX = clamp(box.x + box.w / 2 - sourceSize / 2, 0, frameCanvas.width - sourceSize);
  const sourceY = clamp(box.y + box.h / 2 - sourceSize / 2, 0, frameCanvas.height - sourceSize);

  stickerCtx.clearRect(0, 0, output, output);
  stickerCtx.save();
  stickerCtx.shadowColor = "rgba(0, 0, 0, 0.28)";
  stickerCtx.shadowBlur = 16;
  stickerCtx.shadowOffsetY = 8;
  stickerCtx.fillStyle = "#ffffff";
  stickerCtx.beginPath();
  stickerCtx.arc(output / 2, output / 2, output * 0.39, 0, Math.PI * 2);
  stickerCtx.fill();
  stickerCtx.restore();

  stickerCtx.save();
  const mask = stickerCtx.createRadialGradient(output / 2, output / 2, output * 0.26, output / 2, output / 2, output * 0.42);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.78, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  stickerCtx.fillStyle = mask;
  stickerCtx.beginPath();
  stickerCtx.arc(output / 2, output / 2, output * 0.42, 0, Math.PI * 2);
  stickerCtx.fill();
  stickerCtx.globalCompositeOperation = "source-in";
  stickerCtx.drawImage(frameCanvas, sourceX, sourceY, sourceSize, sourceSize, output * 0.08, output * 0.08, output * 0.84, output * 0.84);
  applyComicFilter(output);
  stickerCtx.restore();

  stickerCtx.save();
  stickerCtx.strokeStyle = "#ffffff";
  stickerCtx.lineWidth = 18;
  stickerCtx.beginPath();
  stickerCtx.arc(output / 2, output / 2, output * 0.395, 0, Math.PI * 2);
  stickerCtx.stroke();
  stickerCtx.strokeStyle = "rgba(23, 33, 31, 0.78)";
  stickerCtx.lineWidth = 3;
  stickerCtx.stroke();
  stickerCtx.restore();
}

function applyComicFilter(size) {
  const image = stickerCtx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 4) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    const contrast = 1.12;
    data[i] = quantize(clamp((r - 128) * contrast + 128 + 6, 0, 255), 18);
    data[i + 1] = quantize(clamp((g - 128) * contrast + 128 + 6, 0, 255), 18);
    data[i + 2] = quantize(clamp((b - 128) * contrast + 128 + 6, 0, 255), 18);
    if (l < 54) {
      data[i] *= 0.75;
      data[i + 1] *= 0.75;
      data[i + 2] *= 0.75;
    }
  }
  stickerCtx.putImageData(image, 0, 0);
}

function quantize(value, step) {
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function loop(now) {
  resizeCanvases();
  drawVideoCover();

  if (now - state.lastAnalyzeAt > 260) {
    state.lastAnalyzeAt = now;
    const box = smoothBox(analyzeFrame());
    state.activeBox = box;
    maybeExtractSticker(now, box);
    if (state.cameraReady) {
      setStatus("ready", "正在自动识别", box.confidence > 0.48 ? "中心主体已锁定" : "请把主体靠近中心");
    }
  }

  drawOverlay(state.activeBox);
  requestAnimationFrame(loop);
}

window.addEventListener("error", (event) => {
  setStatus("error", "页面脚本出错", event.message || "请刷新后重试");
  retryButton.classList.add("is-visible");
});

retryButton.addEventListener("click", startCamera);
window.addEventListener("resize", resizeCanvases);

resizeCanvases();
setStatus("busy", "正在请求摄像头", "授权后会自动识别画面中心主体");
startCamera();
requestAnimationFrame(loop);
