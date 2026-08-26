// Ahorro programado: metas, aportes mensuales, abonos extra.
"use strict";

import {
  uid, escapeHtml, currency, RING_COLOR,
  dateKey, periodKey, parseDateLocal, daysInMonth, startOfDay,
  showToast, openModal
} from './utils.js';
import { data, saveData, marcarDatosPropios } from './store.js';
import { occRowHtml } from './scheduled.js';
import { switchTab, renderAll } from './app.js';

// Mirrors getActiveFixedOccurrence, for a savings goal's monthly contribution.
export function getActiveAhorroOccurrence(goal, today){
  if(!goal.activo) return null;
  var y = today.getFullYear(), m = today.getMonth();
  var inicio = goal.fechaInicio ? parseDateLocal(goal.fechaInicio) : null;
  var dim = daysInMonth(y,m);
  var day = Math.min(goal.diaMes, dim);
  var occDate = new Date(y,m,day);
  if(inicio && occDate < inicio){
    // El primer aporte todavía no llega este mes: en vez de no mostrar
    // nada (lo que hacía "desaparecer" la meta recién creada de Inicio),
    // mostramos esa primera fecha futura.
    occDate = inicio;
  }
  var pk = periodKey(occDate);
  var info = goal.pagosPorMes[pk];
  return {
    occId: goal.id+'_'+pk, expenseId: goal.id, tipo:'ahorro',
    nombre: goal.nombre, monto: goal.montoMensual, estimado:false, categoriaId: null, ambito: 'ahorro',
    fecha: occDate, pagado: !!(info && info.pagado), periodKey: pk
  };
}

// Current month's contribution for every savings goal — combined into el
// semáforo/recordatorios de Inicio junto con getTrackedOccurrences(), pero
// mantenido aparte para no tocar la lista de Programados (solo gastos).
export function getTrackedAhorroOccurrences(){
  var today = startOfDay(new Date());
  var list = [];
  data.savingsGoals.forEach(function(goal){
    var o = getActiveAhorroOccurrence(goal, today);
    if(o) list.push(o);
  });
  return list;
}

export function totalAhorradoDeMeta(goal){
  var total = 0;
  Object.keys(goal.pagosPorMes).forEach(function(pk){
    var info = goal.pagosPorMes[pk];
    if(info && info.pagado) total += (typeof info.monto === 'number' ? info.monto : goal.montoMensual);
  });
  return total;
}

// ---------- AHORRO PROGRAMADO ----------
export function resetFormAhorro(){
  document.getElementById('formAhorro').reset();
  document.getElementById('editAhorroId').value = '';
  document.getElementById('formAhorroTitulo').textContent = '🐷 Nueva meta de ahorro programado';
  document.getElementById('btnGuardarAhorro').textContent = '💾 Guardar meta';
  document.getElementById('btnCancelarEdicionAhorro').classList.add('hidden');
}

export function fillAhorroFormForEdit(goalId){
  var goal = data.savingsGoals.find(function(g){ return g.id===goalId; });
  if(!goal) return;
  switchTab('ahorro');
  document.getElementById('editAhorroId').value = goal.id;
  document.getElementById('ahNombre').value = goal.nombre;
  document.getElementById('ahMetaTotal').value = goal.metaTotal || 0;
  document.getElementById('ahMonto').value = goal.montoMensual;
  var y = new Date().getFullYear(), m = new Date().getMonth();
  document.getElementById('ahFecha').value = dateKey(new Date(y, m, Math.min(goal.diaMes, daysInMonth(y,m))));
  document.getElementById('formAhorroTitulo').textContent = 'Editar meta de ahorro';
  document.getElementById('btnGuardarAhorro').textContent = 'Actualizar meta';
  document.getElementById('btnCancelarEdicionAhorro').classList.remove('hidden');
  document.getElementById('formAhorro').scrollIntoView({behavior:'smooth', block:'start'});
}

export function handleFormAhorroSubmit(e){
  e.preventDefault();
  try{
    var editId = document.getElementById('editAhorroId').value;
    var nombre = document.getElementById('ahNombre').value.trim();
    var metaTotal = Number(document.getElementById('ahMetaTotal').value);
    var monto = Number(document.getElementById('ahMonto').value);
    var fechaStr = document.getElementById('ahFecha').value;

    // Explicit, visible validation — never fail silently on "Guardar meta".
    if(!nombre){ alert('Falta el nombre de la meta. Escríbelo arriba y vuelve a dar clic en Guardar meta.'); return; }
    if(document.getElementById('ahMetaTotal').value === '' || isNaN(metaTotal) || metaTotal <= 0){ alert('Falta la Meta total a ahorrar. Escribe un número mayor a cero y vuelve a dar clic en Guardar meta.'); return; }
    if(document.getElementById('ahMonto').value === '' || isNaN(monto) || monto <= 0){ alert('Falta el Monto a ahorrar cada mes. Escribe un número mayor a cero y vuelve a dar clic en Guardar meta.'); return; }
    if(!fechaStr){ alert('Falta la Fecha del próximo aporte. Selecciónala arriba y vuelve a dar clic en Guardar meta.'); return; }

    var fecha = parseDateLocal(fechaStr);
    if(editId){
      var goal = data.savingsGoals.find(function(g){ return g.id===editId; });
      if(goal){
        goal.nombre = nombre; goal.metaTotal = metaTotal; goal.montoMensual = monto; goal.diaMes = fecha.getDate();
      }
      showToast('✅ Meta de ahorro actualizada.');
    } else {
      data.savingsGoals.push({
        id: uid('ahorro'), nombre: nombre, metaTotal: metaTotal, montoMensual: monto,
        diaMes: fecha.getDate(), fechaInicio: fechaStr, activo:true, pagosPorMes:{}
      });
      showToast('✅ Meta de ahorro creada.');
    }
    marcarDatosPropios();
    saveData();
    resetFormAhorro();
    renderAll();
    // Hacer scroll es solo una mejora visual, no parte del guardado: si
    // falla (algunos navegadores/entornos no implementan scrollIntoView
    // con opciones), no debe verse como si la meta no se hubiera guardado.
    try{
      var lista = document.getElementById('listaAhorros');
      if(lista) lista.scrollIntoView({behavior:'smooth', block:'start'});
    }catch(scrollErr){ /* ignorar: el guardado ya fue exitoso */ }
  }catch(err){
    alert('Ocurrió un problema al guardar la meta: ' + err.message + '. Intenta de nuevo; si sigue fallando, recarga la página.');
  }
}

