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
// fijo, ni siquiera confiar en que el primero de la lista funcione para
// generateContent (Google a veces lista modelos que igual rechazan la
// llamada). Por eso: se arma una lista de candidatos ordenada por
// preferencia, y si uno falla con 404 se prueba el siguiente automáticamente.
var modelosCandidatosCache = null; // {apiKey, nombres:[...]}
var ultimoModeloQueFunciono = null; // nombre, para probarlo primero la próxima vez

function obtenerCandidatosModelo(apiKey){
  if(modelosCandidatosCache && modelosCandidatosCache.apiKey === apiKey){
    return Promise.resolve(modelosCandidatosCache.nombres);
  }
  return listarModelosGemini(apiKey).then(function(modelos){
    var candidatos = modelos.filter(function(m){
      return Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
    });
    if(!candidatos.length){
      throw new Error('tu clave no tiene ningún modelo disponible para generar texto.');
    }
    // "generateContent" en supportedGenerationMethods no garantiza que el
    // modelo pueda responder en TEXTO — hay variantes de texto-a-voz,
    // generación de imagen, embeddings, etc. que también lo listan pero
    // rechazan la combinación de modalidades que pedimos. Se descartan de
    // entrada las familias conocidas que no sirven para esto.
    var noTexto = /tts|embed|aqa|image-generation|imagen[0-9]?|-audio|native-audio|-live|realtime/i;
    candidatos = candidatos.filter(function(m){ return !noTexto.test(m.name); });
    if(!candidatos.length){
      throw new Error('tu clave no tiene ningún modelo de texto disponible (solo modelos de voz/imagen/embeddings).');
    }
    // Se prefieren los modelos "flash" con nombre limpio (sin "preview",
    // "exp", "thinking", "image", "live" — variantes más propensas a
    // comportarse raro o no responder en texto plano); esas quedan como
    // último recurso, después incluso de los modelos "pro" estándar.
    var raro = /preview|exp|thinking|image|-live/i;
    candidatos.sort(function(a,b){
      function puntaje(m){
        if(/flash/i.test(m.name) && !raro.test(m.name)) return 0;
        if(/pro/i.test(m.name) && !raro.test(m.name)) return 1;
        if(/flash/i.test(m.name)) return 2;
        if(/pro/i.test(m.name)) return 3;
        return 4;
      }
      return puntaje(a) - puntaje(b);
    });
    var nombres = candidatos.map(function(m){ return m.name; }); // ya vienen como "models/xxx"
    modelosCandidatosCache = {apiKey: apiKey, nombres: nombres};
    return nombres;
  });
}

// Cuánto se espera cada modelo antes de darlo por colgado y pasar al
// siguiente candidato. Corto a propósito: si un modelo va a responder, un
// "flash" lo hace en pocos segundos — esperar 30s por cada uno hacía que
// probar 2-3 candidatos se sintiera eterno.
var TIMEOUT_POR_MODELO_MS = 15000;

