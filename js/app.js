// Init, navegación (§1.2/§1.3), orquestación de renders.
"use strict";

import {
  currency, currencyDecimal, escapeHtml, fechaCorta, fechaLarga, formatFechaHoraCorta,
  dateKey, parseDateLocal, startOfDay, showToast, showToastAccion, closeModal,
  SAVINGS_COLOR, DEBT_COLOR
} from './utils.js';
import {
  STORAGE_KEY, data, state, assignData, loadData, saveData, migrateData, seedData, getStorageDisponible
} from './store.js';
import {
  getTrackedOccurrences, statusOf, occRowHtml,
  handleFormGastoSubmit, resetForm, updateFechaHint, fillFormForEdit,
  markPaidByIds, abrirModalPagoFijo, eliminarConRespaldo, restaurarGastoEliminado, removeExpense,
  renderListaGastos
} from './scheduled.js';
import {
  getTrackedAhorroOccurrences, totalAhorradoDeMeta,
  handleFormAhorroSubmit, resetFormAhorro, renderAhorros,
  abrirModalAbonoExtra, registrarAbonoExtra
} from './savings.js';
import {
  getTrackedDebtOccurrences,
  handleFormDeudaSubmit, resetFormDeuda, renderDeudas,
  abrirModalPagoDeuda, registrarPagoDeuda
} from './debts.js';
import {
  populateCategoriaFilters, populateCategoriaSelect, nextCategoryColor, renderCategorias,
  handleFormCategoriaSubmit, eliminarCategoria, reasignarYEliminarCategoria, getCategoria,
  abrirModalPresupuestoCategoria, guardarPresupuestoCategoria
} from './categories.js';
import { renderCalendario, openDiaModal } from './calendar.js';
import {
  exportarDatos, importarDatos, exportarCsv, importarCsv, imprimirReporte
} from './backup.js';
import {
  renderDaily, renderUltimosRegistros, totalDiarioMes,
  abrirHojaGastoDiario, eliminarDailyConRespaldo, restaurarDailyEliminado,
  abrirVistaCompletaMesDiario
} from './daily.js';

var INDICADOR_URL = 'https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC';

// ---------- navegación (§1.2/§1.3/§1.4) ----------
// Mapea los nombres de pestaña "históricos" (usados en varios botones
// data-action="ir-tab" ya existentes: gastos, calendario, ahorro, deudas,
// resumen) a la nueva estructura de 5 secciones + sub-pestañas, para no
// tener que tocar cada botón del HTML uno por uno.
var TAB_MAP = {
  resumen: {section:'inicio'},
  inicio: {section:'inicio'},
  gastos: {section:'programados', subtab:'gastos'},
  calendario: {section:'programados', subtab:'calendario'},
  programados: {section:'programados'},
  ahorro: {section:'ahorro-deudas', subtab:'ahorro'},
  deudas: {section:'ahorro-deudas', subtab:'deudas'},
  'ahorro-deudas': {section:'ahorro-deudas'},
  categorias: {section:'categorias'},
  ajustes: {section:'ajustes'}
};

export function switchTab(name){
  var map = TAB_MAP[name] || {section:name};
  document.querySelectorAll('nav.tabs button').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab===map.section);
  });
  document.querySelectorAll('.panel').forEach(function(p){
    p.classList.toggle('active', p.id === 'panel-'+map.section);
  });
  if(map.subtab) switchSubTab(map.section, map.subtab);
}

export function switchSubTab(section, subtab){
  var panel = document.getElementById('panel-'+section);
  if(!panel) return;
  panel.querySelectorAll(':scope > .subtabs button').forEach(function(b){
    b.classList.toggle('active', b.dataset.subtab===subtab);
  });
  panel.querySelectorAll(':scope > .subpanel').forEach(function(p){
    p.classList.toggle('active', p.id === 'subpanel-'+subtab);
  });
}

