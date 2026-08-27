// Asistente financiero (chat con Gemini): responde preguntas sobre los
// datos ya guardados y puede proponer el registro de un gasto diario, que
// el usuario debe confirmar antes de que se guarde nada.
"use strict";

import {
  escapeHtml, currency, fechaCorta, dateKey, parseDateLocal,
  openModal, showToast
} from './utils.js';
import { data } from './store.js';
import { getGeminiApiKey, listarModelosGemini } from './ai.js';
import { getCategoria, resolverOCrearCategoriaPorNombre } from './categories.js';
import { registrarGastoDiario } from './daily.js';
import { renderAll } from './app.js';

// Qué modelo exacto expone "gemini-2.0-flash" (o cualquier otro) varía según
// la cuenta y la región de cada clave — nunca es seguro suponer un nombre
// fijo. En vez de adivinar, se le pregunta a Google la lista de modelos
// disponibles para ESA clave y se elige uno que sirva para generar texto,
// cacheado en memoria mientras no cambie la clave guardada.
var modeloCache = null; // {apiKey, nombre}

function elegirModeloParaChat(apiKey){
  if(modeloCache && modeloCache.apiKey === apiKey) return Promise.resolve(modeloCache.nombre);
  return listarModelosGemini(apiKey).then(function(modelos){
    var candidatos = modelos.filter(function(m){
      return Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
    });
    if(!candidatos.length){
      throw new Error('tu clave no tiene ningún modelo disponible para generar texto.');
    }
    // Se prefiere un modelo "flash" (rápido y económico) que no sea de
    // visión/embeddings; si no hay ninguno así, se usa el primero que sirva.
    var elegido = candidatos.find(function(m){ return /flash/i.test(m.name) && !/vision|embed/i.test(m.name); })
      || candidatos.find(function(m){ return /flash/i.test(m.name); })
      || candidatos[0];
    modeloCache = {apiKey: apiKey, nombre: elegido.name}; // ya viene como "models/xxx"
    return modeloCache.nombre;
  });
}

var RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    respuesta: {type: 'STRING'},
    accion: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        tipo: {type: 'STRING', enum: ['registrar_gasto_diario']},
        monto: {type: 'NUMBER'},
        categoriaId: {type: 'STRING', nullable: true},
        categoriaNombre: {type: 'STRING', nullable: true},
        nota: {type: 'STRING', nullable: true},
        fecha: {type: 'STRING', nullable: true}
      },
      required: ['tipo', 'monto']
    }
  },
  required: ['respuesta']
};

// historial: [{role:'user'|'model', text, accion, accionEstado}]
// Vive solo en memoria — se reinicia al recargar la página, a propósito
// (no hay razón para persistir la conversación entre sesiones todavía).
var historial = [];

function resumenPagos(pagosPorMes){
  return Object.keys(pagosPorMes || {}).filter(function(pk){
    return pagosPorMes[pk] && pagosPorMes[pk].pagado;
  });
}

// Todo el historial del usuario, en un JSON compacto — es el contexto que
// ve la IA en cada pregunta (se reconstruye desde `data` en cada llamada,
// así que siempre refleja lo último guardado, aunque haya cambiado a mitad
// de la conversación).
function construirContextoFinanciero(){
  return JSON.stringify({
    hoy: dateKey(new Date()),
    categorias: data.categories.map(function(c){
      return {id: c.id, nombre: c.nombre, presupuestoMensual: c.presupuestoMensual};
    }),
    gastosDiarios: data.dailyExpenses.map(function(e){
      return {categoriaId: e.categoriaId, monto: e.monto, nota: e.nota, fecha: e.fecha};
    }),
    gastosFijos: data.fixedExpenses.map(function(e){
      return {nombre: e.nombre, monto: e.monto, categoriaId: e.categoriaId, diaMes: e.diaMes, activo: e.activo, pagosPagados: resumenPagos(e.pagosPorMes)};
    }),
    gastosVariables: data.variableExpenses.map(function(e){
      return {nombre: e.nombre, monto: e.monto, categoriaId: e.categoriaId, fecha: e.fecha, pagado: e.pagado};
    }),
    metasAhorro: data.savingsGoals.map(function(g){
      return {nombre: g.nombre, metaTotal: g.metaTotal, montoMensual: g.montoMensual, pagosPagados: resumenPagos(g.pagosPorMes)};
    }),
    deudas: data.debts.map(function(d){
      return {nombre: d.nombre, saldoActual: d.saldoActual, cuotaMensual: d.cuotaMensual, pagosPagados: resumenPagos(d.pagosPorMes)};
    })
  });
}

