/* ============================================================
   BUCOR · Evaluación de Natación — lógica de la app
   ============================================================ */
const CFG = window.BUCOR_CONFIG;
const VALORES = window.BUCOR_VALORES;
const RUBRICA = window.BUCOR_RUBRICA;
const TOTAL_ITEMS = window.BUCOR_TOTAL_ITEMS;
const METAS = window.BUCOR_METAS;

const supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------- estado global ---------- */
const state = {
  user: null,        // auth user
  profile: null,     // { id, nombre, rol, sede_id }
  sedes: [],         // [{id, nombre}]
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

$("#btn-logout").addEventListener("click", async () => { await supa.auth.signOut(); });

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
  const [{ data: prof, error: e1 }, { data: sedes, error: e2 }] = await Promise.all([
    supa.from("profiles").select("*").eq("id", state.user.id).single(),
    supa.from("sedes").select("*").order("id"),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  state.profile = prof;
  state.sedes = sedes || [];
}

function mostrarLogin() {
  $("#screen-app").classList.add("hidden");
  $("#screen-login").classList.remove("hidden");
  $("#form-login").reset();
}

function mostrarApp() {
  $("#screen-login").classList.add("hidden");
  $("#screen-app").classList.remove("hidden");
  $("#who-name").textContent = state.profile.nombre || state.user.email;
  $("#who-role").textContent = state.profile.rol === "admin"
    ? "Administrador" : "Coordinador · " + sedeNombre(state.profile.sede_id);
  construirTabs();
  const inicio = state.profile.rol === "admin" ? "tablero" : "alumnos";
  navegar(inicio);
}

/* ============================================================
   NAVEGACIÓN / TABS
   ============================================================ */
function tabsParaRol() {
  return state.profile.rol === "admin"
    ? [["tablero", "📊 Tablero"], ["alumnos", "🏊 Alumnos"], ["config", "⚙️ Administración"]]
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
  v.innerHTML = `<div class="card muted">Cargando…</div>`;
  try {
    if (state.route === "alumnos")      await viewAlumnos(v);
    else if (state.route === "alumno")  await viewFichaAlumno(v);
    else if (state.route === "nueva-obs") await viewNuevaObs(v);
    else if (state.route === "tablero") await viewTablero(v);
    else if (state.route === "config")  await viewConfig(v);
  } catch (err) {
    console.error(err);
    v.innerHTML = `<div class="card"><b style="color:var(--rojo)">Ocurrió un error</b><p class="small muted">${esc(err.message || err)}</p></div>`;
  }
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

  let q = supa.from("alumno_estado").select("*").eq("activo", true).order("nombre");
  const { data: rows, error } = await q;
  if (error) throw error;

  const aprob = rows.filter((r) => r.aprobado).length;
  const evaluados = rows.filter((r) => r.n_obs > 0).length;

  // filtro de sede para admin
  let filtro = "";
  if (esAdmin) {
    filtro = `<label class="field" style="margin-bottom:14px"><span>Filtrar por sede</span>
      <select id="f-sede"><option value="">Todas las sedes</option>
      ${state.sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("")}
      </select></label>`;
  }

  const meta = esAdmin ? METAS.aprobadosGrupo : METAS.aprobadosPorCoordinador;
  const metaTot = esAdmin ? METAS.alumnosGrupo : METAS.alumnosPorCoordinador;

  v.innerHTML = `
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

  if (!esAdmin) $("#btn-nuevo-alumno").addEventListener("click", () => modalAlumno());

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
          <div class="small muted">${esAdmin ? esc(sedeNombre(r.sede_id)) + " · " : ""}${r.n_obs} obs. · ${badgeEstado(r)}</div>
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
  abrirModal(`
    <h3>${editar ? "Editar alumno" : "Nuevo alumno"}</h3>
    <label class="field"><span>Nombre y apellido *</span><input id="al-nombre" value="${esc(alumno?.nombre || "")}"></label>
    <div class="row">
      <label class="field"><span>Edad</span><input id="al-edad" type="number" min="2" max="99" value="${alumno?.edad ?? ""}"></label>
      <label class="field"><span>Día y horario</span><input id="al-horario" value="${esc(alumno?.dia_horario || "")}"></label>
    </div>
    <label class="field"><span>Instructor/es</span><input id="al-instructor" value="${esc(alumno?.instructor || "")}"></label>
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
      dia_horario: $("#al-horario").value.trim() || null,
      instructor: $("#al-instructor").value.trim() || null,
    };
    let error;
    if (editar) {
      ({ error } = await supa.from("alumnos").update(payload).eq("id", alumno.id));
    } else {
      payload.sede_id = state.profile.sede_id;
      payload.coordinador_id = state.profile.id;
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
        ${esCoord ? `<button class="btn ghost sm" data-del-obs="${o.id}" title="Eliminar observación" style="color:var(--rojo)">🗑</button>` : ""}
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
          <div class="small muted">${esc(alumno.dia_horario || "")}${alumno.instructor ? " · Prof. " + esc(alumno.instructor) : ""}</div>
        </div>
        <div>${badgeEstado({ n_obs: obs.length, aprobado: est.aprobado })}</div>
      </div>
      <div class="row" style="text-align:center;margin-top:6px">
        <div class="kpi"><div class="n">${est.pctBase ?? "—"}${est.pctBase != null ? "%" : ""}</div><div class="l">1ª observación</div></div>
        <div class="kpi"><div class="n">${est.objetivo ?? "—"}${est.objetivo != null ? "%" : ""}</div><div class="l">Objetivo (+${METAS.saltoObjetivo})</div></div>
        <div class="kpi ${est.aprobado ? "good" : ""}"><div class="n">${est.mejorPost ?? "—"}${est.mejorPost != null ? "%" : ""}</div><div class="l">Mejor posterior</div></div>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h3 style="margin:0;flex:1">Observaciones (${obs.length})</h3>
        ${esCoord ? `<button class="btn agua sm no-print" id="btn-nueva-obs">＋ Nueva</button>` : ""}
      </div>
      ${obs.length ? `<table class="tbl"><thead><tr><th>#</th><th>Fecha</th><th>NL/PL/L</th><th>%</th><th class="no-print"></th></tr></thead><tbody>${filasObs}</tbody></table>`
        : `<p class="muted">Todavía no hay observaciones. ${esCoord ? "Cargá la primera para fijar la línea de base." : ""}</p>`}
    </div>

    <div class="row no-print">
      <button class="btn ghost" id="btn-pdf">🖨️ Exportar PDF</button>
      ${esCoord ? `<button class="btn ghost" id="btn-editar-al">✏️ Editar datos</button>` : ""}
    </div>
    ${esCoord ? `<div class="no-print" style="margin-top:18px;text-align:center">
      <button class="btn danger sm" id="btn-del-al">🗑 Eliminar alumno</button>
    </div>` : ""}`;

  $("#btn-volver").addEventListener("click", () => navegar("alumnos"));
  $("#btn-pdf").addEventListener("click", () => window.print());
  if (esCoord) {
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
  abrirModal(`<h3>Observación · ${fmtFecha(o.fecha)}</h3>
    <p class="muted small">Resultado: <b>${o.porcentaje}%</b> (total ${o.total} / ${TOTAL_ITEMS})</p>
    ${filas}
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
    supa.from("observaciones").select("items,fecha").eq("alumno_id", id)
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
      <label class="field" style="margin-top:12px;max-width:220px"><span>Fecha de la observación</span>
        <input type="date" id="obs-fecha" value="${hoyISO()}" max="${hoyISO()}"></label>
      ${precargado
        ? `<p class="small" style="background:var(--celeste);color:var(--oxford);padding:10px 12px;border-radius:10px">🧠 <b>Precargado</b> con la observación anterior. Subí solo los ítems que mejoraron (de NL→PL, PL→L). Revisá y guardá.</p>`
        : `<p class="small muted">Tocá <b>NL</b> (no logrado), <b>PL</b> (parcial) o <b>L</b> (logrado) en cada ítem. Se califican los 19.</p>`}
      <div id="rubrica"></div>
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
  const [{ data: rows, error: e1 }, { data: profs, error: e2 }] = await Promise.all([
    supa.from("alumno_estado").select("*").eq("activo", true),
    supa.from("profiles").select("*").eq("rol", "coordinador"),
  ]);
  if (e1) throw e1; if (e2) throw e2;

  const total = rows.length;
  const aprob = rows.filter((r) => r.aprobado).length;
  const evaluados = rows.filter((r) => r.n_obs > 0).length;
  const pctCumpl = METAS.aprobadosGrupo ? Math.round((aprob / METAS.aprobadosGrupo) * 100) : 0;

  const porSede = state.sedes.map((s) => {
    const rs = rows.filter((r) => r.sede_id === s.id);
    const a = rs.filter((r) => r.aprobado).length;
    const coord = profs.find((p) => p.sede_id === s.id);
    return { sede: s, n: rs.length, evaluados: rs.filter((r) => r.n_obs > 0).length, aprob: a, coord };
  });

  v.innerHTML = `
    <div class="card">
      <h3>Resumen del trimestre</h3>
      <div class="row" style="text-align:center">
        <div class="kpi"><div class="n">${total}<span class="small muted">/${METAS.alumnosGrupo}</span></div><div class="l">Alumnos en seguimiento</div></div>
        <div class="kpi"><div class="n">${evaluados}</div><div class="l">Con evaluación</div></div>
        <div class="kpi ${aprob >= METAS.aprobadosGrupo ? "good" : "warn"}"><div class="n">${aprob}<span class="small muted">/${METAS.aprobadosGrupo}</span></div><div class="l">Aprobados (meta ${METAS.aprobadosGrupo})</div></div>
        <div class="kpi"><div class="n">${pctCumpl}%</div><div class="l">Cumplimiento de meta</div></div>
      </div>
      <div class="bar ${aprob >= METAS.aprobadosGrupo ? "ok" : ""}" style="margin-top:6px"><i style="width:${Math.min(100, pctCumpl)}%"></i></div>
    </div>

    <div class="card">
      <h3>Por sede / coordinador</h3>
      <table class="tbl">
        <thead><tr><th>Sede</th><th>Coordinador</th><th>Alumnos</th><th>Eval.</th><th>Aprob.</th><th>Meta ${METAS.aprobadosPorCoordinador}</th></tr></thead>
        <tbody>
        ${porSede.map((p) => `<tr>
          <td><b>${esc(p.sede.nombre)}</b></td>
          <td>${esc(p.coord?.nombre || "—")}</td>
          <td>${p.n}/${METAS.alumnosPorCoordinador}</td>
          <td>${p.evaluados}</td>
          <td><b>${p.aprob}</b></td>
          <td>${p.aprob >= METAS.aprobadosPorCoordinador
              ? '<span class="badge ok">✓ cumple</span>'
              : `<span class="badge proc">faltan ${Math.max(0, METAS.aprobadosPorCoordinador - p.aprob)}</span>`}</td>
        </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
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
    $("#who-role").textContent = "Administrador";
  }));

  v.querySelectorAll("[data-guardar-coord]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.guardarCoord;
    const nombre = $(`[data-cnombre="${id}"]`).value.trim() || null;
    const sede_id = $(`[data-csede="${id}"]`).value ? Number($(`[data-csede="${id}"]`).value) : null;
    const { error } = await supa.from("profiles").update({ nombre, sede_id }).eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    toast("Coordinador actualizado", "ok");
  }));
}

/* ============================================================
   MODALES
   ============================================================ */
function abrirModal(html) {
  $("#modal-root").innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  $("#modal-root .modal-bg").addEventListener("click", (e) => { if (e.target.classList.contains("modal-bg")) cerrarModal(); });
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
