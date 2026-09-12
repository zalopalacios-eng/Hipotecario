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

// Capital inicial en UVA, calculado con precisión completa (pesos ÷ valor
// UVA), no el valor redondeado a 2 decimales que se guarda en
// firebase-config.js solo a título informativo. Redondear acá introduce un
// error mínimo que se agranda cuota a cuota a lo largo de las 360 cuotas.
const capitalInicialUVA = datosCredito.montoOriginalPesos / datosCredito.valorUvaInicial;

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

async function cargarCotizaciones() {
  const snap = await getDocs(query(collection(db, "cotizaciones"), orderBy("fecha")));
  const lista = [];
  snap.forEach((d) => lista.push(d.data()));
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
  let saldo = capitalInicialUVA;
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
    <div><span>Capital en UVAs</span><strong>${fmtUVA(capitalInicialUVA)}</strong></div>
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
    const { valor: uvaRef, confirmado, fechaUsada } = valorUvaParaFecha(fila.fechaVencimiento);
    const montoEstimado = fila.uvaCuota * uvaRef;

    let estadoHtml, accionHtml, valorUvaHtml;
    if (pago) {
      estadoHtml = `<span class="estampa estampa--ok">PAGADA</span>`;
      accionHtml = `<button class="btn-link" data-accion="deshacer" data-numero="${fila.numero}">deshacer</button>`;
      valorUvaHtml = `<span class="num">${fmtPesos.format(pago.valorUvaPago)}</span>`;
    } else {
      estadoHtml = `<span class="estampa ${confirmado ? "estampa--ok" : "estampa--estimado"}">${confirmado ? "CONFIRMADA" : "ESTIMADA"}</span>`;
      accionHtml = `<button class="btn-primario" data-accion="pagar" data-numero="${fila.numero}">Marcar pagada</button>`;
      valorUvaHtml = confirmado
        ? `<span class="num">${fmtPesos.format(uvaRef)}</span>`
        : `<span class="num" title="Todavía no hay valor publicado para el ${fmtFecha(fila.fechaVencimiento)}; se usa el último disponible, del ${fmtFecha(fechaUsada || fila.fechaVencimiento)}">${fmtPesos.format(uvaRef)}*</span>`;
    }

    tr.innerHTML = `
      <td data-label="Nº">${fila.numero}</td>
      <td data-label="Vencimiento">${fmtFecha(fila.fechaVencimiento)}</td>
      <td class="num" data-label="UVA cuota">${fmtUVA(fila.uvaCuota)}</td>
      <td class="num" data-label="UVA capital">${fmtUVA(fila.uvaCapital)}</td>
      <td class="num" data-label="UVA interés">${fmtUVA(fila.uvaInteres)}</td>
      <td class="num" data-label="Valor UVA">${valorUvaHtml}</td>
      <td class="num" data-label="Monto $">${pago ? fmtPesos.format(pago.montoPesosPagado) : fmtPesos.format(montoEstimado)}</td>
      <td data-label="Estado">${estadoHtml}</td>
      <td data-label="">${accionHtml}</td>
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
      <table class="tabla-gastos tabla-responsiva">
        <tbody>
          ${items.map((g) => `
            <tr>
              <td data-label="Fecha">${fmtFecha(g.fecha)}</td>
              <td class="rubro" data-label="Rubro">${g.rubro}</td>
              <td class="num" data-label="Monto">${fmtPesos.format(g.monto)}</td>
              <td data-label="Notas">${g.notas || ""}</td>
              <td data-label=""><button class="btn-link" data-borrar="${g.id}">borrar</button></td>
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

// ---------- Análisis: UVA vs. Dólar ----------
let cotizaciones = [];
let chartAnalisis = null;
let rangoActivo = "todo";
const SERIES_INFO = {
  uva: { label: "UVA", color: "#142430" },
  usdOficial: { label: "USD Oficial", color: "#3d6b52" },
  usdBlue: { label: "USD Blue", color: "#b9903f" },
  usdCripto: { label: "USD Cripto", color: "#9c4a3c" },
};

// Reduce la cantidad de puntos para que el gráfico no se sature con miles
// de días; toma como máximo ~400 puntos espaciados uniformemente.
function downsample(datos, maxPuntos = 400) {
  if (datos.length <= maxPuntos) return datos;
  const paso = Math.ceil(datos.length / maxPuntos);
  return datos.filter((_, i) => i % paso === 0 || i === datos.length - 1);
}

function filtrarPorRango(datos, rango) {
  if (rango === "todo") return datos;
  const anios = Number(rango);
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear() - anios, hoy.getMonth(), hoy.getDate());
  const desdeISO = desde.toISOString().slice(0, 10);
  return datos.filter((d) => d.fecha >= desdeISO);
}

function seriesActivas() {
  return [...document.querySelectorAll("#series-checks input[type=checkbox]")]
    .filter((c) => c.checked)
    .map((c) => c.dataset.serie);
}

