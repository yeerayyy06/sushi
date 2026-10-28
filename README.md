# 🍣 Nuestro mapa de sushi

Una web privada para dos: un mapa en el que marcáis los sushis a los que habéis ido, cuántas veces
habéis repetido en cada uno, y los que tenéis pendientes de probar.

- **Coste: 0 €** para siempre. Web estática en GitHub Pages + plan gratuito de Firebase (sin tarjeta).
- **Entrada con contraseña**: una sola contraseña para los dos.
- **Contador de visitas** en cada marcador y total en la cabecera.
- **Buscador de restaurantes** (OpenStreetMap) y botón «Sushi por aquí» para apuntar pendientes.
- Funciona en el móvil como una app (se puede añadir a la pantalla de inicio); los cambios hechos sin cobertura se sincronizan después.

---

## Cómo funciona (en tres líneas)

| Pieza | Dónde vive | Coste |
| --- | --- | --- |
| La web (HTML/CSS/JS, sin frameworks ni build) | Este repo, publicado con **GitHub Pages** | 0 € |
| La contraseña y los datos compartidos | **Firebase**: Authentication (email + contraseña) y Firestore (base de datos) | 0 € (plan Spark) |
| Mapa y buscador | OpenStreetMap (teselas), Photon y Nominatim (búsqueda) | 0 € (sin registro) |

Una web estática no puede guardar nada por sí sola ni esconder una contraseña (todo su código es público),
así que la contraseña «de verdad» la comprueba Firebase y los datos se guardan en Firestore, protegidos
por reglas que solo dejan pasar a vuestra cuenta.

> Sin configurar Firebase, la web funciona en **modo demo**: pide la contraseña `sushi` y guarda los
> datos solo en ese navegador. Sirve para probarla antes de montar nada.

---

## Puesta en marcha

### 1. Pruébala en local (2 minutos)

```bash
cd Sushi
python3 -m http.server 8000
```

Abre <http://localhost:8000>, entra con la contraseña `sushi` y juega. Los datos del modo demo se quedan en
tu navegador (puedes exportarlos después desde el menú → «Descargar copia (JSON)» e importarlos cuando tengas Firebase).

El modo demo solo se activa en local (`localhost`) o añadiendo `?demo=1` a la dirección. Si publicas la web sin
configurar Firebase, en vez de guardar datos que luego se perderían, muestra un aviso pidiendo la configuración.

### 2. Crea el proyecto de Firebase (10 minutos, una sola vez)

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google → **Crear un proyecto** → ponle nombre
   (por ejemplo `sushi-map`) → puedes desactivar Google Analytics → **Crear**. Es el plan **Spark**, gratuito y sin tarjeta.
2. En la pantalla principal del proyecto pulsa el icono **`</>`** (añadir app web) → apodo `sushi` → **no** marques
   Firebase Hosting → **Registrar app**. Copia el objeto `firebaseConfig` que te muestra y pégalo en
   [`js/config.js`](js/config.js) (campo `firebase`). Puedes volver a verlo en *Configuración del proyecto → Tus apps*.
3. **Authentication** (menú *Compilación*) → **Comenzar** → pestaña **Sign-in method** → **Correo electrónico/contraseña**
   → activa la primera opción → **Guardar**.
4. Pestaña **Users** → **Añadir usuario**:
   - Email: uno que controles tú (vale un alias como `tunombre+sushi@gmail.com`; es solo el identificador de la cuenta compartida).
   - Contraseña: **la contraseña del regalo** (la que os sabréis los dos).
   - Al crearlo verás su **User UID** (una cadena larga). Cópialo, lo necesitas en el paso 7.
5. Pestaña **Settings** (Configuración) → sección **User actions** → desactiva **Enable create (sign-up)**
   para que nadie pueda registrarse con la configuración pública de la web.
6. **Firestore Database** (menú *Compilación*) → **Crear base de datos** → edición **Standard** →
   ubicación **`eur3 (europe-west)`** o **`europe-southwest1 (Madrid)`** → **Modo de producción** → **Crear**.
   (La ubicación no se puede cambiar después; cualquiera de las dos va bien.)
