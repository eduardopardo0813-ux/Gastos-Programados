// Deudas: registro de saldo/cuota, sin cálculo de intereses ni amortización.
"use strict";

import {
  uid, escapeHtml, currency, DEBT_TIPO_LABELS,
  dateKey, periodKey, parseDateLocal, daysInMonth, startOfDay,
  showToast, openModal
} from './utils.js';
import { data, saveData, marcarDatosPropios } from './store.js';
import { switchTab, renderAll } from './app.js';

// Mirrors getActiveFixedOccurrence, para la cuota mensual de una deuda.
// Una deuda saldada (saldoActual === 0) o inactiva no genera ocurrencia:
// ya no debe aparecer en semáforo, recordatorios ni stat-tiles.
export function getActiveDebtOccurrence(debt, today){
  if(!debt.activo || debt.saldoActual <= 0) return null;
  var y = today.getFullYear(), m = today.getMonth();
  var inicio = debt.fechaInicio ? parseDateLocal(debt.fechaInicio) : null;
  var dim = daysInMonth(y,m);
  var day = Math.min(debt.diaMes, dim);
  var occDate = new Date(y,m,day);
  if(inicio && occDate < inicio){
    // La primera cuota todavía no llega este mes: mostramos esa primera
    // fecha futura en vez de no mostrar nada (mismo criterio que fijos).
    occDate = inicio;
  }
  var pk = periodKey(occDate);
  var info = debt.pagosPorMes[pk];
  return {
    occId: debt.id+'_'+pk, expenseId: debt.id, tipo:'deuda',
    nombre: debt.nombre, monto: debt.cuotaMensual, estimado:false, categoriaId: null, ambito: debt.ambito,
    fecha: occDate, pagado: !!(info && info.pagado), periodKey: pk
  };
}

// Cuota del mes actual de cada deuda activa y no saldada — se combina en
// Inicio (semáforo/recordatorios/stat-tiles) igual que las metas de ahorro.
export function getTrackedDebtOccurrences(){
  var today = startOfDay(new Date());
  var list = [];
  data.debts.forEach(function(debt){
    var o = getActiveDebtOccurrence(debt, today);
    if(o) list.push(o);
  });
  return list;
}

export function debtTipoLabel(tipo){
  return DEBT_TIPO_LABELS[tipo] || DEBT_TIPO_LABELS.otro;
}

// ---------- DEUDAS ----------
export function resetFormDeuda(){
  document.getElementById('formDeuda').reset();
  document.getElementById('editDeudaId').value = '';
  document.getElementById('formDeudaTitulo').textContent = '💳 Nueva deuda';
  document.getElementById('btnGuardarDeuda').textContent = '💾 Guardar deuda';
  document.getElementById('btnCancelarEdicionDeuda').classList.add('hidden');
  document.getElementById('dMasOpciones').open = false;
  document.getElementById('dFecha').value = dateKey(new Date());
}

export function fillDeudaFormForEdit(debtId){
  var debt = data.debts.find(function(d){ return d.id===debtId; });
  if(!debt) return;
  switchTab('deudas');
  document.getElementById('editDeudaId').value = debt.id;
  document.getElementById('dNombre').value = debt.nombre;
  document.getElementById('dTipo').value = debt.tipo;
  document.getElementById('dSaldoActual').value = debt.saldoActual;
  document.getElementById('dCuotaMensual').value = debt.cuotaMensual;
  var y = new Date().getFullYear(), m = new Date().getMonth();
  document.getElementById('dFecha').value = dateKey(new Date(y, m, Math.min(debt.diaMes, daysInMonth(y,m))));
  document.querySelector('input[name=dAmbito][value="'+debt.ambito+'"]').checked = true;
  document.getElementById('dTasaInfo').value = debt.tasaInfo || '';
  // Igual que con gastos: si trae ámbito negocio o tasa/condiciones, abrimos
  // "Más opciones" para que el usuario vea esos valores sin tener que buscarlos.
  document.getElementById('dMasOpciones').open = (debt.ambito === 'negocio' || !!debt.tasaInfo);
  document.getElementById('formDeudaTitulo').textContent = 'Editar deuda';
  document.getElementById('btnGuardarDeuda').textContent = 'Actualizar deuda';
  document.getElementById('btnCancelarEdicionDeuda').classList.remove('hidden');
  document.getElementById('formDeuda').scrollIntoView({behavior:'smooth', block:'start'});
}

