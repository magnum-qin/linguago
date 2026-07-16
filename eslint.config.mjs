import pluginVue from 'eslint-plugin-vue';
import vueTsConfigs from '@vue/eslint-config-typescript';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      'output/**',
      'logs/**',
      'data/**',
      'scripts/**',
      'worker/**',
      '*.js',
      '*.mjs',
      '*.cjs',
      'temp_sqlite/**',
      'outputs/**',
      'public/**'
    ]
  },
  ...pluginVue.configs['flat/recommended'],
  ...vueTsConfigs(),
  {
    files: ['src/**/*.{js,mjs,cjs,ts,vue}'],
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off'
    }
  }
];