7. Pestaña **Reglas**: borra lo que hay, pega el contenido de [`firestore.rules`](firestore.rules) y sustituye
   `PEGA_AQUI_EL_UID` por el UID del paso 4 → **Publicar**.
8. Escribe el email del paso 4 en `sharedEmail` dentro de [`js/config.js`](js/config.js).
9. (Opcional, recomendado) **Authentication → Settings → Dominios autorizados** → añade `TU-USUARIO.github.io`.

Recarga la web en local: ahora la contraseña es la del paso 4 y los datos se guardan en Firestore (los verás
también en la consola, colección `places`). Si te sale «Sin permiso…», casi seguro que el UID de las reglas no coincide.

### 3. Publícala en GitHub Pages (5 minutos)

El repositorio debe ser **público** (GitHub Pages solo es gratis en repos públicos). No pasa nada: la
configuración de Firebase es pública por diseño; lo que protege los datos son las reglas y la contraseña,
que **nunca** está en el código.

1. En GitHub: **New repository** → nombre (por ejemplo `sushi`) → **Public** → **Create repository**.
2. Sube el código:

   ```bash
   cd Sushi
   git init && git branch -M main
   git add -A && git commit -m "Nuestro mapa de sushi"
   git remote add origin https://github.com/TU-USUARIO/sushi.git
   git push -u origin main
   ```

3. En el repo: **Settings** → menú lateral **Pages** → *Build and deployment* → **Source: Deploy from a branch**
   → Branch **main**, carpeta **/ (root)** → **Save**.
4. En uno o dos minutos (hasta 10) la web está en **`https://TU-USUARIO.github.io/sushi/`**. Esa es la URL que le das.

Cada vez que cambies algo y hagas `git push`, GitHub la vuelve a publicar sola. Las páginas se cachean
10 minutos: si no ves un cambio, sube el número de `?v=1` en la etiqueta `<script>` de `index.html`.

### 4. Personalízala

Todo está en [`js/config.js`](js/config.js):

