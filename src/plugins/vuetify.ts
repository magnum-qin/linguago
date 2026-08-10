import 'vuetify/styles';
import { createVuetify } from 'vuetify';

export default createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#4A90E2',
          surface: '#FFFFFF',
          background: '#F0F4F8'
        }
      },
      dark: {
        colors: {
          primary: '#8AB4F8',
          surface: '#121417',
          background: '#1C2025'
        }
      }
    }
  },
  defaults: {
    VBtn: {
      style: 'text-transform: none; letter-spacing: normal;'
    }
  }
});
