# PRD — Front/Back Shirt Customizer (Shopify Dawn)

## 1. Objective
Add a Printify-style customizer to a single Dawn product page. Customer selects color and size (native variants), then personalizes front and back independently with custom or preset text (font, color, size, position) and sees a live preview. On add-to-cart the design is captured as line item properties plus a generated mockup image per used side.

## 2. Scope
In scope: color/size variants with swatches, front+back per-side text, custom-or-preset text, live canvas preview, drag-to-place, per-side mockup export, cart/order capture.
Out of scope (phase 2+): customer image upload, multi-line text, curved text, clipart library, print-on-demand fulfillment API.

## 3. Non-goals
- Front/back is NOT a variant. It is customization data on one line item.
- Color and Size are NOT line item properties. They stay native variant options.

## 4. Platform constraints (verified)
- Max 3 options per product. Color + Size use two. One slot free.
- Up to 2,048 variants per product (raised Oct 2025). This product uses 48.
- 250 media per product limit.
- Native color swatches require Dawn v13+ and category metafields.
- Line item properties cannot store base64 image data. Mockups upload to storage; only the URL goes in a property.

## 5. Shopify Admin setup

### 5.1 Product
- Title: `Unisex Garment-Dyed Sweatshirt`
- Handle: `comfort-colors-unisex-garment-dyed-sweatshirt`
- Vendor: `Comfort Colors`
- Category (Shopify taxonomy): set to the Sweatshirts category so the standard Color metafield unlocks. Verify in admin after import.
- Status: Active

### 5.2 Options and variants
- Option 1 name: `Color` — values: Ivory, Sand, Blue Jean, Moss, Brick, Navy, Black, Berry
- Option 2 name: `Size` — values: S, M, L, XL, 2XL, 3XL
- 8 × 6 = 48 variants. Import via CSV (section 6), then configure swatches and images.

### 5.3 Native color swatches
1. Assign the product category (5.1) so the Color category metafield appears.
2. Edit the Color option, link it to the Color category metafield.
3. For each color value, create a color entry (a `shopify--color-pattern` metaobject entry) with a label and a hex value or swatch image. Reference hex values:

| Color | Hex |
|---|---|
| Ivory | #EFE9DA |
| Sand | #D8C7A6 |
| Blue Jean | #6E86A3 |
| Moss | #6B7050 |
| Brick | #7C3B32 |
| Navy | #2A3550 |
| Black | #22242A |
| Berry | #6E2A44 |

Dawn v13+ renders these as swatches on the product page automatically. No theme edit required for the swatch itself.

### 5.4 Variant images
Upload one product image per color and assign it as that color's variant image so Dawn swaps the featured image on color selection. These images are also the front preview base in the canvas. Keep them on a transparent or flat background, print area centered.

### 5.5 Metaobject definition (customizer config)
Create metaobject definition `Customizer Config` (type handle `customizer-config`), fields:

| Field key | Type | Purpose |
|---|---|---|
| `print_area_front` | JSON | Normalized front print rect `{ "x":0.30,"y":0.32,"w":0.40,"h":0.34 }` |
| `print_area_back` | JSON | Normalized back print rect |
| `fonts` | list.single_line_text | Allowed fonts, e.g. `Anton, Oswald, Roboto Slab, Pacifico, Space Mono` |
| `preset_texts` | list.single_line_text | Preset strings, e.g. `EST. 2026, TEAM CAPTAIN, STAY WEIRD` |
| `max_chars` | number_integer | Max characters per side (e.g. 24) |
| `enable_back` | boolean | Allow back customization |

Create one entry and fill values.

### 5.6 Product + variant metafields

Product metafield:
| Key | Type | Value |
|---|---|---|
| `custom.customizer` | Metaobject reference → customizer-config | link to the entry from 5.5 |

Variant metafields (per color; back has no native image slot):
| Key | Type | Purpose |
|---|---|---|
| `custom.mockup_front` | File (image) | Front preview base. Optional — falls back to variant featured image. |
| `custom.mockup_back` | File (image) | Back preview base. Required if `enable_back` is true. |

MVP fallback if you skip the metaobject: use product metafields `custom.print_areas` (JSON with both rects), `custom.fonts` (list text), `custom.preset_texts` (list text), `custom.max_chars` (int), `custom.enable_back` (bool). The theme reads whichever exists.

## 6. CSV import
Import `comfort-colors-sweatshirt.csv` (Products → Import). It creates the product, both options, and all 48 variants with price, inventory, SKU. Images and swatches are configured in admin after import (5.3, 5.4) because they require hosted assets and category linkage. After import, complete steps 5.1 (category), 5.3, 5.4, 5.5, 5.6.

## 7. Line item properties spec

Submitted on add-to-cart (only for sides that have text):

Visible:
- `Front Text`, `Front Font`, `Front Color`, `Front Placement`
- `Back Text`, `Back Font`, `Back Color`, `Back Placement`

Hidden (leading underscore, stays on order, hidden from customer surfaces):
- `_Front Mockup` — uploaded PNG URL
- `_Back Mockup` — uploaded PNG URL
- `_Design ID` — optional correlation id

Color and Size are transmitted as the native variant `id`, not as properties.

## 8. Theme architecture (Dawn)