export function handleFormDeudaSubmit(e){
  e.preventDefault();
  var editId = document.getElementById('editDeudaId').value;
  var nombre = document.getElementById('dNombre').value.trim();
  var tipo = document.getElementById('dTipo').value;
  var saldoActual = Number(document.getElementById('dSaldoActual').value);
  var cuotaMensual = Number(document.getElementById('dCuotaMensual').value);
  var fechaStr = document.getElementById('dFecha').value;
  var ambito = document.querySelector('input[name=dAmbito]:checked').value;
  var tasaInfo = document.getElementById('dTasaInfo').value.trim();

  if(!nombre){ alert('Falta el nombre de la deuda. Escríbelo arriba y vuelve a dar clic en Guardar deuda.'); return; }
  if(document.getElementById('dSaldoActual').value === '' || isNaN(saldoActual) || saldoActual <= 0){
    alert('El saldo actual de la deuda debe ser un número mayor a cero. Corrígelo y vuelve a guardar.');
    return;
  }
  if(document.getElementById('dCuotaMensual').value === '' || isNaN(cuotaMensual) || cuotaMensual <= 0){
    alert('La cuota mensual debe ser un número mayor a cero. Corrígela y vuelve a guardar.');
    return;
  }
  if(cuotaMensual > saldoActual){
    alert('La cuota mensual no puede ser mayor que el saldo de la deuda. Revisa los dos montos.');
    return;
  }
  if(!fechaStr){ alert('Falta el día de vencimiento de la cuota. Selecciónalo arriba y vuelve a guardar.'); return; }

  var fecha = parseDateLocal(fechaStr);

  if(editId){
    var debt = data.debts.find(function(d){ return d.id===editId; });
    if(debt){
      debt.nombre = nombre; debt.tipo = tipo; debt.cuotaMensual = cuotaMensual;
      debt.diaMes = fecha.getDate(); debt.ambito = ambito; debt.tasaInfo = tasaInfo;
      debt.saldoActual = saldoActual;
      // Si el usuario sube el saldo manualmente por encima del inicial (ej.
      // corrigió un error de captura), el % de avance se recalcula sobre esa base.
      if(saldoActual > debt.saldoInicial) debt.saldoInicial = saldoActual;
    }
    showToast('Deuda actualizada.');
  } else {
    data.debts.push({
      id: uid('debt'), nombre: nombre, tipo: tipo, saldoInicial: saldoActual, saldoActual: saldoActual,
      cuotaMensual: cuotaMensual, diaMes: fecha.getDate(), tasaInfo: tasaInfo, ambito: ambito,
      activo: true, fechaInicio: fechaStr, pagosPorMes: {}
    });
    showToast('Deuda creada.');
  }
  marcarDatosPropios();
  saveData();
  resetFormDeuda();
  renderAll();
}

