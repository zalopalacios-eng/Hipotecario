# Cartilla del crédito UVA

App estática (GitHub Pages + Firestore) para llevar el control online de tu
crédito hipotecario UVA: saldo actualizado, próxima cuota, cuadro de
amortización de 360 cuotas, y gastos del hogar (expensas, luz, gas, internet,
seguro).

## Cómo está armado

- **`index.html` + `js/`** → el front, se sirve tal cual desde GitHub Pages.
- **Firestore** → guarda: valores diarios de UVA (`uva_diario`), feriados
  (`feriados`), las cuotas que marcaste como pagadas (`pagos`) y tus gastos
  mensuales (`gastos`). Los datos fijos del crédito (capital, TNA, TEM, plazo)
  **no** están en Firestore, viven en `js/firebase-config.js` porque no
  cambian nunca.
- **GitHub Action** (`.github/workflows/actualizar-datos.yml`) → corre una
  vez por día, trae el valor de UVA publicado por el BCRA y los feriados del
  año, y los guarda en Firestore. El front nunca llama directamente a la API
  del BCRA (por CORS/certificado no funcionaría bien desde el navegador).

## Paso 1 — Crear el proyecto de Firebase

1. Andá a [console.firebase.google.com](https://console.firebase.google.com) → **Agregar proyecto**. Nombre sugerido: `credito-uva` (podés poner el que quieras).
2. Dentro del proyecto: **Firestore Database** → **Crear base de datos** → modo producción → elegí una región (ej. `southamerica-east1`).
3. Andá a **Configuración del proyecto** (ícono de tuerca) → pestaña **Tus apps** → **Agregar app** → **Web** (ícono `</>`). Le ponés un nombre y te da un objeto `firebaseConfig`.
4. Copiá ese objeto y pegalo en `js/firebase-config.js`, reemplazando los valores de ejemplo.
5. En **Firestore Database** → pestaña **Reglas**, pegá el contenido de `firestore.rules` de este repo y publicá.

## Paso 2 — Crear la cuenta de servicio (para la GitHub Action)

1. En **Configuración del proyecto** → pestaña **Cuentas de servicio** → **Generar nueva clave privada**. Se descarga un `.json`.
2. En tu repo de GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
   - Nombre: `FIREBASE_SERVICE_ACCOUNT`
   - Valor: pegá el contenido completo del `.json` que descargaste.
3. **Nunca subas ese archivo `.json` al repo** — solo va como secret de GitHub.

## Paso 3 — Publicar en GitHub Pages

1. Subí esta carpeta a un repo de GitHub (puede ser privado; igualmente el sitio publicado con Pages queda accesible por su URL).
2. **Settings → Pages** → Source: `Deploy from a branch` → rama `main`, carpeta `/ (root)`.
3. Esperá un minuto y tu cartilla va a estar en `https://tu-usuario.github.io/tu-repo/`.

## Paso 4 — Primera corrida de datos

La Action corre sola todos los días a las 06:15 (hora Argentina), pero para no
esperar hasta mañana: en tu repo → pestaña **Actions** → **Actualizar UVA y
feriados** → **Run workflow**. Así cargás el primer valor de UVA y los
feriados del año sin esperar.

## Cómo se usa después de instalado

- **Resumen**: ves el saldo de capital adeudado hoy (en pesos, calculado con
  el último valor de UVA disponible) y la fecha/monto de la próxima cuota.
- **Cuadro de cuotas**: el cuadro completo de 360 cuotas. Al llegar la fecha
  de una cuota, aparece un botón "Marcar pagada": te pide la fecha real de
  pago y, si ya tenés el valor de UVA de ese día en Firestore, lo usa
  automático; si no, te deja pegarlo a mano (por ejemplo, del resumen del
  banco) o usa el último disponible como estimado.
- **Gastos del hogar**: cargás expensas/luz/gas/internet/seguro con monto y
  fecha, y quedan agrupados por mes con el total.

## Notas y decisiones tomadas

- **Sin login**: se decidió no poner autenticación. Ver el comentario al
  principio de `firestore.rules` — es un compromiso razonable para un uso
  personal, pero no es un cierre hermético (cualquiera que descubra la URL
  del sitio podría, en teoría, escribir datos falsos). Si en algún momento
  querés subir el nivel de seguridad, el paso natural es Firebase App Check.
- **Fórmula de amortización** (en `js/amortizacion.js`): sistema francés
  estándar sobre el capital en UVA, con el interés del primer período
  prorrateado por días reales (convención 30/360) porque el primer vencimiento
  no cae exactamente un mes después de la liquidación. Se validó contra tus
  números reales (cuota 1 = 767,49 UVA, cuota 2 en adelante = 592,18 UVA
  constante) y coincide.
- **UVA "estimada" vs "confirmada"**: si todavía no se publicó el valor de
  UVA de una fecha puntual, la app usa el último valor disponible y lo marca
  como "estimado"; apenas la Action trae el valor real, pasa a "confirmado".
- **CFT**: falta ese dato (lo mencionaste vos mismo). No afecta el cálculo de
  cuota/capital/interés, es solo informativo — se puede agregar a
  `datosCredito` en `js/firebase-config.js` el día que lo tengas.
