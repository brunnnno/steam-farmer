# SteamFarmer 2.0

Panel personal para administrar tus propias cuentas Steam. Incluye inicio de sesión web con Steam Guard, reconexión mediante sesión guardada, farming manual/cromos y lectura real de logros.

## Si ya lo tenés en Render

Seguí **RENDER.md**: usa tu servicio existente, el puerto asignado por Render y `/healthz` para UptimeRobot. El login se realiza desde la URL pública. Para tu uso personal se admite STEAM_REFRESH_TOKEN en Environment: ese token sobrevive a reinicios, mientras los cambios locales del panel siguen siendo temporales. UptimeRobot no reemplaza almacenamiento persistente.

## Inicio en Windows

1. Instalá Node.js 22 o superior.
2. Extraé **toda** esta carpeta. `bot.js` necesita `lib/`, `public/` y los demás archivos; no sirve reemplazar solamente el bot anterior.
3. Abrí una terminal dentro de la carpeta y ejecutá:

```sh
npm ci
npm start
```

4. Abrí http://127.0.0.1:8000 en el navegador. En el primer arranque la terminal muestra una contraseña aleatoria del panel. Guardala. Podés cambiarla desde el panel; no es tu contraseña Steam.
5. Tu lista anterior de juegos está conservada en **Cuenta principal**, pero la sesión compartida anteriormente fue excluida. Seleccioná esa cuenta, pulsá **Reconectar Steam**, ingresá el **nombre de inicio de sesión** de Steam y tu contraseña. Steam puede rechazar un email como nombre de login.
6. Completá Steam Guard: código del correo/autenticador o aprobación en la app del teléfono. No vuelvas a iniciar el intento para introducir el código: usá el campo que aparece.
7. La contraseña Steam no se escribe en archivos. La sesión queda guardada automáticamente y se renueva cuando Steam lo permite. Si vence o Steam la revoca, pulsá Reconectar Steam. Para agregar otra cuenta usá Add Account.

Los tokens originales no están en este paquete. Revocá la sesión que compartiste anteriormente desde la administración de dispositivos de Steam; quitarla del código no la revoca en Steam.

## Datos y recuperación

- `config.json` es la plantilla inicial con tu lista de juegos, sin secretos.
- `data/config.json` contiene configuración de ejecución y el hash de la contraseña del panel.
- `data/sessions.enc.json` contiene sesiones cifradas con AES-256-GCM.
- `data/vault.key` es la clave local. Guardá una copia privada de **toda** la carpeta `data/` si necesitás restaurar sesiones. No publiques ni compartas esta carpeta, especialmente junto con la clave. El cifrado no protege contra alguien que ya controla el servidor o tiene ambos archivos. En Windows, mantené esa carpeta accesible solo por tu usuario.
- Cerrar sesión Steam elimina el acceso guardado en este programa. La revocación del dispositivo en Steam se realiza desde Steam.
- Cerrar el panel termina únicamente la sesión del navegador; las cuentas Steam siguen funcionando en el proceso.
- La contraseña inicial se muestra una vez. Si la olvidaste: detené el bot y eliminá solo `panelAuth` de `data/config.json`; al reiniciar se genera una nueva contraseña. Esto conserva las cuentas y sus sesiones.
- Reiniciar el proceso cierra las sesiones del panel; las cuentas Steam se reconectan con sus sesiones guardadas. La pausa manual es temporal; para pausar persistentemente, quitá los juegos o detené el proceso.

Variables opcionales: `STEAM_REFRESH_TOKEN` (cuenta main conectada automáticamente desde una variable privada), `STEAM_ACCOUNT_ID` (main por defecto), `PORT` (8000), `DATA_DIR`, `PANEL_PASSWORD` (solo primera inicialización, 12–256 caracteres), `STEAM_API_KEY` (mejora la lectura de logros y sus identificadores reales).

## Logros: alcance real

La lectura intenta Steam Web API cuando configurás `STEAM_API_KEY`; luego XML/HTML autenticado de Steam Community. El catálogo global solo se utiliza como alternativa y muestra **Sin verificar** para el estado personal. No se inventan nombres API ni se mezclan marcas locales con el estado de Steam. Cada refresco vuelve a consultar Steam, sujeto a sus propios tiempos de propagación.

**Desbloquear, bloquear y encolar desbloqueos está deshabilitado.** Las rutas devuelven HTTP 501 y no alteran logros ni anuncian éxitos. El motor binario anterior no estaba verificado y marcaba éxitos sin confirmación. No se reemplazó por un desbloqueador universal probado: eso sigue siendo trabajo pendiente. La API web oficial de escritura requiere la clave del publisher propietario del juego; un login común no concede ese permiso.

## Actividad, cromos y horarios

- Hasta 32 AppID manuales; los títulos personalizados se envían aparte.
- La actividad y las horas mostradas son **estimaciones**, no confirmación de horas acreditadas por Steam.
- La pausa por otro dispositivo sigue `playingState`; no reanuda por un temporizador fijo ni fuerza la expulsión del juego local.
- El modo cromos conserva la lista manual; al desactivarlo vuelve a esa lista. Consulta insignias en inglés y reescanea cada 10 minutos. Steam puede cambiar su HTML y las reglas de drops. Los errores de escaneo conservan el último resultado en vez de anunciar que ya terminó.
- Los horarios usan America/Montevideo por defecto. Se admite medianoche, intervalos que cruzan la noche y una zona horaria IANA configurada desde el panel. Inicio y fin iguales significan sin descanso. Desactivar el horario quita inmediatamente la pausa por sueño.
- Los comandos de chat están deshabilitados hasta autorizar SteamID64 desde el panel.
- Discord recibe los mensajes directamente; no se usa un proxy externo. El secreto del webhook no se devuelve al navegador.

## Acceso remoto

Por defecto el servidor escucha solo en `127.0.0.1`. Para un servidor remoto configurá `HOST=0.0.0.0` y `PUBLIC_ORIGIN=https://tu-dominio.example`, con un proxy inverso que termine HTTPS y conserve el Host público. No expongas el puerto interno directamente. El panel utiliza cookie HttpOnly/SameSite, protección CSRF, control de origen, límite de solicitudes y límite de intentos. `PUBLIC_ORIGIN` activa cookies Secure. Es un panel personal con un administrador, no un SaaS con aislamiento entre clientes. No recolectes credenciales Steam de terceros.

## Comprobaciones

```sh
npm run check
npm test
```

Las pruebas utilizan clientes Steam simulados: cubren autenticación del panel, CSRF/origen, límites de intentos, Steam Guard, cancelación, cifrado, renovación de sesión, selección explícita de cuenta, anticolisión, horarios, lectura y rechazo de falsos desbloqueos. No prueban un login real contra Valve ni cambios de logros reales.

## Cambios respecto al prototipo

Se conservaron la apariencia del panel y la lista de juegos. Se separaron backend, interfaz y utilidades; se eliminaron secretos y overlays falsos de logros; se reemplazó el PIN por una contraseña hasheada con sesión de navegador; se añadieron login Steam y Steam Guard; se corrigieron anticolisión, horarios, lista manual/cromos, validación de entradas, borrado de perfil, resultado de licencias, errores HTTP, escape del contenido y persistencia atómica.
