/*
 * New Caledonia Commune Locator — Enhanced application script
 * -----------------------------------------------------------------
 * Responsibilities
 *   - Initialize Leaflet map and load commune GeoJSON
 *   - Render commune boundaries with hover highlight and center labels
 *   - Provide four coordinate input modes (single decimal, dual decimal,
 *     DMS boxes, single DMS string) with a flip button for dual inputs
 *   - Convert DMS inputs to decimal degrees and validate ranges
 *   - Drop a marker at any entered coordinate and perform point‑in‑polygon lookup
 *   - Maintain support for commune name search in single decimal mode
 */

// ---- Configuration ----
const MAP_CENTER = [-21.5, 165.5];
const MAP_ZOOM = 8;
const GEOJSON_URL = "data/nc-communes.geojson";
const OFFLINE_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wIAAgUBBu/q6QAAAABJRU5ErkJggg==";

// Attempt to create a tile layer from OpenStreetMap. Fallback to a blank tile
// if network access is blocked.
async function createTileLayer() {
  try {
    const resp = await fetch("https://tile.openstreetmap.org/0/0/0.png", {
      mode: "no-cors",
      signal: AbortSignal.timeout(5000), // 5-second timeout
    });
    // For 'no-cors', a successful network request results in an 'opaque' response.
    if (resp.type === "opaque") {
      return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "\u00A9 OpenStreetMap contributors",
      });
    }
    console.warn(`Unexpected response from tile server: type ${resp.type}`);
  } catch (err) {
    console.warn("Tile server unreachable, using offline tile:", err.message);
  }
  return L.tileLayer(OFFLINE_TILE, { maxZoom: 19, attribution: "" });
}

// ---- Map ----
const map = L.map("map", { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
let currentBase = null;
let darkLayer = null;
let darkMode = false;
const baseLayers = {
  osm: createTileLayer(),
  gmap: Promise.resolve(
    L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      maxZoom: 20,
    }),
  ),
  gsat: Promise.resolve(
    L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      maxZoom: 20,
    }),
  ),
  gter: Promise.resolve(
    L.tileLayer("https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}", {
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      maxZoom: 20,
    }),
  ),
  dark: Promise.resolve(
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap &copy;Carto",
      },
    ),
  ),
};

baseLayers.osm.then((layer) => {
  currentBase = layer;
  layer.addTo(map);
});

let communeLayer = null;
let activeMarker = null;

// Points management: store structured point objects
// Each point: { id, marker, lat, lng, shape, visible, properties: { label, color, opacity, commune } }
let points = [];
let pointIdCounter = 1;

// Selection state
let selectionMode = false;
let selectedPointId = null;
let selectedPolygon = null;

// Mapping of commune names to Wikipedia URLs
const communeWikiLinks = {};

// Custom red marker icon for coordinate entries
const coordinateMarkerIcon = L.icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Normalization helper (remove diacritics, lowercase)
const normalize = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Lightweight toast utility
function showToast(msg, ms = 2800) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, ms);
}

// Announce to screen readers
function announce(msg) {
  const status = document.getElementById("status");
  if (status) status.textContent = msg;
}
// ---- Load GeoJSON ----
function loadCommuneData() {
  return fetch(GEOJSON_URL)
    .then((r) => r.json())
    .catch((err) => {
      console.error("GeoJSON fetch failed:", err);
      return typeof COMMUNES_DATA !== "undefined" ? COMMUNES_DATA : null;
    });
}

loadCommuneData()
  .then((fc) => {
    if (!fc || !Array.isArray(fc.features)) {
      showToast("Failed to parse communes data.");
      return;
    }
    if (fc.features.length === 0) {
      showToast(
        "No commune polygons found — load the dataset to enable lookups.",
      );
    }

    communeLayer = L.geoJSON(fc, {
      style: () => ({
        color: "#228B22", // border
        weight: 1.6,
        fillColor: "#66BB66", // fill
        fillOpacity: 0.35,
      }),
      onEachFeature: (feature, layer) => {
        const name = feature?.properties?.name || "Unknown commune";
        layer.bindTooltip(name, {
          direction: "center",
          className: "custom-tooltip",
          permanent: toggleLabels.checked,
        });
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({
              fillColor: "#FFD54F",
              color: "#FB8C00",
              weight: 2.2,
              fillOpacity: 0.55,
            });
            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge)
              l.bringToFront();
          },
          mouseout: (e) => {
            communeLayer.resetStyle(e.target);
          },
        });
        // Click behaviour: handle selection mode and normal identify
        layer.on('click', (e) => {
          // Prevent map click from also firing
          e.originalEvent.stopPropagation();
          if (selectionMode) {
            selectCommuneLayer(layer);
          } else {
            // Normal mode: identify at clicked location
            const ll = e.latlng;
            identifyAt(ll.lat, ll.lng, true);
          }
        });
      },
    }).addTo(map);
    updateCommuneStyle();
    updateLabelStyle();
    updateLabelPersistence();

    // Build mapping from commune name to Wikipedia URL
    try {
      fc.features.forEach((feat) => {
        const nm = feat?.properties?.name;
        if (!nm) return;
        // Normalize string: remove diacritics and replace spaces with underscores
        const ascii = nm
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, '_');
        const encoded = encodeURIComponent(ascii);
        communeWikiLinks[nm] = `https://en.wikipedia.org/wiki/${encoded},_New_Caledonia`;
      });
    } catch (err) {
      console.warn('Failed to build wiki links:', err);
    }
  })
  .catch((err) => {
    console.error("GeoJSON load error:", err);
    showToast("Error loading communes data.");
  });

// ---- DOM references ----
// Mode buttons
const modeSingleDecBtn = document.getElementById("modeSingleDecBtn");
const modeDualDecBtn = document.getElementById("modeDualDecBtn");
const modeDMSBoxesBtn = document.getElementById("modeDMSBoxesBtn");
const modeSingleDmsBtn = document.getElementById("modeSingleDmsBtn");

