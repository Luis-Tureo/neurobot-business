# Migración de Neurobot Business a Meta Cloud API

## Alcance

Neurobot Business utiliza WhatsApp Business Platform como canal oficial para conversaciones privadas. El repositorio `neurobot-community` no forma parte de esta migración y conserva su integración independiente para grupos.

Esta implementación no utiliza Meta Business Agent. La inteligencia, las reglas, el catálogo, la agenda y las automatizaciones continúan siendo administradas por Neurobot.

## Plan básico

El plan `BASIC` es la configuración predeterminada.

- El bot responde cuando el cliente inicia o continúa una conversación.
- Cada mensaje entrante del cliente abre o reinicia una ventana de atención de 24 horas.
- Los mensajes libres, menús y respuestas con IA solo pueden enviarse mientras la ventana está abierta.
- Cuando la ventana está cerrada, Neurobot bloquea el envío.
- Las plantillas comerciales están deshabilitadas, incluso si Meta ya las aprobó.
- El cliente no configura presupuestos, topes de gasto ni categorías cobrables desde el panel.

El bloqueo se aplica en el servidor, no solamente en la interfaz.

## Plan comercial avanzado

El plan `ADVANCED` se activa únicamente después de preparar y aceptar un presupuesto específico.

- Requiere `COMMERCIAL_PLAN=ADVANCED`.
- Requiere una referencia de presupuesto en `COMMERCIAL_QUOTE_REFERENCE`.
- Permite enviar plantillas que continúen con estado `APPROVED` en Meta.
- Incluye casos como seguimiento de pedidos, avisos de despacho, reprogramaciones y recordatorios de citas.
- Neurobot registra los mensajes de plantilla enviados y sus estados de entrega para preparar la facturación adicional al final del mes.
- El cliente no puede modificar límites ni fijar un presupuesto operativo desde su panel.

El valor de implementación, las automatizaciones incluidas y los cargos variables deben detallarse en la cotización entregada antes de activar el plan.

## Plantillas iniciales

La biblioteca incluye borradores de utilidad para:

### Reparto y entregas

- Pedido confirmado.
- Pedido despachado.
- Entrega reprogramada.

### Agenda de horas

- Hora confirmada.
- Recordatorio de hora.
- Hora reprogramada.

Los borradores deben enviarse a Meta y solo pueden utilizarse cuando Meta los apruebe. Cambiar de manera importante el propósito o el texto fijo puede requerir una plantilla nueva.

## Variables de configuración

```dotenv
META_GRAPH_API_VERSION=v25.0
META_PHONE_NUMBER_ID=
META_WABA_ID=
META_ACCESS_TOKEN=
META_WEBHOOK_VERIFY_TOKEN=
META_APP_SECRET=
META_BILLING_LEDGER_PATH=./data/meta-billing-events.jsonl

COMMERCIAL_PLAN=BASIC
COMMERCIAL_QUOTE_REFERENCE=
```

Para activar el plan avanzado:

```dotenv
COMMERCIAL_PLAN=ADVANCED
COMMERCIAL_QUOTE_REFERENCE=COT-2026-001
```

La aplicación rechaza la activación avanzada cuando no existe una referencia de presupuesto.

## Webhook

La ruta pública es:

```text
GET  /webhooks/meta/whatsapp
POST /webhooks/meta/whatsapp
```

- `GET` valida el token configurado en Meta.
- `POST` verifica `X-Hub-Signature-256` con `META_APP_SECRET` antes de procesar eventos.
- Los mensajes entrantes actualizan la ventana de atención.
- Los estados de mensajes de plantilla alimentan el registro mensual.

## Migración de instalaciones existentes

Al iniciar la nueva versión:

1. Se ejecutan las migraciones normales de SQLite.
2. Los asistentes Business existentes cambian a `WHATSAPP_CLOUD_API`.
3. Se desactivan las capacidades de grupos.
4. Los campos activos de sesión de WhatsApp Web dejan de utilizarse.
5. Los archivos antiguos de sesión no se borran automáticamente, para permitir recuperación manual durante la transición.

## Pendientes de la siguiente fase

- Pantalla visual de provisión para elegir plan al crear la instalación.
- Módulo visual para revisar borradores y estados de plantillas.
- Integración con el endpoint de administración de plantillas de Meta.
- Programación visual por eventos de pedido o por fecha de cita.
- Informe mensual descargable para incluirlo en la facturación.
- Eliminación definitiva del código y dependencias heredadas de WhatsApp Web después de completar la transición y las pruebas de producción.