// ---------- INICIO (antes "Resumen") ----------
export function renderResumen(){
  var today = startOfDay(new Date());
  var occs = getTrackedOccurrences().concat(getTrackedAhorroOccurrences()).concat(getTrackedDebtOccurrences())
    .sort(function(a,b){ return a.fecha - b.fecha; });

  var pendientes = occs.filter(function(o){ return !o.pagado; });
  var vencidos = pendientes.filter(function(o){ return statusOf(o).dias < 0; });
  var proximos3 = pendientes.filter(function(o){ var d=statusOf(o).dias; return d>=0 && d<=3; });
  var totalPendienteMes = pendientes.filter(function(o){
    return o.fecha.getMonth()===today.getMonth() && o.fecha.getFullYear()===today.getFullYear();
  }).reduce(function(sum,o){ return sum+o.monto; },0);
  var totalGastadoDiarioMes = totalDiarioMes(today);

  // Resumen del mes (§3): dos cifras grandes — lo que ya se gastó en el día
  // a día, y lo que todavía falta por pagar de lo programado. (La tercera
  // cifra opcional, "Disponible", solo aplicaría si existiera un presupuesto
  // global — este modelo de datos no lo tiene, así que se omite.)
  var statValues = [currency.format(totalGastadoDiarioMes), currency.format(totalPendienteMes)];
  var prevStats = state.prevStatValues;
  document.getElementById('statRow').innerHTML =
    statTile(statValues[0], 'Gastado este mes', !!prevStats && statValues[0] !== prevStats[0]) +
    statTile(statValues[1], 'Pendiente por pagar', !!prevStats && statValues[1] !== prevStats[1]);
  state.prevStatValues = statValues;

  // reminder banner
  var bannerEl = document.getElementById('reminderBanner');
  if(proximos3.length > 0){
    bannerEl.innerHTML =
      '<div class="banner">' +
        '<div><strong>⏰ Tienes ' + proximos3.length + ' pago' + (proximos3.length===1?'':'s') + ' por vencer en los próximos 3 días</strong>' +
        '<p>Revisa el semáforo de abajo para marcarlos como pagados a tiempo.</p></div>' +
      '</div>';
  } else {
    bannerEl.innerHTML = '';
  }

  // semaforo list: vencidos primero, luego pendientes ordenados por fecha, pagados recientes al final (excluidos por simplicidad salvo pagados de próximos 7 días)
  var listaOrdenada = vencidos.concat(pendientes.filter(function(o){ return statusOf(o).dias >= 0; }));
  var listaHtml = listaOrdenada.slice(0, 40).map(occRowHtml).join('');
  var esVacioTotal = data.fixedExpenses.length===0 && data.variableExpenses.length===0 &&
                      data.debts.length===0 && data.savingsGoals.length===0;
  document.getElementById('semaforoList').innerHTML = listaHtml
    ? listaHtml
    : (esVacioTotal ? miniGuiaHtml() : '<div class="empty-state">🎉 ¡Estás al día! No tienes pagos pendientes por ahora.</div>');

  renderBannerEjemplo();
  renderBannerBackup();
  renderBarraCategorias();
  renderGraficosResumen(today);
}

// ---------- barra de porcentajes por categoría (§2.4) ----------
// Agrupa por categoría real (id) y, en modo "Todo el mes", también por dos
// grupos pseudo-categoría (Ahorro/Deuda) ya que esas ocurrencias no tienen
// categoriaId — se les da el mismo color fijo que ya usan en el resto de la
// app (calendario, gráficos) para que la lectura sea consistente.
function computeBarraGrupos(modo, today){
  var grupos = {};
  function addGrupo(key, label, color, monto, origen){
    if(!grupos[key]) grupos[key] = {key:key, label:label, color:color, diario:0, programado:0};
    grupos[key][origen] += monto;
  }
  function enEsteMes(fecha){
    return fecha.getMonth()===today.getMonth() && fecha.getFullYear()===today.getFullYear();
  }

  data.dailyExpenses.forEach(function(e){
    var f = parseDateLocal(e.fecha);
    if(!enEsteMes(f)) return;
    var cat = getCategoria(e.categoriaId);
    addGrupo(e.categoriaId || '__sin_categoria', cat ? cat.nombre : 'Sin categoría', cat ? cat.color : '#c3c2b7', e.monto, 'diario');
  });

  if(modo === 'todo'){
    getTrackedOccurrences().forEach(function(o){
      if(!o.pagado || !enEsteMes(o.fecha)) return;
      var cat = getCategoria(o.categoriaId);
      addGrupo(o.categoriaId || '__sin_categoria', cat ? cat.nombre : 'Sin categoría', cat ? cat.color : '#c3c2b7', o.monto, 'programado');
    });
    getTrackedDebtOccurrences().forEach(function(o){
      if(!o.pagado || !enEsteMes(o.fecha)) return;
      addGrupo('__deuda', '💳 Deuda', DEBT_COLOR, o.monto, 'programado');
    });
    getTrackedAhorroOccurrences().forEach(function(o){
      if(!o.pagado || !enEsteMes(o.fecha)) return;
      addGrupo('__ahorro', '🐷 Ahorro', SAVINGS_COLOR, o.monto, 'programado');
    });
  }

  return Object.keys(grupos).map(function(k){ return grupos[k]; });
}

