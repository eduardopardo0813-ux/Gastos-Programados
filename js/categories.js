// Categorías: gestión, totales por categoría, presupuestos.
"use strict";

import { escapeHtml, currency, CATEGORY_PALETTE, uid, startOfDay, parseDateLocal, openModal, showToast } from './utils.js';
import { data, saveData, marcarDatosPropios } from './store.js';
import { getTrackedOccurrences } from './scheduled.js';
import { renderAll } from './app.js';

export function nextCategoryColor(){
  var used = data.categories.length;
  return CATEGORY_PALETTE[used % CATEGORY_PALETTE.length];
}

export function getCategoria(id){
  return data.categories.find(function(c){ return c.id===id; });
}

export function catChipHtml(categoriaId){
  var cat = getCategoria(categoriaId);
  if(!cat) return '<span class="cat-chip"><span class="cat-dot" style="background:#c3c2b7"></span>Sin categoría</span>';
  return '<span class="cat-chip"><span class="cat-dot" style="background:'+cat.color+'"></span>'+escapeHtml(cat.nombre)+'</span>';
}

export function populateCategoriaFilters(){
  var selects = [document.getElementById('calFiltroCategoria'), document.getElementById('listFiltroCategoria')];
  selects.forEach(function(sel){
    var current = sel.value;
    var opts = '<option value="">Todas las categorías</option>' + data.categories.map(function(c){
      return '<option value="'+c.id+'">'+escapeHtml(c.nombre)+'</option>';
    }).join('');
    sel.innerHTML = opts;
    sel.value = current;
  });
}

export function populateCategoriaSelect(){
  var sel = document.getElementById('fCategoria');
  if(data.categories.length === 0){
    sel.innerHTML = '<option value="">Primero crea una categoría</option>';
    return;
  }
  sel.innerHTML = data.categories.map(function(c){
    return '<option value="'+c.id+'">'+escapeHtml(c.nombre)+'</option>';
  }).join('');
}

// Totales por categoría, diarios y programados diferenciados (§6 Fase D),
// más el estado del presupuesto mensual si la categoría tiene uno definido (§2.6).
export function renderCategorias(){
  document.getElementById('catColor').value = document.getElementById('catColor').value || nextCategoryColor();
  var today = startOfDay(new Date());
  var occsMes = getTrackedOccurrences().filter(function(o){
    return o.fecha.getMonth()===today.getMonth() && o.fecha.getFullYear()===today.getFullYear();
  });
  var html = data.categories.map(function(c){
    var countProgramados = data.fixedExpenses.filter(function(e){ return e.categoriaId===c.id; }).length +
                data.variableExpenses.filter(function(e){ return e.categoriaId===c.id; }).length;
    var totalProgramadoMes = occsMes.filter(function(o){ return o.categoriaId===c.id; }).reduce(function(s,o){ return s+o.monto; },0);

    var diariosCat = data.dailyExpenses.filter(function(e){
      if(e.categoriaId !== c.id) return false;
      var f = parseDateLocal(e.fecha);
      return f.getMonth()===today.getMonth() && f.getFullYear()===today.getFullYear();
    });
    var totalDiarioMesCat = diariosCat.reduce(function(s,e){ return s+e.monto; }, 0);

    var presupuestoHtml;
    if(typeof c.presupuestoMensual === 'number' && c.presupuestoMensual > 0){
      var excesoTxt = totalDiarioMesCat > c.presupuestoMensual
        ? ' — te pasaste ' + currency.format(totalDiarioMesCat - c.presupuestoMensual)
        : '';
      presupuestoHtml = '<div class="cat-presupuesto">Presupuesto: '+currency.format(totalDiarioMesCat)+' de '+currency.format(c.presupuestoMensual)+excesoTxt+'</div>';
    } else {
      presupuestoHtml = '<div class="cat-presupuesto muted">Sin presupuesto mensual definido</div>';
    }

    return '<div class="cat-row">' +
            '<span class="cat-swatch" style="background:'+c.color+'"></span>' +
            '<div class="cat-info">' +
              '<div class="name">'+escapeHtml(c.nombre)+'</div>' +
              '<div class="cat-meta">'+countProgramados+' gasto'+(countProgramados===1?'':'s')+' programado'+(countProgramados===1?'':'s')+' · '+currency.format(totalProgramadoMes)+' este mes</div>' +
              '<div class="cat-meta">'+diariosCat.length+' registro'+(diariosCat.length===1?'':'s')+' diario'+(diariosCat.length===1?'':'s')+' · '+currency.format(totalDiarioMesCat)+' este mes</div>' +
              presupuestoHtml +
            '</div>' +
            '<div class="cat-row-actions">' +
              '<button class="btn secondary small" data-action="editar-categoria" data-id="'+c.id+'" title="Editar nombre y color">✎</button>' +
              '<button class="btn secondary small" data-action="editar-presupuesto-categoria" data-id="'+c.id+'" title="Presupuesto mensual">💰</button>' +
              '<button class="btn secondary small" data-action="eliminar-categoria" data-id="'+c.id+'" title="Eliminar">🗑</button>' +
            '</div>' +
          '</div>';
  }).join('');
  document.getElementById('listaCategorias').innerHTML = html || '<div class="empty-state">🏷️ Aún no tienes categorías.<br>Crea la primera arriba para poder registrar tus gastos.</div>';
}

