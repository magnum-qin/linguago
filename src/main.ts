import { createApp } from 'vue';
import './assets/tailwind.css';
import App from './App.vue';
const app = createApp(App);
app.mount('#app');

// Register Service Worker in production environment
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Monitor new service worker updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // A new service worker is installed in background
                window.dispatchEvent(new CustomEvent('pwa-update-available'));
              }
            });
          }
        });
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
  });

  // Reload the page when the new Service Worker takes control (skipWaiting activates)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.dispatchEvent(new CustomEvent('pwa-updated'));
  });
}
