# WhatsApp Prospecting Dashboard + Chrome Extension (MV3)

Proyecto con dos piezas conectadas:

1. Dashboard web (React + Tailwind + shadcn) para crear campañas.
2. Extensión de Chrome (Manifest V3) para ejecutar campañas en `web.whatsapp.com`.

## 1) Dashboard web (frontend)

### Ejecutar local

```bash
npm install
npm run dev
```

### Flujo

1. Carga contactos (CSV o texto pegado).
2. Crea variaciones de mensajes.
3. Ajusta parámetros (`mode`, `delay`, `sessionLimit`, `autoRetry`, `variationMode`, `variationEvery`).
4. En Monitor: pulsa **Exportar Config** para descargar el JSON.

## 2) Extensión de Chrome (MV3)

La extensión está en la carpeta `extension/`:

- `manifest.json`
- `popup.html`, `popup.css`, `popup.js`
- `background.js` (motor de campaña)
- `content.js` (interacción con WhatsApp Web)

### Cargar extensión

1. Abre `chrome://extensions`.
2. Activa **Modo desarrollador**.
3. Genera la UI interna de extensión:

```bash
npm run build:extension-ui
```

4. Click en **Load unpacked**.
5. Selecciona la carpeta `extension`.
6. Haz click en el ícono de la extensión: abrirá un popup con el dashboard estilo Lovable (Paso 1 por defecto).

### Uso

1. Abre `https://web.whatsapp.com/` y asegúrate de haber iniciado sesión.
2. Abre el popup de la extensión.
3. Pega o carga el JSON exportado desde el dashboard.
4. Click en **Guardar configuración**.
5. Click en **Iniciar**.

El flujo principal usa popup de extensión con la línea de tiempo superior (Base de Datos, Mensajes, Parámetros, Monitor), manteniendo el diseño oscuro profesional.

Controles disponibles:

- `Iniciar`
- `Pausar`
- `Reanudar`
- `Detener`

KPIs disponibles:

- Enviados
- Pendientes
- Fallidos

## Formato JSON esperado

```json
{
  "schemaVersion": 1,
  "contacts": [
    { "phone": "51999999999", "name": "Juan", "business": "Cafe Central", "location": "Lima" }
  ],
  "messages": [
    { "label": "Variación A", "content": "Hola [Nombre], te escribo por [Negocio] en [Ubicación]." }
  ],
  "params": {
    "mode": "human",
    "delay": 20,
    "sessionLimit": 100,
    "autoRetry": true,
    "variationEvery": 1,
    "variationMode": "sequential"
  }
}
```

Variables soportadas en mensajes:

- `[Nombre]`
- `[Negocio]`
- `[Ubicación]`
- `[Telefono]`

## Notas importantes

- Usa solo contactos con consentimiento explícito.
- Respeta normativas locales (protección de datos y anti-spam).
- WhatsApp Web cambia su DOM con frecuencia: si cambia el selector del botón de enviar, hay que actualizar `extension/content.js`.
