// Map of recommended PINs, the brand's stores and their minimum-distance rings.
// Google Maps when a working key is available (shared loader in map.js); otherwise a drawn map fitted to the points.
import { loadGoogle, onGoogleFailure } from './map.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// points: [{ kind: 'pick'|'store'|'consider', pin, lat, lng, label, title }]; ringKm: radius drawn around stores.
export function mountPinMap(el, { onPick }) {
  let points = [], ringKm = 0, selected = null, impl = drawn(el, onPick);
  const note = el.parentElement.querySelector('[data-map-note]');
  loadGoogle().then(({ mapId }) => {
    try {
      const g = google(el, onPick, mapId);
      impl.destroy(); impl = g; impl.set(points, ringKm, selected);
      if (note) note.textContent = 'Google Maps · PIN centroids from the All India Pincode Directory';
      onGoogleFailure(() => { if (!impl.google) return; impl.destroy(); impl = drawn(el, onPick); impl.set(points, ringKm, selected); if (note) note.textContent = "Google Maps couldn't load; showing the drawn map"; });
    } catch { /* keep the drawn map */ }
  }).catch(() => {});
  return { set(p, r, sel) { points = p; ringKm = r; selected = sel; impl.set(points, ringKm, selected); }, relayout() { impl.relayout?.(); } };
}

function markerEl(p, selected) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `pm pm-${p.kind}${p.pin === selected ? ' sel' : ''}`; b.dataset.pin = p.pin;
  b.title = p.title; b.setAttribute('aria-label', p.title);
  b.innerHTML = p.kind === 'store' ? '<span class="sq"></span>' : `<span>${esc(p.label)}</span>`;
  return b;
}

function google(el, onPick, mapId) {
  const g = window.google.maps;
  const holder = document.createElement('div'); holder.className = 'gmap'; el.prepend(holder);
  const map = new g.Map(holder, { center: { lat: 22, lng: 79 }, zoom: 5, mapId, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false });
  let items = [];
  return {
    google: true,
    destroy() { for (const m of items) m.setMap ? m.setMap(null) : (m.map = null); holder.remove(); },
    set(points, ringKm, selected) {
      for (const m of items) m.setMap ? m.setMap(null) : (m.map = null);
      items = [];
      const b = new g.LatLngBounds();
      for (const p of points) {
        const content = markerEl(p, selected);
        if (p.kind !== 'store') content.addEventListener('click', () => onPick(p.pin));
        items.push(new g.marker.AdvancedMarkerElement({ map, position: { lat: p.lat, lng: p.lng }, content, title: p.title, zIndex: p.kind === 'pick' ? 10 : 1 }));
        if (p.kind === 'store' && ringKm) items.push(new g.Circle({ map, center: { lat: p.lat, lng: p.lng }, radius: ringKm * 1000, strokeColor: '#c23b3b', strokeOpacity: 0.6, strokeWeight: 1, fillColor: '#c23b3b', fillOpacity: 0.06, clickable: false }));
        b.extend({ lat: p.lat, lng: p.lng });
      }
      if (points.length) map.fitBounds(b, 56);
    },
  };
}

function drawn(el, onPick) {
  const cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); el.prepend(cv);
  const ctx = cv.getContext('2d');
  let points = [], ringKm = 0, selected = null, W = 0, H = 0, proj = null;
  const layer = document.createElement('div'); layer.className = 'pmlayer'; el.append(layer);
  function layout() {
    const r = el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return false;
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!points.length) { proj = null; return true; }
    // Fit the points (and the store rings) with a simple equirectangular projection.
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length, kx = Math.cos(lat0 * Math.PI / 180);
    const pad = ringKm / 111;
    const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
    let [a, b, c, d] = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad / kx, Math.max(...lngs) + pad / kx];
    const minSpan = 0.08; if (b - a < minSpan) { a -= minSpan / 2; b += minSpan / 2; } if (d - c < minSpan) { c -= minSpan / 2; d += minSpan / 2; }
    const m = 40, s = Math.min((W - 2 * m) / ((d - c) * kx), (H - 2 * m) / (b - a));
    const ox = (W - (d - c) * kx * s) / 2, oy = (H - (b - a) * s) / 2;
    proj = { x: lng => ox + (lng - c) * kx * s, y: lat => oy + (b - lat) * s, pxPerKm: s / 111 };
    return true;
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const gap = 20;
    ctx.fillStyle = 'rgba(80, 98, 122, 0.16)';
    for (let y = gap / 2; y < H; y += gap) for (let x = gap / 2; x < W; x += gap) { ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill(); }
    layer.innerHTML = '';
    if (!proj) return;
    for (const p of points.filter(p => p.kind === 'store' && ringKm)) {
      ctx.beginPath(); ctx.arc(proj.x(p.lng), proj.y(p.lat), ringKm * proj.pxPerKm, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(194, 59, 59, 0.06)'; ctx.fill(); ctx.strokeStyle = 'rgba(194, 59, 59, 0.5)'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const p of [...points].sort((a, b) => (a.kind === 'pick') - (b.kind === 'pick'))) {
      const b = markerEl(p, selected); b.style.left = `${proj.x(p.lng)}px`; b.style.top = `${proj.y(p.lat)}px`;
      layer.append(b);
    }
  }
  const onClick = e => { const b = e.target.closest('.pm'); if (b && !b.classList.contains('pm-store')) onPick(b.dataset.pin); };
  layer.addEventListener('click', onClick);
  const ro = new ResizeObserver(() => { if (layout()) draw(); }); ro.observe(el);
  return {
    set(p, r, sel) { points = p.filter(x => x.lat !== null); ringKm = r; selected = sel; if (layout()) draw(); },
    relayout() { if (layout()) draw(); },
    destroy() { ro.disconnect(); cv.remove(); layer.remove(); },
  };
}
