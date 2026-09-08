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
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const agenteSinVerificarTLS = new Agent({ connect: { rejectUnauthorized: false } });

async function fetchJSON(url, { sinVerificarTLS = false } = {}) {
  const res = await undiciFetch(url, sinVerificarTLS ? { dispatcher: agenteSinVerificarTLS } : {});
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// ---------- 1. Valor de UVA (BCRA) ----------
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
  const desde = new Date(`${datosCredito.fechaLiquidacion}T00:00:00Z`);
  const TRAMO_DIAS = 90;

  let cursor = new Date(desde);
  let totalFilas = 0;
  const batch = db.batch();

  while (cursor <= hoy) {
    const finTramo = new Date(Math.min(cursor.getTime() + TRAMO_DIAS * 86400000, hoy.getTime()));
    const url = `${BCRA_BASE}/monetarias/${variableUVA.idVariable}?desde=${fmt(cursor)}&hasta=${fmt(finTramo)}`;
    console.log(`Pidiendo tramo ${fmt(cursor)} -> ${fmt(finTramo)}...`);
    const datos = await fetchJSON(url, { sinVerificarTLS: true });

    const filas = datos.results?.[0]?.detalle || [];
    for (const fila of filas) {
      const ref = db.collection("uva_diario").doc(fila.fecha);
      batch.set(ref, { fecha: fila.fecha, valor: fila.valor, actualizado: new Date().toISOString() });
    }
    totalFilas += filas.length;

    cursor = new Date(finTramo.getTime() + 86400000);
  }

  await batch.commit();
  console.log(`uva_diario actualizado. ${totalFilas} valores en total.`);
}

// ---------- 2. Feriados ----------
async function actualizarFeriados(anio) {
  console.log(`Buscando feriados de ${anio}...`);
  const feriados = await fetchJSON(`https://api.argentinadatos.com/v1/feriados/${anio}`);
  const fechas = feriados.map((f) => f.fecha);
  await db.collection("feriados").doc(String(anio)).set({ anio, fechas });
  console.log(`feriados/${anio} actualizado con ${fechas.length} fechas.`);
}

// ---------- Main ----------
async function main() {
  const anioActual = new Date().getFullYear();

  const resultados = await Promise.allSettled([
    actualizarUVA(),
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
