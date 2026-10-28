# 🍣 Mapa de Sushi

Una web privada para dos: un mapa en el que marcáis los sushis a los que habéis ido, cuántas veces
habéis repetido en cada uno, y los que tenéis pendientes de probar.

- **Coste: 0 €** para siempre. Web estática en GitHub Pages + plan gratuito de Firebase (sin tarjeta).
- **Entrada con contraseña**: una sola contraseña para los dos.
- **Contador de visitas** en cada marcador y total en la cabecera.
- **Botón «Añadir»** siempre a mano: «Estamos aquí» (con el GPS), marcar en el mapa, buscar por nombre o ver sushis por la zona.
- **Buscador de restaurantes** (OpenStreetMap) y botón «Sushi por aquí» para apuntar pendientes.
- **Nuestra casa** en el mapa, con la distancia a cada sushi, «¿Dónde vamos hoy?» y vuestras estadísticas.
- Funciona en el móvil como una app (se puede añadir a la pantalla de inicio); los cambios hechos sin cobertura se sincronizan después.

---

## Cómo funciona (en tres líneas)

| Pieza | Dónde vive | Coste |
| --- | --- | --- |
| La web (HTML/CSS/JS, sin frameworks ni build) | Este repo, publicado con **GitHub Pages** | 0 € |
| La contraseña y los datos compartidos | **Firebase**: Authentication (email + contraseña) y Firestore (base de datos) | 0 € (plan Spark) |
| Mapa y buscador | Ortofotos PNOA del IGN y Esri (satélite), OpenFreeMap, OpenStreetMap, Photon y Nominatim | 0 € (sin registro) |
| Lista de sushis de España | `data/sushis-es.json`, sacada de Overture Maps (datos abiertos de Meta, Microsoft, Foursquare…) | 0 € (va dentro de la web) |

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
   git add -A && git commit -m "Mapa de Sushi"
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
| `defaultCenter`, `defaultZoom` | Dónde se abre el mapa hasta que haya sitios o casa (por defecto Santa Perpètua de Mogoda). |
| `mapStyle` | Estilo del mapa por defecto: `satelite`, `color`, `suave`, `noche` o `clasico`. Cada móvil puede cambiarlo en el menú. |
| `sharedEmail` | Email de la cuenta compartida de Firebase. |
| `demoPassword` | Contraseña del modo demo (solo cuenta si no hay Firebase). |
| `initials` | Vuestras iniciales para el botón del menú, por ejemplo `'Y·A'`. Vacío = icono de tres rayas. |
| `dedication` | Dedicatoria opcional al pie de la pantalla de entrada (vacía por defecto). |
| `welcome` | Mensaje de bienvenida que se muestra una sola vez por dispositivo la primera vez que se entra. Vacío = nada. |

Para cambiar la contraseña: Firebase → Authentication → Users → menú ⋮ del usuario → **Restablecer contraseña**
(o bórralo y créalo de nuevo, actualizando el UID de las reglas).

### 5. En el móvil, como una app

- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Añadir a pantalla de inicio* / *Instalar aplicación*.

La sesión se recuerda, así que no hay que meter la contraseña cada vez. Los cambios hechos sin cobertura
se guardan en el teléfono y se sincronizan al volver la conexión.

---

## Cómo se usa

- **Añadir** (botón negro de abajo): elige cómo.
  - **Estamos aquí ahora**: usa el GPS y busca el restaurante en el que estáis. Ideal sentados a la mesa.
  - **Marcar en el mapa**: mueve el mapa hasta el sitio y deja el pin.
  - **Buscar por nombre**: escribe el nombre arriba. Si no aparece, la última opción de los resultados
    es «Añadir «nombre» a mano en el mapa».
  - **Ver sushis por la zona**: igual que el botón «Sushi por aquí».
- **Sushi por aquí**: busca alrededor de lo que se ve en el mapa (al menos 1,5 km) los restaurantes que
  OpenStreetMap marca como sushi, japoneses o asiáticos, y los pinta con su nombre. Toca uno para añadirlo.
  «Ver todos los restaurantes» enseña también el resto en gris, por si alguno hace sushi y no lo pone.
- **Mantén pulsado el mapa** (clic derecho en ordenador) para poner un pin rápido.
- **Contador**: cada sitio visitado es un punto negro con el número de veces que habéis ido. Se suma con
  **+1** desde la lista, desde la ficha o desde la barra inferior; cada +1 se puede deshacer al momento.
- En la ficha: visitas con fecha y nota (**Con otra fecha…** para apuntar una pasada), puntuación 🍣,
  notas con autoguardado, **Cómo llegar**, **Editar**, **Mover pin** y **Eliminar sitio** (con deshacer).
- **Fotos y opiniones en Google**: en la ficha y al añadir un sitio, abre su ficha de Google Maps (fotos, opiniones,
  horario). «Ver aquí el mapa de Google» la enseña dentro de la web. Las fotos no se pueden meter dentro de la
  web sin la API de pago de Google, así que se abren en Google Maps.
