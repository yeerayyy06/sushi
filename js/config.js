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

  // Dónde se centra el mapa la primera vez (hasta que haya sitios guardados o marquéis vuestra casa).
  // [latitud, longitud] y zoom. Por defecto: Santa Perpètua de Mogoda.
  defaultCenter: [41.5343, 2.1836],
  defaultZoom: 14,

  // Estilo del mapa por defecto: 'satelite', 'color', 'suave', 'noche' o 'clasico'. Se puede cambiar desde el menú.
  mapStyle: 'satelite',

  // --- Contraseña (modo real, con Firebase) ---
  // Email del usuario que creas en Firebase > Authentication > Users.
  // No hace falta que exista de verdad: solo es el identificador de la cuenta compartida.
  // La contraseña es la que pongas al crear ese usuario.
  sharedEmail: 'nosotros@example.com',

  // --- Modo demo (sin Firebase) ---
  // Si no rellenas `firebase` más abajo, la web funciona en modo demo:
  // pide esta contraseña y guarda los datos SOLO en este navegador.
  demoPassword: 'sushi',

  // --- Firebase ---
  // Pega aquí el objeto firebaseConfig de la consola:
  // Configuración del proyecto > General > Tus apps > (app web) > SDK setup and configuration > Config
  firebase: {
    apiKey: 'AIzaSyAdB6IEC9q8HW_2zPfqe2BS-Uf7Jzavrcc',
    authDomain: 'mapa-sushi-fcb22.firebaseapp.com',
    projectId: 'mapa-sushi-fcb22',
    storageBucket: 'mapa-sushi-fcb22.firebasestorage.app',
    messagingSenderId: '455968960284',
    appId: '1:455968960284:web:19c0d600a899e5bf5d94d9',
  },

  // Versión del SDK de Firebase que se carga desde el CDN de Google.
  firebaseSdkVersion: '13.1.0',
};
