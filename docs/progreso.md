# Progreso del proyecto TeamChat AI

Este documento registra los pasos hechos durante el desarrollo para poder retomar el proyecto sin depender de memoria.

## Objetivo del proyecto

Construir una plataforma de chat colaborativo multi-tenant donde varios usuarios de una misma organización puedan conversar en salas compartidas y mencionar a Gemini AI con contexto de toda la conversación.

Stack requerido por la prueba:

- React + Vite + TypeScript para frontend.
- Node.js + TypeScript para backend.
- Firebase Auth para login.
- Firestore para datos en tiempo real.
- Vertex AI Gemini para respuestas IA con streaming.
- Firebase Hosting para frontend.
- Cloud Run para backend.

## Paso 1: Arquitectura base

Se creó un monorepo en:

```text
C:\Users\nater\OneDrive\Documentos\Codigo\Prueba Tecnica\multichat
```

Estructura:

```text
multichat/
  apps/
    web/      Frontend React + Vite + TypeScript
    api/      Backend Node.js + Express + TypeScript
  packages/
    shared/   Tipos compartidos entre frontend y backend
  docs/
    progreso.md
  firestore.rules
  firebase.json
  package.json
  README.md
```

Decisión de arquitectura:

- El frontend usa Firebase Auth para login.
- El frontend usa Firestore para realtime chat.
- El backend se reserva para lógica protegida: validar token, validar tenant/room access y llamar a Gemini.
- Firestore se organiza por organización para reforzar aislamiento multi-tenant.

## Paso 2: Modelo Firestore y reglas

Modelo definido:

```text
organizations/{orgId}
organizations/{orgId}/users/{uid}
organizations/{orgId}/rooms/{roomId}
organizations/{orgId}/rooms/{roomId}/members/{uid}
organizations/{orgId}/rooms/{roomId}/messages/{messageId}
organizations/{orgId}/rooms/{roomId}/presence/{uid}
organizations/{orgId}/rooms/{roomId}/typing/{uid}
userProfiles/{uid}
```

Puntos importantes:

- Cada organización tiene sus propios usuarios, rooms y mensajes.
- Las rooms tienen `memberIds` para consultar solo salas donde el usuario pertenece.
- Las reglas Firestore bloquean acceso cruzado entre organizaciones.
- Los mensajes solo pueden crearse si el usuario pertenece a la sala.

Archivo relevante:

```text
firestore.rules
```

## Paso 3: Interfaz base

Se creó una UI básica con Tailwind:

- Pantalla de login.
- Layout de chat con sidebar.
- Lista de rooms.
- Header de sala activa.
- Lista de mensajes.
- Estado vacío.
- Composer para enviar mensajes.
- Estilo visual distinto para mensajes de Gemini.

Archivos relevantes:

```text
apps/web/src/pages/LoginPage.tsx
apps/web/src/pages/ChatPage.tsx
apps/web/src/styles.css
apps/web/vite.config.ts
```

Validaciones ejecutadas:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Resultado:

- Typecheck correcto.
- Build correcto.
- Servidor Vite disponible en `http://localhost:5173`.

Ajuste posterior:

- La UI mostraba `User profile not found` después del login.
- Causa: el frontend intentaba leer toda la colección `userProfiles`.
- Las reglas Firestore solo permiten leer `userProfiles/{uid}` del usuario autenticado.
- Se corrigió `ChatPage.tsx` para suscribirse directamente a `doc(db, "userProfiles", user.uid)`.

## Paso 4: Firebase Console

Se creó/configuró el proyecto Firebase:

```text
Project ID: multichat-ai-b5cea
```

Servicios activados manualmente:

- Firebase Authentication con Email/Password.
- Firestore Database.

Ubicación Firestore elegida:

```text
nam5
```

Nota:

- `nam5` es una multi-región de Norteamérica.
- Para esta prueba técnica está bien.
- Vertex AI y Cloud Run pueden usarse después en `us-central1`.

## Paso 5: Configuración local Firebase

Se creó `.firebaserc` apuntando al proyecto:

```json
{
  "projects": {
    "default": "multichat-ai-b5cea"
  }
}
```

