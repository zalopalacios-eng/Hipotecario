// scripts/actualizar-datos.mjs
//
// Corre una vez por día vía GitHub Actions (ver .github/workflows/actualizar-datos.yml).
// Hace dos cosas:
//   1. Trae el valor de UVA publicado por el BCRA y lo guarda en Firestore (uva_diario).
//   2. Se asegura de tener cargados los feriados del año actual y el siguiente (feriados).
//
// Usa la API pública del BCRA (no requiere token) y, si falla, no rompe el resto
// del proceso: los feriados se actualizan igual.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Agent, fetch as undiciFetch } from "undici";
import { datosCredito } from "../js/firebase-config.js";

// ---------- Firebase Admin ----------
// La credencial viene de la GitHub Secret FIREBASE_SERVICE_ACCOUNT (el JSON
// completo de la cuenta de servicio, pegado tal cual).
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// El sitio del BCRA históricamente presenta problemas de certificado SSL desde
// clientes no-browser. Este agente evita que el script falle por eso.
const agenteSinVerificarTLS = new Agent({ connect: { rejectUnauthorized: false } });

async function fetchJSON(url, { sinVerificarTLS = false } = {}) {
  const res = await undiciFetch(url, sinVerificarTLS ? { dispatcher: agenteSinVerificarTLS } : {});
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// ---------- 1. Valor de UVA (BCRA) ----------
// NOTA: el BCRA dio de baja la v3.0 de esta API el 28/2/2026. Usamos la
// v4.0, que además cambió la forma de la respuesta: los datos de una
// variable vienen anidados en `results[0].detalle`, no como lista plana.
const BCRA_BASE = "https://api.bcra.gob.ar/estadisticas/v4.0";

async function actualizarUVA() {
  console.log("Buscando el ID de la variable UVA en el catálogo del BCRA...");
  const catalogo = await fetchJSON(`${BCRA_BASE}/monetarias`, { sinVerificarTLS: true });
  const variableUVA = (catalogo.results || []).find((v) =>
    (v.descripcion || "").toLowerCase().includes("valor adquisitivo")
  );
  if (!variableUVA) throw new Error("No se encontró la variable UVA en el catálogo del BCRA.");
  console.log(`Variable UVA encontrada: idVariable=${variableUVA.idVariable} (${variableUVA.descripcion})`);

  const fmt = (d) => d.toISOString().slice(0, 10);
  const hoy = new Date();
  // Traemos TODO el historial desde la fecha de liquidación del crédito hasta
  // hoy, no solo los últimos días — si no, las cuotas viejas (antes de que
  // esta Action empezara a correr) se quedan sin dato real para siempre.
  // Lo pedimos en tramos de 90 días por si la API tiene un límite de rango
  // (así no se rompe si hoy tiene 6+ meses de historial).
  const desde = new Date(`${datosCredito.fechaLiquidacion}T00:00:00Z`);
  const TRAMO_DIAS = 90;

  let cursor = new Date(desde);
  let totalFilas = 0;
  let todasLasFilas = [];

  while (cursor <= hoy) {
    const finTramo = new Date(Math.min(cursor.getTime() + TRAMO_DIAS * 86400000, hoy.getTime()));
    const url = `${BCRA_BASE}/monetarias/${variableUVA.idVariable}?desde=${fmt(cursor)}&hasta=${fmt(finTramo)}`;
    console.log(`Pidiendo tramo ${fmt(cursor)} -> ${fmt(finTramo)}...`);
    const datos = await fetchJSON(url, { sinVerificarTLS: true });

    // v4.0: results = [ { idVariable, detalle: [ {fecha, valor}, ... ] } ]
    const filas = datos.results?.[0]?.detalle || [];
    // Committeamos por tramo (<=90 escrituras) en vez de un solo batch para
    // todo el historial, así nunca chocamos con el límite de 500 de Firestore
    // aunque pasen los años y el crédito acumule miles de días.
    const batch = db.batch();
    for (const fila of filas) {
      const ref = db.collection("uva_diario").doc(fila.fecha);
      batch.set(ref, { fecha: fila.fecha, valor: fila.valor, actualizado: new Date().toISOString() });
    }
    if (filas.length > 0) await batch.commit();

    totalFilas += filas.length;
    todasLasFilas = todasLasFilas.concat(filas);

    cursor = new Date(finTramo.getTime() + 86400000);
  }

  console.log(`uva_diario actualizado. ${totalFilas} valores en total.`);

  // Valor de UVA de hoy (si ya está publicado) para combinarlo con los
  // dólares en la colección `cotizaciones`.
  return uvaPorFechaDeHoy(todasLasFilas);
}

function uvaPorFechaDeHoy(filas) {
  const hoyISO = new Date().toISOString().slice(0, 10);
  const fila = filas.find((f) => f.fecha === hoyISO);
  return fila ? fila.valor : null;
}

// ---------- 1b. Dólares de hoy (oficial / blue / cripto) ----------
async function actualizarCotizacionDolarHoy(uvaHoy) {
  const tipos = { usdOficial: "oficial", usdBlue: "blue", usdCripto: "cripto" };
  const valores = {};

  for (const [campo, tipo] of Object.entries(tipos)) {
    try {
      const datos = await fetchJSON(`https://dolarapi.com/v1/dolares/${tipo}`);
      valores[campo] = datos.venta ?? datos.compra ?? null;
    } catch (err) {
      console.error(`No se pudo traer el dólar ${tipo}:`, err.message);
      valores[campo] = null;
    }
  }

  const hoyISO = new Date().toISOString().slice(0, 10);
  await db.collection("cotizaciones").doc(hoyISO).set(
    { fecha: hoyISO, uva: uvaHoy, ...valores },
    { merge: true }
  );
  console.log(`cotizaciones/${hoyISO} actualizado:`, { uva: uvaHoy, ...valores });
}

// ---------- 2. Feriados ----------
async function actualizarFeriados(anio) {
  console.log(`Buscando feriados de ${anio}...`);
  const feriados = await fetchJSON(`https://api.argentinadatos.com/v1/feriados/${anio}`);
  const fechas = feriados.map((f) => f.fecha); // ya vienen en "YYYY-MM-DD"
  await db.collection("feriados").doc(String(anio)).set({ anio, fechas });
  console.log(`feriados/${anio} actualizado con ${fechas.length} fechas.`);
}

// ---------- Main ----------
async function actualizarUvaYDolares() {
  const uvaHoy = await actualizarUVA();
  await actualizarCotizacionDolarHoy(uvaHoy);
}

async function main() {
  const anioActual = new Date().getFullYear();

  const resultados = await Promise.allSettled([
    actualizarUvaYDolares(),
    actualizarFeriados(anioActual),
    actualizarFeriados(anioActual + 1),
  ]);

  resultados.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`Tarea ${i} falló:`, r.reason?.message || r.reason);
    }
  });

  const huboError = resultados.some((r) => r.status === "rejected");
  if (huboError) process.exitCode = 1;
}

main();
