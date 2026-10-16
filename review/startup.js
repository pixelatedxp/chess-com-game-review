(() => {
  const report = error => {
    const panel = document.getElementById('import-panel');
    const status = document.getElementById('status');
    if (!panel || !status) return;
    if (document.getElementById('review').hidden) panel.hidden = false;
    status.classList.add('error');
    status.textContent = `Could not start the review: ${error?.message || 'An unexpected error occurred.'} Reload this page after updating the extension.`;
  };
  window.addEventListener('error', event => report(event.error || new Error(event.message)));
  window.addEventListener('unhandledrejection', event => report(event.reason));
})();