Se creó `apps/web/.env.local` con el `firebaseConfig` de la app web.

No se debe subir `.env.local` a Git.

## Paso 6: Firebase CLI login

Se ejecutó:

```powershell
npx.cmd firebase-tools login
```

Resultado:

```text
Success! Logged in as nateragomes@gmail.com
```

## Paso 7: Deploy de reglas Firestore

Se ejecutó:

```powershell
npx.cmd firebase-tools deploy --only firestore:rules --project multichat-ai-b5cea
```

Resultado:

```text
rules file firestore.rules compiled successfully
released rules firestore.rules to cloud.firestore
Deploy complete
```

Estado:

- Las reglas de Firestore ya están desplegadas.

## Paso 8: Seed de datos de prueba

Se creó un seed script:

```text
apps/api/src/scripts/seed.ts
```

Objetivo del seed:

- Crear 2 organizaciones.
- Crear 3 usuarios por organización.
- Crear rooms de ejemplo.
- Crear memberships.
- Crear mensajes iniciales.

Usuarios planeados:

```text
sarah@acme.test / Test1234!
mike@acme.test / Test1234!
lisa@acme.test / Test1234!
ana@globex.test / Test1234!
diego@globex.test / Test1234!
carla@globex.test / Test1234!
```

Se creó también:

```text
apps/api/.env
```

Con:

```env
PORT=8080
GOOGLE_CLOUD_PROJECT=multichat-ai-b5cea
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-1.5-flash
WEB_ORIGIN=http://localhost:5173
```

Bloqueo actual:

Al ejecutar:

```powershell
npm.cmd run seed --workspace @multichat/api
```

falló con:

```text
Could not load the default credentials
```

Significado:

- Firebase CLI ya está autenticado para deploy.
- Pero Firebase Admin SDK necesita credenciales de servidor.
- El equipo no tiene `gcloud` instalado o configurado con Application Default Credentials.

Resolución:

Se ejecutó correctamente:

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project multichat-ai-b5cea
```

Después se ejecutó:

```powershell
npm.cmd run seed --workspace @multichat/api
```

Resultado:

```text
Seed completed. Default password: Test1234!
```

Estado:

- Organizaciones de prueba creadas.
- Usuarios de prueba creados en Firebase Auth.
- Perfiles creados en Firestore.
- Rooms creadas.
- Memberships creados.
- Mensajes iniciales creados.

## Siguiente paso inmediato

Probar login en la app web con usuarios seed.

Estado actualizado:

- `gcloud init` ya se ejecutó correctamente.
- La cuenta activa es `nateragomes@gmail.com`.
- El proyecto activo es `multichat-ai-b5cea`.
- `gcloud auth application-default login` ya se ejecutó correctamente.
- El seed ya se ejecutó correctamente.

Abrir:

```text
http://localhost:5173
```

Credenciales de prueba:

```text
sarah@acme.test / Test1234!
mike@acme.test / Test1234!
lisa@acme.test / Test1234!
ana@globex.test / Test1234!
diego@globex.test / Test1234!
carla@globex.test / Test1234!
```

Si el servidor frontend no está activo:

```powershell
npm.cmd run dev
```

## Paso 9: Primer flujo Gemini desde frontend

Se conectó el composer del chat con el backend AI.

Nuevo comportamiento:

- El usuario envía un mensaje normal.
- Si el mensaje contiene `@Gemini` o `@AI`, el frontend llama al backend.
- El frontend envía el Firebase ID token como `Bearer token`.
- El backend valida el token con Firebase Admin.
- El backend valida que el usuario pertenezca a la room.
- El backend construye contexto con los últimos mensajes.
- El backend crea un mensaje `Gemini AI` en Firestore.
- Durante streaming, el backend actualiza ese mensaje.
- Si Gemini falla, el mensaje queda con estado `error`.

Archivos modificados:

```text
apps/web/src/pages/ChatPage.tsx
apps/api/src/routes/ai.ts
```

Endpoint usado:

```text
POST /api/ai/stream
```

Body:

```json
{
  "orgId": "acme",
  "roomId": "engineering"
}
```

Nota:

- Este flujo ya está cableado.
- Para que funcione con IA real falta confirmar que Vertex AI esté habilitado en el proyecto y que el backend local esté corriendo en `http://localhost:8080`.

