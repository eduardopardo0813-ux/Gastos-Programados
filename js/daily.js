// Gastos diarios: registro rápido, hoja de registro, últimos registros,
// vista completa del mes (§2 de arquitectura-v2-control-de-pagos.md).
"use strict";

import {
  uid, escapeHtml, currency, normalizarTexto, MES_LABELS,
  dateKey, parseDateLocal, startOfDay,
  showToast, showToastAccion, openModal, closeModal
} from './utils.js';
import { data, state, saveData, marcarDatosPropios } from './store.js';
import { getCategoria } from './categories.js';
import { renderAll } from './app.js';

function totalDiarioCategoriaMes(categoriaId, today){
  return data.dailyExpenses.filter(function(e){
    var f = parseDateLocal(e.fecha);
    return e.categoriaId === categoriaId && f.getMonth()===today.getMonth() && f.getFullYear()===today.getFullYear();
  }).reduce(function(s,e){ return s+e.monto; }, 0);
}

// Total de gastos diarios del mes, sin discriminar categoría — usado por
// la cifra "Gastado este mes" del resumen de Inicio (§3).
export function totalDiarioMes(today){
  return data.dailyExpenses.filter(function(e){
    var f = parseDateLocal(e.fecha);
    return f.getMonth()===today.getMonth() && f.getFullYear()===today.getFullYear();
  }).reduce(function(s,e){ return s+e.monto; }, 0);
}

// ---------- grilla de registro rápido (§2.2) ----------
export function renderGrillaRegistro(){
  var el = document.getElementById('dailyGrid');
  if(!el) return;
  var today = startOfDay(new Date());
  var visibles = data.categories.filter(function(c){ return c.mostrarEnDiario !== false; });
  if(visibles.length === 0){
    el.innerHTML =
      '<div class="empty-state">📋 Aún no tienes categorías para el registro diario.<br>Crea la primera y empieza a anotar lo que gastas.<br>' +
      '<button class="btn secondary small" data-action="ir-tab" data-tab="categorias" style="margin-top:8px;">Ir a Categorías</button></div>';
    return;
  }
  var html = visibles.map(function(c){
    var total = totalDiarioCategoriaMes(c.id, today);
    var presupuestoHtml = '';
    if(typeof c.presupuestoMensual === 'number' && c.presupuestoMensual > 0){
      var pct = total / c.presupuestoMensual * 100;
      var colorBarra = pct > 100 ? 'var(--critical)' : (pct >= 80 ? 'var(--warning)' : c.color);
      var textoBarra = pct > 100
        ? 'Te pasaste ' + currency.format(total - c.presupuestoMensual)
        : currency.format(total) + ' de ' + currency.format(c.presupuestoMensual);
      presupuestoHtml =
        '<div class="daily-cat-budget">' +
          '<div class="daily-cat-budget-track"><div class="daily-cat-budget-fill" style="width:'+Math.min(100,pct)+'%;background:'+colorBarra+';"></div></div>' +
          '<div class="daily-cat-budget-text">'+escapeHtml(textoBarra)+'</div>' +
        '</div>';
    }
    return '<button type="button" class="daily-cat-card" data-action="registro-diario" data-catid="'+c.id+'">' +
      '<span class="name"><span class="dot" style="background:'+c.color+'"></span>'+escapeHtml(c.nombre)+'</span>' +
      '<span class="total">'+currency.format(total)+'</span>' +
      presupuestoHtml +
    '</button>';
  }).join('');
  html += '<button type="button" class="daily-cat-card add-other" data-action="registro-diario-otra">➕ Otra categoría</button>';
  el.innerHTML = html;
}

// ---------- últimos registros (§2.5) ----------
function fechaRelativa(fecha, today){
  var dias = Math.round((startOfDay(fecha) - today) / 86400000);
  if(dias === 0) return 'Hoy';
  if(dias === -1) return 'Ayer';
  if(dias < -1) return 'hace ' + (-dias) + ' días';
  if(dias === 1) return 'Mañana';
  return 'en ' + dias + ' días';
}

function dailyRowHtml(entry){
  var today = startOfDay(new Date());
  var cat = getCategoria(entry.categoriaId);
  var color = cat ? cat.color : '#c3c2b7';
  var titulo = entry.nota ? entry.nota : (cat ? cat.nombre : 'Sin categoría');
  return '<div class="daily-row">' +
    '<span class="dot" style="background:'+color+'"></span>' +
    '<div class="info">' +
      '<div class="titulo">'+escapeHtml(titulo)+'</div>' +
      '<div class="fecha">'+fechaRelativa(parseDateLocal(entry.fecha), today)+'</div>' +
    '</div>' +
    '<div class="monto">'+currency.format(entry.monto)+'</div>' +
    '<div class="acciones">' +
      '<button class="btn secondary small" data-action="editar-diario" data-id="'+entry.id+'" title="Editar">✎</button>' +
      '<button class="btn secondary small" data-action="eliminar-diario" data-id="'+entry.id+'" title="Eliminar">🗑</button>' +
    '</div>' +
  '</div>';
}

