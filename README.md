# Peluquería

Aplicación móvil (iOS/Android) para administrar citas y clientes, con página web pública de reservas por enlace. La primera configuración está pensada para un negocio con un solo prestador.

## Arquitectura

- **App y página web:** Expo, React Native, TypeScript y Expo Router.
- **Backend:** Supabase Auth y PostgreSQL.
- **Persistencia:** negocio, servicios, horarios, clientes y citas compartidos en la nube.
- **Acceso:** cada cuenta administra un negocio. Row Level Security (RLS) limita la app a los datos de su dueño. Los clientes reservan mediante funciones SQL públicas limitadas al slug, sin permisos para consultar las tablas ni listar negocios.
- **Disponibilidad:** PostgreSQL calcula horarios y serializa las solicitudes por negocio y día antes de revisar traslapes e insertar la cita. Esto evita depender únicamente de validaciones del teléfono.

## Conectar un proyecto Supabase de prueba

1. Crea un proyecto nuevo en [Supabase](https://supabase.com/dashboard) y espera a que termine de inicializar.
2. En **Project Settings → API**, copia la **Project URL** y la clave **publishable** (o la clave `anon` heredada).
3. En la carpeta `app`, copia `.env.example` a `.env` y reemplaza los valores:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
   EXPO_PUBLIC_APP_URL=
   ```

   La clave publicable/anon está diseñada para estar en la app; **nunca uses `service_role` o una clave `sb_secret_` en ella**. `.env` está ignorado por Git.

4. En el **SQL Editor** de Supabase, abre y ejecuta una sola vez [`app/supabase/migrations/202610190001_initial_cloud_mvp.sql`](./app/supabase/migrations/202610190001_initial_cloud_mvp.sql).
5. Para pruebas rápidas, en **Authentication → Providers → Email**, desactiva temporalmente **Confirm email**. En producción se debe volver a activar y configurar el proveedor de correo.
6. Inicia la aplicación desde `app`:

   ```bash
   npm install
   npx expo start --web --port 8081 --clear
   ```

   Abre `http://localhost:8081`, crea una cuenta con un slug único, por ejemplo `barberia-andres`, y luego agrega los servicios en **Ajustes**. No hay datos de muestra en las cuentas cloud.

La app crea el perfil del negocio automáticamente al registrar la cuenta. Los horarios iniciales son 09:00–19:00 y domingo cerrado. Para probar la página de clientes, abre `http://localhost:8081/reservar/barberia-andres`; las citas que se soliciten aparecerán en la agenda y el cliente quedará asociado a ese negocio.

## Probar desde otro dispositivo

Para pruebas temporales en otro dispositivo, la computadora y el teléfono deben compartir una red y el servidor Expo debe ser accesible desde esa red. También puedes iniciar Expo con `npx expo start --tunnel` y usar el enlace de prueba que genera. Para probar **la reserva pública en otro dispositivo**, la página web necesita una URL accesible desde ese dispositivo; `localhost` solo funciona en la computadora que ejecuta Expo.

Después de desplegar la web en un hosting HTTPS, configura `EXPO_PUBLIC_APP_URL` con el dominio, por ejemplo `https://reservas-ejemplo.vercel.app`, y reinicia/reconstruye Expo. El enlace del negocio tendrá esta forma: `https://reservas-ejemplo.vercel.app/reservar/barberia-andres`.

### Publicar la web en Vercel

1. Sube el repositorio a GitHub. Confirma que `app/.env` no esté incluido; ese archivo contiene credenciales y está excluido por Git.
2. En Vercel, importa el repositorio y configura **Root Directory** como `app`.
3. Usa `npm run build:web` como comando de compilación y `dist` como directorio de salida.
4. Configura las siguientes variables de entorno en Vercel para los entornos que vayas a probar:
   - `EXPO_PUBLIC_SUPABASE_URL`: URL del proyecto Supabase.
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: clave publicable o `anon` del proyecto. Nunca uses `service_role` ni una clave `sb_secret`.
   - `EXPO_PUBLIC_APP_URL`: dominio HTTPS asignado por Vercel, por ejemplo `https://reservas-ejemplo.vercel.app`, sin `/` final.
5. Despliega. `app/vercel.json` permite que las rutas web se abran directamente, incluida `/reservar/slug-del-negocio`.
6. En Supabase, abre **Authentication → URL Configuration**. Configura el dominio HTTPS de Vercel como **Site URL** y agrégalo a **Redirect URLs** para que el enlace de confirmación de correo vuelva a la app.
7. Comparte el enlace privado de reservas desde **Ajustes** con los clientes del negocio.

Para revisar la compilación web localmente, ejecuta desde `app`:

```powershell
npm run build:web
```

El sitio resultante se genera en `app/dist`. Después de cambiar variables de entorno en Vercel, vuelve a desplegar para que se incorporen a la compilación.

## Rutas y archivos principales

- `app/app/index.tsx`: acceso y registro del dueño.
- `app/app/(tabs)/index.tsx`: agenda diaria/semanal y administración de citas.
- `app/app/(tabs)/two.tsx`: cartera e historial de clientes.
- `app/app/(tabs)/settings.tsx`: perfil, servicios, horarios, enlace y cierre de sesión.
- `app/app/reservar/[slug].tsx`: página pública de reservas.
- `app/lib/auth.tsx`, `app/lib/supabase.ts`: autenticación y cliente de Supabase.
- `app/lib/store.tsx`: carga y operaciones de datos cloud del dueño.
- `app/supabase/migrations/`: tablas, índices, permisos RLS y funciones SQL de reservas.
- `app/components/ui.tsx`: componentes visuales compartidos.

## Seguridad y límites de esta versión

- Las cuentas son de dueño único; no se implementan todavía recepcionistas ni varios prestadores.
- El enlace de reserva no aparece en un directorio, pero es accesible para cualquiera que lo reciba.
- Las solicitudes públicas no requieren cuenta y no se han agregado CAPTCHA ni límites de tráfico. Antes de anunciar el enlace públicamente, añade protección contra abuso y monitoreo.
- La autenticación por correo y los dominios permitidos de redirección deben configurarse para producción.
- No hay correo automático de confirmación, recordatorios, cambios ni cancelación por parte del cliente.
- Revisar la URL pública del proyecto Supabase, backups y políticas antes de cargar datos personales reales.

## Publicar la app móvil

Después de validar el backend y desplegar la web de reservas, compila las apps con **EAS Build**. La compilación local de iOS requiere macOS; EAS permite compilar iOS y Android en la nube. Configura los identificadores y credenciales de Apple/Google antes de distribuir a las tiendas o a testers.