## Paso 10: Activación de Vertex AI

Al probar `@Gemini`, el backend respondió con error 403:

```text
Agent Platform API has not been used in project multichat-ai-b5cea before or it is disabled
```

Causa:

- El SDK de Vertex AI usa la API `aiplatform.googleapis.com`.
- Esa API todavía no estaba habilitada en el proyecto Google Cloud/Firebase.

Se resolvió ejecutando:

```powershell
gcloud services enable aiplatform.googleapis.com --project multichat-ai-b5cea
```

En la sesión de Codex se usó la ruta completa porque `gcloud` no estaba en el PATH del proceso:

```powershell
C:\Users\nater\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd
```

Resultado:

```text
Operation finished successfully.
```

Siguiente comprobación:

- Reintentar un mensaje con `@Gemini`.
- Si aparece otro 403, revisar permisos/billing/ubicación del modelo.

## Paso 11: Preparación para Vertex AI real con control de coste

Se añadió modo configurable:

```env
MOCK_GEMINI=true
```

Usa respuesta simulada sin coste.

```env
MOCK_GEMINI=false
```

Usa Vertex AI Gemini real.

También se ajustó configuración por defecto:

```env
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_MAX_OUTPUT_TOKENS=512
GEMINI_HISTORY_LIMIT=20
```

Objetivo:

- Usar un modelo más económico.
- Limitar salida.
- Limitar contexto enviado.
- Mostrar errores más legibles para billing/API/permisos.

Documento nuevo:

```text
docs/billing-vertex-ai.md
```

## Paso 12: Prueba exitosa del flujo @Gemini en modo mock

Se probó en el chat un mensaje con `@Gemini`.

Resultado:

- El frontend detectó la mención.
- El frontend llamó al backend `/api/ai/stream`.
- El backend validó Firebase Auth.
- El backend validó acceso a la room.
- El backend creó un mensaje `Gemini AI` en Firestore.
- Firestore actualizó el frontend en tiempo real.

Respuesta observada:

```text
Based on the discussion from Sarah, Mike, Lisa, I would start with Cloud Memorystore for Redis...
```

Nota importante:

- Esa respuesta corresponde al modo `MOCK_GEMINI=true`.
- Confirma que el flujo técnico funciona sin coste.
- Para probar Vertex AI real hay que cambiar `MOCK_GEMINI=false` en `apps/api/.env` y reiniciar el backend.

## Paso 13: Diagnóstico de cambio mock a Vertex real

Se cambió:

```env
MOCK_GEMINI=false
```

pero el chat seguía devolviendo la respuesta mock.

Causa:

- El archivo `.env` estaba correcto.
- El backend que seguía escuchando en `localhost:8080` era un proceso viejo iniciado con `MOCK_GEMINI=true`.

Diagnóstico:

```powershell
netstat -ano | findstr :8080
```

Mostró el proceso activo en el puerto `8080`.

Resolución:

- Se detuvo solo el proceso viejo del backend.
- Se arrancó de nuevo `npm.cmd run dev:api`.
- El nuevo proceso escucha en `localhost:8080`.

Mejora añadida:

- `/health` ahora devuelve si la API está usando mock o Vertex real.

Ejemplo:

```json
{
  "ok": true,
  "ai": {
    "mock": false,
    "model": "gemini-2.5-flash-lite"
  }
}

## Paso 14: Error HTML al llamar Gemini

Se observó:

```text
Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

Causa probable:

- El frontend recibió HTML en vez de JSON.
- Esto ocurre cuando la llamada `/api/ai/stream` llega al servidor Vite (`localhost:5173`) en vez del backend (`localhost:8080`).

Mejoras añadidas:

- `vite.config.ts` ahora tiene proxy:

```ts
proxy: {
  "/api": "http://localhost:8080"
}
```

- `ChatPage.tsx` ya no intenta parsear HTML como JSON.
- Si el backend devuelve error, la UI muestra status, URL y mensaje corto.

