/* Inlined in <head> of every page (kept here as the source of truth).
   Sets <html lang> before first paint so the page never flashes the wrong
   language. ?lang=en|mr wins, then the last saved choice, else Marathi. */
(function () {
  var q = /[?&]lang=(en|mr)/.exec(location.search);
  var l = q && q[1];
  if (!l) { try { l = localStorage.getItem('sssmm-lang'); } catch (e) {} }
  document.documentElement.lang = (l === 'en') ? 'en' : 'mr';
})();
