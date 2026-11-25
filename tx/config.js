/* Configuración del frontend TX.
 * window.TX_API = dirección base de la API (sin "/" final).
 * Si se define antes de cargar este archivo, se respeta.
 * Al abrir la página desde localhost / 127.0.0.1 / file:// se usa la API local.
 */
(function () {
  var host = (location.hostname || '').toLowerCase();
  var local = location.protocol === 'file:' || host === '' ||
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (!window.TX_API) {
    window.TX_API = local ? 'http://127.0.0.1:8100' : 'https://porton-api.paolosaxton.com/tx-api';
  }
})();
