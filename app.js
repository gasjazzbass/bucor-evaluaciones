/* ============================================================
   BUCOR · Evaluación de Natación — lógica de la app
   ============================================================ */
const CFG = window.BUCOR_CONFIG;
const VALORES = window.BUCOR_VALORES;
const RUBRICA = window.BUCOR_RUBRICA;
const TOTAL_ITEMS = window.BUCOR_TOTAL_ITEMS;
const METAS = window.BUCOR_METAS;
const ACTIVIDADES = window.BUCOR_ACTIVIDADES || [];
const ASISTENCIA = window.BUCOR_ASISTENCIA || [1, 2, 3];
const DIAS = window.BUCOR_DIAS || [];
const HORARIOS = window.BUCOR_HORARIOS || [];

const supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------- estado global ---------- */
const state = {
  user: null,        // auth user
  profile: null,     // { id, nombre, rol, sede_id }
  sedes: [],         // [{id, nombre}]
  trimestres: [],    // [{id, nombre, fecha_inicio, fecha_fin, ...}]
  tsedes: [],        // [{trimestre_id, sede_id}] — sedes involucradas por trimestre
  trimestreActivo: null,
  trimestreSel: null,  // trimestre seleccionado en vistas de admin
  notifs: [],        // notificaciones del usuario
  route: null,       // ruta actual
  alumnoId: null,    // ficha abierta
};

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sedeNombre = (id) => (state.sedes.find((s) => s.id === id)?.nombre) || "—";
const iniciales = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const fmtFecha = (f) => { if (!f) return "—"; const [y, m, d] = f.split("-"); return `${d}/${m}/${y}`; };
const hoyISO = () => new Date().toISOString().slice(0, 10);
const labelAsistencia = (n) => (n == 1 ? "1 vez" : `${n} veces`);
// arma las <option> de un desplegable a partir de una lista simple
const opciones = (lista, sel) => lista.map((x) =>
  `<option value="${esc(x)}" ${String(x) === String(sel ?? "") ? "selected" : ""}>${esc(x)}</option>`).join("");

// Sedes involucradas en un trimestre (si no hay ninguna definida, se asume que son todas)
function sedesDeTrimestre(trimId) {
  const ids = state.tsedes.filter((x) => x.trimestre_id === trimId).map((x) => x.sede_id);
  return ids.length ? ids : state.sedes.map((s) => s.id);
}
// Metas del trimestre (con derivación por sede). Si no hay trimestre, usa los valores por defecto.
function metasTrimestre(t, nSedes) {
  if (!t) return {
    grupoAlumnos: METAS.alumnosGrupo, grupoAprob: METAS.aprobadosGrupo,
    sedeAlumnos: METAS.alumnosPorCoordinador, sedeAprob: METAS.aprobadosPorCoordinador,
  };
  const n = Math.max(1, nSedes || 1);
  return {
    grupoAlumnos: t.meta_alumnos, grupoAprob: t.meta_aprobados,
    sedeAlumnos: Math.round(t.meta_alumnos / n), sedeAprob: Math.round(t.meta_aprobados / n),
  };
}
const rangoTrim = (t) => t ? `${fmtFecha(t.fecha_inicio)} → ${fmtFecha(t.fecha_fin)}` : "";

let toastT;
function toast(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg; t.className = "show " + tipo;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = ""), 3200);
}

/* ---------- cálculo de una observación ---------- */
function resumenMarcas(marks) {
  let nl = 0, pl = 0, l = 0, suma = 0, cargados = 0;
  for (const g of RUBRICA) for (const it of g.items) {
    const v = marks[it.key];
    if (v === undefined) continue;
    cargados++; suma += v;
    if (v === 0) nl++; else if (v === 0.5) pl++; else l++;
  }
  const pct = Math.round((suma / TOTAL_ITEMS) * 1000) / 10; // 1 decimal
  return { nl, pl, l, suma, cargados, pct, completo: cargados === TOTAL_ITEMS };
}

/* objetivo y estado a partir de las observaciones ordenadas (asc por fecha) */
function estadoDeObservaciones(obs) {
  if (!obs.length) return { pctBase: null, objetivo: null, aprobado: false, mejorPost: null };
  const pctBase = Number(obs[0].porcentaje);
  const objetivo = Math.min(100, pctBase + METAS.saltoObjetivo);
  const posteriores = obs.slice(1).map((o) => Number(o.porcentaje));
  const mejorPost = posteriores.length ? Math.max(...posteriores) : null;
  const aprobado = mejorPost !== null && mejorPost >= objetivo;
  return { pctBase, objetivo, aprobado, mejorPost };
}

function badgeEstado(row) {
  if (!row.n_obs) return `<span class="badge sin">Sin evaluar</span>`;
  if (row.aprobado) return `<span class="badge ok">✓ Aprobado</span>`;
  return `<span class="badge proc">En proceso</span>`;
}

/* ---------- verificación por video ---------- */
const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB

function badgeVerif(estado) {
  if (estado === "verificado") return `<span class="badge ok">📹 Verificado</span>`;
  if (estado === "pendiente")  return `<span class="badge proc">📹 A verificar</span>`;
  if (estado === "rechazado")  return `<span class="badge" style="background:var(--rojo-bg);color:var(--rojo)">📹 Rechazado</span>`;
  return `<span class="badge sin">📹 Falta video</span>`; // aprobado sin verificación cargada
}

async function urlFirmada(path) {
  if (!path) return null;
  const { data } = await supa.storage.from("verificaciones").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn"), msg = $("#login-msg");
  btn.disabled = true; btn.textContent = "Ingresando…"; msg.textContent = "";
  const { error } = await supa.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-pass").value,
  });
  btn.disabled = false; btn.textContent = "Ingresar";
  if (error) { msg.textContent = "Email o contraseña incorrectos."; }
});

$("#btn-google").addEventListener("click", async () => {
  // Normalizamos la URL de retorno (sin index.html) para que coincida con la lista de Supabase
  const base = (window.location.origin + window.location.pathname).replace(/index\.html?$/i, "");
  const { error } = await supa.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: base },
  });
  if (error) { $("#login-msg").textContent = "No se pudo iniciar con Google: " + error.message; }
});

$("#btn-acct").addEventListener("click", modalCuenta);
$("#btn-notif").addEventListener("click", modalNotificaciones);

function modalCuenta() {
  const rol = state.profile.rol === "admin"
    ? "Administrador" : "Coordinador · " + sedeNombre(state.profile.sede_id);
  abrirModal(`
    <div style="text-align:center">
      <div class="ava" style="width:60px;height:60px;font-size:1.3rem;margin:0 auto 10px">${esc(iniciales(state.profile.nombre || state.user.email))}</div>
      <h3 style="margin:0">${esc(state.profile.nombre || state.user.email)}</h3>
      <p class="muted small" style="margin:4px 0 0">${esc(rol)}</p>
      <p class="muted small" style="margin:2px 0 0">${esc(state.user.email)}</p>
    </div>
    <div class="modal-actions" style="justify-content:center;margin-top:18px">
      <button class="btn ghost" id="acct-cerrar">Cerrar</button>
      <button class="btn danger" id="acct-salir">Cerrar sesión</button>
    </div>`);
  $("#acct-cerrar").addEventListener("click", cerrarModal);
  $("#acct-salir").addEventListener("click", async () => { cerrarModal(); await supa.auth.signOut(); });
}

supa.auth.onAuthStateChange((_evt, session) => { arrancar(session); });
supa.auth.getSession().then(({ data }) => arrancar(data.session));