export function renderBarraCategorias(){
  var barEl = document.getElementById('dailyBar');
  var legendEl = document.getElementById('dailyBarLegend');
  var toggleEl = document.getElementById('dailyBarToggle');
  if(!barEl || !legendEl) return;

  var modo = (data.prefBarraAlcance === 'todo') ? 'todo' : 'diarios';
  if(toggleEl){
    toggleEl.querySelectorAll('button').forEach(function(b){
      b.classList.toggle('active', b.dataset.modo === modo);
    });
  }

  var today = startOfDay(new Date());
  var grupos = computeBarraGrupos(modo, today);
  grupos.forEach(function(g){ g.total = modo==='todo' ? g.diario+g.programado : g.diario; });
  grupos = grupos.filter(function(g){ return g.total > 0; });
  var totalGeneral = grupos.reduce(function(s,g){ return s+g.total; }, 0);

  if(totalGeneral <= 0){
    barEl.innerHTML = '';
    legendEl.innerHTML = '<div class="empty-state" style="padding:10px 6px;">Aún no hay gastos '+(modo==='todo' ? 'este mes.' : 'diarios este mes.')+'</div>';
    return;
  }

  grupos.forEach(function(g){ g.pct = g.total/totalGeneral*100; });
  grupos.sort(function(a,b){ return b.total - a.total; });

  // Segmentos menores al 3% se agrupan en "Otros" para que la barra no se
  // vuelva ilegible con muchas categorías pequeñas.
  var principales = grupos.filter(function(g){ return g.pct >= 3; });
  var menores = grupos.filter(function(g){ return g.pct < 3; });
  if(menores.length){
    var otros = {
      key: '__otros', keys: menores.map(function(g){ return g.key; }),
      label: 'Otros', color: '#8d9099',
      diario: menores.reduce(function(s,g){ return s+g.diario; }, 0),
      programado: menores.reduce(function(s,g){ return s+g.programado; }, 0)
    };
    otros.total = otros.diario + otros.programado;
    otros.pct = otros.total/totalGeneral*100;
    principales.push(otros);
  }
  principales.forEach(function(g){ if(!g.keys) g.keys = [g.key]; });

  barEl.innerHTML = principales.map(function(g){
    var pctDiarioLocal = g.total > 0 ? (g.diario/g.total*100) : 0;
    var pctProgLocal = 100 - pctDiarioLocal;
    var partes = '<div class="daily-bar-part" style="width:'+pctDiarioLocal.toFixed(2)+'%;background:'+g.color+';"></div>';
    if(modo === 'todo' && g.programado > 0){
      partes += '<div class="daily-bar-part programado" style="width:'+pctProgLocal.toFixed(2)+'%;background-color:'+g.color+';"></div>';
    }
    return '<div class="daily-bar-seg" style="width:'+g.pct.toFixed(2)+'%;" data-action="filtrar-diario-categoria" ' +
      'data-catid="'+g.keys.join(',')+'" data-label="'+escapeHtml(g.label)+'" title="'+escapeHtml(g.label)+' · '+Math.round(g.pct)+'%">' +
      partes + '</div>';
  }).join('');

  legendEl.innerHTML = principales.map(function(g){
    var activo = !!(state.dailyFiltroCategorias && state.dailyFiltroCategorias.join(',') === g.keys.join(','));
    return '<button type="button" class="daily-bar-legend-item'+(activo?' active':'')+'" data-action="filtrar-diario-categoria" ' +
      'data-catid="'+g.keys.join(',')+'" data-label="'+escapeHtml(g.label)+'">' +
      '<span class="dot" style="background:'+g.color+'"></span>' +
      '<span class="label">'+escapeHtml(g.label)+'</span>' +
      '<span class="monto">'+currency.format(g.total)+'</span>' +
      '<span class="pct">'+Math.round(g.pct)+'%</span>' +
    '</button>';
  }).join('');
}

export function miniGuiaHtml(){
  return '<div class="mini-guia">' +
    '<span class="mini-guia-step" data-action="ir-tab" data-tab="categorias" role="button" tabindex="0">1️⃣ Crea una categoría</span>' +
    '<span class="mini-guia-arrow">→</span>' +
    '<span class="mini-guia-step" data-action="ir-tab" data-tab="gastos" role="button" tabindex="0">2️⃣ Agrega tu primer gasto</span>' +
    '<span class="mini-guia-arrow">→</span>' +
    '<span class="mini-guia-step" data-action="ir-tab" data-tab="resumen" role="button" tabindex="0">3️⃣ Vuelve aquí y míralo en el semáforo</span>' +
  '</div>';
}

export function renderBannerEjemplo(){
  var el = document.getElementById('datosEjemploBanner');
  if(!el) return;
  el.innerHTML = data.esDatosEjemplo
    ? '<div class="banner-ejemplo">' +
        '<strong>👋 Estos son datos de ejemplo</strong>' +
        '<p>Para que veas cómo funciona la app. Cuando quieras, empieza con tu propia información.</p>' +
        '<button class="btn secondary small" data-action="empezar-desde-cero">Empezar desde cero</button>' +
      '</div>'
    : '';
}

export function empezarDesdeCero(){
  if(!confirm('Se borran los ejemplos y empiezas con tu propia información. ¿Listo?')) return;
  data.categories = [];
  data.fixedExpenses = [];
  data.variableExpenses = [];
  data.esDatosEjemplo = false;
  saveData();
  renderAll();
  showToast('Listo. Empieza por crear tu primera categoría. 🏷️');
}

