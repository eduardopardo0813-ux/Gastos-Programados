# Control de Pagos

App de control de pagos, gastos y ahorro. Sin build, sin dependencias, sin
frameworks: HTML + CSS + JavaScript con módulos ES nativos.

## Cómo correrla en desarrollo

Los módulos ES (`<script type="module">`) no funcionan si abres `index.html`
directamente con `file://`. Sirve la carpeta con un servidor local, por ejemplo:

- Extensión **Live Server** de VS Code (clic derecho sobre `index.html` → "Open with Live Server"), o
- `python3 -m http.server` desde esta carpeta y abrir `http://localhost:8000`.

Todos los datos se guardan solo en `localStorage` del navegador — no hay backend.

## Estructura

```
/
├── index.html              # estructura HTML, sin CSS ni JS inline
├── css/
│   ├── base.css            # variables, reset, tipografía
│   ├── layout.css          # navegación, paneles, grillas, responsive
│   └── components.css      # tarjetas, botones, barras, modales, hojas
├── js/
│   ├── store.js            # carga/guardado, migraciones, estado global
│   ├── utils.js            # fechas, moneda, escapeHtml, uid, toast, modal
│   ├── daily.js            # gastos diarios: registro, últimos registros, vista del mes
│   ├── scheduled.js        # gastos programados (fijos/variables) y motor de ocurrencias
│   ├── debts.js             # deudas
│   ├── savings.js          # metas de ahorro
│   ├── calendar.js         # vistas mensual y semanal
│   ├── categories.js       # categorías y presupuestos
│   ├── backup.js           # exportar/importar JSON y CSV, impresión
│   ├── ai.js               # conexión con Gemini: clave de API, prueba de conexión
│   ├── chat.js             # asistente financiero: preguntas + registro de gastos por texto
│   └── app.js               # init, navegación, orquestación de renders
└── README.md
```

## Navegación (v2)

5 secciones: Inicio, Programados, Ahorro y deudas, Categorías, Ajustes.
En móvil (≤720px) la navegación es una barra fija abajo; en escritorio
(>720px) vuelve a ser una fila de pestañas arriba. "Programados" agrupa
Gastos + Calendario en sub-pestañas; "Ahorro y deudas" agrupa Ahorro + Deudas
en sub-pestañas, cada una con su propio acento de color.

## Gastos diarios (v2)

En Inicio: resumen del mes ("Gastado este mes" / "Pendiente por pagar"),
barra segmentada de gasto por categoría con toggle "Solo diarios / Todo el
mes" (preferencia persistente) y leyenda clicable que filtra "Últimos
registros", la grilla de registro rápido (2 toques + monto, hoja inferior en
móvil / modal centrado en escritorio), y un enlace a la vista completa del
mes con búsqueda y filtros. Debajo, separados visualmente, los pagos
programados (semáforo) y los tres gráficos resumen.

En modo "Todo el mes" (por defecto), los segmentos que incluyen pagos
programados ya pagados este mes llevan un rayado diagonal para
distinguirlos del gasto diario dentro de la misma categoría. Las cuotas de
deuda y aportes de ahorro (que no tienen categoría propia) se agrupan como
"💳 Deuda" y "🐷 Ahorro" con sus colores ya usados en el resto de la app.
"Gastado este mes" usa siempre el mismo cálculo que la barra de abajo (según
el modo elegido), para que las dos cifras nunca se contradigan.

## Editar categorías (v2)

En Categorías, el botón ✎ de cada fila abre el mismo formulario de arriba en
modo edición (nombre y color), igual que ya funciona para editar un gasto,
una meta de ahorro o una deuda.

## Presupuestos por categoría (v2)

En Categorías, cada categoría tiene un botón 💰 para definir su presupuesto
mensual (o quitarlo). La fila de la categoría muestra por separado sus
gastos programados y sus registros diarios de este mes (cada uno con su
propio conteo y total), y el estado del presupuesto si tiene uno. En Inicio,
la tarjeta de esa categoría en el registro rápido muestra una mini barra de
progreso (gastado diario / presupuesto), con el color normal hasta 80%,
`--warning` entre 80–100% y `--critical` por encima de 100% (mostrando
"Te pasaste $X").

Exportar/importar (JSON y CSV) e imprimir/PDF ya incluyen los gastos
diarios: en el CSV como filas con Frecuencia "Diario" (Nombre = nota
opcional, FechaLimite = fecha del gasto), y en el reporte imprimible como
una tabla aparte "Gastos diarios de este mes" con su propio total, sin
mezclarse con los totales de pagos programados.

Con esto quedan implementadas las 4 fases de `arquitectura-v2-control-de-pagos.md`.

## IA con Gemini (clave por usuario)

Al final de Ajustes hay una tarjeta para conectar una clave de API de Google
Gemini (gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey)).
Cada persona que abra la app pega **su propia clave** — nunca la del
desarrollador — y queda guardada solo en el `localStorage` de su navegador,
en una llave separada del resto de los datos (`js/ai.js`, no `js/store.js`),
a propósito para que **nunca quede incluida en las copias de seguridad
JSON/CSV** que alguien exporte o comparta. "Probar conexión" hace una
llamada real y gratuita (lista de modelos, no genera contenido) para
confirmar que la clave funciona.

## Asistente financiero (chat)

Botón flotante 🤖 visible en cualquier pantalla (arriba de la barra de
navegación en móvil). Abre un chat que ve **todo el historial guardado**
(categorías, gastos diarios, programados, deudas, ahorro — reconstruido
desde los datos actuales en cada pregunta, así que nunca queda desactualizado
a mitad de la conversación) para responder preguntas sobre tus finanzas.

También puede proponer registrar un gasto diario a partir de una frase
("gasté 15 mil en el mercado hoy"), pero **nunca lo guarda solo**: muestra
una tarjeta con el monto, la categoría y la fecha que entendió, y el usuario
tiene que tocar "Confirmar" — reutiliza exactamente la misma validación que
la hoja de registro manual (`registrarGastoDiario` en `js/daily.js`), así
que las dos vías respetan las mismas reglas. Si la categoría que menciona no
existe, la crea igual que ya hace la importación de CSV (`resolverOCrearCategoriaPorNombre`
en `js/categories.js`).

La conversación vive solo en memoria (se reinicia al recargar la página) y
requiere tener guardada una clave de Gemini en Ajustes. Cada pregunta envía
tus datos financieros a la API de Google junto con tu clave — vale la pena
tenerlo presente.
