(function () {
  const STORAGE_KEY = "cozoroGuestLanguage";
  const SUPPORTED_LANGUAGES = ["en", "vi"];

  const select = document.querySelector("[data-language-select]");
  const status = document.querySelector("[data-language-status]");

  if (!select) return;

  let currentLanguage = localStorage.getItem(STORAGE_KEY) || "en";
  if (!SUPPORTED_LANGUAGES.includes(currentLanguage)) currentLanguage = "en";

  select.value = currentLanguage;

  /**
   * Simple translation function
   * @param {string} key 
   * @param {Object} params 
   * @returns {string}
   */
  window.t = function (key, params = {}) {
    const dict = window.COZORO_TRANSLATIONS && window.COZORO_TRANSLATIONS[currentLanguage];
    if (!dict) return key;

    let text = dict[key] || key;
    
    // Replace parameters {paramName}
    Object.keys(params).forEach(prop => {
      text = text.replace(new RegExp(`{${prop}}`, "g"), params[prop]);
    });

    return text;
  };

  function setStatus(messageKey, params = {}) {
    if (status) {
      status.textContent = window.t(messageKey, params);
    }
  }

  function applyTranslations() {
    // Translate standard elements
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      el.textContent = window.t(key);
    });

    // Translate placeholders
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.placeholder = window.t(key);
    });

    // Update document language
    document.documentElement.lang = currentLanguage;
    
    // Trigger a custom event so other scripts (like script.js) can react
    window.dispatchEvent(new CustomEvent("languageChanged", { detail: { language: currentLanguage } }));
  }

  function changeLanguage(lang) {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    
    currentLanguage = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    select.value = lang;
    
    setStatus("loadingLanguage");
    
    // Use requestAnimationFrame to ensure UI updates smoothly
    requestAnimationFrame(() => {
      applyTranslations();
      setStatus("languageReady");
      // Clear status after a while
      setTimeout(() => { if (status) status.textContent = ""; }, 2000);
    });
  }

  select.addEventListener("change", () => {
    changeLanguage(select.value);
  });

  // Initial apply
  applyTranslations();
})();