export function abrirModalPresupuestoCategoria(catId){
  var cat = getCategoria(catId);
  if(!cat) return;
  var valorActual = (typeof cat.presupuestoMensual === 'number' && cat.presupuestoMensual > 0) ? cat.presupuestoMensual : '';
  var html =
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3>Presupuesto mensual — '+escapeHtml(cat.nombre)+'</h3>' +
    '<p class="small muted" style="margin-top:-4px;">Se compara contra lo que registres en el diario para esta categoría cada mes. Déjalo vacío si no quieres llevar presupuesto.</p>' +
    '<div class="field">' +
      '<label for="presupuestoInput">Presupuesto mensual (COP)</label>' +
      '<input type="number" id="presupuestoInput" min="0" step="1" placeholder="Sin presupuesto" value="'+valorActual+'">' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn" data-action="confirmar-presupuesto-categoria" data-id="'+catId+'">Guardar</button>' +
      '<button class="btn secondary" data-action="cerrar-modal">Cancelar</button>' +
    '</div>';
  openModal(html);
}

// Devuelve true si se guardó (para que quien la llama cierre el modal), o
// false si la validación falló y el modal debe seguir abierto.
export function guardarPresupuestoCategoria(catId, valorStr){
  var cat = getCategoria(catId);
  if(!cat) return false;
  var trimmed = String(valorStr||'').trim();
  var nuevoValor = null;
  if(trimmed !== ''){
    var num = Number(trimmed);
    if(isNaN(num) || num < 0){
      alert('El presupuesto debe ser un número mayor o igual a cero, o dejarlo vacío para quitarlo.');
      return false;
    }
    nuevoValor = num > 0 ? num : null;
  }
  cat.presupuestoMensual = nuevoValor;
  saveData();
  renderAll();
  showToast(nuevoValor ? 'Presupuesto guardado.' : 'Presupuesto quitado.');
  return true;
}

export function handleFormCategoriaSubmit(e){
  e.preventDefault();
  var editId = document.getElementById('editCatId').value;
  var nombre = document.getElementById('catNombre').value.trim();
  var color = document.getElementById('catColor').value || nextCategoryColor();
  if(!nombre){ alert('Falta el nombre de la categoría. Escríbelo arriba y vuelve a dar clic en Guardar.'); return; }
  if(editId){
    var cat = getCategoria(editId);
    if(cat){
      cat.nombre = nombre;
      cat.color = color;
    }
    showToast('Categoría actualizada.');
  } else {
    data.categories.push({id: uid('cat'), nombre: nombre, color: color, mostrarEnDiario: true, presupuestoMensual: null});
    showToast('Categoría creada.');
  }
  marcarDatosPropios();
  saveData();
  resetFormCategoria();
  renderAll();
}

