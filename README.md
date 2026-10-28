# Panel de infraestructura

Un solo panel para ver el estado, **uso de recursos y límites de plan gratuito** de tus proyectos en Vercel, Railway, Supabase, Neon y Cloudflare, aunque estén en cuentas distintas. Funciona con **tokens de API**, no con sesiones de Google: cada cuenta es una entrada en `ACCOUNTS_JSON`.

## 1. Crear un token por cada cuenta (todos gratuitos)

Crea tokens de solo lectura cuando la plataforma lo permita. Aquí tienes los enlaces directos a cada panel:

- **Supabase:** [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) (`https://supabase.com/dashboard/account/tokens`) → *Generate new token*.
- **Neon:** [Account settings → API keys](https://console.neon.tech/app/settings/api-keys) (`https://console.neon.tech/app/settings/api-keys`) → *Create new API key*.
- **Vercel:** [Account Settings → Tokens](https://vercel.com/account/tokens) (`https://vercel.com/account/tokens`) → *Create* (Scope: *Full Account*).
- **Railway:** [Account Settings → Tokens](https://railway.com/account/tokens) (`https://railway.com/account/tokens`) → Crea un token general de cuenta o workspace (no de proyecto individual).
- **Cloudflare:** [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) (`https://dash.cloudflare.com/profile/api-tokens`) → *Create Custom Token* con permisos de lectura (`Read`) en `Account Settings`, `Workers Scripts`, `Cloudflare Pages`, `D1` y **`Account Analytics`**.

| Plataforma | Dónde crearlo | Notas y permisos recomendados |
|---|---|---|
| Vercel | [vercel.com/account/tokens](https://vercel.com/account/tokens) | Si tienes equipos o cuenta Hobby (Default Team), puedes usar Full Account o el scope del equipo |
| Railway | [railway.com/account/tokens](https://railway.com/account/tokens) | Usa un token de cuenta o de workspace. Un token de proyecto no puede listar proyectos |
| Supabase | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) | Token personal; ve todos los proyectos y la salud de sus subsistemas (`db`, `auth`, `rest`, `storage`) |
| Neon | [console.neon.tech/app/settings/api-keys](https://console.neon.tech/app/settings/api-keys) | Sirve tanto API key personal como de organización |
| Cloudflare | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) | Permisos de lectura: `Account Settings`, `Workers Scripts`, `Cloudflare Pages`, `D1` y **`Account Analytics`** (para medir peticiones/errores diarios de Workers) |

## 2. Configurar

```bash
cp .env.example .env.local
# edita .env.local con tu contraseña y tus cuentas
npm install
npm run dev
```

Abre http://localhost:3000. El navegador pedirá usuario (el que quieras) y la contraseña de `DASHBOARD_PASSWORD`.

`ACCOUNTS_JSON` es una lista con una entrada por cuenta. Puedes repetir la plataforma si tienes varias cuentas:

```json
[
  { "platform": "vercel", "label": "personal", "token": "..." },
  { "platform": "vercel", "label": "trabajo",  "token": "..." },
  { "platform": "neon",   "label": "personal", "token": "..." }
]
```

## 3. Desplegar

Súbelo a un repo privado e impórtalo en Vercel. Agrega `DASHBOARD_PASSWORD` y `ACCOUNTS_JSON`
como variables de entorno del proyecto (en una sola línea). Los tokens solo se usan en el servidor.

## Qué mide cada plataforma y límites de Plan Gratis (Free Tier)

El panel incluye una columna **Uso / Cuota Free** con barras de progreso y cambia automáticamente el estado a **Alerta cuota/salud** cuando un recurso supera el 85% de su cuota gratuita:

- **Vercel (Plan Hobby)**:
  - Estado del último deploy de producción (y aviso si el último intento falló aunque producción siga activa).
  - **Cuota Free**: Deploys realizados en las últimas 24h frente al límite de **100 deploys/día** por cuenta.
  - Deduplicación automática entre el scope personal y el *Default Team* de cuentas Hobby.
- **Railway (Trial / Hobby)**:
  - Estado del último deploy activo de cada servicio (ignorando deploys `SKIPPED` o `REMOVED`) y detección automática de bases de datos (PostgreSQL, Redis, MySQL, MongoDB).
  - **Cuota Free/Hobby**: Gasto estimado del proyecto en el ciclo actual frente al crédito de **$5.00 USD** (si el token tiene acceso a `estimatedUsage`).
- **Supabase (Plan Free)**:
  - Estado del proyecto, versión de Postgres y verificación en tiempo real del endpoint `/health` para los subsistemas internos (`db`, `auth`, `rest`, `storage`).
  - **Cuota Free**: Proyectos activos en la cuenta frente al límite de **2 proyectos activos** del plan gratuito.
- **Neon (Plan Free)**:
  - Estado de los compute endpoints (`active` o `idle` scale-to-zero) sin despertarlos.
  - **Cuotas Free**:
    - Almacenamiento lógico usado frente al límite de **512 MB** (`branch_logical_size_limit_bytes`).
    - Tiempo de cómputo consumido en el mes frente al límite de **191.9 CU-horas/mes**.
    - Transferencia de datos (egress) frente a **5 GB/mes**.
- **Cloudflare (Plan Free)**:
  - **Pages**: Estado del último deploy.
  - **Workers**: Peticiones y tasa de errores del día actual (UTC) vía GraphQL Analytics frente al límite gratuito de **100,000 peticiones/día**.
  - **D1**: Número de tablas y tamaño de la base de datos frente al límite gratuito de **500 MB por base D1**.

## Optimizaciones para correr el propio panel en Plan Gratis

- **Timeout seguro para Vercel Hobby**: Cada llamada HTTP tiene un límite de `6.5s` (`lib/http.ts`) para evitar que una plataforma lenta provoque el corte de `10s` (`504 FUNCTION_INVOCATION_TIMEOUT`) de las Serverless Functions gratuitas de Vercel.
- **Caché de 30s (`revalidate: 30`)**: Evita saturar los *rate limits* de las APIs gratuitas cuando recargas la página o abres el panel en varios dispositivos.
- **Auto-refresh inteligente (`app/auto-refresh.tsx`)**: Refresca cada 120 segundos **únicamente si la pestaña está visible**, ahorrando más del 80% de invocaciones Serverless cuando dejas el navegador abierto en segundo plano.

## Seguridad

- Este panel concentra tus tokens: usa una contraseña larga y mantén el repo privado.
- Soporta contraseñas UTF-8 y comparación en tiempo constante (`safeEqual`) en `lib/auth.ts`.
- No subas `.env.local` a Git (ya está en `.gitignore`).
- La página no registra ni muestra tokens; los errores solo incluyen el código HTTP y el host.

## Agregar otra plataforma

1. Crea `lib/connectors/<nombre>.ts` con una función `(account) => Promise<Item[]>`.
2. Súmala al tipo `Platform` en `lib/types.ts` y al objeto `CONNECTORS` en `lib/connectors/index.ts`.
3. Agrega su nombre en `PLATFORMS` de `app/page.tsx`.
