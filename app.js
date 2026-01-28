/* app.js - visor Leaflet (GeoJSON/TopoJSON) */

// ---------- Helpers ----------
function withCacheBust(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${Date.now()}`;
}

async function fetchJson(url) {
  const u = withCacheBust(url);
  const res = await fetch(u, {
    // Si GitHub Pages cachea agresivo, esto ayuda.
    cache: 'no-store',
    // Mantener CORS normal; si el servidor no permite CORS, la solución real es usar USE_LOCAL_DATA=true.
    mode: 'cors'
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al cargar ${url}`);
  }
  return res.json();
}

function getSourceUrl(key) {
  // Prioridad: local (misma web) -> LAYER_URLS (Releases) -> fallback con DEFAULT_RELEASE_BASE
  if (window.USE_LOCAL_DATA && window.LOCAL_PATHS && window.LOCAL_PATHS[key]) {
    return window.LOCAL_PATHS[key];
  }
  if (window.LAYER_URLS && window.LAYER_URLS[key]) {
    return window.LAYER_URLS[key];
  }
  // fallback: usa DEFAULT_RELEASE_BASE si existe
  if (typeof DEFAULT_RELEASE_BASE !== 'undefined' && DEFAULT_RELEASE_BASE) {
    const map = {
      provincias: 'provincias_simplificado.geojson',
      cantonesNbiTopo: 'cantones_nbi_mayor_50.topo.json',
      violencia: 'total_casos_violencia.geojson',
      otrasNacionalidades: 'total_estudiantes_otras_nacionalidades.geojson',
      ieNoAtendidas: 'ie_fiscales_no_atendidas.geojson',
      servicios: 'servicios_agua_luz.geojson'
    };
    if (map[key]) return DEFAULT_RELEASE_BASE + map[key];
  }
  return null;
}

function setStatus(msg) {
  // En index.html el span de estado es: <span id="status">...</span>
  const box = document.getElementById('status');
  if (!box) return;
  box.textContent = msg || '';
}

// ---------- Map init ----------
const map = L.map('map', {
  preferCanvas: true,
  zoomControl: false
}).setView([-1.5, -78.5], 6);

L.control.zoom({ position: 'topleft' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO'
}).addTo(map);

// Panes para controlar el orden de dibujo (polígonos abajo, puntos arriba)
map.createPane('panePoligonos');
map.getPane('panePoligonos').style.zIndex = 350;
map.createPane('panePuntos');
map.getPane('panePuntos').style.zIndex = 450;

const layers = {
  provincias: null,
  cantonesNbi: null,
  violencia: null,
  otrasNacionalidades: null,
  ieNoAtendidas: null,
  servicios: null
};

// ---------- Styles ----------
function styleProvincias() {
  return { color: '#000', weight: 1.5, fill: false, opacity: 1 };
}

function styleCantones() {
  return { color: '#2ecc71', weight: 1.2, fill: true, fillOpacity: 0.15 };
}

function circleStyle() {
  return { radius: 4, fillOpacity: 0.75, weight: 0.5 };
}


