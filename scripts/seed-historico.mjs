// scripts/seed-historico.mjs
//
// Carga UNA SOLA VEZ el historial de cotizaciones (UVA, USD oficial/blue/cripto)
// a la colección `cotizaciones` de Firestore. Se corre a mano desde GitHub
// Actions (workflow "Cargar historico de cotizaciones (una sola vez)").
//
// Después de esta carga inicial, el script diario (actualizar-datos.mjs) se
// encarga de ir agregando el día de hoy.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const filas = JSON.parse(
  readFileSync(join(__dirname, "data", "historico-cotizaciones.json"), "utf-8")
);

console.log(`Cargando ${filas.length} días de historial a Firestore (colección "cotizaciones")...`);

// Firestore permite hasta 500 escrituras por batch.
const TAMANO_LOTE = 450;
let cargados = 0;

for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
  const lote = filas.slice(i, i + TAMANO_LOTE);
  const batch = db.batch();
  for (const fila of lote) {
    const ref = db.collection("cotizaciones").doc(fila.fecha);
    batch.set(ref, fila, { merge: true });
  }
  await batch.commit();
  cargados += lote.length;
  console.log(`  ...${cargados}/${filas.length}`);
}

console.log("Listo. Historial cargado.");
