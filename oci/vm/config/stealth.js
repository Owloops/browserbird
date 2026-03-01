// Stealth init-script for Playwright MCP.
// Injected via --init-script before any page scripts run.
// Light stealth: hides automation signals without creating detectable
// inconsistencies between main thread and worker contexts.

(function () {
  'use strict';

  var seed = (Date.now() % 1000000) | 0;
  function seededRandom(s) {
    var t = (s + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // --- Automation detection ---

  Object.defineProperty(navigator, 'webdriver', {
    get: function () { return undefined; },
    configurable: true,
  });

  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

  // Remove Playwright globals
  try {
    delete window.__playwright__binding__;
    delete window.__pwInitScripts;
  } catch (e) {}

  // Fake chrome.runtime
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function () {},
      sendMessage: function () {},
      onConnect: { addListener: function () {} },
      onMessage: { addListener: function () {} },
    };
  }

  // --- Navigator properties ---

  var originalQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = function (parameters) {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return originalQuery(parameters);
  };

  Object.defineProperty(navigator, 'languages', {
    get: function () { return ['en-US', 'en']; },
  });

  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt', {
      get: function () { return 100; },
    });
  }

  var cores = [4, 6, 8][Math.floor(seededRandom(seed) * 3)];
  var mem = [4, 8, 16][Math.floor(seededRandom(seed * 2) * 3)];

  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: function () { return cores; },
    configurable: true,
  });

  Object.defineProperty(navigator, 'deviceMemory', {
    get: function () { return mem; },
  });
})();
