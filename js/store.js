// Carga/guardado, migraciones, estado global.
"use strict";

import { uid, dateKey, CATEGORY_PALETTE, TIPO_GASTO_NOMBRES } from './utils.js';

export var STORAGE_KEY = 'controlPagos_v1';

// `data` y `state` nunca se reasignan como variable (eso rompería los
// bindings ES module ya importados en otros archivos): en vez de `data = X`
// se vacía y se vuelve a llenar el mismo objeto con assignData().
export var data = {};
export var state = {
  calView: 'mes',
  calAnchor: new Date(), // fecha de referencia para navegar mes/semana
  indicador: { cargando:false, error:null },
  backupBannerCerrado: false, // se resetea al recargar la página (a propósito: en memoria, no localStorage)
  prevStatValues: null,
  // filtro activo de la barra de porcentajes por categoría sobre "últimos
  // registros" (§2.4): array de claves de grupo (categoriaId, o las claves
  // pseudo '__ahorro'/'__deuda'/'__sin_categoria'/'__otros'), o null si no
  // hay filtro. En memoria, no se persiste entre recargas.
  dailyFiltroCategorias: null,
  dailyFiltroLabel: null
};

// se pone en false si el navegador/entorno bloquea localStorage por completo
var storageDisponible = true;
export function getStorageDisponible(){ return storageDisponible; }

export function assignData(obj){
  Object.keys(data).forEach(function(k){ delete data[k]; });
  Object.assign(data, obj);
}

// ---------- persistence ----------
export function loadData(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      try{ return JSON.parse(raw); }catch(e){ /* fallthrough to seed */ }
    }
    return seedData();
  }catch(err){
    // Acceder a localStorage puede lanzar una excepción (no solo fallar al
    // guardar) en ciertos entornos: vistas previas en iframe/sandbox,
    // abrir el archivo con file://, o restricciones de privacidad del
    // navegador. Sin este try/catch, init() se detenía aquí mismo y
    // ningún botón quedaba conectado — la app parecía "no hacer nada".
    storageDisponible = false;
    return seedData();
  }
}
export function saveData(){
  if(!storageDisponible) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }catch(err){
    storageDisponible = false;
    alert('No se pudo guardar en este navegador (puede estar en modo privado, sin espacio, o el sitio está bloqueando el almacenamiento local). Tus cambios se seguirán viendo en pantalla mientras no recargues la página, pero no quedarán guardados.');
  }
}

// Runs on every load (fresh install or existing data) to keep the data
// shape up to date. "Gasto Fijo de Monto Variable" and "Gasto Ocasional"
// are a Tipo de Gasto (a plain tag on the expense), not a Categoría — this
// pulls them out of data.categories if an earlier version put them there,
// and carries that classification over onto any expense that used them.
export function migrateData(){
  if(!Array.isArray(data.savingsGoals)) data.savingsGoals = [];
  if(!Array.isArray(data.debts)) data.debts = [];
  if(!Array.isArray(data.dailyExpenses)) data.dailyExpenses = [];
  if(typeof data.esDatosEjemplo !== 'boolean') data.esDatosEjemplo = false;
  if(!data.notifiedLog) data.notifiedLog = {};
  if(typeof data.perfilNombre !== 'string') data.perfilNombre = '';
  if(typeof data.indicadorExterno === 'undefined') data.indicadorExterno = null;
  if(typeof data.ultimaExportacion === 'undefined') data.ultimaExportacion = null;
  // Preferencia del toggle "Solo diarios / Todo el mes" de la barra de
  // categorías (§2.4): se guarda en los datos para que se recuerde entre
  // sesiones, a diferencia del filtro de categoría (ese sí vive solo en
  // `state`). Por defecto "todo": un gasto programado ya pagado es un gasto
  // real de este mes, así que cuenta desde el primer momento sin que haya
  // que ir a buscar el toggle para verlo reflejado.
  if(data.prefBarraAlcance !== 'diarios' && data.prefBarraAlcance !== 'todo') data.prefBarraAlcance = 'todo';
  // Categorías existentes (creadas antes de los gastos diarios) reciben los
  // campos nuevos: visibles en el registro rápido por defecto, sin presupuesto.
  data.categories.forEach(function(c){
    if(typeof c.mostrarEnDiario !== 'boolean') c.mostrarEnDiario = true;
    if(typeof c.presupuestoMensual === 'undefined') c.presupuestoMensual = null;
  });
  var nombresLower = TIPO_GASTO_NOMBRES.map(function(n){ return n.toLowerCase(); });
  var idsARemover = {};
  data.categories = data.categories.filter(function(c){
    var idx = nombresLower.indexOf(c.nombre.trim().toLowerCase());
    if(idx === -1) return true;
    idsARemover[c.id] = TIPO_GASTO_NOMBRES[idx];
    return false;
  });
  if(Object.keys(idsARemover).length){
    data.fixedExpenses.forEach(function(e){
      if(idsARemover[e.categoriaId]){ e.tipoGasto = idsARemover[e.categoriaId]; e.categoriaId = null; }
    });
    data.variableExpenses.forEach(function(e){
      if(idsARemover[e.categoriaId]){ e.tipoGasto = idsARemover[e.categoriaId]; e.categoriaId = null; }
    });
  }
}