export function resetFormCategoria(){
  document.getElementById('formCategoria').reset();
  document.getElementById('editCatId').value = '';
  document.getElementById('catFormTitulo').textContent = 'Nueva categoría';
  document.getElementById('btnGuardarCategoria').textContent = 'Agregar categoría';
  document.getElementById('btnCancelarEdicionCategoria').classList.add('hidden');
  document.getElementById('catColor').value = nextCategoryColor();
}

export function fillCategoriaFormForEdit(id){
  var cat = getCategoria(id);
  if(!cat) return;
  document.getElementById('editCatId').value = cat.id;
  document.getElementById('catNombre').value = cat.nombre;
  document.getElementById('catColor').value = cat.color;
  document.getElementById('catFormTitulo').textContent = 'Editar categoría';
  document.getElementById('btnGuardarCategoria').textContent = 'Actualizar categoría';
  document.getElementById('btnCancelarEdicionCategoria').classList.remove('hidden');
  document.getElementById('formCategoria').scrollIntoView({behavior:'smooth', block:'start'});
}

export function eliminarCategoria(id){
  var nProgramados = data.fixedExpenses.filter(function(e){ return e.categoriaId===id; }).length +
          data.variableExpenses.filter(function(e){ return e.categoriaId===id; }).length;
  var nDiarios = data.dailyExpenses.filter(function(e){ return e.categoriaId===id; }).length;
  if(nProgramados + nDiarios > 0){
    var otras = data.categories.filter(function(c){ return c.id!==id; });
    if(otras.length === 0){
      alert('Crea primero otra categoría para poder mover estos gastos.');
      return;
    }
    abrirModalReasignarCategoria(id, nProgramados, nDiarios, otras);
    return;
  }
  if(!confirm('¿Eliminar esta categoría?')) return;
  data.categories = data.categories.filter(function(c){ return c.id!==id; });
  saveData();
  renderAll();
}

export function abrirModalReasignarCategoria(catId, nProgramados, nDiarios, otras){
  var partes = [];
  if(nProgramados > 0) partes.push(nProgramados + ' gasto' + (nProgramados===1?'':'s') + ' programado' + (nProgramados===1?'':'s'));
  if(nDiarios > 0) partes.push(nDiarios + ' registro' + (nDiarios===1?'':'s') + ' diario' + (nDiarios===1?'':'s'));
  var html =
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3>Reasignar gastos</h3>' +
    '<p class="small muted">Esta categoría tiene '+partes.join(' y ')+'. ¿A qué categoría los movemos?</p>' +
    '<div class="field">' +
      '<label for="reasignarCategoriaSelect">Mover a</label>' +
      '<select id="reasignarCategoriaSelect">' +
        otras.map(function(c){ return '<option value="'+c.id+'">'+escapeHtml(c.nombre)+'</option>'; }).join('') +
      '</select>' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn" data-action="confirmar-reasignar-categoria" data-catid="'+catId+'">Mover y eliminar</button>' +
      '<button class="btn secondary" data-action="cerrar-modal">Cancelar</button>' +
    '</div>';
  openModal(html);
}

export function reasignarYEliminarCategoria(catId, destinoId){
  data.fixedExpenses.forEach(function(e){ if(e.categoriaId===catId) e.categoriaId = destinoId; });
  data.variableExpenses.forEach(function(e){ if(e.categoriaId===catId) e.categoriaId = destinoId; });
  data.dailyExpenses.forEach(function(e){ if(e.categoriaId===catId) e.categoriaId = destinoId; });
  data.categories = data.categories.filter(function(c){ return c.id!==catId; });
  saveData();
  renderAll();
  showToast('Gastos movidos y categoría eliminada.');
}