// Input containers
const singleDecInputs = document.getElementById("singleDecInputs");
const dualDecInputs = document.getElementById("dualDecInputs");
const dmsBoxesInputs = document.getElementById("dmsBoxesInputs");
const singleDmsInputContainer = document.getElementById(
  "singleDmsInputContainer",
);

// Input fields
const singleDecInput = document.getElementById("singleDecInput");
const latDecInput = document.getElementById("latDecInput");
const lonDecInput = document.getElementById("lonDecInput");
const flipDecBtn = document.getElementById("flipDecBtn");
const latDMSDeg = document.getElementById("latDMSDeg");
const latDMSMin = document.getElementById("latDMSMin");
const latDMSSec = document.getElementById("latDMSSec");
const lonDMSDeg = document.getElementById("lonDMSDeg");
const lonDMSMin = document.getElementById("lonDMSMin");
const lonDMSSec = document.getElementById("lonDMSSec");
const singleDmsInput = document.getElementById("singleDmsInput");

const locateBtn = document.getElementById("locateBtn");
const clearBtn = document.getElementById("clearBtn");

// Layer panel elements
const layerPanel = document.getElementById("layerPanel");
const toggleLayerPanelBtn = document.getElementById("toggleLayerPanel");
const toggleLabels = document.getElementById("toggleLabels");
const togglePolygons = document.getElementById("togglePolygons");
const borderColorInput = document.getElementById("borderColor");
const borderOpacityInput = document.getElementById("borderOpacity");
const fillColorInput = document.getElementById("fillColor");
const fillOpacityInput = document.getElementById("fillOpacity");
// Basemap radio group instead of select
const basemapOptions = document.getElementById("basemapOptions");
const darkModeToggle = document.getElementById("darkModeToggle");
const addPointBtn = document.getElementById("addPointBtn");
const exportPointsBtn = document.getElementById("exportPointsBtn");
const labelTextColor = document.getElementById("labelTextColor");
const labelTextSize = document.getElementById("labelTextSize");
const labelFont = document.getElementById("labelFont");
const labelBg = document.getElementById("labelBg");
const labelBgColor = document.getElementById("labelBgColor");
const labelBgOpacity = document.getElementById("labelBgOpacity");
const addPointCoordBtn = document.getElementById("addPointCoordBtn");
const permalinkBtn = document.getElementById("permalinkBtn");
const toggleInfo = document.getElementById("toggleInfo");
const infoContent = document.getElementById("infoContent");

// Points and selection controls
const togglePoints = document.getElementById("togglePoints");
const pointsList = document.getElementById("pointsList");
const selectModeBtn = document.getElementById("selectModeBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const flipSingleBtn = document.getElementById("flipSingleBtn");

// Setup expand/collapse for layer sections
document.querySelectorAll('.toggle-item-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    const targetId = btn.getAttribute('aria-controls');
    const content = document.getElementById(targetId);
    if (content) {
      content.hidden = expanded;
    }
  });
});

// Mode identifiers
const MODE_SINGLE_DEC = "singleDec";
const MODE_DUAL_DEC = "dualDec";
const MODE_DMS_BOXES = "dmsBoxes";
const MODE_SINGLE_DMS = "singleDms";

let currentMode = MODE_SINGLE_DEC;

// Set the active mode visually and logically
function setMode(mode) {
  currentMode = mode;
  // update aria-pressed and aria-checked on buttons for accessibility
  const btns = [
    modeSingleDecBtn,
    modeDualDecBtn,
    modeDMSBoxesBtn,
    modeSingleDmsBtn,
  ];
  const activeBtn = getButtonForMode(mode);
  btns.forEach((btn) => {
    const active = btn === activeBtn;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });
  // show/hide input groups depending on the selected mode
  singleDecInputs.hidden = mode !== MODE_SINGLE_DEC;
  dualDecInputs.hidden = mode !== MODE_DUAL_DEC;
  dmsBoxesInputs.hidden = mode !== MODE_DMS_BOXES;
  singleDmsInputContainer.hidden = mode !== MODE_SINGLE_DMS;
}

function getButtonForMode(mode) {
  switch (mode) {
    case MODE_SINGLE_DEC:
      return modeSingleDecBtn;
    case MODE_DUAL_DEC:
      return modeDualDecBtn;
    case MODE_DMS_BOXES:
      return modeDMSBoxesBtn;
    case MODE_SINGLE_DMS:
      return modeSingleDmsBtn;
    default:
      return modeSingleDecBtn;
  }
}

// Set initial mode
setMode(currentMode);

// Mode button event handlers
modeSingleDecBtn.addEventListener("click", () => setMode(MODE_SINGLE_DEC));
modeDualDecBtn.addEventListener("click", () => setMode(MODE_DUAL_DEC));
modeDMSBoxesBtn.addEventListener("click", () => setMode(MODE_DMS_BOXES));
modeSingleDmsBtn.addEventListener("click", () => setMode(MODE_SINGLE_DMS));

function autoTab(curr, next, maxLen, prev = null) {
  if (!curr) return;
  // Forward tabbing
  curr.addEventListener("input", (e) => {
    // Only auto-advance if:
    // - input is at maxLen
    // - cursor is at the end
    // - no text is selected
    if (
      curr.value &&
      curr.value.length >= maxLen &&
      curr.selectionStart === curr.value.length &&
      curr.selectionEnd === curr.value.length
    ) {
      if (next) next.focus();
    }
  });

  // Backward tabbing on backspace at start
  curr.addEventListener("keydown", (e) => {
    if (
      e.key === "Backspace" &&
      curr.selectionStart === 0 &&
      curr.selectionEnd === 0 &&
      prev
    ) {
      prev.focus();
      // Optionally, move cursor to end of previous input
      if (typeof prev.value === "string") {
        prev.setSelectionRange(prev.value.length, prev.value.length);
      }
      e.preventDefault();
    }
  });
}
autoTab(latDMSDeg, latDMSMin, 2);
autoTab(latDMSMin, latDMSSec, 2);
autoTab(latDMSSec, lonDMSDeg, 2);
autoTab(lonDMSDeg, lonDMSMin, 3);
autoTab(lonDMSMin, lonDMSSec, 2);