export function renderDeudas(){
  var html = data.debts.map(function(debt){
    var saldada = debt.saldoActual <= 0;
    var pctPagado = debt.saldoInicial > 0 ? Math.max(0, Math.min(100, (1 - debt.saldoActual/debt.saldoInicial)*100)) : 0;
    var bajado = Math.max(0, debt.saldoInicial - debt.saldoActual);
    var tasaHtml = debt.tasaInfo ? '<p class="small muted" style="margin:4px 0 0;">'+escapeHtml(debt.tasaInfo)+'</p>' : '';
    var estadoHtml = saldada
      ? '<span class="deuda-badge-saldada">✔ Saldada</span>'
      : (
          '<div class="deuda-progress-track"><div class="deuda-progress-fill" style="width:'+pctPagado.toFixed(1)+'%"></div></div>' +
          '<p class="small muted" style="margin:4px 0 0;">Has bajado '+currency.format(bajado)+' de '+currency.format(debt.saldoInicial)+' ('+Math.round(pctPagado)+'%)</p>'
        );
    var accionesHtml = saldada
      ? ''
      : '<button class="btn small btn-deuda" data-action="abrir-pago-deuda" data-expid="'+debt.id+'">Registrar pago de cuota</button>';
    return '<div class="card" style="margin-bottom:10px;">' +
      '<h3 style="margin:0 0 4px;">'+escapeHtml(debt.nombre)+' <span class="ambito-badge">'+debtTipoLabel(debt.tipo)+'</span></h3>' +
      '<div class="occ-amount" style="font-size:1.3rem;">'+currency.format(debt.saldoActual)+'</div>' +
      estadoHtml + tasaHtml +
      '<p class="small muted" style="margin:6px 0 0;">Cuota: <strong style="color:var(--text-primary)">'+currency.format(debt.cuotaMensual)+'</strong> · Vence el día '+debt.diaMes+' · '+(debt.ambito==='negocio'?'🏢 Negocio':'🏠 Personal')+'</p>' +
      '<div class="occ-actions-row" style="margin-top:10px;justify-content:flex-end;">' +
        accionesHtml +
        '<button class="btn secondary small btn-deuda-secondary" data-action="editar" data-tipo="deuda" data-expid="'+debt.id+'" title="Editar">✎</button>' +
        '<button class="btn secondary small btn-deuda-secondary" data-action="eliminar" data-tipo="deuda" data-expid="'+debt.id+'" title="Eliminar">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('listaDeudas').innerHTML = html || '<div class="empty-state">💳 Aún no tienes deudas registradas.<br>Si tienes créditos o tarjetas, regístralos aquí para ver cuánto te falta y celebrar cada avance.</div>';
}

export function abrirModalPagoDeuda(debtId){
  var debt = data.debts.find(function(d){ return d.id===debtId; });
  if(!debt) return;
  var montoSugerido = Math.min(debt.cuotaMensual, debt.saldoActual);
  var saldoSugerido = Math.max(0, debt.saldoActual - montoSugerido);
  var html =
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3>Registrar pago — '+escapeHtml(debt.nombre)+'</h3>' +
    '<div class="field">' +
      '<label for="deudaMontoInput">Monto pagado (COP)</label>' +
      '<input type="number" id="deudaMontoInput" min="0" step="1" value="'+montoSugerido+'">' +
    '</div>' +
    '<div class="field">' +
      '<label for="deudaSaldoInput">Nuevo saldo de la deuda (COP)</label>' +
      '<input type="number" id="deudaSaldoInput" min="0" step="1" value="'+saldoSugerido+'">' +
      '<div class="hint">Ajústalo según el extracto de tu banco: por intereses y seguros el saldo real puede ser distinto.</div>' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn btn-deuda" data-action="confirmar-pago-deuda" data-expid="'+debt.id+'">Confirmar pago</button>' +
      '<button class="btn secondary" data-action="cerrar-modal">Cancelar</button>' +
    '</div>';
  openModal(html);
  var montoInput = document.getElementById('deudaMontoInput');
  montoInput.addEventListener('input', function(){
    var m = Number(montoInput.value);
    if(isNaN(m)) m = 0;
    document.getElementById('deudaSaldoInput').value = Math.max(0, debt.saldoActual - m);
  });
}

export function registrarPagoDeuda(debtId, monto, nuevoSaldo){
  var debt = data.debts.find(function(d){ return d.id===debtId; });
  if(!debt) return;
  var today = startOfDay(new Date());
  var occ = getActiveDebtOccurrence(debt, today);
  var pk = occ ? occ.periodKey : periodKey(today);
  debt.pagosPorMes[pk] = {pagado:true, monto: monto, saldoDespues: nuevoSaldo};
  debt.saldoActual = nuevoSaldo;
  saveData();
  renderAll();
  if(nuevoSaldo <= 0){
    showToast('🎉 ¡Deuda saldada! Felicitaciones.');
  } else {
    showToast('Pago registrado. ¡Un paso menos! 💪');
  }
}
