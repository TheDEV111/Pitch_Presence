document.getElementById('retry').addEventListener('click', () => {
  if (navigator.onLine === false) {
    document.getElementById('status').textContent =
      'Still offline. Check your connection and try again.';
    return;
  }
  // Reload only on user activation. Never replay an API request or store the current URL.
  window.location.reload();
});
