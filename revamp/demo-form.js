/* Mockup login forms don't submit anywhere. External (not inline) so the app's
   strict CSP (script-src 'self') allows it when revamp/ is served by Express. */
document.querySelectorAll('form[data-demo-form]').forEach(function (form) {
  form.addEventListener('submit', function (e) { e.preventDefault(); });
});
