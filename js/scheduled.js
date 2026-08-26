// Gastos programados (fijos y variables) y motor de ocurrencias compartido
// por Inicio, Programados, Ahorro y deudas, Categorías y Backup.
"use strict";

import {
  escapeHtml, currency, normalizarTexto, uid,
  dateKey, periodKey, parseDateLocal, daysInMonth, startOfDay, fechaLarga,
  showToast, openModal
} from './utils.js';
import { data, saveData, marcarDatosPropios } from './store.js';
import { getCategoria, catChipHtml, populateCategoriaSelect } from './categories.js';
import { fillAhorroFormForEdit } from './savings.js';
import { fillDeudaFormForEdit } from './debts.js';
import { switchTab, renderAll } from './app.js';

// ---------- monto for variable-amount fixed expenses ----------
// A fixed expense's `monto` is only the initial reference value. The real
// amount for each month is confirmed when it's marked as paid and stored
// in pagosPorMes[period].monto. Until confirmed, we show the most recent
// confirmed amount as an estimate (falling back to the reference value).
export function getMontoForPeriod(exp, pk){
  var info = exp.pagosPorMes[pk];
  if(info && info.pagado && typeof info.monto === 'number'){
    return {monto: info.monto, estimado:false};
  }
  var periods = Object.keys(exp.pagosPorMes).filter(function(p){
    var i = exp.pagosPorMes[p];
    return i && i.pagado && typeof i.monto === 'number' && p <= pk;
  });
  if(periods.length){
    periods.sort();
    return {monto: exp.pagosPorMes[periods[periods.length-1]].monto, estimado:true};
  }
  return {monto: exp.monto, estimado:true};
}
export function getLastKnownMonto(exp){
  return getMontoForPeriod(exp, '9999-99').monto;
}

// ---------- occurrence generation ----------
export function generateOccurrences(startDate, endDate){
  var occ = [];
  data.fixedExpenses.forEach(function(exp){
    if(!exp.activo) return;
    var inicio = exp.fechaInicio ? parseDateLocal(exp.fechaInicio) : null;
    var cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    var endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while(cursor <= endCursor){
      var y = cursor.getFullYear(), m = cursor.getMonth();
      var dim = daysInMonth(y,m);
      var day = Math.min(exp.diaMes, dim);
      var occDate = new Date(y,m,day);
      if(occDate >= startDate && occDate <= endDate && (!inicio || occDate >= inicio)){
        var pk = periodKey(occDate);
        var info = exp.pagosPorMes[pk];
        var mi = getMontoForPeriod(exp, pk);
        occ.push({
          occId: exp.id+'_'+pk, expenseId: exp.id, tipo:'fijo',
          nombre: exp.nombre, monto: mi.monto, estimado: mi.estimado, categoriaId: exp.categoriaId, ambito: exp.ambito,
          tipoGasto: exp.tipoGasto || '', fecha: occDate, pagado: !!(info && info.pagado), periodKey: pk
        });
      }
      cursor.setMonth(cursor.getMonth()+1);
    }
  });
  data.variableExpenses.forEach(function(exp){
    var d = parseDateLocal(exp.fecha);
    if(d >= startDate && d <= endDate){
      occ.push({
        occId: exp.id, expenseId: exp.id, tipo:'variable',
        nombre: exp.nombre, monto: exp.monto, estimado:false, categoriaId: exp.categoriaId, ambito: exp.ambito,
        tipoGasto: exp.tipoGasto || '', fecha: d, pagado: !!exp.pagado, periodKey: null
      });
    }
  });
  data.savingsGoals.forEach(function(goal){
    if(!goal.activo) return;
    var inicio = goal.fechaInicio ? parseDateLocal(goal.fechaInicio) : null;
    var cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    var endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while(cursor <= endCursor){
      var y2 = cursor.getFullYear(), m2 = cursor.getMonth();
      var dim2 = daysInMonth(y2,m2);
      var day2 = Math.min(goal.diaMes, dim2);
      var occDate2 = new Date(y2,m2,day2);
      if(occDate2 >= startDate && occDate2 <= endDate && (!inicio || occDate2 >= inicio)){
        var pk2 = periodKey(occDate2);
        var info2 = goal.pagosPorMes[pk2];
        occ.push({
          occId: goal.id+'_'+pk2, expenseId: goal.id, tipo:'ahorro',
          nombre: goal.nombre, monto: goal.montoMensual, estimado:false, categoriaId: null, ambito: 'ahorro',
          fecha: occDate2, pagado: !!(info2 && info2.pagado), periodKey: pk2
        });
      }
      cursor.setMonth(cursor.getMonth()+1);
    }
  });
  data.debts.forEach(function(debt){
    // Igual que fixedExpenses, pero una deuda saldada o inactiva no genera
    // ninguna ocurrencia (ni siquiera pasada): el extracto manda, y una
    // vez saldada no tiene sentido seguir mostrando cuotas en el calendario.
    if(!debt.activo || debt.saldoActual <= 0) return;
    var inicioD = debt.fechaInicio ? parseDateLocal(debt.fechaInicio) : null;
    var cursorD = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    var endCursorD = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while(cursorD <= endCursorD){
      var y3 = cursorD.getFullYear(), m3 = cursorD.getMonth();
      var dim3 = daysInMonth(y3,m3);
      var day3 = Math.min(debt.diaMes, dim3);
      var occDate3 = new Date(y3,m3,day3);
      if(occDate3 >= startDate && occDate3 <= endDate && (!inicioD || occDate3 >= inicioD)){
        var pk3 = periodKey(occDate3);
        var info3 = debt.pagosPorMes[pk3];
        occ.push({
          occId: debt.id+'_'+pk3, expenseId: debt.id, tipo:'deuda',
          nombre: debt.nombre, monto: debt.cuotaMensual, estimado:false, categoriaId: null, ambito: debt.ambito,
          fecha: occDate3, pagado: !!(info3 && info3.pagado), periodKey: pk3
        });
      }
      cursorD.setMonth(cursorD.getMonth()+1);
    }
  });
  occ.sort(function(a,b){ return a.fecha - b.fecha; });
  return occ;
}

