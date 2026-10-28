// ============================================================================
//  CONFIGURACIÓN — este es el único archivo que necesitas tocar.
// ============================================================================

export const CONFIG = {
  // Textos de la cabecera y de la pantalla de entrada.
  title: 'Nuestro mapa de sushi',
  subtitle: 'Cada sushi al que hemos ido. Y los que nos quedan.',

  // Vuestras iniciales para el botón del menú (p. ej. 'Y·A'). Vacío = icono de tres rayas.
  initials: '',

  // Dedicatoria: aparece al pie de la pantalla de entrada y del menú. (Ojo: este archivo es público.)
  dedication: 'Hecho a mano, para nosotros dos.',

  // Mensaje de bienvenida: se enseña UNA vez por dispositivo la primera vez que se entra. Vacío = no se enseña.
  welcome: '',

  // Dónde se centra el mapa la primera vez (hasta que haya sitios guardados).
  // [latitud, longitud] y zoom. Por defecto: Barcelona.
  defaultCenter: [41.3874, 2.1686],
  defaultZoom: 13,

  // --- Contraseña (modo real, con Firebase) ---
  // Email del usuario que creas en Firebase > Authentication > Users.
  // No hace falta que exista de verdad: solo es el identificador de la cuenta compartida.
  // La contraseña es la que pongas al crear ese usuario.
  sharedEmail: '',

  // --- Modo demo (sin Firebase) ---
  // Si no rellenas `firebase` más abajo, la web funciona en modo demo:
  // pide esta contraseña y guarda los datos SOLO en este navegador.
  demoPassword: 'sushi',

  // --- Firebase ---
  // Pega aquí el objeto firebaseConfig de la consola:
  // Configuración del proyecto > General > Tus apps > (app web) > SDK setup and configuration > Config
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },

  // --- Mapa base (opcional) ---
  // Sin clave se usan las teselas estándar de OpenStreetMap (gratis, sin registro).
  // Si quieres un mapa más bonito y modo oscuro real, pide una clave gratuita de CARTO Basemaps
  // (solo con tu email, sin tarjeta, uso personal): https://carto.com/basemaps/apikey/ y pégala aquí.
  cartoKey: '',

  // Versión del SDK de Firebase que se carga desde el CDN de Google.
  firebaseSdkVersion: '13.1.0',
};
