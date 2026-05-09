const video = document.querySelector("#camera");
const frameCanvas = document.querySelector("#frameCanvas");
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
const overlayCanvas = document.querySelector("#overlayCanvas");
const overlayCtx = overlayCanvas.getContext("2d");
const stickerCanvas = document.querySelector("#stickerCanvas");
const stickerCtx = stickerCanvas.getContext("2d");
const layerCanvas = document.createElement("canvas");
const layerCtx = layerCanvas.getContext("2d");
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
  detector: null,
  detectorReady: false,
  detectorError: false,
  segmenter: null,
  segmenterReady: false,
  segmenterError: false,
  isDetecting: false,
  isExtractingSticker: false,
  isLoadingModels: false,
  segmenterLoadStarted: false,
};

const deviceProfile = getDeviceProfile();

const detectorConfig = {
  minScore: 0.35,
  detectEveryMs: deviceProfile.lowPower ? 900 : 620,
  centerWeight: 0.72,
  maxDetections: deviceProfile.lowPower ? 6 : 10,
  stickerIntervalMs: deviceProfile.lowPower ? 2600 : 1800,
  stickerSize: deviceProfile.lowPower ? 288 : 360,
  enableSemanticSegmentation: !deviceProfile.lowPower,
  segmenterWarmupMs: 6500,
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
  const width = deviceProfile.lowPower ? 300 : 360;
  const height = Math.max(500, Math.min(deviceProfile.lowPower ? 660 : 760, Math.round(width * aspect)));
  [frameCanvas, overlayCanvas].forEach((canvas) => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  });
}

async function loadDetector() {
  if (state.isLoadingModels || state.detectorReady) return;

  state.isLoadingModels = true;
  setStatus("busy", "正在加载本地检测", "手机性能模式会先只加载 Coco SSD");

  try {
    if (!window.tf) {
      throw new Error("TensorFlow.js 未加载");
    }

    if (window.tf.enableProdMode) window.tf.enableProdMode();
    if (window.tf.setBackend) {
      await window.tf.setBackend("webgl").catch(() => window.tf.setBackend("cpu"));
      await window.tf.ready();
    }

    await loadObjectDetector();
    if (state.detectorReady) {
      setStatus("ready", "本地检测已就绪", getModelStatusDetail());
      scheduleSegmenterWarmup();
    } else {
      setStatus("error", "检测模型加载失败", "已回退到本地启发式检测");
    }
  } catch (error) {
    state.detector = null;
    state.detectorReady = false;
    state.detectorError = true;
    setStatus("error", "检测模型加载失败", "已回退到本地启发式检测");
  } finally {
    state.isLoadingModels = false;
  }
}

async function loadObjectDetector() {
  try {
    if (!window.cocoSsd) {
      throw new Error("Coco SSD 未加载");
    }
    state.detector = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
    state.detectorReady = true;
    state.detectorError = false;
  } catch (error) {
    state.detector = null;
    state.detectorReady = false;
    state.detectorError = true;
  }
}

async function loadSemanticSegmenter() {
  if (!detectorConfig.enableSemanticSegmentation || state.segmenterLoadStarted || state.segmenterReady) return;

  state.segmenterLoadStarted = true;
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/deeplab@0.2.2");
    if (!window.deeplab) {
      throw new Error("DeepLab 未加载");
    }
    state.segmenter = await window.deeplab.load({ base: "pascal", quantizationBytes: 2 });
    state.segmenterReady = true;
    state.segmenterError = false;
  } catch (error) {
    state.segmenter = null;
    state.segmenterReady = false;
    state.segmenterError = true;
  }
}

function scheduleSegmenterWarmup() {
  if (!detectorConfig.enableSemanticSegmentation) return;

  const warmup = () => loadSemanticSegmenter().then(() => {
    if (state.cameraReady && state.detectorReady) {
      setStatus("ready", "本地检测已就绪", getModelStatusDetail());
    }
  });

  window.setTimeout(() => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(warmup, { timeout: 2500 });
    } else {
      warmup();
    }
  }, detectorConfig.segmenterWarmupMs);
}

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function getModelStatusDetail() {
  if (state.detectorReady && state.segmenterReady) return "Coco SSD 检测 + DeepLab 分割已启用";
  if (state.detectorReady && !detectorConfig.enableSemanticSegmentation) return "手机性能模式：检测模型 + 轻量边缘回退";
  if (state.detectorReady) return "检测已启用，DeepLab 将空闲加载";
  if (state.segmenterReady) return "语义分割已启用，物体定位使用本地回退";
  return "使用本地启发式回退";
}