export function renderUltimosRegistros(){
  var el = document.getElementById('dailyLista');
  if(!el) return;
  var today = startOfDay(new Date());
  var delMes = data.dailyExpenses.filter(function(e){
    var f = parseDateLocal(e.fecha);
    return f.getMonth()===today.getMonth() && f.getFullYear()===today.getFullYear();
  });

  // Filtro activo desde la barra de porcentajes por categoría (§2.4): al
  // tocar un segmento o su entrada en la leyenda, esta lista se acota a esa
  // categoría (o al grupo de categorías fusionadas en "Otros").
  var filtroHtml = '';
  if(state.dailyFiltroCategorias && state.dailyFiltroCategorias.length){
    var claves = state.dailyFiltroCategorias;
    delMes = delMes.filter(function(e){
      var key = e.categoriaId || '__sin_categoria';
      return claves.indexOf(key) !== -1;
    });
    filtroHtml = '<div class="daily-filtro-activo">Filtrado por: <strong>'+escapeHtml(state.dailyFiltroLabel || '')+'</strong> ' +
      '<button type="button" data-action="quitar-filtro-diario">✕ Quitar filtro</button></div>';
  }

  if(delMes.length === 0){
    el.innerHTML = filtroHtml + (state.dailyFiltroCategorias
      ? '<div class="empty-state">No hay gastos de esta categoría este mes.</div>'
      : '<div class="empty-state">📋 Aún no has registrado gastos este mes.<br>Toca una categoría de arriba para anotar el primero.</div>');
    return;
  }
  var ultimos = delMes.slice().sort(function(a,b){ return b.creadoEn - a.creadoEn; }).slice(0, 10);
  var html = filtroHtml + ultimos.map(dailyRowHtml).join('');
  html += '<div style="text-align:center;margin-top:10px;"><button type="button" class="btn ghost small" data-action="ver-todos-diario">Ver todos los gastos del mes →</button></div>';
  el.innerHTML = html;
}

export function renderDaily(){
  renderGrillaRegistro();
  renderUltimosRegistros();
  renderVistaCompletaLista();
}

// ---------- hoja de registro: flujo de 2 taps (§2.3) ----------
function formatMilesLive(raw){
  var digits = String(raw).replace(/\D/g,'');
  if(!digits) return '';
  return Number(digits).toLocaleString('es-CO');
}

function sheetHtml(opts){
  var editObj = opts.editId ? data.dailyExpenses.find(function(e){ return e.id===opts.editId; }) : null;
  var tituloAccion = editObj ? 'Editar gasto' : 'Nuevo gasto';
  var categoriaId = editObj ? editObj.categoriaId : (opts.categoriaId || '');
  var mostrarSelect = !categoriaId || !!editObj;
  var montoInicial = editObj ? formatMilesLive(String(editObj.monto)) : '';
  var notaInicial = editObj ? (editObj.nota || '') : '';
  var fechaInicial = editObj ? editObj.fecha : dateKey(new Date());
  var fechaEsHoy = fechaInicial === dateKey(new Date());
  var catActual = categoriaId ? getCategoria(categoriaId) : null;

  var headerHtml = mostrarSelect
    ? '<div class="field">' +
        '<label for="dailyCategoriaSelect">Categoría</label>' +
        '<select id="dailyCategoriaSelect">' +
          '<option value="">— Elige una categoría —</option>' +
          data.categories.map(function(c){
            return '<option value="'+c.id+'"'+(c.id===categoriaId?' selected':'')+'>'+escapeHtml(c.nombre)+'</option>';
          }).join('') +
        '</select>' +
      '</div>'
    : '<h3 style="margin:0 0 12px;display:flex;align-items:center;gap:8px;">' +
        '<span style="width:12px;height:12px;border-radius:50%;display:inline-block;background:'+(catActual?catActual.color:'#c3c2b7')+';"></span>' +
        escapeHtml(catActual ? catActual.nombre : '') +
      '</h3>';

  return (
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3 style="margin:0 0 10px;">'+tituloAccion+'</h3>' +
    '<form id="dailySheetForm">' +
      '<input type="hidden" id="dailyEditId" value="'+(editObj ? editObj.id : '')+'">' +
      '<input type="hidden" id="dailyCategoriaIdHidden" value="'+categoriaId+'">' +
      headerHtml +
      '<div class="field">' +
        '<label for="dailyMontoInput">Monto (COP)</label>' +
        '<input type="text" inputmode="numeric" id="dailyMontoInput" class="daily-monto-input" placeholder="0" value="'+montoInicial+'">' +
      '</div>' +
      '<div class="field">' +
        '<label for="dailyNotaInput">¿En qué? (opcional)</label>' +
        '<input type="text" id="dailyNotaInput" placeholder="Ej: Mercado, taxi, café..." value="'+escapeHtml(notaInicial)+'">' +
      '</div>' +
      '<div class="field">' +
        (fechaEsHoy ? '<button type="button" class="daily-fecha-toggle" id="dailyFechaToggle">Hoy ▾</button>' : '') +
        '<div id="dailyFechaWrap"'+(fechaEsHoy ? ' class="hidden"' : '')+'>' +
          '<label for="dailyFechaInput">Fecha</label>' +
          '<input type="date" id="dailyFechaInput" value="'+fechaInicial+'">' +
        '</div>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button type="submit" class="btn" id="dailySheetSubmitBtn">Guardar gasto</button>' +
        '<button type="button" class="btn secondary" data-action="cerrar-modal">Cancelar</button>' +
      '</div>' +
    '</form>'
  );
}

