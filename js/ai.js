// Conexión con IA (Gemini): por ahora solo la infraestructura para que cada
// persona guarde SU PROPIA clave de API y se pueda probar que funciona. Qué
// funciones concretas de IA se construyen encima queda para más adelante.
"use strict";

// Adrede en su propia llave de localStorage, separada de STORAGE_KEY
// (store.js): así la clave nunca queda incluida cuando alguien exporta o
// comparte su copia de seguridad en JSON o CSV — es un secreto personal,
// no un dato financiero.
var GEMINI_KEY_STORAGE = 'controlPagos_geminiApiKey';

export function getGeminiApiKey(){
  try{
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  }catch(err){
    // Mismo criterio defensivo que store.js: si el almacenamiento local está
    // bloqueado, la app sigue funcionando, solo que sin recordar la clave.
    return '';
  }
}

// Devuelve true si guardó, false si la validación falló (y ya mostró el
// motivo) — para que quien llama decida si actualizar el resto de la UI.
export function guardarGeminiApiKey(key){
  var limpio = String(key || '').trim();
  if(!limpio){
    alert('Pega tu clave de API de Gemini antes de guardar (o usa "Quitar clave" si quieres eliminar la que ya está guardada).');
    return false;
  }
  if(/\s/.test(limpio) || limpio.length < 20){
    alert('Esa clave no parece válida (muy corta o con espacios). Copia la clave completa desde Google AI Studio.');
    return false;
  }
  try{
    localStorage.setItem(GEMINI_KEY_STORAGE, limpio);
  }catch(err){
    alert('No se pudo guardar la clave en este navegador (el almacenamiento local está bloqueado). Podrás usarla en esta sesión, pero se perderá al recargar la página.');
    return false;
  }
  return true;
}

export function quitarGeminiApiKey(){
  try{ localStorage.removeItem(GEMINI_KEY_STORAGE); }catch(err){ /* ignorar */ }
}

// Prueba mínima y gratuita: pide la lista de modelos disponibles para esa
// clave. No genera contenido (no consume cuota de generación), solo
// confirma que la clave es válida y que hay conexión con la API de Google.
export function probarGeminiApiKey(key){
  var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key);
  var controller = ('AbortController' in window) ? new AbortController() : null;
  var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, 12000) : null;
  return fetch(url, controller ? {signal: controller.signal} : {})
    .then(function(resp){
      if(resp.status === 400 || resp.status === 403){
        throw new Error('la clave fue rechazada por Google (revisa que esté copiada completa, sin espacios ni saltos de línea).');
      }
      if(!resp.ok){
        throw new Error('el servicio respondió con error ' + resp.status);
      }
      return resp.json();
    })
    .then(function(json){
      var n = Array.isArray(json.models) ? json.models.length : 0;
      return {ok:true, modelos:n};
    })
    .catch(function(err){
      if(err && err.name === 'AbortError') throw new Error('tiempo de espera agotado. Revisa tu conexión e intenta de nuevo.');
      throw err;
    })
    .finally(function(){
      if(timeoutId) clearTimeout(timeoutId);
    });
}