function getDeviceProfile() {
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return {
    isMobile,
    lowPower: isMobile || memory <= 4 || cores <= 4,
  };
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
        width: { ideal: deviceProfile.lowPower ? 640 : 1280 },
        height: { ideal: deviceProfile.lowPower ? 960 : 1920 },
        frameRate: { ideal: deviceProfile.lowPower ? 24 : 30, max: 30 },
      },
    });
    video.srcObject = stream;
    await video.play();
    state.cameraReady = true;
    video.style.display = "block";
    setStatus(
      state.detectorReady ? "ready" : "busy",
      state.detectorReady ? "正在模型识别" : "正在等待模型",
      state.detectorReady ? "把物体放在绿框中心附近" : "Coco SSD 正在浏览器内加载"
    );
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

async function maybeExtractSticker(now, box) {
  if (!box) return;
  updateStability(box);
  if (state.stableFrames < 2) {
    stickerText.textContent = "等待主体稳定";
    return;
  }
  if (state.isExtractingSticker || now - state.lastStickerAt < detectorConfig.stickerIntervalMs) return;
  state.lastStickerAt = now;
  state.isExtractingSticker = true;
  try {
    await yieldToBrowser();
    await extractSticker(box);
    if (box.source === "model") {
      stickerText.textContent = `已提取 ${box.label || "检测物体"}`;
    } else {
      stickerText.textContent = box.confidence > 0.48 ? "已提取中心主体" : "已提取中心区域";
    }
  } catch (error) {
    stickerText.textContent = "贴图提取失败，继续识别";
  } finally {
    state.isExtractingSticker = false;
  }
}

async function extractSticker(box) {
  const output = detectorConfig.stickerSize;
  const padding = box.source === "model" ? 0.18 : 0.26;
  const sourceSize = Math.max(box.w, box.h) * (1 + padding);
  const sourceX = clamp(box.x + box.w / 2 - sourceSize / 2, 0, frameCanvas.width - sourceSize);
  const sourceY = clamp(box.y + box.h / 2 - sourceSize / 2, 0, frameCanvas.height - sourceSize);

  stickerCtx.clearRect(0, 0, output, output);
  stickerCtx.drawImage(frameCanvas, sourceX, sourceY, sourceSize, sourceSize, 0, 0, output, output);

  const semanticMask = shouldUseSemanticSegmentation(box) ? await segmentStickerSubject(output) : null;
  const subject = stickerCtx.getImageData(0, 0, output, output);
  const alpha = buildSubjectAlpha(subject, output, semanticMask);
  const outline = expandMask(alpha, output, 18);
  const softAlpha = softenMask(alpha, output);

  stickerCtx.clearRect(0, 0, output, output);
  drawMaskLayer(outline, output, "#ffffff", 235);
  drawImageData(applyAlphaAndComic(subject, softAlpha, output), output);
  drawEdgeLine(alpha, output);
}

async function segmentStickerSubject(size) {
  if (!state.segmenterReady || !state.segmenter) return null;

  try {
    const result = await state.segmenter.segment(stickerCanvas);
    return semanticResultToMask(result, size);
  } catch (error) {
    state.segmenterError = true;
    state.segmenterReady = false;
    return null;
  }
}

function shouldUseSemanticSegmentation(box) {
  return Boolean(
    state.segmenterReady &&
      state.segmenter &&
      !deviceProfile.lowPower &&
      box.source === "model" &&
      box.confidence > 0.52
  );
}

