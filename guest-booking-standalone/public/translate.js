(function () {
  const STORAGE_KEY = "cozoroGuestLanguage";
  const SUPPORTED_LANGUAGES = ["en", "vi", "zh-CN", "ja", "ko", "es", "fr", "ru", "ar"];
  const LANGUAGE_LABELS = {
    en: "English",
    vi: "Tieng Viet",
    "zh-CN": "Chinese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    ru: "Russian",
    ar: "Arabic"
  };

  const root = document.querySelector("[data-language-switcher]");
  const select = document.querySelector("[data-language-select]");
  const status = document.querySelector("[data-language-status]");
  const translateMount = document.getElementById("google_translate_element");

  if (!root || !select || !translateMount) {
    return;
  }

  const savedLanguage = normalizeLanguage(localStorage.getItem(STORAGE_KEY) || "en");
  let widgetReady = false;
  let widgetApplied = false;
  let pendingLanguage = savedLanguage;
  let lastAppliedLanguage = "en";

  select.value = pendingLanguage;

  function normalizeLanguage(value) {
    const candidate = String(value || "").trim();
    return SUPPORTED_LANGUAGES.includes(candidate) ? candidate : "en";
  }

  function setStatus(message) {
    if (status) {
      status.textContent = message || "";
    }
  }

  function setGoogleTranslateCookie(language) {
    const normalized = normalizeLanguage(language);
    const cookieValue = normalized === "en" ? "/en/en" : `/en/${normalized}`;
    const cookie = `googtrans=${cookieValue}; path=/; max-age=31536000; SameSite=Lax`;
    document.cookie = cookie;

    if (location.hostname && location.hostname !== "localhost") {
      document.cookie = `${cookie}; domain=.${location.hostname}`;
    }
  }

  function dispatchComboChange(combo, language) {
    combo.value = language;
    combo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function syncDocumentLanguage(language) {
    document.documentElement.lang = normalizeLanguage(language);
  }

  function markApplied(language) {
    const normalized = normalizeLanguage(language);
    lastAppliedLanguage = normalized;
    pendingLanguage = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);
    select.value = normalized;
    syncDocumentLanguage(normalized);
  }

  function applySelectedLanguage(language, options = {}) {
    const normalized = normalizeLanguage(language);
    const combo = document.querySelector(".goog-te-combo");
    const fromUser = Boolean(options.fromUser);

    pendingLanguage = normalized;
    select.value = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);
    setGoogleTranslateCookie(normalized);
    syncDocumentLanguage(normalized);

    if (!combo) {
      widgetApplied = false;
      if (fromUser) {
        setStatus(normalized === "en"
          ? "Language reset to English."
          : `Loading ${LANGUAGE_LABELS[normalized]}...`);
      }
      return false;
    }

    dispatchComboChange(combo, normalized);
    markApplied(normalized);
    widgetApplied = true;
    setStatus(normalized === "en" ? "Showing English." : `Showing ${LANGUAGE_LABELS[normalized]}.`);
    return true;
  }

  function syncFromWidget() {
    const combo = document.querySelector(".goog-te-combo");
    if (!combo || !combo.value) {
      return;
    }

    const normalized = normalizeLanguage(combo.value);
    if (normalized !== combo.value) {
      combo.value = normalized;
    }

    markApplied(normalized);
    widgetApplied = true;
    setStatus(normalized === "en" ? "Showing English." : `Showing ${LANGUAGE_LABELS[normalized]}.`);
  }

  function initGoogleTranslate() {
    if (widgetReady || !window.google || !window.google.translate || !window.google.translate.TranslateElement) {
      return;
    }

    widgetReady = true;
    // eslint-disable-next-line no-new
    new window.google.translate.TranslateElement(
      {
        pageLanguage: "en",
        autoDisplay: false,
        includedLanguages: SUPPORTED_LANGUAGES.join(","),
        layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE
      },
      "google_translate_element"
    );

    window.setTimeout(() => {
      applySelectedLanguage(pendingLanguage);
      syncFromWidget();
    }, 700);
  }

  window.googleTranslateElementInit = initGoogleTranslate;

  select.addEventListener("change", () => {
    const applied = applySelectedLanguage(select.value, { fromUser: true });
    if (!applied && select.value !== lastAppliedLanguage) {
      window.setTimeout(() => {
        applySelectedLanguage(select.value, { fromUser: true });
      }, 800);
    }
  });

  const existingScript = document.querySelector('script[data-google-translate="true"]');
  if (!existingScript) {
    const script = document.createElement("script");
    script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    script.async = true;
    script.setAttribute("data-google-translate", "true");
    script.addEventListener("error", () => {
      setStatus("Translation service could not load.");
    });
    document.head.appendChild(script);
  }

  if (pendingLanguage !== "en") {
    setStatus(`Loading ${LANGUAGE_LABELS[pendingLanguage]}...`);
  }

  setGoogleTranslateCookie(pendingLanguage);
  syncDocumentLanguage(pendingLanguage);

  window.setInterval(() => {
    if (!widgetApplied && pendingLanguage !== lastAppliedLanguage) {
      applySelectedLanguage(pendingLanguage);
    }
    syncFromWidget();
  }, 1000);
})();
