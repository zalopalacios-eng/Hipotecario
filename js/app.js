// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  addDoc, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig, datosCredito } from "./firebase-config.js";
import { generarCuadroAmortizacion } from "./amortizacion.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Formateadores ----------
const fmtPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const fmtUVA = (n) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtFecha = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const hoyISO = () => new Date().toISOString().slice(0, 10);

// ---------- Estado en memoria ----------
let cuadro = [];
let feriadosSet = new Set();
let uvaPorFecha = new Map(); // "YYYY-MM-DD" -> valor
let pagosPorCuota = new Map(); // numero -> {fechaPago, valorUvaPago, montoPesosPagado, ...}
let gastos = [];

// ---------- Carga de datos ----------
async function cargarFeriados() {
  const snap = await getDocs(collection(db, "feriados"));
  const set = new Set();
  snap.forEach((d) => {
    const data = d.data();
    (data.fechas || []).forEach((f) => set.add(f));
  });
  return set;
}

async function cargarUvaDiario() {
  const snap = await getDocs(query(collection(db, "uva_diario"), orderBy("fecha")));
  const mapa = new Map();
  snap.forEach((d) => {
    const data = d.data();
    mapa.set(data.fecha, data.valor);
  });
  return mapa;
}

async function cargarPagos() {
  const snap = await getDocs(collection(db, "pagos"));
  const mapa = new Map();
  snap.forEach((d) => mapa.set(Number(d.id), d.data()));
  return mapa;
}

async function cargarGastos() {
  const snap = await getDocs(query(collection(db, "gastos"), orderBy("fecha", "desc")));
  const lista = [];
  snap.forEach((d) => lista.push({ id: d.id, ...d.data() }));
  return lista;
}

// Busca el valor de UVA para una fecha exacta; si no está, devuelve el último
// valor disponible anterior (o el más reciente que haya, si la fecha es futura),
// marcando si es un valor "confirmado" (esa fecha exacta) o "estimado".
function valorUvaParaFecha(fechaISO) {
  if (uvaPorFecha.has(fechaISO)) {
    return { valor: uvaPorFecha.get(fechaISO), confirmado: true };
  }
  const fechas = [...uvaPorFecha.keys()].sort();
  let ultimaAnterior = null;
  for (const f of fechas) {
    if (f <= fechaISO) ultimaAnterior = f;
    else break;
  }
  if (ultimaAnterior) {
    return { valor: uvaPorFecha.get(ultimaAnterior), confirmado: false, fechaUsada: ultimaAnterior };
  }
  // No hay ningún dato todavía (recién arrancando la app antes de que corra la Action)
  return { valor: datosCredito.valorUvaInicial, confirmado: false, fechaUsada: datosCredito.fechaLiquidacion };
}

// ---------- Render: resumen / hero ----------
function calcularSaldoActualUVA() {
  // El saldo posterior a la última cuota efectivamente pagada (en orden), o el
  // capital inicial si todavía no se pagó ninguna.
  let saldo = datosCredito.capitalInicialUVA;
  for (const fila of cuadro) {
    if (pagosPorCuota.has(fila.numero)) {
      saldo = fila.uvaSaldoPosterior;
    } else {
      break; // asumimos que se paga en orden
    }
  }
  return saldo;
}

function proximaCuotaPendiente() {
  return cuadro.find((f) => !pagosPorCuota.has(f.numero)) || null;
}

function renderResumen() {
  const saldoUVA = calcularSaldoActualUVA();
  const { valor: uvaHoy, confirmado, fechaUsada } = valorUvaParaFecha(hoyISO());
  const saldoPesos = saldoUVA * uvaHoy;

  document.getElementById("saldo-pesos").textContent = fmtPesos.format(saldoPesos);
  document.getElementById("saldo-uva").textContent = `${fmtUVA(saldoUVA)} UVAs`;
  document.getElementById("uva-hoy").textContent =
    `UVA ${confirmado ? "de hoy" : `del ${fmtFecha(fechaUsada)} (última disponible)`}: ${fmtPesos.format(uvaHoy)}`;

  const pagadas = [...pagosPorCuota.keys()].length;
  document.getElementById("cuotas-pagadas").textContent = `${pagadas} / ${datosCredito.plazoMeses}`;

  const proxima = proximaCuotaPendiente();
  if (proxima) {
    const { valor: uvaProxima, confirmado: confProxima } = valorUvaParaFecha(proxima.fechaVencimiento);
    const montoProximo = proxima.uvaCuota * uvaProxima;
    document.getElementById("proxima-fecha").textContent = fmtFecha(proxima.fechaVencimiento);
    document.getElementById("proxima-uva").textContent = `${fmtUVA(proxima.uvaCuota)} UVAs`;
    document.getElementById("proxima-monto").textContent = fmtPesos.format(montoProximo);
    document.getElementById("proxima-estado").textContent = confProxima ? "confirmada" : "estimada";
    document.getElementById("proxima-estado").className = confProxima ? "estampa estampa--ok" : "estampa estampa--estimado";
  } else {
    document.getElementById("proxima-fecha").textContent = "—";
    document.getElementById("proxima-uva").textContent = "Crédito cancelado";
    document.getElementById("proxima-monto").textContent = "";
    document.getElementById("proxima-estado").textContent = "";
  }

  document.getElementById("datos-fijos").innerHTML = `
    <div><span>Capital original</span><strong>${fmtPesos.format(datosCredito.montoOriginalPesos)}</strong></div>
    <div><span>Capital en UVAs</span><strong>${fmtUVA(datosCredito.capitalInicialUVA)}</strong></div>
    <div><span>Fecha de liquidación</span><strong>${fmtFecha(datosCredito.fechaLiquidacion)}</strong></div>
    <div><span>TNA / TEM</span><strong>${(datosCredito.tna * 100).toFixed(2)}% / ${(datosCredito.tem * 100).toFixed(3)}%</strong></div>
    <div><span>Plazo</span><strong>${datosCredito.plazoMeses} meses</strong></div>
  `;
}

