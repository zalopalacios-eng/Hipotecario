// js/firebase-config.js
//
// Datos de TU proyecto de Firebase. Estos valores NO son secretos (identifican
// el proyecto, no dan permisos por sí solos: los permisos reales los define
// firestore.rules), así que es seguro que vivan en este archivo público
// dentro del repo de GitHub.

export const firebaseConfig = {
  apiKey: "AIzaSyCgz7VMwPypf7i0lMOss3X_zdflZlHN-pQ",
  authDomain: "hipotecario-82b8e.firebaseapp.com",
  projectId: "hipotecario-82b8e",
  storageBucket: "hipotecario-82b8e.firebasestorage.app",
  messagingSenderId: "974158587386",
  appId: "1:974158587386:web:8634dc66de3967182c3043",
};

// Datos fijos del crédito (los que no cambian nunca). Si en algún momento
// necesitás corregir algo acá, es el único lugar donde tocarlo.
export const datosCredito = {
  capitalInicialUVA: 116873.87,
  valorUvaInicial: 1798.21,
  fechaLiquidacion: "2026-02-27",
  tna: 0.045,
  tem: 0.00375,
  plazoMeses: 360,
  diaVencimiento: 10,
  montoOriginalPesos: 210163753.22,
  valorPropiedadPesos: 247415119.97,
};