// Recordatorio de copia de seguridad: una vez por sesión, si hay 15+
// registros y nunca se ha exportado. "No volver a mostrar en la sesión"
// se controla con una variable en memoria (state), nunca en localStorage.
export function renderBannerBackup(){
  var el = document.getElementById('backupBanner');
  if(!el) return;
  var totalRegistros = data.fixedExpenses.length + data.variableExpenses.length + data.debts.length + data.savingsGoals.length;
  var mostrar = !state.backupBannerCerrado && totalRegistros >= 15 && !data.ultimaExportacion;
  el.innerHTML = mostrar
    ? '<div class="banner-backup">' +
        '<p>💾 Llevas bastante información y aún no has guardado una copia de seguridad.</p>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<button class="btn secondary small" data-action="ir-tab" data-tab="ajustes">Ir a Ajustes</button>' +
          '<button class="btn-cerrar-backup" data-action="cerrar-banner-backup" title="Cerrar">✕</button>' +
        '</div>' +
      '</div>'
    : '';
}

// Chanchito de ahorro (progreso total ahorrado / meta total) y frasco de
// gastos (pagado / total de este mes). Solo se actualizan los atributos
// que cambian (el "transform" del relleno y los textos), no toda la
// tarjeta, para que la transición CSS del relleno se vea animada.
export function renderGraficosResumen(today){
  var totalMetaAhorro = 0, totalAhorradoTotal = 0;
  data.savingsGoals.forEach(function(g){
    totalMetaAhorro += (g.metaTotal || 0);
    totalAhorradoTotal += totalAhorradoDeMeta(g);
  });
  var pctAhorro = totalMetaAhorro > 0 ? Math.max(0, Math.min(100, (totalAhorradoTotal/totalMetaAhorro)*100)) : 0;
  var rectAhorro = document.getElementById('ahorroFillRect');
  if(rectAhorro) rectAhorro.style.transform = 'scaleY(' + (pctAhorro/100).toFixed(3) + ')';
  var elPctAhorro = document.getElementById('ahorroGraphPercent');
  if(elPctAhorro) elPctAhorro.textContent = Math.round(pctAhorro) + '%';
  var elCapAhorro = document.getElementById('ahorroGraphCaption');
  if(elCapAhorro){
    elCapAhorro.textContent = data.savingsGoals.length === 0
      ? 'Aún no tienes metas de ahorro. Toca aquí para crear la primera.'
      : (currency.format(totalAhorradoTotal) + ' ahorrados de ' + currency.format(totalMetaAhorro));
  }

  // Bolsa de gastos: las cuotas de deuda NO entran aquí (tienen su propio
  // gráfico) — solo gastos fijos y variables del mes. Semántica invertida:
  // el relleno representa lo que FALTA por pagar (empieza llena, se vacía).
  var occsMes = getTrackedOccurrences().filter(function(o){
    return o.fecha.getMonth()===today.getMonth() && o.fecha.getFullYear()===today.getFullYear();
  });
  var totalGastosMes = occsMes.reduce(function(s,o){ return s+o.monto; },0);
  var pendienteGastosMes = occsMes.filter(function(o){ return !o.pagado; }).reduce(function(s,o){ return s+o.monto; },0);
  var pctGasto = totalGastosMes > 0 ? Math.max(0, Math.min(100, (pendienteGastosMes/totalGastosMes)*100)) : 0;
  var rectGasto = document.getElementById('gastoFillRect');
  if(rectGasto) rectGasto.style.transform = 'scaleY(' + (pctGasto/100).toFixed(3) + ')';
  var elPctGasto = document.getElementById('gastoGraphPercent');
  if(elPctGasto) elPctGasto.textContent = totalGastosMes > 0 ? (Math.round(pctGasto) + '%') : '—';
  var elCapGasto = document.getElementById('gastoGraphCaption');
  if(elCapGasto){
    elCapGasto.textContent = totalGastosMes === 0
      ? 'No tienes gastos registrados este mes.'
      : (pendienteGastosMes === 0
          ? '🎉 ¡Todo pagado este mes!'
          : (currency.format(pendienteGastosMes) + ' por pagar de ' + currency.format(totalGastosMes) + ' este mes'));
  }

  // Bolsa de deudas: el relleno representa la deuda total que queda —
  // empieza llena y se vacía conforme se paga deuda (mismo objetivo que
  // la bolsa de gastos: vaciarse).
  var debtsActivas = data.debts.filter(function(d){ return d.activo; });
  var totalSaldoInicial = debtsActivas.reduce(function(s,d){ return s+(d.saldoInicial||0); },0);
  var totalSaldoActual = debtsActivas.reduce(function(s,d){ return s+(d.saldoActual||0); },0);
  var pctDeuda = totalSaldoInicial > 0 ? Math.max(0, Math.min(100, (totalSaldoActual/totalSaldoInicial)*100)) : 0;
  var rectDeuda = document.getElementById('deudaFillRect');
  if(rectDeuda) rectDeuda.style.transform = 'scaleY(' + (pctDeuda/100).toFixed(3) + ')';
  var elPctDeuda = document.getElementById('deudaGraphPercent');
  if(elPctDeuda) elPctDeuda.textContent = totalSaldoInicial > 0 ? (Math.round(pctDeuda) + '%') : '—';
  var elCapDeuda = document.getElementById('deudaGraphCaption');
  if(elCapDeuda){
    if(debtsActivas.length === 0){
      elCapDeuda.textContent = 'No tienes deudas registradas. 🎉';
    } else if(totalSaldoActual <= 0){
      elCapDeuda.textContent = '🎉 ¡Libre de deudas!';
    } else {
      elCapDeuda.textContent = currency.format(totalSaldoActual) + ' de deuda restante (empezaste con ' + currency.format(totalSaldoInicial) + ')';
    }
  }
}

