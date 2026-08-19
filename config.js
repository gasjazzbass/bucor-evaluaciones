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

/* ============================================================
   Opciones precargadas de los formularios
   ============================================================ */

// Actividades del alumno (desplegable)
window.BUCOR_ACTIVIDADES = [
  "Clases de natación para niños",
  "Clases de natación para jóvenes y adultos",
];

// Asistencia por semana (veces)
window.BUCOR_ASISTENCIA = [1, 2, 3];

// Días de clase
window.BUCOR_DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Horarios: franjas de una hora, de 7 a 22
window.BUCOR_HORARIOS = Array.from({ length: 15 }, (_, i) => `${i + 7} a ${i + 8}`);

/* ============================================================
   PRE-EQUIPO · dos rúbricas (una por etapa) con umbral de éxito fijo
   ⚠️ PENDIENTE: reemplazar ítems y umbrales por los definitivos.
   ============================================================ */
window.BUCOR_PREEQUIPO = {
  // Etapa 1: evaluación de candidatos a ser invitados al pre-equipo (20 ítems, aprueba con 80%)
  candidato: {
    titulo: "Evaluación de candidato",
    umbral: 80,   // 16 de 20 puntos
    rubrica: [
      { cat: "Crol", items: [
        { key: "cand_crol_respiracion", label: "Respiración" },
        { key: "cand_crol_patada",      label: "Patada" },
        { key: "cand_crol_brazada",     label: "Brazada" },
        { key: "cand_crol_nado",        label: "Nado continuo" },
      ]},
      { cat: "Espalda", items: [
        { key: "cand_esp_flotacion", label: "Línea de flotación" },
        { key: "cand_esp_patada",    label: "Patada" },
        { key: "cand_esp_brazada",   label: "Brazada" },
        { key: "cand_esp_nado",      label: "Nado continuo" },
      ]},
      { cat: "Mariposa", items: [
        { key: "cand_mar_onda",  label: "Onda delfín" },
        { key: "cand_mar_coord", label: "Coordinación movimientos" },
        { key: "cand_mar_nado",  label: "Nado continuo" },
      ]},
      { cat: "Patada Pecho", items: [
        { key: "cand_pecho_armado", label: "Armado" },
        { key: "cand_pecho_empuje", label: "Empuje" },
        { key: "cand_pecho_pausa",  label: "Pausa" },
        { key: "cand_pecho_nado",   label: "Nado continuo" },
      ]},
      { cat: "Habilidades complementarias", items: [
        { key: "cand_hab_buceo",     label: "Buceo / nado subacuático" },
        { key: "cand_hab_largada",   label: "Largada de cabeza" },
        { key: "cand_hab_flotacion", label: "Flotación estática" },
        { key: "cand_hab_flecha",    label: "Empuje de pared y flecha" },
        { key: "cand_hab_andarivel", label: "Manejo del andarivel" },
      ]},
    ],
  },
  // Etapa 2: seguimiento dentro del pre-equipo hasta pasar al equipo oficial
  preequipo: {
    titulo: "Seguimiento en el pre-equipo",
    umbral: 70,   // % de éxito (a definir)
    rubrica: [
      { cat: "Ítems a definir", items: [
        { key: "seg_1", label: "Ítem 1 (a definir)" },
        { key: "seg_2", label: "Ítem 2 (a definir)" },
        { key: "seg_3", label: "Ítem 3 (a definir)" },
        { key: "seg_4", label: "Ítem 4 (a definir)" },
      ]},
    ],
  },
};
