# Neurobot Business

Neurobot Business es un asistente para atención privada por WhatsApp que utiliza exclusivamente la API oficial de Meta, WhatsApp Cloud API.

La aplicación mantiene Node.js 24, TypeScript, Fastify, SQLite, Vitest y Groq. No usa navegadores, scraping, sesiones locales ni vinculación por código.

## Flujo

```text
WhatsApp del usuario
  -> Meta WhatsApp Cloud API
  -> POST /api/webhooks/meta/whatsapp
  -> capa de mensajería de Neurobot
  -> asistente seleccionado por phone_number_id
  -> reglas, historial, automatizaciones compatibles e IA/Groq
  -> Meta Graph API
  -> WhatsApp del usuario
```

El transporte de Meta está desacoplado del motor de conversación. Los mensajes entrantes se adaptan al contrato `IncomingMessage` existente y siguen el mismo flujo de perfiles, menús, conocimiento, historial, límites e IA.

## Requisitos

- Node.js 24 o posterior.
- npm 11 o posterior.
- Una aplicación de tipo Business en Meta Developers para producción.
- Una cuenta de WhatsApp Business (WABA) y un número registrado en Cloud API.

## Instalación local

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` crea o completa `.env` con secretos locales aleatorios para el panel. No genera credenciales de Meta.

En desarrollo se puede iniciar sin credenciales reales: el panel mostrará el conector como no configurado y no iniciará envíos a Meta. Las pruebas usan mocks y nunca requieren un token real.

## Despliegue en Azure for Students

La carpeta `infra/azure` contiene un despliegue reproducible para una VM Ubuntu 24.04 LTS con
Node.js 24, SQLite persistente en `/var/lib/neurobot`, Caddy con HTTPS automático, `systemd`,
UFW y una NSG que solo publica 80/443 y restringe SSH a la IPv4 del administrador.

El script falla antes de crear recursos si la suscripción activa no se llama exactamente
`Azure for Students`, el identificador de oferta no es estudiantil, el límite de gasto no está
activo, no puede comprobar el saldo o este no cubre la estimación minorista base de un mes. La selección
inicial es `Standard_B2ats_v2` en Chile Central y un único disco P6 Premium SSD LRS de 64 GiB.
La IPv4 pública Standard tiene un cargo nominal incluso cuando la VM y el disco están dentro de
las cantidades gratuitas. Más de 100 GB mensuales de salida, operaciones de disco fuera de la
franquicia y cualquier snapshot también consumirían crédito; el límite de gasto estudiantil sigue
siendo la barrera final.

Los secretos nunca se pasan a Bicep ni se guardan en el repositorio. Primero cree el archivo
externo y complete las credenciales de Meta y Groq en esa ruta:

```powershell
.\scripts\new-production-env.ps1 -Destination C:\ruta-segura\neurobot.production.env
```

Ejecute un preflight sin crear recursos:

```powershell
.\scripts\deploy-azure.ps1 `
  -SubscriptionId '<id-de-azure-for-students>' `
  -EnvironmentFile 'C:\ruta-segura\neurobot.production.env' `
  -SshPrivateKeyPath 'C:\ruta-segura\neurobot-azure'
```

Revise la estimación mostrada y agregue `-Apply` para crear, instalar, desplegar y verificar la
aplicación. Al terminar, el script muestra la URL HTTPS del panel y del webhook de Meta. También
comprueba `npm ci`, typecheck, lint, pruebas, build, salud del servicio, challenge del webhook y
persistencia de SQLite después de reiniciar `systemd`.

## Variables de entorno

| Variable | Obligatoria en producción | Secreta | Descripción |
| --- | --- | --- | --- |
| `NODE_ENV` | Sí | No | Use `production` en el despliegue. |
| `META_ACCESS_TOKEN` | Sí para la cuenta simple | Sí | Token permanente o de System User con permisos de WhatsApp. |
| `META_PHONE_NUMBER_ID` | Sí para la cuenta simple | No | ID del número de WhatsApp Business, no el número visible. |
| `META_WABA_ID` | Sí para la cuenta simple | No | ID de la cuenta de WhatsApp Business. |
| `META_APP_SECRET` | Sí | Sí | App Secret usado para validar `X-Hub-Signature-256`. |
| `META_WEBHOOK_VERIFY_TOKEN` | Sí | Sí | Valor aleatorio definido por el operador y registrado también en Meta. |
| `META_GRAPH_API_VERSION` | Sí | No | Versión configurable; el ejemplo usa `v25.0`. Confirme una versión soportada antes del despliegue. |
| `META_REQUEST_TIMEOUT_MS` | No | No | Timeout de Graph API; valor inicial `10000`. |
| `META_WHATSAPP_ACCOUNTS_JSON` | Solo para multibot | Sí | Lista JSON de cuentas por `botId`; reemplaza las tres variables simples de cuenta. |
| `ANONYMIZATION_SECRET` | Sí | Sí | HMAC para identificadores internos. |
| `PANEL_SESSION_SECRET` | Sí | Sí | Firma de sesiones del panel. |
| `PANEL_INITIAL_PASSWORD` | No | Sí | Contraseña inicial opcional del panel. |
| `APP_ENCRYPTION_KEY` | Según uso | Sí | Cifrado de credenciales de IA por asistente. |
| `GROQ_API_KEY` | Si Groq está habilitado | Sí | Clave global de Groq. |

