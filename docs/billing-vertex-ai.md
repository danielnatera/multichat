# Billing y Vertex AI

Esta guía explica cómo activar Vertex AI real minimizando riesgo de coste.

## Estado actual

El proyecto usa dos modos:

```env
MOCK_GEMINI=true
```

Usa respuesta simulada. No llama a Vertex AI.

```env
MOCK_GEMINI=false
```

Usa Vertex AI Gemini real.

## Por qué hace falta billing

Vertex AI requiere una cuenta de facturación asociada para llamar a Gemini. Si billing está deshabilitado, el backend recibe:

```text
BILLING_DISABLED
```

Esto no significa que se cobre mucho automáticamente, pero sí habilita la posibilidad de cargos.

## Configuración de bajo coste

El backend está configurado con:

```env
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_MAX_OUTPUT_TOKENS=512
GEMINI_HISTORY_LIMIT=40
GEMINI_CONTEXT_CHAR_LIMIT=20000
```

Razón:

- `gemini-2.5-flash-lite` está orientado a baja latencia y coste.
- `GEMINI_MAX_OUTPUT_TOKENS=512` limita la longitud de cada respuesta.
- `GEMINI_HISTORY_LIMIT=40` limita la ventana a los últimos mensajes útiles.
- `GEMINI_CONTEXT_CHAR_LIMIT=20000` evita enviar conversaciones enormes al modelo.

## Antes de activar billing

Crear un presupuesto/alerta en Google Cloud Billing:

1. Ir a Google Cloud Console.
2. Abrir `Billing`.
3. Entrar en `Budgets & alerts`.
4. Crear un presupuesto bajo, por ejemplo 5 EUR/USD.
5. Añadir alertas al 50%, 90% y 100%.

Importante:

- Las alertas avisan, no bloquean automáticamente el gasto.
- Para esta prueba, mantener pocas llamadas manuales a `@Gemini`.

## Activar Vertex real

Después de activar billing y crear presupuesto:

1. Editar:

```text
apps/api/.env
```

2. Cambiar:

```env
MOCK_GEMINI=false
```

3. Reiniciar backend:

```powershell
npm.cmd run dev:api
```

4. Probar en el chat:

```text
@Gemini recomienda una estrategia de cache para nuestra API
```

## Volver a modo sin coste

Cambiar de nuevo:

```env
MOCK_GEMINI=true
```

Y reiniciar backend.
