// Autenticación: Firebase Auth (email + contraseña, cuenta compartida) o modo demo.
import { CONFIG } from './config.js';
import { getFirebase, hasFirebaseConfig } from './firebase.js';

const DEMO_KEY = 'sushimap:demo-session';

/**
 * El modo demo (sin Firebase, datos en localStorage) solo se activa en local o pidiéndolo con ?demo=1.
 * Así, si la web se publica sin configurar Firebase, avisa en vez de guardar datos que luego se perderían.
 */
export function demoAllowed() {
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.local');
  return local || new URLSearchParams(location.search).has('demo');
}

export async function createAuth() {
  if (hasFirebaseConfig()) return createFirebaseAuth();
  if (!demoAllowed()) {
    const err = new Error('Falta la configuración de Firebase en js/config.js. (Para probar la web sin Firebase, ábrela con ?demo=1 al final de la dirección.)');
    err.code = 'no-config';
    throw err;
  }
  return createDemoAuth();
}

// ---------------------------------------------------------------------------
async function createFirebaseAuth() {
  const { app, authMod } = await getFirebase();
  const auth = authMod.getAuth(app);
  auth.languageCode = 'es';

  return {
    mode: 'firebase',
    onChange(cb) {
      return authMod.onAuthStateChanged(auth, (user) => cb(user ? { uid: user.uid, email: user.email } : null));
    },
    async signIn(password) {
      const email = (CONFIG.sharedEmail || '').trim();
      if (!email) throw new Error('Falta `sharedEmail` en js/config.js');
      try {
        await authMod.signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        throw new Error(describeAuthError(err));
      }
    },
    async signOut() {
      await authMod.signOut(auth);
    },
  };
}

function describeAuthError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/missing-password':
    case 'auth/invalid-login-credentials':
      return 'Esa no es. Prueba otra vez.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos seguidos. Espera un momento y vuelve a probar.';
    case 'auth/network-request-failed':
      return 'No hay conexión. Comprueba internet e inténtalo de nuevo.';
    case 'auth/user-disabled':
      return 'Esta cuenta está desactivada en Firebase.';
    case 'auth/operation-not-allowed':
      return 'El acceso con email y contraseña no está activado en Firebase Authentication.';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
      return 'La configuración de Firebase (apiKey) no es válida. Revisa js/config.js.';
    default:
      return `No se ha podido entrar (${code || err?.message || 'error desconocido'}).`;
  }
}

// ---------------------------------------------------------------------------
function createDemoAuth() {
  const listeners = new Set();
  const read = () => {
    try {
      return localStorage.getItem(DEMO_KEY) === '1' ? { uid: 'demo', email: 'demo' } : null;
    } catch {
      return null;
    }
  };
  const notify = () => listeners.forEach((cb) => cb(read()));

  return {
    mode: 'demo',
    onChange(cb) {
      listeners.add(cb);
      queueMicrotask(() => cb(read()));
      return () => listeners.delete(cb);
    },
    async signIn(password) {
      await new Promise((r) => setTimeout(r, 250)); // pequeña pausa: parece "real"
      if (password !== CONFIG.demoPassword) throw new Error('Esa no es. Prueba otra vez.');
      try {
        localStorage.setItem(DEMO_KEY, '1');
      } catch {
        /* navegación privada: la sesión durará lo que dure la pestaña */
      }
      notify();
    },
    async signOut() {
      try {
        localStorage.removeItem(DEMO_KEY);
      } catch {
        /* ignorar */
      }
      notify();
    },
  };
}
