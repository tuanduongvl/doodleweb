(() => {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  const MAX_UNDO = 30;
  let undoStack = [];
  let currentColor = '#ff4d6d';  // first core hue
  let brushSize = 6;
  let isErasing = false;
  let isFilling = false;
  let isRainbow = false;
  let rainbowHue = 0;          // current hue for rainbow mode (0-360)
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let activePid = null;

  // ─── Canvas Setup ──────────────────────────────────────────────────────────
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function resizeCanvas() {
    const toolbar = document.getElementById('toolbar');
    const toolbarH = toolbar.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor((window.innerHeight - toolbarH) * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = (window.innerHeight - toolbarH) + 'px';

    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(snapshot, 0, 0);
    applyContextDefaults();
  }

  function applyContextDefaults() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  // ─── Undo ──────────────────────────────────────────────────────────────────
  function pushUndo() {
    if (undoStack.length >= MAX_UNDO) undoStack.shift();
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  function undo() {
    if (undoStack.length === 0) return;
    ctx.putImageData(undoStack.pop(), 0, 0);
    applyContextDefaults();
  }

  // ─── Rainbow Hue → hex ─────────────────────────────────────────────────────
  function rainbowColor() {
    // pastel-ified: high lightness (80%), medium saturation (70%)
    return `hsl(${rainbowHue}, 70%, 80%)`;
  }

  function advanceRainbow() {
    rainbowHue = (rainbowHue + 3) % 360;
  }

  // ─── Drawing Helpers ───────────────────────────────────────────────────────
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function getPressureSize(e) {
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    return brushSize * (0.4 + 1.2 * pressure);
  }

  function activeStrokeColor() {
    return isRainbow ? rainbowColor() : currentColor;
  }

  // ─── Flood Fill (Paint Bucket) ─────────────────────────────────────────────
  function hexToRgba(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
  }

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), 255];
  }

  function fillColorRgba() {
    if (isRainbow) return hslToRgb(rainbowHue, 70, 80);
    return hexToRgba(currentColor);
  }

  function colorsMatch(data, idx, target, tolerance) {
    return (
      Math.abs(data[idx] - target[0]) <= tolerance &&
      Math.abs(data[idx + 1] - target[1]) <= tolerance &&
      Math.abs(data[idx + 2] - target[2]) <= tolerance &&
      Math.abs(data[idx + 3] - target[3]) <= tolerance
    );
  }

  function floodFill(startX, startY) {
    const dpr = window.devicePixelRatio || 1;
    const px = Math.floor(startX * dpr);
    const py = Math.floor(startY * dpr);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;

    const startIdx = (py * w + px) * 4;
    const targetCol = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
    const fillCol = fillColorRgba();
    const TOLERANCE = 30;

    // Already the fill color — nothing to do
    if (colorsMatch(data, startIdx, fillCol, 1)) return;
    // Same color within tolerance — skip
    if (colorsMatch(data, startIdx, targetCol, 0) &&
      targetCol[0] === fillCol[0] && targetCol[1] === fillCol[1] &&
      targetCol[2] === fillCol[2]) return;

    // Scanline stack flood fill (fast)
    const stack = [[px, py]];
    const visited = new Uint8Array(w * h);

    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      const i = cy * w + cx;
      if (visited[i]) continue;

      const idx = i * 4;
      if (!colorsMatch(data, idx, targetCol, TOLERANCE)) continue;

      visited[i] = 1;
      data[idx] = fillCol[0];
      data[idx + 1] = fillCol[1];
      data[idx + 2] = fillCol[2];
      data[idx + 3] = fillCol[3];

      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }

    ctx.putImageData(imgData, 0, 0);
    applyContextDefaults();
  }

  // ─── Pointer Events ────────────────────────────────────────────────────────
  function startStroke(e) {
    if (activePid !== null && e.pointerId !== activePid) return;
    activePid = e.pointerId;
    canvas.setPointerCapture(e.pointerId);

    const { x, y } = getPos(e);

    // Fill mode — flood fill on tap then release
    if (isFilling) {
      pushUndo();
      floodFill(x, y);
      activePid = null;
      return;
    }

    pushUndo();
    isDrawing = true;
    lastX = x; lastY = y;

    const col = activeStrokeColor();
    ctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
    ctx.strokeStyle = col;
    ctx.lineWidth = getPressureSize(e);
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = isErasing ? 'rgba(0,0,0,1)' : col;
    ctx.fill();
  }

  function continueStroke(e) {
    if (!isDrawing || e.pointerId !== activePid) return;

    if (isRainbow) advanceRainbow();
    const { x, y } = getPos(e);
    const col = activeStrokeColor();

    ctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
    ctx.strokeStyle = col;
    ctx.lineWidth = getPressureSize(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastX = x; lastY = y;
  }

  function endStroke(e) {
    if (e.pointerId !== activePid) return;
    isDrawing = false;
    activePid = null;
  }

  canvas.addEventListener('pointerdown', startStroke, { passive: false });
  canvas.addEventListener('pointermove', continueStroke, { passive: false });
  canvas.addEventListener('pointerup', endStroke, { passive: false });
  canvas.addEventListener('pointercancel', endStroke, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ─── Color Palette ─────────────────────────────────────────────────────────
  const swatches = document.querySelectorAll('.swatch[data-color]');
  function applySelectedColor(activeEl) {
    setActiveSwatch(activeEl);
    deactivateRainbow();
    if (isErasing) {
      deactivateEraser();
    }
    if (!isFilling) {
      activatePen(false);
    }
  }

  swatches.forEach(btn => {
    btn.addEventListener('click', () => {
      currentColor = btn.dataset.color;
      applySelectedColor(btn);
    });
  });

  // Rainbow swatch
  const swatchRainbow = document.getElementById('swatchRainbow');
  swatchRainbow.addEventListener('click', () => {
    isRainbow = !isRainbow;
    if (isRainbow) {
      applySelectedColor(swatchRainbow);
    } else {
      swatchRainbow.classList.remove('active');
      // Reactivate first pastel as default
      const firstSwatch = document.querySelector('.swatch[data-color]');
      currentColor = firstSwatch.dataset.color;
      setActiveSwatch(firstSwatch);
    }
  });

  // Custom color picker
  const colorPicker = document.getElementById('colorPicker');
  const pickerSwatch = colorPicker.closest('label');

  colorPicker.addEventListener('input', () => {
    currentColor = colorPicker.value;
    applySelectedColor(pickerSwatch);
  });
  pickerSwatch.addEventListener('click', () => colorPicker.click());

  function setActiveSwatch(activeEl) {
    document.querySelectorAll('#palette .swatch').forEach(s => s.classList.remove('active'));
    activeEl.classList.add('active');
  }

  function deactivateRainbow() {
    isRainbow = false;
    swatchRainbow.classList.remove('active');
  }

  // ─── Brush Size ────────────────────────────────────────────────────────────
  const brushSlider = document.getElementById('brushSize');
  const sizeDisplay = document.getElementById('sizeDisplay');

  brushSlider.addEventListener('input', () => {
    brushSize = parseInt(brushSlider.value, 10);
    sizeDisplay.textContent = brushSize;
  });

  // ─── Tool Buttons ──────────────────────────────────────────────────────────
  const btnPen = document.getElementById('btnPen');
  const btnBucket = document.getElementById('btnBucket');
  const btnEraser = document.getElementById('btnEraser');
  const btnUndo = document.getElementById('btnUndo');
  const btnClear = document.getElementById('btnClear');
  const btnSave = document.getElementById('btnSave');

  function setActiveTool(activeBtn) {
    [btnPen, btnBucket, btnEraser].forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }

  function activatePen(updateBtn = true) {
    isErasing = false;
    isFilling = false;
    document.body.classList.remove('eraser-mode', 'fill-mode');
    if (updateBtn) setActiveTool(btnPen);
  }

  function deactivateEraser() {
    isErasing = false;
    document.body.classList.remove('eraser-mode');
  }

  function deactivateFill() {
    isFilling = false;
    document.body.classList.remove('fill-mode');
  }

  btnPen.addEventListener('click', () => {
    activatePen(true);
  });

  btnBucket.addEventListener('click', () => {
    isFilling = !isFilling;
    if (isFilling) {
      isErasing = false;
      document.body.classList.remove('eraser-mode');
      document.body.classList.add('fill-mode');
      setActiveTool(btnBucket);
    } else {
      document.body.classList.remove('fill-mode');
      setActiveTool(btnPen);
    }
  });

  btnEraser.addEventListener('click', () => {
    isErasing = !isErasing;
    if (isErasing) {
      isFilling = false;
      document.body.classList.remove('fill-mode');
      document.body.classList.add('eraser-mode');
      setActiveTool(btnEraser);
    } else {
      document.body.classList.remove('eraser-mode');
      setActiveTool(btnPen);
    }
  });

  btnUndo.addEventListener('click', () => {
    undo();
    btnUndo.style.transform = 'scale(0.88)';
    setTimeout(() => (btnUndo.style.transform = ''), 150);
  });

  btnClear.addEventListener('click', () => {
    if (!confirm('Clear the canvas?')) return;
    pushUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyContextDefaults();
  });

  btnSave.addEventListener('click', () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const offCtx = offscreen.getContext('2d');
    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    offCtx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = offscreen.toDataURL('image/png');
    a.download = `doodle-${Date.now()}.png`;
    a.click();
  });

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'e' || e.key === 'E') btnEraser.click();
    if (e.key === 'p' || e.key === 'P') btnPen.click();
    if (e.key === 'f' || e.key === 'F') btnBucket.click();
    if (e.key === 'Escape') { closePanel(); hideModal(); }
  });

  // ─── Coloring Pages Panel ──────────────────────────────────────────────────
  const pagesPanel = document.getElementById('pagesPanel');
  const btnPages = document.getElementById('btnPages');
  const btnClosePanel = document.getElementById('btnClosePanel');
  const pagesGrid = document.getElementById('pagesGrid');
  const pagesPanelHint = document.getElementById('pagesPanelHint');
  let pageThumbs = [];
  const supportedExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

  function openPanel() {
    pagesPanel.classList.add('open');
    btnPages.classList.add('active');
  }
  function closePanel() {
    pagesPanel.classList.remove('open');
    btnPages.classList.remove('active');
  }

  btnPages.addEventListener('click', () => {
    pagesPanel.classList.contains('open') ? closePanel() : openPanel();
  });
  btnClosePanel.addEventListener('click', closePanel);

  function isSupportedImage(fileName) {
    const lower = fileName.toLowerCase();
    for (const ext of supportedExtensions) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  function normalizePageHref(href) {
    try {
      const url = new URL(href, window.location.href);
      if (!url.pathname.includes('/pages/')) return null;
      if (url.pathname.endsWith('/')) return null;
      const file = url.pathname.split('/').pop();
      if (!file) return null;
      return `pages/${decodeURIComponent(file)}`;
    } catch (err) {
      return null;
    }
  }

  function extractPageLinks(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('a'))
      .map(a => a.getAttribute('href'))
      .filter(Boolean)
      .map(normalizePageHref)
      .filter(Boolean);
  }

  function normalizeManifestEntry(entry) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.endsWith('/')) return null;
    if (!isSupportedImage(trimmed)) return null;
    return trimmed.startsWith('pages/') ? trimmed : `pages/${trimmed}`;
  }

  function addPageThumb(src) {
    const btn = document.createElement('button');
    btn.className = 'page-thumb';
    btn.type = 'button';
    btn.dataset.src = src;

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    btn.appendChild(img);

    btn.addEventListener('click', () => showModal(src, btn));
    pagesGrid.appendChild(btn);
    pageThumbs.push(btn);
  }

  async function loadPagesList() {
    pagesGrid.innerHTML = '';
    pageThumbs = [];
    pagesPanelHint.textContent = 'Loading pages...';

    try {
      const response = await fetch('pages/', { cache: 'no-store' });
      let files = [];
      if (response.ok) {
        const html = await response.text();
        files = extractPageLinks(html).filter(isSupportedImage);
      }

      if (!files.length) {
        const manifestResponse = await fetch('pages/index.json', { cache: 'no-store' });
        if (!manifestResponse.ok) {
          throw new Error(`Failed to fetch pages manifest: ${manifestResponse.status}`);
        }
        const manifest = await manifestResponse.json();
        if (Array.isArray(manifest)) {
          files = manifest.map(normalizeManifestEntry).filter(Boolean);
        } else if (Array.isArray(manifest.pages)) {
          files = manifest.pages.map(normalizeManifestEntry).filter(Boolean);
        }
      }

      const uniqueFiles = Array.from(new Set(files)).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );

      if (!uniqueFiles.length) throw new Error('No images found');

      uniqueFiles.forEach(addPageThumb);
      pagesPanelHint.textContent = 'Tap a page to start coloring!';
    } catch (err) {
      console.warn('Unable to load pages list:', err);
      pagesPanelHint.textContent = 'No coloring pages found in /pages.';
    }
  }

  // ─── Confirm Modal ─────────────────────────────────────────────────────────
  const confirmModal = document.getElementById('confirmModal');
  const confirmOk = document.getElementById('confirmOk');
  const confirmCancel = document.getElementById('confirmCancel');
  let pendingPageSrc = null;
  let pendingThumb = null;

  function showModal(src, thumb) {
    pendingPageSrc = src;
    pendingThumb = thumb;
    confirmModal.classList.add('visible');
  }
  function hideModal() {
    confirmModal.classList.remove('visible');
    pendingPageSrc = null;
    pendingThumb = null;
  }

  confirmCancel.addEventListener('click', hideModal);
  confirmModal.addEventListener('click', e => { if (e.target === confirmModal) hideModal(); });

  confirmOk.addEventListener('click', () => {
    if (!pendingPageSrc) { hideModal(); return; }
    loadColoringPage(pendingPageSrc, pendingThumb);
    hideModal();
    closePanel();
  });

  // ─── Load SVG onto Canvas ──────────────────────────────────────────────────
  function loadColoringPage(src, thumb) {
    const img = new Image();
    img.onload = () => {
      pushUndo();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Scale to fill canvas (contain, centred)
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const scale = Math.min(cw / img.width, ch / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      ctx.drawImage(img, dx, dy, dw, dh);
      applyContextDefaults();

      // Highlight selected thumbnail
      pageThumbs.forEach(t => t.classList.remove('selected'));
      if (thumb) thumb.classList.add('selected');
    };
    img.onerror = () => console.error('Failed to load coloring page:', src);
    img.src = src;
  }

  loadPagesList();

})();