// ---------- seed example data ----------
export function seedData(){
  var today = new Date(); today.setHours(0,0,0,0);

  var catVivienda = {id: uid('cat'), nombre:'Vivienda / Arriendo', color: CATEGORY_PALETTE[0]};
  var catServicios = {id: uid('cat'), nombre:'Servicios (luz, agua, internet)', color: CATEGORY_PALETTE[2]};
  var catProveedores = {id: uid('cat'), nombre:'Proveedores del negocio', color: CATEGORY_PALETTE[1]};

  var diaVencido = Math.max(1, today.getDate() - 1);
  var diaBueno = Math.min(28, today.getDate() + 5);
  var fechaVariable = new Date(today); fechaVariable.setDate(today.getDate() + 2);

  var inicioFijo1 = new Date(today.getFullYear(), today.getMonth() - 1, diaVencido);
  var inicioFijo2 = new Date(today.getFullYear(), today.getMonth() - 2, diaBueno);

  var fixedExpenses = [
    {
      id: uid('exp'), nombre:'Internet y telefonía del negocio', monto:180000,
      categoriaId: catServicios.id, ambito:'negocio', diaMes: diaVencido,
      fechaInicio: dateKey(inicioFijo1), activo:true, pagosPorMes:{}
    },
    {
      id: uid('exp'), nombre:'Arriendo del apartamento', monto:1500000,
      categoriaId: catVivienda.id, ambito:'personal', diaMes: diaBueno,
      fechaInicio: dateKey(inicioFijo2), activo:true, pagosPorMes:{}
    }
  ];
  var variableExpenses = [
    {
      id: uid('exp'), nombre:'Pago a proveedor de insumos', monto:620000,
      categoriaId: catProveedores.id, ambito:'negocio', fecha: dateKey(fechaVariable),
      pagado:false, fechaPago:null
    }
  ];

  return {
    categories: [catVivienda, catServicios, catProveedores],
    fixedExpenses: fixedExpenses,
    variableExpenses: variableExpenses,
    savingsGoals: [],
    debts: [],
    dailyExpenses: [],
    notifiedLog: {},
    esDatosEjemplo: true
  };
}

// Cualquier creación/edición real del usuario (gasto, meta, deuda o
// categoría) marca que los datos ya no son solo el ejemplo inicial —
// usado por el banner de "Estos son datos de ejemplo".
export function marcarDatosPropios(){
  if(data.esDatosEjemplo){ data.esDatosEjemplo = false; }
}