let arrancando = false;
async function arrancar(session) {
  if (!session) { mostrarLogin(); return; }
  if (arrancando) return;
  arrancando = true;
  state.user = session.user;
  try {
    await cargarContexto();
    mostrarApp();
  } catch (err) {
    console.error(err);
    toast("Error cargando datos: " + (err.message || err), "err");
  } finally { arrancando = false; }
}

async function cargarContexto() {
  const [{ data: prof, error: e1 }, { data: sedes, error: e2 },
         { data: trims, error: e3 }, { data: tsedes, error: e4 }] = await Promise.all([
    supa.from("profiles").select("*").eq("id", state.user.id).single(),
    supa.from("sedes").select("*").order("id"),
    supa.from("trimestres").select("*").order("fecha_inicio", { ascending: false }),
    supa.from("trimestre_sedes").select("*"),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  // e3/e4 pueden fallar si todavía no se corrió la migración 03 — lo toleramos
  state.profile = prof;
  state.sedes = sedes || [];
  state.trimestres = trims || [];
  state.tsedes = tsedes || [];
  state.trimestreActivo = state.trimestres.find((t) => t.activo) || null;
  state.trimestreSel = state.trimestreActivo;
}

function mostrarLogin() {
  $("#screen-app").classList.add("hidden");
  $("#screen-login").classList.remove("hidden");
  $("#form-login").reset();
  clearInterval(notifTimer);
  bienvenidaMostrada = false; // así la próxima vez que entren se vuelve a mostrar el saludo
}

function mostrarApp() {
  $("#screen-login").classList.add("hidden");
  $("#screen-app").classList.remove("hidden");
  $("#acct-ini").textContent = iniciales(state.profile.nombre || state.user.email);
  construirTabs();
  const inicio = state.profile.rol === "admin" ? "tablero" : "alumnos";
  navegar(inicio);
  // Notificaciones: genera recordatorios pendientes, carga inicial + refresco cada 60s
  revisarRecordatorios();
  clearInterval(notifTimer);
  notifTimer = setInterval(cargarNotificaciones, 60000);
  // Saludo de bienvenida (solo una vez por ingreso)
  mostrarBienvenida();
}

/* ============================================================
   PANTALLA DE BIENVENIDA (saludo + frase motivadora al azar)
   ============================================================ */
const FRASES_BIENVENIDA = [
  "Cada evaluación que hacés transforma el esfuerzo de un alumno en un logro concreto. Gracias por tu compromiso.",
  "Los grandes resultados son la suma de pequeños esfuerzos repetidos día a día. Hoy es uno de esos días.",
  "Detrás de cada progreso hay alguien que confió, enseñó y acompañó. Ese alguien sos vos.",
  "Tu dedicación es lo que convierte las metas en realidades. ¡Que sea un gran día!",
  "Enseñar a nadar también es enseñar a superarse. Gracias por hacerlo posible en cada clase.",
];

let bienvenidaMostrada = false;
function mostrarBienvenida() {
  if (bienvenidaMostrada) return;
  bienvenidaMostrada = true;
  let nombre = (state.profile.nombre || state.user.email || "").trim().split(/\s+/)[0] || "";
  if (nombre) nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const frase = FRASES_BIENVENIDA[Math.floor(Math.random() * FRASES_BIENVENIDA.length)];
  $("#welcome-hola").textContent = nombre ? `¡Hola, ${nombre}!` : "¡Hola!";
  $("#welcome-frase").textContent = frase;
  const w = $("#welcome");
  w.classList.remove("hidden");
  requestAnimationFrame(() => w.classList.add("visible"));
  setTimeout(() => {
    w.classList.remove("visible");        // inicia el desenfoque de salida (1,1s)
    setTimeout(() => w.classList.add("hidden"), 1200);
  }, 5000);                                // permanece 5 segundos antes de desaparecer
}

/* ============================================================
   NOTIFICACIONES (campanita)
   ============================================================ */
let notifTimer = null;

// Pide a la base que genere los recordatorios de "15 días sin observar" y luego refresca la campanita.
// Es idempotente: si el aviso de ese alumno ya existe, no lo repite.
async function revisarRecordatorios() {
  try { await supa.rpc("generar_recordatorios_observacion"); } catch (e) { /* si aún no se corrió la migración 09, seguimos igual */ }
  await cargarNotificaciones();
}

async function cargarNotificaciones() {
  if (!state.profile) return;
  const { data } = await supa.from("notificaciones").select("*")
    .eq("destinatario_id", state.profile.id).order("creada", { ascending: false }).limit(50);
  state.notifs = data || [];
  pintarCampana();
}

function pintarCampana() {
  const el = $("#notif-count");
  if (!el) return;
  const n = state.notifs.filter((x) => !x.leida).length;
  if (n > 0) { el.textContent = n > 99 ? "99+" : n; el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}

function fmtCuando(ts) {
  if (!ts) return "";
  const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function modalNotificaciones() {
  const items = state.notifs;
  const lista = items.length ? items.map((x) => `
    <div class="notif-item ${x.leida ? "" : "no-leida"}" data-id="${x.id}" ${x.alumno_id ? `data-alumno="${x.alumno_id}"` : ""}>
      <div class="notif-msg">${esc(x.mensaje)}</div>
      <div class="small muted">${fmtCuando(x.creada)}</div>
    </div>`).join("") : `<p class="muted">No tenés notificaciones.</p>`;
  abrirModal(`
    <div style="display:flex;align-items:center;gap:10px">
      <h3 style="margin:0;flex:1">Notificaciones</h3>
      ${items.some((x) => !x.leida) ? `<button class="btn ghost sm" id="notif-todas">Marcar leídas</button>` : ""}
    </div>
    <div id="notif-lista" style="margin-top:10px">${lista}</div>
    <div class="modal-actions"><button class="btn primary" id="notif-cerrar">Cerrar</button></div>`);
  $("#notif-cerrar").addEventListener("click", cerrarModal);
  $("#notif-todas")?.addEventListener("click", async () => { await marcarLeidas(); cerrarModal(); });
  $("#notif-lista").querySelectorAll(".notif-item").forEach((el) => el.addEventListener("click", async () => {
    await marcarUnaLeida(Number(el.dataset.id));
    const alumnoId = el.dataset.alumno ? Number(el.dataset.alumno) : null;
    cerrarModal();
    if (alumnoId) navegar("alumno", { alumnoId });
  }));
}

async function marcarLeidas() {
  const ids = state.notifs.filter((x) => !x.leida).map((x) => x.id);
  if (!ids.length) return;
  await supa.from("notificaciones").update({ leida: true }).in("id", ids);
  state.notifs.forEach((x) => (x.leida = true));
  pintarCampana();
}

async function marcarUnaLeida(id) {
  const n = state.notifs.find((x) => x.id === id);
  if (n && !n.leida) {
    await supa.from("notificaciones").update({ leida: true }).eq("id", id);
    n.leida = true; pintarCampana();
  }
}

/* ============================================================
   NAVEGACIÓN / TABS
   ============================================================ */
function tabsParaRol() {
  return state.profile.rol === "admin"
    ? [["tablero", "📊 Tablero"], ["alumnos", "🏊 Alumnos"], ["verificaciones", "📹 Verif."], ["config", "⚙️ Admin."]]
    : [["alumnos", "🏊 Mis alumnos"]];
}
function construirTabs() {
  const nav = $("#tabs");
  nav.innerHTML = tabsParaRol().map(([r, t]) =>
    `<button data-route="${r}">${t}</button>`).join("");
  nav.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => navegar(b.dataset.route)));
}
function navegar(route, extra = {}) {
  state.route = route;
  if (extra.alumnoId !== undefined) state.alumnoId = extra.alumnoId;
  $("#tabs").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.route === route));
  render();
}

