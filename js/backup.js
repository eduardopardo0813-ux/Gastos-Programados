// Exportar/importar JSON y CSV, impresión / PDF.
"use strict";

import {
  uid, currency, escapeHtml, showToast, MES_LABELS, SAVINGS_COLOR, DEBT_COLOR,
  dateKey, fechaCorta, fechaLarga, parseDateLocal, periodKey, startOfDay, daysInMonth
} from './utils.js';
import { data, saveData, assignData, migrateData } from './store.js';
import { getActiveFixedOccurrence, generateOccurrences } from './scheduled.js';
import { getActiveAhorroOccurrence } from './savings.js';
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
// La columna Id es el id interno de cada registro (exp_/ahorro_/debt_/daily_...).
// Se exporta para que, al reimportar el mismo CSV más adelante, la app pueda
// reconocer qué filas ya existen y no las duplique (§ ver importarCsv).
export var CSV_COLUMNS = ['Id','Frecuencia','Nombre','Categoria','TipoDeGasto','Ambito','Monto','MetaTotal','FechaLimite','Estado'];

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
    rows.push([exp.id, 'Fijo', exp.nombre, cat?cat.nombre:'', exp.tipoGasto||'', exp.ambito==='negocio'?'Negocio':'Personal',
      String(exp.monto), '', formatFechaCsv(exp.fechaInicio), (occ && occ.pagado) ? 'Pagado' : 'Pendiente']);
  });
  data.variableExpenses.forEach(function(exp){
    var cat = getCategoria(exp.categoriaId);
    rows.push([exp.id, 'Variable', exp.nombre, cat?cat.nombre:'', exp.tipoGasto||'', exp.ambito==='negocio'?'Negocio':'Personal',
      String(exp.monto), '', formatFechaCsv(exp.fecha), exp.pagado ? 'Pagado' : 'Pendiente']);
  });
  data.savingsGoals.forEach(function(goal){
    var occ = getActiveAhorroOccurrence(goal, today);
    rows.push([goal.id, 'Ahorro', goal.nombre, '', '', '',
      String(goal.montoMensual), String(goal.metaTotal||0), formatFechaCsv(goal.fechaInicio), (occ && occ.pagado) ? 'Pagado' : 'Pendiente']);
  });
  data.debts.forEach(function(debt){
    var occD = getActiveDebtOccurrence(debt, today);
    rows.push([debt.id, 'Deuda', debt.nombre, '', debtTipoLabel(debt.tipo), debt.ambito==='negocio'?'Negocio':'Personal',
      String(debt.cuotaMensual), String(debt.saldoActual), formatFechaCsv(debt.fechaInicio), (occD && occD.pagado) ? 'Pagado' : 'Pendiente']);
  });
  // Gastos diarios (§4.5): una fila por registro, identificada con Frecuencia
  // "Diario". No tienen TipoDeGasto/Ambito/MetaTotal/Estado propios en este
  // modelo — esas columnas quedan vacías, igual que ya ocurre para Ahorro y
  // Deuda con las columnas que no les aplican. La nota (si existe) va en
  // Nombre, que es la columna descriptiva que ya usan las demás filas.
  data.dailyExpenses.forEach(function(e){
    var cat = getCategoria(e.categoriaId);
    rows.push([e.id, 'Diario', e.nota || '', cat?cat.nombre:'', '', '',
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
      var iId = idx('Id'), iFrecuencia = idx('Frecuencia'), iNombre = idx('Nombre'), iCategoria = idx('Categoria'),
          iTipoGasto = idx('TipoDeGasto'), iAmbito = idx('Ambito'), iMonto = idx('Monto'),
          iMetaTotal = idx('MetaTotal'), iFecha = idx('FechaLimite'), iEstado = idx('Estado');
      if(iFrecuencia===-1 || iNombre===-1 || iMonto===-1 || iFecha===-1){
        throw new Error('faltan columnas obligatorias (Frecuencia, Nombre, Monto, FechaLimite).');
      }
      var hoy = startOfDay(new Date());
      var agregados = 0, omitidos = 0, duplicados = 0;
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

        // Evita duplicar registros al reimportar un CSV ya exportado antes
        // (o exportado de nuevo tras agregar más gastos): si el Id de la
        // fila ya existe en el arreglo que le corresponde según su
        // Frecuencia, se omite en vez de crear una copia. Un CSV sin
        // columna Id (de una versión anterior) sigue funcionando igual que
        // antes, sin deduplicar — no hay con qué reconocer la fila.
        var idCsv = iId>=0 ? (r[iId]||'').trim() : '';
        var arrDestino = frecuencia==='ahorro' ? data.savingsGoals
          : frecuencia==='deuda' ? data.debts
          : frecuencia==='diario' ? data.dailyExpenses
          : frecuencia==='fijo' ? data.fixedExpenses
          : data.variableExpenses;
        if(idCsv && arrDestino.some(function(x){ return x.id === idCsv; })){
          duplicados++; return;
        }

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
            id: idCsv || uid('ahorro'), nombre: nombre, metaTotal: metaTotal, montoMensual: monto,
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
            id: idCsv || uid('debt'), nombre: nombre, tipo: inferDebtTipo(tipoGasto), saldoInicial: saldoActualImp, saldoActual: saldoActualImp,
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
            id: idCsv || uid('daily'), categoriaId: resolverCategoriaId(categoriaNombre), monto: monto,
            nota: nombre, fecha: fechaStr, ambito: 'personal', creadoEn: Date.now()
          });
        } else {
          var categoriaId = resolverCategoriaId(categoriaNombre);
          if(frecuencia === 'fijo'){
            var exp = {
              id: idCsv || uid('exp'), nombre: nombre, monto: monto, categoriaId: categoriaId, ambito: ambito, tipoGasto: tipoGasto,
              diaMes: fecha.getDate(), fechaInicio: fechaStr, activo:true, pagosPorMes:{}
            };
            if(pagado){
              var pkF = periodKey(new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(fecha.getDate(), daysInMonth(hoy.getFullYear(),hoy.getMonth()))));
              exp.pagosPorMes[pkF] = {pagado:true, fechaPago: dateKey(hoy), monto: monto};
            }
            data.fixedExpenses.push(exp);
          } else {
            data.variableExpenses.push({
              id: idCsv || uid('exp'), nombre: nombre, monto: monto, categoriaId: categoriaId, ambito: ambito, tipoGasto: tipoGasto,
              fecha: fechaStr, pagado: pagado, fechaPago: pagado ? dateKey(hoy) : null
            });
          }
        }
        agregados++;
      });

      if(agregados === 0){
        if(duplicados > 0 && omitidos === 0){
          showToast('No se agregó nada nuevo: los ' + duplicados + ' registro(s) del CSV ya estaban importados.');
        } else {
          alert('No se pudo importar ningún registro. Revisa que el CSV tenga las columnas Frecuencia, Nombre, Monto y FechaLimite, y al menos una fila con esos datos completos.');
        }
        return;
      }
      saveData();
      renderAll();
      var detalleImport = [];
      if(duplicados) detalleImport.push(duplicados + ' ya existían');
      if(omitidos) detalleImport.push(omitidos + ' fila(s) omitida(s)');
      showToast('✅ Se agregaron ' + agregados + ' registro(s) del CSV' + (detalleImport.length ? (' (' + detalleImport.join(', ') + ')') : '') + '.');
    }catch(err){
      alert('No se pudo leer el archivo CSV: ' + err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ---------- Imprimir / PDF: informe mensual con gráficos ----------
// Agrupa el gasto del período (diarios + ocurrencias pagadas) por categoría
// real, más dos pseudo-categorías con los colores que ya usa el resto de la
// app para Ahorro y Deuda (no tienen categoriaId propio) — mismo criterio
// que la barra de Inicio (§2.4), pero aquí sobre el rango de fechas elegido.
function agruparPorCategoriaReporte(diarios, occsPagos, occsDeuda){
  var grupos = {};
  function add(key, label, color, monto){
    if(!grupos[key]) grupos[key] = {key:key, label:label, color:color, monto:0};
    grupos[key].monto += monto;
  }
  diarios.forEach(function(e){
    var cat = getCategoria(e.categoriaId);
    add(e.categoriaId || '__sin_categoria', cat ? cat.nombre : 'Sin categoría', cat ? cat.color : '#9aa0a6', e.monto);
  });
  occsPagos.forEach(function(o){
    if(!o.pagado) return;
    if(o.tipo === 'ahorro'){ add('__ahorro', '🐷 Ahorro', SAVINGS_COLOR, o.monto); return; }
    var cat = getCategoria(o.categoriaId);
    add(o.categoriaId || '__sin_categoria', cat ? cat.nombre : 'Sin categoría', cat ? cat.color : '#9aa0a6', o.monto);
  });
  occsDeuda.forEach(function(o){
    if(!o.pagado) return;
    add('__deuda', '💳 Deuda', DEBT_COLOR, o.monto);
  });
  return Object.keys(grupos).map(function(k){ return grupos[k]; });
}

// Barra segmentada + leyenda, en HTML/CSS plano (sin SVG) — imprime igual
// de bien y reutiliza el mismo criterio visual que la barra de Inicio:
// grupos por debajo del 3% se funden en "Otros".
function construirBarraCategoriasHtml(grupos){
  var total = grupos.reduce(function(s,g){ return s+g.monto; }, 0);
  if(total <= 0){
    return '<p class="p-chart-empty">Sin movimientos en este período.</p>';
  }
  grupos.forEach(function(g){ g.pct = g.monto/total*100; });
  grupos.sort(function(a,b){ return b.monto-a.monto; });
  var principales = grupos.filter(function(g){ return g.pct >= 3; });
  var menores = grupos.filter(function(g){ return g.pct < 3; });
  if(menores.length){
    var montoOtros = menores.reduce(function(s,g){ return s+g.monto; }, 0);
    principales.push({label:'Otros', color:'#9aa0a6', monto:montoOtros, pct: montoOtros/total*100});
  }
  var barra = '<div class="p-bar">' + principales.map(function(g){
    return '<div class="p-bar-seg" style="width:'+g.pct.toFixed(2)+'%;background:'+g.color+';"></div>';
  }).join('') + '</div>';
  var leyenda = '<div class="p-legend">' + principales.map(function(g){
    return '<div class="p-legend-item"><span class="p-dot" style="background:'+g.color+';"></span>' +
      '<span class="lbl">'+escapeHtml(g.label)+'</span>' +
      '<span>'+currency.format(g.monto)+' · '+Math.round(g.pct)+'%</span></div>';
  }).join('') + '</div>';
  return barra + leyenda;
}

// Donut de 3 segmentos (Gastado diario / Pagado programado / Pendiente
// programado) con SVG puro (mismo truco de stroke-dasharray que ya usa el
// anillo de las metas de ahorro) — sin librerías de gráficos.
function construirDonutHtml(diario, pagado, pendiente){
  var segmentos = [
    {label:'Gastado (diario)', color:'#2f68cc', valor:diario},
    {label:'Pagado (programado)', color:'#1fa855', valor:pagado},
    {label:'Pendiente (programado)', color:'#e4a916', valor:pendiente}
  ];
  var total = diario + pagado + pendiente;
  var size = 120, r = size/2 - 12, c = 2*Math.PI*r;
  var offsetAcc = 0;
  var circles = total > 0 ? segmentos.filter(function(s){ return s.valor>0; }).map(function(s){
    var dash = (s.valor/total)*c;
    var circle = '<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="'+s.color+'" stroke-width="16" ' +
      'stroke-dasharray="'+dash.toFixed(1)+' '+(c-dash).toFixed(1)+'" stroke-dashoffset="'+(-offsetAcc).toFixed(1)+'" ' +
      'transform="rotate(-90 '+(size/2)+' '+(size/2)+')"/>';
    offsetAcc += dash;
    return circle;
  }).join('') : '';
  var svg = '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">' +
    '<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="#ddd" stroke-width="16"/>' +
    circles +
    '</svg>';
  var leyenda = '<div class="p-legend">' + segmentos.filter(function(s){ return s.valor>0; }).map(function(s){
    return '<div class="p-legend-item"><span class="p-dot" style="background:'+s.color+';"></span>' +
      '<span class="lbl">'+s.label+'</span><span>'+currency.format(s.valor)+'</span></div>';
  }).join('') + '</div>';
  return '<div class="p-donut-wrap">'+svg+'</div>' + leyenda;
}

// Informe de un mes elegido (year/month, 0-indexado como Date). Sin
// argumentos, informa el mes en curso. Un mes anterior sale completo; el
// mes en curso sale "hasta hoy" — no tiene sentido proyectar días que
// todavía no pasaron como si ya fueran historia.
export function generarReporteImprimible(year, month){
  var todayReal = startOfDay(new Date());
  var y = (typeof year === 'number' && !isNaN(year)) ? year : todayReal.getFullYear();
  var m = (typeof month === 'number' && !isNaN(month)) ? month : todayReal.getMonth();

  var inicioMes = new Date(y, m, 1);
  var finMesCompleto = new Date(y, m+1, 0);
  var esMesActual = (y === todayReal.getFullYear() && m === todayReal.getMonth());
  var finRango = esMesActual ? todayReal : finMesCompleto;
  if(finRango > finMesCompleto) finRango = finMesCompleto;

  var nombre = (data.perfilNombre || '').trim();
  var tituloMes = MES_LABELS[m] + ' de ' + y;
  var coberturaTexto = esMesActual
    ? ('Del 1 al ' + finRango.getDate() + ' de ' + tituloMes + ' — mes en curso, hasta hoy.')
    : ('Del 1 al ' + finMesCompleto.getDate() + ' de ' + tituloMes + ' — mes completo.');
  var generadoTexto = fechaLarga(todayReal) + ' de ' + todayReal.getFullYear();

  // generateOccurrences() no depende de "hoy": calcula, para cualquier
  // rango de fechas, las ocurrencias de fijos/variables/ahorro/deuda con su
  // estado pagado/pendiente real de ese momento (pagosPorMes queda guardado
  // por período, así que un mes cerrado se puede reconstruir con exactitud).
  var occs = generateOccurrences(inicioMes, finRango);
  var occsPagos = occs.filter(function(o){ return o.tipo !== 'deuda'; }).sort(function(a,b){ return a.fecha-b.fecha; });
  var occsDeuda = occs.filter(function(o){ return o.tipo === 'deuda'; }).sort(function(a,b){ return a.fecha-b.fecha; });

  var totalPendiente = occsPagos.filter(function(o){ return !o.pagado; }).reduce(function(s,o){ return s+o.monto; },0);
  var totalPagado = occsPagos.filter(function(o){ return o.pagado; }).reduce(function(s,o){ return s+o.monto; },0);

  var filasHtml = occsPagos.map(function(o){
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

  // Gastos diarios del período elegido: tabla propia, con su propio total —
  // nunca se mezcla con el total de pagos programados, para que los números
  // no se contradigan entre secciones del informe.
  var diariosDelMes = data.dailyExpenses.filter(function(e){
    var f = parseDateLocal(e.fecha);
    return f >= inicioMes && f <= finRango;
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
    '<div class="p-section-title">Gastos diarios de '+tituloMes+'</div>' +
    '<table><thead><tr><th>Fecha</th><th>Categoría</th><th>Nota</th><th>Monto</th></tr></thead>' +
    '<tbody>' + (filasDiarioHtml || '<tr><td colspan="4">No hay gastos diarios registrados en este período.</td></tr>') + '</tbody></table>' +
    '<div class="p-totals">Total gastado en el período: '+currency.format(totalDiariosMes)+'</div>';

  var filasDeudaHtml = occsDeuda.map(function(o){
    var debt = data.debts.find(function(d){ return d.id===o.expenseId; });
    var pagoInfo = debt ? debt.pagosPorMes[o.periodKey] : null;
    var saldoTexto = (o.pagado && pagoInfo && typeof pagoInfo.saldoDespues === 'number')
      ? currency.format(pagoInfo.saldoDespues) + ' (al pagar esa cuota)'
      : currency.format(debt ? debt.saldoActual : 0) + ' (saldo actual)';
    return '<tr>' +
      '<td>'+escapeHtml(o.nombre)+'</td>' +
      '<td>'+currency.format(o.monto)+'</td>' +
      '<td>'+(o.pagado ? 'Pagada' : 'Pendiente')+'</td>' +
      '<td>'+saldoTexto+'</td>' +
    '</tr>';
  }).join('');
  var deudasSectionHtml = occsDeuda.length
    ? '<div class="p-section-title">Deudas — cuotas de '+tituloMes+'</div>' +
      '<table><thead><tr><th>Nombre</th><th>Cuota</th><th>Estado</th><th>Saldo</th></tr></thead>' +
      '<tbody>' + filasDeudaHtml + '</tbody></table>'
    : '';

  var gruposCategoria = agruparPorCategoriaReporte(diariosDelMes, occsPagos, occsDeuda);
  var barraHtml = construirBarraCategoriasHtml(gruposCategoria);
  var donutHtml = construirDonutHtml(totalDiariosMes, totalPagado, totalPendiente);

  var html =
    '<div class="p-header">' +
      '<h1>💳 Control de Pagos</h1>' +
      '<div class="p-meta">' +
        (nombre ? '<strong>'+escapeHtml(nombre)+'</strong>' : '') +
        '<div>Generado el '+generadoTexto+'</div>' +
      '</div>' +
    '</div>' +
    '<div class="p-section-title">Informe de '+tituloMes+'</div>' +
    '<p class="p-cobertura">'+coberturaTexto+'</p>' +
    '<div class="p-charts-row">' +
      '<div class="p-chart-col">' +
        '<h3 class="p-chart-title">Gasto por categoría</h3>' +
        barraHtml +
      '</div>' +
      '<div class="p-chart-col p-chart-col-donut">' +
        '<h3 class="p-chart-title">Distribución del período</h3>' +
        donutHtml +
      '</div>' +
    '</div>' +
    diariosSectionHtml +
    '<div class="p-section-title">Pagos programados de '+tituloMes+'</div>' +
    '<table><thead><tr><th>Nombre</th><th>Categoría</th><th>Ámbito</th><th>Tipo</th><th>Monto</th><th>Fecha</th><th>Estado</th></tr></thead>' +
    '<tbody>' + (filasHtml || '<tr><td colspan="7">No hay pagos programados en este período.</td></tr>') + '</tbody></table>' +
    '<div class="p-totals">Total pendiente: '+currency.format(totalPendiente)+' &nbsp;&nbsp; Total pagado: '+currency.format(totalPagado)+'</div>' +
    deudasSectionHtml +
    '<div class="p-footer">Generado con Control de Pagos el '+generadoTexto+'.</div>';

  document.getElementById('printArea').innerHTML = html;
}

export function imprimirReporte(){
  var mesInput = document.getElementById('informeMes');
  var year, month;
  if(mesInput && mesInput.value){
    var partes = mesInput.value.split('-');
    year = Number(partes[0]);
    month = Number(partes[1]) - 1;
  }
  generarReporteImprimible(year, month);
  window.print();
}