function semanticResultToMask(result, size) {
  if (!result || !result.segmentationMap || !result.width || !result.height) return null;

  const selectedColors = selectSemanticColors(result, size);
  if (selectedColors.length === 0) return null;

  const mask = new Uint8ClampedArray(size * size);
  const data = result.segmentationMap;
  const width = result.width;
  const height = result.height;
  let activePixels = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x / size) * width));
      const sy = Math.min(height - 1, Math.floor((y / size) * height));
      const offset = (sy * width + sx) * 4;
      const key = colorKey(data[offset], data[offset + 1], data[offset + 2]);
      if (selectedColors.includes(key)) {
        mask[y * size + x] = 255;
        activePixels += 1;
      }
    }
  }

  return activePixels > size * size * 0.04 ? closeMask(mask, size, 3) : null;
}

function selectSemanticColors(result, size) {
  const counts = new Map();
  const data = result.segmentationMap;
  const width = result.width;
  const height = result.height;
  const center = size / 2;

  for (let y = 0; y < size; y += 3) {
    for (let x = 0; x < size; x += 3) {
      const normalizedDistance = Math.hypot(x - center, y - center) / center;
      if (normalizedDistance > 0.92) continue;

      const sx = Math.min(width - 1, Math.floor((x / size) * width));
      const sy = Math.min(height - 1, Math.floor((y / size) * height));
      const offset = (sy * width + sx) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (isSemanticBackground(r, g, b)) continue;

      const key = colorKey(r, g, b);
      counts.set(key, (counts.get(key) || 0) + (1.05 - normalizedDistance));
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter((entry) => entry[1] > 12)
    .map(([key]) => key);
}

function isSemanticBackground(r, g, b) {
  return r + g + b < 18;
}

function colorKey(r, g, b) {
  return `${r},${g},${b}`;
}

function buildSubjectAlpha(image, size, semanticMask = null) {
  const colorMask = buildColorContrastAlpha(image, size);
  if (!semanticMask) return colorMask;

  const semanticCore = shrinkMask(semanticMask, size, 5);
  const semanticFence = expandMask(semanticMask, size, 12);
  const refined = new Uint8ClampedArray(size * size);
  let activePixels = 0;

  for (let i = 0; i < refined.length; i += 1) {
    refined[i] = Math.max(semanticCore[i], Math.min(colorMask[i], semanticFence[i]));
    if (refined[i] > 96) activePixels += 1;
  }

  if (activePixels < size * size * 0.04) return colorMask;
  return keepCenterConnected(refined, size);
}

function buildColorContrastAlpha(image, size) {
  const data = image.data;
  const background = estimateBorderColor(data, size);
  const foreground = estimateCenterColor(data, size);
  const raw = new Uint8ClampedArray(size * size);
  const center = size / 2;
  const maxDistance = Math.hypot(center, center);
  let activePixels = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const bgDistance = Math.hypot(r - background.r, g - background.g, b - background.b) / 255;
      const fgDistance = Math.hypot(r - foreground.r, g - foreground.g, b - foreground.b) / 255;
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      const lumDistance = Math.abs(l - background.l) / 255;
      const centerWeight = Math.max(0, 1 - Math.hypot(x - center, y - center) / (maxDistance * 0.86));
      const edgeBias = localPixelContrast(data, size, x, y) / 255;
      const objectLikelihood = clamp(bgDistance - fgDistance * 0.42 + lumDistance * 0.26 + edgeBias * 0.16 + centerWeight * 0.22, 0, 1);
      const alpha = smoothStep(0.18, 0.42, objectLikelihood) * 255;
      raw[y * size + x] = alpha;
      if (alpha > 96) activePixels += 1;
    }
  }

  const minArea = size * size * 0.06;
  if (activePixels < minArea) {
    return fallbackBoxAlpha(size);
  }

  return keepCenterConnected(closeMask(raw, size, 2), size);
}

function estimateCenterColor(data, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  let l = 0;
  let count = 0;
  const center = size / 2;
  const radius = size * 0.23;

  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      if (Math.hypot(x - center, y - center) > radius) continue;
      const index = (y * size + x) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      l += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      count += 1;
    }
  }

  return {
    r: r / count,
    g: g / count,
    b: b / count,
    l: l / count,
  };
}

