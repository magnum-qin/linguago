import { ref, watch } from 'vue';
import { settings, THEME_SETTINGS_VERSION } from './useSettings';

// Shared singleton reactive state so all callers (TranslatorCard, SettingsOverlay, App) stay in sync
const currentTheme = ref<string>('system');
const resolvedTheme = ref<'light' | 'dark'>('light');
let initialized = false;

export function isSystemDark(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && typeof mq.matches === 'boolean') {
      return mq.matches;
    }
  }
  if (typeof document !== 'undefined') {
    const probe = document.getElementById('pwa-theme-probe');
    if (probe) {
      const color = window.getComputedStyle(probe).color;
      if (color.includes('238')) return true;
    }
  }
  return false;
}

export function updateMetaThemeColor(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const color = resolved === 'dark' ? '#121417' : '#ffffff';
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((meta) => {
    const media = meta.getAttribute('media');
    if (!media) {
      meta.setAttribute('content', color);
    }
  });
}

export function applyTheme(theme: string, colorScheme: string = 'blue') {
  let resolved: 'light' | 'dark' = 'light';
  if (theme === 'system') {
    resolved = isSystemDark() ? 'dark' : 'light';
  } else {
    resolved = theme === 'dark' ? 'dark' : 'light';
  }

  currentTheme.value = theme;
  resolvedTheme.value = resolved;

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.dataset.colorScheme = colorScheme;
    document.documentElement.style.backgroundColor = 'var(--m3-surface)';
    document.documentElement.style.colorScheme = resolved;
    updateMetaThemeColor(resolved);
  }
}

export const safeViewTransition = (callback: () => void) => {
  if (typeof document === 'undefined' || !document.startViewTransition) {
    callback();
    return;
  }
  try {
    const transition = document.startViewTransition(callback);
    transition.finished?.catch(() => {});
    transition.ready?.catch(() => {});
    transition.updateCallbackDone?.catch(() => {});
  } catch {
    callback();
  }
};

function initThemeListeners() {
  if (initialized) return;
  initialized = true;

  currentTheme.value = settings.theme || 'system';
  applyTheme(currentTheme.value, settings.colorScheme || 'blue');

  const handleSystemChange = () => {
    if (settings.theme === 'system') {
      applyTheme('system', settings.colorScheme || 'blue');
    }
  };

  // 1. matchMedia change event
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) {
      mq.addEventListener('change', handleSystemChange);
    } else if ('addListener' in mq) {
      (mq as any).addListener(handleSystemChange);
    }
  }

  // 2. iOS PWA lifecycle events: when returning from Control Center or app switch
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleSystemChange();
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', handleSystemChange);
    window.addEventListener('focus', handleSystemChange);

    // 3. Heartbeat check for iOS Control Center toggle without leaving window
    setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        settings.theme === 'system'
      ) {
        const sysDark = isSystemDark();
        const target = sysDark ? 'dark' : 'light';
        if (document.documentElement.dataset.theme !== target) {
          applyTheme('system', settings.colorScheme || 'blue');
        }
      }
    }, 3000);
  }
}

export function useTheme() {
  initThemeListeners();

  const toggleTheme = (event?: Event) => {
    let next: string;
    if (currentTheme.value === 'system') {
      next = resolvedTheme.value === 'dark' ? 'light' : 'dark';
    } else if (currentTheme.value === 'dark') {
      next = 'light';
    } else {
      next = 'system';
    }

    safeViewTransition(() => {
      settings.theme = next;
      settings.themeSettingsVersion = THEME_SETTINGS_VERSION;
      applyTheme(next, settings.colorScheme || 'blue');
    });
  };

  const setTheme = (mode: string) => {
    safeViewTransition(() => {
      settings.theme = mode;
      settings.themeSettingsVersion = THEME_SETTINGS_VERSION;
      applyTheme(mode, settings.colorScheme || 'blue');
    });
  };

  watch(
    () => settings.theme,
    (newTheme) => {
      if (newTheme !== currentTheme.value) {
        applyTheme(newTheme, settings.colorScheme || 'blue');
      }
    }
  );

  watch(
    () => settings.colorScheme,
    (newScheme) => {
      safeViewTransition(() => {
        applyTheme(currentTheme.value, newScheme || 'blue');
      });
    }
  );

  return {
    currentTheme,
    resolvedTheme,
    toggleTheme,
    setTheme
  };
}
