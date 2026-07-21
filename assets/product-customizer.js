/**
 * Front/Back shirt customizer - see md/PRD-shirt-customizer.md.
 *
 * Phase 1: scaffold + config handoff.
 * Phase 2: variant-change hook + base-image draw (PRD 8.6).
 * Phase 3: front/back tabs, per-side state (PRD 8.4), and the base+text canvas
 *          render (PRD 8.5) - print-area guide, drag-clamp helper, overflow
 *          auto-scale, and font loading with a redraw on document.fonts.ready.
 *
 * Text/font/color/size controls and drag-to-place are Phase 4; they drive the
 * per-side state through updateSide()/setSide() and call render(). The canvas is
 * the base-image area: normalized print-area/text coords (0..1) map to canvas px,
 * and text size is px-per-1000px-of-height so it stays stable across screen sizes
 * and the high-res Phase 6 export.
 */
class ProductCustomizer extends HTMLElement {
  constructor() {
    super();
    this.config = null;
    this.side = 'front';
    this.imageCache = new Map();
    this.currentImage = null;
    this.baseUrls = null;
    this.renderToken = 0;
  }

  connectedCallback() {
    this.config = this.readConfig();
    if (!this.config) return;

    this.canvas = this.querySelector('[data-customizer-canvas]');
    this.preview = this.querySelector('[data-customizer-preview]');
    this.tabsEl = this.querySelector('[data-customizer-tabs]');
    this.panel = this.querySelector('[data-customizer-panel]');
    this.productFormId = this.dataset.productFormId;

    this.initState();
    this.initCanvas();
    this.buildTabs();
    this.loadFonts();
    this.setActiveBase(this.config.selectedVariantId);
    this.subscribeToVariantChange();

    this.setAttribute('data-ready', 'true');
    this.dispatchEvent(
      new CustomEvent('customizer:ready', { bubbles: true, detail: { config: this.config } })
    );
  }

  disconnectedCallback() {
    if (this.variantUnsubscribe) this.variantUnsubscribe();
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }

  readConfig() {
    const el = this.querySelector('[data-customizer-config]');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (error) {
      console.error('[product-customizer] invalid config JSON', error);
      return null;
    }
  }

  /* ---- per-side state ---- */

  initState() {
    const defaultFont = (this.config.fonts && this.config.fonts[0]) || 'Anton';
    this.printAreaFront = this.config.printAreaFront || { x: 0.3, y: 0.32, w: 0.4, h: 0.34 };
    this.printAreaBack = this.config.printAreaBack || { x: 0.28, y: 0.28, w: 0.44, h: 0.4 };

    const makeSide = (pa) => ({
      mode: 'custom', // 'custom' | 'preset'
      text: '',
      preset: '',
      font: defaultFont,
      color: '#22242A',
      size: 54, // px per 1000px of canvas height
      x: pa.x + pa.w / 2,
      y: pa.y + pa.h / 2,
    });

    this.state = { front: makeSide(this.printAreaFront), back: makeSide(this.printAreaBack) };
  }

  printAreaFor(side) {
    return side === 'back' ? this.printAreaBack : this.printAreaFront;
  }

  /** Phase 4 control entry point: merge a patch into the active side and redraw. */
  updateSide(patch) {
    Object.assign(this.state[this.side], patch);
    this.render();
  }

  /** Clamp a normalized point into the active side's print area (used by Phase 4 drag). */
  clampToPrintArea(side, x, y) {
    const pa = this.printAreaFor(side);
    return {
      x: Math.min(Math.max(x, pa.x), pa.x + pa.w),
      y: Math.min(Math.max(y, pa.y), pa.y + pa.h),
    };
  }

  /* ---- config helpers ---- */

  baseImagesFor(variantId) {
    const cfg = this.config;
    const entry = cfg && cfg.variants ? cfg.variants[String(variantId)] : null;
    const front = (entry && entry.front) || cfg.productImage || null;
    const back = (entry && entry.back) || null;
    return { front, back };
  }

  /* ---- front/back tabs ---- */

