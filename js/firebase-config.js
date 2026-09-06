rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /uva_diario/{fecha} {
      allow read: if true;
      allow write: if false;
    }

    match /feriados/{anio} {
      allow read: if true;
      allow write: if false;
    }

    match /pagos/{numeroCuota} {
      allow read: if true;
      allow write: if request.resource.data.keys().hasAll(
        ['numeroCuota', 'fechaVencimiento', 'fechaPago', 'valorUvaPago', 'uvaCuota', 'uvaCapital', 'uvaInteres', 'montoPesosPagado']
      )
      && request.resource.data.numeroCuota is int
      && request.resource.data.montoPesosPagado is number
      && request.resource.data.montoPesosPagado > 0;
      allow delete: if true;
    }

    match /gastos/{gastoId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['rubro', 'monto', 'fecha'])
        && request.resource.data.rubro in ['expensas', 'luz', 'gas', 'internet', 'seguro', 'otro']
        && request.resource.data.monto is number
        && request.resource.data.monto > 0;
      allow update: if false;
      allow delete: if true;
    }
  }
}