function estimateBorderColor(data, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  let l = 0;
  let count = 0;
  const border = Math.max(10, Math.round(size * 0.08));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x > border && x < size - border && y > border && y < size - border) continue;
      const index = (y * size + x) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      l += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      count += 1;
    }
  }

  return {
    r: r / count,
    g: g / count,
    b: b / count,
    l: l / count,
  };
}

function localPixelContrast(data, size, x, y) {
  const index = (y * size + x) * 4;
  const current = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  let total = 0;
  let count = 0;
  for (let oy = -2; oy <= 2; oy += 2) {
    for (let ox = -2; ox <= 2; ox += 2) {
      if (ox === 0 && oy === 0) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const ni = (ny * size + nx) * 4;
      const other = data[ni] * 0.299 + data[ni + 1] * 0.587 + data[ni + 2] * 0.114;
      total += Math.abs(current - other);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function keepCenterConnected(mask, size) {
  const visited = new Uint8Array(size * size);
  const output = new Uint8ClampedArray(size * size);
  const queue = [];
  const center = Math.floor(size / 2);
  const seeds = [
    [center, center],
    [center - 24, center],
    [center + 24, center],
    [center, center - 24],
    [center, center + 24],
  ];

  seeds.forEach(([x, y]) => {
    const index = y * size + x;
    if (mask[index] > 42 && !visited[index]) {
      visited[index] = 1;
      queue.push(index);
    }
  });

  let head = 0;
  while (head < queue.length) {
    const index = queue[head];
    head += 1;
    output[index] = mask[index];
    const x = index % size;
    const y = Math.floor(index / size);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    neighbors.forEach(([nx, ny]) => {
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) return;
      const ni = ny * size + nx;
      if (!visited[ni] && mask[ni] > 36) {
        visited[ni] = 1;
        queue.push(ni);
      }
    });
  }

  return queue.length < size * size * 0.04 ? fallbackBoxAlpha(size) : output;
}

function fallbackBoxAlpha(size) {
  const mask = new Uint8ClampedArray(size * size);
  const center = size / 2;
  const rx = size * 0.34;
  const ry = size * 0.38;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot((x - center) / rx, (y - center) / ry);
      mask[y * size + x] = smoothStep(1.08, 0.82, distance) * 255;
    }
  }
  return mask;
}

function softenMask(mask, size) {
  let softened = mask;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Uint8ClampedArray(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let total = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            total += softened[ny * size + nx];
            count += 1;
          }
        }
        next[y * size + x] = total / count;
      }
    }
    softened = next;
  }
  return softened;
}

function closeMask(mask, size, radius) {
  return shrinkMask(expandMask(mask, size, radius), size, radius);
}

function shrinkMask(mask, size, radius) {
  let shrunk = mask;
  for (let step = 0; step < radius; step += 1) {
    const next = new Uint8ClampedArray(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let min = shrunk[y * size + x];
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            min = Math.min(min, shrunk[ny * size + nx]);
          }
        }
        next[y * size + x] = min;
      }
    }
    shrunk = next;
  }
  return softenMask(shrunk, size);
}

function expandMask(mask, size, radius) {
  let expanded = mask;
  for (let step = 0; step < radius; step += 1) {
    const next = new Uint8ClampedArray(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let max = expanded[y * size + x];
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            max = Math.max(max, expanded[ny * size + nx]);
          }
        }
        next[y * size + x] = max;
      }
    }
    expanded = next;
  }
  return softenMask(expanded, size);
}

function drawMaskLayer(mask, size, color, alphaLimit) {
  ensureLayerSize(size);
  const layer = stickerCtx.createImageData(size, size);
  const rgb = hexToRgb(color);
  for (let i = 0; i < mask.length; i += 1) {
    const offset = i * 4;
    layer.data[offset] = rgb.r;
    layer.data[offset + 1] = rgb.g;
    layer.data[offset + 2] = rgb.b;
    layer.data[offset + 3] = Math.min(alphaLimit, mask[i]);
  }
  layerCtx.clearRect(0, 0, size, size);
  layerCtx.putImageData(layer, 0, 0);
  stickerCtx.drawImage(layerCanvas, 0, 0);
}