| Campo | Para qué |
| --- | --- |
| `title`, `subtitle` | Texto de la cabecera y de la pantalla de entrada. |
| `defaultCenter`, `defaultZoom` | Dónde se centra el mapa hasta que haya sitios (por defecto Barcelona). |
| `sharedEmail` | Email de la cuenta compartida de Firebase. |
| `demoPassword` | Contraseña del modo demo (solo cuenta si no hay Firebase). |
| `initials` | Vuestras iniciales para el botón del menú, por ejemplo `'Y·A'`. Vacío = icono de tres rayas. |
| `dedication` | Dedicatoria al pie de la pantalla de entrada y del menú. |
| `welcome` | Mensaje de bienvenida que se muestra una sola vez por dispositivo la primera vez que se entra. Vacío = nada. |
| `cartoKey` | Opcional. Con una clave gratuita de [CARTO Basemaps](https://carto.com/basemaps/apikey/) (solo piden un email, uso personal) el mapa se ve más limpio y el modo oscuro usa teselas oscuras de verdad. Sin clave, se usa OpenStreetMap estándar. |

Para cambiar la contraseña: Firebase → Authentication → Users → menú ⋮ del usuario → **Restablecer contraseña**
(o bórralo y créalo de nuevo, actualizando el UID de las reglas).

### 5. En el móvil, como una app

- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Añadir a pantalla de inicio* / *Instalar aplicación*.

La sesión se recuerda, así que no hay que meter la contraseña cada vez. Los cambios hechos sin cobertura
se guardan en el teléfono y se sincronizan al volver la conexión.

---

## Cómo se usa

- **Buscar**: escribe el nombre del restaurante (o una ciudad para mover el mapa). Elige un resultado y
  pulsa **Ya hemos ido** (suma la primera visita con la fecha de hoy) o **Pendiente**.
- **Sushi por aquí**: muestra como puntos grises los restaurantes de sushi/japoneses de la zona que estás
  viendo (según OpenStreetMap). Toca uno para añadirlo. «Limpiar» los quita.
- **Mantén pulsado el mapa** (clic derecho en ordenador) o usa menú → **Marcar en el mapa** para poner un
  pin donde quieras, con la dirección rellenada automáticamente.
- **Contador**: cada sitio visitado es un punto negro con el número de veces que habéis ido. Se suma con
  **+1** desde la lista, desde la ficha o desde la barra inferior; cada +1 se puede deshacer al momento.
- En la ficha: visitas con fecha y nota (**Con otra fecha…** para apuntar una pasada), puntuación 🍣,
  notas con autoguardado, **Cómo llegar**, **Editar**, **Mover pin** y **Eliminar sitio** (con deshacer).
- La lista (**Visitados** / **Pendientes**) y el total de visitas están en el panel inferior (lateral en ordenador).
  El sitio más repetido se marca como «el de siempre».
- Menú (botón redondo): tema automático/claro/oscuro, **Ver todos los sitios**, **Descargar copia (JSON)**,
  **Importar copia** y **Cerrar sesión**.
- En el móvil, el botón «atrás» cierra la ficha en vez de salir de la web.

---

## Preguntas frecuentes

**¿Puede entrar alguien que vea el código del repo?** No. El código no contiene la contraseña, y Firestore
solo acepta lecturas y escrituras de la cuenta compartida (reglas atadas a su UID). Lo único que podría hacer
alguien es intentar adivinar la contraseña; Firebase bloquea los intentos repetidos.

**¿Qué pasa si se pierde la contraseña?** La cambias en la consola de Firebase (paso 4). Nada se pierde.

**¿Hasta dónde llega el plan gratuito?** Firestore regala 50.000 lecturas y 20.000 escrituras al día y 1 GB
de espacio. Dos personas anotando sushis gastan una fracción ínfima.

**¿Puede entrar mi pareja con su propia cuenta de Google al proyecto?** Sí, y es buena idea: Firebase →
Configuración del proyecto → Usuarios y permisos → añadirla como propietaria. Así el proyecto no depende de
una sola cuenta.

**¿Y si Photon (el buscador) no responde?** La web pasa sola a Nominatim unos minutos (ahí la búsqueda es al
pulsar Intro, por su política de uso). Siempre puedes poner el pin a mano.

**¿Copia de seguridad?** Menú → *Descargar copia (JSON)* descarga un archivo con todo. Se puede importar en otra
instalación (o si algún día cambias de backend). Conviene bajarse una de vez en cuando.

**¿Por qué pide la contraseña otra vez?** En iPhone, Safari borra los datos de una web que no se abre en 7 días.
Añadida a la pantalla de inicio (paso 5) eso no pasa. Nada se pierde: todo está en Firestore.

**¿Fotos?** No: el almacenamiento de archivos de Firebase ya no entra en el plan gratuito. Las notas sí.

**¿Por qué no sale el mapa / sale gris?** Comprueba la conexión; las teselas vienen de tile.openstreetmap.org.
Si has puesto `cartoKey` y ves un aviso de «API KEY REQUIRED» en el mapa, la clave no es válida: bórrala.

---

## Estructura del proyecto

```
index.html              Página única (pantalla de contraseña + mapa)
css/styles.css          Estilos (claro/oscuro, móvil y escritorio)
js/config.js            ← lo único que hay que editar
js/app.js               Arranque: sesión, mapa, datos y UI
js/ui.js                Paneles, listas, fichas, diálogos, avisos y tema
js/map.js               Leaflet: mapa base, marcadores, pin provisional
js/store.js             Datos: Firestore (real) o localStorage (demo), con validación
js/auth.js              Sesión: Firebase Auth o modo demo
js/search.js            Búsqueda: Photon, Nominatim y Overpass
js/firebase.js          Carga del SDK de Firebase desde el CDN de Google (solo si hay config)
js/util.js              Utilidades
firestore.rules         Reglas de seguridad para pegar en Firebase
manifest.webmanifest    Para instalarla como app
icons/                  Iconos de la app
lib/leaflet/            Leaflet 1.9.4 (licencia BSD-2, incluida)
.nojekyll               Le dice a GitHub Pages que publique los archivos tal cual
```

## Créditos

- Mapa: [Leaflet](https://leafletjs.com) · datos y teselas © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Búsqueda: [Photon](https://photon.komoot.io) (komoot), [Nominatim](https://nominatim.org) y [Overpass API](https://overpass-api.de), servicios comunitarios de uso justo.
- Datos y contraseña: [Firebase](https://firebase.google.com) (plan Spark).
