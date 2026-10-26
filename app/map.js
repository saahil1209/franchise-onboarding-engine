// The territory map. Google Maps when the deployment provides a key (see api/maps-config.js);
// otherwise a drawn schematic of the cities. Both show the same markers, built from dashboard.js figures.
// Only our own city markers are placed; nothing from Google is stored (CLAUDE.md rule 8).

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const short = n => n.replace('Hubballi-Dharwad', 'Hubballi');

// ---------- Google loader (one attempt per page) ----------
let googleReady = null;
// Google calls gm_authFailure when it refuses the key, which can happen after the map has been drawn.
const authFailed = new Set();
let authFailure = null;
window.gm_authFailure = () => { authFailure = 'Google rejected the Maps key'; for (const f of authFailed) f(); };
export function loadGoogle() {
  if (googleReady) return googleReady;
  googleReady = (async () => {
    const r = await fetch('api/maps-config', { cache: 'no-store' });
    if (!r.ok) throw new Error('no key');
    const { key, mapId } = await r.json();
    if (!key) throw new Error('no key');
    await new Promise((resolve, reject) => {
      const cb = `__gmaps${Date.now()}`;
      window[cb] = () => { delete window[cb]; resolve(); };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=marker&callback=${cb}`;
      s.async = true; s.onerror = () => reject(new Error('Maps script failed to load'));
      document.head.append(s);
      setTimeout(() => reject(new Error('Maps load timed out')), 12000);
    });
    return { mapId };
  })();
  return googleReady;
}

// The marker: count of applications in an orb, a ring for filled slots, a dashed ring when a slot is open.
function markerHTML(c, k = 1) {
  const size = Math.round((30 + Math.sqrt(c.apps) * 8) * k), r = size / 2 + 3, circ = 2 * Math.PI * r, mid = size / 2 + 6;
  let off = 0;
  const arcs = (c.slots ? [[c.approved, 'var(--blue)'], [c.filled - c.approved, 'var(--amber)']] : []).filter(([n]) => n).map(([n, col]) => {
    const len = circ * (n / c.slots);
    const s = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${col}" stroke-width="3" stroke-dasharray="${Math.max(0, len - 2)} ${circ}" stroke-dashoffset="${-off}" transform="rotate(-90 ${mid} ${mid})" stroke-linecap="round"/>`;
    off += len; return s;
  }).join('');
  return `<span class="orb" style="--sz:${size}px"><svg viewBox="0 0 ${size + 12} ${size + 12}" aria-hidden="true">${arcs}</svg><b>${c.apps}</b></span><span class="label">${esc(short(c.name))} <span>${c.slots ? `${c.filled}/${c.slots}` : '0 slots'}</span></span>`;
}
const markerLabel = c => `${c.name}: ${c.apps} applications, ${c.slots ? `${c.filled} of ${c.slots} slots filled` : 'no open slots'}. Show its territories`;
export const tipHTML = c => `<b>${esc(c.name)}</b><br>${c.apps} applications · ${c.queue} need a person<br>${c.slots ? `${c.filled} of ${c.slots} slots filled` : 'No open slots'} · ${c.stores} store${c.stores === 1 ? '' : 's'}`;
const SIDE = { Tumakuru: 'left', Belagavi: 'above', Bengaluru: 'right' };

// ---------- mount ----------
// el: the .map container. onPick(cityName) is called when a marker is clicked.
export function mountMap(el, { onPick }) {
  let cities = [], selected = null, impl = null;
  const tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'status'); el.append(tip);
  const note = el.parentElement.querySelector('[data-map-note]');

  impl = createSchematic(el, tip, onPick);
  const fallBack = () => {
    if (!impl.google) return;
    impl.destroy();
    impl = createSchematic(el, tip, onPick);
    impl.set(cities, selected);
    if (note) note.textContent = "Google Maps couldn't load; showing the drawn map · positions approximate";
  };
  loadGoogle().then(({ mapId }) => {
    if (authFailure) return;
    try {
      const g = createGoogle(el, tip, onPick, mapId);
      impl.destroy();
      impl = g;
      impl.set(cities, selected);
      authFailed.add(fallBack);
      if (note) note.textContent = 'Google Maps · marker size: applications · city-level positions';
    } catch { /* keep the schematic */ }
  }).catch(() => { /* no key or blocked: the schematic stays */ });

  return {
    set(next, sel) { cities = next; selected = sel; impl.set(cities, selected); },
    relayout() { impl.relayout?.(); },
  };
}

function createGoogle(el, tip, onPick, mapId) {
  const g = window.google.maps;
  const holder = document.createElement('div'); holder.className = 'gmap'; el.prepend(holder);
  const map = new g.Map(holder, { center: { lat: 14.1, lng: 76.1 }, zoom: 7, mapId, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false });
  let markers = [], fitted = false;
  return {
    google: true,
    destroy() { for (const m of markers) m.map = null; holder.remove(); },
    set(cities, selected) {
      for (const m of markers) m.map = null;
      markers = cities.map(c => {
        const content = document.createElement('button');
        content.type = 'button';
        content.className = `city gm ${c.open ? 'open' : ''} ${c.name === selected ? 'sel' : ''}`;
        content.setAttribute('aria-label', markerLabel(c));
        content.setAttribute('aria-pressed', String(c.name === selected));
        content.innerHTML = markerHTML(c, 0.9);
        content.addEventListener('click', () => onPick(c.name));
        content.addEventListener('pointerenter', () => { tip.innerHTML = tipHTML(c); tip.style.left = '12px'; tip.style.top = '12px'; tip.classList.add('on'); });
        content.addEventListener('pointerleave', () => tip.classList.remove('on'));
        return new g.marker.AdvancedMarkerElement({ map, position: { lat: c.lat, lng: c.lon }, content, title: c.name });
      });
      if (!fitted && cities.length) {
        const b = new g.LatLngBounds(); for (const c of cities) b.extend({ lat: c.lat, lng: c.lon });
        map.fitBounds(b, 48); fitted = true;
      }
    },
  };
}

function createSchematic(el, tip, onPick) {
  const cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); el.prepend(cv);
  const ctx = cv.getContext('2d');
  let cities = [], selected = null, W = 0, H = 0, dots = [], alive = true, running = false;
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 }; // relative to el
  const LON = [74.3, 77.8], LAT = [12.1, 16.1];

  function layout() {
    const r = el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return false;
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots = []; const gap = W < 500 ? 16 : 20;
    for (let y = gap / 2; y < H; y += gap) for (let x = gap / 2; x < W; x += gap) dots.push({ x, y });
    const kx = Math.cos(14 * Math.PI / 180), w = (LON[1] - LON[0]) * kx, h = LAT[1] - LAT[0], pad = W < 560 ? { x: 40, t: 40, b: 46 } : { x: 110, t: 50, b: 56 };
    const s = Math.min((W - 2 * pad.x) / w, (H - pad.t - pad.b) / h), ox = (W - w * s) / 2, oy = pad.t + ((H - pad.t - pad.b) - h * s) / 2;
    for (const c of cities) { c.x = ox + (c.lon - LON[0]) * kx * s; c.y = oy + (LAT[1] - c.lat) * s; }
    el.querySelectorAll('.city').forEach(a => { const c = cities.find(x => x.name === a.dataset.city); if (c) { a.style.left = `${c.x}px`; a.style.top = `${c.y}px`; } });
    return true;
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      let city = 0; for (const c of cities) city = Math.max(city, Math.exp(-((d.x - c.x) ** 2 + (d.y - c.y) ** 2) / 4200));
      const k = Math.exp(-((d.x - mouse.x) ** 2 + (d.y - mouse.y) ** 2) / 12000), dx = d.x - mouse.x, dy = d.y - mouse.y, dist = Math.hypot(dx, dy) || 1;
      ctx.fillStyle = k > city ? `rgba(31, 95, 191, ${0.12 + k * 0.5})` : `rgba(80, 98, 122, ${(0.12 + city * 0.22) * 0.8})`;
      ctx.beginPath(); ctx.arc(d.x + (dx / dist) * k * 6, d.y + (dy / dist) * k * 6, 1 + city * 0.8 + k * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    el.querySelectorAll('.city').forEach(a => {
      const c = cities.find(x => x.name === a.dataset.city); if (!c) return;
      const p = Math.exp(-((c.x - mouse.x) ** 2 + (c.y - mouse.y) ** 2) / 20000);
      a.firstElementChild.style.setProperty('--s', String(1 + p * 0.16 + (c.name === selected ? 0.06 : 0)));
      a.firstElementChild.style.setProperty('--lift', `${5 + p * 14}px`);
    });
  }
  function frame() {
    if (!alive) { running = false; return; }
    mouse.x += (mouse.tx - mouse.x) * 0.22; mouse.y += (mouse.ty - mouse.y) * 0.22;
    draw();
    // Stop when the cursor has settled; pointer events start it again.
    if (Math.abs(mouse.tx - mouse.x) + Math.abs(mouse.ty - mouse.y) > 0.5) requestAnimationFrame(frame); else running = false;
  }
  const kick = () => { if (reduced) { mouse.x = mouse.tx; mouse.y = mouse.ty; draw(); return; } if (!running) { running = true; requestAnimationFrame(frame); } };
  const onMove = e => { const r = el.getBoundingClientRect(); mouse.tx = e.clientX - r.left; mouse.ty = e.clientY - r.top; if (mouse.x < -999) { mouse.x = mouse.tx; mouse.y = mouse.ty; } kick(); };
  const onLeave = () => { mouse.tx = mouse.ty = mouse.x = mouse.y = -9999; draw(); tip.classList.remove('on'); };
  const onOver = e => {
    const a = e.target.closest('.city'); if (!a) return;
    const c = cities.find(x => x.name === a.dataset.city);
    tip.innerHTML = tipHTML(c); tip.style.left = `${Math.max(8, Math.min(c.x + 40, W - 230))}px`; tip.style.top = `${Math.max(8, c.y - 44)}px`; tip.classList.add('on');
  };
  const onOut = e => { if (e.target.closest('.city') && !e.relatedTarget?.closest?.('.city')) tip.classList.remove('on'); };
  const onClick = e => { const a = e.target.closest('.city'); if (a) onPick(a.dataset.city); };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerover', onOver); el.addEventListener('pointerout', onOut); el.addEventListener('click', onClick);
  const ro = new ResizeObserver(() => { if (layout()) draw(); }); ro.observe(el);

  return {
    set(next, sel) {
      cities = next.map(c => ({ ...c })); selected = sel;
      el.querySelectorAll('.city').forEach(a => a.remove());
      el.insertAdjacentHTML('beforeend', cities.map(c => `<button type="button" class="city ${c.open ? 'open' : ''} ${SIDE[c.name] || ''}" data-city="${esc(c.name)}" aria-pressed="${c.name === selected}" aria-label="${esc(markerLabel(c))}">${markerHTML(c)}</button>`).join(''));
      if (layout()) draw();
    },
    relayout() { if (layout()) draw(); },
    destroy() {
      alive = false; ro.disconnect(); cv.remove(); el.querySelectorAll('.city').forEach(a => a.remove());
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerover', onOver); el.removeEventListener('pointerout', onOut); el.removeEventListener('click', onClick);
    },
  };
}
