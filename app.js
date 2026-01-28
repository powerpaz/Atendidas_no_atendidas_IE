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
      cantonesNbiGeo: 'cantones_nbi_mayor_50.geojson',
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

map.createPane('paneServices');
map.getPane('paneServices').style.zIndex = 430;

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

function scaleRadius(value, minR = 3, maxR = 40, factor = 1.6) {
  const n = toNumber(value);
  // NULL/0/negativo => burbuja mínima
  if (!n || n <= 0) return minR;

  // Requisito: hasta 100 (inclusive) se mantiene el mismo tamaño
  if (n <= 100) return minR;

  // Solo >100 escala por sqrt (tipo QGIS)
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

async function loadCantonesNbi() {
  // Prioridad: GeoJSON (EPSG:4326). Fallback: TopoJSON (si existe).
  const urlGeo = getSourceUrl('cantonesNbiGeo');
  if (urlGeo) {
    try {
      const gj = await fetchJson(urlGeo);
      const lyr = L.geoJSON(gj, { style: styleCantones(), pane: 'panePoligonos' });
      layers.cantonesNbi = lyr;
      return lyr;
    } catch (e) {
      console.warn('[NBI] No se pudo cargar GeoJSON, intento fallback TopoJSON:', e);
    }
  }

  const urlTopo = getSourceUrl('cantonesNbiTopo');
  if (!urlTopo) throw new Error('No hay URL para cantonesNbi (geojson/topojson)');

  const topo = await fetchJson(urlTopo);
  if (!window.topojson) {
    throw new Error('TopoJSON no está disponible y GeoJSON falló. Revisa el archivo data/cantones_nbi_mayor_50.geojson');
  }

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
    return scaleRadius(v, (options.minR ?? 3), (options.maxR ?? 40), (options.factor ?? 1.6));
  };

  const getColors = (p) => {
    if (options && typeof options.colorFn === 'function') return options.colorFn(p);
    return {
      fill: (options && options.fillColor) ? options.fillColor : '#ff7800',
      stroke: (options && options.strokeColor) ? options.strokeColor : '#000'
    };
  };

  // Permite control total del símbolo (radio + colores) para capas clasificadas (ej. violencia)
  const getSymbol = (p) => {
    if (options && typeof options.symbolFn === 'function') {
      const s = options.symbolFn(p) || {};
      return {
        radius: (typeof s.radius === 'number') ? s.radius : getRadius(p),
        fill: s.fill ?? getColors(p).fill,
        stroke: s.stroke ?? getColors(p).stroke,
        weight: (s.weight ?? options.weight),
        fillOpacity: (s.fillOpacity ?? options.fillOpacity)
      };
    }
    const c = getColors(p);
    return { radius: getRadius(p), fill: c.fill, stroke: c.stroke };
  };

  const lyr = L.geoJSON(gj, {
    pane: (options && options.pane) ? options.pane : 'panePuntos',
    pointToLayer: (feat, latlng) => {
      const p = feat.properties || {};
      const s = getSymbol(p);
      return L.circleMarker(latlng, {
        radius: s.radius,
        fillColor: s.fill,
        color: s.stroke,
        weight: (s.weight ?? options.weight) ?? 0.7,
        opacity: 1,
        fillOpacity: (s.fillOpacity ?? options.fillOpacity) ?? 0.75
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
function setLegendVisible(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
}


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

      // Leyenda (solo para Otras Nacionalidades)
      if (checkboxId === 'tgOtras') {
        setLegendVisible('legendOtras', cb.checked);
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

// ---------- Servicios básicos (Sí/No por variable) ----------
let serviciosData = null;
const serviciosLayers = { e_si: null, e_no: null, a_si: null, a_no: null };

async function loadServiciosData() {
  if (serviciosData) return serviciosData;
  const url = getSourceUrl('servicios');
  if (!url) throw new Error('No hay URL para servicios');
  serviciosData = await fetchJson(url);
  return serviciosData;
}

function makeSvgDivIcon(svg, size = 22) {
  return L.divIcon({
    className: 'svc-icon',
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

const ICON_NO_AGUA = makeSvgDivIcon(`
<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="28" fill="white" stroke="#d50000" stroke-width="6"/>
  <line x1="14" y1="50" x2="50" y2="14" stroke="#d50000" stroke-width="6"/>
  <path d="M32 12 C26 22,18 30,18 40 a14 14 0 0 0 28 0 c0-10-8-18-14-28z"
        fill="#111"/>
</svg>
`, 22);

const ICON_NO_LUZ = makeSvgDivIcon(`
<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="28" fill="white" stroke="#d50000" stroke-width="6"/>
  <line x1="14" y1="50" x2="50" y2="14" stroke="#d50000" stroke-width="6"/>
  <path d="M32 10c-9 0-16 7-16 16 0 6 3 11 7 14v6h18v-6c4-3 7-8 7-14 0-9-7-16-16-16z"
        fill="#111"/>
  <rect x="23" y="48" width="18" height="6" fill="#111"/>
</svg>
`, 22);

function circleMarker(latlng, fill, stroke = '#000', radius = 6) {
  return L.circleMarker(latlng, {
    radius,
    color: stroke,
    weight: 0.7,
    fillColor: fill,
    fillOpacity: 0.85
  });
}

function buildServiciosLayer(filterFn, pointToLayerFn) {
  return L.geoJSON(serviciosData, {
    pane: 'paneServices',
    filter: (feat) => {
      const p = feat.properties || {};
      return filterFn(p);
    },
    pointToLayer: pointToLayerFn,
    onEachFeature: (feat, layer) => {
      layer.on('click', () => showPopupCard(feat, layer.getLatLng()));
    }
  });
}

async function ensureServiciosLayersBuilt() {
  await loadServiciosData();
  if (serviciosLayers.e_si) return;

  const isSi = (v) => isYes(v) === true;
  const isNo = (v) => {
    if (v === null || v === undefined) return false;
    const s = String(v).trim().toLowerCase();
    return s === 'no' || s === 'n';
  };

  serviciosLayers.e_si = buildServiciosLayer(
    (p) => isSi(getProp(p, ['Servicio_E', 'Servicio_e', 'SERVICIO_E'])),
    (feat, latlng) => circleMarker(latlng, '#00c853', '#000', 6)
  );

  serviciosLayers.a_si = buildServiciosLayer(
    (p) => isSi(getProp(p, ['Servicio_A', 'Servicio_a', 'SERVICIO_A'])),
    (feat, latlng) => circleMarker(latlng, '#0288d1', '#000', 6)
  );

  serviciosLayers.e_no = buildServiciosLayer(
    (p) => isNo(getProp(p, ['Servicio_E', 'Servicio_e', 'SERVICIO_E'])),
    (feat, latlng) => L.marker(latlng, { icon: ICON_NO_LUZ, pane: 'paneServices' })
  );

  serviciosLayers.a_no = buildServiciosLayer(
    (p) => isNo(getProp(p, ['Servicio_A', 'Servicio_a', 'SERVICIO_A'])),
    (feat, latlng) => L.marker(latlng, { icon: ICON_NO_AGUA, pane: 'paneServices' })
  );
}

async function bindServiciosToggle(id, key) {
  const cb = document.getElementById(id);
  if (!cb) return;

  const apply = async () => {
    await ensureServiciosLayersBuilt();
    const lyr = serviciosLayers[key];
    if (!lyr) return;
    if (cb.checked) lyr.addTo(map);
    else map.removeLayer(lyr);
  };

  cb.addEventListener('change', apply);

  // si ya viene marcado
  if (cb.checked) await apply();
}

function initServiciosToggles() {
  bindServiciosToggle('tgServEYes', 'e_si');
  bindServiciosToggle('tgServENo', 'e_no');
  bindServiciosToggle('tgServAYes', 'a_si');
  bindServiciosToggle('tgServANo', 'a_no');
}


(function init() {
  // status box (top left panel)
  setStatus('');

  // IMPORTANT: checkbox IDs must match those defined in index.html
  toggleLayer('tgProv', loadProvincias, 'provincias');
  toggleLayer('tgNbi', loadCantonesNbi, 'cantonesNbi');

  toggleLayer(
    'tgViol',
    () => loadPointLayer('violencia', 'violencia', {
      // Clasificación por Total_caso (como QGIS): 1-3, 4-8, 9-23
      symbolFn: (p) => {
        const v = toNumber(getProp(p, ['Total_caso','Total_Caso','TOTAL_CASO','TOTAL_CASOS','total_caso','total_casos']));
        // Si viene NULL/0, se dibuja como punto pequeño negro (para no “desaparecer” registros)
        if (!v || v <= 0) return { radius: 2.5, fill: '#000', stroke: '#000', fillOpacity: 0.75 };

        if (v <= 3)  return { radius: 4,  fill: 'rgba(56,189,248,.85)', stroke: '#000', fillOpacity: 0.75 };
        if (v <= 8)  return { radius: 7,  fill: 'rgba(14,165,233,.85)', stroke: '#000', fillOpacity: 0.75 };
        // >= 9 (hasta 23 en tu archivo; si hay más, igual cae aquí)
        return         { radius: 11, fill: 'rgba(2,132,199,.85)',  stroke: '#000', fillOpacity: 0.75 };
      },
      weight: 0.9
    }),
    'violencia'
  );

  toggleLayer(
    'tgOtras',
    () => loadPointLayer('otrasNacionalidades', 'otrasNacionalidades', {
      // Clasificación por Total_estu (como QGIS): 1-50, 50-100, >100
      symbolFn: (p) => {
        const v = toNumber(getProp(p, ['Total_estu','Total estu','TOTAL_ESTU','TOTAL_EST','total_estu','total_estudiantes']));
        // Si viene NULL/0, se dibuja como punto pequeño negro (para no “desaparecer” registros)
        if (!v || v <= 0) return { radius: 2.5, fill: '#000', stroke: '#000', fillOpacity: 0.75 };

        // Queremos una lectura “tipo ArcGIS”: valores pequeños MUY pequeños y valores altos claramente más grandes.
        // Mantiene 3 clases visuales (1–50, 50–100, >100), pero dentro de cada clase escala suavemente.
        let r;
        if (v <= 50) {
          // 1–50  => MUY pequeño (para que no “inunde” el mapa): ~2.0 a ~3.1
          r = 1.8 + Math.sqrt(v) * 0.18;
          return { radius: r, fill: 'rgba(248,113,113,.85)', stroke: '#000', fillOpacity: 0.75 };
        }
        if (v <= 100) {
          // 50–100 => mediano: ~4.5 a ~5.3
          r = 2.5 + Math.sqrt(v) * 0.28;
          return { radius: r, fill: 'rgba(239,68,68,.85)', stroke: '#000', fillOpacity: 0.75 };
        }
        // >100 => grande y con contraste fuerte (sqrt) para parecerse a ArcGIS
        // 100 => ~10.5, 400 => ~17, 1600 => ~30 (aprox)
        r = 4.0 + Math.sqrt(v) * 0.65;
        return { radius: r, fill: 'rgba(185,28,28,.85)', stroke: '#000', fillOpacity: 0.75 };
      },
      weight: 0.9
    }),
    'otrasNacionalidades'
  );

  // Mostrar/ocultar la leyenda de burbujas (panel) para Violencia
  const cbViol = document.getElementById('tgViol');
  const lgViol = document.getElementById('legendViol');
  const syncViolLegend = () => {
    if (!lgViol) return;
    lgViol.style.display = (cbViol && cbViol.checked) ? 'block' : 'none';
  };
  if (cbViol) cbViol.addEventListener('change', syncViolLegend);
  syncViolLegend();

  // Mostrar\/ocultar la leyenda de burbujas (panel) para Otras Nacionalidades
  const cbOtras = document.getElementById('tgOtras');
  const lgOtras = document.getElementById('legendOtras');
  const syncOtrasLegend = () => {
    if (!lgOtras) return;
    lgOtras.style.display = (cbOtras && cbOtras.checked) ? 'block' : 'none';
  };
  if (cbOtras) cbOtras.addEventListener('change', syncOtrasLegend);
  syncOtrasLegend();

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
  // Servicios básicos: 4 toggles (Sí/No para Electricidad y Agua)
  initServiciosToggles();
})();
