import { ref, watch, onMounted } from 'vue';
import { settings, THEME_SETTINGS_VERSION } from './useSettings';

export function useTheme() {
  const currentTheme = ref('system');

  const applyTheme = (theme: string, colorScheme: string = 'blue') => {
    let resolved = theme;
    if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.dataset.colorScheme = colorScheme;
    document.documentElement.style.backgroundColor = 'var(--m3-surface)';
  };

  const safeViewTransition = (callback: () => void) => {
    if (!document.startViewTransition) {
      callback();
      return;
    }
    try {
      const transition = document.startViewTransition(callback);
      transition.finished.catch(() => {});
      transition.ready.catch(() => {});
      transition.updateCallbackDone?.catch(() => {});
    } catch {
      callback();
    }
  };

  const toggleTheme = (event?: Event) => {
    const next = currentTheme.value === 'dark' ? 'light' : 'dark';
    safeViewTransition(() => {
      currentTheme.value = next;
      settings.theme = next;
      settings.themeSettingsVersion = THEME_SETTINGS_VERSION;
      applyTheme(next, settings.colorScheme || 'blue');
    });
  };

  onMounted(() => {
    currentTheme.value = settings.theme || 'system';
    applyTheme(currentTheme.value, settings.colorScheme || 'blue');

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (currentTheme.value === 'system') {
        applyTheme('system', settings.colorScheme || 'blue');
      }
    });
  });

  watch(currentTheme, (newTheme) => {
    applyTheme(newTheme, settings.colorScheme || 'blue');
  });

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
    toggleTheme
  };
}
