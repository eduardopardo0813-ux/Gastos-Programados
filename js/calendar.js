// Calendario: vistas mensual y semanal de los gastos programados.
"use strict";

import {
  DOW_LABELS, MES_LABELS, SAVINGS_COLOR, DEBT_COLOR,
  dateKey, parseDateLocal, startOfDay, addDays, sameDay, startOfWeekMonday, fechaLarga, openModal
} from './utils.js';
import { state } from './store.js';
import { generateOccurrences, occRowHtml } from './scheduled.js';
import { getCategoria } from './categories.js';

export function currentFilters(){
  return {
    categoria: document.getElementById('calFiltroCategoria').value,
    ambito: document.getElementById('calFiltroAmbito').value
  };
}
export function applyFilters(occs, f){
  return occs.filter(function(o){
    if(f.categoria && o.categoriaId !== f.categoria) return false;
    if(f.ambito && o.ambito !== f.ambito) return false;
    return true;
  });
}

export function renderCalendario(){
  document.getElementById('btnVistaMes').classList.toggle('active', state.calView==='mes');
  document.getElementById('btnVistaSemana').classList.toggle('active', state.calView==='semana');
  if(state.calView === 'mes'){ renderCalendarioMes(); }
  else { renderCalendarioSemana(); }
}

export function renderCalendarioMes(){
  var anchor = state.calAnchor;
  var year = anchor.getFullYear(), month = anchor.getMonth();
  document.getElementById('calTitle').textContent = MES_LABELS[month] + ' ' + year;

  var firstOfMonth = new Date(year, month, 1);
  var gridStart = startOfWeekMonday(firstOfMonth);
  var lastOfMonth = new Date(year, month+1, 0);
  var gridEnd = startOfWeekMonday(lastOfMonth);
  gridEnd = addDays(gridEnd, 6);

  var occs = applyFilters(generateOccurrences(gridStart, gridEnd), currentFilters());
  var byDay = {};
  occs.forEach(function(o){
    var k = dateKey(o.fecha);
    (byDay[k] = byDay[k] || []).push(o);
  });

  var html = DOW_LABELS.map(function(d){ return '<div class="cal-dow">'+d+'</div>'; }).join('');
  var today = startOfDay(new Date());
  var cursor = gridStart;
  while(cursor <= gridEnd){
    var k = dateKey(cursor);
    var dayOccs = byDay[k] || [];
    var outside = cursor.getMonth() !== month;
    var isToday = sameDay(cursor, today);
    var dots = dayOccs.slice(0,4).map(function(o){
      var cat = getCategoria(o.categoriaId);
      var color = o.tipo === 'ahorro' ? SAVINGS_COLOR : (o.tipo === 'deuda' ? DEBT_COLOR : (cat ? cat.color : '#c3c2b7'));
      return '<span class="cal-dot" style="background:'+color+(o.pagado?';opacity:.35':'')+'"></span>';
    }).join('');
    var more = dayOccs.length > 4 ? '<span class="cal-more">+'+(dayOccs.length-4)+'</span>' : '';
    html += '<div class="cal-cell'+(outside?' outside':'')+(isToday?' today':'')+'" data-action="ver-dia" data-fecha="'+k+'">' +
              '<div class="daynum">'+cursor.getDate()+'</div>' +
              '<div class="cal-dots">'+dots+more+'</div>' +
            '</div>';
    cursor = addDays(cursor, 1);
  }
  document.getElementById('calBody').innerHTML = '<div class="cal-grid">'+html+'</div>';
}

export function renderCalendarioSemana(){
  var weekStart = startOfWeekMonday(state.calAnchor);
  var weekEnd = addDays(weekStart, 6);
  document.getElementById('calTitle').textContent =
    weekStart.getDate()+' '+MES_LABELS[weekStart.getMonth()].slice(0,3)+' — '+weekEnd.getDate()+' '+MES_LABELS[weekEnd.getMonth()].slice(0,3);

  var occs = applyFilters(generateOccurrences(weekStart, weekEnd), currentFilters());
  var byDay = {};
  occs.forEach(function(o){
    var k = dateKey(o.fecha);
    (byDay[k] = byDay[k] || []).push(o);
  });

  var today = startOfDay(new Date());
  var html = '';
  var cursor = weekStart;
  while(cursor <= weekEnd){
    var k = dateKey(cursor);
    var dayOccs = (byDay[k]||[]);
    var isToday = sameDay(cursor, today);
    html += '<div class="card week-day-card">' +
              '<div class="wd-header">' + fechaLarga(cursor) + (isToday ? ' · hoy' : '') + '</div>' +
              (dayOccs.length ? dayOccs.map(occRowHtml).join('') : '<div class="empty-state" style="padding:10px;">Sin pagos este día</div>') +
            '</div>';
    cursor = addDays(cursor, 1);
  }
  document.getElementById('calBody').innerHTML = html;
}

export function openDiaModal(fechaStr){
  var d = parseDateLocal(fechaStr);
  var occs = applyFilters(generateOccurrences(d, d), currentFilters());
  var html = '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3 style="text-transform:capitalize;">'+fechaLarga(d)+'</h3>' +
    (occs.length ? occs.map(occRowHtml).join('') : '<div class="empty-state">🎭 No hay pagos programados este día.</div>');
  openModal(html);
}
