/* TX — Facturación y cobranza BizNet. SPA en JavaScript sin dependencias. */
(function () {
  'use strict';

  /* ======================================================================
   * Utilidades
   * ==================================================================== */
  var API = String(window.TX_API || '').replace(/\/+$/, '');
  var TOKEN_KEY = 'tx_token', MC_KEY = 'tx_must_change', USER_KEY = 'tx_user', MFA_KEY = 'tx_mfa_setup', BACK_KEY = 'tx_back';
  var API_TIMEOUT = 60000, UPLOAD_TIMEOUT = 300000;

  var viewEl = document.getElementById('view');
  var renderSeq = 0;
  var uidN = 0;
  function uid(p) { uidN += 1; return (p || 'f') + uidN; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function miles(n) { return Math.abs(Math.round(num(n))).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function clp(v) {
    if (!isNum(v)) return '—';
    var n = Math.round(Number(v));
    return (n < 0 ? '-$' : '$') + miles(n);
  }
  function entero(v) { return isNum(v) ? (Number(v) < 0 ? '-' : '') + miles(v) : '—'; }
  /* "$1.234.567" | "1234567" | "-1.000" -> número (o null) */
  function parseCLP(s) {
    if (s === null || s === undefined) return null;
    var t = String(s).trim();
    if (!t) return null;
    var neg = /^-/.test(t) || /^\(.*\)$/.test(t);
    var d = t.replace(/[^\d]/g, '');
    if (!d) return null;
    var n = parseInt(d, 10);
    return neg ? -n : n;
  }
  function fdate(v) {
    if (!v) return '—';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v);
  }
  function fdatetime(v) {
    if (!v) return '—';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] : fdate(v);
  }
  var MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fmes(v) {
    if (!v) return '—';
    if (v === 'sin-mes') return 'Sin mes';
    var m = String(v).match(/^(\d{4})-(\d{2})/);
    return m ? MESES[+m[2] - 1] + ' ' + m[1] : String(v);
  }
  /* "11111111-1" -> "11.111.111-1" */
  function frut(v) {
    var s = String(v || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (s.length < 2) return v ? String(v) : '—';
    return s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + s.slice(-1);
  }
  /* Monto mensual: "UF 1.234,5" o "$1.234.567" */
  function fmonto(c) {
    if (!isNum(c.monthly_amount)) return '—';
    if (c.monthly_unit !== 'UF') return clp(c.monthly_amount);
    var n = Number(c.monthly_amount), p = String(Math.abs(n)).split('.');
    return 'UF ' + (n < 0 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (p[1] ? ',' + p[1] : '');
  }
  /* "45,5" | "45.5" | "1.234,5" -> 45.5 (o NaN si no es número) */
  function parseDecimal(s) {
    var t = String(s === null || s === undefined ? '' : s).trim().replace(/\s/g, '');
    if (!t) return null;
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }
  function fmesLargo(v) {
    var m = String(v || '').match(/^(\d{4})-(\d{2})/);
    return m ? MESES_LARGO[+m[2] - 1] + ' ' + m[1] : (v || '—');
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthISO(offset) {
    var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + (offset || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function addMonths(ym, n) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})/);
    if (!m) return '';
    var d = new Date(+m[1], +m[2] - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  /* Extrae una lista desde una respuesta que puede ser arreglo u objeto contenedor. */
  function list(d) {
    if (Array.isArray(d)) return d;
    if (!d || typeof d !== 'object') return [];
    var keys = Array.prototype.slice.call(arguments, 1).concat(['items', 'data', 'results', 'rows']);
    for (var i = 0; i < keys.length; i++) if (Array.isArray(d[keys[i]])) return d[keys[i]];
    return [];
  }
  function jsonList(v) {
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined || v === '') return [];
    if (typeof v === 'string') {
      try { var p = JSON.parse(v); if (Array.isArray(p)) return p; if (p !== null && p !== '') return [p]; } catch (e) { /* texto simple */ }
      return v.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return [v];
  }
  function splitList(s) { return String(s || '').split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function qs(obj) {
    var p = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === null || v === undefined || v === '' || v === false) return;
      p.push(encodeURIComponent(k) + '=' + encodeURIComponent(v === true ? 'true' : v));
    });
    return p.length ? '?' + p.join('&') : '';
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }

  var TIPOS = { 33: 'Factura', 34: 'Factura exenta', 56: 'Nota de débito', 61: 'Nota de crédito' };
  var TIPO_CORTO = { 33: 'FA', 34: 'FE', 56: 'ND', 61: 'NC' };
  function tipoNombre(t) { return TIPOS[+t] || ('Tipo ' + (t === null || t === undefined ? '?' : t)); }
  var ESTADOS = {
    pagada: ['Pagada', 'ok'],
    parcial: ['Pago parcial', 'warn'],
    pendiente: ['Pendiente de pago', 'warn'],
    reclamada_sin_nc: ['Reclamada: falta NC', 'bad'],
    anulada: ['Anulada', 'muted'],
    cedida: ['Cedida (factoring)', 'info']
  };
  var CONCEPTOS = ['servicio mensual', 'proyecto', 'trabajo puntual', 'emergencia', 'horas extra', 'otro'];
  var REF_CODIGOS = { 1: 'Anula el documento', 2: 'Corrige texto', 3: 'Corrige monto' };
  var SII_EVENTOS = { '': 'Sin respuesta del cliente', A: 'Aceptada por el cliente', R: 'Reclamada (rechazada) por el cliente' };

  function chip(estado, doc) {
    if (doc && +doc.tipo === 61) return '<span class="chip nc">Nota de crédito</span>';
    if (estado === 'reclamada_sin_nc' && doc && +doc.solo_anular) return '<span class="chip bad" title="Duplicada o ya cobrada con otra factura: solo se anula con NC, no se vuelve a facturar">Falta NC (solo anular)</span>';
    var e = ESTADOS[estado];
    if (!e) return estado ? '<span class="chip muted">' + esc(estado) + '</span>' : '';
    return '<span class="chip ' + e[1] + '">' + esc(e[0]) + '</span>';
  }
  function siiChip(ev) {
    if (ev === 'A') return '<span class="chip ok" title="El cliente aceptó la factura en el SII">Aceptada SII</span>';
    if (ev === 'R') return '<span class="chip bad" title="El cliente reclamó la factura en el SII">Reclamada SII</span>';
    return '';
  }
  function docLabel(d) {
    return (TIPO_CORTO[+d.tipo] || tipoNombre(d.tipo)) + ' ' + (d.folio !== undefined && d.folio !== null ? d.folio : '');
  }
  function docId(d) { return d.id !== undefined ? d.id : d.document_id; }

  /* ======================================================================
   * Sesión y API
   * ==================================================================== */
  function ss(op, k, v) {
    try {
      if (op === 'get') return sessionStorage.getItem(k);
      if (op === 'set') sessionStorage.setItem(k, v);
      if (op === 'del') sessionStorage.removeItem(k);
    } catch (e) { /* almacenamiento no disponible */ }
    return null;
  }
  var memToken = null;
  function getToken() { return ss('get', TOKEN_KEY) || memToken; }
  function setSession(token, mustChange, user, mfaSetup) {
    memToken = token;
    ss('set', TOKEN_KEY, token);
    ss('set', MC_KEY, mustChange ? '1' : '0');
    ss('set', MFA_KEY, mfaSetup ? '1' : '0');
    if (user) ss('set', USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    memToken = null;
    ss('del', TOKEN_KEY); ss('del', MC_KEY); ss('del', USER_KEY); ss('del', MFA_KEY);
    cache.clients = null;
  }
  function mustChange() { return ss('get', MC_KEY) === '1'; }
  function mfaPending() { return ss('get', MFA_KEY) === '1'; }
  function currentUser() { try { return JSON.parse(ss('get', USER_KEY) || 'null'); } catch (e) { return null; } }

  function ApiError(msg, status, data) { this.message = msg; this.status = status; this.data = data; }
  ApiError.prototype = Object.create(Error.prototype);

  function errMsg(data, status) {
    if (status === 429) return 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
    if (status === 413) return 'El archivo es demasiado grande.';
    var d = data && typeof data === 'object' ? (data.detail !== undefined ? data.detail : (data.error || data.message)) : data;
    if (Array.isArray(d)) {
      return d.map(function (x) {
        if (x && typeof x === 'object') {
          var loc = Array.isArray(x.loc) ? x.loc.filter(function (p) { return p !== 'body'; }).join('.') : '';
          return (loc ? loc + ': ' : '') + (x.msg || JSON.stringify(x));
        }
        return String(x);
      }).join(' · ');
    }
    if (d && typeof d === 'object') return d.message || JSON.stringify(d);
    if (typeof d === 'string' && d.trim() && d.length < 400 && !/^\s*</.test(d)) return d;
    if (status >= 500) return 'Error en el servidor (' + status + '). Intenta de nuevo en un momento.';
    if (status === 404) return 'No se encontró lo solicitado.';
    if (status === 403) return 'No tienes permiso para esta acción.';
    return 'Error ' + status;
  }

  function api(method, path, body, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    var tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    var payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    // Sin respuesta en un tiempo razonable: se corta (si no, el "Cargando…" giraría para siempre).
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || (body instanceof FormData ? UPLOAD_TIMEOUT : API_TIMEOUT)) : null;
    return fetch(API + path, { method: method, headers: headers, body: payload, cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        if (e && e.name === 'AbortError') throw new ApiError('El servidor está tardando demasiado en responder. Intenta de nuevo en un momento.', 0);
        throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión a internet o intenta en un momento.', 0);
      })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (res.status === 401 && !opts.noAuthRedirect) {
          var hadSession = !!getToken();
          var back = location.hash;
          clearSession();
          if (hadSession) {
            if (back && !/^#\/(login|olvide|reset\/|cambiar-clave|activar-2fa)/.test(back)) ss('set', BACK_KEY, back);
            if (!sessionToastShown) {
              sessionToastShown = true;
              toast('Tu sesión expiró o no es válida. Ingresa de nuevo.', 'bad');
              setTimeout(function () { sessionToastShown = false; }, 3000);
            }
            go('#/login');
          }
          throw new ApiError('Sesión expirada', 401);
        }
        if (opts.blob && res.ok) return res.blob();
        var ct = res.headers.get('content-type') || '';
        var p = ct.indexOf('json') >= 0 ? res.json().catch(function () { return null; }) : res.text().catch(function () { return ''; });
        return p.then(function (data) {
          if (!res.ok) {
            if (res.status === 403 && getToken()) {
              var code = data && typeof data === 'object' ? data.code : '';
              var txt = JSON.stringify(data || '');
              if (code === 'must_change' || (!code && /must.?change|cambiar (tu |la |su )?clave|cambio de clave/i.test(txt))) {
                ss('set', MC_KEY, '1');
                go('#/cambiar-clave');
              } else if (code === 'mfa_setup' || (!code && /doble validaci/i.test(txt))) {
                ss('set', MC_KEY, '0');
                ss('set', MFA_KEY, '1');
                go('#/activar-2fa');
              }
            }
            throw new ApiError(errMsg(data, res.status), res.status, data);
          }
          return data;
        });
      });
  }

  var cache = { clients: null };
  var sessionToastShown = false;
  function getClients(force) {
    if (cache.clients && !force) return Promise.resolve(cache.clients);
    return api('GET', '/api/clients').then(function (d) {
      cache.clients = list(d, 'clients', 'clientes').slice().sort(function (a, b) {
        return String(a.short || a.name || '').localeCompare(String(b.short || b.name || ''), 'es');
      });
      return cache.clients;
    });
  }
  function clientName(id) {
    if (id === null || id === undefined || id === '') return '';
    var c = (cache.clients || []).filter(function (x) { return String(x.id) === String(id); })[0];
    return c ? (c.short || c.name) : ('Cliente #' + id);
  }
  function clientOptions(selected, emptyLabel) {
    var html = emptyLabel !== undefined ? '<option value="">' + esc(emptyLabel) + '</option>' : '';
    (cache.clients || []).forEach(function (c) {
      html += '<option value="' + esc(c.id) + '"' + (String(c.id) === String(selected) ? ' selected' : '') + '>' +
        esc((c.short || c.name) + (c.active === 0 || c.active === false ? ' (inactivo)' : '')) + '</option>';
    });
    return html;
  }

  /* ======================================================================
   * Interfaz común
   * ==================================================================== */
  function toast(msg, kind) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'bad' ? 7000 : 4000);
  }
  function toastErr(e) {
    if (e && e.status === 401) return; // la sesión venció: ya se avisó y se volvió al ingreso
    toast(e && e.message ? e.message : String(e), 'bad');
  }
  /* Error en una sección con botón Reintentar (id del botón: retryId). */
  function errorRetryHtml(e, retryId) {
    return errorHtml(e) + '<p class="btn-row"><button type="button" class="btn secondary small" id="' + retryId + '">Reintentar</button></p>';
  }
  function loadingHtml(txt) { return '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>' + esc(txt || 'Cargando…') + '</div>'; }
  function errorHtml(e) { return '<div class="error-box" role="alert">' + esc(e && e.message ? e.message : String(e)) + '</div>'; }
  function pageHead(title, intro, actionsHtml, backHtml) {
    return (backHtml || '') + '<div class="page-head"><div><h1 tabindex="-1">' + esc(title) + '</h1>' +
      (intro ? '<p class="intro">' + intro + '</p>' : '') + '</div>' +
      (actionsHtml ? '<div class="actions">' + actionsHtml + '</div>' : '') + '</div>';
  }
  function emptyRow(cols, txt) { return '<tr><td colspan="' + cols + '" class="empty">' + esc(txt) + '</td></tr>'; }

  /* Campo de formulario accesible. */
  function fld(o) {
    var id = o.id || uid('f');
    var v = o.value === null || o.value === undefined ? '' : o.value;
    var attrs = (o.required ? ' required' : '') + (o.readonly ? ' readonly' : '') + (o.attrs ? ' ' + o.attrs : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.help ? ' aria-describedby="' + id + '-h"' : '');
    var cls = 'fld' + (o.full ? ' full' : '') + (o.type === 'checkbox' ? ' check' : '');
    var input;
    if (o.type === 'checkbox') {
      input = '<input type="checkbox" id="' + id + '" name="' + esc(o.name) + '"' + (v && v !== '0' ? ' checked' : '') + attrs + '>';
      return '<div class="' + cls + '">' + input + '<label for="' + id + '">' + esc(o.label) + '</label>' +
        (o.help ? '<small id="' + id + '-h">' + esc(o.help) + '</small>' : '') + '</div>';
    }
    if (o.type === 'select') {
      input = '<select id="' + id + '" name="' + esc(o.name) + '"' + attrs + '>' +
        (o.optionsHtml || (o.options || []).map(function (op) {
          var val = Array.isArray(op) ? op[0] : op, lab = Array.isArray(op) ? op[1] : op;
          return '<option value="' + esc(val) + '"' + (String(val) === String(v) ? ' selected' : '') + '>' + esc(lab) + '</option>';
        }).join('')) + '</select>';
    } else if (o.type === 'textarea') {
      input = '<textarea id="' + id + '" name="' + esc(o.name) + '"' + attrs + '>' + esc(v) + '</textarea>';
    } else if (o.type === 'money') {
      input = '<input type="text" inputmode="numeric" class="num" data-money id="' + id + '" name="' + esc(o.name) + '" value="' +
        esc(isNum(v) ? clp(v) : v) + '"' + attrs + '>';
    } else {
      input = '<input type="' + (o.type || 'text') + '" id="' + id + '" name="' + esc(o.name) + '" value="' + esc(v) + '"' + attrs + '>';
    }
    return '<div class="' + cls + '"><label for="' + id + '">' + esc(o.label) + '</label>' + input +
      (o.help ? '<small id="' + id + '-h">' + esc(o.help) + '</small>' : '') + '</div>';
  }
  /* Lee un formulario: checkboxes -> 0/1, data-money -> entero. */
  function readForm(form) {
    var out = {};
    $$('input, select, textarea', form).forEach(function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
      else if (el.hasAttribute('data-money')) out[el.name] = parseCLP(el.value);
      else out[el.name] = el.value.trim();
    });
    return out;
  }
  function bindMoney(root) {
    $$('input[data-money]', root).forEach(function (el) {
      el.addEventListener('blur', function () {
        var n = parseCLP(el.value);
        el.value = n === null ? '' : clp(n);
      });
    });
  }
  function busy(btn, on, txt) {
    if (!btn) return;
    if (on) { btn.dataset.txt = btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); if (txt) btn.textContent = txt; }
    else { btn.disabled = false; btn.removeAttribute('aria-busy'); if (btn.dataset.txt) btn.textContent = btn.dataset.txt; }
  }
  function showMsg(box, msg, ok) {
    if (!box) return;
    box.innerHTML = msg ? '<div class="' + (ok ? 'form-ok' : 'form-error') + '" role="' + (ok ? 'status' : 'alert') + '">' + esc(msg) + '</div>' : '';
  }

  function openDialog(title, bodyHtml, opts) {
    opts = opts || {};
    var dlg = document.createElement('dialog');
    var hid = uid('dlg');
    dlg.className = 'dlg' + (opts.wide ? ' wide' : '');
    dlg.setAttribute('aria-labelledby', hid);
    dlg.innerHTML = '<div class="dlg-head"><h2 id="' + hid + '">' + esc(title) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="Cerrar">×</button></div>' +
      '<div class="dlg-body">' + bodyHtml + '</div>';
    document.body.appendChild(dlg);
    var opener = document.activeElement;
    dlg.addEventListener('close', function () {
      var silent = dlg.hasAttribute('data-silent');
      dlg.remove();
      if (silent) return;
      if (opts.onClose) opts.onClose();
      if (opener && opener.focus && document.body.contains(opener)) opener.focus();
    });
    $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    bindMoney(dlg);
    var first = $('input:not([type=hidden]):not([readonly]), select, textarea', $('.dlg-body', dlg));
    if (first && !opts.noAutofocus) first.focus();
    return dlg;
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* Muestra un objeto de resultado como lista simple. */
  function resultHtml(d) {
    if (d === null || d === undefined || d === '') return '<p class="muted">Listo.</p>';
    if (typeof d !== 'object') return '<p>' + esc(d) + '</p>';
    var LBL = {
      ok: 'Resultado correcto', errors: 'Problemas', revisados: 'Correos revisados', nuevos: 'Nuevos', archivos: 'Archivos',
      rows_total: 'Filas leídas', rows_new: 'Filas nuevas', actualizados: 'Actualizados', clientes_nuevos: 'Clientes nuevos',
      filename: 'Archivo', fecha: 'Fecha', clients: 'Clientes', documents: 'Documentos', bank_movements: 'Movimientos',
      iva_periods: 'Meses de IVA', allocations: 'Asignaciones', iva_actions: 'Trámites de IVA', movimientos_nuevos: 'Movimientos nuevos'
    };
    var label = function (k) { return LBL[k] || k.replace(/_/g, ' '); };
    var rows = [], rest = {};
    Object.keys(d).forEach(function (k) {
      var v = d[k];
      if (k === 'fecha' && typeof v === 'string') v = fdatetime(v);
      if (v === null || typeof v !== 'object') rows.push('<dt>' + esc(label(k)) + '</dt><dd>' + esc(v === true ? 'sí' : v === false ? 'no' : v) + '</dd>');
      else if (Array.isArray(v) && v.every(function (x) { return x === null || typeof x !== 'object'; })) rows.push('<dt>' + esc(label(k)) + '</dt><dd>' + esc(v.join(' · ') || 'ninguno') + '</dd>');
      else if (k === 'files' && Array.isArray(v) && v.length === 1) { /* ya se mostró arriba */ }
      else if (!Array.isArray(v) && Object.keys(v).every(function (x) { return v[x] === null || typeof v[x] !== 'object'; })) {
        rows.push('<dt>' + esc(label(k)) + '</dt><dd>' + esc(Object.keys(v).map(function (x) { return label(x).toLowerCase() + ': ' + v[x]; }).join(' · ') || '—') + '</dd>');
      }
      else rest[k] = v;
    });
    var html = rows.length ? '<dl class="kv">' + rows.join('') + '</dl>' : '';
    if (Object.keys(rest).length) html += '<details><summary>Ver detalle</summary><pre class="out">' + esc(JSON.stringify(rest, null, 2)) + '</pre></details>';
    return html;
  }

  /* ======================================================================
   * Router
   * ==================================================================== */
  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }
  function parseHash() {
    var h = location.hash || '';
    if (h.indexOf('#/') !== 0) h = '#/dashboard';
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var query = {};
    if (qi >= 0) h.slice(qi + 1).split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      try { query[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) { /* ignorar */ }
    });
    return { path: path, query: query };
  }

  var ROUTES = [
    { re: /^#\/login$/, view: viewLogin, pub: true, title: 'Ingresar' },
    { re: /^#\/olvide$/, view: viewForgot, pub: true, title: 'Recuperar clave' },
    { re: /^#\/reset\/(.+)$/, view: viewReset, pub: true, title: 'Nueva clave' },
    { re: /^#\/cambiar-clave$/, view: viewChangePassword, mc: true, title: 'Cambiar clave' },
    { re: /^#\/activar-2fa$/, view: viewMfaSetup, mfa: true, title: 'Doble validación' },
    { re: /^#\/(dashboard)?$/, view: viewDashboard, nav: 'dashboard', title: 'Resumen' },
    { re: /^#\/clientes$/, view: viewClients, nav: 'clientes', title: 'Clientes' },
    { re: /^#\/cliente\/(\d+)$/, view: viewClient, nav: 'clientes', title: 'Cliente' },
    { re: /^#\/documentos$/, view: viewDocuments, nav: 'documentos', title: 'Documentos' },
    { re: /^#\/banco$/, view: viewBank, nav: 'banco', title: 'Banco' },
    { re: /^#\/iva$/, view: viewIva, nav: 'iva', title: 'IVA' },
    { re: /^#\/ajustes$/, view: viewSettings, nav: 'ajustes', title: 'Ajustes' }
  ];

  function render() {
    var seq = ++renderSeq;
    var r = parseHash();
    var route = null, m = null;
    for (var i = 0; i < ROUTES.length; i++) { m = r.path.match(ROUTES[i].re); if (m) { route = ROUTES[i]; break; } }
    if (!route) { go('#/dashboard'); return; }

    var logged = !!getToken();
    if (!route.pub && !logged) { go('#/login'); return; }
    if (logged && mustChange() && !route.pub && !route.mc) { go('#/cambiar-clave'); return; }
    if (logged && !mustChange() && mfaPending() && !route.pub && !route.mfa) { go('#/activar-2fa'); return; }
    if (route.mfa && !mfaPending()) { go('#/dashboard'); return; }
    if (route.view === viewLogin && logged && !mustChange() && !mfaPending()) { go('#/dashboard'); return; }

    $$('dialog.dlg').forEach(function (d) { d.setAttribute('data-silent', '1'); try { d.close(); } catch (e) { d.remove(); } });
    var top = document.getElementById('topbar');
    top.hidden = route.pub || (logged && (mustChange() || mfaPending()));
    $$('#mainnav a[data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === route.nav;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    closeMenu();
    var u = currentUser();
    document.getElementById('userName').textContent = u && u.username ? u.username : '';
    document.title = route.title + ' · BizNet';
    window.scrollTo(0, keepScroll || 0);
    var keepScrollNow = keepScroll;
    keepScroll = 0;

    var ctx = { seq: seq, query: r.query, params: m.slice(1), stale: function () { return seq !== renderSeq; } };
    viewEl.innerHTML = loadingHtml();
    var p;
    try { p = route.view(ctx); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () {
      if (ctx.stale()) return;
      var h1 = $('h1', viewEl);
      if (keepScrollNow) { window.scrollTo(0, keepScrollNow); return; }
      if (h1 && !$('[autofocus]', viewEl)) h1.focus({ preventScroll: true });
    }).catch(function (e) {
      if (ctx.stale() || (e && e.status === 401)) return;
      viewEl.innerHTML = pageHead('No se pudo cargar') + errorHtml(e) +
        '<p class="btn-row"><button type="button" class="btn secondary" id="retryBtn">Reintentar</button></p>';
      var b = document.getElementById('retryBtn');
      if (b) b.addEventListener('click', render);
    });
  }

  /* Vuelve a dibujar la pantalla actual sin perder la posición (p.ej. tras editar un documento). */
  var keepScroll = 0;
  function rerenderKeepScroll() { keepScroll = window.scrollY || 0; render(); }

  function closeMenu() {
    var nav = document.getElementById('mainnav'), btn = document.getElementById('menuBtn');
    nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  }

  /* ======================================================================
   * 1. Login, olvidé mi clave, reset
   * ==================================================================== */
  function authShell(title, inner) {
    return '<div class="auth-wrap"><div class="card auth-card"><img class="logo-big" src="assets/biznet-logo.png" alt="BizNet Tecnologías Cognitivas">' +
      '<h1 tabindex="-1">' + esc(title) + '</h1>' + inner + '</div></div>';
  }

  function viewLogin() {
    viewEl.innerHTML = authShell('Facturación y cobranza',
      '<p class="muted">Ingresa con tu usuario y clave.</p>' +
      '<form id="loginForm" novalidate>' +
      fld({ label: 'Usuario', name: 'username', required: true, attrs: 'autocomplete="username" autocapitalize="none" spellcheck="false" autofocus' }) +
      fld({ label: 'Clave', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' }) +
      '<button class="btn" type="submit">Ingresar</button><div id="loginMsg"></div></form>' +
      '<p class="auth-links"><a href="#/olvide">¿Olvidaste tu clave?</a></p>');
    var form = $('#loginForm'), msg = $('#loginMsg');
    $('[name=username]', form).focus();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var d = readForm(form);
      if (!d.username || !d.password) { showMsg(msg, 'Escribe tu usuario y tu clave.'); return; }
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Ingresando…'); showMsg(msg, '');
      api('POST', '/api/auth/login', { username: d.username, password: $('[name=password]', form).value }, { noAuthRedirect: true })
        .then(function (r) {
          if (r && r.mfa_required && r.mfa_token) { showMfaStep(r.mfa_token); return; }
          if (!r || !r.token) throw new ApiError('Respuesta inesperada del servidor.', 0);
          completeLogin(r, d.username);
        })
        .catch(function (e) {
          busy(btn, false);
          showMsg(msg, e.status === 401 || e.status === 400 ? 'Usuario o clave incorrectos.' : e.message);
          $('[name=password]', form).select();
        });
    });
  }

  function completeLogin(r, username) {
    var mc = !!(r.must_change && r.must_change !== '0');
    var mfa = !!r.mfa_setup;
    setSession(r.token, mc, r.user || { username: username }, mfa);
    cache.clients = null;
    if (r.used_recovery_code) {
      toast('Ingresaste con un código de recuperación. Te quedan ' + entero(r.recovery_codes_left) + '. Puedes generar códigos nuevos en Ajustes.', r.recovery_codes_left > 2 ? 'ok' : 'bad');
    }
    var back = ss('get', BACK_KEY);
    ss('del', BACK_KEY);
    go(mc ? '#/cambiar-clave' : mfa ? '#/activar-2fa' : (back || '#/dashboard'));
  }

  /* Segundo paso del ingreso: código de la app autenticadora o código de recuperación. */
  function showMfaStep(mfaToken) {
    viewEl.innerHTML = authShell('Código de verificación',
      '<p class="muted">Abre tu app autenticadora (Google o Microsoft Authenticator) y escribe el código de 6 dígitos de <strong>TX BizNet</strong>.</p>' +
      '<form id="mfaForm" novalidate>' +
      fld({ label: 'Código', name: 'code', required: true, attrs: 'autocomplete="one-time-code" inputmode="numeric" autocapitalize="none" spellcheck="false" maxlength="14"' }) +
      '<button class="btn" type="submit">Verificar</button><div id="mfaMsg"></div></form>' +
      '<p class="help">¿No tienes el teléfono a mano? Escribe en el mismo campo uno de tus códigos de recuperación (por ejemplo <code>abcde-fghjk</code>). Cada uno sirve una sola vez.</p>' +
      '<p class="auth-links"><button type="button" class="btn link" id="mfaBack">Volver a escribir usuario y clave</button></p>');
    var form = $('#mfaForm'), msg = $('#mfaMsg'), inp = $('[name=code]', form);
    inp.focus();
    $('#mfaBack').addEventListener('click', function () { render(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var code = inp.value.trim();
      if (!code) { showMsg(msg, 'Escribe el código.'); return; }
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Verificando…');
      api('POST', '/api/auth/mfa', { mfa_token: mfaToken, code: code }, { noAuthRedirect: true })
        .then(function (r) {
          if (!r || !r.token) throw new ApiError('Respuesta inesperada del servidor.', 0);
          completeLogin(r, '');
        })
        .catch(function (e) {
          busy(btn, false);
          showMsg(msg, e.message);
          inp.select();
          if (e.status === 401) { busy(btn, true); setTimeout(function () { render(); }, 2500); }
        });
    });
  }

  function viewForgot() {
    viewEl.innerHTML = authShell('Recuperar clave',
      '<p class="muted">Escribe tu correo. Si está registrado, te enviaremos un enlace para crear una clave nueva (vale por 1 hora).</p>' +
      '<form id="forgotForm" novalidate>' +
      fld({ label: 'Correo electrónico', name: 'email', type: 'email', required: true, attrs: 'autocomplete="email" autofocus' }) +
      '<button class="btn" type="submit">Enviar enlace</button><div id="forgotMsg"></div></form>' +
      '<p class="auth-links"><a href="#/login">Volver a ingresar</a></p>');
    var form = $('#forgotForm'), msg = $('#forgotMsg');
    $('[name=email]', form).focus();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = $('[name=email]', form).value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMsg(msg, 'Escribe un correo válido.'); return; }
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Enviando…');
      api('POST', '/api/auth/forgot', { email: email }, { noAuthRedirect: true })
        .then(function () {
          busy(btn, false);
          showMsg(msg, 'Listo. Si el correo está registrado y el envío de correos está configurado en el sistema, recibirás un enlace en unos minutos. Revisa también la carpeta de spam. Si no llega, el administrador puede generar una clave temporal en el servidor.', true);
        })
        .catch(function (e) { busy(btn, false); showMsg(msg, e.message); });
    });
  }

  function newPasswordFields(withCurrent, currentLabel) {
    return (withCurrent ? fld({ label: currentLabel || 'Clave actual', name: 'current_password', type: 'password', required: true, attrs: 'autocomplete="current-password"' }) : '') +
      fld({ label: 'Clave nueva', name: 'new_password', type: 'password', required: true, help: 'Mínimo 10 caracteres. Usa una frase fácil de recordar para ti.', attrs: 'autocomplete="new-password" minlength="10"' }) +
      fld({ label: 'Repite la clave nueva', name: 'repeat', type: 'password', required: true, attrs: 'autocomplete="new-password" minlength="10"' });
  }
  function checkNewPassword(form) {
    var n = $('[name=new_password]', form).value, r = $('[name=repeat]', form).value;
    if (n.length < 10) return 'La clave nueva debe tener al menos 10 caracteres.';
    if (n !== r) return 'Las dos claves nuevas no son iguales.';
    return '';
  }

  function viewReset(ctx) {
    var token = ctx.params[0];
    try { token = decodeURIComponent(token); } catch (e) { /* usar tal cual */ }
    viewEl.innerHTML = authShell('Crear clave nueva',
      '<p class="muted">Escribe tu nueva clave dos veces.</p>' +
      '<form id="resetForm" novalidate>' + newPasswordFields(false) +
      '<button class="btn" type="submit">Guardar clave nueva</button><div id="resetMsg"></div></form>' +
      '<p class="auth-links"><a href="#/login">Ir a ingresar</a></p>');
    var form = $('#resetForm'), msg = $('#resetMsg');
    $('[name=new_password]', form).focus();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = checkNewPassword(form);
      if (err) { showMsg(msg, err); return; }
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Guardando…');
      api('POST', '/api/auth/reset', { token: token, new_password: $('[name=new_password]', form).value }, { noAuthRedirect: true })
        .then(function () {
          clearSession();
          form.innerHTML = '<div class="form-ok" role="status">Tu clave fue cambiada. Ya puedes ingresar con la clave nueva.</div>' +
            '<a class="btn" href="#/login">Ir a ingresar</a>';
        })
        .catch(function (e) {
          busy(btn, false);
          showMsg(msg, e.status === 400 || e.status === 404 ? 'El enlace no es válido o ya venció (dura 1 hora y se usa una sola vez). Pide uno nuevo en "¿Olvidaste tu clave?".' : e.message);
        });
    });
  }

  /* ======================================================================
   * 2. Cambio de clave (obligatorio si must_change)
   * ==================================================================== */
  function changePasswordForm(forced) {
    return '<form id="cpForm" novalidate class="' + (forced ? '' : 'form-grid') + '">' +
      newPasswordFields(true, forced ? 'Clave temporal (la que recibiste)' : 'Clave actual') +
      '<div class="' + (forced ? '' : 'full') + '"><button class="btn" type="submit">Cambiar clave</button></div><div id="cpMsg" class="full"></div></form>';
  }
  function bindChangePassword(root, forced) {
    var form = $('#cpForm', root), msg = $('#cpMsg', root);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = checkNewPassword(form);
      var cur = $('[name=current_password]', form).value;
      if (!cur) err = 'Escribe tu clave actual.';
      if (err) { showMsg(msg, err); return; }
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Guardando…');
      api('POST', '/api/auth/change-password', { current_password: cur, new_password: $('[name=new_password]', form).value }, { noAuthRedirect: true })
        .then(function (r) {
          busy(btn, false);
          if (r && r.token) { memToken = r.token; ss('set', TOKEN_KEY, r.token); }
          ss('set', MC_KEY, '0');
          if (r && r.mfa_setup) ss('set', MFA_KEY, '1');
          form.reset();
          toast('Clave cambiada correctamente.', 'ok');
          if (forced || (r && r.mfa_setup)) go(r && r.mfa_setup ? '#/activar-2fa' : '#/dashboard');
          else showMsg(msg, 'Clave cambiada correctamente.', true);
        })
        .catch(function (e) {
          busy(btn, false);
          if (e.status === 401 && !/actual|current|incorrect/i.test(e.message)) {
            // la sesión venció
            clearSession(); go('#/login'); return;
          }
          showMsg(msg, e.status === 400 || e.status === 401 ? (e.message && e.message !== 'Error ' + e.status ? e.message : 'La clave actual no es correcta.') : e.message);
        });
    });
  }
  function viewChangePassword() {
    var forced = mustChange();
    viewEl.innerHTML = authShell(forced ? 'Cambia tu clave temporal' : 'Cambiar clave',
      (forced ? '<p>Por seguridad, antes de continuar debes reemplazar la clave temporal por una clave tuya.</p>' : '') +
      changePasswordForm(true) +
      '<p class="auth-links">' + (forced ? '<button type="button" class="btn link" id="cpLogout">Salir</button>' : '<a href="#/dashboard">Volver</a>') + '</p>');
    bindChangePassword(viewEl, true);
    $('[name=current_password]', viewEl).focus();
    var lo = $('#cpLogout');
    if (lo) lo.addEventListener('click', logout);
  }

  /* ======================================================================
   * Doble validación: enrolamiento (QR + códigos de recuperación)
   * ==================================================================== */
  function svgDataUri(svg) {
    try { return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); } catch (e) { return ''; }
  }
  function recoveryCodesHtml(codes) {
    return '<ul class="codes">' + codes.map(function (c) { return '<li><code>' + esc(c) + '</code></li>'; }).join('') + '</ul>';
  }
  function downloadCodes(codes) {
    var u = currentUser() || {};
    var txt = 'TX BizNet - códigos de recuperación (' + (u.username || '') + ')\r\nGenerados: ' + todayISO() +
      '\r\nCada código sirve UNA sola vez, en lugar del código de la app autenticadora.\r\n\r\n' + codes.join('\r\n') + '\r\n';
    downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'tx-codigos-recuperacion.txt');
  }

  function viewMfaSetup(ctx) {
    return api('POST', '/api/auth/mfa/setup').then(function (r) {
      if (ctx.stale()) return;
      var src = svgDataUri(r.qr_svg || '');
      var secret = String(r.secret || '').replace(/(.{4})/g, '$1 ').trim();
      viewEl.innerHTML = authShell('Activa la doble validación',
        '<p>Por seguridad, además de tu clave se te pedirá un código de tu teléfono cada vez que ingreses.</p>' +
        '<ol class="steps"><li>Instala <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong> en tu teléfono.</li>' +
        '<li>En la app toca <strong>+</strong> y escanea este código:</li></ol>' +
        (src ? '<div class="qr-box"><img src="' + esc(src) + '" alt="Código QR para la app autenticadora" width="220" height="220"></div>' : '') +
        '<details class="small"><summary>¿No puedes escanear? Escribe esta clave en la app</summary><p class="secret-code">' + esc(secret) +
        '</p><p class="help">Tipo: basada en el tiempo. Nombre de la cuenta: TX BizNet.</p></details>' +
        '<form id="mfaEnForm" novalidate>' +
        fld({ label: 'Escribe el código de 6 dígitos que muestra la app', name: 'code', required: true, attrs: 'autocomplete="one-time-code" inputmode="numeric" maxlength="7"' }) +
        '<button class="btn" type="submit">Activar</button><div id="mfaEnMsg"></div></form>' +
        '<p class="auth-links"><button type="button" class="btn link" id="mfaLogout">Salir</button></p>');
      var form = $('#mfaEnForm'), msg = $('#mfaEnMsg');
      $('#mfaLogout').addEventListener('click', logout);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var code = $('[name=code]', form).value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) { showMsg(msg, 'Escribe los 6 dígitos que muestra la app.'); return; }
        var btn = $('button[type=submit]', form);
        busy(btn, true, 'Activando…');
        api('POST', '/api/auth/mfa/enable', { code: code }).then(function (res) {
          var codes = (res && res.recovery_codes) || [];
          ss('set', MFA_KEY, '0');
          viewEl.innerHTML = authShell('Guarda tus códigos de recuperación',
            '<div class="form-ok" role="status">Doble validación activada.</div>' +
            '<p>Si pierdes el teléfono, cada uno de estos códigos te deja entrar <strong>una sola vez</strong>. Guárdalos en un lugar seguro (impresos o en tu gestor de claves). <strong>No se volverán a mostrar.</strong></p>' +
            recoveryCodesHtml(codes) +
            '<div class="btn-row"><button type="button" class="btn secondary" id="dlCodes">Descargar códigos</button>' +
            '<button type="button" class="btn" id="mfaDone">Ya los guardé, continuar</button></div>');
          $('#dlCodes').addEventListener('click', function () { downloadCodes(codes); });
          $('#mfaDone').addEventListener('click', function () {
            var back = ss('get', BACK_KEY); ss('del', BACK_KEY);
            go(back || '#/dashboard');
          });
          $('#mfaDone').focus();
        }).catch(function (e) { busy(btn, false); showMsg(msg, e.message); });
      });
      $('[name=code]', form).focus();
    }).catch(function (e) {
      if (e && e.status === 409) { ss('set', MFA_KEY, '0'); go('#/dashboard'); return; }
      throw e;
    });
  }

  function logout() {
    var t = getToken();
    var done = function () { clearSession(); go('#/login'); };
    if (!t) { done(); return; }
    api('POST', '/api/auth/logout', {}, { noAuthRedirect: true }).catch(function () { }).then(done);
  }

  /* ======================================================================
   * 3. Resumen (dashboard)
   * ==================================================================== */
  function statCard(o) {
    var tag = o.href ? 'a' : 'div';
    return '<' + tag + (o.href ? ' href="' + esc(o.href) + '"' : '') + ' class="stat ' + (o.kind || '') + '">' +
      '<div class="label">' + esc(o.label) + '</div><div class="value">' + o.value + '</div>' +
      (o.desc ? '<div class="desc">' + esc(o.desc) + '</div>' : '') + '</' + tag + '>';
  }
  function countOrAmount(v) {
    if (v && typeof v === 'object') {
      var c = v.cantidad !== undefined ? v.cantidad : v.count;
      var mo = v.monto !== undefined ? v.monto : v.total;
      return esc(entero(c)) + (isNum(mo) ? ' <small class="muted">(' + clp(mo) + ')</small>' : '');
    }
    return esc(entero(v));
  }
  var NIVEL_ORD = { roja: 0, amarilla: 1, info: 2 };
  var NIVEL_TXT = { roja: 'Urgente', amarilla: 'Atención', info: 'Aviso' };

  // Recuadro "Qué hacer" (Resumen y ficha de cliente). Los links solo pueden ser rutas internas (#/...).
  function queHacerBox(qh, titulo, intro, vacio) {
    return '<section class="card que-hacer" aria-labelledby="qhTitle"><div class="card-head"><h2 id="qhTitle">' + esc(titulo) + '</h2>' +
      '<span class="muted small">En orden de urgencia</span></div>' +
      (intro ? '<p class="qh-intro">' + esc(intro) + '</p>' : '') +
      (qh.length ? '<ol class="qh-list">' + qh.map(function (q) {
        var href = /^#\//.test(q.link || '') ? q.link : '';
        return '<li class="qh ' + (q.nivel === 'urgente' ? 'urgente' : 'pendiente') + '">' +
          (q.nivel === 'urgente' ? '<span class="qh-tag">Urgente</span>' : '') +
          '<strong>' + esc(q.titulo) + '</strong><span class="qh-txt">' + esc(q.texto || '') + '</span>' +
          (href ? '<a href="' + esc(href) + '">Ver</a>' : '') + '</li>';
      }).join('') + '</ol>' : '<p class="muted">' + esc(vacio || 'Nada pendiente. Todo en orden.') + '</p>') + '</section>';
  }

  function viewDashboard(ctx) {
    return Promise.all([api('GET', '/api/dashboard'), getClients().catch(function () { return []; })]).then(function (res) {
      if (ctx.stale()) return;
      var d = res[0] || {}, t = d.totales || {};
      var clientes = list(d.clientes, 'clientes');
      var alertas = list(d.alertas, 'alertas').slice().sort(function (a, b) {
        return (NIVEL_ORD[a.nivel] !== undefined ? NIVEL_ORD[a.nivel] : 3) - (NIVEL_ORD[b.nivel] !== undefined ? NIVEL_ORD[b.nivel] : 3);
      });
      var html = pageHead('Resumen', 'Cómo va la facturación y la cobranza de todos tus clientes.',
        '<a class="btn secondary" href="#/banco">Subir cartolas</a><button type="button" class="btn" id="addClientBtn">Agregar cliente</button>');
      html += queHacerBox(list(d.que_hacer, 'que_hacer'), 'Qué hacer ahora', '');
      html += '<div class="stats">' +
        statCard({ label: 'Facturado (12 meses)', value: esc(clp(t.facturado)), desc: 'Total facturado en los últimos 12 meses.', kind: 'info', href: '#/documentos' }) +
        statCard({ label: 'Pagado (12 meses)', value: esc(clp(t.pagado)), desc: 'Pagos ya asignados a tus facturas.', kind: 'ok', href: '#/banco' }) +
        statCard({ label: 'Te deben', value: esc(clp(t.deuda)), desc: 'Lo que tus clientes te deben hoy: facturas pendientes y con pago parcial. Haz clic para ver el detalle.', kind: 'warn', href: '#/documentos?estado=pendiente%2Cparcial' }) +
        statCard({ label: 'Por re-facturar', value: esc(clp(t.rechazado_por_refacturar)), desc: 'Facturas reclamadas que hay que anular con NC y facturar de nuevo.' + (num(t.solo_anular) ? ' Aparte, ' + clp(t.solo_anular) + ' en duplicadas que solo se anulan.' : ''), kind: 'bad', href: '#/documentos?estado=reclamada_sin_nc' }) +
        statCard({ label: 'NC pendientes', value: countOrAmount(t.nc_pendientes), desc: 'Notas de crédito que faltan por emitir.', kind: 'bad', href: '#/documentos?estado=reclamada_sin_nc' }) +
        statCard({ label: 'IVA en riesgo', value: esc(clp(t.iva_en_riesgo)), desc: 'IVA de facturas reclamadas que puedes recuperar.', kind: 'bad', href: '#/iva' }) +
        (t.abonos_sin_asignar !== undefined ? statCard({ label: 'Pagos sin asignar', value: esc(entero(t.abonos_sin_asignar)) + (isNum(t.monto_sin_asignar) ? ' <small class="muted">(' + esc(clp(t.monto_sin_asignar)) + ')</small>' : ''),
          desc: 'Abonos del banco (o parte de ellos) que aún no se sabe qué factura pagan.', kind: num(t.abonos_sin_asignar) ? 'warn' : 'ok', href: '#/banco?solo_abonos=true&sin_asignar=true' }) : '') +
        '</div>';

      // Alertas: todas las urgentes y 5 más; el resto con "Ver todas"
      var nUrg = alertas.filter(function (a) { return a.nivel === 'roja'; }).length;
      var maxAl = nUrg + 5;
      var alertLi = function (a) {
        var nivel = NIVEL_ORD[a.nivel] !== undefined ? a.nivel : 'info';
        var href = a.link || (a.client_id ? '#/cliente/' + encodeURIComponent(a.client_id) + (a.document_id ? '?doc=' + encodeURIComponent(a.document_id) : '') : '');
        var link = /^#\//.test(href) ? '<a href="' + esc(href) + '">' + (a.client_id ? 'Ver cliente' : 'Ver') + '</a>' : '';
        return '<li class="alert ' + nivel + '"><span><span class="lvl">' + esc(NIVEL_TXT[nivel]) + '</span>' + esc(a.texto) + '</span>' + link + '</li>';
      };
      html += '<section class="card" aria-labelledby="alTitle"><div class="card-head"><h2 id="alTitle">Alertas</h2>' +
        '<span class="muted small">' + esc(alertas.length) + ' en total</span></div>';
      if (!alertas.length) html += '<p class="muted">No hay alertas. Todo en orden.</p>';
      else {
        html += '<ul class="alerts" id="alertList">' + alertas.slice(0, maxAl).map(alertLi).join('') + '</ul>' +
          (alertas.length > maxAl ? '<p class="btn-row"><button type="button" class="btn small secondary" id="moreAlerts" aria-controls="alertList">Ver todas las alertas (' + esc(alertas.length) + ')</button></p>' : '');
      }
      html += '</section>';

      html += '<section class="card" aria-labelledby="clTitle"><div class="card-head"><h2 id="clTitle">Clientes</h2>' +
        '<span class="muted small">Haz clic en un cliente para ver su detalle.</span></div>' +
        '<div class="table-wrap"><table class="tbl-opt"><thead><tr><th scope="col">Cliente</th><th scope="col" class="num opt">Facturado 12 meses</th>' +
        '<th scope="col" class="num opt">Pagado 12 meses</th><th scope="col" class="num">Te debe</th><th scope="col" class="num">Facturas por cobrar</th>' +
        '<th scope="col" class="num">Reclamadas</th><th scope="col">Último pago</th></tr></thead><tbody>';
      if (!clientes.length) html += emptyRow(7, 'Aún no hay clientes. Agrega uno o importa el Registro de Ventas del SII en Ajustes.');
      var tot = { f: 0, p: 0, d: 0 };
      clientes.forEach(function (c) {
        tot.f += num(c.facturado_12m); tot.p += num(c.pagado_12m); tot.d += num(c.deuda);
        var up = c.ultimo_pago || {};
        html += '<tr class="clickable" data-href="#/cliente/' + esc(c.id) + '">' +
          '<td><a href="#/cliente/' + esc(c.id) + '">' + esc(c.short || c.name) + '</a>' + (c.short && c.name && c.short !== c.name ? '<span class="sub">' + esc(c.name) + '</span>' : '') + '</td>' +
          '<td class="num opt">' + esc(clp(c.facturado_12m)) + '</td><td class="num opt">' + esc(clp(c.pagado_12m)) + '</td>' +
          '<td class="num">' + (num(c.deuda) > 0 ? '<strong>' + esc(clp(c.deuda)) + '</strong>' : esc(clp(c.deuda))) + '</td>' +
          '<td class="num">' + esc(entero(c.docs_pendientes)) + '</td>' +
          '<td class="num">' + (num(c.docs_reclamados) > 0 ? '<span class="chip bad">' + esc(entero(c.docs_reclamados)) + '</span>' : esc(entero(c.docs_reclamados))) + '</td>' +
          '<td class="nowrap">' + (up.fecha ? esc(fdate(up.fecha)) + '<span class="sub">' + esc(clp(up.monto)) + '</span>' : '<span class="muted">Sin pagos</span>') + '</td></tr>';
      });
      html += '</tbody>' + (clientes.length > 1 ? '<tfoot><tr><td>Total</td><td class="num">' + esc(clp(tot.f)) + '</td><td class="num">' + esc(clp(tot.p)) +
        '</td><td class="num">' + esc(clp(tot.d)) + '</td><td colspan="3"></td></tr></tfoot>' : '') + '</table></div></section>';
      viewEl.innerHTML = html;
      bindRowLinks(viewEl);
      $('#addClientBtn').addEventListener('click', function () { openClientDialog(null); });
      var more = $('#moreAlerts');
      if (more) more.addEventListener('click', function () {
        $('#alertList').innerHTML = alertas.map(alertLi).join('');
        more.parentNode.remove();
      });
    });
  }

  function bindRowLinks(root) {
    $$('tr[data-href]', root).forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('a, button, input, select, label')) return;
        location.hash = tr.getAttribute('data-href');
      });
    });
  }

  /* ======================================================================
   * Clientes: lista y formulario
   * ==================================================================== */
  function clientFormFields(c) {
    c = c || {};
    var pats = jsonList(c.payer_patterns).join('\n');
    return fld({ label: 'Razón social', name: 'name', value: c.name, required: true, full: true }) +
      fld({ label: 'Nombre corto', name: 'short', value: c.short, help: 'Cómo lo verás en las listas. Ej: SURA' }) +
      fld({ label: 'RUT', name: 'rut', value: c.rut, placeholder: '12.345.678-9', help: 'Con guion y dígito verificador.' }) +
      fld({ label: 'Monto mensual del contrato', name: 'monthly_amount', value: isNum(c.monthly_amount) ? String(c.monthly_amount).replace('.', ',') : '', attrs: 'inputmode="decimal" autocomplete="off"', help: 'En UF puedes usar coma decimal (ej. 45,5).' }) +
      fld({ label: 'Unidad del monto', name: 'monthly_unit', type: 'select', value: c.monthly_unit || 'CLP', options: [['CLP', 'Pesos (CLP)'], ['UF', 'UF']] }) +
      fld({ label: 'Contrato', name: 'contract', type: 'textarea', value: c.contract, full: true, help: 'N° de contrato, licitación, vigencia, contraparte…' }) +
      fld({ label: 'Cómo facturar', name: 'billing_notes', type: 'textarea', value: c.billing_notes, full: true, help: 'Qué pide el cliente: orden de compra (OC), HES, glosa, a quién enviar…' }) +
      fld({ label: 'Cómo aparece en el banco', name: 'payer_patterns', type: 'textarea', value: pats, full: true,
        help: 'Uno por línea: RUT sin puntos ni dígito (ej. 61002000) o un texto que aparece en la cartola cuando paga (ej. SERVICIO REGISTRO CIVIL). Sirve para reconocer sus pagos automáticamente.' }) +
      fld({ label: 'Cliente activo', name: 'active', type: 'checkbox', value: c.active === undefined || c.active === null ? 1 : c.active });
  }
  function clientPayload(form) {
    var d = readForm(form);
    return {
      name: d.name, short: d.short || null, rut: d.rut || null,
      contract: d.contract || null, billing_notes: d.billing_notes || null,
      monthly_amount: parseDecimal(d.monthly_amount),
      monthly_unit: d.monthly_unit || 'CLP',
      payer_patterns: splitList(d.payer_patterns),
      active: d.active
    };
  }
  function openClientDialog(c, onSaved) {
    var dlg = openDialog(c ? 'Editar cliente' : 'Agregar cliente',
      '<form id="clForm" novalidate><div class="form-grid">' + clientFormFields(c) + '</div><div id="clMsg"></div>' +
      '<div class="form-actions">' + (c ? '<button type="button" class="btn danger left" id="delClientBtn">Eliminar cliente</button>' : '') +
      '<button type="button" class="btn secondary" data-close>Cancelar</button>' +
      '<button type="submit" class="btn">' + (c ? 'Guardar cambios' : 'Agregar cliente') + '</button></div></form>', { wide: true });
    var form = $('#clForm', dlg), msg = $('#clMsg', dlg);
    var delBtn = $('#delClientBtn', dlg);
    if (delBtn) delBtn.addEventListener('click', function () {
      if (!confirm('¿Eliminar el cliente ' + (c.short || c.name) + '? Si tiene documentos, no se borra: solo queda inactivo (oculto).')) return;
      busy(delBtn, true);
      api('DELETE', '/api/clients/' + encodeURIComponent(c.id)).then(function (r) {
        cache.clients = null;
        dlg.setAttribute('data-silent', '1');
        dlg.close();
        var soloInactivo = r && (r.deactivated || r.deleted === false || r.active === 0);
        toast(soloInactivo ? 'El cliente tiene documentos: quedó inactivo.' : 'Cliente eliminado.', 'ok');
        go('#/clientes');
      }).catch(function (e) { busy(delBtn, false); showMsg(msg, e.message); });
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var p = clientPayload(form);
      if (!p.name) { showMsg(msg, 'La razón social es obligatoria.'); return; }
      if (p.monthly_amount !== null && (isNaN(p.monthly_amount) || p.monthly_amount < 0)) {
        showMsg(msg, 'El monto mensual debe ser un número (ej. 45,5 o 1.250.000).'); return;
      }
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Guardando…');
      api(c ? 'PUT' : 'POST', c ? '/api/clients/' + encodeURIComponent(c.id) : '/api/clients', p)
        .then(function (r) {
          cache.clients = null;
          dlg.close();
          toast(c ? 'Cliente actualizado.' : 'Cliente agregado.', 'ok');
          if (onSaved) onSaved(r);
          else if (!c && r && (r.id || (r.client && r.client.id))) go('#/cliente/' + (r.id || r.client.id));
          else render();
        })
        .catch(function (e) { busy(btn, false); showMsg(msg, e.message); });
    });
  }

  function viewClients(ctx) {
    return getClients(true).then(function (clients) {
      if (ctx.stale()) return;
      var verInactivos = ctx.query.inactivos === '1';
      var rows = clients.filter(function (c) { return verInactivos || !(c.active === 0 || c.active === false); });
      var html = pageHead('Clientes', 'Tus clientes, su contrato y cómo reconocer sus pagos en el banco.',
        '<button type="button" class="btn" id="addClientBtn">Agregar cliente</button>');
      html += '<div class="card"><div class="card-head"><div class="fld check"><input type="checkbox" id="chkInact"' + (verInactivos ? ' checked' : '') + '>' +
        '<label for="chkInact">Mostrar clientes inactivos</label></div><span class="muted small">' + esc(rows.length) + ' clientes</span></div>' +
        '<div class="table-wrap"><table><thead><tr><th scope="col">Cliente</th><th scope="col">RUT</th><th scope="col" class="num">Monto mensual</th>' +
        '<th scope="col">Cómo facturar</th><th scope="col">Estado</th></tr></thead><tbody>';
      if (!rows.length) html += emptyRow(5, 'No hay clientes todavía.');
      rows.forEach(function (c) {
        var inact = c.active === 0 || c.active === false;
        html += '<tr class="clickable" data-href="#/cliente/' + esc(c.id) + '"><td><a href="#/cliente/' + esc(c.id) + '">' + esc(c.short || c.name) + '</a>' +
          (c.short && c.name && c.short !== c.name ? '<span class="sub">' + esc(c.name) + '</span>' : '') + '</td>' +
          '<td class="nowrap">' + esc(c.rut ? frut(c.rut) : '—') + '</td>' +
          '<td class="num">' + esc(fmonto(c)) + '</td>' +
          '<td class="desc">' + esc(c.billing_notes || '') + '</td>' +
          '<td>' + (inact ? '<span class="chip muted">Inactivo</span>' : '<span class="chip ok">Activo</span>') + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
      viewEl.innerHTML = html;
      bindRowLinks(viewEl);
      $('#addClientBtn').addEventListener('click', function () { openClientDialog(null); });
      $('#chkInact').addEventListener('change', function (e) { go('#/clientes' + (e.target.checked ? '?inactivos=1' : '')); });
    });
  }

  /* ======================================================================
   * 4. Cliente (detalle)
   * ==================================================================== */
  // días desde la emisión; en rojo si la factura sigue con saldo y pasaron más de 30 días
  function diasDesde(fecha) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || ''));
    if (!m) return null;
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var f = new Date(+m[1], +m[2] - 1, +m[3]);
    return Math.max(0, Math.round((hoy - f) / 86400000));
  }
  function diasCell(d, isNC) {
    var n = diasDesde(d.fecha);
    if (n === null || isNC) return '<td class="num"></td>';
    var vencida = num(d.saldo) > 0 && n > 30;
    return '<td class="num nowrap' + (vencida ? ' dias-vencida' : '') + '"' + (vencida ? ' title="Más de 30 días sin pagar"' : '') + '>' + esc(entero(n)) + '</td>';
  }
  function docsTable(docs, opts) {
    opts = opts || {};
    var cols = opts.showClient ? 15 : 14;
    var html = '<div class="table-wrap"><table class="tbl-opt"><thead><tr>' +
      (opts.showClient ? '<th scope="col">Cliente</th>' : '') +
      '<th scope="col">Documento</th><th scope="col">Fecha de emisión</th><th scope="col" class="num" title="Días desde la fecha de emisión">Días</th><th scope="col" class="opt">Mes servicio</th><th scope="col" class="opt">Concepto</th>' +
      '<th scope="col" class="num">Total</th><th scope="col">Estado</th><th scope="col" class="num opt">Pagado</th><th scope="col" class="num">Saldo</th>' +
      '<th scope="col" class="opt">OC</th><th scope="col" class="opt">HES</th><th scope="col" class="opt">SII</th><th scope="col" class="opt">Notas</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>';
    if (!docs.length) html += emptyRow(cols, opts.emptyText || 'No hay documentos.');
    var tt = 0, tp = 0, ts = 0;
    docs.forEach(function (d) {
      var isNC = +d.tipo === 61;
      if (!isNC) { tt += num(d.total); tp += num(d.pagado); ts += num(d.saldo); }
      var refs = [];
      if (d.ref_folio) refs.push('Ref. ' + (TIPO_CORTO[+d.ref_tipo] || 'doc') + ' ' + d.ref_folio + (REF_CODIGOS[+d.ref_codigo] ? ' · ' + REF_CODIGOS[+d.ref_codigo] : ''));
      var ncs = jsonList(d.nc_ref).map(function (n) {
        if (n && typeof n === 'object') return (TIPO_CORTO[+n.tipo] || 'NC') + ' ' + (n.folio || '') + (isNum(n.total) ? ' (' + clp(n.total) + ')' : '');
        return 'NC ' + n;
      });
      var hes = jsonList(d.hes);
      html += '<tr class="' + (isNC ? 'row-nc' : '') + (String(opts.highlight) === String(d.id) ? ' row-highlight' : '') + '" id="doc-' + esc(d.id) + '">' +
        (opts.showClient ? '<td>' + (d.client_id ? '<a href="#/cliente/' + esc(d.client_id) + '">' + esc(d.client_short || d.client_name || clientName(d.client_id)) + '</a>' : '—') + '</td>' : '') +
        '<td class="nowrap"><strong>' + esc(docLabel(d)) + '</strong><span class="sub">' + esc(tipoNombre(d.tipo)) + '</span>' +
        refs.map(function (r) { return '<span class="sub">' + esc(r) + '</span>'; }).join('') +
        ncs.map(function (r) { return '<span class="sub">Anulada/ajustada por ' + esc(r) + '</span>'; }).join('') + '</td>' +
        '<td class="nowrap">' + esc(fdate(d.fecha)) + '</td>' +
        diasCell(d, isNC) +
        '<td class="nowrap opt">' + esc(fmes(d.servicio_mes || d.periodo)) + '</td>' +
        '<td class="opt">' + esc(d.concepto || '') + '</td>' +
        '<td class="num">' + esc(clp(isNC ? -Math.abs(num(d.total)) : d.total)) + '</td>' +
        '<td>' + chip(d.estado, d) + (d.cedida && +d.cedida === 1 && d.estado !== 'cedida' ? ' <span class="chip info">Cedida</span>' : '') + '</td>' +
        '<td class="num opt">' + (isNC ? '' : esc(clp(d.pagado))) + '</td>' +
        '<td class="num">' + (isNC ? '' : (num(d.saldo) > 0 ? '<strong>' + esc(clp(d.saldo)) + '</strong>' : esc(clp(d.saldo)))) + '</td>' +
        '<td class="opt">' + esc(d.oc || '') + '</td>' +
        '<td class="opt"><div class="tag-list">' + hes.map(function (h) { return '<span class="tag">' + esc(h) + '</span>'; }).join('') + '</div></td>' +
        '<td class="opt">' + siiChip(d.sii_evento) + '</td>' +
        '<td class="desc opt">' + esc(d.notes || '') + '</td>' +
        '<td class="actions"><button type="button" class="btn small secondary" data-edit-doc="' + esc(d.id) + '" aria-label="Editar ' + esc(docLabel(d)) + '">Editar</button></td></tr>' +
        // qué hacer: línea propia bajo la factura, solo si hay algo que hacer
        (d.accion && !isNC && (d.accion_nivel === 'urgente' || d.accion_nivel === 'pendiente')
          ? '<tr class="accion-row ' + esc(d.accion_nivel) + (String(opts.highlight) === String(d.id) ? ' row-highlight' : '') + '"><td colspan="' + cols + '"><span class="accion ' + esc(d.accion_nivel) + '">' +
            (d.accion_nivel === 'urgente' ? 'Urgente · ' : 'Qué hacer · ') + esc(d.accion) + '</span></td></tr>' : '');
    });
    html += '</tbody>';
    if (docs.length) {
      html += '<tfoot>';
      if (docs.length > 1) html += '<tr><td colspan="' + (opts.showClient ? 6 : 5) + '">Total (sin notas de crédito)</td><td class="num">' + esc(clp(tt)) +
        '</td><td></td><td class="num">' + esc(clp(tp)) + '</td><td class="num">' + esc(clp(ts)) + '</td><td colspan="5"></td></tr>';
      // la suma de lo que te deben, siempre visible al final de la lista
      html += '<tr class="total-te-deben"><td colspan="' + (opts.showClient ? 9 : 8) + '"><strong>Te deben</strong> (saldo por cobrar de estas facturas)</td>' +
        '<td class="num"><strong>' + esc(clp(ts)) + '</strong></td><td colspan="5"></td></tr></tfoot>';
    }
    return html + '</table></div>';
  }
  function bindDocsTable(root, docs, onChange) {
    $$('[data-edit-doc]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-edit-doc');
        var d = docs.filter(function (x) { return String(x.id) === id; })[0];
        if (d) openDocDialog(d, onChange);
      });
    });
  }

  function paymentFolios(p) {
    var src = p.allocations || p.asignaciones || p.facturas || p.documentos || p.documents || [];
    return jsonList(src).map(function (a) {
      if (a && typeof a === 'object') {
        var lbl = (TIPO_CORTO[+a.tipo] || 'F') + ' ' + (a.folio !== undefined ? a.folio : (a.document_folio !== undefined ? a.document_folio : '#' + (a.document_id || '?')));
        return { label: lbl, amount: a.amount !== undefined ? a.amount : a.monto, id: a.id, anticipo: !!+a.anticipo };
      }
      return { label: 'F ' + a };
    });
  }

  function viewClient(ctx) {
    var id = ctx.params[0];
    return Promise.all([api('GET', '/api/clients/' + encodeURIComponent(id)), getClients().catch(function () { return []; })]).then(function (res) {
      if (ctx.stale()) return;
      var d = res[0] || {};
      var c = d.client || d.cliente || d;
      var docs = list(d.documents !== undefined ? d.documents : (d.documentos !== undefined ? d.documentos : d.docs), 'documents');
      var pagos = list(d.pagos !== undefined ? d.pagos : (d.payments !== undefined ? d.payments : d.movimientos), 'pagos');
      var resumen = list(d.resumen_mensual, 'resumen_mensual');

      // Si no viene la lista de pagos, se arma desde las asignaciones de los documentos.
      if (!pagos.length && d.pagos === undefined && d.payments === undefined) {
        var byMov = {};
        docs.forEach(function (doc) {
          list(doc.allocations).forEach(function (a) {
            var k = a.movement_id || ('a' + a.id);
            if (!byMov[k]) byMov[k] = { fecha: a.fecha || a.movement_fecha, monto: a.movement_abono || a.abono || 0, descripcion: a.descripcion || '', allocations: [], _sum: 0 };
            byMov[k].allocations.push({ tipo: doc.tipo, folio: doc.folio, amount: a.amount });
            byMov[k]._sum += num(a.amount);
          });
        });
        pagos = Object.keys(byMov).map(function (k) { var p = byMov[k]; if (!p.monto) p.monto = p._sum; return p; })
          .sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')); });
      }

      var facturas = docs.filter(function (x) { return +x.tipo !== 61; });
      var deuda = 0, refact = 0, pagadoTot = 0, ncPend = 0;
      facturas.forEach(function (x) {
        if (x.estado === 'pendiente' || x.estado === 'parcial') deuda += num(x.saldo);
        if (x.estado === 'reclamada_sin_nc') { if (!+x.solo_anular) refact += num(x.total); ncPend += 1; }
        pagadoTot += num(x.pagado);
      });
      if (isNum(c.deuda)) deuda = num(c.deuda);

      var name = c.short || c.name || ('Cliente #' + id);
      document.title = name + ' · BizNet';
      var html = pageHead(name, c.short && c.name && c.short !== c.name ? esc(c.name) : '',
        '<button type="button" class="btn secondary" id="editClientBtn">Editar datos</button><button type="button" class="btn" id="newDocBtn">Agregar documento</button>',
        '<a class="back" href="#/dashboard">← Volver al resumen</a>');

      html += '<div class="stats">' +
        statCard({ label: 'Te debe', value: esc(clp(deuda)), desc: 'Lo que este cliente te debe hoy (facturas pendientes y con pago parcial).', kind: 'warn' }) +
        statCard({ label: 'Por re-facturar', value: esc(clp(refact)), desc: ncPend ? ncPend + ' factura(s) reclamada(s): falta emitir NC.' : 'Sin facturas reclamadas.', kind: refact ? 'bad' : 'ok' }) +
        statCard({ label: 'Pagado (histórico)', value: esc(clp(pagadoTot)), desc: 'Pagos asignados a sus facturas.', kind: 'ok' }) +
        statCard({ label: 'Monto mensual', value: esc(fmonto(c)), desc: 'Según contrato.', kind: 'info' }) +
        '</div>';
      if (c.que_hacer !== undefined) html += queHacerBox(list(c.que_hacer, 'que_hacer'), 'Qué hacer con ' + name, c.que_hacer_intro || '', 'Nada pendiente con este cliente.');

      // Datos del cliente
      var pats = jsonList(c.payer_patterns);
      html += '<section class="card" aria-labelledby="dtTitle"><div class="card-head"><h2 id="dtTitle">Datos del cliente</h2>' +
        (c.active === 0 || c.active === false ? '<span class="chip muted">Inactivo</span>' : '') + '</div><dl class="kv">' +
        '<dt>Razón social</dt><dd>' + esc(c.name || '—') + '</dd>' +
        '<dt>RUT</dt><dd>' + esc(c.rut ? frut(c.rut) : '—') + '</dd>' +
        '<dt>Contrato</dt><dd>' + esc(c.contract || '—') + '</dd>' +
        '<dt>Cómo facturar</dt><dd>' + esc(c.billing_notes || '—') + '</dd>' +
        '<dt>Cómo aparece en el banco</dt><dd>' + (pats.length ? '<div class="tag-list">' + pats.map(function (p) { return '<span class="tag">' + esc(p) + '</span>'; }).join('') + '</div>' : '<span class="muted">Sin definir: sus pagos no se reconocerán solos.</span>') + '</dd>' +
        '</dl></section>';

      // Resumen mensual
      // Meses de servicio del contrato mensual: ¿cada mes quedó facturado completo y pagado?
      var ms = list(c.meses_servicio, 'meses_servicio'), msr = c.meses_servicio_resumen || {};
      if (ms.length) {
        var MS_EST = {
          ok: ['OK', 'ok'], por_cobrar: ['Por cobrar', 'warn'], cedida: ['Cedida', 'info'],
          falta_refacturar: ['Falta re-facturar', 'bad'], falta_facturar: ['Sin factura', 'bad'],
          incompleto: ['Falta una factura', 'bad'], monto_menor: ['Monto menor', 'warn'], duplicada: ['Reclamada duplicada', 'info'], de_mas: ['Monto mayor', 'warn'], sin_dato: ['Sin UF', 'muted']
        };
        var esUf = msr.unidad === 'UF';
        var cant = function (v, signo) {
          if (v === null || v === undefined || v === '') return '—';
          var n = num(v);
          var t = esUf ? n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' UF' : clp(Math.round(n));
          return (signo && n > 0 ? '+' : '') + t;
        };
        html += '<section class="card" aria-labelledby="msTitle"><h2 id="msTitle">Meses de servicio</h2>' +
          (msr.texto ? '<p class="qh-intro">' + esc(msr.texto) + '</p>' : '') +
          '<p class="help">Cada fila es un mes del contrato. Cuenta solo las facturas vigentes de servicio mensual (no las anuladas ni las reclamadas)' +
          (esUf ? ', convertidas a UF con la UF del día de emisión' : '') + '. "Diferencia" compara con el contrato; en los meses por re-facturar cuenta lo reclamado como si se volviera a facturar igual.</p>' +
          '<div class="table-wrap"><table><thead><tr><th scope="col">Mes</th><th scope="col" class="num">Contrato</th><th scope="col" class="num">Facturado vigente</th>' +
          '<th scope="col" class="num">Por re-facturar</th><th scope="col" class="num">Diferencia</th><th scope="col">Estado</th><th scope="col">Detalle</th></tr></thead><tbody>';
        ms.forEach(function (r) {
          var e = MS_EST[r.estado] || [r.estado || '—', 'muted'];
          var dif = r.diferencia === null || r.diferencia === undefined ? null : num(r.diferencia);
          var difBad = dif !== null && Math.abs(dif) > (esUf ? 0.05 : 1);
          html += '<tr><td class="nowrap">' + esc(fmes(r.mes)) + '</td><td class="num">' + esc(cant(r.contrato)) + '</td><td class="num">' + esc(cant(r.facturado)) +
            '</td><td class="num">' + (num(r.por_refacturar) ? '<strong class="text-bad">' + esc(cant(r.por_refacturar)) + '</strong>' : '—') +
            '</td><td class="num">' + (difBad ? '<strong class="text-bad">' + esc(cant(dif, true)) + '</strong>' : (dif === null ? '—' : 'OK')) +
            '</td><td><span class="chip ' + e[1] + '">' + esc(e[0]) + '</span></td><td class="desc">' + esc(r.detalle || '') + '</td></tr>';
        });
        html += '</tbody></table></div></section>';
      }

      html += '<section class="card" aria-labelledby="rmTitle"><h2 id="rmTitle">Resumen por mes</h2>' +
        '<p class="help">Cada fila es un mes de servicio: cuánto se facturó, cuánto se descontó con notas de crédito, cuánto se pagó, cuánto falta cobrar y cuánto está reclamado (hay que anularlo con NC y volver a facturar).</p>' +
        '<div class="table-wrap"><table><thead><tr><th scope="col">Mes</th><th scope="col" class="num">Facturado</th><th scope="col" class="num">Notas de crédito</th>' +
        '<th scope="col" class="num">Pagado</th><th scope="col" class="num">Por cobrar</th><th scope="col" class="num">Reclamado (re-facturar)</th><th scope="col">Estado</th></tr></thead><tbody>';
      if (!resumen.length) html += emptyRow(7, 'Sin información mensual.');
      resumen.slice().sort(function (a, b) { return String(b.mes || '').localeCompare(String(a.mes || '')); }).forEach(function (r) {
        var st;
        var MES_EST = {
          pagado: ['Pagado', 'ok'], parcial: ['Pago parcial', 'warn'], pendiente: ['Pendiente de pago', 'warn'],
          reclamada: ['Reclamada: falta NC', 'bad'], cedida: ['Cedida', 'info'], anulada: ['Anulada', 'muted'],
          sin_factura: ['Sin factura', 'warn'], solo_nc: ['Solo nota de crédito', 'nc']
        };
        if (r.estado && MES_EST[r.estado]) st = '<span class="chip ' + MES_EST[r.estado][1] + '">' + esc(MES_EST[r.estado][0]) + '</span>';
        else if (r.estado && ESTADOS[r.estado]) st = chip(r.estado);
        else if (num(r.facturado) === 0 && num(r.nc) === 0) st = '<span class="chip muted">Sin facturar</span>';
        else if (num(r.saldo) <= 0) st = '<span class="chip ok">Al día</span>';
        else if (num(r.pagado) > 0) st = '<span class="chip warn">Pago parcial</span>';
        else st = '<span class="chip warn">Pendiente</span>';
        html += '<tr><td class="nowrap">' + esc(fmes(r.mes)) + '</td><td class="num">' + esc(clp(r.facturado)) + '</td><td class="num">' + esc(clp(r.nc)) +
          '</td><td class="num">' + esc(clp(r.pagado)) + '</td><td class="num">' + esc(clp(r.saldo)) + '</td><td class="num">' +
          (num(r.reclamado) > 0 ? '<strong class="text-bad">' + esc(clp(r.reclamado)) + '</strong>' : esc(clp(r.reclamado || 0))) + '</td><td>' + st + '</td></tr>';
      });
      html += '</tbody></table></div></section>';

      // Documentos
      html += '<section class="card" aria-labelledby="docTitle"><div class="card-head"><h2 id="docTitle">Documentos</h2>' +
        '<a class="btn small secondary" href="#/documentos?client_id=' + esc(id) + '">Ver con filtros</a></div>' +
        docsTable(docs.slice().sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')) || num(b.folio) - num(a.folio); }),
          { highlight: ctx.query.doc, emptyText: 'Este cliente no tiene documentos. Agrégalos a mano o importa el Registro de Ventas del SII en Ajustes.' }) + '</section>';

      // Pagos
      html += '<section class="card" aria-labelledby="pgTitle"><div class="card-head"><h2 id="pgTitle">Pagos recibidos</h2>' +
        '<a class="btn small secondary" href="#/banco">Ir al banco</a></div>' +
        '<div class="table-wrap"><table><thead><tr><th scope="col">Fecha</th><th scope="col" class="num">Monto</th><th scope="col">Descripción en el banco</th>' +
        '<th scope="col">Facturas que paga</th></tr></thead><tbody>';
      if (!pagos.length) html += emptyRow(4, 'Aún no hay pagos asignados a este cliente.');
      pagos.forEach(function (p) {
        var f = paymentFolios(p);
        var monto = p.monto !== undefined ? p.monto : (p.abono !== undefined ? p.abono : p.amount);
        html += '<tr><td class="nowrap">' + esc(fdate(p.fecha)) + '</td><td class="num">' + esc(clp(monto)) + '</td><td class="desc">' + esc(p.descripcion || p.glosa || '') + '</td>' +
          '<td>' + (f.length ? f.map(function (x) { return '<span class="alloc">' + esc(x.label) + (isNum(x.amount) ? ' · ' + esc(clp(x.amount)) : '') + (x.anticipo ? ' · <span title="Pago recibido antes de emitir la factura">Anticipo</span>' : '') + '</span>'; }).join('') : '<span class="muted">Sin asignar</span>') + '</td></tr>';
      });
      html += '</tbody></table></div></section>';

      viewEl.innerHTML = html;
      $('#editClientBtn').addEventListener('click', function () { openClientDialog(c, function () { rerenderKeepScroll(); }); });
      $('#newDocBtn').addEventListener('click', function () { openDocDialog(null, rerenderKeepScroll, c.id || id); });
      bindDocsTable(viewEl, docs, rerenderKeepScroll);
      if (ctx.query.doc) {
        var row = document.getElementById('doc-' + ctx.query.doc);
        if (row) setTimeout(function () { row.scrollIntoView({ block: 'center' }); }, 50);
      }
    });
  }

  /* ======================================================================
   * Documento: crear / editar
   * ==================================================================== */
  function openDocDialog(doc, onSaved, presetClientId) {
    getClients().catch(function () { return []; }).then(function () {
      var isNew = !doc;
      var d = doc || { tipo: 33, fecha: todayISO(), servicio_mes: monthISO(0), concepto: 'servicio mensual', client_id: presetClientId };
      var body = '<form id="docForm" novalidate>';
      if (isNew) {
        body += '<p class="help">Usa esto solo para documentos que no vienen del SII. Lo normal es importar el Registro de Ventas (Ajustes → Importar).</p>' +
          '<div class="form-grid">' +
          fld({ label: 'Cliente', name: 'client_id', type: 'select', required: true, optionsHtml: clientOptions(d.client_id, 'Elige un cliente…') }) +
          fld({ label: 'Tipo de documento', name: 'tipo', type: 'select', value: d.tipo, options: [[33, 'Factura (33)'], [34, 'Factura exenta (34)'], [56, 'Nota de débito (56)'], [61, 'Nota de crédito (61)']] }) +
          fld({ label: 'Folio', name: 'folio', type: 'number', required: true, attrs: 'min="1" step="1" inputmode="numeric"' }) +
          fld({ label: 'Fecha de emisión', name: 'fecha', type: 'date', value: d.fecha, required: true }) +
          fld({ label: 'Neto', name: 'neto', type: 'money', help: 'Sin IVA.' }) +
          fld({ label: 'Exento', name: 'exento', type: 'money' }) +
          fld({ label: 'IVA', name: 'iva', type: 'money', help: 'Se calcula solo (19% del neto); puedes corregirlo.' }) +
          fld({ label: 'Total', name: 'total', type: 'money', required: true }) +
          '</div><div class="form-grid" id="refBox"><div class="full"><h3>Documento al que hace referencia</h3><p class="help">Para notas de crédito y débito: qué factura corrigen.</p></div>' +
          fld({ label: 'Tipo referido', name: 'ref_tipo', type: 'select', value: 33, options: [[33, 'Factura (33)'], [34, 'Factura exenta (34)'], [56, 'Nota de débito (56)']] }) +
          fld({ label: 'Folio referido', name: 'ref_folio', type: 'number', attrs: 'min="1" step="1" inputmode="numeric"' }) +
          fld({ label: 'Qué hace', name: 'ref_codigo', type: 'select', value: 1, options: [[1, 'Anula la factura completa'], [3, 'Corrige el monto (rebaja parcial)'], [2, 'Corrige solo texto']] }) +
          '</div>';
      } else {
        body += '<dl class="kv"><dt>Documento</dt><dd>' + esc(tipoNombre(d.tipo)) + ' N° ' + esc(d.folio) + '</dd>' +
          '<dt>Cliente</dt><dd>' + esc(d.client_name || clientName(d.client_id) || '—') + '</dd>' +
          '<dt>Fecha</dt><dd>' + esc(fdate(d.fecha)) + (d.periodo ? ' <span class="muted">(período tributario ' + esc(fmes(d.periodo)) + ')</span>' : '') + '</dd>' +
          '<dt>Montos</dt><dd>Neto ' + esc(clp(d.neto)) + ' · Exento ' + esc(clp(d.exento)) + ' · IVA ' + esc(clp(d.iva)) + ' · <strong>Total ' + esc(clp(d.total)) + '</strong></dd>' +
          (+d.tipo !== 61 ? '<dt>Estado</dt><dd>' + chip(d.estado, d) + ' · Pagado ' + esc(clp(d.pagado)) + ' · Saldo ' + esc(clp(d.saldo)) + '</dd>' : '') +
          (d.accion && +d.tipo !== 61 ? '<dt>Qué hacer</dt><dd class="accion ' + esc(d.accion_nivel || '') + '">' + esc(d.accion) + '</dd>' : '') +
          (d.ref_folio ? '<dt>Referencia</dt><dd>' + esc(tipoNombre(d.ref_tipo)) + ' ' + esc(d.ref_folio) + ' · ' + esc(REF_CODIGOS[+d.ref_codigo] || '') + '</dd>' : '') +
          (d.glosa ? '<dt>Glosa</dt><dd>' + esc(d.glosa) + '</dd>' : '') +
          '</dl>';
      }
      body += '<div class="form-grid">' +
        fld({ label: 'Mes del servicio', name: 'servicio_mes', type: 'month', value: d.servicio_mes || (d.periodo || ''), help: 'El mes que se está cobrando (puede ser distinto a la fecha de la factura).' }) +
        fld({ label: 'Hasta (si cobra varios meses)', name: 'servicio_hasta', type: 'month', value: d.servicio_hasta || '', help: 'Solo si la factura cobra varios meses juntos, por ejemplo febrero y marzo. Si no, déjalo vacío.' }) +
        fld({ label: 'Concepto', name: 'concepto', type: 'select', value: d.concepto || '', options: [['', '—']].concat(CONCEPTOS.map(function (x) { return [x, x.charAt(0).toUpperCase() + x.slice(1)]; })) }) +
        fld({ label: 'Orden de compra (OC)', name: 'oc', value: d.oc }) +
        fld({ label: 'HES', name: 'hes', value: jsonList(d.hes).join(', '), help: 'Si son varias, sepáralas con coma.' }) +
        fld({ label: 'Respuesta del cliente en el SII', name: 'sii_evento', type: 'select', value: d.sii_evento || '', options: [['', 'Sin respuesta'], ['A', 'Aceptada'], ['R', 'Reclamada (rechazada)']] }) +
        fld({ label: 'Factura cedida (factoring)', name: 'cedida', type: 'checkbox', value: d.cedida, help: 'Si la cediste, el cliente le paga a la empresa de factoring.' }) +
        fld({ label: 'Requiere nota de crédito (duplicada o mal emitida)', name: 'requiere_nc', type: 'checkbox', value: d.requiere_nc, help: 'Márcala si esta factura no se va a cobrar y hay que anularla con NC aunque el cliente no la haya reclamado.' }) +
        fld({ label: 'Solo anular (no se vuelve a facturar)', name: 'solo_anular', type: 'checkbox', value: d.solo_anular, help: 'Duplicada o ya cobrada con otra factura: se anula con NC y no suma a lo que falta re-facturar.' }) +
        fld({ label: 'Cesionario (a quién se cedió)', name: 'cesionario', value: d.cesionario }) +
        (isNew ? fld({ label: 'Glosa / detalle', name: 'glosa', type: 'textarea', value: d.glosa, full: true }) : '') +
        fld({ label: 'Volver a facturar con', name: 'refacturar_con', type: 'textarea', value: d.refacturar_con, full: true, help: 'Solo si esta factura se anula y se reemplaza: monto (UF), OC (Referencias tipo 801) y HES de la factura nueva.' }) +
        fld({ label: 'Notas internas', name: 'notes', type: 'textarea', value: d.notes, full: true }) +
        '</div>';

      // Pagos asignados (solo edición)
      var allocs = list(d.allocations);
      if (!isNew && +d.tipo !== 61) {
        body += '<h3>Pagos asignados</h3>';
        if (!allocs.length) body += '<p class="muted">Ningún pago asignado todavía. Se asignan desde la pantalla Banco.</p>';
        else body += '<div class="table-wrap"><table><thead><tr><th scope="col">Fecha pago</th><th scope="col" class="num">Monto</th><th scope="col">Tipo</th><th scope="col"><span class="sr-only">Quitar</span></th></tr></thead><tbody>' +
          allocs.map(function (a) {
            return '<tr><td>' + esc(fdate(a.fecha || a.movement_fecha)) + '</td><td class="num">' + esc(clp(a.amount)) + '</td><td>' + (a.auto ? 'Automático' : 'Manual') +
              '</td><td class="actions"><button type="button" class="btn small danger" data-del-alloc="' + esc(a.id) + '">Quitar</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      body += '<div id="docMsg"></div><div class="form-actions">' +
        (!isNew ? '<button type="button" class="btn danger left" id="delDocBtn">Eliminar documento</button>' : '') +
        '<button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn">' + (isNew ? 'Agregar documento' : 'Guardar cambios') + '</button></div></form>';

      var changed = false;
      var dlg = openDialog(isNew ? 'Agregar documento' : 'Editar ' + tipoNombre(d.tipo).toLowerCase() + ' N° ' + d.folio, body, {
        wide: true, onClose: function () { if (changed && onSaved) onSaved(); }
      });
      var form = $('#docForm', dlg), msg = $('#docMsg', dlg);

      if (isNew) {
        var tipoSel = $('[name=tipo]', form), refBox = $('#refBox', form);
        var syncRef = function () { refBox.hidden = !(+tipoSel.value === 61 || +tipoSel.value === 56); };
        tipoSel.addEventListener('change', syncRef); syncRef();
        var neto = $('[name=neto]', form), exento = $('[name=exento]', form), iva = $('[name=iva]', form), total = $('[name=total]', form);
        var ivaManual = false;
        iva.addEventListener('input', function () { ivaManual = true; });
        var recalc = function () {
          var n = parseCLP(neto.value) || 0, x = parseCLP(exento.value) || 0;
          if (!ivaManual) iva.value = n ? clp(Math.round(n * 0.19)) : '';
          var i = parseCLP(iva.value) || 0;
          if (n || x) total.value = clp(n + x + i);
        };
        [neto, exento].forEach(function (el) { el.addEventListener('input', recalc); el.addEventListener('blur', recalc); });
        iva.addEventListener('blur', recalc);
      }

      $$('[data-del-alloc]', form).forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('¿Quitar este pago de la factura? El movimiento del banco quedará sin asignar.')) return;
          busy(b, true);
          api('DELETE', '/api/allocations/' + encodeURIComponent(b.getAttribute('data-del-alloc')))
            .then(function () { changed = true; b.closest('tr').remove(); toast('Pago quitado de la factura.', 'ok'); })
            .catch(function (e) { busy(b, false); showMsg(msg, e.message); });
        });
      });

      var delBtn = $('#delDocBtn', form);
      if (delBtn) delBtn.addEventListener('click', function () {
        if (!confirm('¿Eliminar ' + tipoNombre(d.tipo).toLowerCase() + ' N° ' + d.folio + '? Esto solo lo borra de este sistema (no del SII).')) return;
        busy(delBtn, true);
        api('DELETE', '/api/documents/' + encodeURIComponent(d.id))
          .then(function () { changed = true; toast('Documento eliminado.', 'ok'); dlg.close(); })
          .catch(function (e) { busy(delBtn, false); showMsg(msg, e.message); });
      });

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = readForm(form);
        var common = {
          servicio_mes: f.servicio_mes || null, servicio_hasta: f.servicio_hasta || null, concepto: f.concepto || null, oc: f.oc || null,
          hes: splitList(f.hes), notes: f.notes || null, refacturar_con: f.refacturar_con || null, sii_evento: f.sii_evento || '', cedida: f.cedida, requiere_nc: f.requiere_nc, solo_anular: f.solo_anular, cesionario: f.cesionario || null
        };
        var payload, method, path;
        if (isNew) {
          if (!f.client_id) { showMsg(msg, 'Elige el cliente.'); return; }
          if (!f.folio) { showMsg(msg, 'Escribe el folio.'); return; }
          if (!f.fecha) { showMsg(msg, 'Escribe la fecha.'); return; }
          if (f.total === null) { showMsg(msg, 'Escribe el total.'); return; }
          var tipo = +f.tipo;
          payload = Object.assign({
            client_id: +f.client_id, tipo: tipo, folio: +f.folio, fecha: f.fecha, periodo: f.fecha.slice(0, 7),
            neto: f.neto || 0, exento: f.exento || 0, iva: f.iva || 0, total: f.total, glosa: f.glosa || null
          }, common);
          if ((tipo === 61 || tipo === 56) && f.ref_folio) { payload.ref_tipo = +f.ref_tipo; payload.ref_folio = +f.ref_folio; payload.ref_codigo = +f.ref_codigo; }
          method = 'POST'; path = '/api/documents';
        } else {
          payload = common; method = 'PUT'; path = '/api/documents/' + encodeURIComponent(d.id);
        }
        var btn = $('button[type=submit]', form);
        busy(btn, true, 'Guardando…');
        api(method, path, payload)
          .then(function () { changed = true; toast(isNew ? 'Documento agregado.' : 'Cambios guardados.', 'ok'); dlg.close(); })
          .catch(function (e) { busy(btn, false); showMsg(msg, e.message); });
      });
    });
  }

  /* ======================================================================
   * 5. Documentos (lista filtrable)
   * ==================================================================== */
  function viewDocuments(ctx) {
    var q = ctx.query;
    return getClients().catch(function () { return []; }).then(function () {
      if (ctx.stale()) return;
      viewEl.innerHTML = pageHead('Documentos', 'Todas las facturas, notas de crédito y notas de débito. Filtra para encontrar lo que buscas.',
        '<button type="button" class="btn" id="newDocBtn">Agregar documento</button>') +
        '<div class="card"><form id="docFilters" class="filters" role="search" aria-label="Filtrar documentos">' +
        fld({ label: 'Cliente', name: 'client_id', type: 'select', optionsHtml: clientOptions(q.client_id, 'Todos') }) +
        fld({ label: 'Estado', name: 'estado', type: 'select', value: q.estado || '', options: [['', 'Todos'], ['pendiente,parcial', 'Por cobrar (pendiente + pago parcial)'], ['pendiente', 'Pendiente de pago'], ['parcial', 'Pago parcial'], ['pagada', 'Pagada'], ['reclamada_sin_nc', 'Reclamada: falta NC'], ['cedida', 'Cedida'], ['anulada', 'Anulada']] }) +
        fld({ label: 'Tipo', name: 'tipo', type: 'select', value: q.tipo || '', options: [['', 'Todos'], [33, 'Factura'], [34, 'Factura exenta'], [56, 'Nota de débito'], [61, 'Nota de crédito']] }) +
        fld({ label: 'Desde', name: 'desde', type: 'date', value: q.desde }) +
        fld({ label: 'Hasta', name: 'hasta', type: 'date', value: q.hasta }) +
        fld({ label: 'Buscar', name: 'q', type: 'search', value: q.q, placeholder: 'Folio, OC, glosa…' }) +
        '<div class="btn-row"><button type="button" class="btn secondary small" id="clearF">Limpiar filtros</button></div>' +
        '</form><div id="docResults">' + loadingHtml() + '</div></div>';
      var form = $('#docFilters');
      var load = function () {
        var f = readForm(form);
        var params = { client_id: f.client_id, tipo: f.tipo, estado: f.estado, desde: f.desde, hasta: f.hasta, q: f.q };
        var box = $('#docResults');
        box.innerHTML = loadingHtml();
        var mySeq = renderSeq;
        api('GET', '/api/documents' + qs(params)).then(function (r) {
          if (mySeq !== renderSeq) return;
          var docs = list(r, 'documents', 'documentos');
          docs.sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')) || num(b.folio) - num(a.folio); });
          var max = 1000;
          box.innerHTML = '<p class="muted small" role="status">' + esc(docs.length) + ' documento(s)' + (docs.length > max ? ' — se muestran los primeros ' + max + '. Usa los filtros para acotar.' : '') + '</p>' +
            docsTable(docs.slice(0, max), { showClient: true, emptyText: 'No hay documentos con estos filtros.' });
          bindDocsTable(box, docs, load);
        }).catch(function (e) {
          if (e.status === 401) return;
          box.innerHTML = errorRetryHtml(e, 'docRetry');
          $('#docRetry').addEventListener('click', load);
        });
        // Recordar filtros en la dirección (sin recargar)
        var newHash = '#/documentos' + qs(params);
        if (location.hash !== newHash && history.replaceState) history.replaceState(null, '', newHash);
      };
      form.addEventListener('change', load);
      form.addEventListener('submit', function (e) { e.preventDefault(); load(); });
      $('[name=q]', form).addEventListener('input', debounce(load, 400));
      $('#clearF').addEventListener('click', function () { form.reset(); $$('input,select', form).forEach(function (el) { if (el.type !== 'checkbox') el.value = ''; }); load(); });
      $('#newDocBtn').addEventListener('click', function () { openDocDialog(null, load, $('[name=client_id]', form).value || null); });
      load();
    });
  }

  /* ======================================================================
   * 6. Banco: cartolas, movimientos y conciliación
   * ==================================================================== */
  function movAssigned(m) {
    if (isNum(m.asignado)) return num(m.asignado);
    if (isNum(m.allocated)) return num(m.allocated);
    return list(m.allocations).reduce(function (s, a) { return s + num(a.amount); }, 0);
  }
  function movRemaining(m) { return Math.max(0, num(m.abono) - movAssigned(m)); }

  function viewBank(ctx) {
    var q = ctx.query;
    return getClients().catch(function () { return []; }).then(function () {
      if (ctx.stale()) return;
      var html = pageHead('Banco', 'Sube las cartolas del BCI. El sistema guarda los movimientos (sin duplicar) y reconoce qué facturas pagó cada cliente.',
        '<button type="button" class="btn secondary" id="pollBtn">Revisar correo ahora</button><button type="button" class="btn" id="autoBtn">Conciliar automático</button>');
      html += '<section class="card" aria-labelledby="upTitle"><h2 id="upTitle">Subir cartolas</h2>' +
        '<p class="help">Acepta PDF (también con clave), Excel (XLSX), CSV/TXT y HTML del BCI. Puedes subir varios archivos a la vez; los movimientos repetidos se ignoran solos. Las cartolas que lleguen a tu correo se cargan automáticamente si está configurado en Ajustes.</p>' +
        '<label class="dropzone" id="dropzone" for="fileInput"><span class="big">Arrastra aquí tus cartolas</span><br><span class="muted">o haz clic para elegirlas</span>' +
        '<input type="file" id="fileInput" class="sr-only" tabindex="-1" multiple accept=".pdf,.xlsx,.xls,.csv,.txt,.html,.htm,application/pdf"></label>' +
        '<ul class="file-list" id="pickedList" aria-label="Archivos elegidos"></ul>' +
        '<div class="btn-row hidden" id="uploadRow"><button type="button" class="btn" id="uploadBtn">Subir archivos</button><button type="button" class="btn secondary" id="clearPicked">Quitar</button></div>' +
        '<div class="results" id="uploadResult" aria-live="polite"></div></section>';
      html += '<div id="autoResult" aria-live="polite"></div>';
      html += '<section class="card" aria-labelledby="mvTitle"><div class="card-head"><h2 id="mvTitle">Movimientos</h2></div>' +
        '<p class="help">Para cada abono sin asignar, usa <strong>Asignar</strong> para decir qué factura(s) paga. Si un abono no es de un cliente (traspaso propio, devolución…), usa <strong>Ignorar</strong>.</p>' +
        '<form id="mvFilters" class="filters" role="search" aria-label="Filtrar movimientos">' +
        fld({ label: 'Desde', name: 'desde', type: 'date', value: q.desde }) +
        fld({ label: 'Hasta', name: 'hasta', type: 'date', value: q.hasta }) +
        fld({ label: 'Cliente', name: 'client_id', type: 'select', optionsHtml: clientOptions(q.client_id, 'Todos') }) +
        fld({ label: 'Buscar', name: 'q', type: 'search', value: q.q, placeholder: 'Texto de la glosa, N° doc…' }) +
        fld({ label: 'Solo abonos (ingresos)', name: 'solo_abonos', type: 'checkbox', value: q.solo_abonos === undefined ? 1 : (q.solo_abonos === 'true' || q.solo_abonos === '1') }) +
        fld({ label: 'Solo sin asignar', name: 'sin_asignar', type: 'checkbox', value: q.sin_asignar === 'true' || q.sin_asignar === '1' }) +
        '</form><div id="mvResults">' + loadingHtml() + '</div></section>';
      html += '<details class="card" id="filesBox"><summary>Archivos cargados</summary><div id="filesList">' + loadingHtml() + '</div></details>';
      viewEl.innerHTML = html;

      /* --- subida --- */
      var picked = [];
      var input = $('#fileInput'), dz = $('#dropzone');
      var showPicked = function () {
        $('#pickedList').innerHTML = picked.map(function (f, i) {
          return '<li><span>' + esc(f.name) + ' <span class="muted">(' + esc(Math.max(1, Math.round(f.size / 1024))) + ' KB)</span></span>' +
            '<button type="button" class="x-btn" data-rm="' + i + '" aria-label="Quitar ' + esc(f.name) + '">×</button></li>';
        }).join('');
        $('#uploadRow').classList.toggle('hidden', !picked.length);
        $$('[data-rm]', $('#pickedList')).forEach(function (b) {
          b.addEventListener('click', function () { picked.splice(+b.getAttribute('data-rm'), 1); showPicked(); });
        });
      };
      var addFiles = function (fl) {
        Array.prototype.forEach.call(fl || [], function (f) {
          if (!picked.some(function (p) { return p.name === f.name && p.size === f.size; })) picked.push(f);
        });
        showPicked();
      };
      input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
      ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
      ['dragleave', 'dragend'].forEach(function (t) { dz.addEventListener(t, function () { dz.classList.remove('over'); }); });
      dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer && e.dataTransfer.files); });
      dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      dz.setAttribute('tabindex', '0'); dz.setAttribute('role', 'button');
      $('#clearPicked').addEventListener('click', function () { picked = []; showPicked(); });
      $('#uploadBtn').addEventListener('click', function () {
        if (!picked.length) return;
        var fd = new FormData();
        picked.forEach(function (f) { fd.append('files', f, f.name); });
        var btn = $('#uploadBtn');
        busy(btn, true, 'Subiendo…');
        $('#uploadResult').innerHTML = loadingHtml('Leyendo las cartolas…');
        api('POST', '/api/bank/upload', fd).then(function (r) {
          busy(btn, false);
          picked = []; showPicked();
          var files = list(r, 'files');
          var totalNew = files.reduce(function (s, f) { return s + num(f.rows_new); }, 0);
          $('#uploadResult').innerHTML = '<div class="table-wrap"><table><thead><tr><th scope="col">Archivo</th><th scope="col" class="num">Movimientos leídos</th>' +
            '<th scope="col" class="num">Nuevos</th><th scope="col">Observaciones</th></tr></thead><tbody>' +
            (files.length ? files.map(function (f) {
              var errs = jsonList(f.errors);
              return '<tr><td>' + esc(f.filename) + '</td><td class="num">' + esc(entero(f.rows_total)) + '</td><td class="num">' + esc(entero(f.rows_new)) + '</td><td>' +
                (f.duplicado ? '<span class="chip muted">Ya estaba cargado</span>' : errs.length ?'<span class="chip bad">Con problemas</span> ' + esc(errs.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : x; }).join(' · ')) :
                  (num(f.rows_new) === 0 && num(f.rows_total) > 0 ? '<span class="chip muted">Ya estaba cargado</span>' : '<span class="chip ok">OK</span>')) + '</td></tr>';
            }).join('') : emptyRow(4, 'El servidor no devolvió resultados.')) + '</tbody></table></div>' +
            (totalNew ? '<p class="form-ok">Se agregaron ' + esc(entero(totalNew)) + ' movimientos nuevos. Ahora puedes usar <strong>Conciliar automático</strong>.</p>' : '');
          toast('Cartolas procesadas: ' + entero(totalNew) + ' movimientos nuevos.', 'ok');
          if (r && r.match && typeof r.match === 'object') showAutoResult(r.match, true);
          loadMovs(); loadFiles();
        }).catch(function (e) { busy(btn, false); $('#uploadResult').innerHTML = errorHtml(e); });
      });

      /* --- correo --- */
      $('#pollBtn').addEventListener('click', function () {
        var btn = $('#pollBtn');
        busy(btn, true, 'Revisando correo…');
        api('POST', '/api/email/poll').then(function (r) {
          busy(btn, false);
          $('#autoResult').innerHTML = '<section class="card"><div class="card-head"><h2>Revisión del correo</h2><button type="button" class="btn small secondary" data-dismiss>Cerrar</button></div>' + resultHtml(r) + '</section>';
          $('[data-dismiss]', $('#autoResult')).addEventListener('click', function () { $('#autoResult').innerHTML = ''; });
          toast('Correo revisado.', 'ok');
          loadMovs(); loadFiles();
        }).catch(function (e) { busy(btn, false); toastErr(e); });
      });

      /* --- conciliación automática --- */
      $('#autoBtn').addEventListener('click', function () {
        var btn = $('#autoBtn');
        busy(btn, true, 'Conciliando…');
        api('POST', '/api/match/auto').then(function (r) {
          busy(btn, false);
          showAutoResult(r || {});
          loadMovs();
        }).catch(function (e) { busy(btn, false); toastErr(e); });
      });

      var showAutoResult = function (r, afterUpload) {
        var asig = Array.isArray(r.asignados) ? r.asignados.length : num(r.asignados);
        var sinC = Array.isArray(r.sin_cliente) ? r.sin_cliente.length : num(r.sin_cliente);
        var sinM = Array.isArray(r.sin_match) ? r.sin_match.length : num(r.sin_match);
        var amb = list(r.ambiguos, 'ambiguos');
        var h = '<section class="card" aria-labelledby="arTitle"><div class="card-head"><h2 id="arTitle">' +
          (afterUpload ? 'Conciliación automática después de subir las cartolas' : 'Resultado de la conciliación') +
          '</h2><button type="button" class="btn small secondary" data-dismiss>Cerrar</button></div>' +
          '<div class="stats">' + statCard({ label: 'Pagos asignados solos', value: esc(entero(asig)), kind: 'ok' }) +
          statCard({ label: 'Sin cliente reconocido', value: esc(entero(sinC)), desc: 'Asígnalos a mano o agrega cómo aparece el cliente en el banco.', kind: sinC ? 'warn' : 'ok' }) +
          (r.sin_match !== undefined ? statCard({ label: 'Sin factura que calce', value: esc(entero(sinM)), desc: 'Se sabe el cliente, pero ninguna factura suma ese monto. Asígnalos a mano.', kind: sinM ? 'warn' : 'ok' }) : '') +
          statCard({ label: 'Con varias opciones', value: esc(entero(amb.length)), desc: 'Elige abajo cuál es la correcta.', kind: amb.length ? 'warn' : 'ok' }) + '</div>';
        var det = list(r.detalle, 'detalle');
        if (det.length) {
          h += '<details open><summary><strong>Pagos que se asignaron solos (' + esc(det.length) + ')</strong> — revísalos</summary>' +
            '<div class="table-wrap"><table><thead><tr><th scope="col">Fecha</th><th scope="col" class="num">Monto</th><th scope="col">Cliente</th>' +
            '<th scope="col">Facturas que paga</th><th scope="col" class="opt">Glosa del banco</th></tr></thead><tbody>' +
            det.map(function (x) {
              return '<tr><td class="nowrap">' + esc(fdate(x.fecha)) + '</td><td class="num">' + esc(clp(x.monto)) + '</td><td>' +
                esc(x.cliente || clientName(x.client_id) || '—') + '</td><td>' +
                list(x.documentos).map(function (d) { return '<span class="alloc">' + esc(docLabel(d)) + '</span>'; }).join('') +
                '</td><td class="desc opt">' + esc(x.descripcion || '') + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<p class="help">Si alguno no corresponde, quítalo con la × junto a la factura en la lista de movimientos.</p></details>';
        }
        if (amb.length) {
          h += '<h3>Elige la opción correcta</h3>' + amb.map(function (a, i) {
            var m = a.movement || a.movimiento || {};
            var opts = normOptions(a.opciones || a.options || a.sugerencias, m.abono);
            return '<div class="card"><p><strong>' + esc(fdate(m.fecha)) + ' · ' + esc(clp(m.abono)) + '</strong> — ' + esc(m.descripcion || '') +
              (m.client_id ? ' <span class="tag">' + esc(clientName(m.client_id)) + '</span>' : '') + '</p>' +
              optionsHtml(opts, 'amb' + i) + '</div>';
          }).join('');
        }
        h += '</section>';
        var box = $('#autoResult');
        box.innerHTML = h;
        $('[data-dismiss]', box).addEventListener('click', function () { box.innerHTML = ''; });
        amb.forEach(function (a, i) {
          var m = a.movement || a.movimiento || {};
          var opts = normOptions(a.opciones || a.options || a.sugerencias, m.abono);
          bindOptions(box, opts, 'amb' + i, m, function () { loadMovs(); });
        });
        toast('Conciliación lista: ' + entero(asig) + ' pago(s) asignado(s).', 'ok');
      };

      /* --- movimientos --- */
      var mvForm = $('#mvFilters');
      var movs = [];
      var loadMovs = function () {
        var f = readForm(mvForm);
        var params = { desde: f.desde, hasta: f.hasta, client_id: f.client_id, q: f.q, solo_abonos: !!f.solo_abonos, sin_asignar: !!f.sin_asignar };
        var box = $('#mvResults');
        box.innerHTML = loadingHtml();
        var mySeq = renderSeq;
        api('GET', '/api/bank/movements' + qs(params)).then(function (r) {
          if (mySeq !== renderSeq) return;
          movs = list(r, 'movements', 'movimientos');
          movs.sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')) || num(b.id) - num(a.id); });
          renderMovs(box);
        }).catch(function (e) {
          if (e.status === 401) return;
          box.innerHTML = errorRetryHtml(e, 'mvRetry');
          $('#mvRetry').addEventListener('click', loadMovs);
        });
        var newHash = '#/banco' + qs(Object.assign({}, params, { solo_abonos: f.solo_abonos ? 'true' : 'false' }));
        if (location.hash !== newHash && history.replaceState) history.replaceState(null, '', newHash);
      };
      var renderMovs = function (box) {
        var max = 800;
        var sumAb = 0, sumCa = 0, sinAsig = 0;
        movs.forEach(function (m) { sumAb += num(m.abono); sumCa += num(m.cargo); if (num(m.abono) > 0 && !+m.ignored && movRemaining(m) > 0) sinAsig += 1; });
        var h = '<p class="muted small" role="status">' + esc(movs.length) + ' movimiento(s) · ' + esc(sinAsig) + ' abono(s) por asignar' +
          (movs.length > max ? ' — se muestran los primeros ' + max + '. Usa los filtros para acotar.' : '') + '</p>' +
          '<div class="table-wrap"><table class="tbl-opt"><thead><tr><th scope="col">Fecha</th><th scope="col">Descripción</th><th scope="col" class="opt">N° doc</th>' +
          '<th scope="col" class="num">Cargo</th><th scope="col" class="num">Abono</th><th scope="col">Cliente</th><th scope="col">Asignado a</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>';
        if (!movs.length) h += emptyRow(8, 'No hay movimientos con estos filtros. Sube una cartola arriba.');
        movs.slice(0, max).forEach(function (m) {
          var ign = !!+m.ignored;
          var ab = num(m.abono);
          var rem = movRemaining(m);
          var allocs = list(m.allocations);
          var status;
          if (ign) status = '<span class="chip muted">Ignorado</span>';
          else if (ab <= 0) status = '';
          else if (rem <= 0) status = '<span class="chip ok">Asignado</span>';
          else if (movAssigned(m) > 0) status = '<span class="chip warn">Falta ' + esc(clp(rem)) + '</span>';
          else status = '<span class="chip warn">Sin asignar</span>';
          var allocHtml = allocs.map(function (a) {
            var lbl = (TIPO_CORTO[+a.tipo] || 'F') + ' ' + (a.folio !== undefined ? a.folio : '#' + a.document_id);
            return '<span class="alloc">' + esc(lbl) + ' · ' + esc(clp(a.amount)) + (+a.anticipo ? ' · Anticipo' : '') +
              (a.id !== undefined ? '<button type="button" class="x-btn" data-unalloc="' + esc(a.id) + '" aria-label="Quitar asignación ' + esc(lbl) + '" title="Quitar">×</button>' : '') + '</span>';
          }).join('');
          h += '<tr class="' + (ign ? 'row-ignored' : '') + '"><td class="nowrap">' + esc(fdate(m.fecha)) + (m.cuenta ? '<span class="sub">Cta ' + esc(m.cuenta) + '</span>' : '') + '</td>' +
            '<td class="desc">' + esc(m.descripcion || '') + (m.payer_rut ? '<span class="sub">RUT ' + esc(m.payer_rut) + '</span>' : '') +
              (m.notes ? '<span class="sub mov-nota">' + esc(m.notes) + '</span>' : '') + '</td>' +
            '<td class="opt">' + esc(m.documento || '') + '</td>' +
            '<td class="num">' + (num(m.cargo) ? esc(clp(m.cargo)) : '') + '</td>' +
            '<td class="num">' + (ab ? '<strong>' + esc(clp(ab)) + '</strong>' : '') + '</td>' +
            '<td>' + (m.client_id ? '<a href="#/cliente/' + esc(m.client_id) + '">' + esc(m.client_short || m.client_name || clientName(m.client_id)) + '</a>' : '<span class="muted">—</span>') + '</td>' +
            '<td>' + status + (!ign && rem > 0 && list(m.sugerencias).length ? ' <span class="chip info">Hay sugerencias</span>' : '') +(allocHtml ? '<div>' + allocHtml + '</div>' : '') + '</td>' +
            '<td class="actions">' + (ab > 0 && !ign && rem > 0 ? '<button type="button" class="btn small" data-assign="' + esc(m.id) + '">Asignar</button> ' : '') +
            (ab > 0 && !ign && movAssigned(m) === 0 ? '<button type="button" class="btn small secondary" data-ignore="' + esc(m.id) + '">Ignorar</button>' : '') +
            (ign ? '<button type="button" class="btn small secondary" data-unignore="' + esc(m.id) + '">Volver a considerar</button>' : '') + '</td></tr>';
        });
        h += '</tbody>' + (movs.length > 1 ? '<tfoot><tr><td colspan="3">Totales</td><td class="num">' + esc(clp(sumCa)) + '</td><td class="num">' + esc(clp(sumAb)) + '</td><td colspan="3"></td></tr></tfoot>' : '') + '</table></div>';
        box.innerHTML = h;
        var byId = function (id) { return movs.filter(function (x) { return String(x.id) === String(id); })[0]; };
        $$('[data-assign]', box).forEach(function (b) { b.addEventListener('click', function () { openAssignDialog(byId(b.getAttribute('data-assign')), loadMovs); }); });
        $$('[data-ignore]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            busy(b, true);
            api('PUT', '/api/bank/movements/' + encodeURIComponent(b.getAttribute('data-ignore')), { ignored: 1 })
              .then(function () { toast('Movimiento ignorado.', 'ok'); loadMovs(); }).catch(function (e) { busy(b, false); toastErr(e); });
          });
        });
        $$('[data-unignore]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            busy(b, true);
            api('PUT', '/api/bank/movements/' + encodeURIComponent(b.getAttribute('data-unignore')), { ignored: 0 })
              .then(function () { loadMovs(); }).catch(function (e) { busy(b, false); toastErr(e); });
          });
        });
        $$('[data-unalloc]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('¿Quitar esta asignación? La factura volverá a quedar pendiente por ese monto.')) return;
            api('DELETE', '/api/allocations/' + encodeURIComponent(b.getAttribute('data-unalloc')))
              .then(function () { toast('Asignación quitada.', 'ok'); loadMovs(); }).catch(function (e) { toastErr(e); });
          });
        });
      };
      mvForm.addEventListener('change', loadMovs);
      mvForm.addEventListener('submit', function (e) { e.preventDefault(); loadMovs(); });
      $('[name=q]', mvForm).addEventListener('input', debounce(loadMovs, 400));

      /* --- archivos --- */
      var loadFiles = function () {
        var box = $('#filesList');
        api('GET', '/api/files').then(function (r) {
          var files = list(r, 'files').slice().sort(function (a, b) { return String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || '')); });
          box.innerHTML = '<p class="help">Si subiste una cartola equivocada, usa <strong>Deshacer</strong>: borra sus movimientos que aún no estén asignados a facturas.</p>' +
            '<div class="table-wrap"><table class="tbl-opt"><thead><tr><th scope="col">Archivo</th><th scope="col" class="opt">Tipo</th><th scope="col">Origen</th><th scope="col">Cargado</th>' +
            '<th scope="col" class="num">Movimientos</th><th scope="col" class="num opt">Nuevos</th><th scope="col" class="opt">Nota</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>' +
            (files.length ? files.map(function (f) {
              return '<tr><td>' + esc(f.filename) + '</td><td class="opt">' + esc(f.kind || '') + '</td><td>' + (f.source === 'email' ? 'Correo' : 'Subido a mano') + '</td>' +
                '<td class="nowrap">' + esc(fdatetime(f.uploaded_at)) + '</td><td class="num">' + esc(entero(f.movimientos !== undefined ? f.movimientos : f.rows_total)) + '</td><td class="num opt">' + esc(entero(f.rows_new)) + '</td><td class="desc opt">' + esc(f.note || '') + '</td>' +
                '<td class="actions">' + (f.kind === 'cartola' ? '<button type="button" class="btn small danger" data-del-file="' + esc(f.id) + '" data-name="' + esc(f.filename) + '">Deshacer</button>' : '') + '</td></tr>';
            }).join('') : emptyRow(8, 'Todavía no se ha cargado ningún archivo.')) + '</tbody></table></div>';
          $$('[data-del-file]', box).forEach(function (b) {
            b.addEventListener('click', function () {
              if (!confirm('¿Deshacer la carga de "' + b.getAttribute('data-name') + '"?\n\nSe borrarán sus movimientos que no estén asignados a facturas. Los que ya pagan facturas se conservan.')) return;
              busy(b, true);
              api('DELETE', '/api/files/' + encodeURIComponent(b.getAttribute('data-del-file'))).then(function (r) {
                toast('Carga deshecha: ' + entero(r && r.movimientos_borrados) + ' movimiento(s) borrado(s)' +
                  (r && r.movimientos_conservados ? ', ' + entero(r.movimientos_conservados) + ' conservado(s) por tener asignaciones.' : '.'), 'ok');
                loadFiles(); loadMovs();
              }).catch(function (e) { busy(b, false); toastErr(e); });
            });
          });
        }).catch(function (e) {
          if (e.status === 401) return;
          box.innerHTML = errorRetryHtml(e, 'filesRetry');
          $('#filesRetry').addEventListener('click', loadFiles);
        });
      };

      loadMovs(); loadFiles();
    });
  }

  /* Normaliza las opciones de conciliación.
   * Acepta: [[doc,…],…] | [{documentos:[…], total, tipo},…] | {opciones:[…]}.
   * Devuelve [{docs:[{doc, amount}], total, tipo}] con el monto a asignar a cada documento. */
  function docSaldo(doc) { return isNum(doc.amount) ? num(doc.amount) : (isNum(doc.saldo) ? num(doc.saldo) : num(doc.total)); }
  function normOptions(d, limit) {
    var arr = Array.isArray(d) ? d : list(d, 'opciones', 'options', 'sugerencias', 'combinaciones', 'candidatos', 'suggestions');
    return arr.map(function (o) {
      var ds = [], total = null, tipo = '';
      if (Array.isArray(o)) ds = o;
      else if (o && typeof o === 'object') {
        var inner = o.documentos || o.documents || o.docs || o.facturas;
        if (Array.isArray(inner)) { ds = inner; total = isNum(o.total) ? num(o.total) : null; tipo = o.tipo || ''; }
        else if (o.id !== undefined || o.document_id !== undefined) ds = [o];
      }
      var docs = ds.filter(function (x) { return x && typeof x === 'object'; }).map(function (x) { return { doc: x, amount: docSaldo(x) }; });
      var sum = docs.reduce(function (s, x) { return s + x.amount; }, 0);
      // Pago parcial: el total de la opción es menor al saldo; no asignar más que lo disponible.
      var cap = [total, isNum(limit) ? num(limit) : null].filter(function (v) { return v !== null; });
      var max = cap.length ? Math.min.apply(null, cap) : null;
      if (max !== null && sum > max) {
        var left = max;
        docs.forEach(function (x) { x.amount = Math.max(0, Math.min(x.amount, left)); left -= x.amount; });
        docs = docs.filter(function (x) { return x.amount > 0; });
        sum = docs.reduce(function (s, x) { return s + x.amount; }, 0);
        if (!tipo) tipo = 'parcial';
      }
      return { docs: docs, total: sum, tipo: tipo };
    }).filter(function (o) { return o.docs.length; });
  }
  var OPT_TIPOS = { exacto: 'Coincide exacto', combinacion: 'Suma de varias facturas', parcial: 'Pago parcial', anticipo: 'Anticipo (factura emitida después del pago)' };
  function optionsHtml(opts, prefix) {
    if (!opts.length) return '<p class="muted">No hay facturas que sumen exactamente este monto. Puedes marcarlas a mano abajo.</p>';
    return '<div class="options">' + opts.map(function (o, i) {
      return '<div class="option"><div class="docs">' + (OPT_TIPOS[o.tipo] ? '<span class="sub"><strong>' + esc(OPT_TIPOS[o.tipo]) + '</strong></span>' : '') +
        o.docs.map(function (x) {
          return '<span class="alloc">' + esc(docLabel(x.doc)) + (x.doc.fecha ? ' · ' + esc(fdate(x.doc.fecha)) : '') + ' · ' + esc(clp(x.amount)) + '</span>';
        }).join('') + '<span class="sub">Suma ' + esc(clp(o.total)) + '</span></div>' +
        '<button type="button" class="btn small" data-opt="' + prefix + '-' + i + '">Usar esta opción</button></div>';
    }).join('') + '</div>';
  }
  function postAllocations(movementId, items) {
    // Una sola llamada: el servidor guarda todas o ninguna (si una falla, no queda nada a medias).
    return api('POST', '/api/allocations', {
      movement_id: +movementId,
      items: items.map(function (it) { return { document_id: +it.document_id, amount: Math.round(it.amount) }; })
    });
  }
  function bindOptions(root, opts, prefix, mov, done) {
    opts.forEach(function (o, i) {
      var b = $('[data-opt="' + prefix + '-' + i + '"]', root);
      if (!b) return;
      b.addEventListener('click', function () {
        busy(b, true, 'Asignando…');
        postAllocations(mov.id, o.docs.map(function (x) { return { document_id: docId(x.doc), amount: x.amount }; }))
          .then(function () {
            toast('Pago asignado.', 'ok');
            var card = b.closest('.card') || b.closest('.option');
            if (card && root.id === 'autoResult') card.innerHTML = '<p class="form-ok">Asignado.</p>';
            done();
          })
          .catch(function (e) { busy(b, false); toastErr(e); });
      });
    });
  }

  function openAssignDialog(m, onDone) {
    if (!m) return;
    var rem = movRemaining(m);
    var changed = false;
    var body = '<dl class="kv"><dt>Fecha</dt><dd>' + esc(fdate(m.fecha)) + '</dd><dt>Descripción</dt><dd>' + esc(m.descripcion || '—') + (m.documento ? ' · Doc ' + esc(m.documento) : '') + '</dd>' +
      (m.payer_rut ? '<dt>RUT de quien pagó</dt><dd>' + esc(m.payer_rut) + '</dd>' : '') +
      (m.notes ? '<dt>Nota</dt><dd>' + esc(m.notes) + '</dd>' : '') +
      '<dt>Monto del abono</dt><dd><strong>' + esc(clp(m.abono)) + '</strong></dd>' +
      (movAssigned(m) > 0 ? '<dt>Ya asignado</dt><dd>' + esc(clp(movAssigned(m))) + '</dd>' : '') +
      '<dt>Por asignar</dt><dd><strong>' + esc(clp(rem)) + '</strong></dd></dl>' +
      '<div class="form-grid">' + fld({ label: '¿Qué cliente hizo este pago?', name: 'client_id', id: 'asgClient', type: 'select', optionsHtml: clientOptions(m.client_id, 'Elige un cliente…'),
        help: 'Al elegirlo, el sistema recuerda que este movimiento es de ese cliente.' }) + '</div>' +
      '<h3>Sugerencias</h3><div id="asgSug"><p class="muted">Elige un cliente para ver sugerencias.</p></div>' +
      '<h3>Facturas abiertas del cliente</h3><p class="help">Marca la(s) factura(s) que paga este abono. Puedes ajustar el monto si es un pago parcial.</p>' +
      '<div id="asgDocs"><p class="muted">Elige un cliente.</p></div>' +
      '<div class="sum-line" id="asgSum" aria-live="polite"></div><div id="asgMsg"></div>' +
      '<div class="form-actions"><button type="button" class="btn danger left" id="asgIgnore">Ignorar este movimiento</button>' +
      '<button type="button" class="btn secondary" id="asgIgnoreAll" title="Útil para traspasos propios, por ejemplo TRASPASO DESDE LINEA SOBREGIRO">Ignorar todos los iguales</button>' +
      '<button type="button" class="btn secondary" data-close>Cancelar</button><button type="button" class="btn" id="asgSave" disabled>Asignar seleccionadas</button></div>';
    var dlg = openDialog('Asignar pago', body, { wide: true, onClose: function () { if (changed) onDone(); } });
    var sel = $('#asgClient', dlg), msg = $('#asgMsg', dlg);
    var openDocs = [];

    var updateSum = function () {
      var total = 0, n = 0, over = null;
      $$('input[data-doc-chk]', dlg).forEach(function (c) {
        if (!c.checked) return;
        var id = c.getAttribute('data-doc-chk');
        var amt = parseCLP($('input[data-doc-amt="' + id + '"]', dlg).value) || 0;
        n += 1; total += amt;
        var doc = openDocs.filter(function (x) { return String(x.id) === id; })[0];
        if (doc && amt > num(doc.saldo) && !over) over = doc;
      });
      var diff = rem - total;
      $('#asgSum', dlg).innerHTML = '<span>Seleccionado: ' + esc(clp(total)) + ' (' + n + ' factura' + (n === 1 ? '' : 's') + ')</span>' +
        (over ? '<span class="bad">El monto para ' + esc(docLabel(over)) + ' es mayor que lo que se debe de ella (' + esc(clp(over.saldo)) + ')</span>' :
          '<span class="' + (diff < 0 ? 'bad' : diff === 0 && n ? 'ok' : '') + '">' + (diff < 0 ? 'Te pasaste por ' + esc(clp(-diff)) : 'Queda por asignar ' + esc(clp(diff))) + '</span>');
      $('#asgSave', dlg).disabled = !n || diff < 0 || !!over;
    };

    var loadDocs = function (cid) {
      var box = $('#asgDocs', dlg);
      if (!cid) { box.innerHTML = '<p class="muted">Elige un cliente.</p>'; openDocs = []; updateSum(); return; }
      box.innerHTML = loadingHtml();
      api('GET', '/api/documents' + qs({ client_id: cid })).then(function (r) {
        openDocs = list(r, 'documents', 'documentos').filter(function (d) {
          return +d.tipo !== 61 && num(d.saldo) > 0 && ['pendiente', 'parcial', 'reclamada_sin_nc', 'cedida'].indexOf(d.estado) >= 0;
        }).sort(function (a, b) { return String(a.fecha || '').localeCompare(String(b.fecha || '')); });
        if (!openDocs.length) { box.innerHTML = '<p class="muted">Este cliente no tiene facturas con saldo pendiente.</p>'; updateSum(); return; }
        box.innerHTML = '<div class="table-wrap"><table><thead><tr><th scope="col">Pagar</th><th scope="col">Documento</th><th scope="col">Fecha</th><th scope="col">Mes servicio</th>' +
          '<th scope="col">Estado</th><th scope="col" class="num">Saldo</th><th scope="col" class="num">Monto a asignar</th></tr></thead><tbody>' +
          openDocs.map(function (d) {
            var cid2 = 'chk' + esc(d.id);
            var match = num(d.saldo) === rem;
            return '<tr class="' + (match ? 'row-highlight' : '') + '"><td><input type="checkbox" id="' + cid2 + '" data-doc-chk="' + esc(d.id) + '"></td>' +
              '<td><label for="' + cid2 + '"><strong>' + esc(docLabel(d)) + '</strong></label>' + (match ? '<span class="sub">Coincide con el monto</span>' : '') + '</td>' +
              '<td class="nowrap">' + esc(fdate(d.fecha)) + '</td><td class="nowrap">' + esc(fmes(d.servicio_mes || d.periodo)) + '</td><td>' + chip(d.estado, d) + '</td>' +
              '<td class="num">' + esc(clp(d.saldo)) + '</td>' +
              '<td class="num"><input type="text" inputmode="numeric" class="num" data-money data-doc-amt="' + esc(d.id) + '" aria-label="Monto a asignar a ' + esc(docLabel(d)) + '" value="' + esc(clp(Math.min(num(d.saldo), rem))) + '"></td></tr>';
          }).join('') + '</tbody></table></div>';
        bindMoney(box);
        $$('input[data-doc-chk], input[data-doc-amt]', box).forEach(function (el) { el.addEventListener('input', updateSum); el.addEventListener('change', updateSum); });
        updateSum();
      }).catch(function (e) { box.innerHTML = errorHtml(e); });
    };

    /* Pide sugerencias al servidor. Si el movimiento no tiene cliente, el servidor intenta reconocerlo. */
    var loadSug = function (first) {
      var box = $('#asgSug', dlg);
      box.innerHTML = loadingHtml('Buscando combinaciones…');
      api('GET', '/api/match/suggest/' + encodeURIComponent(m.id) + qs({ client_id: sel.value || m.client_id })).then(function (r) {
        var detected = r && !Array.isArray(r) ? r.client_id : null;
        if (first && !sel.value && detected) {
          sel.value = String(detected);
          if (sel.value) {
            $('#asgSug', dlg).insertAdjacentHTML('beforebegin', '<p class="form-ok" id="asgDetected">El sistema reconoció al cliente por la glosa del banco. Revisa que sea correcto.</p>');
            loadDocs(sel.value);
          }
        }
        if (!sel.value) { box.innerHTML = '<p class="muted">Elige un cliente para ver sugerencias.</p>'; return; }
        var opts = normOptions(r, rem);
        box.innerHTML = optionsHtml(opts, 'sug');
        bindOptions(box, opts, 'sug', m, function () { changed = true; dlg.close(); });
      }).catch(function (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
    };

    sel.addEventListener('change', function () {
      var cid = sel.value;
      showMsg(msg, '');
      var note = $('#asgDetected', dlg);
      if (note) note.remove();
      if (String(cid || '') === String(m.client_id || '')) return;
      var prev = m.client_id;
      api('PUT', '/api/bank/movements/' + encodeURIComponent(m.id), { client_id: cid ? +cid : null })
        .then(function () { m.client_id = cid ? +cid : null; changed = true; loadSug(); loadDocs(cid); })
        .catch(function (e) { sel.value = prev || ''; showMsg(msg, e.message); });
    });

    $('#asgIgnoreAll', dlg).addEventListener('click', function () {
      if (!confirm('¿Ignorar TODOS los abonos por asignar con la glosa "' + (m.descripcion || '') + '"?\n\nÚsalo para movimientos que no son pagos de clientes (traspasos propios, sobregiro, devoluciones). Puedes volver a considerarlos uno por uno.')) return;
      api('POST', '/api/bank/movements/ignore', { descripcion: m.descripcion || '' })
        .then(function (r) { changed = true; toast(entero(r && r.ignorados) + ' movimiento(s) ignorado(s).', 'ok'); dlg.close(); })
        .catch(function (e) { showMsg(msg, e.message); });
    });
    $('#asgIgnore', dlg).addEventListener('click', function () {
      api('PUT', '/api/bank/movements/' + encodeURIComponent(m.id), { ignored: 1 })
        .then(function () { changed = true; toast('Movimiento ignorado.', 'ok'); dlg.close(); })
        .catch(function (e) { showMsg(msg, e.message); });
    });

    $('#asgSave', dlg).addEventListener('click', function () {
      var items = [];
      $$('input[data-doc-chk]', dlg).forEach(function (c) {
        if (!c.checked) return;
        var id = c.getAttribute('data-doc-chk');
        var amt = parseCLP($('input[data-doc-amt="' + id + '"]', dlg).value) || 0;
        if (amt > 0) items.push({ document_id: id, amount: amt });
      });
      if (!items.length) { showMsg(msg, 'Marca al menos una factura con monto mayor a cero.'); return; }
      var btn = $('#asgSave', dlg);
      busy(btn, true, 'Asignando…');
      postAllocations(m.id, items).then(function () {
        changed = true; toast('Pago asignado a ' + items.length + ' documento(s).', 'ok'); dlg.close();
      }).catch(function (e) { busy(btn, false); showMsg(msg, e.message); });
    });

    loadSug(true);
    if (m.client_id) loadDocs(m.client_id);
    updateSum();
  }

  /* ======================================================================
   * 7. IVA
   * ==================================================================== */
  var IVA_FIELDS = [
    ['debito_facturas', 'IVA de facturas emitidas'],
    ['debito_nd', 'IVA de notas de débito'],
    ['debito_nc', 'IVA de notas de crédito (se resta)'],
    ['debito_total', 'Débito total (lo que se debe al SII)'],
    ['credito', 'Crédito (IVA de tus compras)'],
    ['postergado', 'IVA postergado'],
    ['impuesto_pagar', 'Impuesto a pagar']
  ];
  var ACCIONES = { descuento_f29: 'Descontar en el F29', f2117: 'Pedir devolución (F2117)' };
  var ACC_ESTADOS = [['pendiente', 'Pendiente'], ['presentado', 'Presentado'], ['aprobado', 'Aprobado'], ['rechazado', 'Rechazado'], ['aplicado', 'Aplicado / listo']];

  /* Valores calculados desde los documentos: objeto anidado o campos "calc_*". */
  function ivaCalc(p) {
    var o = p.calculado || p.calc || p.calculated || p.desde_documentos;
    if (o && typeof o === 'object') return o;
    var out = null;
    Object.keys(p || {}).forEach(function (k) {
      if (k.indexOf('calc_') === 0) { out = out || {}; out[k.slice(5)] = p[k]; }
    });
    return out;
  }
  var IVA_ESTADO_PAGO = {
    pagado: ['Pagado', 'ok'], pagado_sin_fecha: ['Pagado (falta la fecha)', 'warn'], postergado: ['Postergado', 'info'], declarado: ['Declarado, sin pago', 'warn'],
    pendiente: ['Por declarar', 'warn'], sin_declarar: ['Sin declarar', 'muted']
  };

  function viewIva(ctx) {
    return Promise.all([
      api('GET', '/api/iva'),
      api('GET', '/api/iva/pendientes').catch(function (e) { if (e.status === 401) throw e; return { _error: e }; }),
      api('GET', '/api/documents' + qs({ estado: 'reclamada_sin_nc' })).catch(function (e) { if (e.status === 401) throw e; return []; }),
      getClients().catch(function () { return []; })
    ]).then(function (res) {
      if (ctx.stale()) return;
      var periodos = list(res[0], 'periodos', 'periods').slice().sort(function (a, b) { return String(b.periodo || '').localeCompare(String(a.periodo || '')); });
      var acciones = res[1] && res[1]._error ? null : list(res[1], 'acciones', 'pendientes', 'actions');
      var reclamadas = list(res[2], 'documents', 'documentos');
      var mesActual = monthISO(0);

      var html = pageHead('IVA', 'Seguimiento mensual del IVA: lo declarado en el F29, lo que se pagó y el IVA de facturas reclamadas que puedes recuperar.',
        '<button type="button" class="btn" id="addPerBtn">Agregar mes</button>');

      // Reclamadas sin NC: IVA en riesgo
      var riesgo = reclamadas.reduce(function (s, d) { return s + num(d.iva_en_riesgo !== undefined ? d.iva_en_riesgo : d.iva); }, 0);
      html += '<section class="card" aria-labelledby="rkTitle"><div class="card-head"><h2 id="rkTitle">IVA en riesgo: facturas reclamadas sin nota de crédito</h2><strong>' + esc(clp(riesgo)) + '</strong></div>' +
        '<p class="help">Cuando un cliente reclama una factura, igual pagaste su IVA. Para recuperarlo hay que emitir una nota de crédito (NC). Si la NC se emite a más tardar el mes siguiente al de la factura, se descuenta directo en el F29; si no, hay que pedir la devolución con el formulario 2117.</p>' +
        '<div class="table-wrap"><table><thead><tr><th scope="col">Cliente</th><th scope="col">Factura</th><th scope="col">Fecha</th><th scope="col" class="num">Total</th><th scope="col" class="num">IVA</th><th scope="col">Plazo para descontar en F29</th></tr></thead><tbody>';
      if (!reclamadas.length) html += emptyRow(6, 'No hay facturas reclamadas pendientes de NC.');
      reclamadas.forEach(function (d) {
        var per = d.periodo || String(d.fecha || '').slice(0, 7);
        var limite = addMonths(per, 1);
        var plazo;
        if (!limite) plazo = '—';
        else if (limite === mesActual) plazo = '<span class="chip bad">¡Este mes es el último! (' + esc(fmes(limite)) + ')</span>';
        else if (limite < mesActual) plazo = '<span class="chip muted">Vencido: usar F2117</span>';
        else plazo = '<span class="chip warn">Hasta ' + esc(fmes(limite)) + '</span>';
        html += '<tr><td>' + (d.client_id ? '<a href="#/cliente/' + esc(d.client_id) + '?doc=' + esc(d.id) + '">' + esc(d.client_short || d.client_name || clientName(d.client_id)) + '</a>' : '—') + '</td>' +
          '<td class="nowrap">' + esc(docLabel(d)) + '</td><td class="nowrap">' + esc(fdate(d.fecha)) + '</td><td class="num">' + esc(clp(d.total)) + '</td><td class="num"><strong>' + esc(clp(d.iva)) + '</strong></td><td>' + plazo + '</td></tr>';
      });
      html += '</tbody></table></div></section>';

      // Acciones pendientes
      var nAplic = (acciones || []).filter(function (a) { return a.estado === 'aplicado'; }).length;
      html += '<section class="card" aria-labelledby="acTitle"><div class="card-head"><h2 id="acTitle">Trámites de IVA por notas de crédito</h2>' +
        (nAplic ? '<div class="fld check"><input type="checkbox" id="hideApl" checked><label for="hideApl">Ocultar los ya aplicados (' + esc(nAplic) + ')</label></div>' : '') + '</div>' +
        '<p class="help">Cada nota de crédito de una factura reclamada genera un trámite: descontar el IVA en el F29 o pedir la devolución (F2117). Actualiza el estado cuando avances.</p>';
      if (acciones === null) html += errorHtml(res[1]._error);
      else {
        html += '<div class="table-wrap"><table><thead><tr><th scope="col">Cliente</th><th scope="col">Documento</th><th scope="col" class="num">IVA</th><th scope="col">Qué hacer</th>' +
          '<th scope="col">Mes origen</th><th scope="col">Mes en que se aplica</th><th scope="col">Estado</th><th scope="col">Notas</th><th scope="col"><span class="sr-only">Guardar</span></th></tr></thead><tbody>';
        if (!acciones.length) html += emptyRow(9, 'No hay trámites de IVA registrados.');
        acciones.forEach(function (a) {
          var doc = a.factura || a.document || a.documento || {};
          if (!a.nc_folio && a.nc && a.nc.folio !== undefined) a.nc_folio = a.nc.folio;
          var folio = a.folio !== undefined ? a.folio : (a.document_folio !== undefined ? a.document_folio : doc.folio);
          var tipo = a.tipo !== undefined ? a.tipo : (doc.tipo !== undefined ? doc.tipo : 33);
          var cid = a.client_id !== undefined ? a.client_id : doc.client_id;
          var cname = (cid !== undefined && cid !== null ? clientName(cid) : "") || a.client_name || a.cliente || doc.client_name;
          var sid = uid('ae'), nid = uid('an');
          html += '<tr' + (a.estado === 'aplicado' ? ' class="row-aplicado hidden"' : '') + '><td>' + esc(cname || '—') + '</td><td class="nowrap">' + (folio !== undefined ? esc((TIPO_CORTO[+tipo] || '') + ' ' + folio) : '#' + esc(a.document_id)) +
            (a.nc_folio ? '<span class="sub">NC ' + esc(a.nc_folio) + '</span>' : '') + '</td>' +
            '<td class="num">' + esc(clp(a.iva)) + '</td><td>' + esc(ACCIONES[a.accion] || a.accion || '') + '</td>' +
            '<td class="nowrap">' + esc(fmes(a.periodo_origen)) + '</td><td class="nowrap">' + esc(fmes(a.periodo_aplica)) + '</td>' +
            '<td><label class="sr-only" for="' + sid + '">Estado</label><select id="' + sid + '" data-act-estado="' + esc(a.id) + '">' +
            ACC_ESTADOS.map(function (e) { return '<option value="' + e[0] + '"' + (e[0] === a.estado ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select></td>' +
            '<td><label class="sr-only" for="' + nid + '">Notas</label><input type="text" id="' + nid + '" data-act-notes="' + esc(a.id) + '" value="' + esc(a.notes || '') + '"></td>' +
            '<td class="actions"><button type="button" class="btn small" data-act-save="' + esc(a.id) + '">Guardar</button></td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</section>';

      // Períodos
      html += '<section class="card" aria-labelledby="pdTitle"><h2 id="pdTitle">Meses (F29)</h2>' +
        '<p class="help">Débito = IVA de tus ventas. Crédito = IVA de tus compras. El F29 se paga hasta el día 20 del mes siguiente. Usa <strong>Editar</strong> para anotar lo que declaraste y pagaste.</p>' +
        '<div class="table-wrap"><table class="tbl-opt"><thead><tr><th scope="col">Mes</th><th scope="col" class="num">Débito facturas</th><th scope="col" class="num opt">NC (resta)</th><th scope="col" class="num opt">ND</th>' +
        '<th scope="col" class="num">Débito total</th><th scope="col" class="num opt">Crédito</th><th scope="col" class="num opt">Postergado</th><th scope="col" class="num">A pagar</th>' +
        '<th scope="col" class="num">Pagado</th><th scope="col">Fecha pago</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Editar</span></th></tr></thead><tbody>';
      if (!periodos.length) html += emptyRow(12, 'Sin meses registrados. Se llenan al importar documentos o con "Agregar mes".');
      periodos.forEach(function (p) {
        var calc = ivaCalc(p);
        var aPagar = isNum(p.impuesto_pagar) ? num(p.impuesto_pagar) : null;
        var st;
        if (p.estado_pago && IVA_ESTADO_PAGO[p.estado_pago]) {
          var ep = IVA_ESTADO_PAGO[p.estado_pago];
          st = '<span class="chip ' + ep[1] + '">' + esc(ep[0]) + '</span>';
          if (p.estado_pago === 'pagado' && aPagar !== null && isNum(p.pagado_monto) && num(p.pagado_monto) < aPagar) st = '<span class="chip warn">Pagado en parte</span>';
        } else if (p.pagado_fecha || num(p.pagado_monto) > 0) st = (aPagar !== null && num(p.pagado_monto) < aPagar) ? '<span class="chip warn">Pagado en parte</span>' : '<span class="chip ok">Pagado</span>';
        else if (num(p.postergado) > 0) st = '<span class="chip info">Postergado</span>';
        else if (p.f29_folio) st = '<span class="chip warn">Declarado, sin pago</span>';
        else st = '<span class="chip muted">Sin declarar</span>';
        var diff = '';
        var hasDiff = isNum(p.diferencia) ? num(p.diferencia) !== 0 :
          (calc && isNum(calc.debito_total) && isNum(p.debito_total) && num(calc.debito_total) !== num(p.debito_total));
        if (hasDiff && calc && isNum(calc.debito_total)) {
          diff = '<span class="sub" title="Lo declarado no coincide con los documentos cargados"><span class="chip warn">Distinto</span> Según documentos: ' + esc(clp(calc.debito_total)) + '</span>';
        }
        var calcOnly = p.declarado === false;
        var cell = function (k) {
          var v = p[k];
          var sign = k === 'debito_nc' ? -1 : 1;  // las NC restan
          var show = function (x) { return isNum(x) ? clp(sign * Math.abs(num(x))) : clp(x); };
          if ((!isNum(v) || (calcOnly && k.indexOf('debito') === 0)) && calc && isNum(calc[k])) return '<span class="muted" title="Calculado desde los documentos (aún no declarado)">' + esc(show(calc[k])) + '</span>';
          return esc(show(v));
        };
        html += '<tr><td class="nowrap"><strong>' + esc(fmes(p.periodo)) + '</strong>' + (p.f29_folio ? '<span class="sub">F29 ' + esc(p.f29_folio) + '</span>' : '') + '</td>' +
          '<td class="num">' + cell('debito_facturas') + '</td><td class="num opt">' + cell('debito_nc') + '</td><td class="num opt">' + cell('debito_nd') + '</td>' +
          '<td class="num">' + cell('debito_total') + diff + '</td><td class="num opt">' + cell('credito') + '</td><td class="num opt">' + cell('postergado') + '</td>' +
          '<td class="num">' + cell('impuesto_pagar') + (p.giro_vence ? '<span class="sub">Vence ' + esc(fdate(p.giro_vence)) + '</span>' : '') + '</td>' +
          '<td class="num">' + esc(clp(p.pagado_monto)) + '</td><td class="nowrap">' + esc(fdate(p.pagado_fecha)) + '</td><td>' + st + '</td>' +
          '<td class="actions"><button type="button" class="btn small secondary" data-per="' + esc(p.periodo) + '">Editar</button></td></tr>';
      });
      html += '</tbody></table></div></section>';
      viewEl.innerHTML = html;

      $$('[data-per]', viewEl).forEach(function (b) {
        b.addEventListener('click', function () {
          var per = b.getAttribute('data-per');
          openIvaDialog(periodos.filter(function (x) { return x.periodo === per; })[0]);
        });
      });
      $('#addPerBtn').addEventListener('click', function () { openIvaDialog(null); });
      var hideApl = $('#hideApl');
      if (hideApl) hideApl.addEventListener('change', function () {
        $$('tr.row-aplicado', viewEl).forEach(function (tr) { tr.classList.toggle('hidden', hideApl.checked); });
      });
      $$('[data-act-save]', viewEl).forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-act-save');
          busy(b, true);
          api('PUT', '/api/iva/actions/' + encodeURIComponent(id), {
            estado: $('[data-act-estado="' + id + '"]', viewEl).value,
            notes: $('[data-act-notes="' + id + '"]', viewEl).value.trim() || null
          }).then(function () { busy(b, false); toast('Trámite actualizado.', 'ok'); })
            .catch(function (e) { busy(b, false); toastErr(e); });
        });
      });
    });
  }

  function openIvaDialog(p) {
    var isNew = !p;
    p = p || {};
    var calc = ivaCalc(p) || {};
    var body = '<form id="ivaForm" novalidate><div class="form-grid">' +
      (isNew ? fld({ label: 'Mes', name: 'periodo', type: 'month', value: monthISO(-1), required: true }) : '') +
      IVA_FIELDS.map(function (f) {
        // Si el mes no está declarado, el servidor rellena el débito con lo calculado: no lo proponemos como declarado.
        var val = p.declarado === false && f[0].indexOf('debito') === 0 ? '' : p[f[0]];
        return fld({ label: f[1], name: f[0], type: 'money', value: val, help: isNum(calc[f[0]]) ? 'Según documentos: ' + clp(calc[f[0]]) : '' });
      }).join('') +
      fld({ label: 'Folio del F29', name: 'f29_folio', value: p.f29_folio }) +
      fld({ label: 'Fecha de presentación F29', name: 'f29_fecha', type: 'date', value: p.f29_fecha }) +
      fld({ label: 'Vencimiento del giro', name: 'giro_vence', type: 'date', value: p.giro_vence, help: 'Si postergaste el IVA, hasta cuándo hay plazo para pagarlo.' }) +
      fld({ label: 'Fecha en que pagaste', name: 'pagado_fecha', type: 'date', value: p.pagado_fecha }) +
      fld({ label: 'Monto pagado', name: 'pagado_monto', type: 'money', value: p.pagado_monto }) +
      fld({ label: 'Notas', name: 'notes', type: 'textarea', value: p.notes, full: true }) +
      '</div><div id="ivaMsg"></div><div class="form-actions"><button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>';
    var saved = false;
    var dlg = openDialog(isNew ? 'Agregar mes de IVA' : 'IVA de ' + fmesLargo(p.periodo), body, { wide: true, onClose: function () { if (saved) render(); } });
    var form = $('#ivaForm', dlg), msg = $('#ivaMsg', dlg);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = readForm(form);
      var per = isNew ? f.periodo : p.periodo;
      if (!/^\d{4}-\d{2}$/.test(per || '')) { showMsg(msg, 'Elige el mes.'); return; }
      var payload = {};
      IVA_FIELDS.forEach(function (x) { payload[x[0]] = f[x[0]]; });
      ['f29_folio', 'f29_fecha', 'giro_vence', 'pagado_fecha', 'notes'].forEach(function (k) { payload[k] = f[k] || null; });
      payload.pagado_monto = f.pagado_monto;
      if (num(payload.pagado_monto) > 0 && !payload.pagado_fecha &&
          !confirm('Escribiste un monto pagado sin la fecha de pago. ¿Guardar igual? (El mes quedará como "Pagado, falta la fecha").')) return;
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'Guardando…');
      api('PUT', '/api/iva/' + encodeURIComponent(per), payload)
        .then(function () { saved = true; toast('IVA de ' + fmesLargo(per) + ' guardado.', 'ok'); dlg.close(); })
        .catch(function (e) { busy(btn, false); showMsg(msg, e.message); });
    });
  }

  /* ======================================================================
   * 8. Ajustes
   * ==================================================================== */
  function secretField(label, name, value, help) {
    var set = value === '***' || (value && value !== '');
    var id = uid('f');
    return '<div class="fld"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="password" id="' + id + '" name="' + esc(name) + '" value="" autocomplete="new-password" data-secret' +
      (set ? ' placeholder="•••••• (guardada; escribe para cambiarla)"' : '') + '>' +
      (help ? '<small>' + esc(help) + '</small>' : '') +
      (set ? '<label class="inline-check"><input type="checkbox" data-clear-secret="' + esc(name) + '"> Quitar la clave guardada</label>' : '') + '</div>';
  }

  function settingsStatus(s) {
    var parts = [];
    if (s.smtp_configurado !== undefined) parts.push(s.smtp_configurado ? '<span class="chip ok">Envío de correo configurado</span>' : '<span class="chip warn">Envío de correo sin configurar</span>');
    if (s.imap_configurado !== undefined) parts.push(s.imap_configurado ? '<span class="chip ok">Lectura de correo configurada</span>' : '<span class="chip warn">Lectura de correo sin configurar</span>');
    var lp = s.email_last_poll;
    var last = '';
    if (lp && typeof lp === 'object') {
      var errs = jsonList(lp.errors);
      last = '<p class="small muted">Última revisión del correo: ' + esc(fdatetime(lp.fecha)) +
        (isNum(lp.revisados) ? ' · ' + esc(entero(lp.revisados)) + ' correo(s) revisado(s)' : '') +
        (isNum(lp.movimientos_nuevos) ? ' · ' + esc(entero(lp.movimientos_nuevos)) + ' movimiento(s) nuevo(s)' : '') +
        (errs.length ? ' · <span class="chip bad">Error</span> ' + esc(errs.join(' · ')) : '') + '</p>';
    }
    if (s.admin_email) last += '<p class="small muted">Los correos de prueba se envían a ' + esc(s.admin_email) + '.</p>';
    return (parts.length ? '<p class="tag-list">' + parts.join('') + '</p>' : '') + last;
  }

  function viewSettings(ctx) {
    return Promise.all([api('GET', '/api/settings'), api('GET', '/api/auth/me').catch(function (e) { if (e.status === 401) throw e; return {}; })]).then(function (res) {
      if (ctx.stale()) return;
      var r = res[0], me = res[1] || {};
      var s = (r && (r.settings || r.ajustes)) || r || {};
      var u = currentUser() || {};
      if (me.email) u.email = me.email;
      var html = pageHead('Ajustes', 'Correo, cartolas, tu clave, importación de datos, respaldo y registro de cambios.');

      html += '<section class="card" aria-labelledby="mailTitle"><h2 id="mailTitle">Correo</h2>' +
        '<p class="help">Para Yahoo debes usar una <strong>clave de aplicación</strong> (no tu clave normal): en Yahoo ve a Seguridad de la cuenta → Generar clave de aplicación. ' +
        'El envío (SMTP) se usa para mandarte el enlace de recuperar clave. La lectura (IMAP) se usa para cargar solas las cartolas del BCI que lleguen a tu correo. El sistema nunca borra ni marca tus correos.</p>' +
        settingsStatus(s) +
        '<form id="mailForm" novalidate><h3>Envío de correos (SMTP)</h3><div class="form-grid">' +
        fld({ label: 'Servidor SMTP', name: 'smtp_host', value: s.smtp_host, placeholder: 'smtp.mail.yahoo.com' }) +
        fld({ label: 'Puerto SMTP', name: 'smtp_port', type: 'number', value: s.smtp_port, placeholder: '465' }) +
        fld({ label: 'Usuario SMTP (tu correo)', name: 'smtp_user', value: s.smtp_user, attrs: 'autocomplete="off"' }) +
        secretField('Clave de aplicación SMTP', 'smtp_pass', s.smtp_pass) +
        fld({ label: 'Remitente', name: 'smtp_from', value: s.smtp_from, placeholder: 'Igual al usuario' }) +
        '</div><h3>Lectura de cartolas desde el correo (IMAP)</h3><div class="form-grid">' +
        fld({ label: 'Servidor IMAP', name: 'imap_host', value: s.imap_host, placeholder: 'imap.mail.yahoo.com' }) +
        fld({ label: 'Puerto IMAP', name: 'imap_port', type: 'number', value: s.imap_port, placeholder: '993' }) +
        fld({ label: 'Usuario IMAP (tu correo)', name: 'imap_user', value: s.imap_user, attrs: 'autocomplete="off"' }) +
        secretField('Clave de aplicación IMAP', 'imap_pass', s.imap_pass) +
        fld({ label: 'Revisar cada (minutos)', name: 'imap_interval_min', type: 'number', value: s.imap_interval_min, placeholder: '30', attrs: 'min="5" step="1"' }) +
        (s.imap_days !== undefined ? fld({ label: 'Buscar correos de los últimos (días)', name: 'imap_days', type: 'number', value: s.imap_days, placeholder: '60', attrs: 'min="1" step="1"' }) : '') +
        (s.imap_folder !== undefined ? fld({ label: 'Carpeta del correo', name: 'imap_folder', value: s.imap_folder, placeholder: 'INBOX' }) : '') +
        (s.imap_enabled !== undefined ? fld({ label: 'Revisar el correo automáticamente', name: 'imap_enabled', type: 'checkbox', value: s.imap_enabled }) : '') +
        (s.imap_remitentes !== undefined ? fld({ label: 'Dominios de remitente aceptados', name: 'imap_remitentes', value: s.imap_remitentes, placeholder: 'bci.cl',
          help: 'Solo se cargan cartolas que vengan de estos dominios (separados por coma).' }) : '') +
        (s.imap_require_auth !== undefined ? fld({ label: 'Exigir remitente verificado (firma DKIM/DMARC)', name: 'imap_require_auth', type: 'checkbox', value: s.imap_require_auth,
          help: 'Recomendado. Evita que alguien te mande una cartola falsa escribiendo "BCI" en el remitente.' }) : '') +
        '</div><h3>Cartolas</h3><div class="form-grid">' +
        secretField('Clave de los PDF del banco', 'pdf_password', s.pdf_password, 'Si el BCI te manda las cartolas en PDF con clave (por ejemplo, parte de tu RUT).') +
        (s.auto_match_on_import !== undefined ? fld({ label: 'Conciliar automáticamente al subir cartolas', name: 'auto_match_on_import', type: 'checkbox', value: s.auto_match_on_import }) : '') +
        '</div><div id="mailMsg"></div>' +
        '<p class="help">El correo de prueba y la revisión del correo usan los ajustes <strong>guardados</strong>: guarda antes de probar. Si cambias el servidor o el usuario, vuelve a escribir la clave de aplicación.</p>' +
        '<div class="form-actions">' +
        '<button type="button" class="btn secondary" id="testMailBtn">Enviar correo de prueba</button>' +
        '<button type="button" class="btn secondary" id="pollBtn2">Revisar correo ahora</button>' +
        '<button type="submit" class="btn">Guardar ajustes</button></div><div id="mailResult" aria-live="polite"></div></form></section>';

      html += '<section class="card" aria-labelledby="pwTitle"><h2 id="pwTitle">Mi clave</h2>' +
        '<p class="help">Usuario: <strong>' + esc(u.username || '—') + '</strong>' + (u.email ? ' · Correo de recuperación: ' + esc(u.email) : '') + '</p>' +
        changePasswordForm(false) + '</section>';

      html += '<section class="card" aria-labelledby="mfaTitle"><h2 id="mfaTitle">Doble validación y correo de recuperación</h2>' +
        '<p>' + (me.mfa_enabled ? '<span class="chip ok">Doble validación activa</span>' : '<span class="chip bad">Doble validación sin activar</span>') +
        (isNum(me.recovery_codes_left) ? ' <span class="muted small">Códigos de recuperación disponibles: ' + esc(entero(me.recovery_codes_left)) + '</span>' : '') + '</p>' +
        '<div class="split"><form id="rcForm" novalidate><h3>Códigos de recuperación nuevos</h3>' +
        '<p class="help">Si usaste o perdiste tus códigos, genera 10 nuevos (los anteriores dejan de servir).</p>' +
        fld({ label: 'Código actual de la app autenticadora', name: 'code', attrs: 'autocomplete="one-time-code" inputmode="numeric" maxlength="7"' }) +
        '<div class="form-actions"><button type="submit" class="btn secondary">Generar códigos nuevos</button></div><div id="rcMsg" aria-live="polite"></div></form>' +
        '<form id="emForm" novalidate><h3>Cambiar correo de recuperación</h3>' +
        '<p class="help">A este correo llega el enlace de "¿Olvidaste tu clave?". Se avisará del cambio al correo anterior.</p>' +
        fld({ label: 'Correo nuevo', name: 'email', type: 'email', value: u.email || '', attrs: 'autocomplete="email"' }) +
        fld({ label: 'Tu clave actual', name: 'current_password', type: 'password', attrs: 'autocomplete="current-password"' }) +
        fld({ label: 'Código actual de la app autenticadora', name: 'code', attrs: 'autocomplete="one-time-code" inputmode="numeric" maxlength="7"' }) +
        '<div class="form-actions"><button type="submit" class="btn secondary">Cambiar correo</button></div><div id="emMsg" aria-live="polite"></div></form></div></section>';

      html += '<section class="card" aria-labelledby="impTitle"><h2 id="impTitle">Importar datos</h2><div class="split">' +
        '<form id="rcvForm" novalidate><h3>Registro de Ventas del SII (CSV)</h3>' +
        '<p class="help">En el SII: Servicios online → Factura electrónica → Registro de Compras y Ventas → Ventas → Descargar detalles. Sube ese archivo CSV. Los clientes nuevos se crean solos.</p>' +
        fld({ label: 'Archivo CSV del RCV', name: 'file', type: 'file', attrs: 'accept=".csv,.txt,text/csv"' }) +
        '<div class="form-actions"><button type="submit" class="btn">Importar RCV</button></div><div id="rcvMsg" aria-live="polite"></div></form>' +
        '<form id="jsonForm" novalidate><h3>Archivo JSON (respaldo o carga masiva)</h3>' +
        '<p class="help">Sirve para restaurar un respaldo o cargar clientes, documentos, movimientos, IVA y asignaciones preparados. Lo que ya existe se actualiza, no se duplica.</p>' +
        fld({ label: 'Archivo JSON', name: 'file', type: 'file', attrs: 'accept=".json,application/json"' }) +
        '<div class="form-actions"><button type="submit" class="btn">Importar JSON</button></div><div id="jsonMsg" aria-live="polite"></div></form>' +
        '</div></section>';

      html += '<section class="card" aria-labelledby="expTitle"><h2 id="expTitle">Respaldo</h2>' +
        '<p class="help">Descarga una copia completa de todos los datos en un archivo. Guárdala en un lugar seguro.</p>' +
        '<button type="button" class="btn secondary" id="exportBtn">Descargar respaldo</button></section>';

      html += '<details class="card" id="auditBox"><summary>Registro de cambios (auditoría)</summary><p class="help">Los últimos 200 cambios: quién hizo qué y cuándo.</p><div id="auditList"></div></details>';
      viewEl.innerHTML = html;

      // Guardar ajustes
      var mailForm = $('#mailForm'), mailMsg = $('#mailMsg');
      mailForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = readForm(mailForm);
        var payload = {};
        Object.keys(f).forEach(function (k) {
          var el = $('[name=' + k + ']', mailForm);
          if (el && el.hasAttribute('data-secret')) { if (f[k] !== '') payload[k] = el.value; }
          else payload[k] = f[k];
        });
        // Campo vacío = volver al valor por defecto del servidor.
        Object.keys(payload).forEach(function (k) { if (payload[k] === '') payload[k] = null; });
        $$('[data-clear-secret]', mailForm).forEach(function (c) {
          if (c.checked && !payload[c.getAttribute('data-clear-secret')]) payload[c.getAttribute('data-clear-secret')] = null;
        });
        var btn = $('button[type=submit]', mailForm);
        busy(btn, true, 'Guardando…');
        api('PUT', '/api/settings', payload).then(function (s2) {
          busy(btn, false);
          s2 = s2 || {};
          $$('[data-secret]', mailForm).forEach(function (el) {
            el.value = '';
            el.placeholder = s2[el.name] ? '•••••• (guardada; escribe para cambiarla)' : '';
          });
          $$('[data-clear-secret]', mailForm).forEach(function (c) {
            if (!s2[c.getAttribute('data-clear-secret')]) c.closest('label').remove(); else c.checked = false;
          });
          var lost = ['smtp_pass', 'imap_pass'].filter(function (k) { return s[k] && !s2[k] && payload[k] !== null; });
          s = s2;
          showMsg(mailMsg, lost.length ? 'Ajustes guardados. Como cambiaste el servidor o el usuario, la clave de aplicación guardada se borró: escríbela de nuevo.' : 'Ajustes guardados.', !lost.length);
        }).catch(function (e) { busy(btn, false); showMsg(mailMsg, e.message); });
      });
      $('#testMailBtn').addEventListener('click', function () {
        var b = $('#testMailBtn');
        busy(b, true, 'Enviando…');
        api('POST', '/api/settings/test-email').then(function (r) {
          busy(b, false);
          showMsg(mailMsg, (r && (r.message || r.detail)) || ('Correo de prueba enviado' + (r && r.to ? ' a ' + r.to : '') + '. Revisa tu bandeja de entrada.'), true);
        }).catch(function (e) { busy(b, false); showMsg(mailMsg, /^no se pudo/i.test(e.message) ? e.message : 'No se pudo enviar: ' + e.message); });
      });
      $('#pollBtn2').addEventListener('click', function () {
        var b = $('#pollBtn2');
        busy(b, true, 'Revisando…');
        api('POST', '/api/email/poll').then(function (r) {
          busy(b, false);
          $('#mailResult').innerHTML = '<h3>Resultado de la revisión</h3>' + resultHtml(r);
        }).catch(function (e) { busy(b, false); showMsg(mailMsg, e.message); });
      });

      bindChangePassword(viewEl, false);

      // Códigos de recuperación nuevos
      $('#rcForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = this, box = $('#rcMsg');
        var code = $('[name=code]', f).value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) { showMsg(box, 'Escribe los 6 dígitos de la app autenticadora.'); return; }
        var btn = $('button[type=submit]', f);
        busy(btn, true, 'Generando…');
        api('POST', '/api/auth/mfa/recovery-codes', { code: code }).then(function (r) {
          busy(btn, false); f.reset();
          var codes = (r && r.recovery_codes) || [];
          box.innerHTML = '<div class="form-ok" role="status">Códigos nuevos generados. Guárdalos: no se volverán a mostrar.</div>' + recoveryCodesHtml(codes) +
            '<button type="button" class="btn secondary small" id="dlCodes2">Descargar códigos</button>';
          $('#dlCodes2').addEventListener('click', function () { downloadCodes(codes); });
        }).catch(function (e) { busy(btn, false); showMsg(box, e.message); });
      });
      // Correo de recuperación
      $('#emForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = this, box = $('#emMsg'), d = readForm(f);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { showMsg(box, 'Escribe un correo válido.'); return; }
        if (!$('[name=current_password]', f).value) { showMsg(box, 'Escribe tu clave actual.'); return; }
        if (!/^\d{6}$/.test(String(d.code || '').replace(/\s/g, ''))) { showMsg(box, 'Escribe los 6 dígitos de la app autenticadora.'); return; }
        var btn = $('button[type=submit]', f);
        busy(btn, true, 'Guardando…');
        api('PUT', '/api/auth/me', { email: d.email, current_password: $('[name=current_password]', f).value, code: d.code.replace(/\s/g, '') }).then(function (r) {
          busy(btn, false);
          var cu = currentUser() || {};
          cu.email = (r && r.email) || d.email;
          ss('set', USER_KEY, JSON.stringify(cu));
          $('[name=current_password]', f).value = ''; $('[name=code]', f).value = '';
          showMsg(box, 'Correo de recuperación cambiado a ' + cu.email + '.', true);
        }).catch(function (e) { busy(btn, false); showMsg(box, e.message); });
      });

      // Importaciones
      var bindImport = function (formId, path, msgId) {
        var form = $(formId), box = $(msgId);
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var inp = $('input[type=file]', form);
          if (!inp.files || !inp.files.length) { box.innerHTML = '<div class="form-error" role="alert">Elige un archivo primero.</div>'; return; }
          var fd = new FormData();
          fd.append('file', inp.files[0], inp.files[0].name);
          var btn = $('button[type=submit]', form);
          busy(btn, true, 'Importando…');
          box.innerHTML = loadingHtml('Importando…');
          api('POST', path, fd).then(function (r) {
            busy(btn, false); inp.value = '';
            cache.clients = null;
            box.innerHTML = '<div class="form-ok" role="status">Importación terminada.</div>' + resultHtml(r);
          }).catch(function (e) { busy(btn, false); box.innerHTML = errorHtml(e); });
        });
      };
      bindImport('#rcvForm', '/api/import/rcv', '#rcvMsg');
      bindImport('#jsonForm', '/api/import/json', '#jsonMsg');

      // Respaldo
      $('#exportBtn').addEventListener('click', function () {
        var b = $('#exportBtn');
        busy(b, true, 'Preparando…');
        api('GET', '/api/export', undefined, { blob: true }).then(function (blob) {
          busy(b, false);
          downloadBlob(blob, 'tx-respaldo-' + todayISO() + '.json');
        }).catch(function (e) { busy(b, false); toastErr(e); });
      });

      // Auditoría (se carga al abrir)
      var auditLoaded = false;
      $('#auditBox').addEventListener('toggle', function () {
        if (!this.open || auditLoaded) return;
        auditLoaded = true;
        var box = $('#auditList');
        box.innerHTML = loadingHtml();
        api('GET', '/api/audit?limit=200').then(function (r) {
          var rows = list(r, 'audit', 'items');
          box.innerHTML = '<div class="table-wrap"><table><thead><tr><th scope="col">Fecha</th><th scope="col">Usuario</th><th scope="col">Acción</th><th scope="col">Detalle</th></tr></thead><tbody>' +
            (rows.length ? rows.map(function (a) {
              var det = a.detail;
              if (det && typeof det === 'object') det = JSON.stringify(det);
              return '<tr><td class="nowrap">' + esc(fdatetime(a.ts)) + '</td><td>' + esc(a.username || a.user || '') + '</td><td>' + esc(a.action || '') + '</td><td class="desc">' + esc(det || '') + '</td></tr>';
            }).join('') : emptyRow(4, 'Sin registros.')) + '</tbody></table></div>';
        }).catch(function (e) { auditLoaded = false; if (e.status !== 401) box.innerHTML = errorHtml(e); });
      });
    });
  }

  /* ======================================================================
   * Arranque
   * ==================================================================== */
  function init() {
    document.getElementById('menuBtn').addEventListener('click', function () {
      var nav = document.getElementById('mainnav');
      var open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('skipLink').addEventListener('click', function (e) {
      e.preventDefault();
      var h1 = $('h1', viewEl);
      (h1 || document.getElementById('main')).focus();
    });
    window.addEventListener('hashchange', render);

    // Si hay sesión, refrescar datos del usuario (y must_change) antes de mostrar.
    var r = parseHash();
    var isPublic = /^#\/(login|olvide|reset\/)/.test(r.path);
    if (getToken() && !isPublic) {
      api('GET', '/api/auth/me').then(function (me) {
        if (me) {
          var user = me.user || me;
          var mc = me.must_change !== undefined ? me.must_change : user.must_change;
          if (mc !== undefined) ss('set', MC_KEY, mc && mc !== '0' ? '1' : '0');
          if (me.mfa_setup !== undefined) ss('set', MFA_KEY, me.mfa_setup ? '1' : '0');
          if (user && user.username) ss('set', USER_KEY, JSON.stringify({ username: user.username, email: user.email }));
        }
        render();
      }).catch(function (e) { if (e.status !== 401) render(); });
    } else {
      render();
    }
  }

  init();
})();