function renderGrafico() {
  const datos = downsample(filtrarPorRango(cotizaciones, rangoActivo));
  const labels = datos.map((d) => fmtFecha(d.fecha));
  const activas = seriesActivas();

  const datasets = activas.map((campo) => ({
    label: SERIES_INFO[campo].label,
    data: datos.map((d) => d[campo] ?? null),
    borderColor: SERIES_INFO[campo].color,
    backgroundColor: SERIES_INFO[campo].color,
    borderWidth: 1.6,
    pointRadius: 0,
    spanGaps: true,
    tension: 0.15,
  }));

  const ctx = document.getElementById("grafico-analisis");
  if (chartAnalisis) chartAnalisis.destroy();
  chartAnalisis = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { family: "IBM Plex Mono", size: 10 } }, grid: { display: false } },
        y: { ticks: { font: { family: "IBM Plex Mono", size: 10 }, callback: (v) => fmtPesos.format(v) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtPesos.format(ctx.parsed.y)}` },
        },
      },
    },
  });
}

document.getElementById("series-checks").addEventListener("change", renderGrafico);

document.getElementById("rango-botones").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-rango]");
  if (!btn) return;
  rangoActivo = btn.dataset.rango;
  document.querySelectorAll("#rango-botones button").forEach((b) => b.classList.remove("activo"));
  btn.classList.add("activo");
  renderGrafico();
});

// Percentil de la relación UVA/USD de hoy contra todo el historial: si hoy
// la UVA está relativamente "barata" frente a ese dólar (percentil bajo),
// vender ese dólar para cancelar UVA rinde más que en la mayoría del
// historial. Si está "cara" (percentil alto), pasó lo contrario.
function percentilRatioHoy(campoUsd) {
  const ratios = cotizaciones
    .filter((d) => d.uva != null && d[campoUsd] != null)
    .map((d) => ({ fecha: d.fecha, ratio: d.uva / d[campoUsd] }));
  if (ratios.length < 10) return null;

  const ultimo = ratios[ratios.length - 1];
  const ordenado = [...ratios].sort((a, b) => a.ratio - b.ratio);
  const posicion = ordenado.findIndex((r) => r.fecha === ultimo.fecha);
  const percentil = Math.round((posicion / (ordenado.length - 1)) * 100);
  return { percentil, ratio: ultimo.ratio, fecha: ultimo.fecha };
}

function renderAnalisis() {
  if (cotizaciones.length === 0) return;
  const ultima = cotizaciones[cotizaciones.length - 1];

  document.getElementById("hoy-grid").innerHTML = `
    <div><span>Fecha del dato</span><strong>${fmtFecha(ultima.fecha)}</strong></div>
    <div><span>UVA</span><strong>${ultima.uva != null ? fmtPesos.format(ultima.uva) : "—"}</strong></div>
    <div><span>USD Oficial</span><strong>${ultima.usdOficial != null ? fmtPesos.format(ultima.usdOficial) : "—"}</strong></div>
    <div><span>USD Blue</span><strong>${ultima.usdBlue != null ? fmtPesos.format(ultima.usdBlue) : "—"}</strong></div>
    <div><span>USD Cripto</span><strong>${ultima.usdCripto != null ? fmtPesos.format(ultima.usdCripto) : "—"}</strong></div>
  `;

  const nombres = { usdOficial: "USD Oficial", usdBlue: "USD Blue", usdCripto: "USD Cripto" };
  const senalesHtml = ["usdOficial", "usdBlue", "usdCripto"].map((campo) => {
    const r = percentilRatioHoy(campo);
    if (!r) return "";
    let clase = "senal", texto;
    if (r.percentil <= 30) {
      clase += " senal--barata";
      texto = `UVA relativamente barata frente a ${nombres[campo]} (percentil ${r.percentil}% del historial desde 2016). Históricamente, vender ${nombres[campo]} para cancelar UVA rindió mejor en pocos momentos como este.`;
    } else if (r.percentil >= 70) {
      clase += " senal--cara";
      texto = `UVA relativamente cara frente a ${nombres[campo]} ahora (percentil ${r.percentil}% del historial desde 2016). En la mayor parte del historial, esperar rindió mejor que vender ${nombres[campo]} hoy.`;
    } else {
      texto = `Relación UVA / ${nombres[campo]} en un rango intermedio (percentil ${r.percentil}% del historial desde 2016).`;
    }
    return `<div class="${clase}">${texto}<small>relación UVA/USD de hoy: ${r.ratio.toFixed(3)}</small></div>`;
  }).join("");

  document.getElementById("senales").innerHTML = senalesHtml;
  renderGrafico();
}


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
    [feriadosSet, uvaPorFecha, pagosPorCuota, gastos, cotizaciones] = await Promise.all([
      cargarFeriados(),
      cargarUvaDiario(),
      cargarPagos(),
      cargarGastos(),
      cargarCotizaciones(),
    ]);

    // El capital en UVA se calcula siempre a partir de pesos ÷ valor UVA con
    // precisión completa (sin redondear a 2 decimales), porque redondear acá
    // introduce un error mínimo que se va agrandando cuota a cuota.
    const datosParaCalculo = {
      ...datosCredito,
      capitalInicialUVA,
      fechaLiquidacion: new Date(`${datosCredito.fechaLiquidacion}T00:00:00Z`),
    };
    const resultado = generarCuadroAmortizacion(datosParaCalculo, feriadosSet);
    cuadro = resultado.cuadro;

    renderResumen();
    renderCuadro();
    renderGastos();
    renderAnalisis();
    document.getElementById("estado-carga").style.display = "none";
    document.getElementById("app").style.display = "block";
  } catch (err) {
    console.error(err);
    document.getElementById("estado-carga").textContent =
      "No pude conectar con Firestore. Revisá js/firebase-config.js y las reglas de Firestore.";
  }
}

iniciar();