Después de este cambio hay que reiniciar el servidor Vite.

## Paso 15: Sustitución del SDK Vertex por REST

Después de corregir proxy/frontend, el mensaje de error `Unexpected token '<'` seguía apareciendo como contenido de `Gemini AI`.

Diagnóstico:

- Ya no era un error del frontend.
- El error venía de la llamada interna a Vertex AI.
- El SDK `@google-cloud/vertexai` estaba recibiendo HTML y fallaba al parsearlo como JSON, ocultando la respuesta real.

Cambio aplicado:

- Se reemplazó el uso directo del SDK por una llamada REST a Vertex AI.
- La autenticación sigue usando Application Default Credentials vía `google-auth-library`.
- El endpoint usado es:

```text
https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse
```

Ventajas:

- Seguimos usando Vertex AI real.
- Seguimos teniendo streaming.
- Los errores HTTP ahora se reportan con status y body real.
- Se evita el parseo opaco que producía `Unexpected token '<'`.

Archivo principal:

```text
apps/api/src/lib/gemini.ts
```

## Paso 16: Mensajes vacíos y scroll del chat

Se observó que `Gemini AI` aparecía en el chat pero sin contenido.

Cambios aplicados:

- El parser SSE de Vertex ahora soporta eventos separados por CRLF (`\r\n\r\n`), no solo LF (`\n\n`).
- Al terminar el stream, el backend procesa cualquier buffer restante.
- Si Vertex termina sin devolver texto, el mensaje AI pasa a `status: "error"` con contenido explicativo.

También se ajustó el layout del chat:

- La app usa altura fija de viewport (`h-screen`).
- El panel de mensajes tiene scroll interno.
- Al llegar nuevos mensajes, el scroll baja automáticamente al último.

Archivos:

```text
apps/api/src/lib/gemini.ts
apps/api/src/routes/ai.ts
apps/web/src/pages/ChatPage.tsx
```

## Paso 17: Chat contenido en una ventana con scroll interno

Se ajustó el diseño porque con muchos mensajes el composer podía desaparecer o quedar fuera del viewport.

Nuevo comportamiento:

- La app completa usa `h-screen` y no hace scroll global.
- El chat vive dentro de una ventana visual con borde, sombra y esquinas redondeadas.
- La sidebar queda dentro de la misma ventana.
- Header y composer permanecen fijos dentro del panel.
- Solo el área de mensajes hace scroll interno.
- Al cambiar la lista de mensajes, el scroll baja al último mensaje.
- En móvil, la sidebar ocupa una franja superior y el chat queda debajo sin romper la altura.

Archivo principal:

```text
apps/web/src/pages/ChatPage.tsx
```

## Paso 18: Limpieza del contexto enviado a Gemini

Se mejoró el contexto que el backend envía a Gemini.

Problema:

- Gemini estaba recibiendo mensajes de error antiguos.
- También podía recibir respuestas AI vacías o incompletas.
- Eso contaminaba la respuesta, por ejemplo mencionando errores de desarrollo o peticiones repetidas como `otra`.

Cambios:

- Se excluyen mensajes sin contenido.
- Se excluyen mensajes `status: "error"`.
- Se excluyen mensajes `status: "streaming"`.
- Se excluyen mensajes `type: "system"`.
- Se limita el contexto útil a `GEMINI_HISTORY_LIMIT`.
- Se identifican participantes únicos.
- Se identifica el último mensaje de usuario.
- El prompt instruye a Gemini a ignorar errores técnicos previos y respuestas fallidas.
- Si la petición es vaga, Gemini debe hacer una pregunta breve de aclaración.

Archivo principal:

```text
apps/api/src/routes/ai.ts
```

Objetivo:

- Respuestas más limpias.
- Mejor demo.
- Menos contaminación por pruebas de desarrollo.
- Mejor atribución multiusuario.

## Paso 19: Logs de depuración para Gemini

Se añadió observabilidad controlada por variable de entorno:

```env
AI_DEBUG_LOGS=true
```

Cuando está activo, el backend escribe logs con prefijo:

