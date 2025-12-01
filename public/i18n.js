// Lightweight i18n utility for TradingView Backtester
class I18n {
    constructor() {
        this.currentLang = 'en';
        this.translations = {};
        this.fallbackLang = 'en';
    }

    async init() {
        // Détection: localStorage > langue navigateur > défaut EN
        const browserLang = navigator.language.split('-')[0]; // 'en-US' -> 'en'
        const savedLang = localStorage.getItem('appLanguage');

        // Priority: saved > browser > fallback
        this.currentLang = savedLang || (browserLang === 'fr' ? 'fr' : 'en');

        // Load translation files
        await this.loadTranslations(this.currentLang);
        if (this.currentLang !== this.fallbackLang) {
            await this.loadTranslations(this.fallbackLang);
        }
    }

    async loadTranslations(lang) {
        try {
            const response = await fetch(`/locales/${lang}.json`);
            if (!response.ok) {
                console.warn(`Failed to load translations for ${lang}`);
                return;
            }
            this.translations[lang] = await response.json();
        } catch (error) {
            console.error(`Error loading translations for ${lang}:`, error);
        }
    }

    t(key, variables = {}) {
        // Get translation from current language or fallback
        let text = this.translations[this.currentLang]?.[key]
                || this.translations[this.fallbackLang]?.[key]
                || key;

        // Replace variables: {{variable}} -> actual value
        Object.keys(variables).forEach(varName => {
            text = text.replace(new RegExp(`{{${varName}}}`, 'g'), variables[varName]);
        });

        return text;
    }

    setLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('appLanguage', lang);
        this.updateDOM();
    }

    getCurrentLanguage() {
        return this.currentLang;
    }

    updateDOM() {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });

        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = this.t(key);
        });

        // Update titles
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });

        // Trigger custom event for dynamic content
        window.dispatchEvent(new CustomEvent('languageChanged', {
            detail: { language: this.currentLang }
        }));
    }
}

// Global instance
const i18n = new I18n();
