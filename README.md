# Neurobot Business

Aplicación local para administrar asistentes de WhatsApp orientados exclusivamente a pequeños y medianos negocios. El asistente atiende consultas privadas de clientes, entrega información oficial del negocio, muestra productos o servicios, responde preguntas frecuentes y registra solicitudes que deben continuar con una persona.

Este repositorio es independiente de `asistente-comunidad-neurodivergente`. No debe compartir con esa aplicación sesiones de WhatsApp, bases de datos, perfiles de Chromium, caché, archivos `.env` ni puertos.

## Alcance

Neurobot Business está diseñado para conversaciones privadas entre el número del negocio y sus clientes.

Incluye:

- conexión de un número de WhatsApp mediante `whatsapp-web.js`;
- panel administrativo local protegido por contraseña;
- menú inicial y submenús configurables;
- productos, servicios, categorías, precios e imágenes;
- horarios, dirección, medios de pago, despachos y datos de contacto;
- preguntas frecuentes y base de conocimiento del negocio;
- respuestas guardadas para reducir consultas repetidas a la IA;
- integración opcional con Groq;
- registro y seguimiento de solicitudes de atención humana;
- sesiones, datos y configuración aislados por asistente;
- SQLite como base de datos local.

No forman parte de esta aplicación:

- administración de grupos o comunidades;
- bienvenida a integrantes de grupos;
- encuestas comunitarias;
- reglas o moderación de grupos;
- activación mediante menciones dentro de grupos;
- mensajes programados para comunidades.

Los mensajes cuyo origen sea un grupo de WhatsApp deben ignorarse y no deben activar respuestas comerciales.

## Atención automática y humana

El bot puede responder información confirmada sobre productos, servicios, precios, horarios, dirección, pagos, despachos y otras materias configuradas por el negocio.

Cuando una solicitud requiere una decisión humana —por ejemplo, reclamos, devoluciones, problemas de pago, cotizaciones especiales, negociación, disponibilidad no confirmada o una petición explícita de hablar con una persona— el asistente debe:

1. informar al cliente que su solicitud será revisada;
2. registrar una solicitud pendiente;
3. evitar inventar una solución o autorización;
4. dejar el caso visible en el panel para que una persona continúe la atención.

## Tecnologías

- Node.js y TypeScript
- Fastify
- `whatsapp-web.js`
- Puppeteer/Chromium
- SQLite con `better-sqlite3`
- Vitest
- ESLint y Prettier

## Requisitos

- Windows 10 u 11
- PowerShell
- Node.js 24 o posterior
- npm 11 o posterior
- un número de WhatsApp destinado al asistente

## Instalación

Desde PowerShell, dentro de la carpeta del proyecto:

```powershell
npm install
npm run setup
npm run db:init
```

`npm run setup` crea o repara el archivo `.env` local y genera secretos aleatorios cuando faltan. Los comandos `npm run dev`, `npm run dev:watch` y `npm start` ejecutan esta preparación automáticamente antes de iniciar la aplicación.

## Configuración

Copie `.env.example` como `.env` o ejecute `npm run setup`.

Variables principales:

- `PANEL_HOST`: interfaz de escucha; por seguridad debe permanecer en `127.0.0.1` cuando el panel sea local.
- `PANEL_PORT`: puerto del panel. El valor recomendado para esta aplicación es `3001`.
- `DATABASE_PATH`: base de datos SQLite exclusiva de Neurobot Business.
- `WHATSAPP_SESSION_PATH`: sesión exclusiva del número empresarial.
- `ANONYMIZATION_SECRET`: secreto para identificadores anónimos.
- `PANEL_SESSION_SECRET`: secreto para sesiones del panel.
- `PANEL_INITIAL_PASSWORD`: contraseña inicial opcional.
- `CHROME_EXECUTABLE_PATH`: ruta opcional de Chrome; normalmente puede quedar vacía.
- `AI_PROVIDER`, `GROQ_API_KEY` y `GROQ_MODEL`: configuración opcional de inteligencia artificial.
- `APP_ENCRYPTION_KEY`: clave usada para cifrar credenciales configuradas desde el panel.

Nunca suba a GitHub:

- `.env`;
- claves de API o contraseñas;
- bases de datos reales;
- sesiones de WhatsApp;
- perfiles de Chromium o Puppeteer;
- registros de clientes;
- archivos de caché o logs.

## Ejecución

Desarrollo:

```powershell
npm run dev
```

Producción local:

```powershell
npm run build
npm start
```

Con la configuración predeterminada, el panel queda disponible en:

```text
http://127.0.0.1:3001
```

Si el navegador conserva una versión anterior del panel, cierre esa pestaña y vuelva a abrir la dirección anterior. No debería ser necesario usar `Ctrl + F5` después de reiniciar el servidor.

## Comandos de validación

Ejecute la validación completa antes de publicar cambios:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

También puede ejecutar:

```powershell
npm run check
```

No se considera válida una corrección que dependa de `@ts-ignore`, módulos ficticios, archivos excluidos artificialmente o scripts que comenten errores de TypeScript.

## Estructura principal

```text
src/        backend, lógica del asistente y persistencia
public/     panel administrativo
scripts/    instalación, inicialización y utilidades operativas
tests/      pruebas automatizadas
data/       estado local ignorado por Git
```

## Aislamiento respecto del asistente comunitario

Neurobot Business debe utilizar recursos propios:

- puerto predeterminado `3001`;
- base de datos empresarial;
- directorio de sesión de WhatsApp empresarial;
- caché y perfil del navegador propios;
- logs y archivos temporales propios.

No debe importar archivos desde el repositorio comunitario ni usar enlaces simbólicos, rutas absolutas o una base de datos compartida.

## Seguridad y limitaciones

`whatsapp-web.js` utiliza una integración no oficial con WhatsApp Web. Los cambios de WhatsApp pueden invalidar sesiones o afectar el funcionamiento. Se recomienda utilizar un número exclusivo, evitar envíos masivos y probar las actualizaciones antes de usarlas con clientes reales.

La IA es opcional y solo debe responder usando información oficial configurada. No debe inventar precios, stock, reservas, devoluciones, autorizaciones ni decisiones del negocio.

## Repositorio comunitario

La aplicación para comunidades se mantiene por separado en:

`Luis-Tureo/asistente-comunidad-neurodivergente`

Las funciones comunitarias deben desarrollarse únicamente en ese repositorio.

## Licencia

Proyecto privado de uso comercial. `UNLICENSED`; todos los derechos reservados.