export function abrirHojaGastoDiario(opts){
  opts = opts || {};
  openModal(sheetHtml(opts));

  document.getElementById('dailySheetForm').addEventListener('submit', handleDailySheetSubmit);

  var montoInput = document.getElementById('dailyMontoInput');
  montoInput.addEventListener('input', function(){
    montoInput.value = formatMilesLive(montoInput.value);
  });
  // El campo de monto es el protagonista: recibe el foco (y el teclado
  // numérico en móvil) apenas se abre la hoja, sobre el foco por defecto
  // (primer elemento enfocable) que ya puso openModal().
  montoInput.focus();

  var toggleBtn = document.getElementById('dailyFechaToggle');
  if(toggleBtn){
    toggleBtn.addEventListener('click', function(){
      document.getElementById('dailyFechaWrap').classList.remove('hidden');
      toggleBtn.classList.add('hidden');
      document.getElementById('dailyFechaInput').focus();
    });
  }
}

function eliminarDailyPorId(id){
  data.dailyExpenses = data.dailyExpenses.filter(function(e){ return e.id !== id; });
  saveData();
}

// Validación + creación de un gasto diario, sin nada de UI: la reutilizan
// tanto la hoja de registro manual como el asistente de IA (chat.js), para
// que las dos vías respeten exactamente las mismas reglas. Devuelve
// {ok:false, mensaje} si algo no es válido, o {ok:true, entry} si se guardó.
export function registrarGastoDiario(categoriaId, monto, nota, fechaStr){
  if(!categoriaId){
    return {ok:false, mensaje:'Elige una categoría para este gasto.'};
  }
  if(monto === undefined || monto === null || monto === '' || isNaN(monto) || Number(monto) === 0){
    return {ok:false, mensaje:'Escribe cuánto gastaste para poder guardarlo.'};
  }
  monto = Number(monto);
  if(monto < 0){
    return {ok:false, mensaje:'El monto debe ser un número mayor a cero.'};
  }
  if(monto > 999999999){
    return {ok:false, mensaje:'Ese monto parece demasiado alto. Revisa que no sobren ceros.'};
  }
  var nuevo = {
    id: uid('daily'), categoriaId: categoriaId, monto: monto, nota: (nota||'').trim(),
    fecha: fechaStr || dateKey(new Date()), ambito: 'personal', creadoEn: Date.now()
  };
  data.dailyExpenses.push(nuevo);
  marcarDatosPropios();
  saveData();
  return {ok:true, entry: nuevo};
}

function handleDailySheetSubmit(e){
  e.preventDefault();
  var editId = document.getElementById('dailyEditId').value;
  var selectEl = document.getElementById('dailyCategoriaSelect');
  var categoriaId = selectEl ? selectEl.value : document.getElementById('dailyCategoriaIdHidden').value;
  var montoInput = document.getElementById('dailyMontoInput');
  var montoDigits = String(montoInput.value).replace(/\D/g,'');
  var monto = montoDigits ? Number(montoDigits) : NaN;
  var nota = document.getElementById('dailyNotaInput').value.trim();
  var fechaWrap = document.getElementById('dailyFechaWrap');
  var fechaInput = document.getElementById('dailyFechaInput');
  var fechaStr = (fechaWrap && !fechaWrap.classList.contains('hidden') && fechaInput.value)
    ? fechaInput.value
    : dateKey(new Date());

  if(editId){
    if(!categoriaId){ alert('Elige una categoría para este gasto.'); return; }
    if(!montoDigits || monto === 0){ alert('Escribe cuánto gastaste para poder guardarlo.'); return; }
    if(isNaN(monto) || monto < 0){ alert('El monto debe ser un número mayor a cero.'); return; }
    if(monto > 999999999){ alert('Ese monto parece demasiado alto. Revisa que no sobren ceros.'); return; }
    var entry = data.dailyExpenses.find(function(x){ return x.id===editId; });
    if(entry){
      entry.categoriaId = categoriaId;
      entry.monto = monto;
      entry.nota = nota;
      entry.fecha = fechaStr;
    }
    marcarDatosPropios();
    saveData();
    closeModal();
    renderAll();
    showToast('Gasto actualizado.');
    return;
  }

  var res = registrarGastoDiario(categoriaId, monto, nota, fechaStr);
  if(!res.ok){
    alert(res.mensaje);
    return;
  }
  var cat = getCategoria(categoriaId);
  var catNombre = cat ? cat.nombre : 'esa categoría';
  closeModal();
  renderAll();
  showToastAccion('Gasto registrado · ' + currency.format(res.entry.monto) + ' en ' + catNombre, 'Deshacer (6s)', function(){
    eliminarDailyPorId(res.entry.id);
    renderAll();
    showToast('Registro deshecho.');
  }, 6000);
}

