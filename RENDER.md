# Tu servicio personal en Render Free

Repositorio: https://github.com/brunnnno/steam-farmer
Panel: https://steam-farmer-f99k.onrender.com/
Monitor: https://steam-farmer-f99k.onrender.com/healthz

## Antes de fusionar los cambios y desplegar

En Render → tu Web Service → Environment, agregá:

- **STEAM_REFRESH_TOKEN**: tu token de cliente Steam. Se configura en Render; no se publica en el código, en GitHub ni en el navegador. La cuenta principal lo utiliza en cada arranque. Usá una sesión nueva si revocaste la que se compartió anteriormente.
- **PANEL_PASSWORD**: una contraseña privada de al menos 12 caracteres para entrar a tu panel. No es la contraseña Steam. Conserva el acceso al panel después de reinicios que borren los archivos temporales. Se utiliza al inicializar los datos; para cambiarla con datos existentes usá el panel. En Free se vuelve a aplicar el valor de Environment cuando se pierden esos datos.

El programa detecta Render y usa `0.0.0.0`, `PORT` y su URL HTTPS automáticamente. Si usás dominio personalizado, agregá PUBLIC_ORIGIN con ese origen HTTPS. STEAM_ACCOUNT_ID es opcional y vale main por defecto.

En Settings:

- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/healthz`
- Node.js: 22 o superior.

Después del despliegue abrí tu URL y entrá con PANEL_PASSWORD. La cuenta principal se conectará automáticamente con el token de Environment. Conservamos tu lista de juegos en config.json sin incluir secretos.

En UptimeRobot configurá el monitor HTTP(S) para https://steam-farmer-f99k.onrender.com/healthz. Esa ruta acepta GET/HEAD y muestra solo el estado del servidor web, sin exponer cuentas ni comprobar conexión Steam. `/api/status` ahora requiere sesión.

## Qué queda guardado y qué no

El token en Environment sobrevive a reinicios y despliegues de Render. No significa que dure para siempre: Steam puede revocarlo o hacerlo vencer. Cuando eso ocurra, reemplazá STEAM_REFRESH_TOKEN en Render. La renovación automática está desactivada para esa cuenta para evitar invalidar un token cuya variable el programa no puede actualizar.

Render Free borra los archivos locales en reinicios, suspensiones y despliegues. Los cambios de juegos, horarios, cromos, administradores de chat y webhook hechos desde el panel siguen siendo temporales: para conservar su configuración base, actualizá la plantilla config.json en GitHub. No publiques tokens ni contraseñas allí. No se implementa una base de datos externa en esta variante personal.

El login web sigue disponible para otras cuentas, pero sus sesiones guardadas localmente son temporales en Free. La cuenta administrada con token de Environment cambia su acceso solo desde Environment. Para olvidarla definitivamente quitá esa variable y desplegá de nuevo; Pausar detiene su actividad sin borrar el acceso.

UptimeRobot produce tráfico entrante, pero no garantiza que Render esté activo permanentemente ni evita reinicios. No se requiere disco persistente o base de datos para mantener el token de Environment; sí harían falta para conservar los cambios locales del panel.

## Logros

Lectura del estado real, con identificación explícita de lo no verificable. Escritura, bloqueo y cola deshabilitados hasta contar con un motor comprobado. No se anuncian logros falsos. STEAM_API_KEY es opcional para mejorar lectura y no concede permiso de escritura en juegos ajenos.

El token que estuvo en config.json permanece en versiones antiguas del repositorio aunque este cambio lo retire de la versión actual. Revocá esa sesión desde Steam si querés invalidarla; quitar el archivo no revoca el dispositivo.

Documentación: https://render.com/docs/free · https://render.com/docs/environment-variables · https://render.com/docs/web-services