export function statTile(num, label, changed){
  return '<div class="stat-tile"><div class="num'+(changed?' bump':'')+'">'+num+'</div><div class="label">'+label+'</div></div>';
}

// ---------- notificaciones ----------
export function updateNotiEstado(){
  var el = document.getElementById('notiEstado');
  var btn = document.getElementById('btnActivarNotis');
  if(!('Notification' in window)){
    el.textContent = 'Tu navegador no soporta notificaciones.';
    btn.disabled = true;
    return;
  }
  if(Notification.permission === 'granted'){
    el.textContent = '✅ Notificaciones activadas.';
    btn.disabled = true;
  } else if(Notification.permission === 'denied'){
    el.textContent = '🚫 Bloqueadas por el navegador. Actívalas desde la configuración del sitio.';
    btn.disabled = true;
  } else {
    el.textContent = 'Aún no activadas.';
    btn.disabled = false;
  }
}

export function checkReminders(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  var today = startOfDay(new Date());
  var occs = getTrackedOccurrences().concat(getTrackedAhorroOccurrences()).concat(getTrackedDebtOccurrences());
  var todayKey = dateKey(today);
  occs.forEach(function(o){
    if(o.pagado) return;
    var st = statusOf(o);
    if(st.dias < 0 || st.dias > 3) return;
    var logKey = o.occId + '|' + todayKey;
    if(data.notifiedLog[logKey]) return;
    try{
      new Notification('Recordatorio de pago', {
        body: o.nombre + ' — ' + currency.format(o.monto) + ' — ' + st.label
      });
    }catch(err){ /* ignore */ }
    data.notifiedLog[logKey] = true;
  });
  saveData();
}

// ---------- Indicador externo (datos.gov.co) ----------
function indicadorValorHtml(cache){
  var valorNum = Number(cache.valor);
  var valorTexto = isNaN(valorNum) ? escapeHtml(String(cache.valor)) : currencyDecimal.format(valorNum);
  var fDesde = cache.vigenciaDesde ? fechaCorta(new Date(cache.vigenciaDesde)) : '';
  var fHasta = cache.vigenciaHasta ? fechaCorta(new Date(cache.vigenciaHasta)) : '';
  var vigenciaTexto = (fDesde || fHasta) ? ('Vigente: ' + (fDesde || '—') + ' — ' + (fHasta || '—')) : '';
  var actualizadoTexto = cache.actualizadoEn ? ('Consultado el ' + formatFechaHoraCorta(cache.actualizadoEn)) : '';
  return '<p style="margin:0 0 2px;font-size:1.15rem;font-weight:700;">' + valorTexto +
      ' <span class="small muted" style="font-weight:500;">' + escapeHtml(cache.unidad || '') + '</span></p>' +
    (vigenciaTexto ? '<p class="small muted" style="margin:0;">' + vigenciaTexto + '</p>' : '') +
    (actualizadoTexto ? '<p class="small muted" style="margin:2px 0 0;">' + actualizadoTexto + '</p>' : '');
}

export function renderIndicadorUI(){
  var el = document.getElementById('indicadorContenido');
  if(!el) return;
  var cache = data.indicadorExterno;
  var html;
  if(state.indicador.cargando){
    html = '<p class="small muted" style="margin:0;">⏳ Cargando valor actual...</p>';
  } else if(state.indicador.error){
    if(cache){
      html =
        '<p class="small" style="color:var(--warning);margin:0 0 6px;">⚠️ No se pudo conectar con el servicio ahora mismo (' + escapeHtml(state.indicador.error) + '). Mostrando el último valor conocido.</p>' +
        indicadorValorHtml(cache);
    } else {
      html = '<p class="small" style="color:#e66767;margin:0;">🚫 No hay datos disponibles: no fue posible conectar con datos.gov.co (' + escapeHtml(state.indicador.error) + ') y todavía no existe un valor guardado. Verifica tu conexión e intenta Actualizar de nuevo.</p>';
    }
  } else if(cache){
    html = indicadorValorHtml(cache);
  } else {
    html = '<p class="small muted" style="margin:0;">Sin datos todavía. Presiona Actualizar para consultar el servicio.</p>';
  }
  el.innerHTML = html;
}