function applyAlphaAndComic(image, mask, size) {
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = mask[i / 4];
    data[i + 3] = alpha;
    if (alpha < 4) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    const contrast = 1.1;
    data[i] = quantize(clamp((r - 128) * contrast + 128 + 4, 0, 255), 14);
    data[i + 1] = quantize(clamp((g - 128) * contrast + 128 + 4, 0, 255), 14);
    data[i + 2] = quantize(clamp((b - 128) * contrast + 128 + 4, 0, 255), 14);
    if (l < 54) {
      data[i] *= 0.78;
      data[i + 1] *= 0.78;
      data[i + 2] *= 0.78;
    }
  }
  return image;
}

function drawImageData(image, size) {
  ensureLayerSize(size);
  layerCtx.clearRect(0, 0, size, size);
  layerCtx.putImageData(image, 0, 0);
  stickerCtx.drawImage(layerCanvas, 0, 0);
}

function ensureLayerSize(size) {
  if (layerCanvas.width !== size || layerCanvas.height !== size) {
    layerCanvas.width = size;
    layerCanvas.height = size;
  }
}

function drawEdgeLine(mask, size) {
  const edge = new Uint8ClampedArray(size * size);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x;
      if (mask[index] < 80) continue;
      const nearTransparent =
        mask[index - 1] < 80 ||
        mask[index + 1] < 80 ||
        mask[index - size] < 80 ||
        mask[index + size] < 80;
      if (nearTransparent) edge[index] = 150;
    }
  }
  drawMaskLayer(expandMask(edge, size, 2), size, "#17211f", 120);
}

function smoothStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
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

  if (now - state.lastAnalyzeAt > detectorConfig.detectEveryMs && !state.isDetecting) {
    state.lastAnalyzeAt = now;
    scheduleDetection(now);
  }

  drawOverlay(state.activeBox);
  requestAnimationFrame(loop);
}

async function scheduleDetection(now) {
  state.isDetecting = true;
  try {
    const rawBox = state.detectorReady ? await detectWithModel() : analyzeFrame();
    const box = smoothBox(rawBox || analyzeFrame());
    state.activeBox = box;
    updateDetectionStatus(box);
    maybeExtractSticker(now, box);
  } catch (error) {
    state.detectorError = true;
    const box = smoothBox(analyzeFrame());
    state.activeBox = box;
    maybeExtractSticker(now, box);
    setStatus("error", "模型检测异常", "已回退到本地贴图定位");
  } finally {
    state.isDetecting = false;
  }
}

async function detectWithModel() {
  if (!state.detector) return null;
  const predictions = await state.detector.detect(frameCanvas, detectorConfig.maxDetections, detectorConfig.minScore);
  const selected = selectBestPrediction(predictions);
  if (!selected) return null;
  return predictionToBox(selected);
}

function selectBestPrediction(predictions) {
  if (!predictions || predictions.length === 0) return null;

  const focus = getFocusPoint();
  const maxDistance = Math.hypot(frameCanvas.width * 0.5, frameCanvas.height * 0.5);
  return predictions
    .filter((prediction) => prediction.score >= detectorConfig.minScore)
    .map((prediction) => {
      const [x, y, w, h] = prediction.bbox;
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const centerCloseness = Math.max(0, 1 - Math.hypot(centerX - focus.x, centerY - focus.y) / maxDistance);
      return {
        ...prediction,
        selectionScore: prediction.score * (1 - detectorConfig.centerWeight) + centerCloseness * detectorConfig.centerWeight,
      };
    })
    .sort((a, b) => b.selectionScore - a.selectionScore || b.score - a.score)[0] || null;
}