```text
[ai-debug]
```

También escribe logs estructurados en JSON Lines en:

```text
logs/ai-debug.log
```

Información registrada:

- `orgId`
- `roomId`
- modelo usado
- si está en mock o Vertex real
- cantidad de mensajes crudos recibidos
- cantidad de mensajes útiles enviados al prompt
- participantes detectados
- último usuario que habló
- prompt final enviado a Gemini
- longitud de la respuesta final
- errores de Vertex/backend con status

Archivos:

```text
apps/api/src/routes/ai.ts
apps/api/src/server.ts
apps/api/.env
apps/api/.env.example
```

Nota:

- En local queda `AI_DEBUG_LOGS=true` para poder depurar.
- En producción debe ir `AI_DEBUG_LOGS=false` para no registrar conversaciones completas.
- `logs/` está en `.gitignore`.
- `/health` ahora muestra `ai.debugLogs`.

Para leer el log:

```powershell
Get-Content logs/ai-debug.log -Tail 20
```

## Paso 20: Comentarios orientativos en el código

Se añadieron comentarios naturales en inglés en las partes con más carga conceptual:

- Suscripciones Firestore del frontend.
- Boundary entre frontend y backend para llamadas a Vertex AI.
- Validación de Firebase Auth.
- Validación de membership de rooms.
- Construcción del contexto de Gemini.
- Streaming de Vertex AI hacia Firestore.
- Seed multi-tenant.
- Logging local de AI.

Objetivo:

- Ayudar a ubicarse rápido en el código.
- Explicar decisiones de arquitectura sin comentar lo obvio.
- Facilitar una revisión técnica del proyecto.

## Paso 21: Typing indicators

Se implementaron indicadores de escritura en tiempo real usando Firestore.

Comportamiento:

- Cuando un usuario escribe, se actualiza:

```text
organizations/{orgId}/rooms/{roomId}/typing/{uid}
```

- Otros usuarios de la room ven:

```text
Sarah is typing...
Sarah and Mike are typing...
Sarah, Mike and 2 others are typing...
```

- El indicador se apaga al enviar mensaje.
- También expira automáticamente tras unos segundos sin escribir.
- Las escrituras están throttled para evitar un write por tecla.

Archivo principal:

```text
apps/web/src/pages/ChatPage.tsx
```

Notas:

- Las reglas Firestore ya permiten leer typing solo a miembros de la room.
- Cada usuario solo puede escribir su propio documento `typing/{uid}`.

## Paso 22: Presence online real

Se implementó presencia real por room usando Firestore.

Comportamiento:

- Cuando un usuario entra en una room, escribe:

```text
organizations/{orgId}/rooms/{roomId}/presence/{uid}
```

- El documento incluye:

```text
displayName
isOnline
lastSeen
expiresAt
```

- Mientras el usuario sigue en la room, se refresca `expiresAt` periódicamente.
- Al cambiar de room o desmontar el componente, se marca `isOnline: false`.
- La UI muestra usuarios online reales en la sidebar.
- Se considera online a quien tenga `isOnline: true` y `expiresAt > now`.

Archivo principal:

```text
apps/web/src/pages/ChatPage.tsx
```

Nota técnica:

- Firestore no tiene `onDisconnect` de navegador como Realtime Database.
- Para esta prueba usamos heartbeat + expiración, suficiente para presencia visible y recuperación ante cierres inesperados.

## Paso 23: Timestamps visibles en mensajes

Se añadió la hora visible en cada mensaje del chat.

Requisito cubierto:

```text
Each message displays: Sender name, Timestamp, Message content
```

Comportamiento:

- Los mensajes muestran el nombre del sender.
- Junto al nombre aparece la hora local del mensaje.
- Si Firestore todavía no resolvió `serverTimestamp()`, se muestra `Sending...`.
- Soporta `Timestamp` de Firestore, `Date` y objetos serializados con `seconds`.

Archivo principal:

```text
apps/web/src/pages/ChatPage.tsx
```

## Paso 24: Gestion de salas y miembros para admins

Se añadio una primera capa de administracion de rooms desde el frontend.

Comportamiento:

