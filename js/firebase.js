// Carga perezosa del SDK de Firebase (solo si hay configuración).
import { CONFIG } from './config.js';

let bootPromise = null;

export function hasFirebaseConfig() {
  const fb = CONFIG.firebase || {};
  return Boolean(fb.apiKey && fb.projectId && fb.appId);
}

/** Devuelve { app, authMod, firestoreMod } cargando el SDK una sola vez. */
export function getFirebase() {
  if (!bootPromise) {
    bootPromise = (async () => {
      const v = CONFIG.firebaseSdkVersion;
      const base = `https://www.gstatic.com/firebasejs/${v}`;
      const [appMod, authMod, firestoreMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]);
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(CONFIG.firebase);
      return { app, authMod, firestoreMod };
    })().catch((err) => {
      bootPromise = null; // permite reintentar si falló la red
      throw err;
    });
  }
  return bootPromise;
}