async function render() {
  const v = $("#view");
  v.style.opacity = "0";
  v.innerHTML = `<div class="card muted">Cargando…</div>`;
  try {
    if (state.route === "alumnos")      await viewAlumnos(v);
    else if (state.route === "alumno")  await viewFichaAlumno(v);
    else if (state.route === "nueva-obs") await viewNuevaObs(v);
    else if (state.route === "tablero") await viewTablero(v);
    else if (state.route === "verificaciones") await viewVerificaciones(v);
    else if (state.route === "config")  await viewConfig(v);
  } catch (err) {
    console.error(err);
    v.innerHTML = `<div class="card"><b style="color:var(--rojo)">Ocurrió un error</b><p class="small muted">${esc(err.message || err)}</p></div>`;
  }
  requestAnimationFrame(() => {
    v.style.transition = "opacity .22s ease";
    v.style.opacity = "1";
  });
}

/* ============================================================
   VISTA: LISTA DE ALUMNOS
   ============================================================ */
async function viewAlumnos(v) {
  const esAdmin = state.profile.rol === "admin";

  if (!esAdmin && !state.profile.sede_id) {
    v.innerHTML = `<div class="card"><h3>Falta asignar tu sede</h3>
      <p class="muted">Tu usuario todavía no tiene una sede asignada. Pedile al administrador que te la asigne para poder cargar alumnos.</p></div>`;
    return;
  }

  // Trimestre en contexto: el admin elige; el coordinador usa el activo
  const selTrim = esAdmin ? state.trimestreSel : state.trimestreActivo;
  const nInvolved = selTrim ? sedesDeTrimestre(selTrim.id).length : state.sedes.length;
  const m = metasTrimestre(selTrim, nInvolved);
  const meta = esAdmin ? m.grupoAprob : m.sedeAprob;
  const metaTot = esAdmin ? m.grupoAlumnos : m.sedeAlumnos;

  let q = supa.from("alumno_estado").select("*").eq("activo", true).order("nombre");
  if (selTrim) q = q.eq("trimestre_id", selTrim.id);
  const { data: rows, error } = await q;
  if (error) throw error;

  // estado de verificación por alumno (para el indicador de la lista)
  const { data: verifs } = await supa.from("verificaciones").select("alumno_id,estado");
  const vmap = {}; (verifs || []).forEach((x) => (vmap[x.alumno_id] = x.estado));

  const aprob = rows.filter((r) => r.aprobado).length;
  const evaluados = rows.filter((r) => r.n_obs > 0).length;

  // encabezado / filtros
  let filtro = "";
  if (esAdmin) {
    filtro = `<div class="row" style="margin-bottom:14px">
      <label class="field" style="margin:0"><span>Trimestre</span>
        <select id="f-trim"><option value="">Todos</option>
        ${state.trimestres.map((t) => `<option value="${t.id}" ${selTrim?.id === t.id ? "selected" : ""}>${esc(t.nombre)}${t.activo ? " (activo)" : ""}</option>`).join("")}
        </select></label>
      <label class="field" style="margin:0"><span>Sede</span>
        <select id="f-sede"><option value="">Todas</option>
        ${state.sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("")}
        </select></label>
    </div>`;
  }
  const headerTrim = esAdmin ? "" : (state.trimestreActivo
    ? `<div class="chip" style="margin-bottom:10px">📅 ${esc(state.trimestreActivo.nombre)} · ${rangoTrim(state.trimestreActivo)}</div>`
    : `<div class="card small muted" style="margin-bottom:10px">Todavía no hay un trimestre activo. Podés cargar alumnos igual; pedile al administrador que cree el trimestre para fijar las metas.</div>`);

  v.innerHTML = `
    ${headerTrim}
    <div class="card">
      <div class="row" style="text-align:center">
        <div class="kpi"><div class="n">${rows.length}<span class="small muted">/${metaTot}</span></div><div class="l">Alumnos</div></div>
        <div class="kpi"><div class="n">${evaluados}</div><div class="l">Con evaluación</div></div>
        <div class="kpi ${aprob >= meta ? "good" : "warn"}"><div class="n">${aprob}<span class="small muted">/${meta}</span></div><div class="l">Aprobados (meta ${meta})</div></div>
      </div>
    </div>
    ${esAdmin ? "" : `<button class="btn primary block no-print" id="btn-nuevo-alumno" style="margin-bottom:14px">＋ Nuevo alumno</button>`}
    ${filtro}
    <div id="lista-alumnos"></div>`;

  if (!esAdmin) $("#btn-nuevo-alumno").addEventListener("click", () => {
    if (!state.trimestreActivo) {
      toast("No hay un trimestre activo. Pedile al administrador que active uno para poder cargar alumnos.", "err");
      return;
    }
    modalAlumno();
  });
  if (esAdmin) $("#f-trim").addEventListener("change", (e) => {
    state.trimestreSel = state.trimestres.find((t) => String(t.id) === e.target.value) || null;
    render();
  });

  const pintar = (lista) => {
    const cont = $("#lista-alumnos");
    if (!lista.length) { cont.innerHTML = `<div class="card muted">No hay alumnos cargados todavía.</div>`; return; }
    cont.innerHTML = lista.map((r) => {
      const pct = r.mejor_pct ?? null;
      const okBar = r.aprobado ? "ok" : "";
      return `<div class="alumno ${r.aprobado ? "ap" : ""}" data-id="${r.alumno_id}">
        <div class="ava">${esc(iniciales(r.nombre))}</div>
        <div class="info">
          <b>${esc(r.nombre)}</b>
          <div class="small muted">${esAdmin ? esc(sedeNombre(r.sede_id)) + " · " : ""}${r.n_obs} obs. · ${badgeEstado(r)}${r.aprobado ? " " + badgeVerif(vmap[r.alumno_id]) : ""}</div>
          <div class="bar ${okBar}"><i style="width:${pct ?? 0}%"></i></div>
        </div>
        <div class="pct"><div class="n">${pct === null ? "—" : pct + "%"}</div>
          <div class="small muted">${r.objetivo != null ? "obj " + r.objetivo + "%" : ""}</div></div>
      </div>`;
    }).join("");
    cont.querySelectorAll(".alumno").forEach((el) =>
      el.addEventListener("click", () => navegar("alumno", { alumnoId: Number(el.dataset.id) })));
  };
  pintar(rows);

  if (esAdmin) $("#f-sede").addEventListener("change", (e) => {
    const id = e.target.value;
    pintar(id ? rows.filter((r) => String(r.sede_id) === id) : rows);
  });
}