export function actualizarIndicador(){
  state.indicador.cargando = true;
  state.indicador.error = null;
  renderIndicadorUI();

  var controller = ('AbortController' in window) ? new AbortController() : null;
  var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, 12000) : null;

  fetch(INDICADOR_URL, controller ? {signal: controller.signal} : {})
    .then(function(resp){
      if(!resp.ok) throw new Error('el servicio respondió con error ' + resp.status);
      return resp.json();
    })
    .then(function(json){
      if(!Array.isArray(json) || json.length === 0 || !json[0] || typeof json[0].valor === 'undefined'){
        throw new Error('el servicio no devolvió datos de valor');
      }
      var item = json[0];
      data.indicadorExterno = {
        valor: item.valor, unidad: item.unidad || '',
        vigenciaDesde: item.vigenciadesde || '', vigenciaHasta: item.vigenciahasta || '',
        actualizadoEn: new Date().toISOString()
      };
      saveData();
      state.indicador.cargando = false;
      state.indicador.error = null;
    })
    .catch(function(err){
      state.indicador.cargando = false;
      state.indicador.error = (err && err.name === 'AbortError') ? 'tiempo de espera agotado' : ((err && err.message) ? err.message : 'error de conexión');
    })
    .finally(function(){
      if(timeoutId) clearTimeout(timeoutId);
      renderIndicadorUI();
    });
}

export function borrarTodo(){
  if(!confirm('Esto eliminará TODOS tus gastos y categorías guardados en este navegador. ¿Continuar?')) return;
  localStorage.removeItem(STORAGE_KEY);
  assignData(seedData());
  migrateData();
  saveData();
  renderAll();
  document.getElementById('perfilNombre').value = data.perfilNombre || '';
  showToast('Datos borrados. Se cargaron los ejemplos de nuevo.');
}

// ---------- master render ----------
export function renderAll(){
  populateCategoriaFilters();
  populateCategoriaSelect();
  renderResumen();
  renderDaily();
  renderCalendario();
  renderListaGastos();
  renderAhorros();
  renderDeudas();
  renderCategorias();
}

