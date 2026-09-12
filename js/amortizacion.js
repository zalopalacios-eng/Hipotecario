// js/amortizacion.js
// Motor de cálculo del cuadro de amortización de un crédito UVA (sistema francés),
// con el primer período prorrateado por días reales (convención 30/360).
//
// No depende de Firebase: recibe los datos del crédito y el set de feriados,
// y devuelve el cuadro completo. Así se puede testear de forma aislada.

/**
 * Suma N meses calendario a una fecha, manteniendo el día.
 * Si el mes destino no tiene ese día (ej. 31 de febrero), usa el último día del mes.
 */
function sumarMeses(fecha, meses) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimoDiaMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(fecha.getUTCDate(), ultimoDiaMes);
  d.setUTCDate(dia);
  return d;
}

function toISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Ajusta una fecha al próximo día hábil si cae en fin de semana o feriado.
 * feriadosSet: Set<string> con fechas en formato "YYYY-MM-DD".
 */
export function fechaHabil(fecha, feriadosSet) {
  const f = new Date(fecha.getTime());
  // 0 = domingo, 6 = sábado
  while (f.getUTCDay() === 0 || f.getUTCDay() === 6 || feriadosSet.has(toISO(f))) {
    f.setUTCDate(f.getUTCDate() + 1);
  }
  return f;
}

/**
 * Calcula la fecha de la primera cuota: el día 10 del primer mes calendario
 * en el que hayan pasado al menos `minDias` días desde la liquidación.
 * Si el 10 del mes siguiente a la liquidación no alcanza ese mínimo, se pasa
 * al mes siguiente (esto reproduce el caso 27/2 -> primera cuota 10/4, no 10/3).
 */
export function calcularFechaPrimeraCuota(fechaLiquidacion, minDias = 30, diaVencimiento = 10) {
  let candidata = new Date(Date.UTC(
    fechaLiquidacion.getUTCFullYear(),
    fechaLiquidacion.getUTCMonth() + 1,
    diaVencimiento
  ));
  const diffDias = (candidata - fechaLiquidacion) / 86400000;
  if (diffDias < minDias) {
    candidata = sumarMeses(candidata, 1);
  }
  return candidata;
}

/**
 * Genera el cuadro de amortización completo.
 *
 * @param {Object} config
 * @param {number} config.capitalInicialUVA
 * @param {number} config.tem            - tasa efectiva mensual, ej 0.00375
 * @param {number} config.plazoMeses     - ej 360
 * @param {Date}   config.fechaLiquidacion
 * @param {number} [config.diaVencimiento=10]
 * @param {number} [config.minDiasPrimeraCuota=30]
 * @param {Set<string>} feriadosSet - fechas feriado "YYYY-MM-DD" (puede estar vacío)
 * @returns {Array<Object>} cuadro con una fila por cuota
 */
export function generarCuadroAmortizacion(config, feriadosSet = new Set()) {
  const {
    capitalInicialUVA,
    tem,
    plazoMeses,
    fechaLiquidacion,
    diaVencimiento = 10,
    minDiasPrimeraCuota = 30,
  } = config;

  // Cuota constante teórica (sistema francés estándar)
  const cuotaTeorica = (capitalInicialUVA * tem) / (1 - Math.pow(1 + tem, -plazoMeses));

  const fechaPrimeraCuota = calcularFechaPrimeraCuota(fechaLiquidacion, minDiasPrimeraCuota, diaVencimiento);

  const cuadro = [];
  let saldo = capitalInicialUVA;
  let fechaVencTeorica = fechaPrimeraCuota;

  for (let i = 1; i <= plazoMeses; i++) {
    const fechaVencimiento = fechaHabil(fechaVencTeorica, feriadosSet);

    let interesUVA;
    if (i === 1) {
      // Primer período: interés prorrateado por días reales (convención 30/360)
      const diasPeriodo = (fechaPrimeraCuota - fechaLiquidacion) / 86400000;
      interesUVA = saldo * tem * (diasPeriodo / 30);
    } else {
      interesUVA = saldo * tem;
    }

    // El capital de cada cuota sigue siempre el esquema francés estándar,
    // independientemente de si el interés del período 1 fue prorrateado.
    const capitalUVA = cuotaTeorica - saldo * tem;
    const cuotaUVA = capitalUVA + interesUVA;

    saldo = saldo - capitalUVA;

    cuadro.push({
      numero: i,
      fechaVencimientoTeorica: toISO(fechaVencTeorica),
      fechaVencimiento: toISO(fechaVencimiento),
      uvaCuota: cuotaUVA,
      uvaCapital: capitalUVA,
      uvaInteres: interesUVA,
      uvaSaldoPosterior: Math.max(saldo, 0),
    });

    fechaVencTeorica = sumarMeses(fechaPrimeraCuota, i);
  }

  return { cuotaTeoricaUVA: cuotaTeorica, fechaPrimeraCuota: toISO(fechaPrimeraCuota), cuadro };
}