function getFocusPoint() {
  const box = state.activeBox;
  if (box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
  return { x: frameCanvas.width / 2, y: frameCanvas.height / 2 };
}

function predictionToBox(prediction) {
  const [x, y, w, h] = prediction.bbox;
  const box = constrainBox(
    {
      x,
      y,
      w,
      h,
      confidence: prediction.score,
      signature: (x + y * 3 + w * 5 + h * 7 + prediction.score * 1000),
      label: prediction.class,
      source: "model",
    },
    frameCanvas.width,
    frameCanvas.height
  );
  box.label = prediction.class;
  box.source = "model";
  return box;
}

function updateDetectionStatus(box) {
  if (!state.cameraReady) return;
  if (box && box.source === "model") {
    const percent = Math.round(box.confidence * 100);
    setStatus("ready", "模型本地识别", `${box.label || "object"} · ${percent}% · ${state.segmenterReady ? "DeepLab 精修" : "性能模式"}`);
    return;
  }
  setStatus(
    state.detectorError ? "error" : "busy",
    state.detectorError ? "检测模型不可用" : "等待模型检测",
    state.detectorError ? getModelStatusDetail() : "请把物体放在绿框中心附近"
  );
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function scheduleDetection(now) {
  state.isDetecting = true;
  try {
    const rawBox = state.detectorReady ? await detectWithModel() : analyzeFrame();
    const box = smoothBox(rawBox || analyzeFrame());
    state.activeBox = box;
    await maybeExtractSticker(now, box);
    updateDetectionStatus(box);
  } catch (error) {
    state.detectorError = true;
    const box = smoothBox(analyzeFrame());
    state.activeBox = box;
    await maybeExtractSticker(now, box);
    setStatus("error", "模型检测异常", "已回退到本地贴图定位");
  } finally {
    state.isDetecting = false;
  }
}

async function detectWithModel() {
  if (!state.detector) return null;
  const predictions = await state.detector.detect(frameCanvas, 12, detectorConfig.minScore);
  const selected = selectBestPrediction(predictions);
  if (!selected) return null;
  return predictionToBox(selected);
}

function selectBestPrediction(predictions) {
  if (!predictions || predictions.length === 0) return null;

  const focus = getFocusPoint();
  const maxDistance = Math.hypot(frameCanvas.width * 0.5, frameCanvas.height * 0.5);
  return predictions
    .filter((prediction) => prediction.score >= detectorConfig.minScore)
    .map((prediction) => {
      const [x, y, w, h] = prediction.bbox;
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const centerCloseness = Math.max(0, 1 - Math.hypot(centerX - focus.x, centerY - focus.y) / maxDistance);
      return {
        ...prediction,
        selectionScore: prediction.score * (1 - detectorConfig.centerWeight) + centerCloseness * detectorConfig.centerWeight,
      };
    })
    .sort((a, b) => b.selectionScore - a.selectionScore || b.score - a.score)[0] || null;
}

function getFocusPoint() {
  const box = state.activeBox;
  if (box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
  return { x: frameCanvas.width / 2, y: frameCanvas.height / 2 };
}

function predictionToBox(prediction) {
  const [x, y, w, h] = prediction.bbox;
  const box = constrainBox(
    {
      x,
      y,
      w,
      h,
      confidence: prediction.score,
      signature: (x + y * 3 + w * 5 + h * 7 + prediction.score * 1000),
      label: prediction.class,
      source: "model",
    },
    frameCanvas.width,
    frameCanvas.height
  );
  box.label = prediction.class;
  box.source = "model";
  return box;
}

function updateDetectionStatus(box) {
  if (!state.cameraReady) return;
  if (box && box.source === "model") {
    const percent = Math.round(box.confidence * 100);
    setStatus("ready", "模型本地识别", `${box.label || "object"} · ${percent}% · ${state.segmenterReady ? "DeepLab 边缘分割" : "本地边缘回退"}`);
    return;
  }
  setStatus(
    state.detectorError ? "error" : "busy",
    state.detectorError ? "检测模型不可用" : "等待模型检测",
    state.detectorError ? getModelStatusDetail() : "请把物体放在绿框中心附近"
  );
}

window.addEventListener("error", (event) => {
  setStatus("error", "页面脚本出错", event.message || "请刷新后重试");
  retryButton.classList.add("is-visible");
});

retryButton.addEventListener("click", startCamera);
window.addEventListener("resize", resizeCanvases);

resizeCanvases();
setStatus("busy", "正在加载本地检测", "手机性能模式会降低分辨率和推理频率");
loadDetector();
startCamera();
requestAnimationFrame(loop);