  buildTabs() {
    if (!this.tabsEl) return;
    this.tabButtons = {};
    ['front', 'back'].forEach((side) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'product-customizer__tab';
      btn.dataset.side = side;
      btn.setAttribute('role', 'tab');
      btn.textContent = side === 'front' ? 'Front' : 'Back';
      btn.addEventListener('click', () => this.setSide(side));
      this.tabsEl.appendChild(btn);
      this.tabButtons[side] = btn;
    });
    this.updateTabs();
  }

  /** Re-evaluate back-tab availability (per variant) and reflect the active side. */
  updateTabs() {
    if (!this.tabButtons) return;
    const hasBack = !!(this.config.enableBack && this.baseUrls && this.baseUrls.back);

    // Edge case: on the back tab but the new variant has no back image -> fall back.
    if (!hasBack && this.side === 'back') this.side = 'front';

    this.tabButtons.back.hidden = !hasBack;
    Object.entries(this.tabButtons).forEach(([side, btn]) => {
      const active = side === this.side;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // With no back option there is only one side - hide the whole tab bar.
    if (this.tabsEl) this.tabsEl.hidden = !hasBack;
  }

  setSide(side) {
    if (side === 'back' && !(this.config.enableBack && this.baseUrls && this.baseUrls.back)) return;
    if (this.side === side) return;
    this.side = side;
    this.updateTabs();
    this.renderActiveSide();
    this.dispatchEvent(new CustomEvent('customizer:sidechange', { bubbles: true, detail: { side } }));
  }

  /* ---- canvas ---- */

  initCanvas() {
    if (!this.canvas || !this.preview) return;
    this.ctx = this.canvas.getContext('2d');
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.preview);
    this.resizeCanvas();
  }

  resizeCanvas() {
    if (!this.canvas || !this.ctx || !this.preview) return;
    const rect = this.preview.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // not laid out yet
    const dpr = window.devicePixelRatio || 1;
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    this.render();
  }

  applyAspect(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
    if (this.aspect === ratio) return;
    this.aspect = ratio;
    this.preview.style.setProperty('--customizer-aspect', ratio);
    this.resizeCanvas();
  }

  /** Draw base + (guide) + text for a side onto any context. Reused by Phase 6 export. */
  composite(ctx, w, h, img, side, options = {}) {
    ctx.clearRect(0, 0, w, h);
    if (img) {
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
      ctx.fillRect(0, 0, w, h);
    }
    if (options.guide) this.drawGuide(ctx, w, h, side);
    this.drawText(ctx, this.state[side], w, h, side);
  }

  render() {
    if (!this.ctx || !this.viewW || !this.viewH) return;
    this.composite(this.ctx, this.viewW, this.viewH, this.currentImage, this.side, { guide: true });
  }

  drawGuide(ctx, w, h, side) {
    const pa = this.printAreaFor(side);
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(pa.x * w, pa.y * h, pa.w * w, pa.h * h);
    ctx.restore();
  }

  drawText(ctx, side_state, w, h, side) {
    const text = (side_state.mode === 'preset' ? side_state.preset : side_state.text).trim();
    if (!text) return; // empty text -> no text layer (and no property/mockup later)

    const pa = this.printAreaFor(side);
    const baseFontPx = (side_state.size * h) / 1000;

    ctx.save();
    ctx.fillStyle = side_state.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${baseFontPx}px "${side_state.font}", sans-serif`;

    // Overflow edge case: auto-scale down to the print-area width.
    const maxWidth = pa.w * w;
    const measured = ctx.measureText(text).width;
    let fontPx = baseFontPx;
    if (measured > maxWidth && measured > 0) {
      fontPx = baseFontPx * (maxWidth / measured);
      ctx.font = `${fontPx}px "${side_state.font}", sans-serif`;
    }

    ctx.fillText(text, side_state.x * w, side_state.y * h);
    ctx.restore();
  }

  /* ---- fonts (PRD 8.5: load fonts, redraw on document.fonts.ready) ---- */

  loadFonts() {
    const fonts = (this.config.fonts || []).filter(Boolean);
    if (fonts.length && !document.querySelector('link[data-customizer-fonts]')) {
      const families = fonts
        .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`)
        .join('&');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
      link.setAttribute('data-customizer-fonts', '');
      document.head.appendChild(link);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => this.render());
    }
  }

  /* ---- image loading (CORS-safe so Phase 6 canvas export is not tainted) ---- */

  loadImage(url) {
    if (!url) return Promise.reject(new Error('no image url'));
    if (this.imageCache.has(url)) return this.imageCache.get(url);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`image failed to load: ${url}`));
      img.src = url;
    });
    this.imageCache.set(url, promise);
    return promise;
  }

  /* ---- variant hook ---- */

  setActiveBase(variantId) {
    this.currentVariantId = String(variantId);
    const { front, back } = this.baseImagesFor(variantId);
    this.baseUrls = { front, back };
    if (back) this.loadImage(back).catch(() => {}); // warm cache for the back tab
    this.updateTabs(); // back availability can change per variant
    return this.renderActiveSide();
  }

  /** Load + draw the base image for the active side, ignoring superseded loads. */
  async renderActiveSide() {
    const url = this.baseUrls ? this.baseUrls[this.side] : null;
    const token = ++this.renderToken;
    if (!url) {
      this.currentImage = null;
      this.render();
      return;
    }
    try {
      const img = await this.loadImage(url);
      if (token !== this.renderToken) return; // a newer selection superseded this one
      this.currentImage = img;
      this.applyAspect(img);
      this.render();
    } catch (error) {
      if (token !== this.renderToken) return;
      this.currentImage = null;
      this.render();
    }
  }

  subscribeToVariantChange() {
    if (typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return;
    this.variantUnsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, (payload) => {
      const data = payload && payload.data;
      if (!data) return;
      if (String(data.sectionId) !== String(this.dataset.sectionId)) return; // not our section
      if (!data.variant) return; // unavailable option combination
      this.setActiveBase(data.variant.id);
    });
  }
}

customElements.define('product-customizer', ProductCustomizer);