// Flip button handler: swap latitude and longitude values in dual decimal mode
flipDecBtn.addEventListener("click", () => {
  const latVal = latDecInput.value.trim();
  const lonVal = lonDecInput.value.trim();
  if (latVal && lonVal) {
    latDecInput.value = lonVal;
    lonDecInput.value = latVal;
  } else if (latVal && !lonVal) {
    lonDecInput.value = latVal;
    latDecInput.value = "";
  } else if (!latVal && lonVal) {
    latDecInput.value = lonVal;
    lonDecInput.value = "";
  }
  // Show visual feedback
  showToast("Coordinates flipped");
});

// Locate on Enter key for any visible input
[
  singleDecInput,
  latDecInput,
  lonDecInput,
  latDMSDeg,
  latDMSMin,
  latDMSSec,
  lonDMSDeg,
  lonDMSMin,
  lonDMSSec,
  singleDmsInput,
].forEach((input) => {
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleLocate();
      }
    });
  }
});

// Locate button handler
locateBtn.addEventListener("click", handleLocate);

// Clear button handler: clear marker and all inputs
clearBtn.addEventListener('click', () => {
  clearInputs();
  clearActiveMarker();
  clearSelection();
});

// Layer panel interactions
function setLayerPanelCollapsed(collapsed) {
  layerPanel.classList.toggle("collapsed", collapsed);
  if (collapsed) {
    layerPanel.setAttribute("aria-hidden", "true");
  } else {
    layerPanel.removeAttribute("aria-hidden");
  }
  const focusables = layerPanel.querySelectorAll(
    "a, button, input, select, textarea, [tabindex]"
  );
  focusables.forEach((el) => {
    if (collapsed) {
          el.dataset.prevTab = el.getAttribute("tabindex");
          el.setAttribute("tabindex", "-1");
        }
    else if (el.dataset.prevTab) {
            el.setAttribute("tabindex", el.dataset.prevTab);
            delete el.dataset.prevTab;
          }
    else {
            el.removeAttribute("tabindex");
          }

  });
}

toggleLayerPanelBtn.addEventListener("click", () => {
  const collapsed = layerPanel.classList.contains("collapsed");
  setLayerPanelCollapsed(!collapsed);
});

if (togglePolygons) {
  togglePolygons.addEventListener("change", () => {
    if (!communeLayer) return;
    if (togglePolygons.checked) communeLayer.addTo(map);
    else map.removeLayer(communeLayer);
  });
}

function updateCommuneStyle() {
  if (!communeLayer) return;
  communeLayer.setStyle({
    color: borderColorInput.value,
    opacity: parseFloat(borderOpacityInput.value),
    weight: 1.6,
    fillColor: fillColorInput.value,
    fillOpacity: parseFloat(fillOpacityInput.value),
  });
}
[
  borderColorInput,
  borderOpacityInput,
  fillColorInput,
  fillOpacityInput,
].forEach((el) => {
  el && el.addEventListener("input", updateCommuneStyle);
});

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

function updateLabelStyle() {
  const root = document.documentElement;
  root.style.setProperty("--label-text-color", labelTextColor.value);
  root.style.setProperty("--label-font-size", `${labelTextSize.value}px`);
  root.style.setProperty("--label-font-family", labelFont.value);
  const rgb = hexToRgb(labelBgColor.value) || "255,255,255";
  const opacity = labelBg.checked ? parseFloat(labelBgOpacity.value) : 0;
  root.style.setProperty("--label-bg-color", `rgba(${rgb},${opacity})`);
}

[
  labelTextColor,
  labelTextSize,
  labelFont,
  labelBgColor,
  labelBgOpacity,
  labelBg,
].forEach((el) => {
  el && el.addEventListener("input", updateLabelStyle);
  el && el.addEventListener("change", updateLabelStyle);
});

function updateLabelPersistence() {
  if (!communeLayer) return;
  communeLayer.eachLayer((l) => {
    const name = l.feature?.properties?.name || "";
    l.unbindTooltip();
    l.bindTooltip(name, {
      direction: "center",
      className: "custom-tooltip",
      permanent: toggleLabels.checked,
    });
  });
}

toggleLabels.addEventListener("change", updateLabelPersistence);

// Handle basemap radio changes
basemapOptions?.addEventListener("change", async () => {
  if (darkMode) return; // do nothing if dark mode active
  const selected = basemapOptions.querySelector('input[name="basemap"]:checked');
  if (!selected) return;
  const val = selected.value;
  if (currentBase) map.removeLayer(currentBase);
  const layer = await baseLayers[val];
  currentBase = layer;
  layer.addTo(map);
});

darkModeToggle?.addEventListener("change", async () => {
  darkMode = darkModeToggle.checked;
  document.body.classList.toggle("dark-mode", darkMode);
  // Disable basemap radios when dark mode is active
  const radios = basemapOptions?.querySelectorAll('input[name="basemap"]');
  radios?.forEach((input) => {
    input.disabled = darkMode;
  });
  if (darkMode) {
    basemapOptions.setAttribute('title', 'Basemap selection is disabled in dark mode');
  } else {
    basemapOptions.removeAttribute('title');
  }
  // Toggle dark mode class on Leaflet controls
  document.querySelectorAll('.leaflet-control').forEach((ctrl) => {
    ctrl.classList.toggle('leaflet-control-dark', darkMode);
  });
  // Switch base layer
  if (currentBase) map.removeLayer(currentBase);
  if (darkMode) {
    darkLayer = await baseLayers.dark;
    currentBase = darkLayer;
  } else {
    // restore previously selected base
    const selected = basemapOptions?.querySelector('input[name="basemap"]:checked');
    const val = selected ? selected.value : 'osm';
    const layer = await baseLayers[val];
    currentBase = layer;
  }
  currentBase.addTo(map);
});

