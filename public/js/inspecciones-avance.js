// inspecciones-avance.js — Avance de la rehabilitación por fases (compartido por «Planes de atención» y «Mis planillas»).
// - AvanceFases.abrir(...)      : ventana para registrar el % de cada fase de un plantel (o marcarla «No aplica»).
// - AvanceFases.abrirPesos(...) : ventana para editar las fases y su peso (deben sumar 100 %).
// - AvanceFases.barra(pct)      : barrita con el porcentaje.
// Avance del plantel = Σ(% de la fase × peso) / Σ(peso de las fases que aplican).
(function () {
  function esc(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function numero(texto) {
    const n = Number(String(texto === undefined || texto === null ? "" : texto).trim().replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }

  function fmt(n) {
    return String(Math.round(Number(n) * 100) / 100).replace(".", ",");
  }

  function calcular(fases, valores) {
    let num = 0;
    let den = 0;
    fases.forEach((f) => {
      const v = valores[f.id];
      if (v && !v.aplica) return;
      const p = v && Number.isFinite(v.porcentaje) ? Math.min(100, Math.max(0, v.porcentaje)) : 0;
      num += p * f.peso;
      den += f.peso;
    });
    return den > 0 ? Math.round((num / den) * 100) / 100 : null;
  }

  function barra(pct, nota) {
    if (pct === null || pct === undefined) return `<span style="color:var(--muted);">—</span>`;
    const p = Math.min(100, Math.max(0, Number(pct)));
    return `<div style="min-width:110px;"><div style="display:flex; justify-content:space-between; font-size:.78rem; margin-bottom:2px;"><strong>${fmt(p)}%</strong>${nota ? `<span style="color:var(--muted);">${esc(nota)}</span>` : ""}</div>
      <div style="height:7px; border-radius:99px; background:#e2e8f0; overflow:hidden;"><div style="height:100%; width:${p}%; background:${p >= 100 ? "#2f855a" : "#2b6cb0"};"></div></div></div>`;
  }

  function ventana(html, ancho) {
    const fondo = document.createElement("div");
    fondo.className = "modal-fondo visible";
    fondo.innerHTML = `<div class="modal" style="max-width:${ancho}px;">${html}</div>`;
    document.body.appendChild(fondo);
    const cerrar = () => fondo.remove();
    fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
    return { fondo, cerrar };
  }

  // opciones: { planId, inspeccionId, nombrePlantel, fases:[{id,nombre,peso}], valores:[{fase_id,porcentaje,aplica}], onGuardado }
  function abrir(op) {
    const actual = {};
    (op.valores || []).forEach((v) => { actual[v.fase_id] = { porcentaje: Number(v.porcentaje) || 0, aplica: v.aplica !== false }; });
    op.fases.forEach((f) => { if (!actual[f.id]) actual[f.id] = { porcentaje: 0, aplica: true }; });
    const filas = op.fases.map((f) => `
      <div style="display:grid; grid-template-columns:1fr 92px 86px; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid #edf2f7;">
        <div><strong style="font-size:.88rem;">${esc(f.nombre)}</strong><div style="color:var(--muted); font-size:.74rem;">Peso ${fmt(f.peso)}%</div></div>
        <div><input type="text" inputmode="decimal" data-pct="${f.id}" value="${esc(fmt(actual[f.id].porcentaje))}" style="width:100%; text-align:right;" aria-label="Porcentaje de ${esc(f.nombre)}"></div>
        <label style="font-size:.78rem; display:flex; gap:4px; align-items:center;"><input type="checkbox" data-na="${f.id}" ${actual[f.id].aplica ? "" : "checked"}> No aplica</label>
      </div>`).join("");
    const { fondo, cerrar } = ventana(`
      <h2 style="margin-bottom:4px;">Avance de la rehabilitación</h2>
      <p style="margin:0 0 8px; color:var(--muted); font-size:.85rem;">${esc(op.nombrePlantel)}</p>
      <p style="margin:0 0 6px; color:var(--muted); font-size:.78rem;">Escribe el % de avance de cada fase (0 a 100). Si la obra no lleva una fase, márcala «No aplica»: su peso se reparte entre las demás.</p>
      ${filas}
      <div style="margin-top:12px; font-size:.95rem;">Avance del plantel: <strong id="avTotal">—</strong></div>
      <div class="error-msg" id="avError"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-primario" id="avGuardar">Guardar avance</button>
        <button type="button" class="btn btn-fantasma" id="avCancelar">Cancelar</button>
      </div>`, 520);

    function leer() {
      const valores = {};
      let ok = true;
      op.fases.forEach((f) => {
        const na = fondo.querySelector(`[data-na="${f.id}"]`).checked;
        const campo = fondo.querySelector(`[data-pct="${f.id}"]`);
        campo.disabled = na;
        const txt = campo.value.trim();
        const n = txt === "" ? 0 : numero(txt);
        const valido = na || (Number.isFinite(n) && n >= 0 && n <= 100);
        campo.style.borderColor = valido ? "" : "#c53030";
        if (!valido) ok = false;
        valores[f.id] = { aplica: !na, porcentaje: Number.isFinite(n) ? n : 0 };
      });
      return { valores, ok };
    }
    function refrescar() {
      const { valores, ok } = leer();
      const total = calcular(op.fases, valores);
      fondo.querySelector("#avTotal").textContent = ok ? (total === null ? "Ninguna fase aplica" : `${fmt(total)}%`) : "revisa los porcentajes";
      fondo.querySelector("#avGuardar").disabled = !ok;
    }
    fondo.querySelectorAll("input").forEach((i) => { i.addEventListener("input", refrescar); i.addEventListener("change", refrescar); });
    refrescar();
    fondo.querySelector("#avCancelar").addEventListener("click", cerrar);
    fondo.querySelector("#avGuardar").addEventListener("click", async () => {
      const boton = fondo.querySelector("#avGuardar");
      const errorEl = fondo.querySelector("#avError");
      errorEl.classList.remove("visible");
      const { valores, ok } = leer();
      if (!ok) return;
      boton.disabled = true;
      try {
        await RAC.put(`/api/inspecciones/planes/${op.planId}/planteles/${op.inspeccionId}/avance`, {
          fases: op.fases.map((f) => ({ fase_id: f.id, porcentaje: valores[f.id].aplica ? valores[f.id].porcentaje : 0, aplica: valores[f.id].aplica })),
        });
        mostrarToast("Avance guardado.");
        cerrar();
        if (op.onGuardado) await op.onGuardado();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.add("visible");
        boton.disabled = false;
      }
    });
  }

  // opciones: { fases:[{id,nombre,peso}], onGuardado }
  function abrirPesos(op) {
    let lista = op.fases.map((f) => ({ id: f.id, nombre: f.nombre, peso: fmt(f.peso) }));
    const { fondo, cerrar } = ventana(`
      <h2 style="margin-bottom:4px;">Fases de la rehabilitación y su peso</h2>
      <p style="margin:0 0 10px; color:var(--muted); font-size:.82rem;">El peso es cuánto vale cada fase dentro de la obra. Deben sumar exactamente 100 %. Al cambiarlos se recalcula el avance de todos los planteles. Una fase que quites deja de contar (lo ya registrado no se borra).</p>
      <div id="pesFilas"></div>
      <button type="button" class="btn btn-fantasma btn-sm" id="pesAgregar" style="margin-top:8px;">+ Agregar fase</button>
      <div style="margin-top:12px; font-size:.95rem;">Suma: <strong id="pesSuma">0%</strong> <span id="pesAviso" style="font-size:.8rem;"></span></div>
      <div class="error-msg" id="pesError"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-primario" id="pesGuardar">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="pesCancelar">Cancelar</button>
      </div>`, 540);

    function pintar() {
      fondo.querySelector("#pesFilas").innerHTML = lista.map((f, i) => `
        <div style="display:grid; grid-template-columns:1fr 84px 34px; gap:8px; align-items:center; margin-bottom:6px;">
          <input type="text" maxlength="80" data-nom="${i}" value="${esc(f.nombre)}" placeholder="Nombre de la fase" aria-label="Nombre de la fase">
          <input type="text" inputmode="decimal" data-peso="${i}" value="${esc(f.peso)}" style="text-align:right;" aria-label="Peso en porcentaje">
          <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${i}" title="Quitar esta fase" aria-label="Quitar esta fase">✕</button>
        </div>`).join("");
      fondo.querySelectorAll("[data-nom]").forEach((c) => c.addEventListener("input", () => { lista[Number(c.dataset.nom)].nombre = c.value; refrescar(); }));
      fondo.querySelectorAll("[data-peso]").forEach((c) => c.addEventListener("input", () => { lista[Number(c.dataset.peso)].peso = c.value; refrescar(); }));
      fondo.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => { lista.splice(Number(b.dataset.quitar), 1); pintar(); }));
      refrescar();
    }
    function refrescar() {
      const pesos = lista.map((f) => numero(f.peso));
      const suma = Math.round(pesos.reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0) * 100) / 100;
      const validos = lista.length > 0 && lista.every((f, i) => f.nombre.trim().length >= 2 && Number.isFinite(pesos[i]) && pesos[i] >= 0 && pesos[i] <= 100);
      const cuadra = Math.abs(suma - 100) < 0.005;
      fondo.querySelector("#pesSuma").textContent = `${fmt(suma)}%`;
      fondo.querySelector("#pesSuma").style.color = cuadra ? "#2f855a" : "#c53030";
      fondo.querySelector("#pesAviso").textContent = cuadra ? "" : suma < 100 ? `(faltan ${fmt(100 - suma)}%)` : `(sobran ${fmt(suma - 100)}%)`;
      fondo.querySelector("#pesGuardar").disabled = !(validos && cuadra);
      fondo.querySelector("#pesAgregar").disabled = lista.length >= 12;
    }
    pintar();
    fondo.querySelector("#pesAgregar").addEventListener("click", () => { lista.push({ id: null, nombre: "", peso: "0" }); pintar(); });
    fondo.querySelector("#pesCancelar").addEventListener("click", cerrar);
    fondo.querySelector("#pesGuardar").addEventListener("click", async () => {
      const boton = fondo.querySelector("#pesGuardar");
      const errorEl = fondo.querySelector("#pesError");
      errorEl.classList.remove("visible");
      boton.disabled = true;
      try {
        await RAC.put("/api/inspecciones/fases-rehabilitacion", { fases: lista.map((f) => ({ id: f.id, nombre: f.nombre.trim(), peso: numero(f.peso) })) });
        mostrarToast("Fases guardadas.");
        cerrar();
        if (op.onGuardado) await op.onGuardado();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.add("visible");
        boton.disabled = false;
      }
    });
  }

  window.AvanceFases = { abrir, abrirPesos, barra, calcular };
})();