// Returns the single "active" occurrence for a fixed expense: always the
// occurrence that falls in the CURRENT calendar month (paid or not). This
// avoids piling up every unpaid past month as separate overdue entries —
// once the month rolls over, that occurrence simply stops being active.
export function getActiveFixedOccurrence(exp, today){
  var y = today.getFullYear(), m = today.getMonth();
  var inicio = exp.fechaInicio ? parseDateLocal(exp.fechaInicio) : null;
  var dim = daysInMonth(y,m);
  var day = Math.min(exp.diaMes, dim);
  var occDate = new Date(y,m,day);
  if(inicio && occDate < inicio){
    // El primer pago todavía no llega este mes: en vez de no mostrar nada
    // (lo que hacía que un gasto fijo recién creado con fecha límite el
    // próximo mes no apareciera en Inicio ni en "Todos mis gastos", aunque
    // sí en el calendario), mostramos esa primera fecha futura.
    occDate = inicio;
  }
  var pk = periodKey(occDate);
  var info = exp.pagosPorMes[pk];
  var mi = getMontoForPeriod(exp, pk);
  return {
    occId: exp.id+'_'+pk, expenseId: exp.id, tipo:'fijo',
    nombre: exp.nombre, monto: mi.monto, estimado: mi.estimado, categoriaId: exp.categoriaId, ambito: exp.ambito,
    tipoGasto: exp.tipoGasto || '', fecha: occDate, pagado: !!(info && info.pagado), periodKey: pk
  };
}

// The "tracked" list used for the summary, reminders and the general
// expense list: one current occurrence per fixed expense, plus every
// variable expense (each only ever appears once, by nature).
export function getTrackedOccurrences(){
  var today = startOfDay(new Date());
  var list = [];
  data.fixedExpenses.forEach(function(exp){
    if(!exp.activo) return;
    var o = getActiveFixedOccurrence(exp, today);
    if(o) list.push(o);
  });
  data.variableExpenses.forEach(function(exp){
    var d = parseDateLocal(exp.fecha);
    list.push({
      occId: exp.id, expenseId: exp.id, tipo:'variable',
      nombre: exp.nombre, monto: exp.monto, estimado:false, categoriaId: exp.categoriaId, ambito: exp.ambito,
      tipoGasto: exp.tipoGasto || '', fecha: d, pagado: !!exp.pagado, periodKey: null
    });
  });
  list.sort(function(a,b){ return a.fecha - b.fecha; });
  return list;
}