// ---------- event wiring ----------
function wireEvents(){
  document.querySelectorAll('nav.tabs button').forEach(function(b){
    b.addEventListener('click', function(){ switchTab(b.dataset.tab); });
  });
  document.querySelectorAll('.subtabs button').forEach(function(b){
    b.addEventListener('click', function(){
      var parentPanel = b.closest('.panel');
      var section = parentPanel ? parentPanel.id.replace('panel-','') : '';
      switchSubTab(section, b.dataset.subtab);
    });
  });

  document.getElementById('formGasto').addEventListener('submit', handleFormGastoSubmit);
  document.getElementById('btnCancelarEdicion').addEventListener('click', resetForm);
  document.querySelectorAll('input[name=fTipo]').forEach(function(r){
    r.addEventListener('change', updateFechaHint);
  });

  document.getElementById('formAhorro').addEventListener('submit', handleFormAhorroSubmit);
  document.getElementById('btnCancelarEdicionAhorro').addEventListener('click', resetFormAhorro);

  document.getElementById('formDeuda').addEventListener('submit', handleFormDeudaSubmit);
  document.getElementById('btnCancelarEdicionDeuda').addEventListener('click', resetFormDeuda);

  document.getElementById('formCategoria').addEventListener('submit', handleFormCategoriaSubmit);

  document.getElementById('btnVistaMes').addEventListener('click', function(){ state.calView='mes'; renderCalendario(); });
  document.getElementById('btnVistaSemana').addEventListener('click', function(){ state.calView='semana'; renderCalendario(); });
  document.getElementById('btnCalPrev').addEventListener('click', function(){
    state.calAnchor = state.calView==='mes' ? new Date(state.calAnchor.getFullYear(), state.calAnchor.getMonth()-1, 1) : addDaysLocal(state.calAnchor,-7);
    renderCalendario();
  });
  document.getElementById('btnCalNext').addEventListener('click', function(){
    state.calAnchor = state.calView==='mes' ? new Date(state.calAnchor.getFullYear(), state.calAnchor.getMonth()+1, 1) : addDaysLocal(state.calAnchor,7);
    renderCalendario();
  });
  document.getElementById('btnCalHoy').addEventListener('click', function(){
    state.calAnchor = new Date();
    renderCalendario();
  });
  document.getElementById('calFiltroCategoria').addEventListener('change', renderCalendario);
  document.getElementById('calFiltroAmbito').addEventListener('change', renderCalendario);

  ['listFiltroTipo','listFiltroCategoria','listFiltroTipoGasto','listFiltroAmbito','listFiltroEstado'].forEach(function(id){
    document.getElementById(id).addEventListener('change', renderListaGastos);
  });
  document.getElementById('listBusqueda').addEventListener('input', renderListaGastos);

  document.getElementById('btnActivarNotis').addEventListener('click', function(){
    Notification.requestPermission().then(function(){ updateNotiEstado(); checkReminders(); });
  });

  document.getElementById('btnExportar').addEventListener('click', exportarDatos);
  document.getElementById('btnImportarTrigger').addEventListener('click', function(){
    document.getElementById('inputImportar').click();
  });
  document.getElementById('inputImportar').addEventListener('change', function(e){
    if(e.target.files[0]) importarDatos(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('btnExportarCsv').addEventListener('click', exportarCsv);
  document.getElementById('btnImportarCsvTrigger').addEventListener('click', function(){
    document.getElementById('inputImportarCsv').click();
  });
  document.getElementById('inputImportarCsv').addEventListener('change', function(e){
    if(e.target.files[0]) importarCsv(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('btnImprimir').addEventListener('click', imprimirReporte);
  document.getElementById('perfilNombre').addEventListener('change', function(){
    data.perfilNombre = document.getElementById('perfilNombre').value;
    saveData();
  });

  document.getElementById('btnBorrarTodo').addEventListener('click', borrarTodo);
  document.getElementById('btnRefrescarIndicador').addEventListener('click', actualizarIndicador);

  document.getElementById('modalOverlay').addEventListener('click', function(e){
    if(e.target.id === 'modalOverlay') closeModal();
  });

  // delegated clicks for occurrence rows, calendar cells, modal close, category delete
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-action]');
    if(!el) return;
    var action = el.dataset.action;
    if(action === 'pagar' || action === 'despagar'){
      markPaidByIds(el.dataset.tipo, el.dataset.expid, el.dataset.period, action==='pagar');
    } else if(action === 'abrir-pago-fijo'){
      abrirModalPagoFijo(el.dataset.expid, el.dataset.period, el.dataset.monto, el.dataset.nombre);
    } else if(action === 'confirmar-pago-fijo'){
      var montoInput = document.getElementById('confirmMontoInput');
      var val = Number(montoInput.value);
      if(montoInput.value === '' || isNaN(val) || val < 0){
        alert('Ingresa un monto válido.');
        return;
      }
      markPaidByIds('fijo', el.dataset.expid, el.dataset.period, true, val);
      closeModal();
    } else if(action === 'abrir-pago-deuda'){
      abrirModalPagoDeuda(el.dataset.expid);
    } else if(action === 'confirmar-pago-deuda'){
      var mInput = document.getElementById('deudaMontoInput');
      var sInput = document.getElementById('deudaSaldoInput');
      var montoPagado = Number(mInput.value);
      var nuevoSaldo = Number(sInput.value);
      if(mInput.value === '' || isNaN(montoPagado) || montoPagado <= 0){
        alert('El monto pagado debe ser un número mayor a cero.');
        return;
      }
      if(sInput.value === '' || isNaN(nuevoSaldo) || nuevoSaldo < 0){
        alert('El nuevo saldo debe ser un número mayor o igual a cero.');
        return;
      }
      registrarPagoDeuda(el.dataset.expid, montoPagado, nuevoSaldo);
      closeModal();
    } else if(action === 'abrir-abono-extra'){
      abrirModalAbonoExtra(el.dataset.expid);
    } else if(action === 'confirmar-abono-extra'){
      var abonoInput = document.getElementById('abonoExtraInput');
      var abonoVal = Number(abonoInput.value);
      if(abonoInput.value === '' || isNaN(abonoVal) || abonoVal <= 0){
        alert('El monto del abono debe ser un número mayor a cero.');
        return;
      }
      registrarAbonoExtra(el.dataset.expid, abonoVal);
      closeModal();
    } else if(action === 'editar'){
      fillFormForEdit(el.dataset.tipo, el.dataset.expid);
    } else if(action === 'eliminar'){
      var tipoDel = el.dataset.tipo;
      var expidDel = el.dataset.expid;
      var esDeudaDel = tipoDel === 'deuda';
      var msgConfirmDel = esDeudaDel
        ? '¿Eliminar esta deuda? Se borra también su historial de pagos. Esta acción no se puede deshacer.'
        : '¿Eliminar este gasto? Esta acción no se puede deshacer.';
      if(confirm(msgConfirmDel)){
        if(tipoDel === 'fijo' || tipoDel === 'variable'){
          // Para gastos fijos/variables ofrecemos un "Deshacer" de 6s (no
          // así para deudas/metas, donde basta el confirm).
          var respaldo = eliminarConRespaldo(tipoDel, expidDel);
          renderAll();
          if(respaldo){
            showToastAccion('Gasto eliminado.', 'Deshacer', function(){
              restaurarGastoEliminado(tipoDel, respaldo);
            }, 6000);
          } else {
            showToast('Gasto eliminado.');
          }
        } else {
          removeExpense(tipoDel, expidDel);
          renderAll();
          showToast(esDeudaDel ? 'Deuda eliminada.' : 'Gasto eliminado.');
        }
      }
    } else if(action === 'ver-dia'){
      openDiaModal(el.dataset.fecha);
    } else if(action === 'cerrar-modal'){
      closeModal();
    } else if(action === 'eliminar-categoria'){
      eliminarCategoria(el.dataset.id);
    } else if(action === 'editar-presupuesto-categoria'){
      abrirModalPresupuestoCategoria(el.dataset.id);
    } else if(action === 'confirmar-presupuesto-categoria'){
      var presupuestoInput = document.getElementById('presupuestoInput');
      if(guardarPresupuestoCategoria(el.dataset.id, presupuestoInput.value)){
        closeModal();
      }
    } else if(action === 'confirmar-reasignar-categoria'){
      var destinoSel = document.getElementById('reasignarCategoriaSelect');
      reasignarYEliminarCategoria(el.dataset.catid, destinoSel.value);
      closeModal();
    } else if(action === 'registro-diario'){
      abrirHojaGastoDiario({categoriaId: el.dataset.catid});
    } else if(action === 'registro-diario-otra'){
      abrirHojaGastoDiario({});
    } else if(action === 'editar-diario'){
      abrirHojaGastoDiario({editId: el.dataset.id});
    } else if(action === 'eliminar-diario'){
      var respaldoDiario = eliminarDailyConRespaldo(el.dataset.id);
      renderAll();
      if(respaldoDiario){
        showToastAccion('Gasto eliminado.', 'Deshacer', function(){
          restaurarDailyEliminado(respaldoDiario);
        }, 6000);
      }
    } else if(action === 'ver-todos-diario'){
      abrirVistaCompletaMesDiario();
    } else if(action === 'cambiar-alcance-diario'){
      data.prefBarraAlcance = el.dataset.modo;
      state.dailyFiltroCategorias = null;
      state.dailyFiltroLabel = null;
      saveData();
      renderBarraCategorias();
      renderUltimosRegistros();
    } else if(action === 'filtrar-diario-categoria'){
      var clavesFiltro = el.dataset.catid.split(',');
      var yaActivo = state.dailyFiltroCategorias && state.dailyFiltroCategorias.join(',') === clavesFiltro.join(',');
      if(yaActivo){
        state.dailyFiltroCategorias = null;
        state.dailyFiltroLabel = null;
      } else {
        state.dailyFiltroCategorias = clavesFiltro;
        state.dailyFiltroLabel = el.dataset.label || null;
      }
      renderBarraCategorias();
      renderUltimosRegistros();
    } else if(action === 'quitar-filtro-diario'){
      state.dailyFiltroCategorias = null;
      state.dailyFiltroLabel = null;
      renderBarraCategorias();
      renderUltimosRegistros();
    } else if(action === 'ir-tab'){
      switchTab(el.dataset.tab);
    } else if(action === 'empezar-desde-cero'){
      empezarDesdeCero();
    } else if(action === 'cerrar-banner-backup'){
      state.backupBannerCerrado = true;
      renderBannerBackup();
    }
  });

  // Las tarjetas de gráficos (chanchito de ahorro / frasco de gastos) son
  // interactivas: también se pueden activar con teclado (Enter/Espacio).
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest('[data-action="ir-tab"]');
    if(!el) return;
    e.preventDefault();
    switchTab(el.dataset.tab);
  });
}

function addDaysLocal(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }

// ---------- init ----------
function init(){
  assignData(loadData());
  try{ migrateData(); }catch(err){ /* no bloquear el arranque por un dato con forma inesperada */ }
  saveData();

  // wireEvents() va primero y fuera de cualquier try/catch posterior: así,
  // aunque algo falle más abajo (render inicial, consulta al indicador,
  // etc.), los botones ya quedaron conectados y "Guardar" sigue
  // funcionando en vez de no responder.
  wireEvents();

  try{
    document.getElementById('fechaHoyTexto').textContent = 'Hoy es ' + fechaLarga(new Date());
    document.getElementById('catColor').value = nextCategoryColor();
    document.getElementById('perfilNombre').value = data.perfilNombre || '';
    document.getElementById('dFecha').value = dateKey(new Date());
    document.getElementById('fFecha').value = dateKey(new Date());
    updateFechaHint();
    updateNotiEstado();
    renderAll();
    renderIndicadorUI();
    actualizarIndicador();
    checkReminders();
    setInterval(checkReminders, 60*60*1000);
  }catch(err){
    alert('Ocurrió un problema mostrando algunos datos al abrir la app. Los botones deberían seguir funcionando; si la pantalla se ve vacía o rara, recarga la página.');
  }

  if(!getStorageDisponible()){
    alert('Este navegador o esta vista no permite guardar datos de forma permanente (almacenamiento local bloqueado). Puedes seguir usando la app en esta sesión, pero lo que agregues se perderá al recargar o cerrar la página. Para guardar de verdad, abre este archivo en un navegador normal (no dentro de una vista previa/sandbox) y no en modo privado.');
  }
}

document.addEventListener('DOMContentLoaded', init);
