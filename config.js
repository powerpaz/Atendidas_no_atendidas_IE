// config.js
// Objetivo: definir fuentes de capas sin Supabase.
//
// Recomendación (estable en GitHub Pages):
// - Mantén los datos dentro del repo (carpeta /data) y usa USE_LOCAL_DATA = true.
// - Evitas CORS (bloqueos por navegador) y el prender/apagar capas funciona siempre.
//
// Nota: GitHub "Releases/download" NO suele permitir CORS para fetch() desde GitHub Pages.

window.USE_LOCAL_DATA = true;

// Si quieres servir datos por URL (sin Supabase), usa RAW de GitHub.
// OJO: el archivo debe existir en el repo (no en Releases), por ejemplo en /data.
window.RAW_BASE = 'https://raw.githubusercontent.com/powerpaz/IE_Atendidas_no_atendidas/main/';

// URLs por capa (modo remoto). Se usan solo si USE_LOCAL_DATA = false.
window.LAYER_URLS = {
  // Polígonos
  provincias: window.RAW_BASE + 'provincias_simplificado.geojson',
  cantonesNbiTopo: window.RAW_BASE + 'data/cantones_nbi_mayor_50.topo.json',

  // Puntos
  violencia: window.RAW_BASE + 'data/total_casos_violencia.geojson',
  otrasNacionalidades: window.RAW_BASE + 'data/total_estudiantes_otras_nacionalidades.geojson',
  ieNoAtendidas: window.RAW_BASE + 'data/ie_fiscales_no_atendidas.geojson',
  servicios: window.RAW_BASE + 'data/servicios_agua_luz.geojson'
};

// Rutas locales (modo estable, misma web)
window.LOCAL_PATHS = {
  provincias: 'provincias_simplificado.geojson',
  cantonesNbiTopo: 'data/cantones_nbi_mayor_50.topo.json',
  violencia: 'data/total_casos_violencia.geojson',
  otrasNacionalidades: 'data/total_estudiantes_otras_nacionalidades.geojson',
  ieNoAtendidas: 'data/ie_fiscales_no_atendidas.geojson',
  servicios: 'data/servicios_agua_luz.geojson'
};