- Menú (botón redondo de arriba):
  - **Mapa**: Satélite (como la vista satélite de Apple: ortofoto del IGN con nombres encima), Color, Suave, Noche
    o Clásico. **Tema**: automático, claro u oscuro.
  - **🏠 Nuestra casa**: marcadla con el GPS o en el mapa. El mapa se abre ahí, la lista dice a qué distancia
    está cada sushi y podéis buscar sushi cerca de casa. Solo la veis vosotros (está en Firestore, no en el código).
  - **🎲 ¿Dónde vamos hoy?**: elige al azar un pendiente (o un visitado si no hay pendientes).
  - **🍣 Contador de piezas**: también con el botón 🍣 del mapa o «Contar» en la ficha (ver abajo).
  - **📊 Estadísticas**: visitas totales y del año, el de siempre, el mejor puntuado, el primero…
  - **Ver todos los sitios**, **Descargar copia (JSON)**, **Importar copia** y **Cerrar sesión**.
- **Contador de piezas** (botón 🍣 encima del de ubicación, o «Contar» en la ficha de un sitio): para ir contando
  lo que coméis, cada uno con su botón (toca el nombre para cambiarlo) o «Juntos». No se guarda en el historial:
  el móvil lo recuerda hasta el día siguiente por si se bloquea la pantalla, y el globito del botón 🍣 dice cuántas
  piezas lleváis. «Empezar de cero» pide un segundo toque.
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

**¿Por qué a veces hay que pulsar Intro para buscar?** El buscador rápido (Photon) bloquea algunas redes; si no
responde, la web usa Nominatim durante media hora, y Nominatim solo permite buscar al pulsar Intro (o «Buscar» en
el teclado del móvil). Con datos móviles suele ir el rápido.

**¿Por qué no sale un restaurante que existe?** La web busca en dos sitios: su propia lista de ~5.700 sushis,
japoneses y asiáticos de España (sacada de Overture Maps, que tiene muchos locales que OpenStreetMap no conoce,
como Sushi Hand Terrassa) y OpenStreetMap. Si aun así no sale, prueba con una sola palabra del nombre o usa
«Añadir «…» a mano en el mapa». Los restaurantes solo se buscan cerca de donde está el mapa (60 km), nunca en
otros países: para buscar en otra ciudad, escribe primero la ciudad y luego el restaurante.

**¿Cómo actualizo la lista de sushis?** Overture publica datos nuevos cada mes. Con Python instalado:

```bash
python3 -m venv .venv && .venv/bin/pip install duckdb
.venv/bin/python tools/actualizar_sushis.py
git add data/sushis-es.json && git commit -m "Actualizar sushis" && git push
```

Tarda unos 15 minutos (descarga solo la parte de España).

**¿Copia de seguridad?** Menú → *Descargar copia (JSON)* descarga un archivo con todo. Se puede importar en otra
instalación (o si algún día cambias de backend). Conviene bajarse una de vez en cuando.

**¿Por qué pide la contraseña otra vez?** En iPhone, Safari borra los datos de una web que no se abre en 7 días.
Añadida a la pantalla de inicio (paso 5) eso no pasa. Nada se pierde: todo está en Firestore.

**¿Fotos?** No: el almacenamiento de archivos de Firebase ya no entra en el plan gratuito. Las notas sí.

**¿Por qué no sale el mapa / sale gris?** Comprueba la conexión. El mapa en color viene de OpenFreeMap; si no carga
(o el móvil no tiene WebGL), la web cambia sola al estilo «Clásico» de OpenStreetMap.

**He subido un cambio y no lo veo.** GitHub Pages guarda los archivos 10 minutos en caché. En `index.html` hay un
«mapa de versiones» (`?v=4`): súbelo a `v=5` en todos los módulos y en `styles.css` en cada cambio.

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
lib/maplibre/           MapLibre GL 5.24 y su puente para Leaflet (licencias BSD, incluidas)
data/sushis-es.json     Sushis, japoneses y asiáticos de España (Overture Maps)
tools/                  Script para actualizar esa lista
.nojekyll               Le dice a GitHub Pages que publique los archivos tal cual
```

## Créditos

- Satélite: ortofotos [PNOA](https://pnoa.ign.es) cedidas por el © [Instituto Geográfico Nacional](https://www.ign.es) (CC BY 4.0) y World Imagery de © [Esri](https://www.esri.com) fuera de España.
- Mapa: [Leaflet](https://leafletjs.com), [MapLibre](https://maplibre.org) y [OpenFreeMap](https://openfreemap.org) (© [OpenMapTiles](https://openmaptiles.org)) · datos © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Lista de restaurantes: © [Overture Maps Foundation](https://overturemaps.org) (CDLA Permissive 2.0 / ODbL según la fuente).
- Búsqueda: [Photon](https://photon.komoot.io) (komoot), [Nominatim](https://nominatim.org) y [Overpass API](https://overpass-api.de), servicios comunitarios de uso justo.
- Datos y contraseña: [Firebase](https://firebase.google.com) (plan Spark).