/* ---------- modal alta/edición de alumno ---------- */
function modalAlumno(alumno = null) {
  const editar = !!alumno;
  const admin = state.profile.rol === "admin";
  abrirModal(`
    <h3>${editar ? "Editar alumno" : "Nuevo alumno"}</h3>
    <label class="field"><span>Nombre y apellido *</span><input id="al-nombre" value="${esc(alumno?.nombre || "")}"></label>
    <div class="row">
      <label class="field"><span>Edad</span><input id="al-edad" type="number" min="2" max="99" value="${alumno?.edad ?? ""}"></label>
      <label class="field"><span>Actividad</span>
        <select id="al-actividad">
          <option value="">— Elegir —</option>
          ${opciones(ACTIVIDADES, alumno?.actividad)}
        </select></label>
    </div>
    <label class="field"><span>Asistencia por semana</span>
      <select id="al-asistencia">
        <option value="">— Elegir —</option>
        ${ASISTENCIA.map((n) => `<option value="${n}" ${Number(alumno?.asistencia_semanal) === n ? "selected" : ""}>${labelAsistencia(n)}</option>`).join("")}
      </select></label>
    ${(editar && admin) ? `<label class="field"><span>Trimestre (solo admin)</span>
      <select id="al-trimestre"><option value="">— Sin asignar —</option>
        ${state.trimestres.map((t) => `<option value="${t.id}" ${Number(alumno?.trimestre_id) === t.id ? "selected" : ""}>${esc(t.nombre)}${t.activo ? " (activo)" : ""}</option>`).join("")}
      </select></label>` : ""}
    <div class="modal-actions">
      <button class="btn ghost" id="al-cancel">Cancelar</button>
      <button class="btn primary" id="al-guardar">${editar ? "Guardar" : "Crear alumno"}</button>
    </div>
  `);
  $("#al-cancel").addEventListener("click", cerrarModal);
  $("#al-guardar").addEventListener("click", async () => {
    const nombre = $("#al-nombre").value.trim();
    if (!nombre) { toast("Poné el nombre del alumno", "err"); return; }
    const payload = {
      nombre,
      edad: $("#al-edad").value ? Number($("#al-edad").value) : null,
      actividad: $("#al-actividad").value || null,
      asistencia_semanal: $("#al-asistencia").value ? Number($("#al-asistencia").value) : null,
    };
    let error;
    if (editar) {
      if (admin && $("#al-trimestre")) payload.trimestre_id = $("#al-trimestre").value ? Number($("#al-trimestre").value) : null;
      ({ error } = await supa.from("alumnos").update(payload).eq("id", alumno.id));
    } else {
      payload.sede_id = state.profile.sede_id;
      payload.coordinador_id = state.profile.id;
      payload.trimestre_id = state.trimestreActivo?.id ?? null;
      ({ error } = await supa.from("alumnos").insert(payload));
    }
    if (error) { toast(error.message, "err"); return; }
    cerrarModal(); toast(editar ? "Alumno actualizado" : "Alumno creado", "ok");
    render();
  });
}

/* ============================================================
   VISTA: FICHA DE ALUMNO
   ============================================================ */
