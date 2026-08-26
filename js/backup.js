// Exportar/importar JSON y CSV, impresión / PDF.
"use strict";

import {
  uid, currency, escapeHtml, showToast,
  dateKey, fechaCorta, fechaLarga, parseDateLocal, periodKey, startOfDay, daysInMonth
} from './utils.js';
import { data, saveData, assignData, migrateData } from './store.js';
import { getActiveFixedOccurrence, getTrackedOccurrences } from './scheduled.js';
import { getActiveAhorroOccurrence, getTrackedAhorroOccurrences } from './savings.js';
import { getActiveDebtOccurrence, debtTipoLabel } from './debts.js';
import { getCategoria, nextCategoryColor } from './categories.js';
import { renderAll, renderBannerBackup } from './app.js';

// ---------- JSON ----------
export function exportarDatos(){
  data.ultimaExportacion = dateKey(new Date());
  saveData();
  var blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'control-de-pagos-copia-' + dateKey(new Date()) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  renderBannerBackup();
}

export function importarDatos(file){
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var parsed = JSON.parse(reader.result);
      if(!parsed || !Array.isArray(parsed.categories)) throw new Error('formato inválido');
      parsed.notifiedLog = parsed.notifiedLog || {};
      parsed.fixedExpenses = parsed.fixedExpenses || [];
      parsed.variableExpenses = parsed.variableExpenses || [];
      parsed.savingsGoals = parsed.savingsGoals || [];
      assignData(parsed);
      migrateData();
      saveData();
      renderAll();
      document.getElementById('perfilNombre').value = data.perfilNombre || '';
      showToast('Copia importada correctamente.');
    }catch(err){
      alert('No se pudo leer el archivo. Verifica que sea una copia de seguridad válida.');
    }
  };
  reader.readAsText(file);
}

// ---------- CSV export / import (Excel, locale español) ----------
export var CSV_COLUMNS = ['Frecuencia','Nombre','Categoria','TipoDeGasto','Ambito','Monto','MetaTotal','FechaLimite','Estado'];

export function csvField(v){
  var s = (v===null || v===undefined) ? '' : String(v);
  if(/[;"\n\r]/.test(s)){ s = '"' + s.replace(/"/g,'""') + '"'; }
  return s;
}
export function formatFechaCsv(fechaStr){
  if(!fechaStr) return '';
  return fechaCorta(parseDateLocal(fechaStr));
}
export function inferDebtTipo(str){
  str = (str||'').toLowerCase();
  if(str.indexOf('tarjeta')!==-1) return 'tarjeta';
  if(str.indexOf('hipoteca')!==-1 || str.indexOf('vivienda')!==-1) return 'hipoteca';
  if(str.indexOf('vehic')!==-1 || str.indexOf('carro')!==-1 || str.indexOf('moto')!==-1) return 'vehiculo';
  if(str.indexOf('personal')!==-1 || str.indexOf('préstamo')!==-1 || str.indexOf('prestamo')!==-1) return 'personal';
  if(str.indexOf('crédito')!==-1 || str.indexOf('credito')!==-1 || str.indexOf('libre inversion')!==-1 || str.indexOf('libre inversión')!==-1) return 'credito';
  return 'otro';
}
export function parseFechaCsv(str){
  str = (str||'').trim();
  if(!str) return null;
  var m1 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m1) return dateKey(new Date(Number(m1[1]), Number(m1[2])-1, Number(m1[3])));
  var m2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m2) return dateKey(new Date(Number(m2[3]), Number(m2[2])-1, Number(m2[1])));
  return null;
}