// Intenta generar contenido con un modelo; si falla por un problema de ESE
// modelo puntual (404, 400 no relacionado con la clave, o que se cuelgue y
// agote el tiempo de espera), prueba con el siguiente candidato de la
// lista en vez de rendirse. Solo una clave rechazada (403, o un 400 que
// mencione explícitamente la API key) corta la cadena de una vez.
function intentarConModelos(apiKey, contents, nombres, idx, ultimoError, onProgreso){
  if(idx >= nombres.length){
    return Promise.reject(ultimoError || new Error('no se encontró ningún modelo de Gemini que funcione con tu clave.'));
  }
  var modeloNombre = nombres[idx];
  if(onProgreso) onProgreso(modeloNombre, idx + 1, nombres.length);
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modeloNombre + ':generateContent?key=' + encodeURIComponent(apiKey);
  var body = {
    systemInstruction: {parts: [{text: construirSystemInstruction()}]},
    contents: contents,
    generationConfig: {responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA}
  };
  var controller = ('AbortController' in window) ? new AbortController() : null;
  var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, TIMEOUT_POR_MODELO_MS) : null;
  var opts = {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
  if(controller) opts.signal = controller.signal;

  return fetch(url, opts)
    .then(function(resp){
      if(resp.ok) return resp.json();
      // Se intenta leer el cuerpo del error: Google normalmente explica ahí
      // la razón exacta (ej. "modelo no soporta generateContent"), mucho más
      // útil que solo mostrar el número de estado.
      return resp.json().catch(function(){ return null; }).then(function(errJson){
        var detalle = errJson && errJson.error && errJson.error.message;
        // 403 siempre es la clave/los permisos, nunca el modelo — no tiene
        // sentido probar otro modelo con la misma clave rechazada.
        if(resp.status === 403){
          var err403 = new Error('la clave de Gemini fue rechazada' + (detalle ? (': ' + detalle) : '. Revísala en Ajustes.'));
          err403.reintentable = false;
          throw err403;
        }
        // Un 400/404 puede ser un problema real de la clave (formato
        // inválido) o, más seguido, un problema de ESTE modelo puntual (no
        // soporta responder en texto, ya no existe, etc.) — se distingue por
        // el texto del error: solo si menciona la clave/API key se da por
        // no reintentable; cualquier otro 400/404 se prueba con el siguiente
        // modelo de la lista antes de rendirse.
        var esProblemaDeClave = /api[ _-]?key/i.test(detalle || '');
        if((resp.status === 400 || resp.status === 404) && !esProblemaDeClave){
          var errModelo = new Error('el modelo "' + modeloNombre + '" no aceptó la llamada' + (detalle ? (': ' + detalle) : '.'));
          errModelo.reintentable = true;
          throw errModelo;
        }
        var errOtro = new Error((esProblemaDeClave ? 'la clave de Gemini fue rechazada' : 'el servicio respondió con error ' + resp.status) + (detalle ? (': ' + detalle) : ''));
        errOtro.reintentable = false;
        throw errOtro;
      });
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
      ultimoModeloQueFunciono = modeloNombre;
      return parsed;
    })
    .catch(function(err){
      if(timeoutId) clearTimeout(timeoutId);
      if(err && err.name === 'AbortError'){
        // El modelo no respondió a tiempo — se trata igual que un modelo
        // que rechaza la llamada: se prueba el siguiente candidato.
        var errTimeout = new Error('el modelo "' + modeloNombre + '" no respondió a tiempo.');
        errTimeout.reintentable = true;
        return intentarConModelos(apiKey, contents, nombres, idx + 1, errTimeout, onProgreso);
      }
      if(err && err.reintentable){
        return intentarConModelos(apiKey, contents, nombres, idx + 1, err, onProgreso);
      }
      return Promise.reject(err);
    })
    .finally(function(){
      if(timeoutId) clearTimeout(timeoutId);
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

function llamarGemini(apiKey, contents, onProgreso){
  return obtenerCandidatosModelo(apiKey).then(function(nombres){
    // El último modelo que funcionó se prueba primero — evita repetir la
    // ronda completa de candidatos en cada mensaje una vez se encontró uno bueno.
    var ordenados = nombres;
    if(ultimoModeloQueFunciono && nombres.indexOf(ultimoModeloQueFunciono) !== -1){
      ordenados = [ultimoModeloQueFunciono].concat(nombres.filter(function(n){ return n !== ultimoModeloQueFunciono; }));
    }
    return intentarConModelos(apiKey, contents, ordenados, 0, null, onProgreso);
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

  llamarGemini(key, contentsParaEnviar, function(modeloNombre, intento, total){
    // Progreso en vivo: si hay que probar más de un modelo, se ve cuál se
    // está intentando en vez de dejar "Pensando..." fijo sin explicación.
    var etiqueta = total > 1 ? (' (' + intento + '/' + total + ')') : '';
    historial[idxPlaceholder].text = '⏳ Pensando' + etiqueta + '...';
    renderMensajes();
  }).then(function(parsed){
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
