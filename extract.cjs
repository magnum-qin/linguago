const fs = require('fs');
const path = require('path');
const files = [
  'TranslatorCard.vue',
  'ResultCard.vue',
  'BookmarksCard.vue',
  'SettingsOverlay.vue',
  'Header.vue',
  'FuriganaText.vue',
  'ThemeToggle.vue'
];
files.forEach((f) => {
  try {
    const content = fs.readFileSync(path.join('src/components', f), 'utf-8');
    const lines = content.split('\n');
    lines.forEach((l, i) => {
      if (/[\u4e00-\u9fa5]/.test(l) && !l.includes('//')) console.log(f + ':' + (i + 1) + ': ' + l.trim());
    });
  } catch (e) {}
});