function construirSystemInstruction(){
  return (
    'Eres el asistente financiero de la app "Control de Pagos". Respondes SIEMPRE en español, ' +
    'breve y claro, sobre las finanzas personales del usuario. Los montos están en pesos colombianos (COP). ' +
    'Usa ÚNICAMENTE los datos que te doy a continuación — nunca inventes cifras que no estén ahí. ' +
    'Hoy es ' + dateKey(new Date()) + '.\n\n' +
    'Datos del usuario (JSON): ' + construirContextoFinanciero() + '\n\n' +
    'Si el usuario te pide registrar un gasto diario (ej. "gasté 15 mil en mercado", "anota 20000 de taxi ayer"), ' +
    'propónlo en el campo "accion" — NO lo des por hecho, el usuario debe confirmarlo en la app antes de guardarse. ' +
    'Para la categoría: usa el id de una categoría EXISTENTE de la lista si aplica razonablemente; si ninguna encaja, ' +
    'deja categoriaId en null y sugiere un nombre nuevo en categoriaNombre. Si el usuario solo pregunta algo, deja "accion" en null.'
  );
}

function construirContentsDesdeHistorial(){
  return historial.filter(function(m){ return !m.esPlaceholder; }).map(function(m){
    return {role: m.role, parts: [{text: m.text}]};
  });
}

function llamarGemini(apiKey, contents){
  return elegirModeloParaChat(apiKey).then(function(modeloNombre){
    var url = 'https://generativelanguage.googleapis.com/v1beta/' + modeloNombre + ':generateContent?key=' + encodeURIComponent(apiKey);
    var body = {
      systemInstruction: {parts: [{text: construirSystemInstruction()}]},
      contents: contents,
      generationConfig: {responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA}
    };
    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, 30000) : null;
    var opts = {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
    if(controller) opts.signal = controller.signal;
    return fetch(url, opts)
      .then(function(resp){
        if(resp.status === 400 || resp.status === 403){
          throw new Error('la clave de Gemini fue rechazada. Revísala en Ajustes.');
        }
        if(resp.status === 404){
          // El modelo cacheado dejó de existir (ej. Google lo retiró a
          // mitad de sesión) — se descarta el caché para que el próximo
          // intento vuelva a preguntar la lista vigente.
          modeloCache = null;
          throw new Error('el modelo de IA ya no está disponible. Intenta de nuevo.');
        }
        if(!resp.ok){
          throw new Error('el servicio respondió con error ' + resp.status);
        }
        return resp.json();
      })
      .then(function(json){
        var candidato = json.candidates && json.candidates[0];
        var texto = candidato && candidato.content && candidato.content.parts && candidato.content.parts[0] && candidato.content.parts[0].text;
        if(!texto){
          if(candidato && candidato.finishReason === 'SAFETY'){
            throw new Error('la respuesta fue bloqueada por los filtros de seguridad de Google.');
          }
          throw new Error('el modelo no devolvió una respuesta.');
        }
        var parsed;
        try{ parsed = JSON.parse(texto); }catch(err){ throw new Error('el modelo devolvió una respuesta con formato inesperado.'); }
        return parsed;
      })
      .catch(function(err){
        if(err && err.name === 'AbortError') throw new Error('tiempo de espera agotado. Intenta de nuevo.');
        throw err;
      })
      .finally(function(){
        if(timeoutId) clearTimeout(timeoutId);
      });
  });
}

// ---------- UI ----------
function chatModalHtml(){
  return (
    '<button class="modal-close" data-action="cerrar-modal">✕</button>' +
    '<h3 style="margin:0 0 4px;">🤖 Asistente financiero</h3>' +
    '<p class="small muted" style="margin:0 0 10px;">Pregunta sobre tus finanzas guardadas, o pídele que registre un gasto — te lo mostrará antes de guardarlo.</p>' +
    '<div id="chatMensajes" class="chat-mensajes"></div>' +
    '<form id="chatForm" class="chat-form">' +
      '<input type="text" id="chatInput" placeholder="Ej: ¿cuánto llevo gastado en Mercado este mes?" autocomplete="off">' +
      '<button type="submit" class="btn small" id="chatEnviarBtn">Enviar</button>' +
    '</form>' +
    '<div style="text-align:right;margin-top:6px;">' +
      '<button type="button" class="btn ghost small" id="chatNuevaConversacion">🗑 Nueva conversación</button>' +
    '</div>'
  );
}

