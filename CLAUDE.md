# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Shopify **Dawn** theme (v15.5.0, by Shopify) — a standard Liquid storefront theme, not a Node/JS app. There is no build step, no `package.json`, no bundler, and no test runner. Assets ship to Shopify as-is (raw `.liquid`, `.js`, `.css`). Code lives in the fixed Shopify theme directory layout: `layout/`, `sections/`, `snippets/`, `templates/`, `assets/`, `config/`, `locales/`.

An in-progress custom feature — a front/back **shirt customizer** — is specified in [md/PRD-shirt-customizer.md](md/PRD-shirt-customizer.md). That file is the source of truth for that work; the PRD is gitignored so read it directly from disk.

## Working with the theme (commands)

There is no local build/lint/test. Development is done against a live Shopify store via the Shopify CLI:

```bash
shopify theme dev          # local dev server with hot reload against a dev store
shopify theme check        # lint Liquid (Theme Check) — the closest thing to a linter here
shopify theme push         # upload to a store (use --unpublished for a draft)
shopify theme pull         # sync settings/templates edited in the Shopify admin back to disk
```

`shopify theme check` is the only static analysis available; run it before considering Liquid work done. There is no way to "run a single test" — validation is manual in the browser / theme editor, or via `theme check` for Liquid correctness.

## Architecture

### Rendering model
Liquid renders server-side. `layout/theme.liquid` wraps every page and pulls in the global JS/CSS. Pages are composed from JSON templates in `templates/` (e.g. `product.json`, `index.json`) that reference **sections** (`sections/*.liquid`), which in turn render **snippets** (`snippets/*.liquid`). Section content and order are merchant-editable in the theme editor via each section's `{% schema %}` block — never hardcode what belongs in section settings.

`config/settings_data.json` holds the merchant's current theme settings values; `config/settings_schema.json` defines the settings UI. `locales/*.json` are translations, referenced from Liquid as `t:` keys (e.g. `t:settings_schema.logo.name`) and in Liquid via the `| t` filter.

### JavaScript: Web Components + pub/sub, no framework
There is no framework and no bundler. Behavior is built from native **custom elements**, each a class extending `HTMLElement`, registered with `customElements.define(...)`. Markup in `.liquid` uses the custom tag (e.g. `<variant-selects>`, `<product-form>`, `<cart-drawer>`), and the matching class in `assets/` wires up behavior. To find the JS for a tag, grep for `customElements.define('<tag-name>'`. Foundational elements (`quantity-input`, `menu-drawer`, `modal-dialog`, `slider-component`, `variant-selects`, etc.) live in [assets/global.js](assets/global.js); others are in their own files.

Components communicate through a tiny pub/sub bus, **not** direct references:
- [assets/pubsub.js](assets/pubsub.js) — `subscribe(event, cb)` / `publish(event, data)`.
- [assets/constants.js](assets/constants.js) — `PUB_SUB_EVENTS` (`variant-change`, `cart-update`, `option-value-selection-change`, `quantity-update`, `cart-error`) and `ON_CHANGE_DEBOUNCE_TIMER`.

Load order matters and is fixed in `theme.liquid`: `constants.js` → `pubsub.js` → `global.js`, all `defer`. Runtime endpoints come from globals set in `theme.liquid`: `window.routes` (cart URLs, etc.) and `window.shopUrl`.

### Product → variant → cart flow (important for any product-page work)
This is the spine of the store and the surface the customizer plugs into:
1. `<variant-selects>` ([global.js](assets/global.js)) reads the shopper's option choices and `publish`es `optionValueSelectionChange`.
2. `<product-info>` ([assets/product-info.js](assets/product-info.js)) subscribes, resolves the selected variant, updates price/media/availability, and `publish`es `variantChange`.
3. `<product-form>` ([assets/product-form.js](assets/product-form.js)) handles add-to-cart via `fetch` to `routes.cart_add_url`, then `publish`es `cartUpdate` (or `cartError`).
4. `<cart-drawer>` / `<cart-notification>` / `<cart-items>` subscribe to `cartUpdate` and re-render.

Add-to-cart is AJAX and serializes the product `<form>`. Any `<input>` with `form="product-form-{{ section.id }}"` is submitted **without touching `product-form.js`** — this is how the customizer contributes line item properties.

### Customizer feature conventions (from the PRD)
When implementing the shirt customizer, follow [md/PRD-shirt-customizer.md](md/PRD-shirt-customizer.md) exactly. Non-obvious constraints that will otherwise bite:
- **Do not fork `assets/product-form.js`.** Customizer hidden inputs bind to the product form via the `form="product-form-{{ section.id }}"` attribute so they serialize into Dawn's existing AJAX add-to-cart. This keeps the theme upgrade-safe.
- Color and Size stay **native variant options** (transmitted as the variant `id`), never line item properties. Front/back is **customization data on one line item**, never a variant.
- Config is handed off Liquid→JS as a JSON `<script>` tag read by the customizer JS; the customizer subscribes to `variant-change` to swap the preview base image.
- Hidden line-item properties use a leading underscore (e.g. `_Front Mockup`); empty properties must be stripped before submit so unused sides don't appear on the order.
- Line item properties can't hold base64 image data — mockups upload to storage and only the URL goes in the property.

## Conventions

- Match Dawn's existing style: 2-space indent, vanilla ES (no TS, no JSX), BEM-ish CSS class names, one component per file. New product/cart behavior should extend the custom-element + pub/sub pattern above rather than adding inline scripts or ad-hoc globals.
- CSS is split into `base.css` plus `component-*.css` and `section-*.css` files, loaded per-section (usually via `{{ 'component-x.css' | asset_url | stylesheet_tag }}` inside the section). Add styles to the matching component/section file, not a monolith.
- Keep merchant-facing strings in `locales/` and referenced by key; keep tunable values in section/theme `{% schema %}` settings.
- After editing Liquid, run `shopify theme check`.
