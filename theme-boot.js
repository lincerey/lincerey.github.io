/* eslint-disable */
/**
 * TRUE — Arranque de tema (sin destello).
 *
 * POR QUÉ ES UN ARCHIVO APARTE Y NO UN SCRIPT EN LÍNEA
 * ---------------------------------------------------
 * La Content Security Policy de producción es `script-src 'self'` (sin
 * `unsafe-inline`). Un `<script>` en línea en `index.html` sería bloqueado, y
 * añadir `unsafe-inline` a la CSP para ahorrar una petición de 500 bytes sería
 * un mal negocio de seguridad. Por eso este archivo se sirve como recurso
 * propio y se carga de forma **bloqueante** antes de pintar: es lo único que
 * garantiza que no haya un destello blanco al abrir en tema oscuro.
 *
 * Contrato de almacenamiento: `true.theme.v1` = JSON `"light" | "dark" | "auto"`.
 * El mismo contrato lo usa `src/lib/theme.js`, que es la única otra pieza que
 * escribe este valor.
 */
(function () {
  var STORE_KEY = 'true.theme.v1';

  /** Lee la preferencia guardada. Tolera cualquier valor corrupto. */
  function readPreference() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return 'auto';
      var value = JSON.parse(raw);
      return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
    } catch (error) {
      // Modo privado, cuota agotada o JSON inválido: seguimos con el sistema.
      return 'auto';
    }
  }

  /** Resuelve 'auto' contra la preferencia del sistema operativo. */
  function resolve(preference) {
    if (preference === 'light' || preference === 'dark') return preference;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (error) {
      return 'light';
    }
  }

  /** Aplica el tema al documento y sincroniza el color de la barra del navegador. */
  function apply(theme) {
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0A0F1A' : '#0F172A');
  }

  var preference = readPreference();
  apply(resolve(preference));

  // En modo 'auto', seguir los cambios del sistema sin recargar.
  try {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (readPreference() === 'auto') apply(query.matches ? 'dark' : 'light');
    };
    if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
    else if (typeof query.addListener === 'function') query.addListener(onChange);
  } catch (error) {
    /* Sin matchMedia: el tema queda fijado al valor resuelto. */
  }

  // Se expone para que la app (React) no tenga que recalcular el tema inicial.
  window.__TRUE_THEME__ = resolve(preference);
})();