export function statusOf(occ){
  var today = startOfDay(new Date());
  var dias = Math.round((startOfDay(occ.fecha) - today) / 86400000);
  if(occ.pagado) return {key:'pagado', label:'Pagado', dias:dias};
  if(dias < 0) return {key:'critical', label:'Vencido hace ' + (-dias) + ' día' + ((-dias)===1?'':'s'), dias:dias};
  if(dias <= 1) return {key:'serious', label: dias===0 ? 'Vence hoy' : 'Vence mañana', dias:dias};
  if(dias <= 3) return {key:'warning', label:'Vence en ' + dias + ' días', dias:dias};
  return {key:'good', label:'Vence en ' + dias + ' días', dias:dias};
}

export function ambitoBadgeHtml(ambito){
  if(ambito === 'ahorro') return '<span class="ambito-badge">🐷 Meta de ahorro</span>';
  return '<span class="ambito-badge">'+(ambito==='negocio' ? '🏢 Negocio' : '🏠 Personal')+'</span>';
}

export function occRowHtml(occ){
  var st = statusOf(occ);
  var esAhorro = occ.tipo === 'ahorro';
  var esDeuda = occ.tipo === 'deuda';
  var claseAccion = esAhorro ? ' btn-ahorro' : (esDeuda ? ' btn-deuda' : '');
  var claseSecundaria = esAhorro ? ' btn-ahorro-secondary' : (esDeuda ? ' btn-deuda-secondary' : '');
  var actionBtn;
  if(occ.pagado){
    actionBtn = '<button class="btn secondary small'+claseSecundaria+'" data-action="despagar" data-expid="'+occ.expenseId+'" data-tipo="'+occ.tipo+'" data-period="'+(occ.periodKey||'')+'">Deshacer</button>';
  } else if(occ.tipo === 'fijo'){
    actionBtn = '<button class="btn small'+claseAccion+'" data-action="abrir-pago-fijo" data-expid="'+occ.expenseId+'" data-period="'+(occ.periodKey||'')+'" data-monto="'+occ.monto+'" data-nombre="'+escapeHtml(occ.nombre)+'">Marcar pagado</button>';
  } else if(esDeuda){
    actionBtn = '<button class="btn small'+claseAccion+'" data-action="abrir-pago-deuda" data-expid="'+occ.expenseId+'">Registrar pago</button>';
  } else {
    actionBtn = '<button class="btn small'+claseAccion+'" data-action="pagar" data-expid="'+occ.expenseId+'" data-tipo="'+occ.tipo+'" data-period="'+(occ.periodKey||'')+'">Marcar pagado</button>';
  }
  var estimadoTag = (occ.estimado && !occ.pagado) ? ' <span class="estimado-tag">(estimado)</span>' : '';
  var catChip = esAhorro
    ? '<span class="cat-chip"><span class="cat-dot" style="background:#199e70"></span>Ahorro programado</span>'
    : esDeuda
      ? '<span class="cat-chip"><span class="cat-dot" style="background:#c9821a"></span>💳 Deuda</span>'
      : catChipHtml(occ.categoriaId);
  var tipoGastoChip = occ.tipoGasto
    ? '<span class="tipo-gasto-badge">'+(occ.tipoGasto==='Gasto Ocasional' ? '🎲 ' : '🧾 ')+escapeHtml(occ.tipoGasto)+'</span>'
    : '';
  return (
    '<div class="occ-row status-'+st.key+'">' +
      '<div class="occ-main">' +
        '<div class="occ-title">'+(esAhorro ? '🐷 ' : (esDeuda ? '💳 ' : ''))+escapeHtml(occ.nombre)+'</div>' +
        '<div class="occ-meta">'+catChip+ambitoBadgeHtml(occ.ambito)+tipoGastoChip+'<span>'+fechaLarga(occ.fecha)+'</span></div>' +
        '<div class="occ-status-label status-'+st.key+'">'+st.label+'</div>' +
      '</div>' +
      '<div class="occ-actions">' +
        '<div class="occ-amount">'+currency.format(occ.monto)+estimadoTag+'</div>' +
        '<div class="occ-actions-row">' +
          actionBtn +
          '<button class="btn secondary small'+claseSecundaria+'" data-action="editar" data-expid="'+occ.expenseId+'" data-tipo="'+occ.tipo+'" title="Editar">✎</button>' +
          '<button class="btn secondary small'+claseSecundaria+'" data-action="eliminar" data-expid="'+occ.expenseId+'" data-tipo="'+occ.tipo+'" title="Eliminar">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// ---------- GASTOS (formulario + listado) ----------
export function resetForm(){
  document.getElementById('formGasto').reset();
  document.getElementById('editId').value = '';
  document.getElementById('editTipoOriginal').value = '';
  document.getElementById('formTitulo').textContent = 'Agregar gasto';
  document.getElementById('btnGuardarGasto').textContent = 'Guardar gasto';
  document.getElementById('btnCancelarEdicion').classList.add('hidden');
  document.getElementById('fMasOpciones').open = false;
  document.getElementById('fFecha').value = dateKey(new Date());
  populateCategoriaSelect();
  updateFechaHint();
}

export function updateFechaHint(){
  var tipo = document.querySelector('input[name=fTipo]:checked').value;
  document.getElementById('fFechaHint').textContent = tipo === 'fijo'
    ? 'Este gasto se repetirá cada mes en este mismo día.'
    : 'Este gasto solo aplica para esta fecha y no se repetirá.';
  document.getElementById('fMontoHint').textContent = tipo === 'fijo'
    ? 'Este valor es solo de referencia. Si el monto cambia cada mes (como la factura de energía), podrás confirmarlo o ajustarlo cuando marques el pago.'
    : '';
}

export function fillFormForEdit(tipo, expId){
  if(tipo === 'ahorro'){ fillAhorroFormForEdit(expId); return; }
  if(tipo === 'deuda'){ fillDeudaFormForEdit(expId); return; }
  var exp;
  if(tipo === 'fijo'){
    exp = data.fixedExpenses.find(function(e){ return e.id===expId; });
  } else {
    exp = data.variableExpenses.find(function(e){ return e.id===expId; });
  }
  if(!exp) return;
  switchTab('gastos');
  populateCategoriaSelect();
  document.getElementById('editId').value = exp.id;
  document.getElementById('editTipoOriginal').value = tipo;
  document.getElementById('fNombre').value = exp.nombre;
  document.getElementById('fMonto').value = exp.monto;
  document.getElementById('fCategoria').value = exp.categoriaId;
  document.getElementById('fTipoGasto').value = exp.tipoGasto || '';
  document.querySelector('input[name=fAmbito][value="'+exp.ambito+'"]').checked = true;
  document.querySelector('input[name=fTipo][value="'+tipo+'"]').checked = true;
  // Si trae etiqueta adicional o ámbito negocio, abrimos "Más opciones"
  // para que el usuario vea esos valores sin tener que ir a buscarlos.
  document.getElementById('fMasOpciones').open = (!!exp.tipoGasto || exp.ambito === 'negocio');
  if(tipo === 'fijo'){
    var y = new Date().getFullYear(), m = new Date().getMonth();
    document.getElementById('fFecha').value = dateKey(new Date(y, m, Math.min(exp.diaMes, daysInMonth(y,m))));
  } else {
    document.getElementById('fFecha').value = exp.fecha;
  }
  updateFechaHint();
  document.getElementById('formTitulo').textContent = 'Editar gasto';
  document.getElementById('btnGuardarGasto').textContent = 'Actualizar gasto';
  document.getElementById('btnCancelarEdicion').classList.remove('hidden');
  document.getElementById('formGasto').scrollIntoView({behavior:'smooth', block:'start'});
}

export function handleFormGastoSubmit(e){
  e.preventDefault();
  if(data.categories.length === 0){
    showToast('Primero crea una categoría en la pestaña Categorías.');
    return;
  }
  var editId = document.getElementById('editId').value;
  var editTipoOriginal = document.getElementById('editTipoOriginal').value;
  var nombre = document.getElementById('fNombre').value.trim();
  var monto = Number(document.getElementById('fMonto').value);
  var categoriaId = document.getElementById('fCategoria').value;
  var tipoGasto = document.getElementById('fTipoGasto').value;
  var ambito = document.querySelector('input[name=fAmbito]:checked').value;
  var tipo = document.querySelector('input[name=fTipo]:checked').value;
  var fechaStr = document.getElementById('fFecha').value;
  if(!nombre){ alert('Falta el nombre del gasto. Escríbelo arriba y vuelve a dar clic en Guardar gasto.'); return; }
  if(!categoriaId){ alert('Elige una categoría para este gasto (puedes crear una nueva en la pestaña Categorías) y vuelve a guardar.'); return; }
  if(!fechaStr){ alert('Falta la fecha límite de pago. Selecciónala arriba y vuelve a guardar.'); return; }
  if(document.getElementById('fMonto').value === '' || isNaN(monto) || monto <= 0){
    alert('El monto a pagar debe ser un número mayor a cero. Corrígelo y vuelve a guardar.');
    return;
  }
  if(monto > 999999999999){
    alert('Ese monto parece demasiado alto (revisa que no sobren ceros). Corrígelo y vuelve a guardar.');
    return;
  }
  var fecha = parseDateLocal(fechaStr);

  if(editId && editTipoOriginal === tipo){
    // update in place, same type
    if(tipo === 'fijo'){
      var exp = data.fixedExpenses.find(function(x){ return x.id===editId; });
      exp.nombre = nombre; exp.monto = monto; exp.categoriaId = categoriaId; exp.ambito = ambito; exp.tipoGasto = tipoGasto;
      exp.diaMes = fecha.getDate();
    } else {
      var vexp = data.variableExpenses.find(function(x){ return x.id===editId; });
      vexp.nombre = nombre; vexp.monto = monto; vexp.categoriaId = categoriaId; vexp.ambito = ambito; vexp.tipoGasto = tipoGasto;
      vexp.fecha = fechaStr;
    }
    showToast('Gasto actualizado.');
  } else {
    if(editId && editTipoOriginal){
      // type changed while editing: remove the old one, create fresh
      removeExpense(editTipoOriginal, editId, true);
    }
    if(tipo === 'fijo'){
      data.fixedExpenses.push({
        id: uid('exp'), nombre: nombre, monto: monto, categoriaId: categoriaId, ambito: ambito, tipoGasto: tipoGasto,
        diaMes: fecha.getDate(), fechaInicio: fechaStr, activo:true, pagosPorMes:{}
      });
    } else {
      data.variableExpenses.push({
        id: uid('exp'), nombre: nombre, monto: monto, categoriaId: categoriaId, ambito: ambito, tipoGasto: tipoGasto,
        fecha: fechaStr, pagado:false, fechaPago:null
      });
    }
    showToast('Gasto guardado.');
  }
  marcarDatosPropios();
  saveData();
  resetForm();
  renderAll();
}

export function removeExpense(tipo, expId, silent){
  if(tipo === 'fijo'){
    data.fixedExpenses = data.fixedExpenses.filter(function(e){ return e.id!==expId; });
  } else if(tipo === 'ahorro'){
    data.savingsGoals = data.savingsGoals.filter(function(e){ return e.id!==expId; });
  } else if(tipo === 'deuda'){
    data.debts = data.debts.filter(function(d){ return d.id!==expId; });
  } else {
    data.variableExpenses = data.variableExpenses.filter(function(e){ return e.id!==expId; });
  }
  if(!silent) saveData();
}

// Elimina un gasto fijo o variable guardando antes una copia exacta, para
// poder restaurarlo con el "Deshacer" del toast.
export function eliminarConRespaldo(tipo, expId){
  var arr = tipo === 'fijo' ? data.fixedExpenses : data.variableExpenses;
  var obj = arr.find(function(e){ return e.id===expId; });
  if(!obj) return null;
  var copia = JSON.parse(JSON.stringify(obj));
  removeExpense(tipo, expId);
  return copia;
}

export function restaurarGastoEliminado(tipo, obj){
  if(tipo === 'fijo'){ data.fixedExpenses.push(obj); }
  else { data.variableExpenses.push(obj); }
  saveData();
  renderAll();
  showToast('Gasto restaurado.');
}

export function markPaidByIds(tipo, expId, period, paid, monto){
  if(tipo === 'fijo'){
    var exp = data.fixedExpenses.find(function(e){ return e.id===expId; });
    if(!exp) return;
    if(paid){
      var montoConfirmado = (typeof monto === 'number' && !isNaN(monto)) ? monto : getLastKnownMonto(exp);
      exp.pagosPorMes[period] = {pagado:true, fechaPago: dateKey(new Date()), monto: montoConfirmado};
    } else {
      var prev = exp.pagosPorMes[period] || {};
      exp.pagosPorMes[period] = {pagado:false, fechaPago:null, monto: prev.monto};
    }
  } else if(tipo === 'ahorro'){
    var goal = data.savingsGoals.find(function(g){ return g.id===expId; });
    if(!goal) return;
    if(paid){
      goal.pagosPorMes[period] = {pagado:true, fechaPago: dateKey(new Date()), monto: goal.montoMensual};
    } else {
      goal.pagosPorMes[period] = {pagado:false, fechaPago:null};
    }
  } else if(tipo === 'deuda'){
    var debtU = data.debts.find(function(d){ return d.id===expId; });
    if(!debtU) return;
    if(paid){
      // Las deudas siempre se pagan por el modal dedicado (que además
      // actualiza el saldo), así que este camino no debería usarse; lo
      // dejamos inofensivo por seguridad.
      return;
    } else {
      var prevD = debtU.pagosPorMes[period] || {};
      debtU.pagosPorMes[period] = {pagado:false, monto: prevD.monto, saldoDespues: prevD.saldoDespues};
    }
  } else {
    var vexp = data.variableExpenses.find(function(e){ return e.id===expId; });
    if(!vexp) return;
    vexp.pagado = paid;
    vexp.fechaPago = paid ? dateKey(new Date()) : null;
  }
  saveData();
  renderAll();
  showToast(paid ? 'Marcado como pagado.' : (tipo==='ahorro' ? 'Aporte marcado como pendiente.' : 'Marcado como pendiente.'));
}

export function abrirModalPagoFijo(expId, period, montoActual, nombre){
  var html =
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3>Confirmar pago</h3>' +
    '<p class="small muted">'+escapeHtml(nombre)+'</p>' +
    '<p class="small muted" style="margin-top:-4px;">Te preguntamos el monto porque las facturas pueden cambiar mes a mes.</p>' +
    '<div class="field">' +
      '<label for="confirmMontoInput">Monto pagado (COP)</label>' +
      '<input type="number" id="confirmMontoInput" min="0" step="1" value="'+montoActual+'">' +
      '<div class="hint">Si el valor de este mes es distinto (por ejemplo, cambió la factura de energía), ajústalo aquí antes de confirmar.</div>' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn" data-action="confirmar-pago-fijo" data-expid="'+expId+'" data-period="'+period+'">Confirmar pago</button>' +
      '<button class="btn secondary" data-action="cerrar-modal">Cancelar</button>' +
    '</div>';
  openModal(html);
}

export function updateFiltrosSummary(){
  var summary = document.getElementById('filtrosSummary');
  if(!summary) return;
  var count = ['listFiltroTipo','listFiltroCategoria','listFiltroTipoGasto','listFiltroAmbito','listFiltroEstado']
    .filter(function(id){ return document.getElementById(id).value !== ''; }).length;
  summary.textContent = count > 0 ? ('Filtros (' + count + ') ▾') : 'Filtros ▾';
}

export function renderListaGastos(){
  var fTipo = document.getElementById('listFiltroTipo').value;
  var fCat = document.getElementById('listFiltroCategoria').value;
  var fTipoGasto = document.getElementById('listFiltroTipoGasto').value;
  var fAmbito = document.getElementById('listFiltroAmbito').value;
  var fEstado = document.getElementById('listFiltroEstado').value;
  var busqueda = normalizarTexto(document.getElementById('listBusqueda').value.trim());

  updateFiltrosSummary();

  var todos = getTrackedOccurrences();
  var hayFiltrosActivos = !!(fTipo || fCat || fTipoGasto || fAmbito || fEstado || busqueda);

  var occs = todos.filter(function(o){
    if(fTipo && o.tipo !== fTipo) return false;
    if(fCat && o.categoriaId !== fCat) return false;
    if(fTipoGasto && o.tipoGasto !== fTipoGasto) return false;
    if(fAmbito && o.ambito !== fAmbito) return false;
    if(fEstado === 'pendiente' && o.pagado) return false;
    if(fEstado === 'pagado' && !o.pagado) return false;
    if(busqueda && normalizarTexto(o.nombre).indexOf(busqueda) === -1) return false;
    return true;
  });

  var vacioHtml;
  if(todos.length === 0){
    vacioHtml = '<div class="empty-state">🧾 Aún no has agregado ningún gasto.<br>Usa el formulario de arriba para registrar el primero.</div>';
  } else if(hayFiltrosActivos){
    vacioHtml = '<div class="empty-state">No hay gastos que coincidan con esos filtros.<br>Prueba con otra combinación.</div>';
  } else {
    vacioHtml = '<div class="empty-state">No hay gastos para mostrar.</div>';
  }

  document.getElementById('listaGastos').innerHTML = occs.length
    ? occs.map(occRowHtml).join('')
    : vacioHtml;
}
