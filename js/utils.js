// Constantes compartidas, fechas, moneda, escapeHtml, uid, toast, modal.
"use strict";

export var CATEGORY_PALETTE = ['#2f68cc','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
export var STATUS_COLORS = {good:'#1fa855', warning:'#e4a916', serious:'#e2794f', critical:'#e0514f'};
export var SAVINGS_COLOR = '#199e70';
export var RING_COLOR = '#34d399';
export var DEBT_COLOR = '#c9821a';
export var DEBT_TIPO_LABELS = {
  tarjeta: '💳 Tarjeta de crédito',
  credito: '🏦 Crédito de libre inversión',
  hipoteca: '🏠 Hipoteca / vivienda',
  vehiculo: '🚗 Vehículo',
  personal: '🤝 Préstamo personal',
  otro: '📌 Otro'
};
export var TIPO_GASTO_NOMBRES = ['Gasto Fijo de Monto Variable', 'Gasto Ocasional'];
export var DOW_LABELS = ['Lun','Mar','Mié','Jué','Vie','Sáb','Dom'];
export var MES_LABELS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

export var currency = new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0});
export var currencyDecimal = new Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', minimumFractionDigits:2, maximumFractionDigits:2});

export function uid(prefix){
  return (prefix||'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

// ---------- date helpers ----------
export function dateKey(d){
  var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
export function periodKey(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
export function parseDateLocal(str){
  var parts = str.split('-').map(Number);
  return new Date(parts[0], parts[1]-1, parts[2]);
}
export function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
export function startOfDay(d){ var n=new Date(d); n.setHours(0,0,0,0); return n; }
export function addDays(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }
export function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
export function startOfWeekMonday(d){
  var r = startOfDay(d);
  var dow = r.getDay(); // 0=Sun..6=Sat
  var diff = (dow===0) ? -6 : (1-dow);
  return addDays(r, diff);
}

export function fechaLarga(d){
  var dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  return dias[d.getDay()] + ' ' + d.getDate() + ' de ' + MES_LABELS[d.getMonth()];
}
export function fechaCorta(d){
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
}
export function formatFechaHoraCorta(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return iso;
  return fechaCorta(d) + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

export function normalizarTexto(s){
  return String(s||'').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]','g'),'').toLowerCase();
}

// ---------- modal / toast ----------
var modalTriggerEl = null;

function getFocusableEls(container){
  return Array.prototype.slice.call(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(function(el){ return el.offsetParent !== null; });
}

function handleModalKeydown(e){
  if(e.key === 'Escape'){
    e.preventDefault();
    closeModal();
    return;
  }
  if(e.key === 'Tab'){
    var focusable = getFocusableEls(document.getElementById('modalContent'));
    if(!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length-1];
    if(e.shiftKey && document.activeElement === first){
      e.preventDefault(); last.focus();
    } else if(!e.shiftKey && document.activeElement === last){
      e.preventDefault(); first.focus();
    }
  }
}

// Modal / hoja compartidos por toda la app: se cierran con Esc, atrapan el
// foco mientras están abiertos, y devuelven el foco al elemento que los
// abrió al cerrarse (accesibilidad — ver criterios de aceptación).
export function openModal(html){
  modalTriggerEl = document.activeElement;
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
  document.addEventListener('keydown', handleModalKeydown, true);
  var focusable = getFocusableEls(document.getElementById('modalContent'));
  if(focusable.length) focusable[0].focus();
}
export function closeModal(){
  document.getElementById('modalOverlay').classList.add('hidden');
  document.removeEventListener('keydown', handleModalKeydown, true);
  if(modalTriggerEl && typeof modalTriggerEl.focus === 'function' && document.contains(modalTriggerEl)){
    modalTriggerEl.focus();
  }
  modalTriggerEl = null;
}

var toastTimer;
export function showToast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
}

// Toast con una acción clicable (ej. "Deshacer"), visible por más tiempo.
export function showToastAccion(msg, accionLabel, onAccion, duracionMs){
  var t = document.getElementById('toast');
  t.innerHTML = escapeHtml(msg) + ' <button type="button" class="toast-accion" id="toastAccionBtn">' + escapeHtml(accionLabel) + '</button>';
  t.classList.add('show');
  clearTimeout(toastTimer);
  var usada = false;
  document.getElementById('toastAccionBtn').addEventListener('click', function(ev){
    ev.stopPropagation();
    if(usada) return;
    usada = true;
    clearTimeout(toastTimer);
    t.classList.remove('show');
    onAccion();
  });
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, duracionMs || 2200);
}
