(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const productionApiBaseUrl = "https://dazzle-the-sisters-boutique.onrender.com";
  const apiBaseUrl = localHosts.has(window.location.hostname)
    ? "http://127.0.0.1:3000"
    : productionApiBaseUrl;

  window.DAZZLE_CONFIG = Object.freeze({ API_BASE_URL: apiBaseUrl });
})();