function accionCardHtml(accion, idx){
  if(!accion || accion.tipo !== 'registrar_gasto_diario') return '';
  var monto = Number(accion.monto);
  var montoValido = !isNaN(monto) && monto > 0 && monto <= 999999999;
  var cat = accion.categoriaId ? getCategoria(accion.categoriaId) : null;
  var catTexto = null, catColor = '#8d9099';
  if(cat){ catTexto = cat.nombre; catColor = cat.color; }
  else if(accion.categoriaNombre){ catTexto = accion.categoriaNombre + ' (categoría nueva)'; }

  if(!montoValido || !catTexto){
    return '<div class="chat-action-card">' +
      '<div class="chat-action-detail muted">No pude preparar este registro (' +
        (!montoValido ? 'el monto no es válido' : 'falta saber la categoría') +
      '). Cuéntame de nuevo con más detalle.</div>' +
    '</div>';
  }
  var fechaTexto = accion.fecha ? fechaCorta(parseDateLocal(accion.fecha)) : 'hoy';
  return '<div class="chat-action-card">' +
    '<div class="chat-action-title">Registrar gasto diario</div>' +
    '<div class="chat-action-detail">' +
      '<span class="dot" style="background:'+catColor+'"></span> ' +
      escapeHtml(catTexto) + ' · ' + currency.format(monto) + ' · ' + fechaTexto +
      (accion.nota ? (' · '+escapeHtml(accion.nota)) : '') +
    '</div>' +
    '<div class="chat-action-buttons">' +
      '<button type="button" class="btn small" data-action="confirmar-accion-chat" data-msgidx="'+idx+'">Confirmar</button>' +
      '<button type="button" class="btn secondary small" data-action="cancelar-accion-chat" data-msgidx="'+idx+'">Cancelar</button>' +
    '</div>' +
  '</div>';
}

function mensajeHtml(m, idx){
  var burbuja = '<div class="chat-msg '+(m.role==='user'?'chat-msg-user':'chat-msg-model')+'">'+escapeHtml(m.text)+'</div>';
  if(m.accion && m.accionEstado === 'pendiente'){
    return burbuja + accionCardHtml(m.accion, idx);
  }
  if(m.accionEstado === 'confirmada'){
    return burbuja + '<div class="chat-action-status ok">✅ Registrado.</div>';
  }
  if(m.accionEstado === 'cancelada'){
    return burbuja + '<div class="chat-action-status">No se registró.</div>';
  }
  return burbuja;
}

function renderMensajes(){
  var el = document.getElementById('chatMensajes');
  if(!el) return;
  if(historial.length === 0){
    el.innerHTML = '<div class="empty-state" style="padding:16px 8px;">👋 Pregúntame algo como "¿cuánto he gastado este mes en Mercado?", o dime "gasté 15 mil en el mercado hoy" para registrarlo.</div>';
    return;
  }
  el.innerHTML = historial.map(function(m, idx){ return mensajeHtml(m, idx); }).join('');
  el.scrollTop = el.scrollHeight;
}

export function abrirChatIA(){
  var key = getGeminiApiKey();
  if(!key){
    alert('Primero guarda tu clave de API de Gemini en Ajustes (al final de la página) para poder usar el asistente.');
    return;
  }
  openModal(chatModalHtml());
  document.getElementById('chatForm').addEventListener('submit', function(e){
    e.preventDefault();
    enviarMensajeUsuario();
  });
  document.getElementById('chatNuevaConversacion').addEventListener('click', function(){
    if(historial.length && !confirm('¿Borrar esta conversación y empezar una nueva?')) return;
    historial = [];
    renderMensajes();
  });
  renderMensajes();
  document.getElementById('chatInput').focus();
}

function enviarMensajeUsuario(){
  var input = document.getElementById('chatInput');
  var texto = input.value.trim();
  if(!texto) return;
  var key = getGeminiApiKey();
  if(!key){ alert('Guarda tu clave de Gemini en Ajustes antes de escribirle al asistente.'); return; }

  historial.push({role: 'user', text: texto});
  var contentsParaEnviar = construirContentsDesdeHistorial();
  input.value = '';
  historial.push({role: 'model', text: '⏳ Pensando...', esPlaceholder: true});
  renderMensajes();
  var idxPlaceholder = historial.length - 1;

  llamarGemini(key, contentsParaEnviar).then(function(parsed){
    historial[idxPlaceholder] = {
      role: 'model',
      text: parsed.respuesta || '(el asistente no devolvió texto)',
      accion: parsed.accion || null,
      accionEstado: parsed.accion ? 'pendiente' : undefined
    };
    renderMensajes();
  }).catch(function(err){
    historial[idxPlaceholder] = {role: 'model', text: '❌ No pude responder: ' + err.message};
    renderMensajes();
  });
}

export function confirmarAccionChat(idx){
  var msg = historial[idx];
  if(!msg || !msg.accion || msg.accionEstado !== 'pendiente') return;
  var accion = msg.accion;
  var monto = Number(accion.monto);
  var categoriaId = (accion.categoriaId && getCategoria(accion.categoriaId)) ? accion.categoriaId : null;
  if(!categoriaId && accion.categoriaNombre){
    categoriaId = resolverOCrearCategoriaPorNombre(accion.categoriaNombre);
  }
  var res = registrarGastoDiario(categoriaId, monto, accion.nota || '', accion.fecha || dateKey(new Date()));
  if(!res.ok){
    alert(res.mensaje);
    return;
  }
  msg.accionEstado = 'confirmada';
  renderAll();
  renderMensajes();
  showToast('Gasto registrado desde el asistente.');
}

export function cancelarAccionChat(idx){
  var msg = historial[idx];
  if(!msg) return;
  msg.accionEstado = 'cancelada';
  renderMensajes();
}
