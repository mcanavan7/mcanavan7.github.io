/*
 * New Caledonia Commune Locator — Application script
 * --------------------------------------------------
 * Responsibilities
 *  - Initialize Leaflet map and OSM tiles
 *  - Load GeoJSON (communes) from data/nc-communes.geojson
 *  - Render boundaries with hover highlight and center labels
 *  - Search input: "lat,lng" (point-in-polygon) or name substring (accent-insensitive)
 *  - Map click: identify commune at clicked location (pip)
 *  - Accessibility: announce results to #status, guardrails for invalid inputs
 *
 * Data requirements for nc-communes.geojson
 *  - FeatureCollection of (Multi)Polygons
 *  - Each feature: properties.name (string — the commune name)
 *  - WGS84 coordinates ([lon, lat])
 *
 * The app tolerates an empty dataset and will show an informational toast.
 */

// ---- Configuration ----
const MAP_CENTER = [-21.5, 165.5];
const MAP_ZOOM = 8;
const GEOJSON_URL = 'data/nc-communes.geojson';

// ---- Map ----
const map = L.map('map', { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '\u00A9 OpenStreetMap contributors'
}).addTo(map);

let communeLayer = null;
let activeMarker = null;

// Normalization helper (remove diacritics, lowercase)
const normalize = (s) => (s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

// Lightweight toast utility
function showToast(msg, ms = 2800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); }, ms);
}

// Announce to screen readers
function announce(msg) {
  const status = document.getElementById('status');
  if (status) status.textContent = msg;
}

// ---- Load GeoJSON ----
fetch(GEOJSON_URL, { cache: 'no-store' })
  .then(r => r.json())
  .then(fc => {
    if (!fc || !Array.isArray(fc.features)) {
      showToast('Failed to parse communes data.');
      return;
    }
    if (fc.features.length === 0) {
      showToast('No commune polygons found — load the dataset to enable lookups.');
    }

    communeLayer = L.geoJSON(fc, {
      style: () => ({
        color: '#228B22',       // border
        weight: 1.6,
        fillColor: '#66BB66',   // fill
        fillOpacity: 0.35
      }),
      onEachFeature: (feature, layer) => {
        const name = feature?.properties?.name || 'Unknown commune';
        layer.bindTooltip(name, { direction: 'center', className: 'custom-tooltip' });
        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ fillColor: '#FFD54F', color: '#FB8C00', weight: 2.2, fillOpacity: 0.55 });
            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) l.bringToFront();
          },
          mouseout: (e) => {
            communeLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(map);
  })
  .catch(err => {
    console.error('GeoJSON load error:', err);
    showToast('Error loading communes data.');
  });

// ---- Search controls ----
const inputEl = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearBtn  = document.getElementById('clearBtn');

searchBtn.addEventListener('click', onSearch);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });
clearBtn.addEventListener('click', clearSelection);

function onSearch() {
  const raw = inputEl.value.trim();
  if (!raw) return;

  // Try coord first: "lat,lng" with optional whitespace
  const m = raw.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      showToast('Could not parse coordinates.');
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showToast('Latitude must be in [-90,90] and longitude in [-180,180].');
      return;
    }
    identifyAt(lat, lng, true /*dropMarker*/);
    return;
  }

  // Fallback: name search (accent/case-insensitive substring)
  searchByName(raw);
}

function clearSelection() {
  if (activeMarker) {
    map.removeLayer(activeMarker);
    activeMarker = null;
  }
  announce('Selection cleared');
}

// Click-to-identify
map.on('click', (e) => identifyAt(e.latlng.lat, e.latlng.lng, true));

function identifyAt(lat, lng, dropMarker = false) {
  map.setView([lat, lng], Math.max(map.getZoom(), 11));

  let popupText = 'No commune found at this location.';
  if (communeLayer) {
    // leaflet-pip expects [lng, lat]
    try {
      const hits = leafletPip.pointInLayer([lng, lat], communeLayer, true);
      if (hits.length) {
        const feature = hits[0].feature || {};
        const name = feature?.properties?.name || 'Unknown commune';
        popupText = `Commune: ${name}`;
      }
    } catch (err) {
      console.error('leaflet-pip error:', err);
    }
  }

  if (dropMarker) {
    if (activeMarker) map.removeLayer(activeMarker);
    activeMarker = L.marker([lat, lng]).addTo(map).bindPopup(popupText).openPopup();
  } else {
    showToast(popupText);
  }
  announce(popupText);
}

function searchByName(raw) {
  if (!communeLayer) {
    showToast('Data not loaded yet.');
    return;
  }
  const q = normalize(raw);
  let matchLayer = null;

  communeLayer.eachLayer(layer => {
    if (matchLayer) return; // early exit after first match
    const name = layer.feature?.properties?.name || '';
    if (normalize(name).includes(q)) matchLayer = layer;
  });

  if (!matchLayer) {
    showToast('No match found.');
    announce('No match found');
    return;
  }

  const name = matchLayer.feature.properties.name;
  map.fitBounds(matchLayer.getBounds());
  matchLayer.bindPopup(`Commune: ${name}`).openPopup();
  announce(`Found commune: ${name}`);
}