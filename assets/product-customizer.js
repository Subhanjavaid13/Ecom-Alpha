/**
 * Front/Back shirt customizer - see md/PRD-shirt-customizer.md.
 *
 * Phase 1: scaffold + config handoff.
 * Phase 2: native variant swatch/size is handled by Dawn's variant_picker block;
 *          here we subscribe to Dawn's variant-change event and swap the preview
 *          base image, drawing it on the canvas (PRD 8.6).
 *
 * Front/back tabs + per-side text state, text controls, drag-to-place, property-input
 * binding and mockup export/upload are added in later phases. The canvas is treated
 * as the base-image area: normalized print-area/text coordinates (0..1) map directly
 * to canvas pixels, and the preview box adopts the image's aspect ratio.
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
    this.panel = this.querySelector('[data-customizer-panel]');
    this.productFormId = this.dataset.productFormId;

    this.initCanvas();
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

  /* ---- config helpers ---- */

  /**
   * Resolve the front/back base image URLs for a variant id, with graceful
   * fallback to the product image when a variant/side has no dedicated base.
   * Returns { front: string|null, back: string|null }.
   */
  baseImagesFor(variantId) {
    const cfg = this.config;
    const entry = cfg && cfg.variants ? cfg.variants[String(variantId)] : null;
    const front = (entry && entry.front) || cfg.productImage || null;
    const back = (entry && entry.back) || null;
    return { front, back };
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

  /** Make the preview box match the base image's aspect ratio (no distortion). */
  applyAspect(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
    if (this.aspect === ratio) return;
    this.aspect = ratio;
    this.preview.style.setProperty('--customizer-aspect', ratio);
    this.resizeCanvas();
  }

  render() {
    const ctx = this.ctx;
    if (!ctx || !this.viewW || !this.viewH) return;
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    if (this.currentImage) {
      ctx.drawImage(this.currentImage, 0, 0, this.viewW, this.viewH);
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    // Later phases draw the text layer for the active side here.
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

  /** Point the customizer at a variant's base images, warm the back cache, redraw. */
  setActiveBase(variantId) {
    this.currentVariantId = String(variantId);
    const { front, back } = this.baseImagesFor(variantId);
    this.baseUrls = { front, back };
    if (back) this.loadImage(back).catch(() => {}); // preload for the back tab (Phase 3)
    return this.renderActiveSide();
  }

  /** Load + draw the base image for the currently active side, ignoring stale loads. */
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