### 8.1 Files
- `assets/product-customizer.css` — styles
- `assets/product-customizer.js` — state, canvas render, drag, export, hidden-input mirroring
- `sections/product-customizer.liquid` — markup, canvas, controls, hidden inputs, section schema; reads config from metaobject/metafields via Liquid and passes to JS as a JSON script tag
- `sections/main-product.liquid` — add the customizer as a block, placed inside/adjacent to the product form; ensure hidden inputs carry `form="product-form-{{ section.id }}"`
- Do NOT fork `assets/product-form.js`. The form attribute makes inputs serialize into Dawn's AJAX add-to-cart without JS changes.

### 8.2 Config handoff (Liquid → JS)
Render a JSON blob the JS reads:
```liquid
{%- assign cfg = product.metafields.custom.customizer.value -%}
<script type="application/json" id="customizer-config">
{
  "printAreaFront": {{ cfg.print_area_front.value | default: '{"x":0.30,"y":0.32,"w":0.40,"h":0.34}' }},
  "printAreaBack":  {{ cfg.print_area_back.value  | default: '{"x":0.28,"y":0.28,"w":0.44,"h":0.40}' }},
  "fonts": {{ cfg.fonts.value | json }},
  "presets": {{ cfg.preset_texts.value | json }},
  "maxChars": {{ cfg.max_chars.value | default: 24 }},
  "enableBack": {{ cfg.enable_back.value | default: true }}
}
</script>
```

### 8.3 Hidden inputs (bound to product form)
```liquid
{%- assign pf = 'product-form-' | append: section.id -%}
<input type="hidden" name="properties[Front Text]"  id="p-front-text"  form="{{ pf }}">
<input type="hidden" name="properties[Front Font]"  id="p-front-font"  form="{{ pf }}">
<input type="hidden" name="properties[Front Color]" id="p-front-color" form="{{ pf }}">
<input type="hidden" name="properties[Front Placement]" id="p-front-place" form="{{ pf }}">
<input type="hidden" name="properties[Back Text]"   id="p-back-text"   form="{{ pf }}">
<input type="hidden" name="properties[Back Font]"   id="p-back-font"   form="{{ pf }}">
<input type="hidden" name="properties[Back Color]"  id="p-back-color"  form="{{ pf }}">
<input type="hidden" name="properties[Back Placement]" id="p-back-place" form="{{ pf }}">
<input type="hidden" name="properties[_Front Mockup]" id="p-front-mockup" form="{{ pf }}">
<input type="hidden" name="properties[_Back Mockup]"  id="p-back-mockup"  form="{{ pf }}">
```
Empty properties are stripped before submit so unused sides do not appear on the order.

### 8.4 Per-side state (JS)
```js
const state = {
  side: 'front',
  front: { mode:'custom', text:'', preset:'', font:'Anton', color:'#22242A', size:54, x:0.5, y:0.46 },
  back:  { mode:'custom', text:'', preset:'', font:'Anton', color:'#22242A', size:54, x:0.5, y:0.44 }
};
```

### 8.5 Canvas render
Draw the base mockup image (variant front image, or `custom.mockup_back` for back) then the text layer. Redraw on any change. Clamp text drag to the active side's print area. Load fonts before first draw; redraw on `document.fonts.ready`.

### 8.6 Variant change hook
Subscribe to Dawn's variant change event and swap the base mockup image for the newly selected color, then redraw both sides' cached state.

### 8.7 Mockup export + upload
On submit intercept:
1. For each side with text: `canvas.toDataURL('image/png')`.
2. Upload to storage, receive a URL.
3. Write URL into `_Front Mockup` / `_Back Mockup` hidden inputs.
4. Mirror all visible text fields into hidden inputs.
5. Allow the form submit to proceed.

Storage options:
- Recommended: app proxy to your backend, or a custom app using Admin API `stagedUploadsCreate` + `fileCreate` to store in Shopify Files.
- Alternative: external bucket (S3/Cloudinary) with signed upload.
- MVP: skip upload, submit text properties only; ops recreates artwork from text/font/color/placement.

## 9. Acceptance criteria
- Selecting a color changes both the swatch state and the preview base image.
- Front and back hold independent designs; switching tabs preserves each.
- Custom and preset modes both drive the preview and submit correctly.
- Font, color, size, and drag position all reflect live in the canvas.
- Add-to-cart shows the correct properties in cart, checkout, order admin, and order email.
- Unused side contributes no properties.
- Mockup URL (when storage enabled) appears as a hidden property on the order.
- Works on mobile (pointer drag), keyboard focus visible, reduced motion respected.

## 10. Edge cases
- Empty text: no property, no mockup.
- Overflow text: auto-scale to print-area width.
- Unicode/emoji: render and transmit intact.
- Font load race: redraw on `fonts.ready`.
- Variant lacking a back image while `enable_back` true: hide back tab.
- Checkout stripping properties: verify theme AJAX serializes hidden inputs (form attribute).
- Duplicate add-to-cart: regenerate mockup per submit.
- Theme update: no `product-form.js` fork, so updates stay clean.

## 11. Phases
0. Admin: import CSV, set category, swatches, variant images, metaobject, metafields.
1. Section scaffold + schema + config handoff.
2. Variant swatch/size + image swap hook.
3. Canvas preview: base + text, front/back tabs, per-side state.
4. Custom/preset text, font, color, size, drag.
5. Hidden inputs + property binding + cart display.
6. Mockup export + upload + hidden URL properties.
7. QA: mobile, a11y, reduced motion, edge cases.
Stop for review after each phase.