- Solo los usuarios con rol `admin` ven acciones de administracion.
- Un admin puede crear una nueva room desde la sidebar.
- La creacion pide nombre, descripcion opcional y miembros iniciales.
- El admin actual queda incluido siempre para no crear rooms inaccesibles.
- Un admin puede abrir el panel `Members` de la room activa.
- Desde ese panel puede agregar o quitar miembros de la room.
- Al guardar, se actualiza `memberIds` en el documento de la room y los documentos `members/{uid}`.
- Los usuarios no seleccionados dejan de ver la room por la query `array-contains`.

Archivos:

```text
apps/web/src/pages/ChatPage.tsx
firestore.rules
```

Nota tecnica:

- Firestore sigue siendo la fuente de verdad.
- La UI solo muestra u oculta acciones para mejorar experiencia.
- La seguridad real se mantiene en `firestore.rules`, donde solo admins pueden crear/actualizar rooms y memberships.

## Paso 25: Indicadores de mensajes no leidos

Se añadieron unread indicators persistentes para la lista de rooms.

Comportamiento:

- Cada room escucha su ultimo mensaje con una query ligera `limit(1)`.
- Cada usuario guarda su propio estado de lectura en:

```text
organizations/{orgId}/rooms/{roomId}/readStates/{uid}
```

- Al abrir una room, se actualiza `lastReadAt` y `lastReadMessageId`.
- Si otra room recibe un mensaje posterior a `lastReadAt`, aparece una etiqueta `New` en la sidebar.
- Los mensajes enviados por el propio usuario no se marcan como no leidos.
- El estado sobrevive a recargas porque vive en Firestore, no solo en memoria del navegador.

Archivos:

```text
apps/web/src/pages/ChatPage.tsx
firestore.rules
```

Nota tecnica:

- Cada usuario solo puede leer y escribir su propio documento `readStates/{uid}`.
- La seguridad sigue dependiendo de `roomMember(orgId, roomId)`, por lo que usuarios fuera de la room no pueden leer ni modificar estados.

## Paso 26: Retry de Gemini y streaming mas visible

Se mejoro la experiencia cuando Gemini esta respondiendo o cuando falla.

Comportamiento:

- Mientras una respuesta AI esta en `status: "streaming"`, la UI muestra badge `Streaming`.
- Si el contenido aun esta vacio, se muestra `Gemini is reading the room...`.
- Durante streaming aparece un cursor animado para que el cambio incremental sea mas evidente.
- Si una respuesta AI queda en `status: "error"`, el mensaje cambia a estilo rojo y muestra badge `Failed`.
- El banner global de error tambien incluye un boton `Retry Gemini`.
- Cada mensaje AI fallido incluye su propio boton `Retry Gemini`.
- El retry vuelve a llamar al backend para generar una nueva respuesta con el contexto limpio actual.

Archivo principal:

```text
apps/web/src/pages/ChatPage.tsx
```

Nota tecnica:

- No se reescribe el mensaje fallido original; queda como evidencia del fallo.
- El retry crea una nueva respuesta AI, lo que evita mezclar estados viejos con una nueva ejecucion.

## Paso 27: Preparacion del backend para Cloud Run

Se preparo la API Node/Express para desplegarse como contenedor en Cloud Run.

Cambios:

- Se añadio `Dockerfile` en la raiz del monorepo.
- El Dockerfile compila `packages/shared` y `apps/api`.
- La imagen final ejecuta `node dist/server.js` desde `apps/api`.
- Se añadio `.dockerignore` para no copiar `node_modules`, builds locales, logs ni env files.
- Se añadio `apps/api/.env.production.example` con variables pensadas para Cloud Run.
- Se añadieron scripts raiz `build:api` y `start:api`.
- Se creo `docs/deploy-cloud-run.md` con comandos para Artifact Registry, Cloud Build y Cloud Run.

Variables relevantes para produccion:

```text
GOOGLE_CLOUD_PROJECT=multichat-ai-b5cea
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_MAX_OUTPUT_TOKENS=512
GEMINI_HISTORY_LIMIT=20
WEB_ORIGIN=https://multichat-ai-b5cea.web.app
MOCK_GEMINI=false
AI_DEBUG_LOGS=false
```

