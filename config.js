// ============================================================
//  Configuración de conexión a Supabase + estructura de la evaluación
// ============================================================
// La "anon key" es pública por diseño (va en el navegador). No es secreta.

window.BUCOR_CONFIG = {
  SUPABASE_URL: "https://hvzcoforknrjsuhmezub.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2emNvZm9ya25yanN1aG1lenViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjE0NDQsImV4cCI6MjA5Nzg5NzQ0NH0.kZpRhGeZS1MpQW2ToyG49zSRI9c-zENXitF5TosOHUg",
};

// Valores de calificación
window.BUCOR_VALORES = [
  { v: 0,   sigla: "NL", label: "No Logrado",            clase: "v-nl" },
  { v: 0.5, sigla: "PL", label: "Parcialmente Logrado",  clase: "v-pl" },
  { v: 1,   sigla: "L",  label: "Logrado",               clase: "v-l"  },
];

// Rúbrica: 19 puntos de aprendizaje agrupados por categoría
window.BUCOR_RUBRICA = [
  { cat: "Inmersiones", items: [
    { key: "inmersiones", label: "Inmersiones" },
  ]},
  { cat: "Zambullidas", items: [
    { key: "zambullidas", label: "Zambullidas" },
  ]},
  { cat: "Flotación", items: [
    { key: "flotacion_ventral",       label: "Ventral" },
    { key: "flotacion_dorsal",        label: "Dorsal" },
    { key: "flotacion_camb_posicion", label: "Camb. posición" },
  ]},
  { cat: "Estilo Perrito", items: [
    { key: "perrito_desplazamiento", label: "Desplazamiento" },
    { key: "perrito_ren_aire",       label: "Ren. Aire" },
  ]},
  { cat: "Habilidades Complementarias", items: [
    { key: "hab_largada_cabeza",   label: "Largada de cabeza" },
    { key: "hab_buceo",            label: "Buceo" },
    { key: "hab_nado_subacuatico", label: "Nado subacuático" },
  ]},
  { cat: "Estilos · Crol", items: [
    { key: "crol_patada",      label: "Patada" },
    { key: "crol_brazada",     label: "Brazada" },
    { key: "crol_respiracion", label: "Respiración" },
  ]},
  { cat: "Estilos · Espalda", items: [
    { key: "espalda_patada",  label: "Patada" },
    { key: "espalda_brazada", label: "Brazada" },
  ]},
  { cat: "Estilos · Pecho", items: [
    { key: "pecho_patada", label: "Patada" },
    { key: "pecho_pausa",  label: "Pausa" },
  ]},
  { cat: "Estilos · Mariposa", items: [
    { key: "mariposa_onda",    label: "Onda" },
    { key: "mariposa_brazada", label: "Brazada" },
  ]},
];

// Total de ítems (para el cálculo del %)
window.BUCOR_TOTAL_ITEMS = window.BUCOR_RUBRICA.reduce((n, g) => n + g.items.length, 0); // 19

// Metas de gestión
window.BUCOR_METAS = {
  alumnosPorCoordinador: 20,
  aprobadosPorCoordinador: 18,
  alumnosGrupo: 80,
  aprobadosGrupo: 72,
  saltoObjetivo: 40, // puntos porcentuales sobre la 1ra observación
};