// ---------- Bubble / symbol helpers ----------
function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '.').replace(/\s+/g, '').trim();
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function getProp(p, keys) {
  for (const k of keys) {
    if (p && Object.prototype.hasOwnProperty.call(p, k)) {
      const v = p[k];
      if (v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
  }
  return null;
}

function scaleRadius(value, minR = 3, maxR = 26, factor = 0.35) {
  const n = toNumber(value);
  if (!n || n <= 0) return minR;
  const r = Math.sqrt(n) * factor;
  return Math.max(minR, Math.min(maxR, r));
}

function isYes(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ['si','sí','s','y','yes','true','1'].includes(s);
}

// ---------- Popup (card style) ----------
function popupCardHTML(p) {
  const title =
    getProp(p, ['NOM_INSTIT','NOMBRE','NOMBRE_IE_','NOM_INSTITU','NOMBRE_IE']) ||
    'Registro';
  const amie = getProp(p, ['AMIE','CODAMIE','CODIGO_AMIE']) || '—';

  // Fields to show (only if exist)
  const candidates = [
    ['TIPO DE MATERIAL', ['TIPO_MATERIAL','TIPO_MATERI','TIPO_MAT','TE_fin']],
    ['SOSTENIMIENTO', ['SOSTENIMIENTO','NOM_SOSTEN','NOM_SOSTENIMIENTO']],
    ['NIVEL EDUCATIVO', ['NIVEL_EDUCATIVO','NIVEL_EDU','OFERTA_1','OFERTA_2','OFERTA_3','OFERTA_4']],
    ['REGIMEN', ['REGIMEN']],
    ['PROVINCIA', ['DPA_DESPRO','DPA_DESPROV','PROVINCIA']],
    ['CANTÓN', ['DPA_DESCAN','CANTON','CANTÓN']],
    ['PARROQUIA', ['DPA_DESPAR','PARROQUIA']],
    ['ZONA', ['DA_ZONA','ZONA']],
    ['DISTRITO', ['DA_DIST','NOM_DISTRI','DISTRITO']],
    ['TOTAL ESTUDIANTES', ['Total estu','TOTAL_ESTU','TOTAL_EST','total_estudiantes']],
    ['TOTAL CASOS', ['Total_Caso','Total Caso','TOTAL_CASOS','total_casos']]
  ];

  const rows = [];
  for (const [label, keys] of candidates) {
    const v = getProp(p, keys);
    if (v === null) continue;
    // For OFERTA_*, join non-empty
    if (label === 'NIVEL EDUCATIVO') {
      const ofertas = ['OFERTA_1','OFERTA_2','OFERTA_3','OFERTA_4']
        .map(k => getProp(p,[k]))
        .filter(x => x !== null);
      const joined = ofertas.length ? ofertas.join(', ') : v;
      rows.push([label, joined]);
    } else {
      rows.push([label, v]);
    }
  }

  // Servicios: badges
  const servE = getProp(p, ['Servicio_E','Servicio_e','SERVICIO_E']);
  const servA = getProp(p, ['Servicio_A','Servicio_a','SERVICIO_A']);
  const serviceRows = [];
  if (servE !== null) serviceRows.push(['Servicio_E', servE]);
  if (servA !== null) serviceRows.push(['Servicio_A', servA]);

  const rowsHtml = rows.map(([k,v]) => `
    <div class="pc-row">
      <div class="pc-k">${k}</div>
      <div class="pc-v">${String(v)}</div>
    </div>`).join('');

  const serviceHtml = serviceRows.length ? `
    <div class="pc-sep"></div>
    ${serviceRows.map(([k,v]) => {
      const yes = isYes(v);
      return `
        <div class="pc-row">
          <div class="pc-k">${k}</div>
          <div class="pc-v"><span class="badge ${yes ? 'yes' : 'no'}">${String(v)}</span></div>
        </div>`;
    }).join('')}
  ` : '';

  return `
  <div class="popup-card">
    <div class="pc-head">${title}</div>
    <div class="pc-sub">AMIE: ${amie}</div>
    <div class="pc-body">
      ${rowsHtml || '<div class="pc-empty">Sin atributos</div>'}
      ${serviceHtml}
    </div>
  </div>`;
}
// ---------- Loaders ----------
async function loadProvincias() {
  const url = getSourceUrl('provincias') || 'provincias_simplificado.geojson';
  const gj = await fetchJson(url);
  const lyr = L.geoJSON(gj, { style: styleProvincias(), pane: 'panePoligonos' });
  layers.provincias = lyr;
  return lyr;
}

async function loadCantonesNbiTopo() {
  const url = getSourceUrl('cantonesNbiTopo');
  if (!url) throw new Error('No hay URL para cantonesNbiTopo');

  const topo = await fetchJson(url);
  if (!window.topojson) {
    throw new Error('topojson no está cargado (revisa el <script> en index.html)');
  }

  // Detectar primer objeto TopoJSON
  const objName = Object.keys(topo.objects || {})[0];
  if (!objName) throw new Error('TopoJSON sin objects');

  const geo = topojson.feature(topo, topo.objects[objName]);
  const lyr = L.geoJSON(geo, { style: styleCantones(), pane: 'panePoligonos' });
  layers.cantonesNbi = lyr;
  return lyr;
}


async function loadPointLayer(key, layerKey, options) {
  const url = getSourceUrl(key);
  if (!url) throw new Error(`No hay URL para ${key}`);

  const gj = await fetchJson(url);

  const radiusKeys = (options && options.radiusKeys) ? options.radiusKeys : [];
  const fixedRadius = (options && options.fixedRadius) ? options.fixedRadius : null;

  const getRadius = (p) => {
    if (fixedRadius !== null) return fixedRadius;
    const v = getProp(p, radiusKeys);
    return scaleRadius(v, options.minR || 3, options.maxR || 26, options.factor || 0.35);
  };

  const getColors = (p) => {
    if (options && typeof options.colorFn === 'function') return options.colorFn(p);
    return {
      fill: (options && options.fillColor) ? options.fillColor : '#ff7800',
      stroke: (options && options.strokeColor) ? options.strokeColor : '#000'
    };
  };

  const lyr = L.geoJSON(gj, {
    pane: 'panePuntos',
    pointToLayer: (feat, latlng) => {
      const p = feat.properties || {};
      const c = getColors(p);
      return L.circleMarker(latlng, {
        radius: getRadius(p),
        fillColor: c.fill,
        color: c.stroke,
        weight: options.weight ?? 0.7,
        opacity: 1,
        fillOpacity: options.fillOpacity ?? 0.75
      });
    },
    onEachFeature: (feat, l) => {
      const p = feat.properties || {};
      l.bindPopup(popupCardHTML(p), { maxWidth: 360 });
    }
  });

  layers[layerKey] = lyr;
  return lyr;
}


// ---------- UI wiring ----------
async function toggleLayer(checkboxId, loaderFn, layerKey) {
  const cb = document.getElementById(checkboxId);
  if (!cb) {
    console.warn(`No existe checkbox con id="${checkboxId}" (revisa index.html)`);
    return;
  }

  const onChange = async () => {
    try {
      setStatus('');
      if (cb.checked) {
        if (!layers[layerKey]) {
          setStatus('Cargando capa...');
          const lyr = await loaderFn();
          lyr.addTo(map);
          // Asegura orden (polígonos al fondo)
          if (lyr && typeof lyr.bringToBack === 'function' && (layerKey === 'provincias' || layerKey === 'cantonesNbi')) {
            lyr.bringToBack();
          }
          setStatus('');
        } else {
          layers[layerKey].addTo(map);
        }
      } else {
        if (layers[layerKey]) map.removeLayer(layers[layerKey]);
      }
    } catch (e) {
      console.error(e);
      setStatus(String(e.message || e));
      cb.checked = false;
    }
  };

  cb.addEventListener('change', onChange);

  // Si el checkbox ya viene marcado al cargar la página, dispara la carga automáticamente.
  if (cb.checked) {
    onChange();
  }
}

// Init
(function init() {
  // status box (top left panel)
  setStatus('');

  // IMPORTANT: checkbox IDs must match those defined in index.html
  toggleLayer('tgProv', loadProvincias, 'provincias');
  toggleLayer('tgNbi', loadCantonesNbiTopo, 'cantonesNbi');

  toggleLayer(
    'tgViol',
    () => loadPointLayer('violencia', 'violencia', {
      // Burbuja por TOTAL ESTUDIANTES (campo: "Total estu")
      radiusKeys: ['Total estu', 'TOTAL_ESTU', 'TOTAL_EST', 'total_estudiantes'],
      fillColor: '#ff9800',
      strokeColor: '#000',
      factor: 0.40,
      minR: 3,
      maxR: 28
    }),
    'violencia'
  );

  toggleLayer(
    'tgOtras',
    () => loadPointLayer('otrasNacionalidades', 'otrasNacionalidades', {
      radiusKeys: ['Total estu', 'TOTAL_ESTU', 'TOTAL_EST', 'total_estudiantes'],
      fillColor: '#1f78b4',
      strokeColor: '#000',
      factor: 0.40,
      minR: 3,
      maxR: 28
    }),
    'otrasNacionalidades'
  );

  toggleLayer(
    'tgIENo',
    () => loadPointLayer('ieNoAtendidas', 'ieNoAtendidas', {
      fixedRadius: 5,
      fillColor: '#000000',
      strokeColor: '#ffffff',
      weight: 0.8,
      fillOpacity: 0.85
    }),
    'ieNoAtendidas'
  );

  toggleLayer(
    'tgServ',
    () => loadPointLayer('servicios', 'servicios', {
      fixedRadius: 6,
      // Verde si Servicio_E = SI y Servicio_A = SI; caso contrario rojo
      colorFn: (p) => {
        const e = isYes(getProp(p, ['Servicio_E','Servicio_e','SERVICIO_E']));
        const a = isYes(getProp(p, ['Servicio_A','Servicio_a','SERVICIO_A']));
        const ok = e && a;
        return { fill: ok ? '#00c853' : '#d50000', stroke: '#000' };
      },
      weight: 0.7,
      fillOpacity: 0.85
    }),
    'servicios'
  );
})();