Archivos:

```text
Dockerfile
.dockerignore
apps/api/.env.production.example
docs/deploy-cloud-run.md
package.json
README.md
```

Nota tecnica:

- Cloud Run inyecta `PORT`, pero dejamos `PORT=8080` como valor compatible.
- En produccion `AI_DEBUG_LOGS=false` para no registrar conversaciones completas.
- El runtime de Cloud Run usara la service account del servicio para acceder a Vertex AI y Firestore.

## Paso 28: Deploy del backend y frontend

Se desplego la API en Cloud Run y el frontend en Firebase Hosting.

Backend:

- Cloud Build construyo la imagen Docker usando el `Dockerfile` de la raiz.
- La imagen se subio a Artifact Registry:

```text
us-central1-docker.pkg.dev/multichat-ai-b5cea/multichat/multichat-api:latest
```

- Cloud Run desplego el servicio:

```text
https://multichat-api-436954625005.us-central1.run.app
```

- `/health` respondio correctamente:

```json
{"ok":true,"ai":{"mock":false,"model":"gemini-2.5-flash-lite","debugLogs":false}}
```

Frontend:

- Se creo `apps/web/.env.production` local con:

```env
VITE_API_BASE_URL=https://multichat-api-436954625005.us-central1.run.app
```

- Se reconstruyo el frontend con Vite.
- Se verifico que el asset generado incluye la URL de Cloud Run.
- Se desplego Firebase Hosting.

URL publica:

```text
https://multichat-ai-b5cea.web.app
```

Archivos:

```text
apps/web/.env.production.example
.gitignore
README.md
docs/progreso.md
```

Nota tecnica:

- `.env.production` es local y no debe subirse.
- `.env.production.example` queda como referencia segura para documentar la variable requerida.

## Paso 29: README final de entrega

Se preparo la documentacion final para entregar la prueba tecnica.

Cambios:

- Se reescribio `README.md` como documento principal de entrega.
- El README ahora incluye URLs desplegadas, credenciales demo, stack, arquitectura, modelo Firestore, setup local, seed, flujo Gemini, deploy y notas de seguridad.
- Se preparo un checklist de requisitos para revision en chat, pero no se dejo como archivo en el repositorio para mantener la entrega mas limpia.

Archivos:

```text
README.md
docs/progreso.md
```

Estado estimado:

```text
95% completo para la evaluacion tecnica.
```

Pendiente opcional:

- Tests automatizados de reglas Firestore.
- Tests automatizados UI/login/chat.
- Revision de `npm audit`.

## Paso 30: Revision npm audit y optimizacion de bundle

Se reviso `npm audit` y se optimizo el bundle de produccion del frontend.

Cambios aplicados:

- Se actualizo `firebase-admin` de la linea 13 a `14.0.0`.
- Se cambio `firebaseAdmin.ts` a imports modulares de Firebase Admin:

```text
firebase-admin/app
firebase-admin/auth
firebase-admin/firestore
```

- Se actualizo `google-auth-library` a `10.7.0`.
- Se elimino `@google-cloud/vertexai` porque ya no se usa; el backend llama Vertex AI por REST.
- Se añadieron chunks manuales en Vite:

```text
firebase
react
icons
vendor
```

Resultado del build frontend:

```text
firebase: ~473.70 kB / gzip ~112.05 kB
react: ~194.01 kB / gzip ~60.52 kB
app: ~23.44 kB / gzip ~6.48 kB
```

Estado de `npm audit`:

- Se redujo y limpio lo que era seguro actualizar directamente.
- Quedan 5 vulnerabilidades moderadas transitivas asociadas a `@google-cloud/storage`.
- `@google-cloud/storage` llega por `firebase-admin`, pero esta app no usa Cloud Storage.
- Se probaron overrides, pero generaban un arbol npm `invalid`, por lo que se descartaron.

Validacion:

```powershell
npm.cmd run build:api
npm.cmd run build --workspace @multichat/web
```

Ambos comandos terminaron correctamente.