Las variables generales del panel, base de datos, límites e IA se documentan en [`.env.example`](./.env.example).

### Configuración multibot

Para varios asistentes/números use una sola línea JSON:

```json
[
  {
    "botId": "mi-negocio",
    "accessToken": "token-ficticio-de-al-menos-20-caracteres",
    "phoneNumberId": "123456789012345",
    "wabaId": "987654321098765"
  }
]
```

Cada `phoneNumberId` debe ser único. SQLite también aplica esta restricción, y el webhook usa ese identificador para seleccionar el asistente correcto. El panel nunca devuelve tokens, App Secret ni verify token.

## Webhook de Meta

La ruta pública exacta es:

```text
/api/webhooks/meta/whatsapp
```

Después del despliegue en Azure, la callback URL tendrá esta forma:

```text
https://<host-publico-azure>/api/webhooks/meta/whatsapp
```

Debe ser HTTPS y accesible desde Internet.

### Verificación GET

Meta envía `hub.mode`, `hub.verify_token` y `hub.challenge`. Neurobot devuelve el challenge como texto solo cuando:

- `hub.mode=subscribe`;
- el token coincide mediante comparación segura con `META_WEBHOOK_VERIFY_TOKEN`.

### Eventos POST

Neurobot:

- conserva el cuerpo JSON original para validar `X-Hub-Signature-256` con HMAC-SHA256 y `META_APP_SECRET`;
- valida que el payload sea de `whatsapp_business_account`;
- extrae mensajes de texto, respuestas interactivas, remitente, receptor, ID y timestamp;
- registra estados `sent`, `delivered`, `read`, `failed` y `deleted`;
- ignora eventos irrelevantes y mensajes no soportados sin detener la aplicación;
- persiste un hash del ID de evento antes de responder, para deduplicar reintentos;
- responde `200` al evento válido y procesa el chatbot de forma asíncrona.

Los errores internos posteriores al acuse se registran de forma segura y no cambian la respuesta ya enviada a Meta.

## Envío a Graph API

Las respuestas de texto se envían a:

```text
POST https://graph.facebook.com/<VERSION>/<PHONE_NUMBER_ID>/messages
```

El adaptador admite texto, respuestas a mensajes, botones, listas y plantillas que ya utilice el flujo comercial. Maneja timeouts, fallos de red, HTTP no exitoso y objetos `error` de Graph API sin registrar credenciales ni el cuerpo sensible devuelto por Meta.

## Pasos manuales posteriores en Meta Developers

1. Cree o seleccione una aplicación Business y agregue el producto WhatsApp.
2. Vincule la WABA que se usará en producción.
3. Agregue y verifique el número empresarial; obtenga su Phone Number ID y el WABA ID.
4. Cree un System User y genere un token permanente con los permisos que Meta exija para administrar y enviar mensajes de WhatsApp, normalmente `whatsapp_business_messaging` y `whatsapp_business_management`.
5. Copie el App Secret de la aplicación.
6. Genere usted mismo un verify token aleatorio y largo.
7. En Webhooks del producto WhatsApp, registre la callback URL HTTPS y el mismo verify token.
8. Suscriba el campo `messages` para recibir mensajes y estados.
9. Suscriba la aplicación a la WABA si Meta no lo hizo automáticamente.
10. Complete la verificación comercial, método de pago y plantillas aprobadas que requiera su caso de uso.
11. Pruebe recepción, respuesta y estados con un número autorizado antes de habilitar tráfico real.

Las pantallas y requisitos de Meta cambian con el tiempo. Use como referencia primaria la [documentación de WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/) y la [colección oficial de Meta en Postman](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Validación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

También puede ejecutar todo en secuencia con:

```bash
npm run check
```

## Estado de la migración

La aplicación no incluye `whatsapp-web.js`, Puppeteer, Chromium, LocalAuth, generación de códigos de vinculación, perfiles de navegador ni sesiones locales de WhatsApp. No existe fallback silencioso a transportes no oficiales.

Los recursos Azure se crean únicamente al ejecutar `scripts/deploy-azure.ps1` con `-Apply`;
el preflight documentado no crea recursos.