// ---------- eliminar / deshacer desde la lista (§2.5) ----------
export function eliminarDailyConRespaldo(id){
  var obj = data.dailyExpenses.find(function(e){ return e.id===id; });
  if(!obj) return null;
  var copia = JSON.parse(JSON.stringify(obj));
  eliminarDailyPorId(id);
  return copia;
}

export function restaurarDailyEliminado(obj){
  data.dailyExpenses.push(obj);
  saveData();
  renderAll();
  showToast('Gasto restaurado.');
}

// ---------- vista completa "todos los gastos del mes" (§2.5) ----------
function currentMonthRange(today){
  var start = new Date(today.getFullYear(), today.getMonth(), 1);
  var end = new Date(today.getFullYear(), today.getMonth()+1, 0);
  return {start: dateKey(start), end: dateKey(end)};
}

export function abrirVistaCompletaMesDiario(){
  var today = startOfDay(new Date());
  var mesLabel = MES_LABELS[today.getMonth()] + ' ' + today.getFullYear();
  var range = currentMonthRange(today);
  var html =
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3 style="margin:0 0 10px;text-transform:capitalize;">Gastos diarios de '+mesLabel+'</h3>' +
    '<input type="text" id="vistaCompletaBusqueda" placeholder="🔍 Buscar por nota o categoría..." style="margin-bottom:10px;">' +
    '<div class="filters">' +
      '<select id="vistaCompletaCategoria"><option value="">Todas las categorías</option>' +
        data.categories.map(function(c){ return '<option value="'+c.id+'">'+escapeHtml(c.nombre)+'</option>'; }).join('') +
      '</select>' +
      '<input type="date" id="vistaCompletaDesde" value="'+range.start+'">' +
      '<input type="date" id="vistaCompletaHasta" value="'+range.end+'">' +
    '</div>' +
    '<div id="vistaCompletaDiarioLista"></div>';
  openModal(html);
  ['vistaCompletaBusqueda','vistaCompletaCategoria','vistaCompletaDesde','vistaCompletaHasta'].forEach(function(id){
    var el = document.getElementById(id);
    el.addEventListener(id === 'vistaCompletaBusqueda' ? 'input' : 'change', renderVistaCompletaLista);
  });
  renderVistaCompletaLista();
}

function renderVistaCompletaLista(){
  var cont = document.getElementById('vistaCompletaDiarioLista');
  if(!cont) return; // la vista completa no está abierta ahora mismo
  var busquedaEl = document.getElementById('vistaCompletaBusqueda');
  var catEl = document.getElementById('vistaCompletaCategoria');
  var desdeEl = document.getElementById('vistaCompletaDesde');
  var hastaEl = document.getElementById('vistaCompletaHasta');
  var busqueda = normalizarTexto(busquedaEl ? busquedaEl.value.trim() : '');
  var catFiltro = catEl ? catEl.value : '';
  var desde = desdeEl && desdeEl.value ? desdeEl.value : null;
  var hasta = hastaEl && hastaEl.value ? hastaEl.value : null;

  var lista = data.dailyExpenses.filter(function(e){
    if(catFiltro && e.categoriaId !== catFiltro) return false;
    if(desde && e.fecha < desde) return false;
    if(hasta && e.fecha > hasta) return false;
    if(busqueda){
      var cat = getCategoria(e.categoriaId);
      var texto = normalizarTexto((e.nota||'') + ' ' + (cat ? cat.nombre : ''));
      if(texto.indexOf(busqueda) === -1) return false;
    }
    return true;
  }).sort(function(a,b){ return b.creadoEn - a.creadoEn; });

  cont.innerHTML = lista.length
    ? lista.map(dailyRowHtml).join('')
    : '<div class="empty-state">No hay gastos que coincidan con esos filtros.</div>';
}