addPointBtn.addEventListener("click", () => {
  addingPoint = !addingPoint;
  addPointBtn.classList.toggle("active", addingPoint);
  if (addingPoint) showToast("Click on the map to add a point");
});

exportPointsBtn.addEventListener('click', () => {
  // Build a GeoJSON FeatureCollection from our structured points
  const features = points.map((pt) => {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
      properties: {
        label: pt.properties.label,
        color: pt.properties.color,
        opacity: pt.properties.opacity,
        commune: pt.properties.commune,
        shape: pt.shape,
      },
    };
  });
  const fc = { type: 'FeatureCollection', features };
  const blob = new Blob([JSON.stringify(fc, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'points.geojson';
  a.click();
  URL.revokeObjectURL(url);
});

addPointCoordBtn.addEventListener("click", () => {
  handleLocate();
  if (activeMarker) {
    const ll = activeMarker.getLatLng();
    createPointAt(ll.lat, ll.lng);
  } else {
    showToast("Enter coordinates first");
  }
});

permalinkBtn.addEventListener("click", () => {
  // Use active marker location if available, otherwise map center
  const center = activeMarker ? activeMarker.getLatLng() : map.getCenter();
  const zoom = map.getZoom();
  // Determine base layer name
  let baseLayerName = '';
  if (darkMode) {
    baseLayerName = 'dark';
  } else {
    const selected = basemapOptions?.querySelector('input[name="basemap"]:checked');
    baseLayerName = selected ? selected.value : '';
  }
  // Build params
  const params = [
    `lat=${center.lat.toFixed(5)}`,
    `lon=${center.lng.toFixed(5)}`,
    `zoom=${zoom}`,
  ];
  if (baseLayerName) {
    params.push(`base=${encodeURIComponent(baseLayerName)}`);
  }
  // Include overlay toggles
  const overlayParams = [];
  if (togglePolygons && !togglePolygons.checked) overlayParams.push('polygons=false');
  if (toggleLabels && !toggleLabels.checked) overlayParams.push('labels=false');
  if (overlayParams.length) {
    params.push(overlayParams.join('&'));
  }
  const url = `${location.origin}${location.pathname}#${params.join('&')}`;
  navigator.clipboard.writeText(url).then(
    () => {
      showToast('Permalink copied');
    },
    () => {
      showToast('Copy failed');
    },
  );
});

// Toggle all points visibility
togglePoints?.addEventListener('change', () => {
  const visible = togglePoints.checked;
  toggleAllPoints(visible);
});

// Flip button for single decimal input: swap lat and lon separated by comma
flipSingleBtn?.addEventListener('click', () => {
  const raw = singleDecInput.value.trim();
  if (!raw) return;
  const parts = raw.split(',');
  if (parts.length === 2) {
    const a = parts[0].trim();
    const b = parts[1].trim();
    singleDecInput.value = `${b},${a}`;
    showToast('Coordinates flipped');
  }
});

// Selection mode toggle button
selectModeBtn?.addEventListener('click', () => {
  selectionMode = !selectionMode;
  if (!selectionMode) {
    clearSelection();
  }
  updateSelectionModeUI();
});

// Clear selection button
clearSelectionBtn?.addEventListener('click', () => {
  clearSelection();
});

toggleInfo?.addEventListener("click", () => {
  if (!infoContent) return;
  if (infoContent.hasAttribute("hidden")) infoContent.removeAttribute("hidden");
  else infoContent.setAttribute("hidden", "");
});

function clearInputs() {
  // Clear all known input fields
  singleDecInput.value = "";
  latDecInput.value = "";
  lonDecInput.value = "";
  latDMSDeg.value = "";
  latDMSMin.value = "";
  latDMSSec.value = "";
  lonDMSDeg.value = "";
  lonDMSMin.value = "";
  lonDMSSec.value = "";
  singleDmsInput.value = "";
}


// -----------------------------------------------------------------------------
// Input validation helpers

/**
 * Parse a string into a floating‑point number. Returns null if parsing fails.
 */
function parseNumber(str) {
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate latitude and longitude values. Returns error message or null.
 */
function validateLatLon(lat, lon) {
  if (lat === null || lon === null) return "Could not parse coordinates.";
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return "Latitude must be in [-90,90] and longitude in [-180,180].";
  }
  return null;
}

// Primary locate handler: dispatch based on current mode
const locateHandlers = {};

function handleLocate() {
  const handler = locateHandlers[currentMode] || locateFromSingleDec;
  handler();
}

// Single decimal input: lat,lng comma separated OR name search
function locateFromSingleDec() {
  const raw = singleDecInput.value.trim();
  if (!raw) return;
  // Try coord first: two comma separated numbers (lat/lng or lng/lat)
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const a = parseNumber(m[1]);
    const b = parseNumber(m[2]);
    if (a == null || b == null) {
      showToast('Invalid numbers');
      return;
    }
    let latVal = a;
    let lonVal = b;
    // If first number is outside lat range but second is inside, interpret as lon,lat
    if ((a < -90 || a > 90) && b >= -90 && b <= 90) {
      latVal = b;
      lonVal = a;
    }
    const err = validateLatLon(latVal, lonVal);
    if (err) {
      showToast(err);
      return;
    }
    identifyAt(latVal, lonVal, true);
    return;
  }
  // Fallback: name search (accent/case-insensitive substring)
  searchByName(raw);
}

// Dual decimal input: separate lat and lon fields
function locateFromDualDec() {
  const latStr = latDecInput.value.trim();
  const lonStr = lonDecInput.value.trim();
  if (!latStr || !lonStr) {
    showToast("Please enter both latitude and longitude.");
    return;
  }
  const lat = parseNumber(latStr);
  const lon = parseNumber(lonStr);
  const err = validateLatLon(lat, lon);
  if (err) {
    showToast(err);
    return;
  }
  identifyAt(lat, lon, true);
}

// DMS boxes input: convert degrees/minutes/seconds to decimal
function locateFromDmsBoxes() {
  const latDegStr = latDMSDeg.value.trim();
  const latMinStr = latDMSMin.value.trim();
  const latSecStr = latDMSSec.value.trim();
  const lonDegStr = lonDMSDeg.value.trim();
  const lonMinStr = lonDMSMin.value.trim();
  const lonSecStr = lonDMSSec.value.trim();
  // Require at least degrees for both lat and lon
  if (!latDegStr || !lonDegStr) {
    showToast("Degrees are required for both latitude and longitude.");
    return;
  }
  const latDeg = parseFloat(latDegStr);
  const latMin = latMinStr ? parseFloat(latMinStr) : 0;
  const latSec = latSecStr ? parseFloat(latSecStr) : 0;
  const lonDeg = parseFloat(lonDegStr);
  const lonMin = lonMinStr ? parseFloat(lonMinStr) : 0;
  const lonSec = lonSecStr ? parseFloat(lonSecStr) : 0;
  if (
    [latDeg, latMin, latSec, lonDeg, lonMin, lonSec].some(
      (n) => !Number.isFinite(n),
    )
  ) {
    showToast("Invalid DMS values.");
    return;
  }
  // Validate minutes/seconds ranges
  if (
    latMin < 0 ||
    latMin >= 60 ||
    latSec < 0 ||
    latSec >= 60 ||
    lonMin < 0 ||
    lonMin >= 60 ||
    lonSec < 0 ||
    lonSec >= 60
  ) {
    showToast("Minutes and seconds must be in [0,60).");
    return;
  }
  // Convert to absolute degrees and sign
  const latSign = latDeg < 0 ? -1 : 1;
  const lonSign = lonDeg < 0 ? -1 : 1;
  const latDec = latSign * (Math.abs(latDeg) + latMin / 60 + latSec / 3600);
  const lonDec = lonSign * (Math.abs(lonDeg) + lonMin / 60 + lonSec / 3600);
  const err = validateLatLon(latDec, lonDec);
  if (err) {
    showToast(err);
    return;
  }
  identifyAt(latDec, lonDec, true);
}

// Single DMS string input: parse google maps style "20°44'19.7"S 164°47'41.6"E"
function locateFromSingleDms() {
  const raw = singleDmsInput.value.trim();
  if (!raw) return;
  // Regex to capture two DMS coordinate groups
  const pattern =
    /([\-]?\d+(?:\.\d+)?)\s*°\s*([\d\.]+)?\s*(?:'|′)?\s*([\d\.]+)?\s*(?:"|″)?\s*([NSEW])/gi;
  const matches = [];
  let m;
  while ((m = pattern.exec(raw)) !== null) {
    matches.push(m);
  }
  if (matches.length < 2) {
    showToast(
      "Could not parse DMS string. Expect format like 20°44'19.7\"S 164°47'41.6\"E",
    );
    return;
  }
  // Extract lat and lon from first two matches
  const latMatch = matches[0];
  const lonMatch = matches[1];
  const latDecVal = dmsMatchToDecimal(latMatch);
  const lonDecVal = dmsMatchToDecimal(lonMatch);
  if (latDecVal == null || lonDecVal == null) {
    showToast("Invalid DMS values in input.");
    return;
  }
  const err = validateLatLon(latDecVal, lonDecVal);
  if (err) {
    showToast(err);
    return;
  }
  identifyAt(latDecVal, lonDecVal, true);
}

// Convert regex match groups to decimal degrees
function dmsMatchToDecimal(match) {
  // match indices: 1=deg,2=min,3=sec,4=dir
  const deg = parseFloat(match[1]);
  const min = match[2] ? parseFloat(match[2]) : 0;
  const sec = match[3] ? parseFloat(match[3]) : 0;
  const dir = match[4].toUpperCase();
  if (![deg, min, sec].every((n) => Number.isFinite(n))) return null;
  if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;
  let dec = Math.abs(deg) + min / 60 + sec / 3600;
  // Determine sign: use sign of degrees if negative, otherwise direction
  if (deg < 0) {
    dec = -dec;
  } else {
    if (dir === "S" || dir === "W") dec = -dec;
  }
  return dec;
}

function showPointModal(lat, lng, onSubmit) {
  let modal = document.getElementById("point-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "point-modal";
    modal.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
      "background:rgba(0,0,0,0.3);display:flex;align-items:center;" +
      "justify-content:center;z-index:10000;";
    modal.innerHTML =
      `<form id="point-modal-form" style="background:#fff;padding:20px;border-radius:8px;min-width:300px;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
          <h3>Create Point</h3>
          <label>Label (optional):<br><input type="text" name="label" style="width:100%"></label><br><br>
          <label>Marker color:<br><input type="color" name="color" value="#ff0000"></label><br><br>
          <label>Opacity (0-1):<br><input type="number" name="opacity" min="0" max="1" step="0.01" value="0.8"></label><br><br>
          <button type="submit">Create</button>
          <button type="button" id="point-modal-cancel">Cancel</button>
       </form>`;
    document.body.appendChild(modal);
  }
  modal.style.display = "flex";

  const form = modal.querySelector("#point-modal-form");
  const cancelBtn = modal.querySelector("#point-modal-cancel");
  form.onsubmit = function (e) {
    e.preventDefault();
    const label = form.label.value || "";
    const color = form.color.value || "#ff0000";
    let opacity = parseFloat(form.opacity.value);
    if (isNaN(opacity) || opacity < 0 || opacity > 1) {
      alert("Invalid opacity value. Using default 0.8.");
      opacity = 0.8;
    }
    modal.style.display = "none";
    onSubmit({ label, color, opacity });
  };
  cancelBtn.onclick = function () {
    modal.style.display = "none";
  };
}

function createPointAt(lat, lng) {
  showPointModal(lat, lng, function ({ label, color, opacity }) {
    // Determine commune for this location
    let communeName = null;
    if (communeLayer) {
      try {
        const hits = leafletPip.pointInLayer([lng, lat], communeLayer, true);
        if (hits.length) communeName = hits[0].feature?.properties?.name || null;
      } catch (err) {
        console.error('Point-in-polygon check failed:', err);
      }
    }
    const id = pointIdCounter++;
    const shape = 'circle';
    const pointProps = { label, color, opacity, commune: communeName };
    // Create marker based on shape
    let marker;
    if (shape === 'square') {
      const size = 12;
      const html = `<span style="display:inline-block;width:${size}px;height:${size}px;background:${color};opacity:${opacity};border:1px solid ${color};"></span>`;
      const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
      marker = L.marker([lat, lng], { icon });
    } else {
      marker = L.circleMarker([lat, lng], {
        color,
        fillColor: color,
        fillOpacity: opacity,
        radius: 6,
      });
    }
    marker.pointId = id;
    marker.bindPopup(generatePointPopup({ id, lat, lng, shape, properties: pointProps }));
    // Attach selection click
    marker.on('click', (e) => {
      if (selectionMode) {
        selectPoint(id);
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      }
    });
    // Add marker to map depending on global visibility toggle
    const visible = togglePoints ? togglePoints.checked : true;
    if (visible) marker.addTo(pointsLayer);
    // Store structured point
    points.push({
      id,
      marker,
      lat,
      lng,
      shape,
      visible,
      properties: pointProps,
    });
    // Render list
    renderPointsList();
  });
}

// Layer for all point markers
let addingPoint = false;
const pointsLayer = L.layerGroup().addTo(map);

// Map click handler: add point, select polygon or identify
map.on('click', (e) => {
  // Add point mode takes precedence
  if (addingPoint) {
    addingPoint = false;
    addPointBtn.classList.remove('active');
    createPointAt(e.latlng.lat, e.latlng.lng);
    return;
  }
  // Selection mode: select commune polygon under click
  if (selectionMode) {
    // Determine which polygon contains this point
    if (communeLayer) {
      try {
        const hits = leafletPip.pointInLayer([e.latlng.lng, e.latlng.lat], communeLayer, true);
        if (hits.length) {
          const layer = hits[0];
          selectCommuneLayer(layer);
        } else {
          clearSelection();
        }
      } catch (err) {
        console.error('leaflet-pip error:', err);
      }
    }
    return;
  }
  // Default behaviour: identify commune and drop marker
  identifyAt(e.latlng.lat, e.latlng.lng, true);
});

// ENHANCED: Identify commune at given lat/lng with improved marker visibility
function identifyAt(lat, lng, dropMarker = false) {
  map.setView([lat, lng], Math.max(map.getZoom(), 11));

  let popupText = "No commune found at this location.";
  if (communeLayer) {
    // leaflet-pip expects [lng, lat]
    try {
      const hits = leafletPip.pointInLayer([lng, lat], communeLayer, true);
      if (hits.length) {
        const feature = hits[0].feature || {};
        const name = feature?.properties?.name || "Unknown commune";
        popupText = `Commune: ${name}`;
      }
    } catch (err) {
      console.error("leaflet-pip error:", err);
    }
  }

  if (dropMarker) {
    // Remove existing marker
    if (activeMarker) map.removeLayer(activeMarker);

    // Create distinctive red marker for entered coordinates
    activeMarker = L.marker([lat, lng], {
      icon: coordinateMarkerIcon,
    }).addTo(map);

    // Enhanced popup with coordinates and commune info
    const coordText = `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const fullPopupText = `${coordText}<br>${popupText}`;
    activeMarker
      .bindPopup(fullPopupText, { className: "coordinate-popup" })
      .openPopup();

    // Ensure marker is visible by bringing it to front
    activeMarker.setZIndexOffset(1000);
  } else {
    showToast(popupText);
  }
  announce(popupText);
}

// Generate HTML content for a point popup: label, coordinates and commune
function generatePointPopup(point) {
  const parts = [];
  const label = point.properties.label || '';
  if (label) parts.push(`<strong>${label}</strong>`);
  parts.push(`Lat: ${point.lat.toFixed(5)}, Lon: ${point.lng.toFixed(5)}`);
  const commune = point.properties.commune || 'Unknown';
  parts.push(`Commune: ${commune}`);
  return parts.join('<br>');
}

/**
 * Render the list of points in the layer panel. Each point entry
 * includes a visibility checkbox, label/coords, edit and delete buttons
 * and an editable form for properties.
 */
function renderPointsList() {
  if (!pointsList) return;
  pointsList.innerHTML = '';
  points.forEach((pt) => {
    const item = document.createElement('div');
    item.className = 'point-item';
    if (pt.id === selectedPointId) item.classList.add('selected');
    item.dataset.id = pt.id;
    // Header
    const header = document.createElement('div');
    header.className = 'point-header';
    // visibility checkbox
    const visCheckbox = document.createElement('input');
    visCheckbox.type = 'checkbox';
    visCheckbox.checked = pt.visible !== false;
    visCheckbox.addEventListener('change', () => {
      togglePointVisibility(pt.id, visCheckbox.checked);
    });
    header.appendChild(visCheckbox);
    // label/coords text
    const span = document.createElement('span');
    const lbl = pt.properties.label ? pt.properties.label : '';
    span.textContent = lbl ? `${lbl} (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})` : `${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}`;
    span.title = 'Click to select';
    span.style.cursor = 'pointer';
    span.addEventListener('click', () => {
      selectPoint(pt.id);
    });
    header.appendChild(span);
    // edit button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit point';
    header.appendChild(editBtn);
    // delete button
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '×';
    delBtn.title = 'Delete point';
    header.appendChild(delBtn);
    item.appendChild(header);
    // Edit form
    const editDiv = document.createElement('div');
    editDiv.className = 'point-edit';
    editDiv.hidden = true;
    // Label field
    const labelRow = document.createElement('label');
    labelRow.textContent = 'Label:';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = pt.properties.label || '';
    labelRow.appendChild(labelInput);
    editDiv.appendChild(labelRow);
    // Colour
    const colorRow = document.createElement('label');
    colorRow.textContent = 'Color:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = pt.properties.color || '#ff0000';
    colorRow.appendChild(colorInput);
    editDiv.appendChild(colorRow);
    // Opacity
    const opRow = document.createElement('label');
    opRow.textContent = 'Opacity:';
    const opInput = document.createElement('input');
    opInput.type = 'range';
    opInput.min = 0;
    opInput.max = 1;
    opInput.step = 0.05;
    opInput.value = pt.properties.opacity != null ? pt.properties.opacity : 0.8;
    opRow.appendChild(opInput);
    editDiv.appendChild(opRow);
    // Shape selector
    const shapeRow = document.createElement('label');
    shapeRow.textContent = 'Shape:';
    const shapeSelect = document.createElement('select');
    ['circle', 'square'].forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      if (pt.shape === opt) o.selected = true;
      shapeSelect.appendChild(o);
    });
    shapeRow.appendChild(shapeSelect);
    editDiv.appendChild(shapeRow);
    // Latitude
    const latRow = document.createElement('label');
    latRow.textContent = 'Latitude:';
    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.step = 'any';
    latInput.value = pt.lat;
    latRow.appendChild(latInput);
    editDiv.appendChild(latRow);
    // Longitude
    const lonRow = document.createElement('label');
    lonRow.textContent = 'Longitude:';
    const lonInput = document.createElement('input');
    lonInput.type = 'number';
    lonInput.step = 'any';
    lonInput.value = pt.lng;
    lonRow.appendChild(lonInput);
    editDiv.appendChild(lonRow);
    // Commune (read-only)
    const comRow = document.createElement('label');
    comRow.textContent = 'Commune:';
    const comDisplay = document.createElement('input');
    comDisplay.type = 'text';
    comDisplay.value = pt.properties.commune || '';
    comDisplay.readOnly = true;
    comRow.appendChild(comDisplay);
    editDiv.appendChild(comRow);
    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const updates = {
        label: labelInput.value.trim(),
        color: colorInput.value,
        opacity: parseFloat(opInput.value),
        shape: shapeSelect.value,
        lat: parseFloat(latInput.value),
        lng: parseFloat(lonInput.value),
      };
      updatePoint(pt.id, updates);
      editDiv.hidden = true;
    });
    editDiv.appendChild(saveBtn);
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      editDiv.hidden = true;
    });
    editDiv.appendChild(cancelBtn);
    item.appendChild(editDiv);
    // Attach header button actions
    editBtn.addEventListener('click', () => {
      editDiv.hidden = !editDiv.hidden;
    });
    delBtn.addEventListener('click', () => {
      deletePoint(pt.id);
    });
    pointsList.appendChild(item);
  });
}

// Toggle visibility of all points at once
function toggleAllPoints(visible) {
  points.forEach((pt) => {
    togglePointVisibility(pt.id, visible);
  });
  renderPointsList();
}

// Toggle visibility of a single point
function togglePointVisibility(id, visible) {
  const pt = points.find((p) => p.id === id);
  if (!pt) return;
  pt.visible = visible;
  if (visible) {
    pt.marker.addTo(pointsLayer);
  } else {
    map.removeLayer(pt.marker);
  }
}

// Update a point's properties and marker
function updatePoint(id, updates) {
  const idx = points.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const pt = points[idx];
  // Update coordinates
  const newLat = typeof updates.lat === 'number' && Number.isFinite(updates.lat) ? updates.lat : pt.lat;
  const newLng = typeof updates.lng === 'number' && Number.isFinite(updates.lng) ? updates.lng : pt.lng;
  // Recompute commune if lat/lng changed
  let newCommune = pt.properties.commune;
  if (newLat !== pt.lat || newLng !== pt.lng) {
    try {
      if (communeLayer) {
        const hits = leafletPip.pointInLayer([newLng, newLat], communeLayer, true);
        if (hits.length) newCommune = hits[0].feature?.properties?.name || null;
      }
    } catch (err) {
      console.error('Point-in-polygon check failed:', err);
    }
  }
  // Update properties
  const newProps = {
    label: updates.label != null ? updates.label : pt.properties.label,
    color: updates.color != null ? updates.color : pt.properties.color,
    opacity: updates.opacity != null ? updates.opacity : pt.properties.opacity,
    commune: newCommune,
  };
  // Update shape
  const newShape = updates.shape || pt.shape || 'circle';
  // Remove old marker from map
  const oldMarker = pt.marker;
  const wasVisible = pt.visible !== false;
  if (oldMarker) {
    map.removeLayer(oldMarker);
  }
  // Create new marker based on shape
  let newMarker;
  if (newShape === 'square') {
    // Use a divIcon with square styling
    const size = 12;
    const html = `<span style="display:inline-block;width:${size}px;height:${size}px;background:${newProps.color};opacity:${newProps.opacity};border:1px solid ${newProps.color};"></span>`;
    const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
    newMarker = L.marker([newLat, newLng], { icon });
  } else {
    newMarker = L.circleMarker([newLat, newLng], {
      color: newProps.color,
      fillColor: newProps.color,
      fillOpacity: newProps.opacity,
      radius: 6,
    });
  }
  newMarker.pointId = id;
  newMarker.bindPopup(generatePointPopup({ ...pt, lat: newLat, lng: newLng, properties: newProps }));
  // Attach click handler for selection
  newMarker.on('click', (e) => {
    if (selectionMode) {
      selectPoint(id);
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
    }
  });
  // Add to map if visible
  if (wasVisible) newMarker.addTo(pointsLayer);
  // Update stored point object
  points[idx] = {
    id,
    marker: newMarker,
    lat: newLat,
    lng: newLng,
    shape: newShape,
    visible: wasVisible,
    properties: newProps,
  };
  // If this point is selected, update popup and highlight
  if (selectedPointId === id) {
    newMarker.openPopup();
  }
  // Refresh list
  renderPointsList();
}

// Delete a point completely
function deletePoint(id) {
  const idx = points.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const pt = points[idx];
  // Remove marker
  if (pt.marker) {
    map.removeLayer(pt.marker);
  }
  points.splice(idx, 1);
  // Clear selection if this point was selected
  if (selectedPointId === id) {
    selectedPointId = null;
  }
  renderPointsList();
}

// Select a point by id: highlight marker, open popup and scroll to list item
function selectPoint(id) {
  const pt = points.find((p) => p.id === id);
  if (!pt) return;
  // Clear previous selection
  clearSelection();
  selectionMode = true;
  selectedPointId = id;
  // Highlight marker (enlarge radius or style)
  if (pt.shape === 'circle' && pt.marker.setStyle) {
    pt.marker.setStyle({ radius: 9, weight: 2 });
  } else if (pt.shape === 'square' && pt.marker.setIcon) {
    // enlarge square icon
    const size = 16;
    const html = `<span style="display:inline-block;width:${size}px;height:${size}px;background:${pt.properties.color};opacity:${pt.properties.opacity};border:1px solid ${pt.properties.color};"></span>`;
    const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
    pt.marker.setIcon(icon);
  }
  pt.marker.addTo(pointsLayer);
  pt.marker.openPopup();
  // Scroll into view and expand form
  renderPointsList();
  const listItem = pointsList?.querySelector(`.point-item[data-id="${id}"]`);
  if (listItem) {
    listItem.scrollIntoView({ block: 'nearest' });
    const editDiv = listItem.querySelector('.point-edit');
    if (editDiv) editDiv.hidden = false;
  }
  // Update selection mode UI
  updateSelectionModeUI();
}

// Handle commune selection: highlight polygon and show popup with Wikipedia link
function selectCommuneLayer(layer) {
  if (!layer) return;
  // Clear previous selection
  clearSelection();
  selectionMode = true;
  selectedPolygon = layer;
  // Highlight polygon by increasing weight and changing color
  layer.setStyle({ weight: 3, color: '#ff9800', fillOpacity: 0.5 });
  // Bring to front
  if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) layer.bringToFront();
  // Show popup with link
  const name = layer.feature?.properties?.name || 'Unknown';
  const wiki = communeWikiLinks[name] || '';
  const linkHtml = wiki ? `<a href="${wiki}" target="_blank">Wikipedia</a>` : '';
  layer.bindPopup(`Commune: ${name}${linkHtml ? '<br>' + linkHtml : ''}`).openPopup();
  updateSelectionModeUI();
}

// Toggle selection mode visually
function updateSelectionModeUI() {
  if (selectionMode) {
    document.body.classList.add('selection-mode');
    selectModeBtn.classList.add('active');
  } else {
    document.body.classList.remove('selection-mode');
    selectModeBtn.classList.remove('active');
  }
}

// Clear selection: remove highlights and close popups
function clearSelection() {
  // Deselect polygon
  if (selectedPolygon) {
    // Reset style using communeLayer.resetStyle
    if (communeLayer && communeLayer.resetStyle) {
      communeLayer.resetStyle(selectedPolygon);
    }
    selectedPolygon.closePopup();
    selectedPolygon = null;
  }
  // Deselect point
  if (selectedPointId != null) {
    const pt = points.find((p) => p.id === selectedPointId);
    if (pt) {
      // Reset marker size and style
      if (pt.shape === 'circle' && pt.marker.setStyle) {
        pt.marker.setStyle({ radius: 6, weight: 1 });
      } else if (pt.shape === 'square' && pt.marker.setIcon) {
        const size = 12;
        const html = `<span style="display:inline-block;width:${size}px;height:${size}px;background:${pt.properties.color};opacity:${pt.properties.opacity};border:1px solid ${pt.properties.color};"></span>`;
        const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
        pt.marker.setIcon(icon);
      }
      pt.marker.closePopup();
    }
    selectedPointId = null;
  }
  // Remove selection mode UI
  selectionMode = false;
  updateSelectionModeUI();
  announce('Selection cleared');
  renderPointsList();
}

// Remove the active locate marker
function clearActiveMarker() {
  if (activeMarker) {
    map.removeLayer(activeMarker);
    activeMarker = null;
  }
}

// Name search: accent/case-insensitive substring search over communeLayer
function searchByName(raw) {
  if (!communeLayer) {
    showToast("Data not loaded yet.");
    return;
  }
  const q = normalize(raw);
  let matchLayer = null;
  communeLayer.eachLayer((layer) => {
    if (matchLayer) return; // early exit after first match
    const name = layer.feature?.properties?.name || "";
    if (normalize(name).includes(q)) matchLayer = layer;
  });
  if (!matchLayer) {
    showToast("No match found.");
    announce("No match found");
    return;
  }
  const { name } = matchLayer.feature.properties;
  map.fitBounds(matchLayer.getBounds());
  matchLayer.bindPopup(`Commune: ${name}`).openPopup();
  announce(`Found commune: ${name}`);
}

// Register locate handlers
locateHandlers[MODE_SINGLE_DEC] = locateFromSingleDec;
locateHandlers[MODE_DUAL_DEC] = locateFromDualDec;
locateHandlers[MODE_DMS_BOXES] = locateFromDmsBoxes;
locateHandlers[MODE_SINGLE_DMS] = locateFromSingleDms;