// ---------- Render: cuadro de cuotas ----------
let mostrarTodas = false;

function renderCuadro() {
  const tbody = document.getElementById("tabla-cuadro-body");
  tbody.innerHTML = "";

  const proxima = proximaCuotaPendiente();
  const filasAMostrar = mostrarTodas
    ? cuadro
    : cuadro.filter((f) => {
        if (pagosPorCuota.has(f.numero)) return f.numero > (proxima ? proxima.numero - 4 : 0);
        return proxima && f.numero <= proxima.numero + 6;
      });

  for (const fila of filasAMostrar) {
    const pago = pagosPorCuota.get(fila.numero);
    const tr = document.createElement("tr");
    const { valor: uvaRef, confirmado } = valorUvaParaFecha(fila.fechaVencimiento);
    const montoEstimado = fila.uvaCuota * uvaRef;

    let estadoHtml, accionHtml;
    if (pago) {
      estadoHtml = `<span class="estampa estampa--ok">PAGADA</span>`;
      accionHtml = `<button class="btn-link" data-accion="deshacer" data-numero="${fila.numero}">deshacer</button>`;
    } else if (fila.numero === proxima?.numero) {
      estadoHtml = `<span class="estampa ${confirmado ? "estampa--ok" : "estampa--estimado"}">${confirmado ? "CONFIRMADA" : "ESTIMADA"}</span>`;
      accionHtml = `<button class="btn-primario" data-accion="pagar" data-numero="${fila.numero}">Marcar pagada</button>`;
    } else {
      estadoHtml = `<span class="estampa">PENDIENTE</span>`;
      accionHtml = "";
    }

    tr.innerHTML = `
      <td>${fila.numero}</td>
      <td>${fmtFecha(fila.fechaVencimiento)}</td>
      <td class="num">${fmtUVA(fila.uvaCuota)}</td>
      <td class="num">${fmtUVA(fila.uvaCapital)}</td>
      <td class="num">${fmtUVA(fila.uvaInteres)}</td>
      <td class="num">${pago ? fmtPesos.format(pago.montoPesosPagado) : fmtPesos.format(montoEstimado)}</td>
      <td>${estadoHtml}</td>
      <td>${accionHtml}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function marcarPagada(numero) {
  const fila = cuadro.find((f) => f.numero === numero);
  const fechaPago = prompt(`Fecha real de pago de la cuota ${numero} (AAAA-MM-DD):`, fila.fechaVencimiento);
  if (!fechaPago) return;

  let { valor: uvaPago, confirmado } = valorUvaParaFecha(fechaPago);
  if (!confirmado) {
    const manual = prompt(
      `Todavía no tengo el valor de UVA publicado para el ${fmtFecha(fechaPago)}.\n` +
      `Si lo tenés (del recibo/resumen), pegalo acá. Si lo dejás vacío, uso el último valor disponible (${fmtPesos.format(uvaPago)}).`
    );
    if (manual) uvaPago = parseFloat(manual.replace(",", "."));
  }

  const montoPesosPagado = fila.uvaCuota * uvaPago;

  await setDoc(doc(db, "pagos", String(numero)), {
    numeroCuota: numero,
    fechaVencimiento: fila.fechaVencimiento,
    fechaPago,
    valorUvaPago: uvaPago,
    uvaCuota: fila.uvaCuota,
    uvaCapital: fila.uvaCapital,
    uvaInteres: fila.uvaInteres,
    montoPesosPagado,
  });

  pagosPorCuota.set(numero, { fechaPago, valorUvaPago: uvaPago, montoPesosPagado });
  renderResumen();
  renderCuadro();
}

async function deshacerPago(numero) {
  if (!confirm(`¿Deshacer el pago de la cuota ${numero}?`)) return;
  await deleteDoc(doc(db, "pagos", String(numero)));
  pagosPorCuota.delete(numero);
  renderResumen();
  renderCuadro();
}

document.getElementById("tabla-cuadro-body").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-accion]");
  if (!btn) return;
  const numero = Number(btn.dataset.numero);
  if (btn.dataset.accion === "pagar") marcarPagada(numero);
  if (btn.dataset.accion === "deshacer") deshacerPago(numero);
});

document.getElementById("toggle-todas").addEventListener("click", () => {
  mostrarTodas = !mostrarTodas;
  document.getElementById("toggle-todas").textContent = mostrarTodas ? "Ver solo lo relevante" : "Ver cuadro completo (360 cuotas)";
  renderCuadro();
});

// ---------- Render: gastos del hogar ----------
const RUBROS = ["expensas", "luz", "gas", "internet", "seguro", "otro"];

function renderGastos() {
  const porPeriodo = new Map();
  for (const g of gastos) {
    const periodo = g.fecha.slice(0, 7); // "YYYY-MM"
    if (!porPeriodo.has(periodo)) porPeriodo.set(periodo, []);
    porPeriodo.get(periodo).push(g);
  }

  const cont = document.getElementById("gastos-lista");
  cont.innerHTML = "";
  const periodos = [...porPeriodo.keys()].sort().reverse();

  for (const periodo of periodos) {
    const items = porPeriodo.get(periodo);
    const total = items.reduce((a, g) => a + g.monto, 0);
    const [y, m] = periodo.split("-");
    const bloque = document.createElement("div");
    bloque.className = "bloque-mes";
    bloque.innerHTML = `
      <div class="bloque-mes__header">
        <h3>${m}/${y}</h3>
        <strong>${fmtPesos.format(total)}</strong>
      </div>
      <table class="tabla-gastos">
        <tbody>
          ${items.map((g) => `
            <tr>
              <td>${fmtFecha(g.fecha)}</td>
              <td class="rubro">${g.rubro}</td>
              <td class="num">${fmtPesos.format(g.monto)}</td>
              <td>${g.notas || ""}</td>
              <td><button class="btn-link" data-borrar="${g.id}">borrar</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    cont.appendChild(bloque);
  }
}

document.getElementById("form-gasto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const nuevo = {
    rubro: fd.get("rubro"),
    monto: parseFloat(fd.get("monto")),
    fecha: fd.get("fecha"),
    notas: fd.get("notas") || "",
  };
  const ref = await addDoc(collection(db, "gastos"), nuevo);
  gastos.unshift({ id: ref.id, ...nuevo });
  renderGastos();
  e.target.reset();
});

document.getElementById("gastos-lista").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-borrar]");
  if (!btn) return;
  const id = btn.dataset.borrar;
  if (!confirm("¿Borrar este gasto?")) return;
  await deleteDoc(doc(db, "gastos", id));
  gastos = gastos.filter((g) => g.id !== id);
  renderGastos();
});

// ---------- Navegación entre secciones ----------
document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("activo"));
    document.querySelectorAll(".seccion").forEach((s) => s.classList.remove("seccion--activa"));
    btn.classList.add("activo");
    document.getElementById(btn.dataset.tab).classList.add("seccion--activa");
  });
});

// ---------- Arranque ----------
async function iniciar() {
  try {
    [feriadosSet, uvaPorFecha, pagosPorCuota, gastos] = await Promise.all([
      cargarFeriados(),
      cargarUvaDiario(),
      cargarPagos(),
      cargarGastos(),
    ]);

        // datosCredito.fechaLiquidacion viene como texto ("2026-02-27") desde
    // firebase-config.js; el motor de amortización necesita un objeto Date.
    const datosParaCalculo = {
      ...datosCredito,
      fechaLiquidacion: new Date(`${datosCredito.fechaLiquidacion}T00:00:00Z`),
    };
    const resultado = generarCuadroAmortizacion(datosParaCalculo, feriadosSet);
    cuadro = resultado.cuadro;

    renderResumen();
    renderCuadro();
    renderGastos();
    document.getElementById("estado-carga").style.display = "none";
    document.getElementById("app").style.display = "block";
  } catch (err) {
    console.error(err);
    document.getElementById("estado-carga").textContent =
      "No pude conectar con Firestore. Revisá js/firebase-config.js y las reglas de Firestore.";
  }
}

iniciar();