export function generarCSV(){
  var today = startOfDay(new Date());
  var rows = [CSV_COLUMNS];
  data.fixedExpenses.forEach(function(exp){
    var occ = getActiveFixedOccurrence(exp, today);
    var cat = getCategoria(exp.categoriaId);
    rows.push(['Fijo', exp.nombre, cat?cat.nombre:'', exp.tipoGasto||'', exp.ambito==='negocio'?'Negocio':'Personal',
      String(exp.monto), '', formatFechaCsv(exp.fechaInicio), (occ && occ.pagado) ? 'Pagado' : 'Pendiente']);
  });
  data.variableExpenses.forEach(function(exp){
    var cat = getCategoria(exp.categoriaId);
    rows.push(['Variable', exp.nombre, cat?cat.nombre:'', exp.tipoGasto||'', exp.ambito==='negocio'?'Negocio':'Personal',
      String(exp.monto), '', formatFechaCsv(exp.fecha), exp.pagado ? 'Pagado' : 'Pendiente']);
  });
  data.savingsGoals.forEach(function(goal){
    var occ = getActiveAhorroOccurrence(goal, today);
    rows.push(['Ahorro', goal.nombre, '', '', '',
      String(goal.montoMensual), String(goal.metaTotal||0), formatFechaCsv(goal.fechaInicio), (occ && occ.pagado) ? 'Pagado' : 'Pendiente']);
  });
  data.debts.forEach(function(debt){
    var occD = getActiveDebtOccurrence(debt, today);
    rows.push(['Deuda', debt.nombre, '', debtTipoLabel(debt.tipo), debt.ambito==='negocio'?'Negocio':'Personal',
      String(debt.cuotaMensual), String(debt.saldoActual), formatFechaCsv(debt.fechaInicio), (occD && occD.pagado) ? 'Pagado' : 'Pendiente']);
  });
  // Gastos diarios (§4.5): una fila por registro, identificada con Frecuencia
  // "Diario". No tienen TipoDeGasto/Ambito/MetaTotal/Estado propios en este
  // modelo — esas columnas quedan vacías, igual que ya ocurre para Ahorro y
  // Deuda con las columnas que no les aplican. La nota (si existe) va en
  // Nombre, que es la columna descriptiva que ya usan las demás filas.
  data.dailyExpenses.forEach(function(e){
    var cat = getCategoria(e.categoriaId);
    rows.push(['Diario', e.nota || '', cat?cat.nombre:'', '', '',
      String(e.monto), '', formatFechaCsv(e.fecha), '']);
  });
  var lines = rows.map(function(r){ return r.map(csvField).join(';'); });
  // Leading BOM so Excel (incl. Spanish locale) detects UTF-8 and shows tildes/ñ correctly.
  return '﻿' + lines.join('\r\n');
}