export function renderAhorros(){
  var today = startOfDay(new Date());
  var ringR = 30, ringC = 2 * Math.PI * ringR;
  var html = data.savingsGoals.map(function(goal){
    var totalAhorrado = totalAhorradoDeMeta(goal);
    var meta = goal.metaTotal || 0;
    var pctRaw = meta > 0 ? (totalAhorrado / meta * 100) : 0;
    var pctRing = Math.max(0, Math.min(100, pctRaw));
    var pctLabel = Math.round(pctRaw);
    var offset = ringC * (1 - pctRing / 100);
    var restante = Math.max(0, meta - totalAhorrado);
    var occ = getActiveAhorroOccurrence(goal, today);
    return '<div class="card" style="margin-bottom:10px;">' +
      '<div class="ahorro-card-top">' +
        '<svg class="ahorro-ring" width="76" height="76" viewBox="0 0 76 76">' +
          '<circle cx="38" cy="38" r="'+ringR+'" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="8"/>' +
          '<circle cx="38" cy="38" r="'+ringR+'" fill="none" stroke="'+RING_COLOR+'" stroke-width="8" stroke-linecap="round" ' +
            'stroke-dasharray="'+ringC.toFixed(1)+'" stroke-dashoffset="'+offset.toFixed(1)+'" transform="rotate(-90 38 38)"/>' +
          '<text x="38" y="43" text-anchor="middle" font-size="15" font-weight="700" fill="#ffffff">'+pctLabel+'%</text>' +
        '</svg>' +
        '<div class="ahorro-card-info">' +
          '<h3 style="margin:0 0 4px;">🐷 '+escapeHtml(goal.nombre)+'</h3>' +
          '<p class="small muted" style="margin:0;">Meta: <strong style="color:var(--text-primary)">'+currency.format(meta)+'</strong></p>' +
          '<p class="small muted" style="margin:2px 0 0;">Ahorrado: <strong style="color:'+RING_COLOR+'">'+currency.format(totalAhorrado)+'</strong> · Falta: '+currency.format(restante)+'</p>' +
        '</div>' +
      '</div>' +
      (occ ? occRowHtml(occ) : '') +
      '<div class="occ-actions-row" style="margin-top:8px;justify-content:flex-end;">' +
        '<button class="btn secondary small btn-ahorro-secondary" data-action="abrir-abono-extra" data-expid="'+goal.id+'">➕ Abono extra</button>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('listaAhorros').innerHTML = html || '<div class="empty-state">🐷 Aún no tienes metas de ahorro.<br>Crea la primera arriba y separa dinero para lo que quieres lograr.</div>';
}

export function abrirModalAbonoExtra(goalId){
  var goal = data.savingsGoals.find(function(g){ return g.id===goalId; });
  if(!goal) return;
  var html =
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3>➕ Abono extra — '+escapeHtml(goal.nombre)+'</h3>' +
    '<p class="small muted">Este abono se suma al aporte de este mes, además de lo ya registrado.</p>' +
    '<div class="field">' +
      '<label for="abonoExtraInput">Monto (COP)</label>' +
      '<input type="number" id="abonoExtraInput" min="0" step="1" placeholder="0">' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn btn-ahorro" data-action="confirmar-abono-extra" data-expid="'+goal.id+'">Guardar abono</button>' +
      '<button class="btn secondary" data-action="cerrar-modal">Cancelar</button>' +
    '</div>';
  openModal(html);
}

export function registrarAbonoExtra(goalId, monto){
  var goal = data.savingsGoals.find(function(g){ return g.id===goalId; });
  if(!goal) return;
  var today = startOfDay(new Date());
  var occ = getActiveAhorroOccurrence(goal, today);
  var pk = occ ? occ.periodKey : periodKey(today);
  var info = goal.pagosPorMes[pk];
  if(info && typeof info.monto === 'number'){
    info.monto += monto;
    info.pagado = true;
  } else {
    goal.pagosPorMes[pk] = {pagado:true, fechaPago: dateKey(new Date()), monto: monto};
  }
  saveData();
  renderAll();
  showToast('Abono registrado. 🐷');
}
