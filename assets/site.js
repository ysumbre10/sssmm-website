/* Shared behaviour for every page. Loaded with defer, so it runs after parse. */
(function () {
  'use strict';

  // Ganesh Utsav 2026. Fixed +05:30 offset so the countdown is identical
  // for a Karyakarta in Pune and a relative viewing from abroad.
  var UTSAV = new Date('2026-09-14T00:00:00+05:30').getTime();

  // Apps Script web app backing the donation lookups. Source: donation-api.gs
  window.WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbymKcKWB-KAnyWupv_jGfMaz-aMt7ACx1qFMN7XtHkbocqHwj0KLzTosO6GslBC2u09/exec';

  /* ---------- language ---------- */
  // The <html lang> attribute is the single switch; style.css hides the other
  // language. Set as early as possible in <head> to avoid a flash — see setLang.
  function applyLang(lang) {
    document.documentElement.lang = lang;
    try { localStorage.setItem('sssmm-lang', lang); } catch (e) { /* private mode */ }
    var btn = document.getElementById('langToggle');
    if (btn) {
      btn.textContent = lang === 'mr' ? 'English' : 'मराठी';
      btn.setAttribute('aria-label', lang === 'mr' ? 'Switch to English' : 'Switch to Marathi');
    }
  }

  var toggle = document.getElementById('langToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      applyLang(document.documentElement.lang === 'mr' ? 'en' : 'mr');
    });
  }
  applyLang(document.documentElement.lang === 'en' ? 'en' : 'mr');

  /* ---------- mobile nav ---------- */
  var menuBtn = document.querySelector('.menu-toggle');
  var navLinks = document.getElementById('navLinks');
  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---------- scroll reveal ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('show'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('show');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- countdown ---------- */
  var timer = document.getElementById('timer');
  if (timer) {
    var out = {
      days: document.getElementById('days'),
      hours: document.getElementById('hours'),
      minutes: document.getElementById('minutes'),
      seconds: document.getElementById('seconds')
    };
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };

    var tick = function () {
      var left = UTSAV - Date.now();
      if (left <= 0) {
        timer.innerHTML = '<p class="timer-done"><span class="mr">गणेशोत्सव सुरू झाला! 🙏🎉</span>'
          + '<span class="en">Ganesh Utsav has begun! 🙏🎉</span></p>';
        clearInterval(iv);
        return;
      }
      var s = Math.floor(left / 1000);
      out.days.textContent = Math.floor(s / 86400);
      out.hours.textContent = pad(Math.floor(s / 3600) % 24);
      out.minutes.textContent = pad(Math.floor(s / 60) % 60);
      out.seconds.textContent = pad(s % 60);
    };
    tick();
    var iv = setInterval(tick, 1000);
  }

  /* ---------- shared API helper ---------- */
  // Every donation lookup goes through here so error handling stays in one place.
  window.apiGet = function (params) {
    var q = Object.keys(params)
      .filter(function (k) { return params[k] !== '' && params[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    return fetch(window.WEBAPP_URL + '?' + q, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) throw new Error(d.error);
        return d;
      });
  };
})();