async function viewFichaAlumno(v) {
  const id = state.alumnoId;
  const [{ data: alumno, error: e1 }, { data: obs, error: e2 }] = await Promise.all([
    supa.from("alumnos").select("*").eq("id", id).single(),
    supa.from("observaciones").select("*").eq("alumno_id", id).order("fecha").order("creado"),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  const est = estadoDeObservaciones(obs);
  const esCoord = state.profile.rol === "coordinador";
  const esAdmin = state.profile.rol === "admin";
  const gestor = esCoord || esAdmin;   // quién puede crear/editar/borrar (el admin puede corregir todo)

  // Verificación por video (solo cuando el alumno está aprobado)
  let verif = null, url1 = null, url2 = null;
  if (est.aprobado) {
    const { data } = await supa.from("verificaciones").select("*").eq("alumno_id", id).maybeSingle();
    verif = data || null;
    if (verif) [url1, url2] = await Promise.all([urlFirmada(verif.video1_path), urlFirmada(verif.video2_path)]);
  }
  const verifCard = est.aprobado ? htmlVerificacion({ verif, esCoord, url1, url2 }) : "";

  const filasObs = obs.map((o, i) => {
    const r = resumenMarcas(o.items);
    const objOk = est.objetivo != null && i > 0 && Number(o.porcentaje) >= est.objetivo;
    return `<tr>
      <td>${i === 0 ? "<b>1ª (base)</b>" : (i + 1) + "ª"}</td>
      <td>${fmtFecha(o.fecha)}</td>
      <td>${r.nl}/${r.pl}/${r.l}</td>
      <td><b>${o.porcentaje}%</b> ${objOk ? "✓" : ""}</td>
      <td class="no-print" style="white-space:nowrap">
        <button class="btn ghost sm" data-ver="${o.id}">Ver</button>
        ${gestor ? `<button class="btn ghost sm" data-del-obs="${o.id}" title="Eliminar observación" style="color:var(--rojo)">🗑</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  v.innerHTML = `
    <button class="btn ghost sm no-print" id="btn-volver" style="margin-bottom:12px">← Volver</button>
    ${est.aprobado ? `<div class="banner-aprobado">
      <span class="big">🎉 ¡OBJETIVO LOGRADO!</span>
      <span class="sub">Superó el objetivo de <b>${est.objetivo}%</b> (línea de base ${est.pctBase}% + ${METAS.saltoObjetivo} pts)</span>
    </div>` : ""}
    <div class="card ${est.aprobado ? "ficha-aprobado" : ""}" id="ficha">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:8px">
        <div class="ava" style="width:54px;height:54px;font-size:1.1rem">${esc(iniciales(alumno.nombre))}</div>
        <div style="flex:1">
          <h2 style="margin:0">${esc(alumno.nombre)}</h2>
          <div class="small muted">${alumno.edad ? alumno.edad + " años · " : ""}${esc(sedeNombre(alumno.sede_id))}</div>
          <div class="small muted">${[
            alumno.actividad,
            alumno.asistencia_semanal ? labelAsistencia(alumno.asistencia_semanal) + " por semana" : null,
          ].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
        <div>${badgeEstado({ n_obs: obs.length, aprobado: est.aprobado })}</div>
      </div>
      <div class="row" style="text-align:center;margin-top:6px">
        <div class="kpi"><div class="n">${est.pctBase ?? "—"}${est.pctBase != null ? "%" : ""}</div><div class="l">1ª observación</div></div>
        <div class="kpi"><div class="n">${est.objetivo ?? "—"}${est.objetivo != null ? "%" : ""}</div><div class="l">Objetivo (+${METAS.saltoObjetivo})</div></div>
        <div class="kpi ${est.aprobado ? "good" : ""}"><div class="n">${est.mejorPost ?? "—"}${est.mejorPost != null ? "%" : ""}</div><div class="l">Mejor posterior</div></div>
      </div>
    </div>

    ${verifCard}

    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h3 style="margin:0;flex:1">Observaciones (${obs.length})</h3>
        ${gestor ? `<button class="btn agua sm no-print" id="btn-nueva-obs">＋ Nueva</button>` : ""}
      </div>
      ${obs.length ? `<div class="tabla-scroll"><table class="tbl"><thead><tr><th>#</th><th>Fecha</th><th>NL/PL/L</th><th>%</th><th class="no-print"></th></tr></thead><tbody>${filasObs}</tbody></table></div>`
        : `<p class="muted">Todavía no hay observaciones. ${esCoord ? "Cargá la primera para fijar la línea de base." : ""}</p>`}
    </div>

    <div class="row no-print">
      <button class="btn ghost" id="btn-pdf">🖨️ Exportar PDF</button>
      ${gestor ? `<button class="btn ghost" id="btn-editar-al">✏️ Editar datos</button>` : ""}
    </div>
    ${gestor ? `<div class="no-print" style="margin-top:18px;text-align:center">
      <button class="btn danger sm" id="btn-del-al">🗑 Eliminar alumno</button>
    </div>` : ""}`;

  $("#btn-volver").addEventListener("click", () => navegar("alumnos"));
  $("#btn-pdf").addEventListener("click", () => window.print());
  if (gestor) {
    $("#btn-nueva-obs")?.addEventListener("click", () => navegar("nueva-obs", { alumnoId: id }));
    $("#btn-editar-al").addEventListener("click", () => modalAlumno(alumno));
    $("#btn-del-al").addEventListener("click", () => confirmar(
      `¿Eliminar a ${alumno.nombre}?`,
      `Se borrará el alumno y sus ${obs.length} observación(es). Esta acción no se puede deshacer.`,
      async () => {
        const { error } = await supa.from("alumnos").delete().eq("id", id);
        if (error) { toast(error.message, "err"); return; }
        cerrarModal(); toast("Alumno eliminado", "ok"); navegar("alumnos");
      }));
  }
  v.querySelectorAll("[data-ver]").forEach((b) =>
    b.addEventListener("click", () => modalVerObs(obs.find((o) => o.id == b.dataset.ver))));
  v.querySelectorAll("[data-del-obs]").forEach((b) =>
    b.addEventListener("click", () => {
      const o = obs.find((x) => x.id == b.dataset.delObs);
      const esBase = obs[0]?.id === o.id;
      confirmar(
        `¿Eliminar la observación del ${fmtFecha(o.fecha)}?`,
        esBase && obs.length > 1
          ? "⚠️ Es la 1ª observación (línea de base). Si la borrás, la siguiente pasará a ser la base y se recalculará el objetivo."
          : "Esta acción no se puede deshacer.",
        async () => {
          const { error } = await supa.from("observaciones").delete().eq("id", o.id);
          if (error) { toast(error.message, "err"); return; }
          cerrarModal(); toast("Observación eliminada", "ok"); render();
        });
    }));

  if (est.aprobado) wireVerificacion(id, verif, esCoord);
}

/* ---------- verificación: HTML + eventos ---------- */
function htmlVerificacion({ verif, esCoord, url1, url2 }) {
  const estado = verif?.estado;
  const borde = estado === "verificado" ? "var(--verde)" : estado === "pendiente" ? "var(--amarillo)"
    : estado === "rechazado" ? "var(--rojo)" : "var(--bucor)";
  const videos = (url1 || url2) ? `<div class="row" style="margin-top:8px">
    ${url1 ? `<video src="${url1}" controls preload="metadata" style="width:100%;border-radius:10px;background:#000"></video>` : `<div class="kpi muted">Falta video 1</div>`}
    ${url2 ? `<video src="${url2}" controls preload="metadata" style="width:100%;border-radius:10px;background:#000"></video>` : `<div class="kpi muted">Falta video 2</div>`}
  </div>` : "";

  let cuerpo;
  if (esCoord) {
    cuerpo = estado === "verificado"
      ? `<p class="small muted">✔ El administrador verificó los videos. ¡Trámite completo!</p>`
      : `${estado === "rechazado" && verif?.comentario ? `<p class="small">Motivo del rechazo: <b>${esc(verif.comentario)}</b></p>` : ""}
         <p class="small muted">El alumno alcanzó el objetivo. Subí <b>2 videos cortos</b> (máx. 50 MB c/u) donde se lo vea nadando, para que el administrador verifique.</p>
         <label class="field"><span>Video 1</span><input type="file" id="vid1" accept="video/*"></label>
         <label class="field"><span>Video 2</span><input type="file" id="vid2" accept="video/*"></label>
         <button class="btn primary no-print" id="btn-subir-videos">${verif ? "Reemplazar videos" : "Subir videos"}</button>`;
  } else { // admin
    cuerpo = !verif
      ? `<p class="muted">El coordinador todavía no subió los videos.</p>`
      : `<label class="field"><span>Comentario (se muestra al coordinador si rechazás)</span><textarea id="verif-coment">${esc(verif.comentario || "")}</textarea></label>
         <div class="row no-print">
           <button class="btn primary" id="btn-verificar">✔ Verificar</button>
           <button class="btn danger" id="btn-rechazar">✖ Rechazar</button>
         </div>`;
  }

  return `<div class="card" style="border:2px solid ${borde}">
    <div style="display:flex;align-items:center;gap:10px">
      <h3 style="margin:0;flex:1">📹 Verificación por video</h3>
      ${badgeVerif(estado)}
    </div>
    ${videos}
    ${cuerpo}
  </div>`;
}

function wireVerificacion(id, verif, esCoord) {
  if (esCoord) {
    $("#btn-subir-videos")?.addEventListener("click", async () => {
      const f1 = $("#vid1").files[0], f2 = $("#vid2").files[0];
      if (!f1 || !f2) { toast("Tenés que elegir los 2 videos", "err"); return; }
      if (f1.size > MAX_VIDEO || f2.size > MAX_VIDEO) { toast("Cada video debe pesar menos de 50 MB", "err"); return; }
      const btn = $("#btn-subir-videos"); btn.disabled = true; btn.textContent = "Subiendo…";
      try {
        const sube = async (file, n) => {
          const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
          const path = `alumno_${id}/video${n}_${Date.now()}.${ext}`;
          const { error } = await supa.storage.from("verificaciones").upload(path, file, { upsert: true, contentType: file.type || "video/mp4" });
          if (error) throw error;
          return path;
        };
        const p1 = await sube(f1, 1), p2 = await sube(f2, 2);
        const { error } = await supa.from("verificaciones").upsert({
          alumno_id: id, video1_path: p1, video2_path: p2, estado: "pendiente",
          subido_por: state.profile.id, subido_en: new Date().toISOString(),
          comentario: null, revisado_por: null, revisado_en: null,
        });
        if (error) throw error;
        toast("Videos enviados para verificación", "ok"); render();
      } catch (err) {
        toast("Error al subir: " + (err.message || err), "err");
        btn.disabled = false; btn.textContent = "Subir videos";
      }
    });
  } else {
    const revisar = async (estado) => {
      const comentario = $("#verif-coment")?.value.trim() || null;
      if (estado === "rechazado" && !comentario) { toast("Escribí un motivo para el rechazo", "err"); return; }
      const { error } = await supa.from("verificaciones").update({
        estado, comentario, revisado_por: state.profile.id, revisado_en: new Date().toISOString(),
      }).eq("alumno_id", id);
      if (error) { toast(error.message, "err"); return; }
      toast(estado === "verificado" ? "Verificación aprobada ✔" : "Videos rechazados", "ok"); render();
    };
    $("#btn-verificar")?.addEventListener("click", () => revisar("verificado"));
    $("#btn-rechazar")?.addEventListener("click", () => revisar("rechazado"));
  }
}

function modalVerObs(o) {
  const filas = RUBRICA.map((g) => `
    <div class="eval-grupo"><h4>${esc(g.cat)}</h4>
    ${g.items.map((it) => {
      const v = o.items[it.key];
      const val = VALORES.find((x) => x.v === v);
      return `<div class="eval-item"><span class="nm">${esc(it.label)}</span>
        <span class="badge ${val?.clase === "v-l" ? "ok" : val?.clase === "v-pl" ? "proc" : "sin"}">${val?.sigla || "—"}</span></div>`;
    }).join("")}</div>`).join("");
  const clase = [o.dia, o.horario ? o.horario + " hs" : null, o.instructor ? "Prof. " + o.instructor : null]
    .filter(Boolean).map(esc).join(" · ");
  abrirModal(`<h3>Observación · ${fmtFecha(o.fecha)}</h3>
    ${clase ? `<p class="muted small" style="margin:0 0 4px">${clase}</p>` : ""}
    <p class="muted small">Resultado: <b>${o.porcentaje}%</b> (total ${o.total} / ${TOTAL_ITEMS})</p>
    ${filas}
    ${o.notas ? `<div class="eval-grupo"><h4>Notas</h4><p style="white-space:pre-wrap;margin:0">${esc(o.notas)}</p></div>` : ""}
    <div class="modal-actions"><button class="btn primary" id="cerrar-ver">Cerrar</button></div>`);
  $("#cerrar-ver").addEventListener("click", cerrarModal);
}

/* ============================================================
   VISTA: NUEVA OBSERVACIÓN (carga con cálculo en vivo)
   ============================================================ */
async function viewNuevaObs(v) {
  const id = state.alumnoId;
  const [{ data: alumno, error }, { data: prev }] = await Promise.all([
    supa.from("alumnos").select("*").eq("id", id).single(),
    supa.from("observaciones").select("items,fecha,instructor,dia,horario").eq("alumno_id", id)
      .order("fecha", { ascending: false }).order("creado", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw error;
  // "Memoria": precargamos las calificaciones de la última observación (el alumno no desaprende)
  const marks = prev?.items ? { ...prev.items } : {};
  const precargado = !!prev?.items;

  v.innerHTML = `
    <button class="btn ghost sm no-print" id="btn-cancelar" style="margin-bottom:12px">← Cancelar</button>
    <div class="card">
      <h3 style="margin:0">Nueva observación</h3>
      <div class="small muted">${esc(alumno.nombre)} · ${esc(sedeNombre(alumno.sede_id))}</div>
      <div class="row" style="margin-top:12px">
        <label class="field"><span>Fecha de la observación</span>
          <input type="date" id="obs-fecha" value="${hoyISO()}" max="${hoyISO()}"></label>
        <label class="field"><span>Día</span>
          <select id="obs-dia"><option value="">— Elegir —</option>${opciones(DIAS, prev?.dia)}</select></label>
        <label class="field"><span>Horario</span>
          <select id="obs-horario"><option value="">— Elegir —</option>${opciones(HORARIOS, prev?.horario)}</select></label>
      </div>
      <label class="field"><span>Instructor/es</span>
        <input id="obs-instructor" value="${esc(prev?.instructor || "")}" placeholder="Nombre del instructor a cargo"></label>
      ${precargado
        ? `<p class="small" style="background:var(--celeste);color:var(--oxford);padding:10px 12px;border-radius:10px">🧠 <b>Precargado</b> con la observación anterior. Subí solo los ítems que mejoraron (de NL→PL, PL→L). Revisá y guardá.</p>`
        : `<p class="small muted">Tocá <b>NL</b> (no logrado), <b>PL</b> (parcial) o <b>L</b> (logrado) en cada ítem. Se califican los 19.</p>`}
      <div id="rubrica"></div>
      <label class="field" style="margin-top:14px"><span>Notas (opcional)</span>
        <textarea id="obs-notas" placeholder="Comentarios o aclaraciones sobre esta observación…"></textarea></label>
    </div>
    <div class="eval-bar">
      <div class="res">
        <div class="small muted"><span id="res-cargados">0</span>/${TOTAL_ITEMS} ítems · NL <b id="r-nl">0</b> · PL <b id="r-pl">0</b> · L <b id="r-l">0</b></div>
        <div class="n"><span id="res-pct">0</span>% <span class="small muted">(total <span id="res-suma">0</span>)</span></div>
      </div>
      <button class="btn primary" id="btn-guardar-obs" disabled>Guardar</button>
    </div>`;

  const cont = $("#rubrica");
  cont.innerHTML = RUBRICA.map((g) => `
    <div class="eval-grupo"><h4>${esc(g.cat)}</h4>
      ${g.items.map((it) => `
        <div class="eval-item">
          <span class="nm">${esc(it.label)}</span>
          <span class="eval-opts">
            ${VALORES.map((val) => `<button class="opt ${val.clase}" data-key="${it.key}" data-v="${val.v}" title="${val.label}">${val.sigla}</button>`).join("")}
          </span>
        </div>`).join("")}
    </div>`).join("");

  function refrescar() {
    const r = resumenMarcas(marks);
    $("#res-cargados").textContent = r.cargados;
    $("#r-nl").textContent = r.nl; $("#r-pl").textContent = r.pl; $("#r-l").textContent = r.l;
    $("#res-suma").textContent = r.suma; $("#res-pct").textContent = r.pct;
    $("#btn-guardar-obs").disabled = !r.completo;
  }
  cont.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.key, val = Number(b.dataset.v);
    marks[key] = val;
    cont.querySelectorAll(`.opt[data-key="${key}"]`).forEach((x) =>
      x.classList.toggle("sel", Number(x.dataset.v) === val));
    refrescar();
  }));

  // Marcar visualmente los ítems precargados desde la observación anterior
  Object.entries(marks).forEach(([key, val]) => {
    cont.querySelectorAll(`.opt[data-key="${key}"]`).forEach((x) =>
      x.classList.toggle("sel", Number(x.dataset.v) === Number(val)));
  });
  refrescar();

  $("#btn-cancelar").addEventListener("click", () => navegar("alumno", { alumnoId: id }));
  $("#btn-guardar-obs").addEventListener("click", async () => {
    const r = resumenMarcas(marks);
    if (!r.completo) { toast("Faltan ítems por calificar", "err"); return; }
    const btn = $("#btn-guardar-obs"); btn.disabled = true; btn.textContent = "Guardando…";
    const { error } = await supa.from("observaciones").insert({
      alumno_id: id, fecha: $("#obs-fecha").value || hoyISO(),
      items: marks, creado_por: state.profile.id,
      notas: $("#obs-notas").value.trim() || null,
      dia: $("#obs-dia").value || null,
      horario: $("#obs-horario").value || null,
      instructor: $("#obs-instructor").value.trim() || null,
    });
    if (error) { toast(error.message, "err"); btn.disabled = false; btn.textContent = "Guardar"; return; }
    toast(`Observación guardada: ${r.pct}%`, "ok");
    navegar("alumno", { alumnoId: id });
  });
}

/* ============================================================
   VISTA: TABLERO (admin)
   ============================================================ */
async function viewTablero(v) {
  const selTrim = state.trimestreSel;
  let q = supa.from("alumno_estado").select("*").eq("activo", true);
  if (selTrim) q = q.eq("trimestre_id", selTrim.id);
  const [{ data: rows, error: e1 }, { data: profs, error: e2 }] = await Promise.all([
    q, supa.from("profiles").select("*").eq("rol", "coordinador"),
  ]);
  if (e1) throw e1; if (e2) throw e2;

  const involvedIds = selTrim ? sedesDeTrimestre(selTrim.id) : state.sedes.map((s) => s.id);
  const sedesInv = state.sedes.filter((s) => involvedIds.includes(s.id));
  const m = metasTrimestre(selTrim, sedesInv.length);

  const total = rows.length;
  const aprob = rows.filter((r) => r.aprobado).length;
  const evaluados = rows.filter((r) => r.n_obs > 0).length;
  const obsHechas = rows.reduce((n, r) => n + (r.n_obs || 0), 0);
  const pctCumpl = m.grupoAprob ? Math.round((aprob / m.grupoAprob) * 100) : 0;

  const porSede = sedesInv.map((s) => {
    const rs = rows.filter((r) => r.sede_id === s.id);
    const coord = profs.find((p) => p.sede_id === s.id);
    return { sede: s, n: rs.length, evaluados: rs.filter((r) => r.n_obs > 0).length,
             aprob: rs.filter((r) => r.aprobado).length, coord };
  });

  const selector = `<label class="field" style="max-width:320px"><span>Trimestre</span>
    <select id="t-trim"><option value="">Todos los trimestres</option>
    ${state.trimestres.map((t) => `<option value="${t.id}" ${selTrim?.id === t.id ? "selected" : ""}>${esc(t.nombre)}${t.activo ? " (activo)" : ""}</option>`).join("")}
    </select></label>`;

  const obsKpi = selTrim?.cantidad_observaciones
    ? `<div class="kpi"><div class="n">${obsHechas}<span class="small muted">/${selTrim.cantidad_observaciones}</span></div><div class="l">Observaciones hechas</div></div>` : "";

  v.innerHTML = `
    <div class="card">
      ${selector}
      ${selTrim ? `<div class="small muted">📅 ${rangoTrim(selTrim)} · ${sedesInv.length} sede(s) · meta ${m.grupoAprob}/${m.grupoAlumnos} aprobados</div>` : `<div class="small muted">Mostrando todos los trimestres (metas por defecto).</div>`}
    </div>
    <div class="card">
      <h3>Resumen ${selTrim ? esc(selTrim.nombre) : "general"}</h3>
      <div class="row" style="text-align:center">
        <div class="kpi"><div class="n">${total}<span class="small muted">/${m.grupoAlumnos}</span></div><div class="l">Alumnos en seguimiento</div></div>
        <div class="kpi"><div class="n">${evaluados}</div><div class="l">Con evaluación</div></div>
        ${obsKpi}
        <div class="kpi ${aprob >= m.grupoAprob ? "good" : "warn"}"><div class="n">${aprob}<span class="small muted">/${m.grupoAprob}</span></div><div class="l">Aprobados (meta ${m.grupoAprob})</div></div>
        <div class="kpi"><div class="n">${pctCumpl}%</div><div class="l">Cumplimiento</div></div>
      </div>
      <div class="bar ${aprob >= m.grupoAprob ? "ok" : ""}" style="margin-top:6px"><i style="width:${Math.min(100, pctCumpl)}%"></i></div>
    </div>

    <div class="card">
      <h3>Por sede / coordinador</h3>
      <div class="tabla-scroll"><table class="tbl">
        <thead><tr><th>Sede</th><th>Coordinador</th><th>Alumnos</th><th>Eval.</th><th>Aprob.</th><th>Meta ${m.sedeAprob}</th></tr></thead>
        <tbody>
        ${porSede.map((p) => `<tr>
          <td><b>${esc(p.sede.nombre)}</b></td>
          <td>${esc(p.coord?.nombre || "—")}</td>
          <td>${p.n}/${m.sedeAlumnos}</td>
          <td>${p.evaluados}</td>
          <td><b>${p.aprob}</b></td>
          <td>${p.aprob >= m.sedeAprob
              ? '<span class="badge ok">✓ cumple</span>'
              : `<span class="badge proc">faltan ${Math.max(0, m.sedeAprob - p.aprob)}</span>`}</td>
        </tr>`).join("")}
        </tbody>
      </table></div>
    </div>`;

  $("#t-trim").addEventListener("change", (e) => {
    state.trimestreSel = state.trimestres.find((t) => String(t.id) === e.target.value) || null;
    render();
  });
}

/* ============================================================
   VISTA: VERIFICACIONES (admin)
   ============================================================ */
async function viewVerificaciones(v) {
  const { data, error } = await supa.from("verificaciones")
    .select("alumno_id, estado, subido_en, alumnos(nombre, sede_id)")
    .order("subido_en", { ascending: true });
  if (error) throw error;
  const all = data || [];
  const pend = all.filter((x) => x.estado === "pendiente");
  const okN = all.filter((x) => x.estado === "verificado").length;
  const rechN = all.filter((x) => x.estado === "rechazado").length;

  const fila = (x) => `<div class="alumno" data-id="${x.alumno_id}">
    <div class="ava">${esc(iniciales(x.alumnos?.nombre))}</div>
    <div class="info"><b>${esc(x.alumnos?.nombre || "—")}</b>
      <div class="small muted">${esc(sedeNombre(x.alumnos?.sede_id))} · enviado ${fmtFecha((x.subido_en || "").slice(0, 10))}</div></div>
    <button class="btn agua sm">Revisar →</button>
  </div>`;

  v.innerHTML = `
    <div class="card">
      <div class="row" style="text-align:center">
        <div class="kpi ${pend.length ? "warn" : ""}"><div class="n">${pend.length}</div><div class="l">A verificar</div></div>
        <div class="kpi good"><div class="n">${okN}</div><div class="l">Verificados</div></div>
        <div class="kpi"><div class="n">${rechN}</div><div class="l">Rechazados</div></div>
      </div>
    </div>
    <div class="card">
      <h3>Pendientes de verificación</h3>
      ${pend.length ? pend.map(fila).join("") : `<p class="muted">No hay videos pendientes de verificar. 🎉</p>`}
    </div>`;

  v.querySelectorAll(".alumno").forEach((el) =>
    el.addEventListener("click", () => navegar("alumno", { alumnoId: Number(el.dataset.id) })));
}

/* ============================================================
   VISTA: ADMINISTRACIÓN (admin)
   ============================================================ */
async function viewConfig(v) {
  const { data: profs, error } = await supa.from("profiles").select("*").order("rol");
  if (error) throw error;
  const coords = profs.filter((p) => p.rol === "coordinador");

  v.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h3 style="margin:0;flex:1">Trimestres</h3>
        <button class="btn agua sm" id="btn-nuevo-trim">＋ Nuevo trimestre</button>
      </div>
      <p class="small muted">Cada trimestre define el período, las observaciones a realizar, las sedes involucradas y el objetivo (alumnos y mínimo de aprobados).</p>
      ${state.trimestres.length ? `<div class="tabla-scroll"><table class="tbl">
        <thead><tr><th>Nombre</th><th>Período</th><th>Sedes</th><th>Meta</th><th>Estado</th><th></th></tr></thead>
        <tbody>
        ${state.trimestres.map((t) => `<tr>
          <td><b>${esc(t.nombre)}</b></td>
          <td class="small">${rangoTrim(t)}</td>
          <td>${sedesDeTrimestre(t.id).length}</td>
          <td class="small">${t.meta_aprobados}/${t.meta_alumnos}</td>
          <td>${t.activo ? '<span class="badge ok">Activo</span>' : '<span class="badge sin">—</span>'}</td>
          <td style="white-space:nowrap">
            ${t.activo ? "" : `<button class="btn ghost sm" data-activar-trim="${t.id}">Activar</button>`}
            <button class="btn ghost sm" data-editar-trim="${t.id}">Editar</button>
            <button class="btn ghost sm" data-borrar-trim="${t.id}" style="color:var(--rojo)">🗑</button>
          </td>
        </tr>`).join("")}
        </tbody></table></div>`
        : `<p class="muted">No hay trimestres creados todavía. Creá el primero para empezar a evaluar con metas.</p>`}
    </div>

    <div class="card">
      <h3>Sedes</h3>
      <p class="small muted">Poné el nombre real de cada sede.</p>
      <div id="lista-sedes">
        ${state.sedes.map((s) => `
          <div class="row" style="align-items:flex-end;margin-bottom:8px">
            <label class="field" style="margin:0"><input data-sede="${s.id}" value="${esc(s.nombre)}"></label>
            <button class="btn ghost sm" data-guardar-sede="${s.id}" style="flex:none">Guardar</button>
          </div>`).join("")}
      </div>
    </div>

    <div class="card">
      <h3>Coordinadores</h3>
      <p class="small muted">Asigná nombre y sede a cada coordinador. Los usuarios se crean en Supabase → Authentication.</p>
      ${coords.length ? coords.map((c) => `
        <div class="row" style="align-items:flex-end;margin-bottom:10px;border-bottom:1px solid var(--borde);padding-bottom:10px">
          <label class="field" style="margin:0"><span>Nombre</span><input data-cnombre="${c.id}" value="${esc(c.nombre || "")}"></label>
          <label class="field" style="margin:0"><span>Sede</span>
            <select data-csede="${c.id}">
              <option value="">— Sin asignar —</option>
              ${state.sedes.map((s) => `<option value="${s.id}" ${s.id === c.sede_id ? "selected" : ""}>${esc(s.nombre)}</option>`).join("")}
            </select></label>
          <button class="btn ghost sm" data-guardar-coord="${c.id}" style="flex:none">Guardar</button>
        </div>`).join("")
        : `<p class="muted">No hay coordinadores todavía. Creálos en Supabase → Authentication → Users.</p>`}
    </div>`;

  v.querySelectorAll("[data-guardar-sede]").forEach((b) => b.addEventListener("click", async () => {
    const id = Number(b.dataset.guardarSede);
    const nombre = $(`[data-sede="${id}"]`).value.trim();
    if (!nombre) { toast("El nombre no puede quedar vacío", "err"); return; }
    const { error } = await supa.from("sedes").update({ nombre }).eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    state.sedes.find((s) => s.id === id).nombre = nombre;
    toast("Sede actualizada", "ok");
  }));

  v.querySelectorAll("[data-guardar-coord]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.guardarCoord;
    const nombre = $(`[data-cnombre="${id}"]`).value.trim() || null;
    const sede_id = $(`[data-csede="${id}"]`).value ? Number($(`[data-csede="${id}"]`).value) : null;
    const { error } = await supa.from("profiles").update({ nombre, sede_id }).eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    toast("Coordinador actualizado", "ok");
  }));

  // ----- Trimestres -----
  $("#btn-nuevo-trim").addEventListener("click", () => modalTrimestre());
  v.querySelectorAll("[data-editar-trim]").forEach((b) => b.addEventListener("click", () =>
    modalTrimestre(state.trimestres.find((t) => String(t.id) === b.dataset.editarTrim))));
  v.querySelectorAll("[data-activar-trim]").forEach((b) => b.addEventListener("click", async () => {
    const id = Number(b.dataset.activarTrim);
    await supa.from("trimestres").update({ activo: false }).neq("id", id);
    const { error } = await supa.from("trimestres").update({ activo: true }).eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    toast("Trimestre activado", "ok");
    await cargarContexto(); render();
  }));
  v.querySelectorAll("[data-borrar-trim]").forEach((b) => b.addEventListener("click", () => {
    const t = state.trimestres.find((x) => String(x.id) === b.dataset.borrarTrim);
    confirmar(`¿Eliminar el trimestre "${t.nombre}"?`,
      "Los alumnos cargados en este trimestre quedarán sin trimestre asignado (no se borran). Esta acción no se puede deshacer.",
      async () => {
        const { error } = await supa.from("trimestres").delete().eq("id", t.id);
        if (error) { toast(error.message, "err"); return; }
        cerrarModal(); toast("Trimestre eliminado", "ok");
        await cargarContexto(); render();
      });
  }));
}

/* ---------- modal de alta/edición de trimestre ---------- */
function modalTrimestre(trim = null) {
  const editar = !!trim;
  const checked = editar ? sedesDeTrimestre(trim.id) : state.sedes.map((s) => s.id);
  abrirModal(`
    <h3>${editar ? "Editar trimestre" : "Nuevo trimestre"}</h3>
    <label class="field"><span>Nombre *</span><input id="t-nombre" placeholder="Ej: Trimestre 1 · 2026" value="${esc(trim?.nombre || "")}"></label>
    <div class="row">
      <label class="field"><span>Desde *</span><input type="date" id="t-ini" value="${trim?.fecha_inicio || ""}"></label>
      <label class="field"><span>Hasta *</span><input type="date" id="t-fin" value="${trim?.fecha_fin || ""}"></label>
    </div>
    <label class="field"><span>Observaciones a realizar en el trimestre</span><input type="number" id="t-obs" min="0" value="${trim?.cantidad_observaciones ?? 80}"></label>
    <div class="row">
      <label class="field"><span>Total de alumnos a observar</span><input type="number" id="t-malum" min="0" value="${trim?.meta_alumnos ?? 80}"></label>
      <label class="field"><span>Mínimo de aprobados (objetivo)</span><input type="number" id="t-maprob" min="0" value="${trim?.meta_aprobados ?? 72}"></label>
    </div>
    <div class="field"><span>Sedes / coordinadores involucrados</span>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px">
        ${state.sedes.map((s) => `<label style="display:flex;align-items:center;gap:6px;font-weight:400">
          <input type="checkbox" class="t-sede" value="${s.id}" ${checked.includes(s.id) ? "checked" : ""} style="width:auto"> ${esc(s.nombre)}</label>`).join("")}
      </div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:600">
      <input type="checkbox" id="t-activo" ${(trim?.activo || !editar) ? "checked" : ""} style="width:auto"> Marcar como trimestre activo</label>
    <div class="modal-actions">
      <button class="btn ghost" id="t-cancel">Cancelar</button>
      <button class="btn primary" id="t-guardar">${editar ? "Guardar" : "Crear trimestre"}</button>
    </div>`);
  $("#t-cancel").addEventListener("click", cerrarModal);
  $("#t-guardar").addEventListener("click", async () => {
    const nombre = $("#t-nombre").value.trim();
    const fi = $("#t-ini").value, ff = $("#t-fin").value;
    if (!nombre) { toast("Poné un nombre al trimestre", "err"); return; }
    if (!fi || !ff) { toast("Completá las fechas", "err"); return; }
    if (ff < fi) { toast("La fecha 'Hasta' no puede ser anterior a 'Desde'", "err"); return; }
    const activo = $("#t-activo").checked;
    const payload = {
      nombre, fecha_inicio: fi, fecha_fin: ff,
      cantidad_observaciones: Number($("#t-obs").value || 0),
      meta_alumnos: Number($("#t-malum").value || 0),
      meta_aprobados: Number($("#t-maprob").value || 0),
      activo,
    };
    const sedesSel = [...document.querySelectorAll(".t-sede:checked")].map((x) => Number(x.value));

    let id = trim?.id, error;
    if (editar) {
      ({ error } = await supa.from("trimestres").update(payload).eq("id", id));
    } else {
      const res = await supa.from("trimestres").insert(payload).select().single();
      error = res.error; id = res.data?.id;
    }
    if (error) { toast(error.message, "err"); return; }
    // un solo trimestre activo a la vez
    if (activo && id) await supa.from("trimestres").update({ activo: false }).neq("id", id);
    // sincronizar sedes involucradas
    await supa.from("trimestre_sedes").delete().eq("trimestre_id", id);
    if (sedesSel.length) {
      await supa.from("trimestre_sedes").insert(sedesSel.map((sid) => ({ trimestre_id: id, sede_id: sid })));
    }
    cerrarModal(); toast(editar ? "Trimestre actualizado" : "Trimestre creado", "ok");
    await cargarContexto(); render();
  });
}

/* ============================================================
   MODALES
   ============================================================ */
function abrirModal(html) {
  $("#modal-root").innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  const bg = $("#modal-root .modal-bg");
  // En el celular, el mismo toque que abre el modal puede volver a dispararse sobre el
  // fondo recién creado ("ghost click") y cerrarlo al instante. Por eso habilitamos el
  // cierre-al-tocar-afuera recién después de un breve margen.
  setTimeout(() => {
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrarModal(); });
  }, 350);
}
function cerrarModal() { $("#modal-root").innerHTML = ""; }

function confirmar(titulo, mensaje, onSi) {
  abrirModal(`<h3>${esc(titulo)}</h3>
    <p class="muted">${esc(mensaje)}</p>
    <div class="modal-actions">
      <button class="btn ghost" id="cf-no">Cancelar</button>
      <button class="btn danger" id="cf-si">Eliminar</button>
    </div>`);
  $("#cf-no").addEventListener("click", cerrarModal);
  $("#cf-si").addEventListener("click", onSi);
}
