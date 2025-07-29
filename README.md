# New Caledonia Commune Locator

*A lightweight, offline-capable Leaflet web app for instantly identifying the commune (municipality) of any point in New Caledonia.*

[Live demo](https://rcesaret.github.io/nc-commune-locator/) • MIT License

---

## Why it exists

Field biologists, planners, journalists, and anyone curious about New Caledonia often need to know *quickly* which commune a coordinate falls in.  This tool answers that question in under a second—even on a flaky satellite connection—and works entirely in the browser.

It is also used as a pedagogical example in the **Missouri Botanical Garden (MoBot) – Revolutionizing Species Identification (RSI)** project, showcasing how small, focused GIS utilities can accelerate biodiversity research.
*Read more about RSI ➜ [https://discoverandshare.org/2025/01/31/revolutionizing-species-identification/](https://discoverandshare.org/2025/01/31/revolutionizing-species-identification/)*

---

## Key features

| ⚙️                             | Feature                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| 🔍 **Point-in-polygon lookup** | High-precision commune detection via `leaflet-pip`              |
| 🌐 **Offline-first data**      | 33-commune GeoJSON embedded in the bundle; no network required  |
| 🌓 **Light / Dark mode**       | One-click theme toggle (OSM Standard ↔️ CartoDB Dark Matter)    |
| 🐌 **Lazy loading**            | Optional switch loads polygons only when a search is performed  |
| ⇄ **Decimal ↔ DMS inputs**     | Split ° ′ ″ fields with auto-tabbing, plus live validation      |
| 🖱️ **Clickable map**          | Click anywhere to get the commune and lat/lon marker            |
| 🔗 **Permalink share**         | Copy button encodes coords in the URL hash                      |
| ♿ **Accessibility**            | WCAG-compliant contrast, `aria-live` alerts, keyboard shortcuts |

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/rcesaret/new-caledonia-commune-locator.git
cd new-caledonia-commune-locator

# 2. Serve locally (Python 3.x)
python -m http.server 8000
# → open http://localhost:8000 in your browser
```

The app is 100 % static—no build step required.

---

## Using the app

1. **Enter coordinates**
   *Decimal*: `165.4953 -21.3456`
   *DMS*: switch with the °′″ button and fill each box (auto-tabbing helps).

2. **Click Search** → the commune polygon appears and the map zooms.

3. **Explore**

   * Click any commune to get a name + Wikipedia link.
   * Toggle 🌓 for dark mode, 🐌 for lazy loading, or ℹ︎ for a mini-manual.
   * Press **Ctrl + L** (Cmd + L) to jump to longitude, **Enter** to search.

4. **Share**
   Use **🔗 Copy Link** to copy a permalink (`/#lat=…&lon=…`) to the clipboard.

---

## Project structure

```
.
├─ index.html             # main page
├─ assets/
│  ├─ css/                # styles (incl. dark-mode tweaks)
│  └─ js/
│     ├─ app.js           # core logic (≈300 LoC, documented)
│     └─ communes.js      # embedded FeatureCollection (33 communes)
├─ data/                  # optional external GeoJSON (lazy fallback)
│  └─ nc-communes.geojson
└─ tests/                 # mocha tests for coord converters
```

---

## Data & licensing

* **GeoJSON**: Derived from publicly available cadastral layers, simplified ≤ 1 % tolerance.
  © Government of New Caledonia, CC BY 4.0 (compatible with MIT code).

* **Code**: © 2023-2025 Rudolf Cesaretti & Maja Canavan — released under the MIT License (see `LICENSE`).

---

## Contributing

1. Fork → create a feature branch (`feat/short-name`).
2. Code ✓ lint ✓ test (`npm test`).
3. Open a pull request; squash-merge is preferred.

Large PRs? Please open an issue first so we can discuss scope.

---

## Acknowledgements

* **Missouri Botanical Garden – Revolutionizing Species Identification (RSI)** project for real-world field-testing and feedback.
  [https://discoverandshare.org/2025/01/31/revolutionizing-species-identification/](https://discoverandshare.org/2025/01/31/revolutionizing-species-identification/)
* Leaflet, `leaflet-pip`, and OpenStreetMap contributors.
* Early UX reviews by the *New Caledonia Nature Guide* community.

---

## Authors

[Rudolf Cesaretti](https://github.com/rcesaret) & [Maja Canavan](https://github.com/mcanavan7)


---

> *Happy mapping! — Rudy and Maja*