export function exportarCsv(){
  if(!data.fixedExpenses.length && !data.variableExpenses.length && !data.savingsGoals.length && !data.debts.length && !data.dailyExpenses.length){
    showToast('Todavía no tienes gastos, deudas ni metas para exportar.');
    return;
  }
  data.ultimaExportacion = dateKey(new Date());
  saveData();
  var blob = new Blob([generarCSV()], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'control-de-pagos-' + dateKey(new Date()) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  renderBannerBackup();
}

export function parseCsvText(text){
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var delim = text.indexOf(';') !== -1 ? ';' : ',';
  var rows = []; var row = []; var field = ''; var inQuotes = false;
  for(var i=0; i<text.length; i++){
    var c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if(c === '"'){ inQuotes = true; }
    else if(c === delim){ row.push(field); field = ''; }
    else if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if(c === '\r'){ /* ignore, \n follows */ }
    else { field += c; }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(function(r){ return r.length>1 || (r.length===1 && r[0].trim()!==''); });
}

export function importarCsv(file){
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var rows = parseCsvText(String(reader.result));
      if(rows.length < 2) throw new Error('el archivo no tiene filas de datos.');
      var header = rows[0].map(function(h){ return h.trim().toLowerCase(); });
      var idx = function(name){ return header.indexOf(name.toLowerCase()); };
      var iFrecuencia = idx('Frecuencia'), iNombre = idx('Nombre'), iCategoria = idx('Categoria'),
          iTipoGasto = idx('TipoDeGasto'), iAmbito = idx('Ambito'), iMonto = idx('Monto'),
          iMetaTotal = idx('MetaTotal'), iFecha = idx('FechaLimite'), iEstado = idx('Estado');
      if(iFrecuencia===-1 || iNombre===-1 || iMonto===-1 || iFecha===-1){
        throw new Error('faltan columnas obligatorias (Frecuencia, Nombre, Monto, FechaLimite).');
      }
      var hoy = startOfDay(new Date());
      var agregados = 0, omitidos = 0;
      function resolverCategoriaId(categoriaNombre){
        if(!categoriaNombre) return null;
        var catExistente = data.categories.find(function(c){ return c.nombre.trim().toLowerCase()===categoriaNombre.toLowerCase(); });
        if(catExistente) return catExistente.id;
        var nuevaCat = {id: uid('cat'), nombre: categoriaNombre, color: nextCategoryColor(), mostrarEnDiario: true, presupuestoMensual: null};
        data.categories.push(nuevaCat);
        return nuevaCat.id;
      }
      rows.slice(1).forEach(function(r){
        var frecuencia = (r[iFrecuencia]||'').trim().toLowerCase();
        var nombre = (r[iNombre]||'').trim();
        var fechaStr = parseFechaCsv(r[iFecha]);
        // La nota es opcional para un gasto Diario (igual que en la hoja de
        // registro), así que para ese tipo no se exige Nombre no vacío.
        if(!fechaStr || ['fijo','variable','ahorro','deuda','diario'].indexOf(frecuencia) === -1){
          omitidos++; return;
        }
        if(frecuencia !== 'diario' && !nombre){
          omitidos++; return;
        }
        var montoRaw = Number(String(r[iMonto]||'').replace(',', '.'));
        if(String(r[iMonto]||'').trim() === '' || isNaN(montoRaw) || montoRaw <= 0){
          omitidos++; return;
        }
        var monto = montoRaw;
        var ambitoStr = iAmbito>=0 ? (r[iAmbito]||'').trim().toLowerCase() : '';
        var ambito = ambitoStr === 'negocio' ? 'negocio' : 'personal';
        var categoriaNombre = iCategoria>=0 ? (r[iCategoria]||'').trim() : '';
        var tipoGasto = iTipoGasto>=0 ? (r[iTipoGasto]||'').trim() : '';
        var estado = iEstado>=0 ? (r[iEstado]||'').trim().toLowerCase() : '';
        var pagado = estado === 'pagado';
        var fecha = parseDateLocal(fechaStr);

        if(frecuencia === 'ahorro'){
          var metaTotal = Number(String(r[iMetaTotal]||'0').replace(',', '.')) || 0;
          var goal = {
            id: uid('ahorro'), nombre: nombre, metaTotal: metaTotal, montoMensual: monto,
            diaMes: fecha.getDate(), fechaInicio: fechaStr, activo:true, pagosPorMes:{}
          };
          if(pagado){
            var pkG = periodKey(new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(fecha.getDate(), daysInMonth(hoy.getFullYear(),hoy.getMonth()))));
            goal.pagosPorMes[pkG] = {pagado:true, fechaPago: dateKey(hoy), monto: monto};
          }
          data.savingsGoals.push(goal);
        } else if(frecuencia === 'deuda'){
          var saldoActualImp = Number(String(r[iMetaTotal]||'0').replace(',', '.')) || 0;
          if(saldoActualImp <= 0) saldoActualImp = monto;
          if(monto > saldoActualImp) saldoActualImp = monto;
          var debtImp = {
            id: uid('debt'), nombre: nombre, tipo: inferDebtTipo(tipoGasto), saldoInicial: saldoActualImp, saldoActual: saldoActualImp,
            cuotaMensual: monto, diaMes: fecha.getDate(), tasaInfo: '', ambito: ambito, activo: true,
            fechaInicio: fechaStr, pagosPorMes: {}
          };
          if(pagado){
            var pkD = periodKey(new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(fecha.getDate(), daysInMonth(hoy.getFullYear(),hoy.getMonth()))));
            debtImp.pagosPorMes[pkD] = {pagado:true, monto: monto, saldoDespues: saldoActualImp};
          }
          data.debts.push(debtImp);
        } else if(frecuencia === 'diario'){
          data.dailyExpenses.push({
            id: uid('daily'), categoriaId: resolverCategoriaId(categoriaNombre), monto: monto,
            nota: nombre, fecha: fechaStr, ambito: 'personal', creadoEn: Date.now()
          });
        } else {
          var categoriaId = resolverCategoriaId(categoriaNombre);
          if(frecuencia === 'fijo'){
            var exp = {
              id: uid('exp'), nombre: nombre, monto: monto, categoriaId: categoriaId, ambito: ambito, tipoGasto: tipoGasto,
              diaMes: fecha.getDate(), fechaInicio: fechaStr, activo:true, pagosPorMes:{}
            };
            if(pagado){
              var pkF = periodKey(new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(fecha.getDate(), daysInMonth(hoy.getFullYear(),hoy.getMonth()))));
              exp.pagosPorMes[pkF] = {pagado:true, fechaPago: dateKey(hoy), monto: monto};
            }
            data.fixedExpenses.push(exp);
          } else {
            data.variableExpenses.push({
              id: uid('exp'), nombre: nombre, monto: monto, categoriaId: categoriaId, ambito: ambito, tipoGasto: tipoGasto,
              fecha: fechaStr, pagado: pagado, fechaPago: pagado ? dateKey(hoy) : null
            });
          }
        }
        agregados++;
      });

      if(agregados === 0){
        alert('No se pudo importar ningún registro. Revisa que el CSV tenga las columnas Frecuencia, Nombre, Monto y FechaLimite, y al menos una fila con esos datos completos.');
        return;
      }
      saveData();
      renderAll();
      showToast('✅ Se agregaron ' + agregados + ' registro(s) del CSV' + (omitidos ? (' (' + omitidos + ' fila(s) omitida(s))') : '') + '.');
    }catch(err){
      alert('No se pudo leer el archivo CSV: ' + err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ---------- Imprimir / PDF ----------
export function generarReporteImprimible(){
  var nombre = (data.perfilNombre || '').trim();
  var hoy = new Date();
  var fechaTexto = fechaLarga(hoy) + ' de ' + hoy.getFullYear();

  var filasOcc = getTrackedOccurrences().concat(getTrackedAhorroOccurrences())
    .sort(function(a,b){ return a.fecha - b.fecha; });

  var totalPendiente = filasOcc.filter(function(o){ return !o.pagado; }).reduce(function(s,o){ return s+o.monto; },0);
  var totalPagado = filasOcc.filter(function(o){ return o.pagado; }).reduce(function(s,o){ return s+o.monto; },0);

  var filasHtml = filasOcc.map(function(o){
    var cat = getCategoria(o.categoriaId);
    var categoriaTexto = cat ? cat.nombre : (o.tipo==='ahorro' ? 'Ahorro programado' : '—');
    var ambitoTexto = o.ambito==='negocio' ? 'Negocio' : (o.ambito==='ahorro' ? 'Ahorro' : 'Personal');
    var tipoTexto = o.tipo==='fijo' ? 'Fijo' : (o.tipo==='variable' ? 'Variable' : 'Ahorro');
    return '<tr>' +
      '<td>'+escapeHtml(o.nombre)+'</td>' +
      '<td>'+escapeHtml(categoriaTexto)+'</td>' +
      '<td>'+ambitoTexto+'</td>' +
      '<td>'+tipoTexto+'</td>' +
      '<td>'+currency.format(o.monto)+'</td>' +
      '<td>'+fechaCorta(o.fecha)+'</td>' +
      '<td>'+(o.pagado ? 'Pagado' : 'Pendiente')+'</td>' +
    '</tr>';
  }).join('');

  var todayImp = startOfDay(new Date());

  // Gastos diarios de este mes (§6 Fase D): tabla propia, con su propio
  // total — nunca se mezcla con el total de pagos programados de arriba,
  // para que los números no se contradigan entre secciones del reporte.
  var diariosDelMes = data.dailyExpenses.filter(function(e){
    var f = parseDateLocal(e.fecha);
    return f.getMonth()===todayImp.getMonth() && f.getFullYear()===todayImp.getFullYear();
  }).sort(function(a,b){ return parseDateLocal(a.fecha) - parseDateLocal(b.fecha); });
  var totalDiariosMes = diariosDelMes.reduce(function(s,e){ return s+e.monto; }, 0);
  var filasDiarioHtml = diariosDelMes.map(function(e){
    var cat = getCategoria(e.categoriaId);
    return '<tr>' +
      '<td>'+fechaCorta(parseDateLocal(e.fecha))+'</td>' +
      '<td>'+escapeHtml(cat ? cat.nombre : 'Sin categoría')+'</td>' +
      '<td>'+escapeHtml(e.nota || '—')+'</td>' +
      '<td>'+currency.format(e.monto)+'</td>' +
    '</tr>';
  }).join('');
  var diariosSectionHtml =
    '<div class="p-section-title">Gastos diarios de este mes</div>' +
    '<table><thead><tr><th>Fecha</th><th>Categoría</th><th>Nota</th><th>Monto</th></tr></thead>' +
    '<tbody>' + (filasDiarioHtml || '<tr><td colspan="4">No hay gastos diarios registrados este mes.</td></tr>') + '</tbody></table>' +
    '<div class="p-totals">Total gastado este mes: '+currency.format(totalDiariosMes)+'</div>';

  var filasDeudaHtml = data.debts.map(function(debt){
    var occD = getActiveDebtOccurrence(debt, todayImp);
    var estadoD = debt.saldoActual <= 0 ? 'Saldada' : ((occD && occD.pagado) ? 'Pagada este mes' : 'Pendiente');
    return '<tr>' +
      '<td>'+escapeHtml(debt.nombre)+'</td>' +
      '<td>'+currency.format(debt.cuotaMensual)+'</td>' +
      '<td>'+estadoD+'</td>' +
      '<td>'+currency.format(debt.saldoActual)+'</td>' +
    '</tr>';
  }).join('');
  var deudasSectionHtml = data.debts.length
    ? '<div class="p-section-title">Deudas</div>' +
      '<table><thead><tr><th>Nombre</th><th>Cuota del mes</th><th>Estado</th><th>Saldo actual</th></tr></thead>' +
      '<tbody>' + filasDeudaHtml + '</tbody></table>'
    : '';

  var html =
    '<div class="p-header">' +
      '<h1>💳 Control de Pagos</h1>' +
      '<div class="p-meta">' +
        (nombre ? '<strong>'+escapeHtml(nombre)+'</strong>' : '') +
        '<div>'+fechaTexto+'</div>' +
      '</div>' +
    '</div>' +
    diariosSectionHtml +
    '<div class="p-section-title">Pagos de este ciclo</div>' +
    '<table><thead><tr><th>Nombre</th><th>Categoría</th><th>Ámbito</th><th>Tipo</th><th>Monto</th><th>Fecha</th><th>Estado</th></tr></thead>' +
    '<tbody>' + (filasHtml || '<tr><td colspan="7">No hay pagos registrados.</td></tr>') + '</tbody></table>' +
    '<div class="p-totals">Total pendiente: '+currency.format(totalPendiente)+' &nbsp;&nbsp; Total pagado: '+currency.format(totalPagado)+'</div>' +
    deudasSectionHtml +
    '<div class="p-footer">Generado con Control de Pagos el '+fechaTexto+'.</div>';

  document.getElementById('printArea').innerHTML = html;
}

export function imprimirReporte(){
  generarReporteImprimible();
  window.print();
}
