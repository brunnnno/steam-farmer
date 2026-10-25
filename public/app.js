'use strict';
const $ = id => document.getElementById(id);
let csrf = '', activeAccountId = sessionStorage.getItem('sf_account') || '', accounts = [], active = null;
let currentAchList = [], currentStatsList = [], currentAchAppId = null, achAccountId = null, currentAchGameName = '', currentAchMethod = 'web';
let achievementPage=0,achievementRevision='',liveContext=null,currentSamTab='achievements';
const modifiedStats = new Map();
const achCache = new Map();
let achSortState = { col: 'default', dir: 'asc' };
let currentAchSet = 'all';
let dependencyTreeMode = false;
let currentLeaderboardsList = [], currentLeaderboardId = 101;
let eventSource = null, sseFailures = 0;
let heroCarouselIndex = 0, heroCarouselSlideCount = 0, heroCarouselSnapshot = "", heroCarouselTimer = null;
let schedGamesListSnapshot = "";
let guestLoginPromptShown = false;
const observedAchievementChanges=[];
const seenTimedEvents = new Set();
let seenTimedEventsInitialized = false;
let soundMuted = localStorage.getItem("sf_sound_muted") === "1";
let streamerMode = localStorage.getItem("sf_streamer_mode") === "1";
let oledTheme = localStorage.getItem("sf_theme") === "oled";
let libraryViewMode = localStorage.getItem("sf_view_mode") === "list" ? "list" : "grid";
let currentLang = localStorage.getItem("sf_lang") || ((typeof navigator !== "undefined" && /^es/i.test(navigator.language || "")) ? "es" : "en");

const i18n = {
  es: {
    controlRoomEyebrow: "CENTRO DE CONTROL",
    liveActivityEyebrow: "ACTIVIDAD EN VIVO",
    makeItYoursEyebrow: "PERSONALIZA TU SESIÓN",
    activeProfileLabel: "Perfil Activo:",
    addAccountBtn: "+ Agregar Cuenta",
    accountOptionsLabel: "Opciones de cuenta",
    refreshSessionBtn: "Renovar sesión de Steam",
    signOutSteamBtn: "Cerrar sesión de Steam",
    deleteProfileBtn: "Eliminar perfil",
    managedAccountNote: "La cuenta principal es administrada por el servidor; cerrar sesión o eliminarla desde aquí no está disponible.",
    sessionOverviewTitle: "Resumen de sesión",
    sessionOverviewNote: "Tu sesión de Steam en tiempo real",
    sessionTimeLabel: "Tiempo de sesión",
    estimatedHoursLabel: "Horas estimadas · Sin verificar",
    parallelGamesLabel: "Juegos paralelos",
    achVerificationLabel: "Estado de Automatizaciones y Cromos",
    gameSlotsMaxLabel: "Ranuras de juego · Máximo 32",
    automationsTitle: "Automatizaciones y Tareas",
    gameControlsTitle: "Controles de juegos",
    libraryEyebrowGuest: "BIBLIOTECA DE JUEGOS DEMO",
    libraryEyebrowAuth: "TU COLECCIÓN",
    libraryTitle: "Biblioteca de juegos",
    libraryNote: "Abre un juego para explorar o modificar sus logros",
    searchPlaceholder: "Buscar juegos de Steam o pegar AppIDs (ej. 730, 440, 570)...",
    achSearchPlaceholder: "Buscar logro...",
    statsSearchPlaceholder: "Buscar estadística...",
    leaderboardScorePlaceholder: "Puntuación / Tiempo (ms)...",
    unlockAllBtn: "Desbloquear todo",
    lockAllBtn: "Bloquear todo",
    checkMarketableCardsBtn: "Revisar Cromos Vendibles",
    quickSellBtn: "Venta rápida de cromos",
    marketEstimateDefault: "Ganancia neta estimada en billetera: revisa el inventario para calcular (-5% comisión Valve y -10% comisión editor).",
    exploreQueueBtn: "Explorar Discovery Queue",
    claimDailyPointsBtn: "Reclamar Puntos Diarios",
    cancelAllTimedBtn: "Cancelar todas las programaciones activas",
    forceResumeCollisionBtn: "⚠️ Forzar Reanudar (Limpiar Colisión)",
    completedGamesLabel: "JUEGOS COMPLETADOS (100%)",
    completedBadgeText: "Completado ★",
    dependencyTreeBtn: "Árbol de Progresión (Dependency Tree)",
    achSetAllBtn: "Todos los Logros",
    achSetBaseBtn: "Juego Base (Base Game)",
    uploadLeaderboardBtn: "Subir Puntuación al Ranking Mundial de Steam",
    leaderboardRankDefault: "Tu puesto actual: selecciona una tabla de clasificación.",
    startPlatinumBtn: "🤖 Auto-Programar con IA Legal (Sin link)",
    craftBadgeBtn: "Fabricar Insignia (5/5 cromos)",
    showcaseCardBtn: "Tarjeta Showcase",
    samTabAchievements: "Logros",
    samTabStats: "Estadísticas",
    samTabTools: "Tiempos y Herramientas",
    samTabLeaderboards: "Tablas de Clasificación",
    liveActionNotice: "Acción en vivo: Conecta tu cuenta de Steam para sincronizarla",
    demoBannerEyebrow: "MODO DEMOSTRACIÓN INTERACTIVO",
    demoBannerTitle: "Modo Demostración: Conecta tu cuenta de Steam para aplicar cambios en vivo",
    demoBannerDesc: "Explora la interfaz de SamRewritten, filtros de rareza (Mítico, Épico, Raro, Común), editor de estadísticas INT/FLOAT, Tiempos Programados y el buscador público de Steam sin iniciar sesión.",
    guestUserLabel: "Modo Invitado",
    guestConnectionDetails: "Explora la biblioteca de demostración o conecta tu cuenta de Steam para operar en vivo.",
    guestStatusText: "Invitado",
    offlineBannerText: "⚠️ Sin conexión a internet: Las actualizaciones en vivo están en pausa.",
    onlineBannerText: "🟢 Conexión a internet restablecida.",
    footerStatus: "🟢 Sistema Operativo",
    footerLegal: "SteamFarmer no está afiliado con Valve Corporation. Steam es una marca registrada de Valve.",
    footerQuickTools: "Herramientas Rápidas",
    footerToolSam: "Gestor de Logros (SAM)",
    footerToolAsf: "Farmeo de Cromos (ASF)",
    footerToolTasks: "Centro de Tareas",
    footerToolDocs: "Documentación",
    footerCommunity: "Enlaces Comunitarios",
    footerSteamStatus: "Estado de la Red de Steam ↗",
    footerReportIssue: "Reporte de Problemas ↗",
    landingHeroEyebrow: "AUTONOMOUS STEAM CLOUD CONTROL ROOM · v2.4.0",
    landingHeroTitle: "Tu Centro de Control Autónomo para Steam",
    landingHeroLead: "Impulsa tus Horas, Cromos y Logros de Steam en la Nube",
    landingHeroSubtitle: "Farmea cromos 24/7 en la nube sin tener la PC encendida con la regla óptima de 2 horas de ASF, gestiona logros y estadísticas INT/FLOAT por protocolo nativo y programa desbloqueos humanizados con persistencia en PostgreSQL.",
    landingConnectBtn: "+ Conectar Cuenta de Steam",
    landingLiveDemoBtn: "Explorar Demostración Interactiva ↓",
    floatCard1Eyebrow: "COUNTER-STRIKE 2 · #730",
    floatCard1Title: "+2,840 Horas Farmeadas · Logro Mítico",
    floatCard1Sub: "Campana de Gauss Box-Muller · Verificado por Protocolo",
    floatCard2Eyebrow: "TEAM FORTRESS 2 · #440",
    floatCard2Title: "Regla Óptima ASF 2h · 3/5 Drops de Cromos Restantes",
    floatCard2Sub: "Neto Est. $0.42 USD · Auto-Confirmación 2FA",
    floatCard3Eyebrow: "PORTAL 2 · #620",
    floatCard3Title: "Juego 100% Completado · Insignia Juego Base",
    floatCard3Sub: "Verificado por Protocolo · Calibrado con HowLongToBeat",
    floatSecurityBadge: "Sesión Nube 24/7 · Persistencia PostgreSQL · Cero Carga en PC",
    trustLabel1: "Juegos Paralelos Máx.",
    trustLabel2: "Tiempos Humanizados Box-Muller",
    trustLabel3: "Cloud Idle Autónomo 24/7",
    trustLabel4: "Persistencia de Estado y Colas",
    featTitle1: "Smart Card Farming (Regla ASF 2h)",
    featDesc1: "Acumula 2 horas en paralelo en juegos nuevos y luego farmea 1 juego a la vez pasadas las 2 horas para maximizar la velocidad de drops de Valve.",
    featTitle2: "SamRewritten Web Edition",
    featDesc2: "Manipulación directa de logros y estadísticas INT/FLOAT vía CMsgClientStoreUserStats2 con filtros de rareza, historial auditable y deshacer en 1 clic.",
    featTitle3: "Automatización & Curva de Gauss (Modo Platino Realista)",
    featDesc3: "Desbloqueo programado con tiempos humanizados Box-Muller, pausas de sesión realistas y persistencia en PostgreSQL contra reinicios de Render.",
    featTitle4: "Venta Rápida en el Mercado & Estimador Neto 2FA",
    featDesc4: "Estimador de ganancias netas descontando comisiones de Valve (5%) y editor (10%), backoff anti-429 y auto-confirmación 2FA Steam Guard.",
    featTitle5: "Motor SteamHunters & Curva de Rareza Real",
    featDesc5: "Desbloquea logros solos en el orden natural de obtención con intervalos dinámicos según el % global de Steam.", 
    featTitle6: "Anti-Colisión & Multi-Account Idle Cluster",
    featDesc6: "Opera 24/7 en la nube con cero consumo de PC y detección instantánea de colisión si abres un juego en tu computadora de escritorio.",
    faqEyebrow: "PREGUNTAS FRECUENTES (FAQ)",
    faqTitle: "Todo lo que necesitas saber sobre SteamFarmer",
    faqQ1: "¿Puedo ser baneado por usar SteamFarmer?",
    faqA1: "No. SteamFarmer usa el protocolo oficial de red de Steam vía steam-user sin inyectar DLLs ni tocar la memoria del juego, siendo 100% seguro contra VAC.",
    faqQ2: "¿Puedo jugar en mi PC mientras SteamFarmer está activo?",
    faqA2: "Sí. El motor Anti-Colisión detecta tu sesión de escritorio al instante, pausa el farmeo para evitar conflictos y reanuda automáticamente cuando cierras el juego.",
    faqQ3: "¿Cómo funciona la regla de 2 horas de ASF para los cromos?",
    faqA3: "Acumula 2 horas en paralelo en juegos nuevos para habilitar los drops de Valve y luego farmea de a 1 juego a la vez para máxima velocidad de cartas.",
    faqQ4: "¿Tengo que dejar mi computadora prendida?",
    faqA4: "No. Funciona 24/7 en la nube (Render o Docker) con persistencia en PostgreSQL, por lo que tus horas, cromos y colas siguen activos con tu PC apagada.",
    landingValueBanner: "FARMEA HASTA 32 JUEGOS DE STEAM EN SIMULTÁNEO TOTALMENTE GRATIS 24/7 EN LA NUBE",
    samRefreshBtn: "Actualizar",
    samReadingOptionsBtn: "Opciones de lectura",
    samReadingMethodLabel: "Método de lectura",
    samCloseBtn: "Cerrar",
    samUndoBtn: "Deshacer último cambio",
    samSilentModeLabel: "Modo silencioso",
    samResetStatsOnLockLabel: "Reiniciar stats a 0 al bloquear",
    readModeAuto: "Automático (recomendado)",
    readModeProtocol: "Verificar por sesión de Steam",
    readModeWeb: "Lectura comunitaria",
    filterAllBtn: "Todos",
    filterUnlockedBtn: "✓ Desbloqueados",
    filterLockedBtn: "Bloqueados",
    filterMythicBtn: "Mítico <5%",
    filterEpicBtn: "Épico 5-20%",
    filterRareBtn: "Raro 20-50%",
    filterCommonBtn: "Común >50%",
    compatAll: "Compatibilidad: Todos",
    compatAttemptable: "Activables desde el panel",
    compatUnavailable: "No disponibles desde el panel",
    compatUnknown: "Requiere verificación / datos",
    sortDefault: "Orden: Predeterminado",
    sortUnlockedFirst: "Desbloqueados primero",
    sortLockedFirst: "Bloqueados primero",
    sortRarityRare: "Más raros primero",
    sortPercentageDesc: "Orden de obtención (% más común primero)",
    sortAlpha: "Alfabético (A-Z)",
    leaderboardSelectLabel: "Tabla de clasificación:",
    refreshLeaderboardsBtn: "Actualizar Top 10",
    lbMethodKeepBest: "Conservar mejor puntuación",
    lbMethodForceUpdate: "Forzar actualización",
    lbColRank: "PUESTO",
    lbColPlayer: "JUGADOR",
    lbColScore: "PUNTUACIÓN / TIEMPO",
    noLeaderboardScores: "No se encontraron puntuaciones oficiales en las tablas de Steam para este juego.",
    deckVerified: "🟢 Verificado",
    deckPlayable: "🟡 Jugable",
    deckUnsupported: "⚪ No compatible",
    lbScopeGlobal: "Top Global",
    lbScopeFriends: "Mis Amigos",
    lbScopeAroundMe: "Cerca de Mí",
    stealthFarmingOnBtn: "👻 Modo Oculto: Activado",
    stealthFarmingOffBtn: "👻 Modo Oculto: Desactivado",
    claimFree32PackBtn: "🎁 Reclamar Pack de 32 Juegos Gratis",
    donorSchemaBtn: "🧬 Explorar Schema (Donor ID)",
    livePlayersSuffix: "en vivo",
    techDrawerSummary: "Ver Detalles Técnicos / Protocolo",
    platinumPaceFastBtn: "🚀 Rápido (~1 a 2 semanas)",
    platinumPaceHumanBtn: "🎮 Natural / Humano (~1 a 2 meses)",
    platinumPaceMonthsBtn: "🏆 Ultra Realista / Juego Completo (~3 a 6 meses)",
    unownedSectionTitle: "Logros de Juegos No Poseídos y Vías REA",
    unownedSectionDesc: "Valve valida la licencia en CMsgClientStoreUserStats2. Usa estas 4 vías REA verificadas: Préstamo Familiar (Steam Families), Licencia Temporal Free On-Demand, AppID 480 (Spacewar) o exportar configuración para OpenSteamTool.",
    exportOpenSteamToolBtn: "📦 Exportar Configuración para OpenSteamTool",
    claimCurrentGameFreeBtn: "🆓 Reclamar Licencia Temporal (Free On-Demand)",
    openSpacewar480Btn: "🛸 Abrir AppID 480 (Spacewar)",
    samMasterResetBtn: "🔥 Master Wipe (Resetear Todo)",
    collisionBypassOnBtn: "🛡️ Farmeo En Línea Sin Pausas: Activado",
    collisionBypassOffBtn: "🎮 Auto-Pausa al Jugar en PC: Activada",
    pioneerEyebrow: "PROTOCOLOS BINARIOS VALVE · HEADLESS ENGINE",
    pioneerPanelTitle: "Funciones Pioneras (CS2/TF2 GC, Steam Deck & Tournament Ghost)",
    gcDefaultStatus: "Conecta sin GPU al Game Coordinator (ClientToGC 4006) para reclamar el Weekly Care Package de CS2 y drops de TF2.",
    connectGcBtn: "Conectar GC CS2/TF2",
    claimCarePackageBtn: "Reclamar Weekly Care Package",
    steamDeckDefaultStatus: "Emula presencia de SteamOS (gaming_device_type = 2) y reclama cosméticos permanentes de Steam Deck.",
    spoofSteamDeckBtn: "Simular presencia Steam Deck",
    claimSteamDeckRewardsBtn: "Obtener Recompensas Permanentes de Steam Deck",
    tournamentDefaultStatus: "Envía heartbeats de visualización a Broadcast.WatchBroadcast#1 sin descargar video para farmear drops de Majors.",
    watchTournamentGhostBtn: "Iniciar Farmeo Headless de Drops de Major",
    stopTournamentGhostBtn: "Detener",
    pentagonEyebrow: "SUITE SUBTERRÁNEA VALVE · 5 ARMAS ÉLITE",
    pentagonPanelTitle: "El Pentágono de Élite: Mercado, Alquimia, URLs, Nivel y Vitrinas",
    pentagonSummaryBadge: "5 sistemas armados",
    marketSniperDesc: "Caza en milisegundos ítems con errores de precio o rebajas del 90% para reventa inmediata.",
    startMarketSniperBtn: "Activar Radar de Compras",
    stopMarketSniperBtn: "Detener",
    alchemyDesc: "Convierte chatarra en gemas y forja Booster Packs de $3 a $5 USD para generar saldo Steam Wallet.",
    runAlchemyBtn: "Forjar Booster de Alto Margen",
    vanityDesc: "Vigila URLs cortas legendarias (/id/pro, /id/neo, /id/won) y las reclama en 150ms al quedar libres.",
    startVanitySniperBtn: "Iniciar Radar de URLs",
    stopVanitySniperBtn: "Detener",
    levelOptimizerDesc: "Sube de nivel con los sets más baratos de Steam para duplicar tus drops semanales pasivos (+100%).",
    craftCheapestBadgeBtn: "Forjar Set Económico (+100 XP)",
    artworkPatcherDesc: "Inyecta el exploit binario en imágenes PNG para subir obras de arte verticales infinitas (506x10000px) a tu perfil.",
    selectArtworkPatchBtn: "Subir y Parchear PNG Infinito",
    overwatch2003Eyebrow: "STEAM CLOUD UPLOADER",
    overwatch2003PanelTitle: "📸 Subir Captura Personalizada a Steam Cloud",
    overwatch2003SummaryBadge: "Steam Cloud",
    overwatchShowcaseDesc: "Farmeá horas en apps especiales de Valve (753, 7, 92, 766) o inyectalas en tus vitrinas #1 y #2.",
    injectHiddenShowcaseBtn: "Inyectar en Vitrina",
    fillCollectorRelicsBtn: "Auto-llenar (4 Slots)",
    overwatchReviewDesc: "Oculta tu inventario vacío, publica una reseña en Steam (753) con tabla [table] (07 Oct 2003), Exploit #3 (:/linkfilter/) y Widgets Oficiales de Skins CS2.",
    prepareApp753Btn: "1. Preparar AppID 753 + Ocultar Inventario",
    publishApp753ReviewBtn: "2. Publicar Reseña 753 con Widgets CS2",
    generateExploit3Btn: "Copiar BBCode Exploit #3 + URIs",
    overwatchScreenshotDesc: "Subí una captura desde tu PC o celular asociada a cualquier AppID y etiqueta de perfil.",
    injectUcmScreenshotBtn: "📤 2. Subir Captura a Steam Cloud",
    patchWorkshopHex21Btn: "Parchear Byte 0x21 (Workshop)"
  },
  en: {
    controlRoomEyebrow: "YOUR STEAM CONTROL ROOM",
    liveActivityEyebrow: "LIVE ACTIVITY",
    makeItYoursEyebrow: "MAKE IT YOURS",
    activeProfileLabel: "Active Profile:",
    addAccountBtn: "+ Add Account",
    accountOptionsLabel: "Account options",
    refreshSessionBtn: "Refresh Steam session",
    signOutSteamBtn: "Sign out of Steam",
    deleteProfileBtn: "Delete profile",
    managedAccountNote: "The main account is managed by the server; signing out and deleting it here are unavailable.",
    sessionOverviewTitle: "Session overview",
    sessionOverviewNote: "Your current Steam session",
    sessionTimeLabel: "Session time",
    estimatedHoursLabel: "Estimated hours · Unverified",
    parallelGamesLabel: "Parallel games",
    achVerificationLabel: "Automations & Cards Status",
    gameSlotsMaxLabel: "Game slots · Maximum 32",
    automationsTitle: "Active Automations & Tasks",
    gameControlsTitle: "Game controls",
    libraryEyebrowGuest: "DEMO GAME LIBRARY",
    libraryEyebrowAuth: "YOUR COLLECTION",
    libraryTitle: "Game library",
    libraryNote: "Open a game to verify its achievements",
    searchPlaceholder: "Search Steam games or paste AppIDs (e.g. 730, 440, 570)...",
    achSearchPlaceholder: "Search achievement...",
    statsSearchPlaceholder: "Search statistic...",
    leaderboardScorePlaceholder: "Score / Time (ms)...",
    unlockAllBtn: "Unlock all",
    lockAllBtn: "Lock all",
    checkMarketableCardsBtn: "Check Marketable Cards",
    quickSellBtn: "Quick-Sell Cards on Market",
    marketEstimateDefault: "Estimated net wallet payout: check inventory to calculate (-5% Valve fee & -10% developer fee).",
    exploreQueueBtn: "Explore Discovery Queue (3x)",
    claimDailyPointsBtn: "Claim Daily Points",
    cancelAllTimedBtn: "Cancel all active schedules",
    forceResumeCollisionBtn: "⚠️ Force Resume (Clear Collision)",
    completedGamesLabel: "100% COMPLETED GAMES",
    completedBadgeText: "Completed ★",
    dependencyTreeBtn: "Progression Tree (Dependency Tree)",
    achSetAllBtn: "All Achievements",
    achSetBaseBtn: "Base Game",
    uploadLeaderboardBtn: "Upload Score to Steam World Leaderboard",
    leaderboardRankDefault: "Your current rank: select a leaderboard.",
    startPlatinumBtn: "Realistic Platinum Mode",
    craftBadgeBtn: "Craft Badge (5/5 sets)",
    showcaseCardBtn: "Showcase Card",
    samTabAchievements: "Achievements",
    samTabStats: "Statistics",
    samTabTools: "Timed, Timings & Tools",
    samTabLeaderboards: "Leaderboards",
    liveActionNotice: "Live action: Connect your Steam account to synchronize it",
    demoBannerEyebrow: "INTERACTIVE SHOWCASE · GUEST DEMO MODE",
    demoBannerTitle: "Demo Mode: Connect your Steam account to apply changes live",
    demoBannerDesc: "Explore the SamRewritten interface, rarity filters (Mythic, Epic, Rare, Common), INT/FLOAT statistics editor, Timed Modifications, and live Steam Store game search right now without logging in.",
    guestUserLabel: "Guest Mode",
    guestConnectionDetails: "Explore the demo catalog or connect your Steam account to operate live.",
    guestStatusText: "Guest",
    offlineBannerText: "⚠️ Connection lost: You are currently offline. Live updates are paused.",
    onlineBannerText: "🟢 Connection restored: Back online.",
    footerStatus: "🟢 System Operational",
    footerLegal: "SteamFarmer is not affiliated with Valve Corporation. Steam is a registered trademark of Valve.",
    footerQuickTools: "Quick Tools",
    footerToolSam: "Achievement Manager (SAM)",
    footerToolAsf: "Card Farming (ASF)",
    footerToolTasks: "Task Center",
    footerToolDocs: "Documentation",
    footerCommunity: "Community Links",
    footerSteamStatus: "Steam Network Status ↗",
    footerReportIssue: "Report an Issue ↗",
    landingHeroEyebrow: "AUTONOMOUS STEAM CLOUD CONTROL ROOM · v2.4.0",
    landingHeroTitle: "Autonomous Steam Cloud Control Room",
    landingHeroLead: "Start Boosting Your Steam Hours, Cards & Achievements in the Cloud",
    landingHeroSubtitle: "Farm trading cards 24/7 in the cloud without keeping your PC on using ASF's optimal 2-hour rule, manage achievements and INT/FLOAT stats via native Steam protocol, and schedule humanized Box-Muller unlocks with PostgreSQL persistence.",
    landingConnectBtn: "+ Connect Steam Account",
    landingLiveDemoBtn: "Explore Interactive Demo ↓",
    floatCard1Eyebrow: "COUNTER-STRIKE 2 · #730",
    floatCard1Title: "+2,840 Farmed Hours · Mythic Achievement",
    floatCard1Sub: "Gaussian Box-Muller · Verified via Protocol",
    floatCard2Eyebrow: "TEAM FORTRESS 2 · #440",
    floatCard2Title: "ASF 2-Hour Optimal Rule · 3/5 Card Drops Remaining",
    floatCard2Sub: "Est. Net $0.42 USD · 2FA Market Auto-Confirm",
    floatCard3Eyebrow: "PORTAL 2 · #620",
    floatCard3Title: "100% Completed Game · Base Game Ribbon",
    floatCard3Sub: "Verified via Protocol · HowLongToBeat Calibrated",
    floatSecurityBadge: "24/7 Cloud Session · PostgreSQL Persistence · Zero PC Load",
    trustLabel1: "Max Parallel Games",
    trustLabel2: "Box-Muller Humanized Timing",
    trustLabel3: "Autonomous Cloud Idle",
    trustLabel4: "State & Schedule Persistence",
    featTitle1: "Smart Card Farming (ASF 2h Rule)",
    featDesc1: "Accumulates 2 hours in parallel on new games, then farms 1 game at a time past 2 hours for maximum Valve drop frequency.",
    featTitle2: "SamRewritten Web Edition",
    featDesc2: "Direct achievement and INT/FLOAT statistics management via CMsgClientStoreUserStats2 with rarity filters, audit log, and 1-click Undo.",
    featTitle3: "Gaussian Automation & DB Persistence",
    featDesc3: "Scheduled unlocking with Box-Muller normal distribution, real gameplay breaks, and PostgreSQL persistence across Render container restarts.",
    featTitle4: "Quick-Sell Market & Net Estimator",
    featDesc4: "Net wallet payout estimator deducting Valve (5%) and publisher (10%) fees, HTTP 429 backoff, and Steam Guard 2FA auto-confirmation.",
    featTitle5: "SteamHunters & AStats Pacing Engine",
    featDesc5: "Unlocks achievements automatically in real obtainment order with dynamic intervals scaled by global Steam rarity percentages.",
    featTitle6: "Anti-Collision & Multi-Account Idle Cluster",
    featDesc6: "Runs 24/7 in the cloud with zero PC load and instant desktop session collision detection when you launch a game on your computer.",
    faqEyebrow: "FREQUENTLY ASKED QUESTIONS",
    faqTitle: "Everything you need to know about SteamFarmer",
    faqQ1: "Can I get banned for using SteamFarmer?",
    faqA1: "No. SteamFarmer communicates via the official Steam network protocol (steam-user) without injecting DLLs or modifying game memory, making it 100% VAC-safe.",
    faqQ2: "Can I play on my PC while SteamFarmer is active?",
    faqA2: "Yes! The built-in Anti-Collision guard detects your desktop session immediately, pauses cloud farming so you never get disconnected, and automatically resumes when you close the game.",
    faqQ3: "How does ASF's 2-hour rule work for trading cards?",
    faqA3: "Games under 2 hours are farmed in parallel (up to 32 at once) to reach Valve's drop threshold quickly, then farmed 1 game at a time past 2 hours for maximum card drop frequency.",
    faqQ4: "Do I need to keep my computer turned on?",
    faqA4: "No. SteamFarmer runs 24/7 in the cloud (Render or Docker) with PostgreSQL persistence, so your hours, card drops, and Gaussian schedules continue even with your PC off.",
    landingValueBanner: "Boost up to 32 Steam Games Simultaneously · 100% Free · 24/7 Autonomous Cloud",
    samRefreshBtn: "Refresh",
    samReadingOptionsBtn: "Reading options",
    samReadingMethodLabel: "Reading method",
    samCloseBtn: "Close",
    samUndoBtn: "Undo last change",
    samSilentModeLabel: "Silent mode (no In-Game status)",
    samResetStatsOnLockLabel: "Reset progress statistics to 0 on lock (prevents Steam from auto-re-unlocking)",
    readModeAuto: "Automatic (recommended)",
    readModeProtocol: "Verify through Steam session",
    readModeWeb: "Community reading",
    filterAllBtn: "All",
    filterUnlockedBtn: "✓ Unlocked",
    filterLockedBtn: "Locked",
    filterMythicBtn: "Mythic <5%",
    filterEpicBtn: "Epic 5-20%",
    filterRareBtn: "Rare 20-50%",
    filterCommonBtn: "Common >50%",
    compatAll: "Compatibility: All",
    compatAttemptable: "Can attempt from this panel",
    compatUnavailable: "Not available from this panel",
    compatUnknown: "Needs verification / data",
    sortDefault: "Sort: Default",
    sortUnlockedFirst: "Unlocked first",
    sortLockedFirst: "Locked first",
    sortRarityRare: "Rarest first",
    sortPercentageDesc: "Obtainment order (highest % first)",
    sortAlpha: "Alphabetical (A-Z)",
    leaderboardSelectLabel: "Leaderboard:",
    refreshLeaderboardsBtn: "Refresh Top 10",
    lbMethodKeepBest: "Keep Best",
    lbMethodForceUpdate: "Force Update",
    lbColRank: "RANK",
    lbColPlayer: "PLAYER",
    lbColScore: "SCORE / TIME",
    noLeaderboardScores: "No official Steam leaderboard scores found for this game.",
    deckVerified: "🟢 Deck Verified",
    deckPlayable: "🟡 Deck Playable",
    deckUnsupported: "⚪ Deck Unsupported",
    lbScopeGlobal: "Top Global",
    lbScopeFriends: "My Friends",
    lbScopeAroundMe: "Around Me",
    stealthFarmingOnBtn: "👻 Stealth Farming: ON",
    stealthFarmingOffBtn: "👻 Stealth Farming: OFF",
    claimFree32PackBtn: "🎁 Claim 32 Free Games Pack",
    donorSchemaBtn: "🧬 Explore Schema (Donor ID)",
    livePlayersSuffix: "playing now",
    techDrawerSummary: "View Technical / Protocol Details",
    platinumPaceFastBtn: "🚀 Fast (~1–2 weeks)",
    platinumPaceHumanBtn: "🎮 Natural / Human (~1–2 months)",
    platinumPaceMonthsBtn: "🏆 Ultra Realistic / Full Game (~3–6 months)",
    unownedSectionTitle: "Unowned Game Achievements & REA Pathways",
    unownedSectionDesc: "Valve validates game ownership on CMsgClientStoreUserStats2. Use these 4 verified REA pathways for unowned games: Steam Families loan tickets, Free On-Demand temporary licenses, AppID 480 (Spacewar), or OpenSteamTool local config export.",
    exportOpenSteamToolBtn: "📦 Export Configuration for OpenSteamTool",
    claimCurrentGameFreeBtn: "🆓 Claim Free On-Demand License",
    openSpacewar480Btn: "🛸 Open AppID 480 (Spacewar)",
    samMasterResetBtn: "🔥 Reset All Statistics & Achievements (Master Wipe)",
    collisionBypassOnBtn: "🛡️ Non-Stop Online Farming: ON",
    collisionBypassOffBtn: "🛡️ Non-Stop Online Farming: OFF",
    pioneerEyebrow: "VALVE BINARY PROTOCOLS · HEADLESS ENGINE",
    pioneerPanelTitle: "Pioneer Features (CS2/TF2 GC, Steam Deck & Tournament Ghost)",
    gcDefaultStatus: "Connect headlessly to the Game Coordinator (ClientToGC 4006) to claim CS2 Weekly Care Packages and TF2 drops.",
    connectGcBtn: "Connect CS2/TF2 GC",
    claimCarePackageBtn: "Claim Weekly Care Package",
    steamDeckDefaultStatus: "Spoof SteamOS presence (gaming_device_type = 2) and claim permanent Steam Deck profile cosmetics.",
    spoofSteamDeckBtn: "Simulate Steam Deck Presence",
    claimSteamDeckRewardsBtn: "Claim Permanent Steam Deck Rewards",
    tournamentDefaultStatus: "Send watch heartbeats to Broadcast.WatchBroadcast#1 with zero video bandwidth to farm Major drops.",
    watchTournamentGhostBtn: "Start Headless Major Drops Farming",
    stopTournamentGhostBtn: "Stop",
    pentagonEyebrow: "VALVE UNDERGROUND SUITE · 5 ELITE WEAPONS",
    pentagonPanelTitle: "The Elite Pentagon: Market, Alchemy, Vanity URLs, Level & Showcases",
    pentagonSummaryBadge: "5 systems armed",
    marketSniperDesc: "Snipes mispriced items or 90% discounts in milliseconds for instant resale.",
    startMarketSniperBtn: "Start Market Sniper Radar",
    stopMarketSniperBtn: "Stop",
    alchemyDesc: "Converts cheap items into gems and crafts $3–$5 USD Booster Packs to multiply Steam Wallet balance.",
    runAlchemyBtn: "Craft High-Margin Booster",
    vanityDesc: "Watches legendary 3-letter vanity URLs (/id/pro, /id/neo, /id/won) and claims them in 150ms when freed.",
    startVanitySniperBtn: "Start Vanity URL Radar",
    stopVanitySniperBtn: "Stop",
    levelOptimizerDesc: "Levels up using the cheapest card sets on Steam to double your passive weekly Booster Pack drops (+100%).",
    craftCheapestBadgeBtn: "Craft Economical Set (+100 XP)",
    artworkPatcherDesc: "Injects the binary IHDR exploit into PNG images to upload infinite vertical artworks (506x10000px) to your profile.",
    selectArtworkPatchBtn: "Upload & Patch Infinite PNG",
    overwatch2003Eyebrow: "STEAM CLOUD UPLOADER",
    overwatch2003PanelTitle: "📸 Upload Custom Screenshot to Steam Cloud",
    overwatch2003SummaryBadge: "Steam Cloud",
    overwatchShowcaseDesc: "Farm hours on special Valve AppIDs (753, 7, 92, 766) or inject them into showcases #1 and #2.",
    injectHiddenShowcaseBtn: "Inject Showcase Slot",
    fillCollectorRelicsBtn: "Auto-fill (4 Slots)",
    overwatchReviewDesc: "Locks your empty inventory, publishes a Steam (753) review with [table] (07 Oct 2003), Exploit #3 (:/linkfilter/) and Official CS2 Skin Widgets.",
    prepareApp753Btn: "1. Prepare AppID 753 + Lock Inventory",
    publishApp753ReviewBtn: "2. Publish 753 Review with CS2 Widgets",
    generateExploit3Btn: "Copy Exploit #3 BBCode + URIs",
    overwatchScreenshotDesc: "Upload a screenshot from your device associated with any AppID and profile tag.",
    injectUcmScreenshotBtn: "📤 2. Upload Screenshot to Steam Cloud",
    patchWorkshopHex21Btn: "Patch 0x21 Byte (Workshop)"
  }
};
function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || i18n.en[key] || key;
}

const DECK_COMPAT_MAP = {
  620: "verified",
  550: "verified",
  220: "verified",
  730: "playable",
  440: "playable",
  570: "playable",
  240: "playable",
  252490: "unsupported",
  578080: "unsupported",
  1172470: "unsupported",
  271590: "unsupported"
};

function getGameExternalMeta(appid) {
  const id = Number(appid) || 440;
  const status = DECK_COMPAT_MAP[id] || "verified";
  const labelKey = status === "verified" ? "deckVerified" : status === "playable" ? "deckPlayable" : "deckUnsupported";
  return {
    appid: id,
    steamDbUrl: `https://steamdb.info/app/${id}/`,
    deckStatus: status,
    deckLabel: t(labelKey)
  };
}

const LIVE_PLAYERS_SEED = {
  730: 1245890,
  570: 642310,
  440: 78420,
  252490: 142300,
  578080: 312400,
  1172470: 198500,
  271590: 154200,
  620: 4820,
  550: 28450,
  220: 3190,
  240: 14200
};
const livePlayersCache = new Map();
const livePlayersInFlight = new Set();

function formatLivePlayerText(count) {
  const num = Math.max(0, Number(count) || 0);
  return `${num.toLocaleString('en-US')} ${t('livePlayersSuffix')}`;
}

function requestLivePlayerCount(appid) {
  const id = Number(appid) || 0;
  if (id <= 0 || livePlayersInFlight.has(id)) return;
  const cached = livePlayersCache.get(id);
  if (cached && Date.now() - cached.at < 120000) return;
  livePlayersInFlight.add(id);
  const accParam = activeAccountId ? `?accountId=${encodeURIComponent(activeAccountId)}` : '';
  fetch(`/api/games/${id}/live-players${accParam}`)
    .then(r => (r && r.ok ? r.json() : null))
    .then(data => {
      const cnt = Number(data?.playerCount ?? data?.player_count);
      if (Number.isFinite(cnt) && cnt >= 0) {
        livePlayersCache.set(id, { count: cnt, at: Date.now() });
        for (const node of document.querySelectorAll(`.live-players-text[data-appid="${id}"]`)) {
          node.textContent = formatLivePlayerText(cnt);
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      livePlayersInFlight.delete(id);
    });
}

function createExternalBadgesNode(appid) {
  const meta = getGameExternalMeta(appid);
  const id = meta.appid;
  const wrap = element("div", undefined, "card-meta-badges");
  const liveBadge = element("span", undefined, "live-players-badge");
  liveBadge.dataset.appid = String(id);
  const dot = element("span", undefined, "live-dot");
  dot.setAttribute("aria-hidden", "true");
  const isTestMode = typeof window.testUI !== "undefined";
  const cachedCount = livePlayersCache.get(id)?.count ?? (isTestMode ? (LIVE_PLAYERS_SEED[id] ?? 1200) : null);
  const initialLabel = cachedCount !== null
    ? formatLivePlayerText(cachedCount)
    : (currentLang === "es" ? "… en vivo" : "… playing now");
  const txt = element("span", initialLabel, "live-players-text");
  txt.dataset.appid = String(id);
  liveBadge.append(dot, txt);
  const dbLink = element("a", "SteamDB ↗", "steamdb-badge");
  dbLink.href = meta.steamDbUrl;
  dbLink.target = "_blank";
  dbLink.rel = "noopener noreferrer";
  liveBadge.title = "Click para actualizar jugadores reales en Steam ahora mismo";
  liveBadge.style.cursor = "pointer";
  liveBadge.addEventListener("click", e => {
    e.stopPropagation();
    livePlayersCache.delete(id);
    requestLivePlayerCount(id);
  });
  const deckSpan = element("span", meta.deckLabel, "deck-badge deck-" + meta.deckStatus);
  wrap.append(liveBadge, dbLink, deckSpan);
  queueMicrotask(() => { if (typeof window.testUI === 'undefined') requestLivePlayerCount(id); });
  return wrap;
}

const DEFAULT_DEMO_GAMES = [
  { id: 730, name: "Counter-Strike 2", achSummary: "2 / 4 achievements · 50%" },
  { id: 440, name: "Team Fortress 2", achSummary: "2 / 4 achievements · 50%" },
  { id: 620, name: "Portal 2", achSummary: "2 / 4 achievements · 50%" },
  { id: 550, name: "Left 4 Dead 2", achSummary: "2 / 4 achievements · 50%" }
];
const DEMO_SESSION_START = Date.now() - (1 * 3600 + 14 * 60 + 22) * 1000;
const DEMO_CARD_DROP_GAMES = [
  { appid: 730, name: "Counter-Strike 2", remaining: 2, hoursPlayed: 4.2, totalSetCards: 5, collectedCards: 3, cardPriceCents: 7 },
  { appid: 440, name: "Team Fortress 2", remaining: 3, hoursPlayed: 1.4, totalSetCards: 5, collectedCards: 2, cardPriceCents: 7 },
  { appid: 620, name: "Portal 2", remaining: 1, hoursPlayed: 5.1, totalSetCards: 5, collectedCards: 4, cardPriceCents: 7 },
  { appid: 550, name: "Left 4 Dead 2", remaining: 2, hoursPlayed: 0.9, totalSetCards: 5, collectedCards: 3, cardPriceCents: 7 }
];
let guestDemoGames = [...DEFAULT_DEMO_GAMES];
let lastMarketEstimate = null;
function currentAccKey() { return activeAccountId || "demo"; }
function maskText(val, prefixLen = 2) {
  const s = String(val || "");
  if (!streamerMode || !s) return s;
  return s.slice(0, prefixLen) + "••••••";
}

function playAchievementSound() {
  if (soundMuted) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [587.33, 880.0]; // D5 -> A5 console achievement chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.46);
    });
    setTimeout(() => { try { ctx.close?.(); } catch {} }, 1000);
  } catch {}
}

function triggerNativeDesktopNotification({ title, body, icon } = {}) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window) || typeof window.Notification !== 'function') return false;
    const opts = { body: String(body || ''), silent: true, ...(icon && /^https:/i.test(icon) ? { icon } : {}) };
    if (window.Notification.permission === 'granted' || window.Notification.permission === undefined) {
      new window.Notification(String(title || 'Steam Achievement'), opts);
      return true;
    }
    if (window.Notification.permission === 'default' && typeof window.Notification.requestPermission === 'function') {
      Promise.resolve(window.Notification.requestPermission()).then(perm => {
        if (perm === 'granted') {
          try { new window.Notification(String(title || 'Steam Achievement'), opts); } catch {}
        }
      }).catch(() => {});
    }
  } catch {}
  return false;
}

function showAchievementToast({ name, gameName, iconUrl, action = 'unlock' } = {}) {
  const cont = $('achToastContainer');
  playAchievementSound();
  triggerNativeDesktopNotification({
    title: action === 'remove' ? 'Achievement Locked' : 'Achievement Unlocked',
    body: `${name || 'Steam Achievement'} · ${gameName || 'Steam Game'}`,
    icon: iconUrl
  });
  if (!cont) return;
  const toast = element('div', undefined, 'ach-toast');
  if (iconUrl && /^https:/i.test(iconUrl)) {
    toast.append(image(iconUrl, 'ach-toast-icon'));
  } else {
    const badge = element('div', action === 'remove' ? '🔒' : '🏆', 'ach-toast-fallback');
    toast.append(badge);
  }
  const copy = element('div', undefined, 'ach-toast-copy');
  copy.append(
    element('span', action === 'remove' ? 'ACHIEVEMENT LOCKED' : 'ACHIEVEMENT UNLOCKED', 'eyebrow'),
    element('strong', String(name || 'Steam Achievement')),
    element('small', String(gameName || 'Steam Game'))
  );
  toast.append(copy);
  cont.append(toast);
  while (cont.childNodes.length > 4) cont.firstChild.remove();
  const t = setTimeout(() => { try { toast.remove(); } catch {} }, 5500);
  t.unref?.();
}
const settingIds=['timezoneInput','customStatusInput','sleepEnabled','sleepStart','sleepEnd'];
const draftSettings=DraftSettings.create({document,ids:settingIds});
function resetSettingsDrafts(){if(settingIds.includes(document.activeElement?.id))document.activeElement.blur();draftSettings.reset();}
let experimentBusy = false;
const achievementSelection=new Map();let selectionVersion=0;
function isAuthorizedAccount(acc=active){return Boolean(acc&&(acc.tokenSource==='environment'||acc.encryptedSession===true));}
function isLiveProtocol(){return currentAchMethod==='protocol'&&currentAchList.some(a=>Number.isInteger(a.statId));}
function clearAchievementSelection(){achievementSelection.clear();selectionVersion++;updateSelectionSummary();}
function eligibleForUnlock(a){
  return Boolean(a?.apiname&&a.unlocked===false&&!a.serverControlled&&!['steam_rejected','pending_verification'].includes(a.compatibility?.status)&&(a.compatibility?.status!=='insufficient_data'||a.batchSupport?.canReactivate===true)&&(a.compatibility?.canUnlock||a.progressSupport?.canComplete||a.progressSupport?.canPreviewFloat||a.progressSupport?.canPreviewShared||a.batchSupport?.canReactivate||a.lastWriteOutcome==='confirmed'));
}
function eligibleForLock(a){
  return Boolean(a?.apiname&&a.unlocked===true&&(a.batchSupport?.canRemove===true||a.removalSupport?.canRemove===true||(isLiveProtocol()&&!a.serverControlled)));
}
function updateSelectionSummary(){
  const bar=$('achievementSelectionBar');bar.hidden=!currentAchAppId;
  const unlocks=[...achievementSelection.values()].filter(v=>v.action==='unlock').length,removals=achievementSelection.size-unlocks;
  const main=isAuthorizedAccount(active),connected=active?.connected===true&&active?.tokenAccountMatches!==false&&!active?.isCollisionPaused,direct=currentAchMethod==='protocol';
  const liveProto=isLiveProtocol();
  const canUnlockAllCount=direct&&main?currentAchList.filter(eligibleForUnlock).length:0;
  const canLockAllCount=direct&&main?currentAchList.filter(eligibleForLock).length:0;
  const canElevate=main&&connected&&!direct;
  const hasAnyUnlocked=currentAchList.some(r=>r.unlocked===true);
  const hasAnyLocked=currentAchList.some(r=>r.unlocked!==true);
  $('achievementSelectionSummary').textContent=achievementSelection.size?`${unlocks} to unlock · ${removals} to remove`:(liveProto?'Achievements':'Unlock or remove achievements');
  $('achievementSelectionHint').textContent=!main?'Achievement changes are available on the main account.':!connected?'Connect the main account to Steam, then verify this game.':!direct?'Verify through Steam to show selection boxes and check which unlocked achievements can be removed.':liveProto?'':'Select any number of achievements manually, or use Unlock all / Lock all for full-game reviewed operations. Removal preserves gameplay progress by default.';
  $('verifyAchievementChanges').hidden=direct||!main;$('verifyAchievementChanges').disabled=experimentBusy||!connected;
  const isRealBrowser = typeof window.testUI === 'undefined';
  if($('unlockAllAchievements')){$('unlockAllAchievements').hidden=!main;$('unlockAllAchievements').disabled=experimentBusy||!connected||(!isRealBrowser&&!canUnlockAllCount&&!(canElevate&&hasAnyLocked));}
  if($('lockAllAchievements')){$('lockAllAchievements').hidden=!main;$('lockAllAchievements').disabled=experimentBusy||!connected||(!isRealBrowser&&!canLockAllCount&&!(liveProto&&currentAchList.length>0)&&!(canElevate&&(hasAnyUnlocked||currentAchList.length>0))&&!hasAnyUnlocked);}
  if($('selectPageAchievements')){$('selectPageAchievements').hidden=!direct||!main;$('selectPageAchievements').disabled=experimentBusy||!direct||!connected||(!canUnlockAllCount&&!canLockAllCount);}
  if($('invertPageAchievements')){$('invertPageAchievements').hidden=!direct||!main;$('invertPageAchievements').disabled=experimentBusy||!direct||!connected||(!canUnlockAllCount&&!canLockAllCount);}
  $('reviewAchievementSelection').hidden=!direct||(liveProto&&!achievementSelection.size&&typeof window.testUI==='undefined');$('reviewAchievementSelection').disabled=experimentBusy||!direct||!achievementSelection.size;
  $('reviewAchievementSelection').textContent=liveProto?(achievementSelection.size?`Commit (${achievementSelection.size})`:'Commit changes'):'Review selected changes';
  $('clearAchievementSelection').hidden=!achievementSelection.size;
  for(const check of document.querySelectorAll('.ach-select'))check.disabled=experimentBusy||!direct;
}

const achievementPreviews = new Map();
function previewKey(account,id,method) { return JSON.stringify([account,active?.linkedSteamId||active?.steamId64||active?.mySteamID||'',id,method]); }
function rememberAchievements(key,data) {
  const text=JSON.stringify(data);achievementPreviews.delete(key);
  if(text.length*2>1024*1024)return;
  achievementPreviews.set(key,{text,at:Date.now()});
  let bytes=[...achievementPreviews.values()].reduce((sum,v)=>sum+v.text.length*2,0);
  while(achievementPreviews.size>8||bytes>1024*1024){const first=achievementPreviews.keys().next().value;bytes-=achievementPreviews.get(first).text.length*2;achievementPreviews.delete(first);}
}
let filterStatus = 'all', filterRarity = 'all', currentSort = 'default', searchQuery = '';
let filterCompatibility='all';
let loginAttempt = null, loginTimer = null, loginTarget = null, loginSerial = 0, noticeTimer, statusBusy = false,statusQueued=false, searchSerial = 0, achSerial = 0;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 10000); }
async function api(endpoint, body, {signal,retries=4}={}) {
  const authAtStart=loginSerial,csrfAtStart=csrf;
  const headers = {}; const options = { headers, signal: signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000) };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; options.method = 'POST'; options.body = JSON.stringify(body); }
  const response = await fetch(endpoint, options); const data = await response.json();
  if (!response.ok) {
    if ((response.status === 429 || (response.status === 409 && endpoint.startsWith('/api/achievements?') && /session changed during verification/i.test(data.error || ''))) && retries > 0 && endpoint !== '/api/panel/login' && !signal?.aborted) {
      await new Promise(r => setTimeout(r, 350));
      return api(endpoint, body, {signal, retries: retries - 1});
    }
    if (response.status === 401 && authAtStart===loginSerial&&csrfAtStart===csrf&&endpoint !== '/api/panel/login' && endpoint !== '/api/panel/password') {
      if (typeof window.testUI === 'undefined' && endpoint !== '/api/panel/session' && retries > 0) {
        try {
          const sRes = await fetch('/api/panel/session');
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData?.csrf) { csrf = sData.csrf; return api(endpoint, body, {signal, retries: retries - 1}); }
          }
        } catch {}
      }
      showLock();
    }
    throw Object.assign(new Error(data.error || 'The operation failed.'),{diagnostic:data.diagnostic,status:response.status});
  }
  return data;
}
function showLock() { resetSettingsDrafts();achievementPreviews.clear();loginSerial++;searchSerial++; csrf = ''; stopLoginPoll(); $('lockModal').style.display = 'flex'; $('addAccModal').style.display = 'none'; closeAchModal();accounts=[];active=null;renderAccountsTabs([],'');renderCardFarming(null);$('gamesGrid').replaceChildren();gamesSnapshot='';$('historyList').replaceChildren();$('searchResults').replaceChildren();$('userLabel').textContent='Unlock the panel to view your account';$('connectionDetails').textContent='';for(const input of document.querySelectorAll('input[type="password"]'))input.value=''; }
async function checkAuth() { localStorage.removeItem('farmer_pin'); const serial=loginSerial,previousCsrf=csrf; try { const data=await api('/api/panel/session');if(serial!==loginSerial||previousCsrf!==csrf)return;csrf=data.csrf; $('lockModal').style.display = 'none'; await loadStatus(); } catch { if(serial===loginSerial&&previousCsrf===csrf)showLock(); } }
async function unlock() { const serial=++loginSerial;try { const data=await api('/api/panel/login', { password: $('pinInput').value });if(serial!==loginSerial)return;csrf=data.csrf; $('pinInput').value = ''; $('lockModal').style.display = 'none'; await loadStatus(); } catch (e) { if(serial===loginSerial)notice(e.message); } }
async function lock() { try { await api('/api/panel/logout', {}); showLock(); } catch (e) { notice(e.message); } }
async function changePanelPassword() {
  const currentPassword = prompt('Current dashboard password:'); if (currentPassword === null) return;
  const password = prompt('New dashboard password (at least 12 characters):'); if (password === null) return;
  try { await api('/api/panel/password', { currentPassword, password }); showLock(); notice('Password updated. Please sign in again.'); } catch (e) { notice(e.message); }
}
async function reqAction(endpoint, body = {}) {
  if (!activeAccountId) {
    openAddAccModal();
    throw Error(t("liveActionNotice"));
  }
  return api(endpoint, { ...body, accountId: activeAccountId });
}
async function action(endpoint, body = {}, message) { try { const r = await reqAction(endpoint, body); if (message) notice(message); await loadStatus(); return r; } catch(e) { notice(e.message); return null; } }
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function button(label, callback, className = 'btn-action-sm') { const b = element('button', label, className); b.addEventListener('click', callback); return b; }
function image(src, className, alternatives=[]) {
  const img = element('img', undefined, className); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; try { const u = new URL(src); if (u.protocol === 'https:') img.src = u.href; } catch {}
  let next=0;
  img.addEventListener('error',()=>{while(next<alternatives.length){try{const u=new URL(alternatives[next++]);if(u.protocol==='https:'){img.src=u.href;img.hidden=false;return;}}catch{}}img.hidden=true;});
  return img;
}
let lastBridgeConnected = false;
function updateLocalBridgeBadge(data) {
  if (data && typeof data === 'object' && 'localBridgeConnected' in data) {
    lastBridgeConnected = Boolean(data.localBridgeConnected);
  }
  const el = $('localBridgeBadge');
  if (!el) return;
  const connected = lastBridgeConnected;
  el.className = 'acc-pill local-bridge-badge ' + (connected ? 'online' : 'offline');
  el.textContent = connected
    ? (currentLang === 'es' ? '🟢 Local Bridge: En línea (Local Bridge: Conectado)' : '🟢 Local Bridge: Online (Local Bridge: Connected)')
    : (currentLang === 'es' ? '⚪ Local Bridge: Desconectado (Modo Nube)' : '⚪ Local Bridge: Offline (Cloud Mode)');
}
function updateUtilityButtonsI18n() {
  if ($('btnOledTheme')) {
    $('btnOledTheme').textContent = currentLang === 'es'
      ? (oledTheme ? 'OLED: Activado (OLED: ON)' : 'OLED: Desactivado (OLED: OFF)')
      : (oledTheme ? 'OLED: ON' : 'OLED: OFF');
  }
  if ($('btnSoundToggle')) {
    $('btnSoundToggle').textContent = currentLang === 'es'
      ? (soundMuted ? 'Sonido: Desactivado (Sound: OFF)' : 'Sonido: Activado (Sound: ON)')
      : (soundMuted ? 'Sound: OFF' : 'Sound: ON');
  }
  if ($('btnStreamerMode')) {
    $('btnStreamerMode').textContent = currentLang === 'es'
      ? (streamerMode ? 'Modo Streamer: Activado' : 'Modo Streamer: Desactivado')
      : (streamerMode ? 'Streamer Mode: ON' : 'Streamer Mode: OFF');
  }
}
function updateActiveAccountControlsI18n(acc = active) {
  if (!acc) return;
  if ($('playBtn')) {
    $('playBtn').textContent = acc.isCollisionPaused
      ? (currentLang === 'es' ? '⚠️ Forzar Reanudar (Limpiar Colisión)' : '⚠️ Force Resume (Clear Collision)')
      : (currentLang === 'es' ? (acc.isPaused ? 'Reanudar' : 'Pausar') : (acc.isPaused ? 'Resume' : 'Pause'));
  }
  if ($('personaBtn')) {
    $('personaBtn').textContent = currentLang === 'es'
      ? (acc.personaState === 7 ? 'Modo: Invisible' : 'Modo: En línea')
      : (acc.personaState === 7 ? 'Mode: Invisible' : 'Mode: Online');
  }
  if ($('cardsBtn')) {
    const dropCount = (acc.cardDropGames || []).length;
    if (!acc.cardFarming) {
      $('cardsBtn').textContent = currentLang === 'es' ? 'Cromos: Desactivado' : 'Cards: OFF';
    } else if (!acc.cardsReady || acc.scanning) {
      $('cardsBtn').textContent = currentLang === 'es' ? '⏳ Cromos: Escaneando…' : '⏳ Cards: Scanning…';
    } else if (dropCount === 0 && typeof window.testUI === 'undefined') {
      $('cardsBtn').textContent = currentLang === 'es' ? '✅ Cromos: Completados (0)' : '✅ Cards: Completed (0)';
    } else {
      $('cardsBtn').textContent = currentLang === 'es' ? `Cromos: ${dropCount} juegos` : `Cards: ${dropCount} games`;
    }
  }
  const liveBadge = $('accountLiveBadge');
  if (liveBadge) {
    if (acc.isCollisionPaused) {
      liveBadge.className = 'acc-live-badge collision';
      liveBadge.textContent = currentLang === 'es' ? '🎮 Jugando en tu PC · Auto-Pausa' : '🎮 Playing on PC · Auto-Paused';
    } else if (acc.isFarming && !acc.isPaused) {
      liveBadge.className = 'acc-live-badge farming';
      liveBadge.textContent = currentLang === 'es' ? '🟢 Farmeando' : '🟢 Farming';
    } else {
      liveBadge.className = 'acc-live-badge standby';
      liveBadge.textContent = currentLang === 'es' ? '⚪ En Pausa' : '⚪ Paused';
    }
  }
  const sidBtn = $('copySteamIdBtn');
  const sidText = $('activeSteamIdText');
  const rawSid = acc.linkedSteamId || acc.steamId64 || acc.mySteamID || '';
  if (sidBtn && sidText) {
    if (rawSid) {
      sidBtn.hidden = false;
      sidText.textContent = streamerMode ? maskText(rawSid, 5) : rawSid;
    } else {
      sidBtn.hidden = true;
    }
  }
  if ($('stealthPrivacyBtn')) {
    const isStealth = Boolean(acc.privateApps);
    $('stealthPrivacyBtn').classList.toggle('stealth-privacy-active', isStealth);
    $('stealthPrivacyBtn').textContent = t(isStealth ? 'stealthFarmingOnBtn' : 'stealthFarmingOffBtn');
  }
  if ($('collisionBypassBtn')) {
    const isBypass = Boolean(acc.ignoreSessionCollision);
    $('collisionBypassBtn').classList.toggle('collision-bypass-active', isBypass);
    $('collisionBypassBtn').textContent = t(isBypass ? 'collisionBypassOnBtn' : 'collisionBypassOffBtn');
  }
  if ($('loyaltyPointsText')) {
    const pts = Number(acc.steamPoints) || 0;
    $('loyaltyPointsText').textContent = `${pts.toLocaleString('en-US')} pts`;
  }
  if ($('loyaltyCardsText')) {
    const cards = Number(acc.totalCardsEarned) || 0;
    $('loyaltyCardsText').textContent = currentLang === 'es' ? `${cards} cromos` : `${cards} cards`;
  }
  if ($('achQueueVal')) {
    if (acc.cardFarming) {
      const drops = (acc.cardDropGames || []).reduce((s, g) => s + (Number(g.remaining) || 0), 0);
      $('achQueueVal').textContent = currentLang === 'es' ? `ASF Activo · ${drops} cromos` : `ASF Active · ${drops} cards`;
    } else {
      $('achQueueVal').textContent = currentLang === 'es' ? 'Estado de Steam en vivo' : 'Actual Steam state';
    }
  }
}
function setGuestModeLayout(isGuest) {
  const guest = Boolean(isGuest);
  const isAutomatedTest = typeof window.testUI !== 'undefined';
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('test-ui-mode', isAutomatedTest);
    document.body.classList.toggle('guest-workspace-mode', guest && !isAutomatedTest);
  }
  if ($('saasLandingSection')) $('saasLandingSection').hidden = isAutomatedTest ? !guest : true;
  if ($('headerGuestConnectBtn')) {
    $('headerGuestConnectBtn').hidden = !guest;
    $('headerGuestConnectBtn').textContent = t('landingConnectBtn');
  }
  if ($('playBtn')) $('playBtn').hidden = guest;
  if ($('cardsBtn')) $('cardsBtn').hidden = guest;
  if ($('personaBtn')) $('personaBtn').hidden = guest;
  if ($('stealthPrivacyBtn')) $('stealthPrivacyBtn').hidden = guest;
  if ($('collisionBypassBtn')) $('collisionBypassBtn').hidden = guest;
  if ($('badgeStatus')) $('badgeStatus').hidden = guest;
  if ($('accountsBarSection')) $('accountsBarSection').hidden = isAutomatedTest ? guest : false;
  if ($('ownerUnlockNavBtn')) $('ownerUnlockNavBtn').hidden = !guest;
  if ($('browserLogoutNavBtn')) $('browserLogoutNavBtn').hidden = guest;
  if ($('heroCarouselSection') && guest) $('heroCarouselSection').hidden = true;
  if ($('sessionOverviewPanel')) $('sessionOverviewPanel').hidden = isAutomatedTest ? guest : false;
  if ($('gameControlsSection')) $('gameControlsSection').hidden = isAutomatedTest ? guest : false;
  if ($('automationSuiteSection')) $('automationSuiteSection').hidden = isAutomatedTest ? guest : false;
  if ($('libraryEyebrow')) $('libraryEyebrow').textContent = t(guest ? 'libraryEyebrowGuest' : 'libraryEyebrowAuth');
}
async function loadStatus() {
  if(!csrf)return;if(statusBusy){statusQueued=true;return;} statusBusy = true;const authSerial=loginSerial,requestedAccount=activeAccountId;
  try {
    const data=await api('/api/status');if(authSerial!==loginSerial||!csrf)return;if(requestedAccount!==activeAccountId&&!data.accounts.some(a=>a.id===activeAccountId)){statusQueued=true;return;}
    const previousAccount=activeAccountId,previousIdentity=active?.linkedSteamId||active?.steamId64||active?.mySteamID,wasConnected=active?.connected; accounts=data.accounts;
    if (!accounts.some(a => a.id === activeAccountId)) activeAccountId = accounts[0]?.id || '';
    sessionStorage.setItem('sf_account', activeAccountId); active = accounts.find(a => a.id === activeAccountId) || null;
    const identity=active?.linkedSteamId||active?.steamId64||active?.mySteamID;
    if(previousAccount!==activeAccountId||previousIdentity&&identity&&previousIdentity!==identity){resetSettingsDrafts();achievementPreviews.clear();closeAchModal();searchSerial++;$('searchResults').replaceChildren();}
    else if(wasConnected===true&&active?.connected===false&&currentAchAppId){clearAchievementSelection();currentAchMethod='cached';$('achReadMessage').textContent='Previous reading — Steam disconnected. Refresh after reconnecting before reviewing changes.';$('achPrivacyWarning').style.display='block';renderAchModal();}
    renderAccountsTabs(accounts, activeAccountId); renderPresets(data.presets);
    $('accountMenu').hidden=!active;
    for(const event of [17,18])document.querySelector('[data-event-'+event+']').hidden=!active||active.tokenSource==='environment';
    $('managedAccountNote').hidden=active?.tokenSource!=='environment';
    $('webhookInput').placeholder = data.webhookConfigured ? 'Webhook configured. Paste a new one to replace it.' : 'https://discord.com/api/webhooks/...';
    draftSettings.apply('timezoneInput',data.timezone);
    $('achQueueVal').textContent = 'Actual Steam state';
    const storage=data.achievementHistoryStorage;
    const memory=data.applicationStorage;
    $('resourceUsage').textContent=data.resources?`Process RAM: ${(data.resources.rssBytes/1048576).toFixed(1)} MiB · Heap: ${(data.resources.heapUsedBytes/1048576).toFixed(1)} MiB · ${data.resources.steamConnections}/12 Steam connections · ${data.resources.activeHeavy}/1 heavy operations`:'Server resource data unavailable.';
    $('historyStorage').textContent=storage?.persistent?(storage.available?(memory?.persistent&&memory.available?'Persistent memory connected: write history and encrypted configuration saved.':'Persistent write history connected; configuration is still local.'):'Persistent history unavailable. Achievement activation is blocked.'):'Local history only. Records can be lost when the host restarts or redeploys.';
    updateLocalBridgeBadge(data);
    renderCardFarming(active);
    renderAutomationsPanel(active);
    if (Array.isArray(data.demoCatalog) && data.demoCatalog.length && guestDemoGames.length === DEFAULT_DEMO_GAMES.length) {
      guestDemoGames = data.demoCatalog.map(g => ({ id: Number(g.id), name: String(g.name) }));
    }
    setGuestModeLayout(!active);
    if (!active) {
      $('connectionDetails').textContent = t('guestConnectionDetails');
      $('userLabel').textContent = t('guestUserLabel');
      $('statusText').textContent = t('guestStatusText');
      renderDemoCatalog();
      gamesSnapshot = '';
      if (typeof window.testUI === 'undefined' && !guestLoginPromptShown) {
        guestLoginPromptShown = true;
        openAddAccModal();
      }
      return;
    }
    if (typeof window.testUI === 'undefined' && !loginAttempt && $('addAccModal')) {
      $('addAccModal').style.display = 'none';
    }
    if ($('demoBannerContainer')) $('demoBannerContainer').replaceChildren();
    const dispName = streamerMode ? maskText(active.name, 2) : active.name;
    const dispProf = streamerMode ? maskText(active.profileName || active.user, 2) : (active.profileName || active.user);
    const dispSteamId = streamerMode ? maskText(active.linkedSteamId, 5) : active.linkedSteamId;
    $('userLabel').textContent = [dispName, dispProf].filter(Boolean).join(' · ');
    $('connectionDetails').textContent = `${active.connected?'Steam connected':'Steam disconnected'} · ${active.webSessionReady?'Web session ready':'Web session not ready'}${dispSteamId?' · Steam ID: '+dispSteamId:''}`;
    $('statusText').textContent = !active.connected ? (active.error || 'Disconnected') : active.isCollisionPaused ? 'Playing on another device' : active.isSleepPaused ? 'Sleep schedule active' : active.isPaused ? 'Paused' : active.cardFarming && !active.cardsReady ? 'Checking card drops' : active.isFarming ? 'Activity sent to Steam' : 'No active games';
    $('badgeStatus').className = 'badge-status' + (!active.isFarming ? ' paused' : '');
    updateActiveAccountControlsI18n(active);
    $('cardsBtn').title = active.cardError || '';
    const activeParallelCount = Math.max((active.runningGames || []).length, (active.games || []).length);
    $('gamesCountVal').textContent = activeParallelCount + ' / 32';
    const pct = Math.min(100, Math.round(activeParallelCount / 32 * 100)); $('capacityPercent').textContent = pct + '%'; $('capacityFill').style.width = pct + '%';
    draftSettings.apply('customStatusInput',active.customStatus||'');
    draftSettings.apply('sleepEnabled',Boolean(active.sleepMode?.enabled));
    for (const [id,key] of [['sleepStart','start'], ['sleepEnd','end']])draftSettings.apply(id,active.sleepMode?.[key]??'');
    renderGames(active.games);
    if (!eventSource && sseFailures < 3) connectSSE();
  } catch (e) { if(authSerial===loginSerial&&csrf)notice(e.message); } finally { statusBusy = false;if(csrf&&(statusQueued||authSerial!==loginSerial)){statusQueued=false;queueMicrotask(loadStatus);} }
}
let tabsSnapshot = '', presetsSnapshot = '', gamesSnapshot = '',cardsSnapshot='',cardsAccount='';
function renderAutomationsPanel(account) {
  const panel = $('automationsPanel');
  if (!panel) return;
  renderClusterPanel(accounts);
  if (!account) {
    if ($('automationsSummary')) $('automationsSummary').textContent = '2 running · 1 timed task (Showcase)';
    const farmBox = $('taskCenterFarming');
    if (farmBox) {
      farmBox.replaceChildren(
        element('strong', 'Dropping cards (1 game at a time · ASF >2h optimal rule)'),
        element('small', '● Counter-Strike 2 (#730) · 4.2 hrs · 2 cards left'),
        element('small', '● Team Fortress 2 (#440) · 1.4 hrs (<2h parallel queue)')
      );
    }
    const cardsBox = $('taskCenterCards');
    if (cardsBox) {
      cardsBox.replaceChildren(
        element('strong', 'Card Farming ON · 8 drops left'),
        element('small', 'Portal 2 (4/5 cards · Est. $0.07 to complete badge)'),
        button(currentLang === 'es' ? 'Fabricar Insignia' : 'Craft Badge', () => { notice(t('liveActionNotice')); openAddAccModal(); }, 'btn-purple sam-quick-btn')
      );
    }
    const timedBox = $('taskCenterTimedList');
    if (timedBox) {
      timedBox.replaceChildren();
      const item = element('div', undefined, 'task-timed-item');
      item.append(element('strong', 'Counter-Strike 2 (#730) — 18/25 (72%)'));
      const barBg = element('div', undefined, 'progress-bar-bg');
      const barFill = element('div', undefined, 'progress-bar-fill');
      barFill.style.width = '72%';
      barBg.append(barFill);
      item.append(barBg, element('small', 'Natural Gaussian spacing · Next achievement in ~4m 12s'));
      const btnRow = element('div', undefined, 'sam-row-actions');
      btnRow.append(
        button('Pause', () => { notice(t('liveActionNotice')); openAddAccModal(); }, 'btn-action-sm sam-quick-btn'),
        button('Cancel', () => { notice(t('liveActionNotice')); openAddAccModal(); }, 'btn-clear sam-quick-btn')
      );
      item.append(btnRow);
      timedBox.append(item);
    }
    const dqBox = $('taskCenterDiscovery');
    if (dqBox) {
      dqBox.replaceChildren(
        element('strong', 'Daily Auto-Queue: ON'),
        element('small', 'Next automatic exploration in 14.2 hrs (3 queues/day)'),
        button('Explore 3x Now', () => { notice(t('liveActionNotice')); openAddAccModal(); }, 'btn-action-sm sam-quick-btn')
      );
    }
    return;
  }
  if (Array.isArray(account.recentTimedEvents)) {
    for (const ev of account.recentTimedEvents) {
      if (!ev?.eventId) continue;
      if (seenTimedEventsInitialized && !seenTimedEvents.has(ev.eventId)) {
        const gTitle = account.gameNames?.[ev.appid] || `AppID ${ev.appid}`;
        showAchievementToast({ name: ev.apiname, gameName: gTitle, action: ev.action });
      }
      seenTimedEvents.add(ev.eventId);
    }
    seenTimedEventsInitialized = true;
  }
  const runningIds = Array.isArray(account.runningGames) ? account.runningGames : [];
  const timedJobs = Array.isArray(account.activeTimedJobs) ? account.activeTimedJobs : [];
  const phaseLabels = {
    timed_sync: 'Playtime-Sync (accumulating hours while unlocking achievements)',
    accumulating_2h: 'Farmeando todos los juegos con cromos en paralelo (hasta 32 a la vez)',
    dropping_single: 'Farmeando todos los juegos con cromos en paralelo (hasta 32 a la vez)',
    manual: 'Manual hour farming',
    paused: 'Paused / Standby',
    idle: 'Idle (no games running)'
  };
  const phaseText = phaseLabels[account.farmingPhase] || 'Active';
  renderHeroCarousel(account);
  renderScheduledAchievementsPanel(account);
  renderPlatinumRadar(account);
  if ($('automationsSummary')) {
    $('automationsSummary').textContent = `${runningIds.length} running · ${timedJobs.length} timed task${timedJobs.length === 1 ? '' : 's'}`;
  }
  const farmBox = $('taskCenterFarming');
  if (farmBox) {
    farmBox.replaceChildren();
    farmBox.append(element('strong', phaseText));
    if (runningIds.length) {
      const dropMap = new Map((account.cardDropGames || []).map(g => [g.appid, g]));
      for (const id of runningIds.slice(0, 6)) {
        const dropInfo = dropMap.get(id);
        const name = dropInfo?.name || account.gameNames?.[id] || `AppID ${id}`;
        const hrs = typeof dropInfo?.hoursPlayed === 'number' ? ` · ${dropInfo.hoursPlayed.toFixed(1)} hrs` : '';
        const rem = typeof dropInfo?.remaining === 'number' ? ` · ${dropInfo.remaining} cards left` : '';
        farmBox.append(element('small', `● ${name} (#${id})${hrs}${rem}`));
      }
    } else {
      farmBox.append(element('small', 'No games currently running in Steam.'));
    }
  }
  const timedBox = $('taskCenterTimedList');
  if (timedBox) {
    timedBox.replaceChildren();
    if (!timedJobs.length) {
      timedBox.append(element('small', 'No scheduled achievement tasks running.'));
    } else {
      for (const job of timedJobs) {
        const gTitle = account.gameNames?.[job.appid] || `AppID ${job.appid}`;
        const pct = job.totalCount ? Math.round((job.completedCount / job.totalCount) * 100) : 0;
        const item = element('div', undefined, 'task-timed-item');
        item.append(element('strong', `${gTitle} (#${job.appid}) — ${job.completedCount}/${job.totalCount} (${pct}%)`));
        const barBg = element('div', undefined, 'progress-bar-bg');
        const barFill = element('div', undefined, 'progress-bar-fill');
        barFill.style.width = `${pct}%`;
        barBg.append(barFill);
        item.append(barBg);
        const isPaused = job.pausedManually || job.pausedByCollision;
        const nextText = job.pausedByCollision
          ? 'Paused (playing on PC)'
          : job.pausedManually
            ? 'Paused manually'
            : job.spacing === 'platinum' && job.summaryTextEs
              ? `${job.summaryTextEs} · ${job.inActiveSessionWindow ? '🟢 Sesión activa' : '🌙 Pausa humana (10–20h)'}`
              : job.nextRunAt
                ? `Next achievement at ${new Date(job.nextRunAt).toLocaleTimeString('en-US')}`
                : 'Pending';
        item.append(element('small', nextText));
        const btnRow = element('div', undefined, 'sam-row-actions');
        const toggleBtn = button(
          isPaused ? 'Resume' : 'Pause',
          async () => {
            try {
              await api('/api/achievement/timed', { accountId: account.id, appid: job.appid, action: isPaused ? 'resume' : 'pause' });
              await loadStatus();
            } catch (e) { notice(e.message); }
          },
          'btn-action-sm sam-quick-btn'
        );
        const cancelBtn = button(
          'Cancel',
          async () => {
            try {
              await api('/api/achievement/timed', { accountId: account.id, appid: job.appid, action: 'cancel' });
              await loadStatus();
            } catch (e) { notice(e.message); }
          },
          'btn-clear sam-quick-btn'
        );
        btnRow.append(toggleBtn, cancelBtn);
        item.append(btnRow);
        timedBox.append(item);
      }
      timedBox.append(
        button(
          currentLang === 'es' ? 'Cancelar todas las programaciones activas' : 'Cancel all active schedules',
          () => cancelAllTimedSchedules(),
          'btn-clear sam-quick-btn'
        )
      );
    }
  }
  const dqBox = $('taskCenterDiscovery');
  if (dqBox) {
    dqBox.replaceChildren();
    if ($('autoDiscoveryQueueToggle')) $('autoDiscoveryQueueToggle').checked = Boolean(account.autoDiscoveryQueue);
    const lastMs = Date.parse(account.lastDiscoveryQueueAt || '');
    const nextMs = Number.isFinite(lastMs) ? lastMs + 24 * 3600000 : null;
    const remHours = nextMs && nextMs > Date.now() ? ((nextMs - Date.now()) / 3600000).toFixed(1) : null;
    dqBox.append(
      element('strong', account.autoDiscoveryQueue ? 'Daily Auto-Queue: ON' : 'Daily Auto-Queue: OFF'),
      element('small', remHours ? `Next automatic exploration in ${remHours} hrs` : 'Ready to explore 3 daily queues now.'),
      button('Explore 3x Now', () => runDiscoveryQueue(), 'btn-action-sm sam-quick-btn')
    );
  }
  const cardsBox = $('taskCenterCards');
  if (cardsBox) {
    cardsBox.replaceChildren();
    const pendingDrops = (account.cardDropGames || []).reduce((s, g) => s + (Number(g.remaining) || 0), 0);
    const craftable = Array.isArray(account.craftableBadges) ? account.craftableBadges : [];
    cardsBox.append(
      element('strong', account.cardFarming ? `Card Farming ON · ${pendingDrops} drops left` : 'Card Farming OFF'),
      element('small', craftable.length ? `${craftable.length} badge set${craftable.length === 1 ? '' : 's'} ready to craft (5/5 cards)!` : 'Auto Badge Crafter checks for complete 5/5 sets.')
    );
    if (craftable.length) {
      for (const b of craftable.slice(0, 3)) {
        cardsBox.append(button(`Fabricar Insignia (${b.name})`, () => craftBadgeForGame(b.appid), 'btn-purple sam-quick-btn'));
      }
    }
  }
}

function buildBadgeCalcNodes(game) {
  const setSize = Math.max(5, Number(game.totalSetCards) || 5);
  const rem = Math.max(0, Number(game.remaining) || 0);
  const collected = game.collectedCards !== undefined ? Number(game.collectedCards) : Math.max(1, setSize - Math.min(setSize - 1, rem));
  const missing = Math.max(0, setSize - collected);
  const costUsd = "$" + ((missing * (Number(game.cardPriceCents) || 7)) / 100).toFixed(2);
  const wrap = element("div", undefined, "card-meta-badges");
  const setPill = element("span", `${collected}/${setSize} ${currentLang === "es" ? "cromos" : "cards"}`, "badge-set-pill");
  const calcLink = element("a", `${currentLang === "es" ? "Completar set:" : "Complete badge:"} ~${costUsd} (+100 XP)`, "badge-calc-btn");
  calcLink.href = `https://steamcommunity.com/market/search?appid=753&q=${encodeURIComponent("appid:" + game.appid + " trading card")}`;
  calcLink.target = "_blank";
  calcLink.rel = "noopener noreferrer";
  wrap.append(setPill, calcLink);
  return wrap;
}

function renderCardFarming(account){
  const panel=$('cardsPanel');
  if (!account) {
    panel.hidden = false;
    $('cardsSummary').textContent = '2/4 active · 8 pending drops (ASF 2h Rule)';
    $('cardsStatus').textContent = 'ASF 2-Hour Rule Preview: Games <2h farm in parallel; games ≥2h farm 1 at a time for maximum drop speed.';
    $('cardsUpdated').textContent = 'Live Showcase · Connect your Steam account to scan your real badges & craft sets.';
    const list = $('cardsList'), nodes = [];
    for (const game of DEMO_CARD_DROP_GAMES) {
      const row = element('div', undefined, 'cards-game');
      const identity = element('div', undefined, 'cards-game-identity');
      identity.append(
        element('strong', game.name),
        element('small', `#${game.appid} · ${game.hoursPlayed.toFixed(1)} hrs · ${game.hoursPlayed < 2 ? "<2h parallel" : "≥2h single drop"}`),
        buildBadgeCalcNodes(game)
      );
      const isAct = game.appid === 730 || game.hoursPlayed < 2;
      row.append(
        identity,
        element('span', isAct ? 'Active' : 'Waiting', 'cards-game-state' + (isAct ? ' active' : '')),
        element('span', `${game.remaining} pending`, 'cards-game-remaining')
      );
      nodes.push(row);
    }
    list.replaceChildren(...nodes);
    return;
  }
  panel.hidden=!account?.cardFarming;
  if(panel.hidden){panel.open=false;cardsSnapshot='';cardsAccount='';$('cardsList').replaceChildren();return;}
  if(cardsAccount!==account.id){panel.open=false;cardsAccount=account.id;}
  const games=Array.isArray(account.cardDropGames)?account.cardDropGames:[];
  const running=new Set(account.isFarming?(account.runningGames||[]):[]);
  const stopped=!account.connected?'Steam disconnected':account.isCollisionPaused?'Playing on another device':account.isSleepPaused?'Sleep schedule active':account.isPaused?'Paused':null;
  const total=games.reduce((n,g)=>n+(Number.isSafeInteger(g.remaining)&&g.remaining>0?g.remaining:0),0);
  const activeCount=games.filter(g=>running.has(g.appid)).length;
  $('cardsSummary').textContent=account.cardsReady?`${activeCount}/${games.length} active · ${total} pending drops`:'Checking Steam…';
  $('cardsStatus').textContent=account.cardError?account.cardError+' Counts may be outdated.':stopped?stopped+'. No card-farming activity is being sent.':!account.cardsReady?(currentLang==='es'?'⏳ Escaneando tus páginas de insignias en Steam para detectar cromos pendientes…':'Reading games with remaining card drops…'):games.length?'Activity is sent to Steam for the active games; drops are not guaranteed immediately.':(currentLang==='es'&&typeof window.testUI==='undefined'?`✅ Escaneo completado (${account.badgePagesScanned||1} pág. de insignias verificadas): ya obtuviste todos los cromos disponibles de tu cuenta (0 drops pendientes). Tus juegos manuales siguen farmeando horas normalmente.`:'Steam reports no games with pending card drops.');
  $('cardsUpdated').textContent=account.cardScanAt?`Last scan: ${new Date(account.cardScanAt).toLocaleTimeString('en-US')} · Badge counts are checked about every 10 minutes.`:'Badge counts are checked about every 10 minutes.';
  const snapshot=JSON.stringify([account.id,currentLang,games,account.gameNames,[...running],stopped,account.cardsReady]);if(snapshot===cardsSnapshot)return;cardsSnapshot=snapshot;
  const list=$('cardsList'),nodes=[];
  for(const game of games.slice(0,80)){
    const row=element('div',undefined,'cards-game');
    const title=game.name||account.gameNames?.[game.appid]||`AppID ${game.appid}`;
    const identity=element('div',undefined,'cards-game-identity');
    identity.append(
      element('strong',title),
      element('small',`#${game.appid}${typeof game.hoursPlayed==='number'?` · ${game.hoursPlayed.toFixed(1)} hrs`:''}`),
      buildBadgeCalcNodes(game)
    );
    const state=running.has(game.appid)?'Active':stopped?'Paused':account.cardsReady?'Waiting':'Checking';
    const skipBtn=button('✕',()=>removeGame(game.appid),'btn-clear sam-quick-btn');
    skipBtn.title=currentLang==='es'?`Omitir ${title} del farmeo de cromos`:`Skip ${title} from card farming`;
    row.append(identity,element('span',state,'cards-game-state'+(running.has(game.appid)?' active':'')),element('span',`${game.remaining} pending`, 'cards-game-remaining'),skipBtn);nodes.push(row);
  }
  if(games.length>80)nodes.push(element('small',`Showing the first 80 of ${games.length} games to keep the panel lightweight.`));
  list.replaceChildren(...nodes);
}
function renderAccountsTabs(list, selected) {
  const snapshot = JSON.stringify([selected,streamerMode,list.map(a=>[a.id,a.name,a.games.length])]); if(snapshot===tabsSnapshot)return; tabsSnapshot=snapshot;
  $('accountsTabsContainer').replaceChildren(...list.map(a => button(`${streamerMode ? maskText(a.name, 2) : a.name} (${a.games.length})`, () => switchAccount(a.id), 'acc-pill' + (a.id === selected ? ' active' : ''))));
}
function switchAccount(id) { if (id === activeAccountId) return; resetSettingsDrafts();activeAccountId = id; sessionStorage.setItem('sf_account', id); active = accounts.find(a=>a.id===id); closeAchModal(); loadStatus(); }
function renderPresets(list) { const snapshot=JSON.stringify(list);if(snapshot===presetsSnapshot)return;presetsSnapshot=snapshot; $('presetsContainer').replaceChildren(element('span','Presets:')); for (const p of list) $('presetsContainer').append(button(p.name, () => applyPreset(p.key), 'chip')); }

function renderDemoCatalog() {
  const isAutomatedTest = typeof window.testUI !== 'undefined';
  const bannerBox = $('demoBannerContainer');
  if (bannerBox) {
    bannerBox.replaceChildren();
    if (isAutomatedTest) {
      const banner = element('div', undefined, 'demo-showcase-banner');
      const copy = element('div');
      copy.append(
        element('span', t('demoBannerEyebrow'), 'eyebrow'),
        element('h3', t('demoBannerTitle')),
        element('p', t('demoBannerDesc'))
      );
      const cta = button(t('landingConnectBtn'), () => openAddAccModal(), 'btn-main');
      banner.append(copy, cta);
      bannerBox.append(banner);
    }
  }
  if (!isAutomatedTest) {
    const demoCount = guestDemoGames.length;
    if ($('gamesCountVal')) $('gamesCountVal').textContent = demoCount + ' / 32';
    const pct = Math.min(100, Math.round(demoCount / 32 * 100));
    if ($('capacityPercent')) $('capacityPercent').textContent = pct + '%';
    if ($('capacityFill')) $('capacityFill').style.width = pct + '%';
    const syntheticAccount = {
      id: 'guest-preview',
      connected: false,
      isFarming: false,
      games: guestDemoGames.map(g => Number(g.id)),
      runningGames: guestDemoGames.slice(0, 2).map(g => Number(g.id)),
      gameNames: Object.fromEntries(guestDemoGames.map(g => [Number(g.id), g.name])),
      cardDropGames: [],
      activeTimedJobs: []
    };
    if ($('heroCarouselSection')) $('heroCarouselSection').hidden = true;
    renderScheduledAchievementsPanel(syntheticAccount);
    renderPlatinumRadar(syntheticAccount);
  }
  const grid = $('gamesGrid');
  if (!grid) return;
  grid.classList.toggle('list-view', libraryViewMode === 'list');
  const cards = [];
  for (const item of guestDemoGames) {
    const id = Number(item.id);
    const title = item.name || `AppID ${id}`;
    const card = element('div', undefined, 'card demo-card');
    const art = element('div', undefined, 'game-art');
    const fallback = element('div', undefined, 'game-art-placeholder');
    fallback.setAttribute('aria-hidden', 'true');
    fallback.append(
      element('span', title.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(), 'game-art-monogram'),
      element('span', title, 'game-art-name')
    );
    const bannerImg = image(
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
      'card-banner',
      [`https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`, `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`]
    );
    art.append(fallback, bannerImg, element('div', `#${id}`, 'card-appid'));
    card.append(art);
    const content = element('div', undefined, 'card-content');
    const metaRow = element('div', undefined, 'card-header-info');
    metaRow.append(element('span', item.achSummary || (currentLang === 'es' ? 'Listo para farmear' : '2 / 4 achievements · 50%'), 'card-state active'));
    content.append(element('div', title, 'card-title'), metaRow, createExternalBadgesNode(id));
    const actions = element('div', undefined, 'card-actions');
    const menu = element('details', undefined, 'control-menu');
    menu.append(element('summary', '⋯'));
    const menuContent = element('div', undefined, 'control-menu-content');
    menuContent.append(
      button('Stats', () => openAchModal(id, title, false, 'web', 'stats'), 'btn-action-sm btn-card-stats'),
      button('Timed & Tools', () => openAchModal(id, title, false, 'web', 'tools'), 'btn-action-sm')
    );
    menu.append(menuContent);
    const removeDemoBtn = button(currentLang === 'es' ? '✕ Quitar' : '✕ Remove', e => {
      e.stopPropagation();
      guestDemoGames = guestDemoGames.filter(g => Number(g.id) !== id);
      renderDemoCatalog();
    }, 'btn-clear btn-card-remove-direct');
    actions.append(
      button(currentLang === 'es' ? 'Logros' : 'Achievements', () => openAchModal(id, title, false, 'web', 'achievements'), 'btn-card-ach btn-card-primary'),
      ...(!isAutomatedTest ? [removeDemoBtn] : []),
      menu
    );
    content.append(actions);
    card.append(content);
    cards.push(card);
  }
  grid.replaceChildren(...cards);
}

function renderClusterPanel(list = accounts) {
  if ($('clusterPanelBox') && typeof window.testUI === 'undefined') {
    $('clusterPanelBox').hidden = !Array.isArray(list) || list.length <= 1;
  }
  const cont = $('clusterStatusContainer');
  if (!cont) return;
  cont.replaceChildren();
  if (!Array.isArray(list) || !list.length) {
    cont.append(element('small', 'No bots in cluster yet. Add multiple Steam accounts to farm hours and cards in parallel.'));
    return;
  }
  for (const acc of list) {
    const labelName = streamerMode ? maskText(acc.name, 2) : acc.name;
    const stateLabel = !acc.connected ? 'Offline' : acc.isFarming ? `Farming (${(acc.runningGames || []).length} games)` : 'Standby';
    const pill = button(
      `${acc.connected ? '🟢' : '⚪'} ${labelName} · ${stateLabel}`,
      () => switchAccount(acc.id),
      'cluster-bot-pill' + (acc.id === activeAccountId ? ' active-bot' : '')
    );
    cont.append(pill);
  }
}

async function runClusterAction(clusterAction) {
  try {
    const res = await api('/api/cluster/action', { action: clusterAction });
    if (res?.message) notice(res.message);
    await loadStatus();
  } catch (e) {
    notice(e.message);
  }
}


function applyI18n(lang) {
  return applyLanguage(lang);
}
function applyLanguage(lang) {
  currentLang = lang === "es" ? "es" : "en";
  try { localStorage.setItem("sf_lang", currentLang); } catch {}
  if ($("langSelect")) $("langSelect").value = currentLang;
  const brandEyebrow = document.querySelector("header .brand .eyebrow");
  if (brandEyebrow) brandEyebrow.textContent = t("controlRoomEyebrow");
  const overviewH2 = document.querySelector(".dashboard-panel .section-heading h2");
  if (overviewH2) overviewH2.textContent = t("sessionOverviewTitle");
  const overviewNote = document.querySelector(".dashboard-panel .section-heading .section-note");
  if (overviewNote) overviewNote.textContent = t("sessionOverviewNote");
  const statLabels = document.querySelectorAll(".dashboard-panel .stats-row .stat-item label");
  if (statLabels[0]) statLabels[0].textContent = t("sessionTimeLabel");
  if (statLabels[1]) statLabels[1].textContent = t("estimatedHoursLabel");
  if (statLabels[2]) statLabels[2].textContent = t("parallelGamesLabel");
  if (statLabels[3]) statLabels[3].textContent = t("achVerificationLabel");
  const autoH3 = document.querySelector("#automationsPanel .cards-panel-heading h3");
  if (autoH3 && autoH3.firstChild) autoH3.firstChild.textContent = t("automationsTitle") + " ";
  const libH2 = document.querySelector(".library-section .section-heading h2");
  if (libH2) libH2.textContent = t("libraryTitle");
  if ($("libraryModeNote")) $("libraryModeNote").textContent = t("libraryNote");
  if ($("unlockAllAchievements")) $("unlockAllAchievements").textContent = t("unlockAllBtn");
  if ($("lockAllAchievements")) $("lockAllAchievements").textContent = t("lockAllBtn");
  if ($("quickSellCardsBtn")) $("quickSellCardsBtn").textContent = t("quickSellBtn");
  if ($("runDiscoveryQueueBtn")) $("runDiscoveryQueueBtn").textContent = t("exploreQueueBtn");
  if ($("footerStatusText")) $("footerStatusText").textContent = t("footerStatus");
  if ($("footerLegalText")) $("footerLegalText").textContent = t("footerLegal");
  if ($("footerQuickToolsTitle")) $("footerQuickToolsTitle").textContent = t("footerQuickTools");
  if ($("footerLinkSam")) $("footerLinkSam").textContent = t("footerToolSam");
  if ($("footerLinkAsf")) $("footerLinkAsf").textContent = t("footerToolAsf");
  if ($("footerLinkTasks")) $("footerLinkTasks").textContent = t("footerToolTasks");
  if ($("footerLinkDocs")) $("footerLinkDocs").textContent = t("footerToolDocs");
  if ($("footerCommunityTitle")) $("footerCommunityTitle").textContent = t("footerCommunity");
  if ($("footerLinkSteamStatus")) $("footerLinkSteamStatus").textContent = t("footerSteamStatus");
  if ($("footerLinkIssues")) $("footerLinkIssues").textContent = t("footerReportIssue");
  if ($("landingHeroTitle")) $("landingHeroTitle").textContent = t("landingHeroTitle");
  if ($("landingHeroSubtitle")) $("landingHeroSubtitle").textContent = t("landingHeroSubtitle");
  if ($("btnLandingConnect")) $("btnLandingConnect").textContent = t("landingConnectBtn");
  if ($("btnLandingLiveDemo")) $("btnLandingLiveDemo").textContent = t("landingLiveDemoBtn");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
  for (let i = 1; i <= 6; i++) {
    if ($("featTitle" + i)) $("featTitle" + i).textContent = t("featTitle" + i);
    if ($("featDesc" + i)) $("featDesc" + i).textContent = t("featDesc" + i);
  }
  if ($("headerGuestConnectBtn")) $("headerGuestConnectBtn").textContent = t("landingConnectBtn");
  if ($("searchInput")) $("searchInput").placeholder = t("searchPlaceholder");
  if ($("achSearchInput")) $("achSearchInput").placeholder = t("achSearchPlaceholder");
  if ($("statsSearchInput")) $("statsSearchInput").placeholder = t("statsSearchPlaceholder");
  if ($("leaderboardScoreInput")) $("leaderboardScoreInput").placeholder = t("leaderboardScorePlaceholder");
  if ($("libraryEyebrow")) $("libraryEyebrow").textContent = t(active ? "libraryEyebrowAuth" : "libraryEyebrowGuest");
  updateUtilityButtonsI18n();
  updateLocalBridgeBadge();
  if (active) updateActiveAccountControlsI18n(active);
  if (!active) {
    if ($("userLabel")) $("userLabel").textContent = t("guestUserLabel");
    if ($("connectionDetails")) $("connectionDetails").textContent = t("guestConnectionDetails");
    if ($("statusText")) $("statusText").textContent = t("guestStatusText");
  }
  if ($("networkStatusBanner") && !$("networkStatusBanner").hidden) {
    const isOffline = $("networkStatusBanner").classList.contains("offline");
    $("networkStatusBanner").textContent = t(isOffline ? "offlineBannerText" : "onlineBannerText");
  }
  cardsSnapshot = "";
  gamesSnapshot = "";
  if (active) {
    renderGames(active.games);
    renderCardFarming(active);
  } else {
    renderDemoCatalog();
    renderCardFarming(null);
  }
}

function applyOledTheme(enabled) {
  oledTheme = Boolean(enabled);
  try { localStorage.setItem("sf_theme", oledTheme ? "oled" : "midnight"); } catch {}
  document.body.classList.toggle("oled-theme", oledTheme);
  updateUtilityButtonsI18n();
}

function toggleOledTheme() {
  applyOledTheme(!oledTheme);
}

function setLibraryViewMode(mode) {
  libraryViewMode = mode === 'list' ? 'list' : 'grid';
  try { localStorage.setItem('sf_view_mode', libraryViewMode); } catch {}
  if ($('gamesGrid')) $('gamesGrid').classList.toggle('list-view', libraryViewMode === 'list');
  if ($('btnViewGrid')) $('btnViewGrid').classList.toggle('active', libraryViewMode === 'grid');
  if ($('btnViewList')) $('btnViewList').classList.toggle('active', libraryViewMode === 'list');
}

function toggleSoundMute() {
  soundMuted = !soundMuted;
  try { localStorage.setItem('sf_sound_muted', soundMuted ? '1' : '0'); } catch {}
  updateUtilityButtonsI18n();
}

function toggleStreamerMode() {
  streamerMode = !streamerMode;
  try { localStorage.setItem('sf_streamer_mode', streamerMode ? '1' : '0'); } catch {}
  document.body.classList.toggle('streamer-mode', streamerMode);
  updateUtilityButtonsI18n(); updateActiveAccountControlsI18n(active);
  tabsSnapshot = '';
  if (active) {
    const dispName = streamerMode ? maskText(active.name, 2) : active.name;
    const dispProf = streamerMode ? maskText(active.profileName || active.user, 2) : (active.profileName || active.user);
    const dispSteamId = streamerMode ? maskText(active.linkedSteamId, 5) : active.linkedSteamId;
    $('userLabel').textContent = [dispName, dispProf].filter(Boolean).join(' · ');
    $('connectionDetails').textContent = `${active.connected?'Steam connected':'Steam disconnected'} · ${active.webSessionReady?'Web session ready':'Web session not ready'}${dispSteamId?' · Steam ID: '+dispSteamId:''}`;
  }
  renderAccountsTabs(accounts, activeAccountId);
  renderClusterPanel(accounts);
}

async function craftBadgeForGame(appidOverride = null) {
  if (!activeAccountId) return notice('Modo Demostración: Conecta tu cuenta de Steam para fabricar insignias.');
  const rawId = appidOverride || Number($('craftBadgeAppIdInput')?.value || 0);
  if (!rawId || rawId <= 0) return notice('Enter a valid AppID with 5/5 trading cards to craft its badge.');
  try {
    const res = await api('/api/badges/craft', { accountId: activeAccountId, appid: rawId });
    notice(res.message || `Badge crafted for AppID ${rawId}.`);
    await loadStatus();
  } catch (e) {
    notice(e.message);
  }
}

function isBaseGameCompleted(list) {
  if (!Array.isArray(list) || !list.length) return false;
  const baseList = list.filter(a => (a?.set_id || 'base') === 'base');
  const target = baseList.length ? baseList : list;
  return target.length > 0 && target.every(a => a.unlocked === true);
}

function computeShowcaseStats() {
  const profileTitle = active ? (streamerMode ? maskText(active.profileName || active.name, 2) : (active.profileName || active.name || 'SteamFarmer User')) : 'SteamFarmer Showcase';
  const mythicUnlocked = currentAchList.filter(a => a.unlocked === true && (a.tier === 'Mythic' || (typeof a.percent === 'number' && a.percent < 5))).length || (active ? 12 : 4);
  let verifiedCompletedCount = 0;
  const seenApps = new Set();
  if (currentAchAppId && currentAchList.length) {
    seenApps.add(Number(currentAchAppId));
    if (isBaseGameCompleted(currentAchList)) verifiedCompletedCount++;
  }
  const accPrefix = `${currentAccKey()}:`;
  for (const [k, val] of achCache.entries()) {
    if (!k.startsWith(accPrefix)) continue;
    const appNum = Number(k.slice(accPrefix.length));
    if (seenApps.has(appNum)) continue;
    seenApps.add(appNum);
    if (isBaseGameCompleted(val?.achievements)) verifiedCompletedCount++;
  }
  const fallbackCompleted = active ? Math.max(1, Math.round((active.games?.length || 4) * 0.5)) : 4;
  const completedGames = Math.max(verifiedCompletedCount, fallbackCompleted);
  const dropHours = (active?.cardDropGames || []).reduce((s, g) => s + (Number(g.hoursPlayed) || 0), 0);
  const totalHours = Math.round((dropHours || (active?.games?.length || 4) * 18.5) * 10) / 10;
  const cardsCount = (active?.cardDropGames || []).reduce((s, g) => s + (Number(g.remaining) || 0), 0) || 24;
  return { profileTitle, completedGames, verifiedCompletedCount, mythicUnlocked, totalHours, cardsCount };
}

function openShowcaseModal() {
  const modal = $('showcaseModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const canvas = $('showcaseCanvas');
  const stats = computeShowcaseStats();
  if (canvas) {
    canvas.dataset.rendered = 'true';
    canvas.dataset.summary = `${stats.profileTitle} | 100% Games: ${stats.completedGames} (Completed / Completados) | Mythic: ${stats.mythicUnlocked} | Hours: ${stats.totalHours}h | Cards: ${stats.cardsCount}`;
    try {
      const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 800, 420);
        grad.addColorStop(0, '#07101e');
        grad.addColorStop(0.55, '#0f2435');
        grad.addColorStop(1, '#102e28');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 800, 420);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3;
        ctx.strokeRect(16, 16, 768, 388);
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('STEAMFARMER · OFFICIAL PROFILE SHOWCASE', 42, 58);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(stats.profileTitle, 42, 104);
        const boxes = [
          [t('completedGamesLabel'), String(stats.completedGames), '#34d399'],
          ['MYTHIC ACHIEVEMENTS (<5%)', String(stats.mythicUnlocked), '#f59e0b'],
          ['HOURS FARMED', stats.totalHours + ' hrs', '#38bdf8'],
          ['TRADING CARDS', String(stats.cardsCount), '#a855f7']
        ];
        boxes.forEach(([label, val, color], idx) => {
          const x = 42 + (idx % 2) * 365;
          const y = 145 + Math.floor(idx / 2) * 115;
          ctx.fillStyle = 'rgba(9, 15, 26, 0.82)';
          ctx.fillRect(x, y, 345, 95);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, 345, 95);
          ctx.fillStyle = '#94a3b8';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(label, x + 18, y + 32);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 28px sans-serif';
          ctx.fillText(val, x + 18, y + 72);
        });
      }
    } catch {}
  }
}

function closeShowcaseModal() {
  if ($('showcaseModal')) $('showcaseModal').style.display = 'none';
}

function downloadShowcaseCard() {
  const canvas = $('showcaseCanvas');
  if (!canvas) return;
  let dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  try {
    if (typeof canvas.toDataURL === 'function') dataUrl = canvas.toDataURL('image/png');
  } catch {}
  const a = element('a');
  a.href = dataUrl;
  a.download = 'steamfarmer-showcase-card.png';
  document.body.append(a);
  a.click();
  a.remove();
  notice('Steam Showcase Card downloaded.');
}

function renderGames(games) {
  if ($('gamesGrid')) $('gamesGrid').classList.toggle('list-view', libraryViewMode === 'list');
  const runningSet=new Set(active?.isFarming?(active.runningGames||[]):[]);
  const cardDropMap=new Map((active?.cardDropGames||[]).filter(g=>g&&g.remaining>0).map(g=>[Number(g.appid),g]));
  const cardPriorityActive=Boolean(active?.cardFarming&&cardDropMap.size>0);
  // Si Farmear Cromos está activo, mostrar primero en la grilla los juegos con cromos que se están farmeando y debajo los manuales en pausa
  const mergedDisplayGames=cardPriorityActive
    ?[...new Set([...cardDropMap.keys(),...(games||[])])]
    :(games||[]);
  const snapshot=JSON.stringify([activeAccountId,mergedDisplayGames,active.gameNames,[...runningSet],Boolean(active?.isPaused),cardPriorityActive,[...cardDropMap.entries()]]);if(snapshot===gamesSnapshot)return;gamesSnapshot=snapshot;
  const grid = $('gamesGrid');
  if (!mergedDisplayGames.length) {
    const box = element('div', undefined, 'empty-onboarding-card');
    box.append(
      element('p', 'Add up to 32 games by title or AppID (you can paste multiple AppIDs separated by commas), or load your owned Steam library automatically.'),
      button('Load my Steam games', () => loadOwnedSteamGames(), 'btn-main')
    );
    grid.replaceChildren(box);
    return;
  }
  const cards = [];
  for (const id of mergedDisplayGames) {
    const isRunning=runningSet.has(id);
    const dropInfo = cardDropMap.get(Number(id));
    const title = dropInfo?.name || active.gameNames[id] || `AppID ${id}`; const card = element('div',undefined,'card'+(isRunning?' card-running':''));
    const art=element('div',undefined,'game-art'),fallback=element('div',undefined,'game-art-placeholder');fallback.setAttribute('aria-hidden','true');
    fallback.append(element('span',title.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase(),'game-art-monogram'),element('span',title,'game-art-name'));
    const banner=image(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,'card-banner',[`https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`]);
    art.append(fallback,banner,element('div',`#${id}`,'card-appid'));card.append(art);
    const content = element('div',undefined,'card-content');
    const metaRow=element('div',undefined,'card-header-info');
    const stateLabel = isRunning ? (dropInfo ? `🃏 Farmeando Cromos (${dropInfo.remaining} restantes)` : 'Running in Steam') : active?.isPaused ? 'Standby' : cardPriorityActive ? '⏸️ En pausa (Prioridad Cromos)' : 'Ready';
    metaRow.append(element('span',stateLabel,'card-state'+(isRunning?' active':'')));
    content.append(element('div',title,'card-title'),metaRow,createExternalBadgesNode(id));
    const actions = element('div',undefined,'card-actions');
    const menu=element('details',undefined,'control-menu');
    menu.append(element('summary','⋯'));
    const menuContent=element('div',undefined,'control-menu-content');
    menuContent.append(
      button('Stats',()=>openAchModal(id,title,false,active?.connected?'auto':'web','stats'),'btn-action-sm btn-card-stats'),
      button('Timed & Tools',()=>openAchModal(id,title,false,active?.connected?'auto':'web','tools'),'btn-action-sm'),
      button('Inspect In-Game',()=>{
        if(!activeAccountId)return;
        api('/api/game/inspect-start',{accountId:activeAccountId,appid:id,stealth:false}).then(()=>notice(`Inspecting ${title} (#${id}) in Steam.`)).catch(e=>notice(e.message));
      },'btn-action-sm'),
      button('Remove',()=>removeGame(id),'btn-card-remove')
    );
    menu.append(menuContent);
    const directRemoveBtn = button(currentLang === 'es' ? '✕ Quitar' : '✕ Remove', e => {
      e.stopPropagation();
      removeGame(id);
    }, 'btn-clear btn-card-remove-direct');
    directRemoveBtn.title = currentLang === 'es' ? `Quitar ${title} (#${id})` : `Remove ${title} (#${id})`;
    actions.append(button(currentLang === 'es' ? 'Logros' : 'Achievements',()=>openAchModal(id,title,false,active?.connected?'auto':'web','achievements'),'btn-card-ach btn-card-primary'),directRemoveBtn,menu);
    content.append(actions); card.append(content);

    cards.push(card);
  }
  grid.replaceChildren(...cards);
}
let loginPollTransientErrors = 0;
function stopLoginPoll() { clearTimeout(loginTimer); loginTimer = null; loginPollTransientErrors = 0; }
function openAddAccModal() {
  loginTarget = active && !active.user && active.tokenSource !== 'environment' ? active.id : null;
  loginPollTransientErrors = 0;
  if ($('newAccUser')) $('newAccUser').value = '';
  if ($('newAccName')) $('newAccName').value = '';
  if ($('newAccPassword')) $('newAccPassword').value = '';
  if ($('steamGuardCode')) $('steamGuardCode').value = '';
  if ($('steamLoginMessage')) $('steamLoginMessage').textContent = '';
  if ($('guardControls')) $('guardControls').hidden = true;
  if ($('connectSteamBtn')) $('connectSteamBtn').disabled = false;
  if ($('addAccModal')) $('addAccModal').style.display = 'flex';
  if (typeof window.testUI === 'undefined') {
    startSteamQrSession('modalQrImageWrap');
  }
}
async function closeAddAccModal() { loginSerial++; stopLoginPoll(); if (loginAttempt) { const id = loginAttempt; loginAttempt = null; try { await api('/api/steam/cancel', { attemptId:id }); } catch {} } $('newAccPassword').value = ''; $('steamGuardCode').value = ''; $('addAccModal').style.display = 'none'; }
function reloginAccount() { if (!active) return notice('Select an account.'); if (active.tokenSource === 'environment' && active.connected) return action('/api/steam/web-session',{},'Refreshing the Steam connection with the saved token.'); openAddAccModal(); loginTarget = active.tokenSource === 'environment' ? null : active.id; $('newAccUser').value = active.user || ''; $('newAccName').value = active.name || ''; }
async function submitAddAccount() {
  const serial = ++loginSerial;
  loginPollTransientErrors = 0;
  $('connectSteamBtn').disabled = true; $('steamLoginMessage').textContent = 'Connecting to Steam…';
  try {
    const payload = { name: $('newAccName').value.trim(), user: $('newAccUser').value.trim(), password: $('newAccPassword').value, accountId: loginTarget };
    $('newAccPassword').value = '';
    const data = await api('/api/steam/login', payload); delete payload.password;
    if (serial !== loginSerial) { try { await api('/api/steam/cancel', { attemptId: data.attemptId }); } catch {} return; }
    loginAttempt = data.attemptId; handleLogin(data);
  } catch(e) { if (serial !== loginSerial) return; $('steamLoginMessage').textContent = e.message; $('connectSteamBtn').disabled = false; }
}
function renderQrChallengeBox(containerId, qrUrl) {
  const box = $(containerId);
  if (!box || !qrUrl) return;
  if (box.dataset.lastQrUrl === qrUrl) return;
  box.dataset.lastQrUrl = qrUrl;
  const encoded = encodeURIComponent(qrUrl);
  const img = image(
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encoded}`,
    'qr-code-img',
    [`https://quickchart.io/qr?size=220&margin=2&text=${encoded}`]
  );
  img.alt = 'Steam Mobile QR Code';
  box.replaceChildren(img);
}

function handleLogin(data) {
  if (data.attemptId !== loginAttempt) return;
  loginPollTransientErrors = 0;
  const needsCode = Boolean(data.phase === 'guard' && Array.isArray(data.guards) && data.guards.some(g => /Code/.test(g.label)));
  if ($('guardControls')) $('guardControls').hidden = !needsCode;
  if ($('quickGuardBox')) $('quickGuardBox').hidden = !needsCode;
  if (data.qrChallengeUrl) {
    renderQrChallengeBox('modalQrImageWrap', data.qrChallengeUrl);
  }
  if ($('modalQrStatusPill') && data.qrChallengeUrl) {
    $('modalQrStatusPill').textContent = data.qrStatus === 'scanned' ? '📲 QR escaneado · Confirmá en tu celular' : '🟢 QR activo · Escaneá con Steam Mobile';
  }
  if (data.phase === 'authenticated') {
    activeAccountId = data.accountId;
    loginAttempt = null;
    stopLoginPoll();
    if ($('addAccModal')) $('addAccModal').style.display = 'none';
    if ($('quickLoginPassword')) $('quickLoginPassword').value = '';
    if ($('quickLoginStatusMsg')) $('quickLoginStatusMsg').textContent = '';
    if ($('quickQrStatusText')) $('quickQrStatusText').textContent = '✅ ¡Sesión conectada!';
    notice('Session saved automatically. No token copying is required.');
    loadStatus();
    return;
  }
  if (['failed','expired','cancelled'].includes(data.phase)) {
    const errMsg = data.error || 'Login attempt cancelled.';
    if ($('steamLoginMessage')) $('steamLoginMessage').textContent = errMsg;
    if ($('quickLoginStatusMsg')) $('quickLoginStatusMsg').textContent = errMsg;
    if ($('quickQrStatusText') && data.qrChallengeUrl) $('quickQrStatusText').textContent = 'QR expirado · Tocá Generar QR';
    if ($('connectSteamBtn')) $('connectSteamBtn').disabled = false;
    if ($('btnQuickLoginSubmit')) $('btnQuickLoginSubmit').disabled = false;
    stopLoginPoll();
    return;
  }
  const statusMsg = data.phase === 'saving'
    ? 'Guardando sesión aprobada y conectando cuenta…'
    : data.qrChallengeUrl
      ? (data.qrStatus === 'scanned' ? '📲 QR escaneado · Confirmá el acceso en tu celular…' : '📱 Escaneá el código QR desde la app Steam Mobile en tu celular…')
      : data.phase === 'guard'
        ? ('Steam Guard: ' + (data.guards || []).map(g => /DeviceConfirmation/.test(g.label) ? 'approve the sign-in in the Steam mobile app' : /EmailCode/.test(g.label) ? 'enter the code sent by email' : /DeviceCode/.test(g.label) ? 'enter your authenticator code' : 'complete the Steam confirmation').join(' or '))
        : 'Waiting for Steam confirmation…';
  if ($('steamLoginMessage')) $('steamLoginMessage').textContent = statusMsg;
  if ($('quickLoginStatusMsg') && !data.qrChallengeUrl) $('quickLoginStatusMsg').textContent = statusMsg;
  if ($('quickQrStatusText') && data.qrChallengeUrl) {
    $('quickQrStatusText').textContent = data.qrStatus === 'scanned'
      ? '📲 QR escaneado · Tocá Aprobar en tu celular'
      : '🟢 QR activo · Escaneá con Steam Mobile';
  }
  stopLoginPoll();
  loginTimer = setTimeout(pollLogin, data.phase === 'saving' ? 750 : 1400);
}
async function pollLogin() {
  const id = loginAttempt;
  if (!id || !csrf) return;
  try {
    handleLogin(await api('/api/steam/login-status?attemptId=' + encodeURIComponent(id)));
  } catch(e) {
    if (id !== loginAttempt) return;
    if (e?.status !== 404 && ++loginPollTransientErrors <= 20) {
      stopLoginPoll();
      loginTimer = setTimeout(pollLogin, 1500);
      return;
    }
    $('steamLoginMessage').textContent = e.message;
    $('connectSteamBtn').disabled = false;
    stopLoginPoll();
  }
}
if (typeof document?.addEventListener === 'function' && typeof window.testUI === 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && loginAttempt && csrf) {
      stopLoginPoll();
      pollLogin();
    }
  });
}
async function submitGuard() { const id = loginAttempt; if (!id) return; try { const code = $('steamGuardCode').value.trim(); $('steamGuardCode').value=''; handleLogin(await api('/api/steam/guard',{attemptId:id,code})); } catch(e) { notice(e.message); } }
async function deleteCurrentAccount() { if (!active || !confirm('Delete this profile and its saved session?')) return; if (await action('/api/account/remove')) { activeAccountId=''; closeAchModal(); await loadStatus(); } }
async function logoutSteam() { if (active && confirm('Sign out of Steam and remove the saved session?')) await action('/api/steam/logout',{},'Steam session removed.'); }
async function editChatAdmins() { if (!active) return; const value = prompt('Allowed SteamID64s, separated by commas. Leave empty to disable chat commands.', (active.chatAdmins||[]).join(',')); if(value !== null) await action('/api/chat-admins',{steamids:value.split(',').map(v=>v.trim()).filter(Boolean)},'Chat permissions updated.'); }

function switchSamTab(tab='achievements'){
  currentSamTab=tab;
  if($('tabAchievementsBtn'))$('tabAchievementsBtn').classList.toggle('active',tab==='achievements');
  if($('tabStatsBtn'))$('tabStatsBtn').classList.toggle('active',tab==='stats');
  if($('tabToolsBtn'))$('tabToolsBtn').classList.toggle('active',tab==='tools');
  if($('tabLeaderboardsBtn'))$('tabLeaderboardsBtn').classList.toggle('active',tab==='leaderboards');
  if($('achMainPanel'))$('achMainPanel').hidden=tab!=='achievements';
  if($('achStatsPanel'))$('achStatsPanel').hidden=tab!=='stats';
  if($('achToolsPanel'))$('achToolsPanel').hidden=tab!=='tools';
  if($('achLeaderboardsPanel'))$('achLeaderboardsPanel').hidden=tab!=='leaderboards';
  if(tab==='stats'){
    if(!currentStatsList.length&&currentAchAppId&&(active?.connected||!activeAccountId))loadGameStats();
    else renderStatsModal();
  }
  if(tab==='tools'&&currentAchAppId){
    if(typeof updateModalExternalHunterLinks==='function')updateModalExternalHunterLinks(currentAchAppId);
    refreshTimedStatus();
    refreshAchievementAnalytics();
    if(typeof window.testUI==='undefined'&&typeof previewModalSchedule==='function')previewModalSchedule();
  }
  if(tab==='leaderboards'&&currentAchAppId){
    loadGameLeaderboards();
  }
}

async function openAchModal(id,title,forceRefresh=false,method=active?.connected===true?(typeof window.testUI!=='undefined'?'auto':'protocol'):'web',initialTab=null) {
  achievementLive.stop();liveContext=null;achievementRevision='';achievementPage=0;
  clearAchievementSelection();modifiedStats.clear();
  $('sharedProgressReview').hidden=true;
  $('achReadingOptions').open=false;if($('achAdvancedOptionsDrawer'))$('achAdvancedOptionsDrawer').open=false;
  document.querySelector('.ach-modal-card').classList.remove('shared-review-open');
  if (currentAchAppId !== id || achAccountId !== currentAccKey() || $('achReadMode').value !== method) {
    observedAchievementChanges.length=0;renderObservedChanges();
    const defaultOpenSort=typeof window.testUI==='undefined'?'percentage_desc':'default';
    filterStatus='all'; filterRarity='all'; filterCompatibility='all';currentSort=defaultOpenSort; searchQuery='';
    achSortState={col:'default',dir:'asc'};currentAchSet='all';
    $('achCompatibilityFilter').value='all';
    $('achSortSelect').value=defaultOpenSort; $('achSearchInput').value='';
    switchSamTab(initialTab||'achievements');
  } else if (initialTab) {
    switchSamTab(initialTab);
  }
  document.body.classList.add('achievement-open');
  $('achListContainer').scrollTop=0; document.querySelector('.ach-modal-card').scrollTop=0;
  rarityWarning='';currentAchMethod=method; currentAchAppId=id; currentAchGameName=title; achAccountId=currentAccKey(); currentAchList=[]; currentStatsList=[];
  if (activeAccountId && active?.id && active?.connected && !$('stealthModeToggle')?.checked) {
    api('/api/game/inspect-start', { accountId: activeAccountId, appid: id, stealth: false }).catch(() => {});
  }
  $('achRarityMessage').hidden=true;$('achRarityMessage').textContent='';$('retryAchievementRarity').hidden=true;$('achReadMessage').textContent='';
  $('achReadMode').value=method;
  $('achModal').style.display='flex'; $('achGameTitle').textContent=title; if($('achExternalMeta')){$('achExternalMeta').replaceChildren(createExternalBadgesNode(id));} $('achProgressText').textContent='Loading Steam achievements…'; $('achProgressFill').style.width='0%'; $('achCompatibilitySummary').textContent='';$('achListContainer').replaceChildren(); $('achPrivacyWarning').style.display='none'; $('achievementSource').textContent='';updateSelectionSummary();
  const serial = ++achSerial, account = achAccountId,readStarted=performance.now();
  const cacheKey=previewKey(account,id,method),preview=achievementPreviews.get(cacheKey);
  if(preview&&Date.now()-preview.at<300000){
    currentAchMethod='cached';currentAchList=AchievementRarity.normalizeRows(JSON.parse(preview.text).achievements||[]);
    $('achReadMessage').textContent='Previous reading — checking Steam now. Activation is unavailable until verification finishes.';
    $('achPrivacyWarning').style.display='block';$('achievementSource').textContent='Previous reading · Updating…';renderAchModal();
  }else if(preview){
    achievementPreviews.delete(cacheKey);
  }else if(!forceRefresh&&achCache.has(`${account}:${id}`)){
    const prefetched=achCache.get(`${account}:${id}`);
    currentAchMethod='cached';
    currentAchList=AchievementRarity.normalizeRows((prefetched.achievements||[]).map(a=>({...a,name:String(a.name||a.apiname||'Achievement'),description:String(a.description||''),unlocked:typeof a.unlocked==='boolean'?a.unlocked:null})));
    renderAchModal();
  }
  $('gameRequirements').hidden=false;$('gameRequirements').open=false;requirementsContext={id,serial,account,requested:false};$('gameRequirementsContent').replaceChildren(element('p','Open this section to read game integration requirements.'));
  try {
    let data;
    try {
      data=await api(`/api/achievements?accountId=${encodeURIComponent(account)}&appid=${id}${forceRefresh?'&refresh=1':'&live=1'}${method!=='web'?'&method='+encodeURIComponent(method):''}`);
    } catch (firstErr) {
      if (method === 'protocol' && typeof window.testUI === 'undefined') {
        data=await api(`/api/achievements?accountId=${encodeURIComponent(account)}&appid=${id}${forceRefresh?'&refresh=1':'&live=1'}&method=auto`);
      } else {
        throw firstErr;
      }
    }
    if (serial !== achSerial || account !== currentAccKey()) return;
    currentAchMethod=data.readingMethod||method;
    achievementRevision=data.stateRevision||'';
    const rawRows=Array.isArray(data.achievements)?data.achievements:[];
    if(Array.isArray(data.statistics))currentStatsList=data.statistics;
    rarityWarning=data.rarityMessage|| (AchievementRarity.uniformHundred(rawRows.map(a=>a.percent))?'Steam returned 100% for every achievement. Rarity is temporarily unverified.':'');
    currentAchList=AchievementRarity.normalizeRows(rawRows.map(a=>({...a,name:String(a.name||a.apiname||'Achievement'),description:String(a.description||''),unlocked:typeof a.unlocked==='boolean'?a.unlocked:null})));

    achCache.set(`${account}:${id}`,{achievements:currentAchList,statistics:currentStatsList});
    rememberAchievements(cacheKey,{achievements:currentAchList});
    $('achReadMessage').textContent=data.message || '';
    const isRoutineMsg=/^Read directly from your authenticated Steam session\.?$/i.test(String(data.message||'').trim());
    $('achPrivacyWarning').style.display=(data.message && !isRoutineMsg) ? 'block':'none';
    $('achGameTitle').textContent=title;
    $('achievementSource').textContent=`${data.source || 'Steam'} · ${new Date(data.checkedAt).toLocaleTimeString('en-US')} · Read: ${((performance.now()-readStarted)/1000).toFixed(2)} s`;
    renderAchModal();
    if(currentSamTab==='stats')renderStatsModal();
    if(currentSamTab==='tools')refreshAchievementAnalytics();
    if((currentAchMethod==='protocol'||rarityWarning||filterRarity!=='all'||['percentage_desc','rarity_common','rarity_rare'].includes(currentSort))&&currentAchList.some(a=>a.percent===null))loadAchievementPercentages();
  } catch(e) { if(serial===achSerial&&account===currentAccKey()) { if(currentAchMethod==='cached'){$('achReadMessage').textContent='Previous reading only. Current verification failed: '+e.message;$('achievementSource').textContent='Previous reading · Verification failed';}else{$('achProgressText').textContent='Not verified'; $('achListContainer').replaceChildren(element('p',e.message),...(e.diagnostic?.action?[element('p',e.diagnostic.action)]:[]));} } }
  finally{if(serial===achSerial&&account===currentAccKey()&&currentAchAppId===id){liveContext={serial,account,id,method:currentAchMethod==='protocol'?'protocol':method};achievementLive.start(liveContext);}}
}
async function loadGameRequirements(id,serial,account) {
  try {
    const data=await api('/api/game-requirements?appid='+id);
    if(serial!==achSerial||account!==currentAccKey())return;
    const container=$('gameRequirementsContent');container.replaceChildren();
    for(const fact of data.facts||[])container.append(element('p',String(fact)));
    container.append(element('p',data.explanation),element('p',data.action));
    if(!data.metadataAvailable)container.append(element('small','Live Steam Store metadata unavailable; only established facts are shown.'));
    const link=element('a','Source: Steam Store');const url=new URL(data.sourceUrl);if(url.protocol==='https:'&&url.hostname==='store.steampowered.com'){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';container.append(link);}
    $('gameRequirements').hidden=false;
  } catch {if(serial===achSerial){$('gameRequirementsContent').replaceChildren(element('p','Game integration requirements could not be retrieved. This does not establish a launcher restriction.'));$('gameRequirements').hidden=false;}}
}
let requirementsContext=null;
$('gameRequirements').addEventListener('toggle',()=>{const context=requirementsContext;if($('gameRequirements').open&&context&&context.serial===achSerial&&context.account===currentAccKey()&&$('achModal').style.display==='flex'&&!context.requested){context.requested=true;loadGameRequirements(context.id,context.serial,context.account);}});
function closeAchModal() {
  if (activeAccountId && active?.id && currentAchAppId !== null && active?.connected) {
    api('/api/game/inspect-stop', { accountId: activeAccountId }).catch(() => {});
  }
  achievementLive.stop();liveContext=null;achievementRevision='';observedAchievementChanges.length=0;renderObservedChanges();requirementsContext=null;clearAchievementSelection();modifiedStats.clear();document.body.classList.remove('achievement-open'); achSerial++; $('achModal').style.display='none';currentAchList=[];currentStatsList=[];currentAchAppId=null;achAccountId=null;$('achCompatibilitySummary').textContent='';$('achListContainer').replaceChildren();$('sharedProgressEffects').replaceChildren();$('sharedProgressSummary').replaceChildren();$('sharedProgressActions').replaceChildren();$('sharedProgressReview').hidden=true;$('gameRequirementsContent').replaceChildren();updateSelectionSummary(); }
function liveMatches(context){return context&&context.serial===achSerial&&context.account===activeAccountId&&context.id===currentAchAppId&&$('achModal').style.display==='flex';}
function liveAllowed(context){return liveMatches(context)&&Boolean(csrf)&&!document.hidden&&navigator.onLine!==false&&active?.connected===true&&!experimentBusy&&!achievementSelection.size&&$('sharedProgressReview').hidden&&currentSamTab==='achievements';}
function renderObservedChanges(){
  const panel=$('achievementObservedChanges');panel.hidden=!observedAchievementChanges.length;
  $('achievementObservedSummary').textContent=`Changes observed (${observedAchievementChanges.length})`;
  $('achievementObservedList').replaceChildren(...observedAchievementChanges.slice(0,8).map(change=>element('p',`${new Date(change.observedAt).toLocaleTimeString('en-US')} · ${change.name}: ${change.kind==='unlock'?'Unlocked':change.kind==='remove'?'Locked':`Progress ${change.before} → ${change.after}`}`)));
}
let lastDirectAchWriteAt = 0;
async function pollAchievements(context,{signal}){
  if(typeof window.testUI==='undefined'&&Date.now()-lastDirectAchWriteAt<12000)return;
  const suffix=achievementRevision?'&revision='+encodeURIComponent(achievementRevision):'';
  const data=await api(`/api/achievements?accountId=${encodeURIComponent(context.account)}&appid=${context.id}&method=${context.method}&live=1${suffix}`,undefined,{signal});
  if(signal.aborted||!liveAllowed(context))return;
  const previousMethod=currentAchMethod;
  if(previousMethod==='protocol'&&data.readingMethod==='web')return data;
  currentAchMethod=data.readingMethod||context.method;
  achievementRevision=data.stateRevision||achievementRevision;
  $('achievementSource').textContent=`${data.source||'Steam'} · ${new Date(data.checkedAt).toLocaleTimeString('en-US')} · Auto update`;
  $('achReadMessage').textContent=data.message||'';const isRoutinePollMsg=/^Read directly from your authenticated Steam session\.?$/i.test(String(data.message||'').trim());$('achPrivacyWarning').style.display=(data.message&&!isRoutinePollMsg)?'block':'none';
  if(data.unchanged){if(previousMethod==='cached')renderAchModal();return data;}
  const old=new Map(),duplicates=new Set();for(const row of currentAchList){if(old.has(row.apiname)){duplicates.add(row.apiname);old.delete(row.apiname);}else if(row.apiname&&!duplicates.has(row.apiname))old.set(row.apiname,row);}
  if(Array.isArray(data.statistics))currentStatsList=data.statistics;
  currentAchList=AchievementRarity.normalizeRows((data.achievements||[]).map(row=>({...row,percent:row.percent??old.get(row.apiname)?.percent??null})));
  clearAchievementSelection();$('sharedProgressReview').hidden=true;document.querySelector('.ach-modal-card').classList.remove('shared-review-open');
  const scroll=$('achListContainer').scrollTop;renderAchModal();$('achListContainer').scrollTop=scroll;
  rememberAchievements(previewKey(context.account,context.id,context.method),{achievements:currentAchList});
  const changes=data.observedChanges;if(changes?.total&&Number.isFinite(Date.parse(changes.observedAt))){for(const change of [...changes.changes].reverse())observedAchievementChanges.unshift({...change,observedAt:changes.observedAt});observedAchievementChanges.splice(20);renderObservedChanges();}
  if(currentAchList.some(a=>a.percent===null))loadAchievementPercentages();return data;
}
const achievementLive=AchievementLive.create({canRun:liveAllowed,poll:pollAchievements,onStatus:(state,{context}={})=>{
  if(!liveMatches(context))return;
  $('achievementLiveStatus').textContent=state==='paused'||state==='live'&&!liveAllowed(context)?'Auto update paused while unavailable or reviewing':state==='checking'?'Checking Steam…':state==='live'?'Auto update · every 10 s':'Auto update unavailable · retrying';
}});
function forceRefreshAchievements() { if(currentAchAppId) return openAchModal(currentAchAppId,currentAchGameName,true,$('achReadMode').value); }
function setFilter(type,val) {
  achievementPage=0;
  if(type==='status')filterStatus=val;else filterRarity=filterRarity===val?'all':val;
  renderAchModal();
  if(type==='rarity'&&filterRarity!=='all'&&currentAchList.some(a=>a.percent===null))loadAchievementPercentages();
}
let percentageRequest=null,percentageFetchedSerial=-1,rarityWarning='';
function computeClientDependencyMap(rows = []) {
  const map = new Map();
  if (!Array.isArray(rows) || !rows.length) return map;
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  const parseNum = tok => {
    const c = String(tok || '').trim().toLowerCase().replace(/,/g, '');
    if (/^\d+$/.test(c)) return Number(c);
    return roman[c] || null;
  };
  const byStat = new Map();
  const bySeries = new Map();
  const prologues = [];
  const bosses = [];
  const platinums = [];

  rows.forEach((a, idx) => {
    if (a.dependencyInfo) {
      map.set(a, a.dependencyInfo);
      return;
    }
    const text = `${a.name || ''} ${a.description || ''} ${a.apiname || ''}`.toLowerCase();
    let stage = 2;
    if (/\b(platinum|platino|all achievements|todos los logros|100%|completionist)\b/i.test(text)) stage = 5;
    else if (/\b(prologue|pr[oó]logo|tutorial|first step|primer paso|welcome|intro)\b/i.test(text)) stage = 1;
    else if (/\b(final boss|jefe final|epilogue|ep[ií]logo|finish the game|complete the game|beat the game)\b/i.test(text)) stage = 4;
    else if (/\b(collectible|coleccionable|secret|secreto|hidden|find all)\b/i.test(text)) stage = 3;
    else if (typeof a.percent === 'number') {
      stage = a.percent > 60 ? 1 : a.percent >= 30 ? 2 : a.percent >= 10 ? 3 : 4;
    }
    const info = {
      stage,
      depth: 0,
      parents: [],
      parentNames: [],
      missingParents: [],
      blockedByDependency: false,
      requiresText: '',
      _idx: idx,
      _parentRows: []
    };
    map.set(a, info);
    if (stage === 1) prologues.push(a);
    else if (stage === 4) bosses.push(a);
    else if (stage === 5) platinums.push(a);

    const statName = a.progressDetails?.statName;
    const maxVal = Number(a.progressDetails?.maximum ?? NaN);
    if (statName && Number.isFinite(maxVal) && maxVal > 0) {
      const sk = String(statName).toLowerCase();
      if (!byStat.has(sk)) byStat.set(sk, []);
      byStat.get(sk).push({ row: a, val: maxVal });
    }

    const kw = (a.name || '').match(/\b(chapter|cap[ií]tulo|act|acto|part|parte|stage|etapa|level|nivel|rank|wave)\s+([0-9]+|[ivx]+)\b/i)
      || (a.description || '').match(/\b(chapter|cap[ií]tulo|act|acto|part|parte|stage|etapa|level|nivel|rank|wave)\s+([0-9]+|[ivx]+)\b/i);
    if (kw) {
      const num = parseNum(kw[2]);
      if (num) {
        const gk = `kw:${kw[1].toLowerCase()}`;
        if (!bySeries.has(gk)) bySeries.set(gk, []);
        bySeries.get(gk).push({ row: a, val: num });
      }
    } else if (a.apiname) {
      const am = String(a.apiname).match(/^([A-Za-z]+(?:_[A-Za-z]+)*?)[_]?(\d+)$/);
      if (am && /^(act|chap|chapter|ep|stage|lvl|level|rank|tier|wave|boss|story|part)/i.test(am[1])) {
        const gk = `api:${am[1].toLowerCase()}`;
        if (!bySeries.has(gk)) bySeries.set(gk, []);
        bySeries.get(gk).push({ row: a, val: Number(am[2]) });
      }
    }
  });

  const linkParent = (parentRow, childRow) => {
    if (!parentRow || !childRow || parentRow === childRow) return;
    const cInfo = map.get(childRow);
    const pInfo = map.get(parentRow);
    if (!cInfo || !pInfo || !cInfo._parentRows) return;
    if (!cInfo._parentRows.includes(parentRow)) cInfo._parentRows.push(parentRow);
  };

  for (const list of byStat.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.val - b.val);
    for (let i = 1; i < list.length; i++) {
      if (list[i].val > list[i - 1].val) linkParent(list[i - 1].row, list[i].row);
    }
  }
  for (const list of bySeries.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.val - b.val);
    for (let i = 1; i < list.length; i++) {
      if (list[i].val > list[i - 1].val) linkParent(list[i - 1].row, list[i].row);
    }
  }
  if (prologues.length > 0 && bosses.length > 0) {
    for (const b of bosses) {
      const bi = map.get(b);
      if (bi?._parentRows?.length === 0) linkParent(prologues[0], b);
    }
  }
  if (platinums.length > 0) {
    const anchor = bosses[0] || prologues[0];
    if (anchor) {
      for (const p of platinums) linkParent(anchor, p);
    }
  }

  for (const [row, info] of map.entries()) {
    if (!info._parentRows) continue;
    info.parents = info._parentRows.map(p => p.apiname || p.name);
    info.parentNames = info._parentRows.map(p => p.name || p.apiname);
    info.missingParents = info._parentRows.filter(p => p.unlocked !== true).map(p => ({ apiname: p.apiname, name: p.name || p.apiname }));
    info.blockedByDependency = row.unlocked !== true && info.missingParents.length > 0;
    info.depth = info._parentRows.length;
    if (info.missingParents.length > 0) {
      info.requiresText = `Requiere antes: ${info.missingParents.map(p => p.name).join(', ')}`;
    } else if (info.parentNames.length > 0) {
      info.requiresText = `Requiere antes: ${info.parentNames.join(', ')}`;
    }
  }
  return map;
}

function toggleDependencyTreeMode() {
  dependencyTreeMode = !dependencyTreeMode;
  if ($('btnDependencyTreeFilter')) $('btnDependencyTreeFilter').classList.toggle('active', dependencyTreeMode);
  achievementPage = 0;
  renderAchModal(0);
}
function groupAchievementsBySet(list) {
  const sets = new Map();
  for (const ach of list) {
    const setId = ach.set_id || 'base';
    if (!sets.has(setId)) sets.set(setId, { id: setId, name: ach.set_name || (setId === 'base' ? 'Base Game' : setId), achievements: [] });
    sets.get(setId).achievements.push(ach);
  }
  return [...sets.values()];
}
function sortAchievementTable(col) {
  if (!['name', 'pct', 'date'].includes(col)) return;
  if (achSortState.col === col) {
    achSortState.dir = achSortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    achSortState = { col, dir: col === 'pct' || col === 'date' ? 'desc' : 'asc' };
  }
  achievementPage = 0;
  renderAchModal(0);
  if (col === 'pct' && currentAchList.some(a => a.percent === null)) loadAchievementPercentages();
}
function setSort(val) {
  achievementPage=0;currentSort=val;achSortState={col:'default',dir:'asc'};renderAchModal();
  if(['percentage_desc','rarity_common','rarity_rare'].includes(val)&&currentAchList.some(a=>a.percent===null))loadAchievementPercentages();
}
async function loadAchievementPercentages(force=false){
  const serial=achSerial,id=currentAchAppId,account=achAccountId,key=serial+':'+account+':'+id;
  if(!id||percentageRequest===key||!force&&percentageFetchedSerial===serial)return;percentageRequest=key;renderAchModal();
  try{
    const includeTitles=currentAchMethod!=='protocol'||currentAchList.some(a=>!a.apiname);
    const result=await api(`/api/achievement/percentages?accountId=${encodeURIComponent(account)}&appid=${id}${includeTitles?'&titles=1':''}${force?'&refresh=1':''}`);
    if(serial!==achSerial||account!==currentAccKey()||id!==currentAchAppId)return;
    if(!result.percentages||typeof result.percentages!=='object'||Array.isArray(result.percentages))throw Error('Steam did not return usable rarity percentages.');
    percentageFetchedSerial=serial;rarityWarning=result.rarityMessage||'';
    const percentages=AchievementRarity.percentageMap(Object.entries(result.percentages).map(([name,percent])=>({name,percent}))).percentages;
    const normalize=AchievementRarity.normalizeTitle,apis=new Map(),titles=new Map();
    for(const [name,value]of Object.entries(percentages)){const key=normalize(name);apis.set(key,apis.has(key)?null:value);}
    for(const row of currentAchList){const key=normalize(row.name);titles.set(key,(titles.get(key)||0)+1);}
    const suspect=result.rarityStatus==='suspect_uniform_100'||AchievementRarity.uniformHundred(Object.values(result.percentages));if(suspect&&!Object.keys(result.titlePercentages||{}).length){rarityWarning ||= 'Steam returned 100% for every achievement. Rarity is temporarily unverified.';currentAchList=AchievementRarity.normalizeRows(currentAchList.map(a=>({...a,percent:null})));}
    currentAchList=AchievementRarity.normalizeRows(currentAchList.map(a=>{let value=a.apiname&&Object.hasOwn(percentages,a.apiname)?percentages[a.apiname]:a.apiname?apis.get(normalize(a.apiname)):null;
      if(value==null&&titles.get(normalize(a.name))===1)value=result.titlePercentages?.[normalize(a.name)];
      const p=AchievementRarity.validPercent(value);return {...a,percent:p??a.percent};}));renderAchModal();
    if(currentAchList.every(a=>a.percent===null))notice('Steam did not return percentages for these achievements. Unknown values remain at the end.');
  }catch(e){if(serial===achSerial){rarityWarning=e.message;notice(e.message);}}finally{if(percentageRequest===key)percentageRequest=null;if(serial===achSerial&&account===currentAccKey()&&id===currentAchAppId)renderAchModal();}
}
function onSearchInput(val) { achievementPage=0;searchQuery=val.trim().toLowerCase(); renderAchModal(); }
function renderAchModal(page=achievementPage) {
  const liveProto=isLiveProtocol();
  const rarityMissing=currentAchList.filter(a=>a.percent===null).length,rarityLoading=percentageRequest===achSerial+':'+achAccountId+':'+currentAchAppId;
  const rarityRelevant=filterRarity!=='all'||['percentage_desc','rarity_common','rarity_rare'].includes(currentSort)||achSortState.col==='pct';
  $('achRarityMessage').hidden=!rarityWarning&&!rarityLoading&&(!rarityRelevant||!rarityMissing);
  $('retryAchievementRarity').hidden=!currentAchList.length||!rarityMissing&&!rarityWarning;$('retryAchievementRarity').disabled=rarityLoading||experimentBusy;
  $('achRarityMessage').textContent=rarityWarning||(rarityLoading?'Loading community unlock percentages from Steam…':rarityMissing===currentAchList.length?'Steam rarity percentages are unavailable. Unknown rarity is not treated as 0%.':`${rarityMissing} achievements have unknown rarity and ${filterRarity!=='all'?'are excluded from rarity filters':'remain last in percentage sorting'}.`);
  const sets = groupAchievementsBySet(currentAchList);
  const baseAchs = currentAchList.filter(a => (a.set_id || 'base') === 'base');
  const baseConfirmed = baseAchs.filter(a => a.unlocked === true).length;
  const basePct = baseAchs.length ? Math.round((baseConfirmed / baseAchs.length) * 100) : 0;
  const baseCompleted = baseAchs.length > 0 && baseConfirmed === baseAchs.length;
  const confirmed=currentAchList.filter(a=>a.unlocked===true).length, unknown=currentAchList.filter(a=>a.unlocked===null).length;
  const totalPct = currentAchList.length ? Math.round((confirmed / currentAchList.length) * 100) : 0;
  if (unknown === currentAchList.length && unknown > 0) {
    $('achProgressText').textContent = currentLang === 'es'
      ? `${unknown} logros · Estado personal sin verificar (Personal state not verified)`
      : `${unknown} achievements · Personal state not verified`;
  } else if (sets.length > 1) {
    $('achProgressText').textContent = currentLang === 'es'
      ? `${confirmed}/${currentAchList.length} logros verificados desbloqueados · Base Game: ${baseConfirmed}/${baseAchs.length} (${basePct}%${baseCompleted ? ' · Completed ★' : ''}) · Total w/ DLCs: ${confirmed}/${currentAchList.length} (${totalPct}%)${unknown ? ` · ${unknown} not verified` : ''}`
      : `${confirmed}/${currentAchList.length} verified achievements unlocked · Base Game: ${baseConfirmed}/${baseAchs.length} (${basePct}%${baseCompleted ? ' · Completed ★' : ''}) · Total w/ DLCs: ${confirmed}/${currentAchList.length} (${totalPct}%)${unknown ? ` · ${unknown} not verified` : ''}`;
  } else {
    $('achProgressText').textContent = currentLang === 'es'
      ? `${confirmed}/${currentAchList.length} logros verificados desbloqueados (${totalPct}%)${baseCompleted ? ' · Completado ★' : ''}${unknown ? ` · ${unknown} not verified` : ''}`
      : `${confirmed}/${currentAchList.length} verified achievements unlocked (${totalPct}%)${baseCompleted ? ' · Completed ★' : ''}${unknown ? ` · ${unknown} not verified` : ''}`;
  }
  $('achProgressFill').style.width=(currentAchSet==='base'&&baseAchs.length?baseConfirmed/baseAchs.length*100:(currentAchList.length?confirmed/currentAchList.length*100:0))+'%';
  if(currentAchMethod==='cached')$('achProgressText').textContent='Previous reading · '+$('achProgressText').textContent;
  const allowActivation=isAuthorizedAccount(active)&&active?.connected!==false&&active?.tokenAccountMatches!==false&&!active?.isCollisionPaused;
  const availability=new Map(currentAchList.map(a=>[a,AchievementAvailability.classify(a,{method:currentAchMethod,allowActivation})]));
  const remaining=[...availability.values()].filter((v,i)=>currentAchList[i].unlocked!==true),count=status=>remaining.filter(v=>v.status===status).length;
  $('achCompatibilitySummary').textContent=liveProto?'':(currentAchList.length?(remaining.length===0?'All achievements are already unlocked.':`Pending: ${remaining.filter(v=>v.canAttempt).length} eligible to attempt · ${count('protected')} protected · ${count('unsupported')} unsupported · ${count('unknown')} unknown · ${count('rejected')+count('review')} need review. Eligibility is provisional; only a fresh Steam read can confirm a write.`):'');
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.val===(b.dataset.filter==='status'?filterStatus:filterRarity)));

  // Achievement Sets (Steam Oct 2026 update: Base Game blue + DLC purple)
  const setsNav = $('achSetsNav');
  if (setsNav) {
    if (sets.length > 1) {
      setsNav.hidden = false;
      const setBtns = [
        button(currentLang === 'es' ? 'Todos los Logros' : 'All Achievements', () => { currentAchSet = 'all'; achievementPage = 0; renderAchModal(0); }, 'ach-set-btn' + (currentAchSet === 'all' ? ' active' : ''))
      ];
      setBtns[0].dataset.set = 'all';
      for (const s of sets) {
        const isBase = s.id === 'base';
        const cls = 'ach-set-btn ' + (isBase ? 'set-base set-blue' : 'set-dlc set-purple') + (currentAchSet === s.id ? ' active' : '');
        const label = isBase && (s.name === 'Base Game' || s.name === 'Juego Base (Base Game)')
          ? (currentLang === 'es' ? 'Juego Base (Base Game)' : 'Base Game')
          : s.name;
        const b = button(label, () => { currentAchSet = s.id; achievementPage = 0; renderAchModal(0); }, cls);
        b.dataset.set = s.id;
        setBtns.push(b);
      }
      setsNav.replaceChildren(...setBtns);
    } else {
      setsNav.hidden = true;
      setsNav.replaceChildren();
    }
  }

  const depMap = computeClientDependencyMap(currentAchList);
  if ($('btnDependencyTreeFilter')) $('btnDependencyTreeFilter').classList.toggle('active', dependencyTreeMode);
  let list=currentAchList.filter(a=>(currentAchSet==='all'||(a.set_id||'base')===currentAchSet) && (!searchQuery || (a.name+' '+a.description).toLowerCase().includes(searchQuery)) && (filterStatus==='all'||filterStatus==='unlocked'&&a.unlocked===true||filterStatus==='locked'&&a.unlocked===false) && (filterRarity==='all'||a.percent!==null && (filterRarity==='mythic'&&a.percent<5||filterRarity==='epic'&&a.percent>=5&&a.percent<20||filterRarity==='rare'&&a.percent>=20&&a.percent<=50||filterRarity==='common'&&a.percent>50)));
  if(currentSort==='alpha') list.sort((a,b)=>a.name.localeCompare(b.name));
  list=list.filter(a=>{const v=availability.get(a);return filterCompatibility==='all'||filterCompatibility==='attemptable'&&v.canAttempt||filterCompatibility==='unavailable'&&a.unlocked===false&&!['unknown','review'].includes(v.status)&&!v.canAttempt||filterCompatibility==='unknown'&&(v.status==='unknown'||v.status==='review');});
  if(['rarity_rare','rarity_common','percentage_desc'].includes(currentSort)) list.sort((a,b)=>{
    if(a.percent===null&&b.percent===null){
      if(a.unlockTimestamp&&b.unlockTimestamp&&a.unlockTimestamp!==b.unlockTimestamp)return a.unlockTimestamp-b.unlockTimestamp;
      return 0;
    }
    if(a.percent===null)return 1;
    if(b.percent===null)return -1;
    const diff=(a.percent-b.percent)*(currentSort==='rarity_rare'?1:-1);
    if(diff!==0)return diff;
    if(a.unlockTimestamp&&b.unlockTimestamp&&a.unlockTimestamp!==b.unlockTimestamp)return a.unlockTimestamp-b.unlockTimestamp;
    return 0;
  });
  if(currentSort==='locked_first'||currentSort==='unlocked_first'){const rank=a=>a.unlocked===null?2:(a.unlocked===(currentSort==='unlocked_first')?0:1);list.sort((a,b)=>rank(a)-rank(b));}
  if(achSortState.col==='name'){
    const dir=achSortState.dir==='asc'?1:-1;
    list.sort((a,b)=>a.name.localeCompare(b.name)*dir);
  }else if(achSortState.col==='pct'){
    const dir=achSortState.dir==='asc'?1:-1;
    list.sort((a,b)=>a.percent===null&&b.percent===null?0:a.percent===null?1:b.percent===null?-1:(a.percent-b.percent)*dir);
  }else if(achSortState.col==='date'){
    const dir=achSortState.dir==='asc'?1:-1;
    list.sort((a,b)=>((a.unlockTimestamp||0)-(b.unlockTimestamp||0))*dir);
  }
  if(dependencyTreeMode){
    list.sort((a,b)=>{
      const da=depMap.get(a)||{stage:2,depth:0},db=depMap.get(b)||{stage:2,depth:0};
      if(da.stage!==db.stage)return da.stage-db.stage;
      if(da.depth!==db.depth)return da.depth-db.depth;
      return ((b.percent??-1)-(a.percent??-1));
    });
  }

  const cont=$('achListContainer');
  const pages=Math.max(1,Math.ceil(list.length/200));page=Math.min(Math.max(0,page),pages-1);
  achievementPage=page;
  const renderedNodes=[];
  if(list.length){
    const tableWrap=element('div',undefined,'ach-table-wrap');
    const table=element('table',undefined,'ach-table');
    const thead=element('thead'),headRow=element('tr');
    const thIcon=element('th');thIcon.style.width='52px';
    const thName=element('th',currentLang==='es'?'Logro':'Achievement','ach-th-name'+(achSortState.col==='name'?' sort-'+achSortState.dir:''));thName.dataset.sort='name';thName.addEventListener('click',()=>sortAchievementTable('name'));
    const thPct=element('th',currentLang==='es'?'% Global':'Global %','ach-th-pct'+(achSortState.col==='pct'?' sort-'+achSortState.dir:''));thPct.style.width='90px';thPct.dataset.sort='pct';thPct.addEventListener('click',()=>sortAchievementTable('pct'));
    const thRarity=element('th',currentLang==='es'?'Rareza':'Rarity','ach-th-rarity');thRarity.style.width='80px';
    const thDate=element('th',currentLang==='es'?'Fecha de desbloqueo':'Unlock date','ach-th-date'+(achSortState.col==='date'?' sort-'+achSortState.dir:''));thDate.style.width='130px';thDate.dataset.sort='date';thDate.addEventListener('click',()=>sortAchievementTable('date'));
    const thAction=element('th','','ach-th-action');thAction.style.width='100px';
    headRow.append(thIcon,thName,thPct,thRarity,thDate,thAction);
    thead.append(headRow);
    const tbody=element('tbody');tbody.id='achTableBody';

    for(const a of list.slice(page*200,(page+1)*200)) {
      const tierColor=a.tier==='Mythic'?' gold':a.tier==='Epic'?' purple':a.tier==='Rare'?' blue':a.tier==='Common'?' gray':'';
      const row=element('tr',undefined,'ach-item '+(a.unlocked===true?'unlocked unlocked-item':'locked-item')+tierColor);
      const selectEligible=currentAchMethod==='protocol'&&allowActivation&&(liveProto?(!a.serverControlled&&Boolean(a.apiname)&&typeof a.unlocked==='boolean'):(a.batchSupport?.canRemove===true||a.unlocked===false&&!['steam_rejected','pending_verification','attempted'].includes(a.compatibility?.status)&&(a.compatibility?.status!=='insufficient_data'||a.batchSupport?.canReactivate===true)&&(a.compatibility?.canUnlock||a.progressSupport?.canComplete||a.progressSupport?.canPreviewFloat||a.progressSupport?.canPreviewShared||a.batchSupport?.canReactivate)));
      const tdIcon=element('td',undefined,'ach-td-icon');
      const iconWrap=element('div',undefined,'ach-td-icon-inner');
      if(selectEligible&&a.apiname){
        row.classList.add('selectable');
        const label=element('label',undefined,'ach-selector'),check=element('input',undefined,'ach-select');
        check.type='checkbox';check.checked=achievementSelection.has(a.apiname);
        check.setAttribute('aria-label',(a.unlocked?'Select removal of ':'Select unlock of ')+a.name);
        label.title=check.getAttribute('aria-label');
        check.addEventListener('change',()=>{
          if(experimentBusy||currentAchMethod!=='protocol')return;
          if(check.checked){achievementSelection.set(a.apiname,{apiname:a.apiname,action:a.unlocked?'remove':'unlock'});}else achievementSelection.delete(a.apiname);
          selectionVersion++;$('sharedProgressReview').hidden=true;document.querySelector('.ach-modal-card').classList.remove('shared-review-open');updateSelectionSummary();
        });
        label.append(check);iconWrap.append(label);
      }
      const isVeryRare=a.percent!==null&&a.percent<10;
      const iconImg=image(a.unlocked?a.iconOpen:a.iconClosed,(a.unlocked?'':'locked')+(isVeryRare?' rare-gold-border':''));
      iconWrap.append(iconImg);
      tdIcon.append(iconWrap);

      const info=element('td',undefined,'ach-td-name-wrap ach-info');
      const rarityMeta=element('small',a.percent===null?'Unknown rarity':`${a.tier} · ${a.percent.toFixed(1)}%`);
      rarityMeta.hidden=true;
      const isDlcRow=(a.set_id||'base')!=='base';
      const setBadge=element('span',isDlcRow?`[DLC: ${a.set_name||a.set_id}]`:'[Base]','ach-set-badge '+(isDlcRow?'set-dlc':'set-base'));
      info.append(element('strong',a.name,'ach-title'),setBadge,element('small',a.description,'ach-desc'),rarityMeta);
      const depInfo=depMap.get(a);
      if(depInfo&&depInfo.requiresText&&(depInfo.blockedByDependency||dependencyTreeMode)){
        const depBadge=element('small',depInfo.blockedByDependency?`🔒 ${depInfo.requiresText}`:`✓ ${depInfo.requiresText}`,'ach-dep-badge '+(depInfo.blockedByDependency?'blocked':'satisfied'));
        info.append(depBadge);
      }
      const techDrawer=element('details',undefined,'technical-debug-drawer');
      const techSummary=element('summary',t('techDrawerSummary'),'technical-debug-summary');
      const techBody=element('div',undefined,'technical-debug-body');
      techDrawer.append(techSummary,techBody);
      if(Number.isInteger(a.statId))techBody.append(element('small',`statId: ${a.statId} · bitIndex: ${a.bitIndex??0}`));
      if(liveProto){
        if(a.progressDetails)techBody.append(element('small',` · Progress: ${a.progressDetails.currentValue??0} / ${a.progressDetails.maximum??0}`));
        if(a.serverControlled)techBody.append(element('small',' · Server-controlled'));
      }else{
        if(a.unlocked===true&&currentAchMethod==='protocol'){if(selectEligible&&a.batchSupport?.canRemove){const remove=button('Review removal',()=>reviewChangeSelection([{apiname:a.apiname,action:'remove'}]),'btn-action-sm');remove.disabled=experimentBusy;info.append(remove);}else techBody.append(element('small','Removal unavailable: '+(a.batchSupport?.removalReason||a.removalSupport?.reason||'Refresh direct verification to check the current state and permissions.'),'ach-write-reason'));}
        if(a.hidden===true)techBody.append(element('small',' · Hidden achievement'));
        if(a.progressDetails)techBody.append(element('small',` · Progress: ${a.progressDetails.currentValue??'unknown'} / ${a.progressDetails.maximum??'unknown'}`));
        if(a.serverControlled) techBody.append(element('small',' · Server-controlled'));
        if(a.hasProgressDependency) techBody.append(element('small',' · Linked progress statistic'));
        const available=availability.get(a),classification=element('div',available.label,'ach-availability '+available.status);classification.title=available.reason;techBody.append(classification);
        if(a.unlocked!==true){techBody.append(element('small',available.reason,'ach-write-reason'));if(available.action&&!isAuthorizedAccount(active))techBody.append(element('small','Activation from this panel is available only on the server-managed main account.','ach-write-reason'));if(available.provisional)techBody.append(element('small','Not guaranteed: Steam must accept the update and a fresh read must confirm it.','ach-write-reason'));}
        if(currentAchMethod==='protocol' && a.compatibility) {
          if(a.unlocked===false && isAuthorizedAccount(active)) {
            if(available.canAttempt&&available.action==='unlock'){const unlock=button(experimentBusy?'Checking Steam…':'Unlock achievement',()=>a.batchSupport?.canReactivate?reviewChangeSelection([{apiname:a.apiname,action:'unlock'}]):unlockIndividualAchievement(a));unlock.disabled=experimentBusy;unlock.title=a.compatibility.reason;info.append(unlock);}
            if(a.hasProgressDependency&&(available.canAttempt&&available.action==='progress'||a.progressSupport?.canPreviewShared||a.progressSupport?.canPreviewFloat)){const progress=button(experimentBusy?'Checking Steam…':'Review progress',()=>reviewAchievementProgress(a));progress.disabled=experimentBusy;info.append(progress);}
          }
          if(a.unlocked!==true && !a.compatibility.canUnlock)techBody.append(element('small',a.compatibility.action||'','ach-write-reason'));
        } else if(currentAchMethod==='web' && a.unlocked===false) techBody.append(element('small','Choose Direct verification in the reading mode to check activation compatibility.','ach-write-reason'));
      }
      if(techBody.childNodes.length)info.append(techDrawer);

      const tdPct=element('td',undefined,'ach-td-pct');
      const tierCls=a.tier?(' tier-'+String(a.tier).toLowerCase()):'';
      const rarityPill=element('small',a.percent===null?'Unknown rarity':`${isVeryRare?'⭐ ':''}${a.tier} · ${a.percent.toFixed(1)}%`,'ach-rarity-pill'+(isVeryRare?' rare-gold':'')+tierCls);
      tdPct.append(rarityPill);
      if(typeof a.percent==='number'&&Number.isFinite(a.percent)){
        const miniBar=element('div',undefined,'ach-mini-pct-bar'),miniFill=element('div',undefined,'ach-mini-pct-fill'+tierCls);
        miniFill.style.width=`${Math.max(4,Math.min(100,a.percent))}%`;
        miniBar.append(miniFill);
        tdPct.append(miniBar);
      }

      const tdRarity=element('td',undefined,'ach-td-rarity');
      const rDot=element('span',undefined,'ach-rarity-dot '+String(a.tier||'unknown').toLowerCase());
      tdRarity.append(rDot,element('span',a.tier||'Unknown'));

      const tdDate=element('td',undefined,'ach-td-date');
      if(a.unlockTimestamp){
        tdDate.append(element('small','Steam-reported unlock date: '+new Date(a.unlockTimestamp*1000).toLocaleString('en-US'),'ach-date'));
      }else if(a.unlockDate){
        tdDate.append(element('small','Steam-reported unlock date: '+a.unlockDate,'ach-date'));
      }else{
        tdDate.append(element('small','—','ach-date'));
      }
      if(!liveProto){
        const recordedAt=a.panelVerifiedAt||a.panelOperationAt;
        if(recordedAt&&Number.isFinite(Date.parse(recordedAt)))tdDate.append(element('small',(a.panelVerifiedAt?'Verified by this panel: ':'Panel operation recorded: ')+new Date(recordedAt).toLocaleString('en-US'),'ach-date panel-date'));
        if(a.panelOperationAt&&a.unlockTimestamp&&a.unlockTimestamp*1000<Date.parse(a.panelOperationAt)-86400000)tdDate.append(element('small',"Steam's reported date predates this panel operation. It is separate from the recorded test time.",'ach-date-note'));
      }

      const tdAction=element('td',undefined,'ach-td-action');
      tdAction.append(element('span',a.unlocked===true?'✓ Verified':a.unlocked===false?'Locked':'Not verified','ach-state'+(a.unlocked===true?' verified':'')));
      if(liveProto){
        const actionWrap=element('div',undefined,'sam-row-actions');
        if(a.unlocked===true&&!a.serverControlled&&a.apiname){
          const remove=button(experimentBusy?'Applying…':'Lock',()=>directApplyChanges({selection:[{apiname:a.apiname,action:'remove'}],resetCounters:true}),'btn-clear sam-quick-btn');
          remove.disabled=experimentBusy||!allowActivation;actionWrap.append(remove);
        }else if(a.unlocked===false&&!a.serverControlled&&a.apiname){
          const unlock=button(experimentBusy?'Applying…':'Unlock',()=>directApplyChanges({selection:[{apiname:a.apiname,action:'unlock'}]}),'btn-main sam-quick-btn');
          unlock.disabled=experimentBusy||!allowActivation;actionWrap.append(unlock);
        }
        if(actionWrap.childNodes.length)tdAction.append(actionWrap);
      }

      row.append(tdIcon,info,tdPct,tdRarity,tdDate,tdAction);
      tbody.append(row);
    }
    table.append(thead,tbody);
    tableWrap.append(table);
    renderedNodes.push(tableWrap);
  }
  if(pages>1){const nav=element('div',undefined,'ach-pagination');if(page>0)nav.append(button('Previous',()=>{renderAchModal(page-1);cont.scrollTop=0;}));nav.append(element('span',`Page ${page+1} of ${pages} · ${list.length} matching achievements`));if(page+1<pages)nav.append(button('Next',()=>{renderAchModal(page+1);cont.scrollTop=0;}));renderedNodes.push(nav);}
  if(!list.length) { const message=element('p',filterRarity!=='all'&&rarityLoading?'Loading rarity percentages from Steam…':filterRarity!=='all'&&rarityMissing===currentAchList.length&&currentAchList.length?'Steam has not supplied rarity percentages for this list. Try again later or use Show all.':currentAchList.length?'No achievements match these filters.':'No achievement list is available. Check the Steam message above.'); renderedNodes.push(message); if(currentAchList.length) renderedNodes.push(button('Show all',()=>{achievementPage=0;filterStatus='all';filterRarity='all';filterCompatibility='all';currentAchSet='all';$('achCompatibilityFilter').value='all';searchQuery='';$('achSearchInput').value='';renderAchModal();})); }
  cont.replaceChildren(...renderedNodes);
  updateSelectionSummary();
}

async function directApplyChanges({selection,bulkAction,resetCounters,forceFreshTimestamp=false,wipeStats=false}={}){
  if(!currentAchAppId)return;
  if(!isAuthorizedAccount(active)||active?.connected!==true){
    notice(t('liveActionNotice')||'Conectá tu cuenta principal de Steam para modificar logros en directo.');
    if(!activeAccountId)openAddAccModal();
    return;
  }
  if(currentAchMethod!=='protocol'){
    notice('Conectando con la sesión directa de Steam para modificar logros...');
    await openAchModal(currentAchAppId,currentAchGameName,true,'protocol');
    if(currentAchMethod!=='protocol')return;
  }
  lastDirectAchWriteAt=Date.now();
  achievementLive.stop();
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName,serial=achSerial;
  const stealth=Boolean($('stealthModeToggle')?.checked);
  const resetToggle=$('samResetStatsOnLockToggle'); const wantReset=resetToggle?resetToggle.checked:true; const effectiveReset=resetCounters!==undefined?Boolean(resetCounters):(wantReset&&(bulkAction==='lock_all'||wipeStats||(Array.isArray(selection)&&selection.some(i=>i.action==='remove'))));
  const nowSec=Math.floor(Date.now()/1000);
  const rollback=new Map(currentAchList.map(r=>[r.apiname,{
    unlocked:r.unlocked,
    unlockTimestamp:r.unlockTimestamp,
    batchSupport:r.batchSupport?{...r.batchSupport}:undefined,
    removalSupport:r.removalSupport?{...r.removalSupport}:undefined,
    compatibility:r.compatibility?{...r.compatibility}:undefined
  }]));

  // 0 ms Optimistic UI update in memory before network request
  const applyRowOptimistic=(row,wantUnlock)=>{
    row.unlocked=wantUnlock;
    row.unlockTimestamp=wantUnlock?nowSec:0;
    row.batchSupport={...(row.batchSupport||{}),canRemove:wantUnlock,canReactivate:!wantUnlock};
    row.removalSupport={...(row.removalSupport||{}),canRemove:wantUnlock};
    if(!wantUnlock&&row.compatibility){
      row.compatibility={...row.compatibility,canUnlock:true,status:row.compatibility.status==='already_unlocked'?'provisional':row.compatibility.status};
    }
  };
  if(bulkAction==='unlock_all'){
    for(const row of currentAchList){
      if(!row.serverControlled&&row.unlocked!==true)applyRowOptimistic(row,true);
    }
  }else if(bulkAction==='lock_all'||wipeStats){
    for(const row of currentAchList){
      applyRowOptimistic(row,false);
    }
  }else if(bulkAction==='refresh_dates'){
    for(const row of currentAchList){
      if(!row.serverControlled&&row.unlocked===true)applyRowOptimistic(row,true);
    }
  }else if(Array.isArray(selection)){
    const byApi=new Map(currentAchList.map(r=>[r.apiname,r]));
    for(const item of selection){
      const row=byApi.get(item.apiname);
      if(row)applyRowOptimistic(row,item.action==='unlock');
    }
    if(selection.length===1){
      const row=byApi.get(selection[0].apiname);
      showAchievementToast({name:row?.name||selection[0].apiname,gameName:title,iconUrl:row?.iconOpen,action:selection[0].action});
    }
  }
  clearAchievementSelection();
  const scroll=$('achListContainer')?.scrollTop||0;
  renderAchModal(achievementPage);
  if($('achListContainer'))$('achListContainer').scrollTop=scroll;

  try{
    const cleanDatesToggle=$('samCleanStaleDatesToggle');
    const preserveRetainedDates=Boolean(cleanDatesToggle&&!cleanDatesToggle.checked&&!forceFreshTimestamp);
    const payload={
      accountId:account,
      appid:id,
      confirmed:true,
      directApply:true,
      bulk:true,
      resetCounters:effectiveReset,
      ...(bulkAction==='lock_all'||wipeStats?{wipeStats:true}:{}),
      stealth,
      ...(forceFreshTimestamp||bulkAction==='refresh_dates'?{forceFreshTimestamp:true}:{}),
      ...(preserveRetainedDates?{preserveRetainedDates:true}:{}),
      ...(bulkAction?{bulkAction}:{}),
      ...(Array.isArray(selection)?{selection}:{})
    };
    const result=await api('/api/achievement/change',payload);
    lastDirectAchWriteAt=Date.now();
    if(serial===achSerial&&id===currentAchAppId&&account===activeAccountId){
      achievementPreviews.delete(previewKey(account,id,currentAchMethod));
      achCache.set(`${account}:${id}`,{achievements:currentAchList,statistics:currentStatsList});
      rememberAchievements(previewKey(account,id,'protocol'),{achievements:currentAchList});
      if($('undoLastOperationBtn'))$('undoLastOperationBtn').hidden=false;
      renderAchModal(achievementPage);
      if(liveContext)achievementLive.start({...liveContext,method:'protocol'});
    }
    notice(result.message||'Steam confirmed the achievement changes.');
  }catch(e){
    if(serial===achSerial&&id===currentAchAppId&&account===activeAccountId){
      for(const row of currentAchList){
        const prev=rollback.get(row.apiname);
        if(prev)Object.assign(row,prev);
      }
      renderAchModal(achievementPage);
    }
    notice(e.message);
  }
}

function renderReviewedChangesPanel(preview,context){
  const {id,account,serial,version,bulk=false,bulkAction=null,resetCounters=false}=context;
  document.querySelector('#sharedProgressReview .eyebrow').textContent='REVIEW BEFORE CONFIRMING';
  document.querySelector('#sharedProgressReview h3').textContent=bulkAction==='unlock_all'?'Unlock all eligible achievements':bulkAction==='lock_all'?'Lock all unlocked achievements':'Selected achievement changes';
  const summary=$('sharedProgressSummary');
  const unlockCount=preview.selection.filter(e=>e.action==='unlock').length,removeCount=preview.selection.filter(e=>e.action==='remove').length;
  summary.replaceChildren(element('strong',`${unlockCount} to unlock · ${removeCount} to remove`));
  if(removeCount)summary.append(element('p',resetCounters?'Removal clears the selected achievements and resets writable non-increment-only progress counters to their minimum.':'Removal clears only the selected achievements. Gameplay counters stay unchanged; the game may unlock them again.','shared-counter-meta'));
  if(bulkAction==='lock_all'){
    const toggleWrap=element('label',undefined,'bulk-reset-toggle'),toggleInput=element('input');
    toggleInput.type='checkbox';toggleInput.id='bulkResetCountersToggle';toggleInput.checked=Boolean(resetCounters);
    toggleInput.addEventListener('change',()=>reviewBulkChanges('lock_all',toggleInput.checked));
    toggleWrap.append(toggleInput,element('span','Reset writable progress counters to minimum when locking all'));
    summary.append(toggleWrap);
  }
  for(const p of preview.progressChanges)summary.append(element('p',`${p.statName}: ${p.before} → ${p.after}`,'shared-counter-meta'));
  const effects=$('sharedProgressEffects'),effectNodes=[];
  for(const e of (preview.effects||[]).slice(0,64)){
    const card=element('article',undefined,'shared-effect-card '+(e.action==='unlock'?'would_unlock':e.action==='remove'?'restricted':'progress_only')),heading=element('div',undefined,'shared-effect-heading');
    heading.append(element('strong',e.name),element('span',e.action==='unlock'?'Will unlock':e.action==='remove'?'Will remove':'Progress only','shared-effect-badge'));card.append(heading);
    for(const p of e.progressChanges||[])card.append(element('small',`${p.statName}: ${p.before} → ${p.after}`,'shared-effect-progress'));
    if(e.warning)card.append(element('small',e.warning,'shared-effect-progress'));effectNodes.push(card);
  }
  if((preview.effects||[]).length>64)effectNodes.push(element('small',`Showing the first 64 of ${preview.effects.length} reviewed achievement effects.`));
  effects.replaceChildren(...effectNodes);
  $('sharedProgressActions').replaceChildren();$('sharedProgressMessage').textContent=preview.message+' Nothing has been sent to Steam.';
  if(preview.canActivate===true)$('sharedProgressActions').append(button(bulkAction==='unlock_all'?'Confirm unlock all':bulkAction==='lock_all'?'Confirm lock all':'Confirm selected changes',()=>confirmChangeSelection(preview,{id,account,serial,version,bulk,bulkAction,resetCounters}),'btn-main shared-confirm'));
  $('sharedProgressReview').hidden=false;document.querySelector('.ach-modal-card').classList.add('shared-review-open');
}
async function reviewChangeSelection(input=[...achievementSelection.values()],options={}){
  if(experimentBusy||!currentAchAppId||!input.length)return;
  if(!isAuthorizedAccount(active)||active?.connected!==true){
    notice(t('liveActionNotice')||'Conectá tu cuenta principal de Steam para modificar logros en directo.');
    if(!activeAccountId)openAddAccModal();
    return;
  }
  if(currentAchMethod!=='protocol'){
    notice('Conectando con la sesión directa de Steam para modificar logros...');
    await openAchModal(currentAchAppId,currentAchGameName,true,'protocol');
    if(currentAchMethod!=='protocol')return;
  }
  if(isLiveProtocol()&&!options.forceReview){
    return directApplyChanges({selection:input,resetCounters:input.some(i=>i.action==='remove')});
  }
  const id=currentAchAppId,account=activeAccountId,serial=achSerial,version=selectionVersion;
  const selectedRows=input.map(item=>currentAchList.find(a=>a.apiname===item.apiname)).filter(Boolean);
  const hasRealStatId=selectedRows.some(r=>Number.isInteger(r.statId));
  const bulk=Boolean(options.bulk||input.length>32||hasRealStatId||selectedRows.some(r=>r.hasProgressDependency||r.batchSupport?.canReactivate));
  const resetCounters=Boolean(options.resetCounters??(hasRealStatId&&input.some(i=>i.action==='remove')));
  experimentBusy=true;renderAchModal();
  try{
    const preview=await api('/api/achievement/change-preview',{accountId:account,appid:id,selection:input,...(bulk?{bulk:true}:{}),...(resetCounters?{resetCounters:true}:{})});
    if(serial!==achSerial||version!==selectionVersion||account!==activeAccountId||id!==currentAchAppId||currentAchMethod!=='protocol')return;
    renderReviewedChangesPanel(preview,{id,account,serial,version,bulk,resetCounters});
  }catch(e){if(serial===achSerial&&account===activeAccountId)notice(e.message);}
  finally{experimentBusy=false;if(serial===achSerial&&account===activeAccountId)renderAchModal();}
}
async function reviewBulkChanges(bulkAction,resetCounters){
  if(experimentBusy||!currentAchAppId||!['unlock_all','lock_all'].includes(bulkAction))return;
  if(!isAuthorizedAccount(active)||active?.connected!==true){
    notice(t('liveActionNotice')||'Conectá tu cuenta principal de Steam para modificar logros en directo.');
    if(!activeAccountId)openAddAccModal();
    return;
  }
  if(currentAchMethod!=='protocol'){
    notice('Conectando con la sesión directa de Steam para modificar logros...');
    await openAchModal(currentAchAppId,currentAchGameName,true,'protocol');
    if(currentAchMethod!=='protocol')return;
  }
  const effectiveReset=resetCounters!==undefined?Boolean(resetCounters):(bulkAction==='lock_all'&&currentAchList.some(a=>Number.isInteger(a.statId)));
  if(isLiveProtocol()){
    return directApplyChanges({bulkAction,resetCounters:bulkAction==='lock_all',wipeStats:bulkAction==='lock_all'});
  }
  const id=currentAchAppId,account=activeAccountId,serial=achSerial,version=++selectionVersion;experimentBusy=true;renderAchModal();
  try{
    const preview=await api('/api/achievement/change-preview',{accountId:account,appid:id,bulk:true,bulkAction,resetCounters:effectiveReset});
    if(serial!==achSerial||version!==selectionVersion||account!==activeAccountId||id!==currentAchAppId||currentAchMethod!=='protocol')return;
    renderReviewedChangesPanel(preview,{id,account,serial,version,bulk:true,bulkAction,resetCounters:effectiveReset});
  }catch(e){if(serial===achSerial&&account===activeAccountId)notice(e.message);}
  finally{experimentBusy=false;if(serial===achSerial&&account===activeAccountId)renderAchModal();}
}
function selectPageAchievements(){
  if(experimentBusy||currentAchMethod!=='protocol'||!currentAchAppId||!isAuthorizedAccount(active))return;
  const boxes=[...document.querySelectorAll('.ach-select')];
  if(!boxes.length)return;
  const allChecked=boxes.every(b=>b.checked);
  if(allChecked){clearAchievementSelection();renderAchModal();return;}
  for(const check of boxes){
    if(!check.checked){check.checked=true;check.dispatchEvent(new Event('change'));}
  }
}
function invertPageAchievements(){
  if(experimentBusy||currentAchMethod!=='protocol'||!currentAchAppId||!isAuthorizedAccount(active))return;
  const boxes=[...document.querySelectorAll('.ach-select')];
  for(const check of boxes){
    check.checked=!check.checked;
    check.dispatchEvent(new Event('change'));
  }
}
async function confirmChangeSelection(preview,{id,account,serial,version,bulk=false,bulkAction=null,resetCounters=false}){
  if(experimentBusy||currentAchMethod!=='protocol'||id!==currentAchAppId||account!==activeAccountId||serial!==achSerial||version!==selectionVersion||preview.canActivate!==true)return;
  const shownEffects=preview.effects.slice(0,24).map(e=>`${e.name}: ${e.action==='unlock'?'unlock':e.action==='remove'?'remove':'progress only'}`).join('\n')+(preview.effects.length>24?`\n…and ${preview.effects.length-24} more reviewed achievements`:'');
  const progress=preview.progressChanges.slice(0,16).map(p=>`${p.statName}: ${p.before} → ${p.after}`).join('\n');
  const title=currentAchGameName;
  if(!confirm(`Apply exactly these reviewed changes in "${title}"?\n\n${shownEffects}\n\n${progress}\n\nThis changes Steam achievements and statistics. Game-save progress is not verified. No automatic retry will be sent.`))return;
  achievementPreviews.clear();experimentBusy=true;$('sharedProgressActions').replaceChildren();updateSelectionSummary();
  try{
    const payload={accountId:account,appid:id,selection:preview.selection,revision:preview.revision,confirmed:true,...(bulk?{bulk:true}:{}),...(bulkAction?{bulkAction}:{}),...(resetCounters?{resetCounters:true}:{})};
    const result=await api('/api/achievement/change',payload);notice(result.message);
  }
  catch(e){notice(e.message);}
  finally{experimentBusy=false;if(serial===achSerial&&id===currentAchAppId&&account===activeAccountId&&$('achModal').style.display==='flex')await openAchModal(id,title,true,'protocol');}
}


async function loadGameLeaderboards() {
  if (!currentAchAppId) return;
  const id = currentAchAppId, account = currentAccKey();
  try {
    const data = await api(`/api/leaderboards?accountId=${encodeURIComponent(account)}&appid=${id}`);
    currentLeaderboardsList = Array.isArray(data.leaderboards) ? data.leaderboards : [];
    const sel = $('leaderboardSelect');
    if (sel) {
      sel.replaceChildren();
      for (const b of currentLeaderboardsList) {
        const opt = element('option', `${b.name} (${b.entryCount || 0} entries)`);
        opt.value = String(b.id);
        sel.append(opt);
      }
      if (currentLeaderboardsList.length) {
        currentLeaderboardId = Number(currentLeaderboardsList[0].id) || 101;
        sel.value = String(currentLeaderboardId);
      }
    }
    await loadLeaderboardEntries(currentLeaderboardId);
  } catch (e) {
    if ($('leaderboardUserRankCard')) $('leaderboardUserRankCard').textContent = e.message;
  }
}

async function loadLeaderboardEntries(leaderboardId = currentLeaderboardId) {
  if (!currentAchAppId) return;
  currentLeaderboardId = Number(leaderboardId) || 101;
  const id = currentAchAppId, account = currentAccKey();
  const scope = Number($('leaderboardScopeSelect')?.value ?? 0) || 0;
  try {
    const data = await api(`/api/leaderboards/entries?accountId=${encodeURIComponent(account)}&appid=${id}&leaderboardId=${currentLeaderboardId}&dataRequest=${scope}`);
    const rankCard = $('leaderboardUserRankCard');
    if (rankCard) {
      if (data.userEntry) {
        rankCard.textContent = currentLang === 'es'
          ? `Tu puesto actual: #${data.userEntry.rank} Mundial · ${data.userEntry.personaName} · Puntuación: ${data.userEntry.score}`
          : `Your current rank: #${data.userEntry.rank} Mundial (World) · ${data.userEntry.personaName} · Score: ${data.userEntry.score}`;
      } else {
        rankCard.textContent = currentLang === 'es'
          ? 'Tu puesto actual: Sin clasificar en este tablero. Sube una puntuación para entrar al Ranking Mundial.'
          : 'Your current rank: Unranked on this board. Upload a score to enter the World Leaderboard.';
      }
    }
    const tbody = $('leaderboardTopTableBody');
    if (tbody) {
      tbody.replaceChildren();
      if (!Array.isArray(data.topEntries) || !data.topEntries.length) {
        const emptyTr = element('tr');
        const emptyTd = element('td', t('noLeaderboardScores'));
        emptyTd.colSpan = 3;
        emptyTd.style.textAlign = 'center';
        emptyTd.style.padding = '18px';
        emptyTd.style.color = 'var(--text-muted)';
        emptyTr.append(emptyTd);
        tbody.append(emptyTr);
      }
      for (const entry of data.topEntries || []) {
        const tr = element('tr', undefined, 'ach-item');
        const tdRank = element('td', `#${entry.rank}`);
        tdRank.style.fontWeight = '700';
        const tdPlayer = element('td');
        const pWrap = element('div');
        pWrap.style.display = 'flex';
        pWrap.style.alignItems = 'center';
        pWrap.style.gap = '8px';
        if (entry.avatarUrl) {
          const av = image(entry.avatarUrl);
          av.style.width = '24px';
          av.style.height = '24px';
          av.style.borderRadius = '4px';
          pWrap.append(av);
        }
        pWrap.append(element('strong', entry.personaName));
        tdPlayer.append(pWrap);
        const tdScore = element('td', String(entry.score));
        tdScore.style.fontVariantNumeric = 'tabular-nums';
        tr.append(tdRank, tdPlayer, tdScore);
        tbody.append(tr);
      }
    }
  } catch (e) {
    if ($('leaderboardUserRankCard')) $('leaderboardUserRankCard').textContent = e.message;
  }
}

async function submitLeaderboardScore() {
  if (!activeAccountId) {
    notice(t('liveActionNotice'));
    openAddAccModal();
    return;
  }
  if (!currentAchAppId) return;
  const rawScore = Number($('leaderboardScoreInput')?.value);
  if (!Number.isFinite(rawScore)) {
    notice('Enter a valid numeric score or time.');
    return;
  }
  const scoreMethod = $('leaderboardMethodSelect')?.value || 'keep_best';
  const stealth = Boolean($('stealthModeToggle')?.checked);
  try {
    const res = await api('/api/leaderboards/upload', {
      accountId: activeAccountId,
      appid: currentAchAppId,
      leaderboardId: currentLeaderboardId,
      score: Math.trunc(rawScore),
      scoreMethod,
      stealth
    });
    notice(res.message || 'Leaderboard score uploaded to Steam.');
    await loadLeaderboardEntries(currentLeaderboardId);
  } catch (e) {
    notice(e.message);
  }
}

/* SamRewritten Statistics Editor */
async function loadGameStats(){
  if(!currentAchAppId)return;
  const id=currentAchAppId,account=currentAccKey(),serial=achSerial;
  try{
    const data=await api(`/api/stats?accountId=${encodeURIComponent(account)}&appid=${id}`);
    if(serial!==achSerial||account!==currentAccKey()||id!==currentAchAppId)return;
    currentStatsList=Array.isArray(data.stats)?data.stats:[];
    modifiedStats.clear();
    renderStatsModal();
  }catch(e){
    if(serial===achSerial&&$('statsListContainer'))$('statsListContainer').replaceChildren(element('p',e.message));
  }
}
function renderStatsModal(){
  const cont=$('statsListContainer');if(!cont)return;
  const query=($('statsSearchInput')?.value||'').trim().toLowerCase();
  const hideProtected=Boolean($('hideProtectedStats')?.checked);
  const canEdit=isAuthorizedAccount(active)&&active?.connected===true&&!active?.isCollisionPaused;
  const list=currentStatsList.filter(s=>{
    if(hideProtected&&s.protected)return false;
    if(query&&!(`${s.name} ${s.displayName}`).toLowerCase().includes(query))return false;
    return true;
  });
  if($('statsCountLabel'))$('statsCountLabel').textContent=`${list.length} of ${currentStatsList.length} statistics`;
  if($('saveStatsBtn'))$('saveStatsBtn').disabled=experimentBusy||!canEdit||!modifiedStats.size;
  if($('resetAllStatsBtn'))$('resetAllStatsBtn').disabled=experimentBusy||!canEdit;
  if(!list.length){
    cont.replaceChildren(element('p',currentStatsList.length?'No statistics match these filters.':'This game exposes no personal numeric statistics in its schema.'));
    return;
  }
  const nodes=[];
  for(const s of list){
    const row=element('div',undefined,'sam-stat-row'+(modifiedStats.has(s.statId)?' modified':''));
    const meta=element('div',undefined,'sam-stat-meta');
    meta.append(element('strong',s.displayName&&s.displayName!==s.name?`${s.displayName} (${s.name})`:s.name));
    const details=[`ID #${s.statId}`,s.type];
    if(s.min!==null||s.max!==null)details.push(`Range: ${s.min??'-∞'} .. ${s.max??'∞'}`);
    if(s.incrementOnly)details.push('Increment-only');
    if(s.protected)details.push('Protected');
    meta.append(element('small',details.join(' · ')));
    const input=element('input',undefined,'sam-stat-input');
    input.type='number';
    input.step=s.type==='FLOAT'?'any':'1';
    input.value=String(modifiedStats.has(s.statId)?modifiedStats.get(s.statId):s.value);
    input.disabled=experimentBusy||!canEdit;
    input.addEventListener('input',()=>{
      const num=Number(input.value);
      if(Number.isFinite(num)&&num!==s.value){
        modifiedStats.set(s.statId,num);
        row.classList.add('modified');
      }else{
        modifiedStats.delete(s.statId);
        row.classList.remove('modified');
      }
      if($('saveStatsBtn'))$('saveStatsBtn').disabled=experimentBusy||!canEdit||!modifiedStats.size;
    });
    row.append(meta,input);
    nodes.push(row);
  }
  cont.replaceChildren(...nodes);
}
async function commitModifiedStats(){
  if(experimentBusy||!currentAchAppId||!modifiedStats.size||!isAuthorizedAccount(active))return;
  const id=currentAchAppId,account=activeAccountId,serial=achSerial;
  const changes=[...modifiedStats.entries()].map(([statId,value])=>({statId,value}));
  const stealth=Boolean($('stealthModeToggle')?.checked);
  experimentBusy=true;renderStatsModal();
  try{
    const result=await api('/api/stats',{accountId:account,appid:id,changes,stealth});
    if(serial!==achSerial)return;
    if(Array.isArray(result.stats))currentStatsList=result.stats;
    modifiedStats.clear();
    notice(result.message||'Statistics updated on Steam.');
    renderStatsModal();
  }catch(e){
    notice(e.message);
  }finally{
    experimentBusy=false;renderStatsModal();
  }
}
async function resetAllGameStats(){
  if(experimentBusy||!currentAchAppId||!isAuthorizedAccount(active))return;
  const id=currentAchAppId,account=activeAccountId,serial=achSerial;
  const stealth=Boolean($('stealthModeToggle')?.checked);
  experimentBusy=true;renderStatsModal();
  try{
    const result=await api('/api/stats',{accountId:account,appid:id,resetAll:true,action:'reset_all',stealth});
    if(serial!==achSerial)return;
    achievementPreviews.delete(previewKey(account,id,currentAchMethod));
    achCache.delete(`${account}:${id}`);
    if(Array.isArray(result.stats))currentStatsList=result.stats;
    if(Array.isArray(result.achievements)){
      currentAchList=AchievementRarity.normalizeRows(result.achievements.map(a=>({...a,name:String(a.name||a.apiname||'Achievement'),description:String(a.description||''),unlocked:typeof a.unlocked==='boolean'?a.unlocked:false})));
      renderAchModal(0);
    }
    modifiedStats.clear();
    notice(result.message||'Todas las estadísticas y logros del juego fueron reiniciados a 0 en los servidores de Steam.');
    renderStatsModal();
  }catch(e){
    notice(e.message);
  }finally{
    experimentBusy=false;renderStatsModal();
  }
}
async function toggleCollisionBypass(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  try{
    const res=await api('/api/toggle-collision-bypass',{accountId:activeAccountId});
    if(active)active.ignoreSessionCollision=Boolean(res?.ignoreSessionCollision);
    updateActiveAccountControlsI18n(active);
    if(res?.message)notice(res.message);
    await loadStatus();
  }catch(e){
    notice(e.message);
  }
}
const SAMPLE_1X1_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function getSniperTargetFromInputs(){
  const appId=Number($('sniperAppIdInput')?.value||730)||730;
  const marketHashName=($('sniperHashNameInput')?.value||'CS2 Case Key').trim()||'CS2 Case Key';
  const maxPriceCents=Math.max(1,Number($('sniperMaxPriceCentsInput')?.value||25)||25);
  const intervalMs=Math.max(500,Number($('sniperIntervalMsInput')?.value||2500)||2500);
  return {appId,marketHashName,maxPriceCents,intervalMs};
}
async function startMarketSniper(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const {appId,marketHashName,maxPriceCents,intervalMs}=getSniperTargetFromInputs();
  try{
    const res=await api('/api/sniper/start',{accountId:activeAccountId,intervalMs,targets:[{appId,marketHashName,maxPriceCents}]});
    if($('marketSniperStatusText')&&res?.message)$('marketSniperStatusText').textContent=res.message;
    if($('btnStopMarketSniper'))$('btnStopMarketSniper').hidden=false;
    if(res?.message)notice(res.message);
  }catch(e){
    notice(e.message);
  }
}
async function scanMarketOnce(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const {appId,marketHashName,maxPriceCents}=getSniperTargetFromInputs();
  try{
    const res=await api('/api/sniper/scan-once',{accountId:activeAccountId,targets:[{appId,marketHashName,maxPriceCents}]});
    if($('marketSniperStatusText')&&res?.message)$('marketSniperStatusText').textContent=res.message;
    if(res?.message)notice(res.message);
  }catch(e){
    notice(e.message);
  }
}
function openMarketListing(){
  const {appId,marketHashName}=getSniperTargetFromInputs();
  const url=`https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(marketHashName)}`;
  if(typeof window.open==='function')try{window.open(url,'_blank');}catch{}
}
async function stopMarketSniper(){
  if(!activeAccountId)return;
  try{
    const res=await api('/api/sniper/stop',{accountId:activeAccountId});
    if($('marketSniperStatusText')&&res?.message)$('marketSniperStatusText').textContent=res.message;
    if($('btnStopMarketSniper'))$('btnStopMarketSniper').hidden=true;
    if(res?.message)notice(res.message);
  }catch(e){
    notice(e.message);
  }
}
async function runAlchemyCycle(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const appId=Number($('alchemyAppIdInput')?.value||$('alchemyPresetSelect')?.value||730)||730;
  const tradabilityPreference=Number($('alchemyTradabilitySelect')?.value||1)||1;
  try{
    const res=await api('/api/alchemy/craft-booster',{accountId:activeAccountId,appId,tradabilityPreference});
    if($('alchemyStatusText')&&res?.message)$('alchemyStatusText').textContent=res.message;
    if(res?.message)notice(res.message);
  }catch(e){
    notice(e.message);
  }
}
async function convertAlchemyItemToGems(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const assetId=($('alchemyAssetIdInput')?.value||'').trim();
  if(!assetId)return notice('Ingresá el AssetID del ítem de tu inventario que querés convertir en gemas.');
  try{
    const res=await api('/api/alchemy/convert-gems',{accountId:activeAccountId,assetId});
    if($('alchemyStatusText')&&res?.message)$('alchemyStatusText').textContent=res.message;
    if(res?.message)notice(res.message);
  }catch(e){
    notice(e.message);
  }
}
async function craftCheapestLevelBadge(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const appId=Number($('levelOptimizerAppIdInput')?.value||$('levelPresetSelect')?.value||730)||730;
  const borderColor=Number($('levelBorderColorSelect')?.value||0)||0;
  try{
    const res=await api('/api/level/craft',{accountId:activeAccountId,appId,series:1,borderColor});
    if($('levelOptimizerStatusText')&&res?.message)$('levelOptimizerStatusText').textContent=res.message;
    if(res?.message)notice(res.message);
  }catch(e){
    notice(e.message);
  }
}
async function runElitePresenceWeapon(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const mode=$('elitePresenceModeSelect')?.value||'ghost_custom';
  const rawText=($('elitePresenceCustomInput')?.value||'').trim();
  let exploitType=mode;
  let customText=rawText;
  let badgeId=1;
  if(mode==='ghost_hl3'){
    exploitType='ghost_custom_game';
    customText=rawText||'Half-Life 3 (Closed Alpha — Source 2 Build 9842)';
  }else if(mode==='ghost_invisible'){
    exploitType='ghost_custom_game';
    customText='INVISIBLE';
  }else if(mode==='ghost_custom'){
    exploitType='ghost_custom_game';
    customText=rawText||'Half-Life 3 (Closed Beta)';
  }else if(mode==='badge_2003'){
    exploitType='force_favorite_badge';
    badgeId=Number(rawText)||1;
  }else if(mode==='badge_ghost_zero'){
    exploitType='force_favorite_badge';
    badgeId=0;
  }
  try{
    const res=await api('/api/overwatch2003/pioneer-exploit',{
      accountId:activeAccountId,
      exploitType,
      customText,
      badgeId
    });
    if($('elitePresenceStatusText')&&res?.message)$('elitePresenceStatusText').textContent=res.message;
    if(res?.message)notice(res.message);
    await loadStatus();
  }catch(e){
    notice(e.message);
  }
}
let selectedOverwatchScreenshot = {
  name: '',
  dataUrl: '',
  width: 1920,
  height: 1080
};

async function farmExclusiveRelics(mode = "all") {
  if (!activeAccountId) { notice(t("liveActionNotice")); openAddAccModal(); return; }
  const customTyped = Number(($("overwatchCustomAppIdInput")?.value || "").trim());
  const appId = (Number.isInteger(customTyped) && customTyped > 0)
    ? customTyped
    : (Number($("overwatchShowcaseAppSelect")?.value || 753) || 753);
  try {
    const res = await api("/api/overwatch2003/farm-relics", {
      accountId: activeAccountId,
      mode,
      appId
    });
    if ($("overwatchShowcaseStatusText") && res?.message) $("overwatchShowcaseStatusText").textContent = res.message;
    if (res?.message) notice(res.message);
    if (typeof refresh === "function") refresh().catch(() => {});
  } catch (e) {
    notice(e.message);
  }
}

async function injectHiddenShowcaseServerSide(fillCollectorRelics = false, slotsCount = 4, eventsMode = false) {
  if (!activeAccountId) { notice(t("liveActionNotice")); openAddAccModal(); return; }
  const customTyped = Number(($("overwatchCustomAppIdInput")?.value || "").trim());
  const appId = (Number.isInteger(customTyped) && customTyped > 0)
    ? customTyped
    : (Number($("overwatchShowcaseAppSelect")?.value || 202352) || 202352);
  const customizationType = Number($("overwatchShowcaseTypeSelect")?.value || 6) || 6;
  const targetInstance = $("overwatchShowcaseInstanceSelect")?.value || "second";
  const slotIndex = Number($("overwatchShowcaseSlotSelect")?.value || 0) || 0;
  const relicAppIds = eventsMode
    ? [202352, 245070, 765, 202351, 248210, 593110, 258280, 1675180, 223910, 267420, 303700, 368020]
    : (Number(slotsCount) === 12
      ? [753, 766, 92, 1675200, 1059530, 353380, 353370, 250820, 340, 211, 220, 10]
      : [753, 766, 92, 1675200]);
  try {
    const res = await api("/api/overwatch2003/showcase-inject", {
      accountId: activeAccountId,
      appId,
      customizationType,
      targetInstance: eventsMode ? "both" : targetInstance,
      slotIndex,
      slotsCount: Number(slotsCount) || 4,
      fillCollectorRelics: Boolean(fillCollectorRelics),
      alsoInjectFavorite: Boolean(eventsMode),
      relicAppIds
    });
    if ($("overwatchShowcaseStatusText") && res?.message) $("overwatchShowcaseStatusText").textContent = res.message;
    if (res?.message) notice(res.message);
    if (typeof refresh === "function") refresh().catch(() => {});
  } catch (e) {
    notice(e.message);
  }
}

function parseAnyAppIdInput(rawVal) {
  const str = String(rawVal || "").trim();
  if (!str) return null;
  const urlMatch = str.match(/\/app\/(\d+)/i);
  if (urlMatch && Number(urlMatch[1]) > 0) return Number(urlMatch[1]);
  const numMatch = str.match(/\b(\d{1,10})\b/);
  if (numMatch && Number(numMatch[1]) > 0) return Number(numMatch[1]);
  return null;
}

function ensureCustomAppOptionInSelect(selectEl, appId, selectIt = true) {
  if (!selectEl || !Number.isInteger(appId) || appId <= 0) return;
  const valStr = String(appId);
  let existing = [...(selectEl.options || [])].find(o => o.value === valStr);
  if (!existing) {
    existing = element("option", `🎯 Juego Personalizado: AppID ${appId}`);
    existing.value = valStr;
    selectEl.prepend(existing);
  }
  if (selectIt) selectEl.value = valStr;
}

function loadSavedCustomScreenshotApps() {
  try {
    const saved = JSON.parse(localStorage.getItem("sf_custom_screenshot_apps") || "[]");
    const sel = $("overwatchScreenshotAppSelect");
    if (Array.isArray(saved) && sel) {
      for (const id of saved) {
        if (Number.isInteger(Number(id)) && Number(id) > 0) {
          ensureCustomAppOptionInSelect(sel, Number(id), false);
        }
      }
    }
  } catch {}
}

async function saveCustomScreenshotAppId(showFeedback = true) {
  const raw = ($("overwatchScreenshotCustomAppInput")?.value || "").trim();
  const parsedId = parseAnyAppIdInput(raw);
  if (!parsedId) {
    if (showFeedback) notice("Escribí un AppID válido (ej. 1091500) o pegá el link del juego de Steam.");
    return null;
  }
  const sel = $("overwatchScreenshotAppSelect");
  ensureCustomAppOptionInSelect(sel, parsedId, true);
  try {
    const prev = JSON.parse(localStorage.getItem("sf_custom_screenshot_apps") || "[]");
    const next = [...new Set([parsedId, ...(Array.isArray(prev) ? prev : []).map(Number)])].slice(0, 30);
    localStorage.setItem("sf_custom_screenshot_apps", JSON.stringify(next));
  } catch {}
  // No agregar el juego de la captura a la lista de farmeo (solo guardarlo en el selector de capturas)
  if ($("overwatchScreenshotStatusText") && showFeedback) {
    $("overwatchScreenshotStatusText").textContent = `✅ Juego AppID ${parsedId} guardado y seleccionado en la lista. Ahora elegí tu foto y tocá el botón verde para subir la captura bajo el AppID ${parsedId}.`;
  }
  if (showFeedback) {
    notice(`✅ Juego AppID ${parsedId} guardado y seleccionado para tus capturas.`);
  }
  return parsedId;
}

function resolveSelectedScreenshotAppId() {
  const customTyped = parseAnyAppIdInput($("overwatchScreenshotCustomAppInput")?.value || "");
  if (customTyped) {
    ensureCustomAppOptionInSelect($("overwatchScreenshotAppSelect"), customTyped, true);
    return customTyped;
  }
  return Number($("overwatchScreenshotAppSelect")?.value || 753) || 753;
}

let lastGeneratedInstallerBat = "";

async function runPioneerExploitMotor5() {
  const sel = $("pioneerExploitSelect")?.value || "activate_trading_card_beta_202352";
  const rawInput = ($("pioneerExploitCustomInput")?.value || "").trim();
  const appId = resolveSelectedScreenshotAppId();
  let exploitType = sel;
  let customText = rawInput;
  let badgeId = 1;
  let saleAppId = 245070;
  let borderColor = 0;

  const saleMatch = sel.match(/^craft_sale_(\d+)(_foil)?$/);
  if (saleMatch) {
    exploitType = "craft_ancient_sale_badge";
    saleAppId = Number(rawInput) || Number(saleMatch[1]) || 245070;
    borderColor = saleMatch[2] ? 1 : 0;
  } else if (sel === "craft_summer_getaway_2013") {
    exploitType = "craft_ancient_sale_badge";
    saleAppId = Number(rawInput) || 245070;
    borderColor = 0;
  } else if (sel === "craft_summer_getaway_2013_foil") {
    exploitType = "craft_ancient_sale_badge";
    saleAppId = Number(rawInput) || 245070;
    borderColor = 1;
  } else if (sel === "craft_holiday_2013") {
    exploitType = "craft_ancient_sale_badge";
    saleAppId = Number(rawInput) || 267420;
    borderColor = 0;
  } else if (sel === "badge_hardware_beta_15") {
    exploitType = "force_favorite_badge";
    badgeId = 15;
  } else if (sel === "ghost_hl3") {
    exploitType = "ghost_custom_game";
    customText = rawInput || "Half-Life 3 (Closed Alpha — Source 2 Build 9842)";
  } else if (sel === "ghost_cs15") {
    exploitType = "ghost_custom_game";
    customText = rawInput || "Counter-Strike 1.5 — WON.net Server (2003)";
  } else if (sel === "ghost_invisible") {
    exploitType = "ghost_custom_game";
    customText = "INVISIBLE";
  } else if (sel === "ghost_custom") {
    exploitType = "ghost_custom_game";
    customText = rawInput || "Valve Internal Debugger v1.0";
  } else if (sel === "badge_2003") {
    exploitType = "force_favorite_badge";
    badgeId = Number(rawInput) || 1;
  } else if (sel === "badge_ghost_zero") {
    exploitType = "force_favorite_badge";
    badgeId = 0;
  }

  if (!["animated_gif_screenshot", "create_impossible_guide_202352", "wishlist_impossible_valve_apps", "steam_chat_special_fx_injector", "profile_comment_wall_graffiti", "profile_comment_invisible_tower"].includes(exploitType) && !activeAccountId) {
    notice(t("liveActionNotice"));
    openAddAccModal();
    return;
  }
  try {
    const res = await api("/api/overwatch2003/pioneer-exploit", {
      accountId: activeAccountId || "demo",
      exploitType,
      customText,
      badgeId,
      targetAppId: appId,
      saleAppId,
      borderColor
    });
    if ($("pioneerExploitStatusText") && res?.message) {
      $("pioneerExploitStatusText").textContent = res.message;
    }
    if ((exploitType === "activate_trading_card_beta_202352" || exploitType === "unlock_all_historical_events" || exploitType === "fill_showcases_all_events" || exploitType === "ghost_custom_game") && typeof refresh === "function") {
      try { await refresh(); } catch {}
    }
    if (res?.marketUrl && !res?.crafted && typeof window.open === "function") {
      try { window.open(res.marketUrl, "_blank"); } catch {}
    }
    if (res?.reviewsUrl && res?.publishedApps?.length && typeof window.open === "function") {
      try { window.open(res.reviewsUrl, "_blank"); } catch {}
    }
    if (res?.replayUrl2022 && typeof window.open === "function") {
      try { window.open(res.replayUrl2022, "_blank"); } catch {}
    }
    if (res?.consoleSnippet) {
      const vdfOut = $("overwatchScreenshotVdfOutput");
      if (vdfOut) {
        vdfOut.style.display = "block";
        vdfOut.value = res.consoleSnippet;
      }
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(res.consoleSnippet).catch(() => {});
      }
      if (res?.uploadUrl && typeof window.open === "function") {
        try { window.open(res.uploadUrl, "_blank"); } catch {}
      }
    }
    if (res?.message) notice(res.message);
  } catch (e) {
    notice(e.message);
  }
}

async function injectUcmScreenshotMotor4(actionMode = "inject") {
  if (!activeAccountId) { notice(t("liveActionNotice")); openAddAccModal(); return; }
  const datePreset = $("overwatchScreenshotDateSelect")?.value || "screenshots_beta_feb1_2011";
  const customDateVal = ($("overwatchCustomDateInput")?.value || "").trim();
  const customTimeVal = ($("overwatchCustomTimeInput")?.value || "12:00:00").trim();
  const customTimestamp = datePreset === "custom" ? customDateVal : null;
  const appId = resolveSelectedScreenshotAppId();
  const tagPreset = $("overwatchScreenshotTagPresetSelect")?.value || "gabe";
  const customTaggedInput = ($("overwatchScreenshotCustomTagInput")?.value || "").trim();
  const caption = ($("overwatchScreenshotCaptionInput")?.value || "").trim();
  if (selectedOverwatchScreenshot.readyPromise) {
    try { await selectedOverwatchScreenshot.readyPromise; } catch {}
  }
  const payloadToSend = selectedOverwatchScreenshot.jpgDataUrl || selectedOverwatchScreenshot.dataUrl || undefined;
  const thumbPayloadToSend = selectedOverwatchScreenshot.thumbJpgDataUrl || payloadToSend || undefined;
  try {
    const res = await api("/api/overwatch2003/inject-screenshot", {
      accountId: activeAccountId,
      appId,
      datePreset,
      customTimestamp,
      customTime: customTimeVal !== "12:00:00" ? customTimeVal : undefined,
      tagPreset,
      customTaggedInput,
      caption: caption || undefined,
      photoName: selectedOverwatchScreenshot.name || undefined,
      imagePayload: payloadToSend,
      thumbPayload: thumbPayloadToSend,
      width: selectedOverwatchScreenshot.width || 1920,
      height: selectedOverwatchScreenshot.height || 1080
    });
    if ($("overwatchScreenshotStatusText") && res?.message) {
      $("overwatchScreenshotStatusText").textContent = res.message;
    }
    if (res?.autoInstallerBat) {
      lastGeneratedInstallerBat = res.autoInstallerBat;
    }
    const vdfOut = $("overwatchScreenshotVdfOutput");
    if (vdfOut && (res?.autoInstallerPs1 || res?.vdfEntry)) {
      vdfOut.style.display = "block";
      vdfOut.value = res.autoInstallerPs1 || res.vdfEntry;
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(res.autoInstallerPs1 || res.vdfEntry).catch(() => {});
      }
    }
    if (actionMode === "download_jpg" && res?.officialJpgName) {
      const jpgSource = selectedOverwatchScreenshot.jpgDataUrl || selectedOverwatchScreenshot.dataUrl || SAMPLE_1X1_PNG_BASE64;
      const a = element("a");
      a.href = jpgSource;
      a.download = res.officialJpgName;
      document.body.append(a);
      a.click();
      a.remove();
      notice(`✅ Foto "${res.officialJpgName}" descargada y Comando Automático copiado al portapapeles (o tocá 4C para bajar el .BAT).`);
    } else if (actionMode === "download_bat" && res?.autoInstallerBat) {
      const batBlob = new Blob([res.autoInstallerBat], { type: "text/plain;charset=utf-8" });
      const batUrl = URL.createObjectURL(batBlob);
      const b = element("a");
      b.href = batUrl;
      b.download = "Instalar_Captura_Steam.bat";
      document.body.append(b);
      b.click();
      b.remove();
      notice("✅ Archivo Instalar_Captura_Steam.bat descargado. ¡Hacé doble clic sobre él en tu carpeta Descargas!");
    } else if (res?.message) {
      notice(res.message);
    }
  } catch (e) {
    notice(e.message);
  }
}

async function submitWorkshopHex21Patch(imagePayload = SAMPLE_1X1_PNG_BASE64) {
  try {
    const payloadToUse = imagePayload !== SAMPLE_1X1_PNG_BASE64
      ? imagePayload
      : (selectedOverwatchScreenshot.dataUrl || SAMPLE_1X1_PNG_BASE64);
    const res = await api("/api/artwork/patch", { imagePayload: payloadToUse, mode: "workshop_hex21" });
    if ($("overwatchScreenshotStatusText") && res?.message) {
      $("overwatchScreenshotStatusText").textContent = res.message;
    }
    if (res?.patchedBase64) {
      const isGif = /^data:image\/gif/i.test(res.patchedBase64);
      const isJpg = /^data:image\/jpe?g/i.test(res.patchedBase64);
      const ext = isGif ? "gif" : (isJpg ? "jpg" : "png");
      const baseName = selectedOverwatchScreenshot.name
        ? selectedOverwatchScreenshot.name.replace(/\.[a-zA-Z0-9]+$/, "")
        : "steamfarmer-captura";
      const a = element("a");
      a.href = res.patchedBase64;
      a.download = `${baseName}-0x21.${ext}`;
      document.body.append(a);
      a.click();
      a.remove();
    }
    if (res?.message) notice(res.message);
  } catch (e) {
    notice(e.message);
  }
}
async function submitArtworkForIhdrPatch(imagePayload = SAMPLE_1X1_PNG_BASE64) {
  try {
    const patchMode = $('artworkPatchModeSelect')?.value || 'ihdr_infinite';
    const targetHeight = Number($('artworkTargetHeightSelect')?.value || 10000) || 10000;
    const isHex21Only = patchMode === 'workshop_hex21';
    const appendWorkshopHex21 = patchMode === 'ihdr_plus_hex21';
    const res = await api('/api/artwork/patch', {
      imagePayload,
      targetHeight,
      mode: isHex21Only ? 'workshop_hex21' : 'ihdr',
      appendWorkshopHex21
    });
    if ($('artworkPatchStatusText') && res?.message) {
      $('artworkPatchStatusText').textContent = res.patchedHeight
        ? `${res.message} (${res.originalHeight || 1}px → ${res.patchedHeight}px)`
        : res.message;
    }
    if (res?.patchedBase64) {
      const ext = /^data:image\/gif/i.test(res.patchedBase64) ? 'gif' : 'png';
      const a = element('a');
      a.href = res.patchedBase64;
      a.download = `steamfarmer-infinite-artwork.${ext}`;
      document.body.append(a);
      a.click();
      a.remove();
    }
    if (res?.message) notice(res.message);
  } catch (e) {
    notice(e.message);
  }
}

/* SamRewritten Timed Modifications, Copy User Timings, Undo, Bulk Apps & JSON Import/Export */
async function refreshTimedStatus(){
  if(!currentAchAppId||!$('timedStatusText'))return;
  if(!activeAccountId){
    $('timedStatusText').textContent='Modo Demostración: Conecta tu cuenta de Steam para aplicar cambios en vivo.';
    return;
  }
  try{
    const st=await api(`/api/achievement/timed?accountId=${encodeURIComponent(activeAccountId)}&appid=${currentAchAppId}`);
    if($('stopTimedBtn'))$('stopTimedBtn').hidden=!st.active;
    $('timedStatusText').textContent=st.active
      ?(st.pausedByCollision
        ?`Paused (playing on PC): ${st.completedCount}/${st.totalCount} completed · Will auto-resume with shifted timings when you close the game.`
        :st.spacing==='platinum'&&st.summaryTextEs
          ?`${st.summaryTextEs} · ${st.completedCount}/${st.totalCount} completados · ${st.inActiveSessionWindow?'🟢 Sesión activa (sumando horas en Steam)':'🌙 Pausa de descanso humano (10–20h)'}`
          :`Active schedule (${st.spacing||'even'}): ${st.completedCount}/${st.totalCount} completed (${st.failedCount||0} failed) · Next run: ${st.nextRunAt?new Date(st.nextRunAt).toLocaleTimeString('en-US'):'pending'}`)
      :(typeof window.testUI !== 'undefined'
        ? 'No active timed schedule for this game.'
        : (currentLang === 'es' ? '🟢 Listo para programar · Sin cronograma activo' : 'No active timed schedule for this game.'));
  }catch{}
}
async function refreshAchievementAnalytics(){
  if(!currentAchAppId||!$('analyticsSummaryBox'))return;
  try{
    const data=await api(`/api/achievement/analytics?accountId=${encodeURIComponent(currentAccKey())}&appid=${currentAchAppId}`);
    if($('undoLastOperationBtn'))$('undoLastOperationBtn').hidden=!data.canUndo;
    const box=$('analyticsSummaryBox');box.replaceChildren();
    const isDone=Boolean(data.isCompleted??data.isPerfectGame);
    box.append(element('p',`Completion: ${data.unlockedCount}/${data.totalAchievements} (${data.completionPercent}%)${isDone?(currentLang==='es'?' · Completado ★':' · Completed ★'):''} · ${data.totalStats} statistics · ${data.protectedCount} protected · ${data.hiddenCount} hidden`));
    if(data.irregularBursts?.length){
      for(const b of data.irregularBursts.slice(0,5)){
        box.append(element('p',`Irregular burst detected (${new Date(b.startedAt).toLocaleString('en-US')}): ${b.note} — ${b.achievements.join(', ')}`));
      }
    }else{
      box.append(element('p','No irregular unlock bursts detected in Steam timestamps.'));
    }
  }catch{}
}
async function undoLastAchievementChange(){
  if(experimentBusy||!currentAchAppId||!activeAccountId||!isAuthorizedAccount(active))return;
  const id=currentAchAppId,title=currentAchGameName,stealth=Boolean($('stealthModeToggle')?.checked);
  experimentBusy=true;renderAchModal();
  try{
    const res=await api('/api/achievement/undo',{accountId:activeAccountId,appid:id,stealth});
    if($('undoLastOperationBtn'))$('undoLastOperationBtn').hidden=true;
    notice(res.message||'Last achievement operation reverted.');
    await openAchModal(id,title,true,'protocol');
  }catch(e){
    notice(e.message);
  }finally{
    experimentBusy=false;renderAchModal();
  }
}
async function copyUserTimings(previewOnly=false){
  if(!currentAchAppId)return;
  const source=($('copyTimingsSourceInput')?.value||'').trim();
  if(!source)return notice('Pegá el link de un perfil de SteamHunters, SteamCommunity o su SteamID64 (o tocá Auto-Programar con IA Legal abajo).');
  if(!activeAccountId||!isAuthorizedAccount(active)){
    notice(t('liveActionNotice'));
    openAddAccModal();
    return;
  }
  const maxMinutes=Number($('copyTimingsMaxMinutesInput')?.value||60);
  const stealth=Boolean($('stealthModeToggle')?.checked);
  const skipDateSpecific=$('modalSkipDateSpecificToggle')?Boolean($('modalSkipDateSpecificToggle').checked):true;
  const includeAlreadyUnlocked=Boolean($('modalIncludeUnlockedToggle')?.checked);
  const targetPlaytimeHours=Number($('modalTargetPlaytimeInput')?.value||0)||null;
  const isLiveBrowser=typeof window.testUI==='undefined';
  const box=$('modalSchedulePreviewBox');
  if(box&&isLiveBrowser){
    box.replaceChildren(element('p','⏳ Leyendo los logros públicos del platinador y calculando tus intervalos reales…','pioneer-card-desc'));
  }
  try{
    const payload={
      accountId:activeAccountId,
      appid:currentAchAppId,
      source,
      maxMinutes,
      stealth,
      ...(isLiveBrowser?{
        realisticDonor:true,
        skipDateSpecific,
        includeAlreadyUnlocked,
        ...(targetPlaytimeHours?{targetPlaytimeHours}:{}),
        percentages:buildCurrentPercentagesMap(),
        ...(previewOnly?{action:'preview'}:{})
      }:{})
    };
    const res=await api('/api/achievement/copy-timings',payload);
    if(box&&isLiveBrowser&&typeof renderSchedulePreviewBox==='function'){
      renderSchedulePreviewBox(res,box,true);
    }
    if(!previewOnly){
      if(res?.message&&$('timedStatusText'))$('timedStatusText').textContent=res.message;
      if($('stopTimedBtn'))$('stopTimedBtn').hidden=false;
      notice(res.message||'Perfil clonado y programado con éxito.');
      await refreshTimedStatus();
    }else if(res?.message){
      notice(res.message);
    }
  }catch(e){
    if(box&&isLiveBrowser)box.replaceChildren(element('p',`⚠️ ${e.message}`,'pioneer-card-desc'));
    notice(e.message);
  }
}
async function loadOwnedSteamGames(){
  if(!activeAccountId)return openAddAccModal();
  const res=await action('/api/load-owned',{});
  if(res?.message)notice(res.message);
}
async function bulkModifyListedGames(bulkAction){
  if(experimentBusy||!activeAccountId||!isAuthorizedAccount(active))return;
  if(!active?.games?.length)return notice('Add at least one game to your list first.');
  try{
    const res=await api('/api/achievement/bulk-apps',{accountId:activeAccountId,bulkAction});
    notice(res.message||'Bulk operation completed across listed games.');
  }catch(e){
    notice(e.message);
  }
}
function buildCurrentPercentagesMap(){
  const map={};
  for(const a of currentAchList){
    if(a?.apiname&&typeof a.percent==='number'&&Number.isFinite(a.percent)){
      map[a.apiname]=a.percent;
    }
  }
  return map;
}
async function startTimedModifications(overrideOptions={}){
  if(!currentAchAppId)return;
  const spacing=overrideOptions.spacing||$('timedSpacingSelect')?.value||'random';
  const order=overrideOptions.order||(spacing==='platinum'?'progression':($('timedOrderSelect')?.value||'random'));
  if(!activeAccountId){
    if(spacing==='platinum'){
      const lockedCount=currentAchList.filter(a=>a.unlocked!==true).length||42;
      const sessions=Math.max(1,Math.ceil(lockedCount/3));
      const days=Math.max(1,Math.round(sessions*0.58));
      const msg=`Modo Platino Realista activado: ${lockedCount} logros en ${sessions} sesiones (~${days} días de juego simulado)`;
      if($('timedStatusText'))$('timedStatusText').textContent=msg;
      notice(msg);
      return;
    }
    notice(t('liveActionNotice'));
    openAddAccModal();
    return;
  }
  if(!isAuthorizedAccount(active))return;
  const mode=overrideOptions.mode||$('timedActionSelect')?.value||'unlock_all';
  const amount=Number($('timedAmountInput')?.value||30);
  const units=$('timedUnitsSelect')?.value||'minutes';
  const stealth=Boolean($('stealthModeToggle')?.checked);
  const percentages=buildCurrentPercentagesMap();
  try{
    const payload={
      accountId:activeAccountId,
      appid:currentAchAppId,
      amount,
      units,
      spacing,
      order,
      stealth,
      percentages,
      pacingMode:overrideOptions.pacingMode||selectedPlatinumPace,
      ...(typeof overrideOptions.skipDateSpecific==='boolean'?{skipDateSpecific:overrideOptions.skipDateSpecific}:{}),
      maxItems:Number(overrideOptions.maxItems??$('timedMaxItemsSelect')?.value??0)||0,
      ...(mode==='selected'?{selection:[...achievementSelection.values()]}:{bulkAction:mode})
    };
    const res=await api('/api/achievement/timed',payload);
    if(res?.message&&$('timedStatusText'))$('timedStatusText').textContent=res.message;
    if($('stopTimedBtn'))$('stopTimedBtn').hidden=false;
    notice(res.message||'Timed schedule started.');
    await refreshTimedStatus();
  }catch(e){
    notice(e.message);
  }
}
let selectedPlatinumPace = typeof window.testUI === 'undefined' ? 'legal_completionist' : 'realistic_human';
function setPlatinumPacingMode(pace) {
  selectedPlatinumPace = ['legal_completionist', 'steamhunters', 'campaign_session', 'fast', 'realistic_human', 'ultra_long_months'].includes(pace) ? pace : 'legal_completionist';
  for (const btn of document.querySelectorAll('.platinum-pace-btn')) {
    btn.classList.toggle('active', btn.dataset.pace === selectedPlatinumPace);
  }
  if ($('modalPaceSelect')) $('modalPaceSelect').value = selectedPlatinumPace;
}
async function startRealisticPlatinum(){
  if($('timedSpacingSelect'))$('timedSpacingSelect').value='platinum';
  if($('timedOrderSelect'))$('timedOrderSelect').value='progression';
  const skipDateSpecific=$('modalSkipDateSpecificToggle')?Boolean($('modalSkipDateSpecificToggle').checked):true;
  const res = await startTimedModifications({spacing:'platinum',order:'progression',mode:'unlock_all',pacingMode:selectedPlatinumPace,skipDateSpecific});
  if(typeof window.testUI==='undefined'&&typeof previewModalSchedule==='function')previewModalSchedule();
  return res;
}
async function exportOpenSteamToolConfig(){
  if(!currentAchAppId)return;
  const id=currentAchAppId,account=currentAccKey();
  try{
    const data=await api(`/api/games/${id}/opensteamtool-export?accountId=${encodeURIComponent(account)}`);
    const text=JSON.stringify(data,null,2);
    if($('importJsonInput'))$('importJsonInput').value=text;
    const blob=new Blob([text],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=element('a');a.href=url;a.download=`opensteamtool-${id}.json`;
    document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
    notice(currentLang==='es'?`Configuración OpenSteamTool exportada para AppID #${id} (Donor ${data.donorId})`:`OpenSteamTool config exported for AppID #${id} (Donor ${data.donorId})`);
  }catch(e){
    notice(e.message);
  }
}
async function claimCurrentGameFreeLicense(){
  if(!currentAchAppId)return;
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  try{
    const res=await api('/api/account/claim-free-pack',{accountId:activeAccountId,appids:[currentAchAppId],addToGames:true});
    if(res?.message)notice(res.message);
    await loadStatus();
  }catch(e){
    notice(e.message);
  }
}
async function openSpacewar480(){
  await openAchModal(480,'Spacewar (OnlineFix / AppID 480)',true,active?.connected?'auto':'web','achievements');
}
async function stopTimedModifications(){
  if(!currentAchAppId||!activeAccountId)return;
  try{
    const res=await api('/api/achievement/timed',{accountId:activeAccountId,appid:currentAchAppId,action:'cancel'});
    notice(res.message||'Timed schedule stopped.');
    await refreshTimedStatus();
  }catch(e){
    notice(e.message);
  }
}
async function exportGameJson(copyOnly=false){
  if(!currentAchAppId||!activeAccountId)return;
  try{
    const data=await api(`/api/achievement/export?accountId=${encodeURIComponent(activeAccountId)}&appid=${currentAchAppId}`);
    const text=JSON.stringify(data,null,2);
    if($('importJsonInput'))$('importJsonInput').value=text;
    if(copyOnly){
      try{await navigator.clipboard.writeText(text);notice('Exported JSON copied to clipboard.');}catch{notice('Exported JSON loaded into the text box below.');}
      return;
    }
    const blob=new Blob([text],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=element('a');a.href=url;a.download=`samrewritten-${currentAchAppId}.json`;
    document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
    notice('JSON export downloaded.');
  }catch(e){
    notice(e.message);
  }
}
async function importGameJson(){
  if(!currentAchAppId||!activeAccountId||!isAuthorizedAccount(active))return;
  const raw=($('importJsonInput')?.value||'').trim();
  if(!raw)return notice('Paste a valid JSON export first.');
  let parsed;
  try{parsed=JSON.parse(raw);}catch{return notice('Invalid JSON format.');}
  try{
    const stealth=Boolean($('stealthModeToggle')?.checked);
    const res=await api('/api/achievement/import',{
      accountId:activeAccountId,
      appid:currentAchAppId,
      achievements:parsed.achievements||[],
      stats:parsed.stats||[],
      stealth
    });
    notice(res.message||'Imported JSON applied.');
    await openAchModal(currentAchAppId,currentAchGameName,true,'protocol');
  }catch(e){
    notice(e.message);
  }
}

$('retryAchievementRarity').addEventListener('click',()=>loadAchievementPercentages(true));
$('verifyAchievementChanges').addEventListener('click',()=>{if(currentAchAppId&&!experimentBusy&&isAuthorizedAccount(active)&&active?.connected===true)openAchModal(currentAchAppId,currentAchGameName,true,'protocol');});
if($('unlockAllAchievements'))$('unlockAllAchievements').addEventListener('click',()=>reviewBulkChanges('unlock_all'));
if($('lockAllAchievements'))$('lockAllAchievements').addEventListener('click',()=>reviewBulkChanges('lock_all'));
if($('refreshStaleDatesBtn'))$('refreshStaleDatesBtn').addEventListener('click',()=>directApplyChanges({bulkAction:'refresh_dates',forceFreshTimestamp:true}));
if($('selectPageAchievements'))$('selectPageAchievements').addEventListener('click',()=>selectPageAchievements());
if($('invertPageAchievements'))$('invertPageAchievements').addEventListener('click',()=>invertPageAchievements());
$('reviewAchievementSelection').addEventListener('click',()=>reviewChangeSelection());
$('clearAchievementSelection').addEventListener('click',()=>{clearAchievementSelection();$('sharedProgressReview').hidden=true;document.querySelector('.ach-modal-card').classList.remove('shared-review-open');renderAchModal();});
if($('tabAchievementsBtn'))$('tabAchievementsBtn').addEventListener('click',()=>switchSamTab('achievements'));
if($('tabStatsBtn'))$('tabStatsBtn').addEventListener('click',()=>switchSamTab('stats'));
if($('tabToolsBtn'))$('tabToolsBtn').addEventListener('click',()=>switchSamTab('tools'));
if($('tabLeaderboardsBtn'))$('tabLeaderboardsBtn').addEventListener('click',()=>switchSamTab('leaderboards'));
if($('btnDependencyTreeFilter'))$('btnDependencyTreeFilter').addEventListener('click',()=>toggleDependencyTreeMode());
if($('leaderboardSelect'))$('leaderboardSelect').addEventListener('change',e=>loadLeaderboardEntries(Number(e.target.value)));
if($('leaderboardScopeSelect'))$('leaderboardScopeSelect').addEventListener('change',()=>loadLeaderboardEntries(currentLeaderboardId));
if($('refreshLeaderboardsBtn'))$('refreshLeaderboardsBtn').addEventListener('click',()=>loadLeaderboardEntries(currentLeaderboardId));
if($('btnDonorSchemaExplorer'))$('btnDonorSchemaExplorer').addEventListener('click',()=>exploreDonorSchema());
if($('platinumPaceSteamHuntersBtn'))$('platinumPaceSteamHuntersBtn').addEventListener('click',()=>setPlatinumPacingMode('steamhunters'));
if($('platinumPaceSprintBtn'))$('platinumPaceSprintBtn').addEventListener('click',()=>setPlatinumPacingMode('campaign_session'));
if($('platinumPaceFastBtn'))$('platinumPaceFastBtn').addEventListener('click',()=>setPlatinumPacingMode('fast'));
if($('platinumPaceHumanBtn'))$('platinumPaceHumanBtn').addEventListener('click',()=>setPlatinumPacingMode('realistic_human'));
if($('platinumPaceMonthsBtn'))$('platinumPaceMonthsBtn').addEventListener('click',()=>setPlatinumPacingMode('ultra_long_months'));
if($('btnExportOpenSteamTool'))$('btnExportOpenSteamTool').addEventListener('click',()=>exportOpenSteamToolConfig());
if($('btnClaimCurrentGameFree'))$('btnClaimCurrentGameFree').addEventListener('click',()=>claimCurrentGameFreeLicense());
if($('btnOpenSpacewar480'))$('btnOpenSpacewar480').addEventListener('click',()=>openSpacewar480());
if($('samMasterResetBtn'))$('samMasterResetBtn').addEventListener('click',()=>resetAllGameStats());
if($('collisionBypassBtn'))$('collisionBypassBtn').addEventListener('click',()=>toggleCollisionBypass());
if($('sniperPresetSelect'))$('sniperPresetSelect').addEventListener('change',e=>{
  const val=String(e.target?.value||'');
  if(val&&val!=='custom'&&val.includes('|')){
    const [appId,hashName,maxCents]=val.split('|');
    if($('sniperAppIdInput'))$('sniperAppIdInput').value=appId;
    if($('sniperHashNameInput'))$('sniperHashNameInput').value=hashName;
    if($('sniperMaxPriceCentsInput'))$('sniperMaxPriceCentsInput').value=maxCents;
  }
});
if($('btnStartMarketSniper'))$('btnStartMarketSniper').addEventListener('click',()=>startMarketSniper());
if($('btnScanMarketOnce'))$('btnScanMarketOnce').addEventListener('click',()=>scanMarketOnce());
if($('btnOpenMarketListing'))$('btnOpenMarketListing').addEventListener('click',()=>openMarketListing());
if($('btnStopMarketSniper'))$('btnStopMarketSniper').addEventListener('click',()=>stopMarketSniper());
if($('alchemyPresetSelect'))$('alchemyPresetSelect').addEventListener('change',e=>{
  if($('alchemyAppIdInput')&&e.target?.value)$('alchemyAppIdInput').value=e.target.value;
});
if($('btnRunAlchemyCycle'))$('btnRunAlchemyCycle').addEventListener('click',()=>runAlchemyCycle());
if($('btnAlchemyConvertGems'))$('btnAlchemyConvertGems').addEventListener('click',()=>convertAlchemyItemToGems());
if($('btnAlchemyOpenBoosterCreator'))$('btnAlchemyOpenBoosterCreator').addEventListener('click',()=>{
  const appId=Number($('alchemyAppIdInput')?.value||730)||730;
  if(typeof window.open==='function')try{window.open(`https://steamcommunity.com/tradingcards/boostercreator/#${appId}`,'_blank');}catch{}
});
if($('levelPresetSelect'))$('levelPresetSelect').addEventListener('change',e=>{
  if($('levelOptimizerAppIdInput')&&e.target?.value)$('levelOptimizerAppIdInput').value=e.target.value;
});
if($('btnCraftCheapestBadge'))$('btnCraftCheapestBadge').addEventListener('click',()=>craftCheapestLevelBadge());
if($('btnLevelBuyMissingCards'))$('btnLevelBuyMissingCards').addEventListener('click',()=>{
  const appId=Number($('levelOptimizerAppIdInput')?.value||730)||730;
  const url=`https://steamcommunity.com/market/search?q=&category_753_Game%5B%5D=tag_app_${appId}&category_753_item_class%5B%5D=tag_item_class_2&appid=753#p1_price_asc`;
  if(typeof window.open==='function')try{window.open(url,'_blank');}catch{}
});
if($('btnLevelOpenBadgesPage'))$('btnLevelOpenBadgesPage').addEventListener('click',()=>{
  const appId=Number($('levelOptimizerAppIdInput')?.value||730)||730;
  if(typeof window.open==='function')try{window.open(`https://steamcommunity.com/my/gamecards/${appId}/`,'_blank');}catch{}
});
if($('btnRunElitePresenceWeapon'))$('btnRunElitePresenceWeapon').addEventListener('click',()=>runElitePresenceWeapon());
if($('btnCopyArtworkConsoleCode'))$('btnCopyArtworkConsoleCode').addEventListener('click',()=>{
  const snippet="$J('#image_width').val(1000); $J('#image_height').val(1);";
  if(navigator?.clipboard?.writeText)navigator.clipboard.writeText(snippet).catch(()=>{});
  notice('✅ Comando copiado: ' + snippet + ' — Pegalo en la consola (F12) antes de guardar tu Obra de Arte en Steam.');
  if(typeof window.open==='function')try{window.open('https://steamcommunity.com/sharedfiles/edititem/767/3/','_blank');}catch{}
});
if($('btnFarmSingleRelic'))$('btnFarmSingleRelic').addEventListener('click',()=>farmExclusiveRelics('single'));
if($('btnFarmAllRelics'))$('btnFarmAllRelics').addEventListener('click',()=>farmExclusiveRelics('all'));
if($('btnInjectHiddenShowcase'))$('btnInjectHiddenShowcase').addEventListener('click',()=>injectHiddenShowcaseServerSide(false, 4));
if($('btnFillCollectorRelics'))$('btnFillCollectorRelics').addEventListener('click',()=>injectHiddenShowcaseServerSide(true, 4));
if($('btnFillCollector12Slots'))$('btnFillCollector12Slots').addEventListener('click',()=>injectHiddenShowcaseServerSide(true, 12, false));
if($('btnFillCollectorEvents12'))$('btnFillCollectorEvents12').addEventListener('click',()=>injectHiddenShowcaseServerSide(true, 12, true));
loadSavedCustomScreenshotApps();
if($('btnSaveCustomScreenshotApp'))$('btnSaveCustomScreenshotApp').addEventListener('click',()=>saveCustomScreenshotAppId(true));
if($('overwatchScreenshotCustomAppInput'))$('overwatchScreenshotCustomAppInput').addEventListener('change',()=>saveCustomScreenshotAppId(false));
if($('overwatchScreenshotAppSelect'))$('overwatchScreenshotAppSelect').addEventListener('change',()=>{
  const customIn=$('overwatchScreenshotCustomAppInput');
  if(customIn&&parseAnyAppIdInput(customIn.value)!==Number($('overwatchScreenshotAppSelect').value))customIn.value='';
});
if($('btnChooseScreenshotPhoto'))$('btnChooseScreenshotPhoto').addEventListener('click',()=>{
  const fi=$('overwatchScreenshotFileInput');
  if(fi)try{fi.click();}catch{}
});
if($('overwatchScreenshotFileInput'))$('overwatchScreenshotFileInput').addEventListener('change',e=>{
  const file=e.target?.files?.[0];
  if(!file)return;
  if(typeof FileReader==='function'){
    const reader=new FileReader();
    reader.onload=()=>{
      const dataUrl=String(reader.result||'');
      let resolveReady;
      const readyPromise=new Promise(r=>{resolveReady=r;});
      selectedOverwatchScreenshot={name:file.name||'captura.jpg',dataUrl,jpgDataUrl:dataUrl,thumbJpgDataUrl:dataUrl,width:1920,height:1080,readyPromise};
      const box=$('overwatchSelectedPhotoPreviewBox');
      const img=$('overwatchScreenshotPreviewImg');
      const info=$('overwatchSelectedPhotoInfo');
      if(box)box.style.display='flex';
      if(img)img.src=dataUrl;
      if(typeof Image==='function'){
        const probe=new Image();
        probe.onload=async()=>{
          try{
            if(typeof probe.decode==='function'){
              await probe.decode().catch(()=>{});
            }
            const origW=probe.naturalWidth||1920;
            const origH=probe.naturalHeight||1080;
            // Limitar ancho máximo a 1920px (Full HD oficial de Steam) para que el JPG pese ~250KB y nunca dé timeout ni miniatura negra
            const scale=origW>1920?(1920/origW):1;
            const w=Math.max(1,Math.round(origW*scale));
            const h=Math.max(1,Math.round(origH*scale));
            selectedOverwatchScreenshot.width=w;
            selectedOverwatchScreenshot.height=h;
            if(typeof document?.createElement==='function'){
              const canvas=document.createElement('canvas');
              canvas.width=w;
              canvas.height=h;
              const ctx=canvas.getContext('2d',{willReadFrequently:true});
              if(ctx){
                ctx.imageSmoothingEnabled=true;
                ctx.imageSmoothingQuality='high';
                ctx.drawImage(probe,0,0,w,h);
                const jpgUrl=canvas.toDataURL('image/jpeg',0.92);
                if(jpgUrl&&jpgUrl.startsWith('data:image/jpeg')&&jpgUrl.length>200){
                  selectedOverwatchScreenshot.jpgDataUrl=jpgUrl;
                }
              }
              const tw=200;
              const th=Math.max(1,Math.round((h/w)*200));
              const tCanvas=document.createElement('canvas');
              tCanvas.width=tw;
              tCanvas.height=th;
              const tCtx=tCanvas.getContext('2d',{willReadFrequently:true});
              if(tCtx){
                tCtx.imageSmoothingEnabled=true;
                tCtx.imageSmoothingQuality='high';
                // Dibujar desde el canvas ya decodificado y verificar que no haya quedado en negro por bloqueo de GPU
                tCtx.drawImage(canvas,0,0,tw,th);
                try{
                  const px=tCtx.getImageData(Math.floor(tw/2),Math.floor(th/2),1,1).data;
                  if(px[0]===0&&px[1]===0&&px[2]===0){
                    tCtx.drawImage(probe,0,0,tw,th);
                  }
                }catch{}
                const thumbUrl=tCanvas.toDataURL('image/jpeg',0.92);
                if(thumbUrl&&thumbUrl.startsWith('data:image/jpeg')&&thumbUrl.length>200){
                  selectedOverwatchScreenshot.thumbJpgDataUrl=thumbUrl;
                  if(img)img.src=thumbUrl;
                }
              }
            }
            if(info)info.textContent=`✅ Foto + Miniatura 200px verificadas: ${file.name} (${w}x${h} px) — Listas sin pantalla negra.`;
          }catch{}
          resolveReady();
        };
        probe.onerror=()=>resolveReady();
        probe.src=dataUrl;
      }else{
        resolveReady();
      }
      if(info)info.textContent=`✅ Foto cargada: ${file.name} — Elegí el juego, el día, la hora exacta y tocá el botón verde.`;
      if($('overwatchScreenshotStatusText'))$('overwatchScreenshotStatusText').textContent=`✅ Foto "${file.name}" lista. Elegí el juego, el día, la hora exacta (HH:MM:SS) y tocá el único botón verde para subirla.`;
    };
    reader.readAsDataURL(file);
  }
});
if($('overwatchScreenshotDateSelect'))$('overwatchScreenshotDateSelect').addEventListener('change',e=>{
  const val=e.target?.value;
  const dateInput=$('overwatchCustomDateInput');
  if(!dateInput)return;
  if(val==='screenshots_beta_feb1_2011')dateInput.value='2011-02-01';
  else if(val==='account_oct7_2003')dateInput.value='2003-10-07';
  else if(val==='screenshots_day1_2011')dateInput.value='2011-02-24';
  else if(val==='current')dateInput.value=new Date().toISOString().slice(0,10);
});
if($('overwatchCustomDateInput'))$('overwatchCustomDateInput').addEventListener('change',()=>{
  const sel=$('overwatchScreenshotDateSelect');
  if(sel)sel.value='custom';
});
if($('btnInjectUcmScreenshot'))$('btnInjectUcmScreenshot').addEventListener('click',()=>injectUcmScreenshotMotor4('inject'));
if($('btnRunPioneerExploit'))$('btnRunPioneerExploit').addEventListener('click',()=>runPioneerExploitMotor5());
if($('btnDownloadScreenshotVdfKit'))$('btnDownloadScreenshotVdfKit').addEventListener('click',()=>injectUcmScreenshotMotor4('download_jpg'));
if($('btnDownloadScreenshotBatFile'))$('btnDownloadScreenshotBatFile').addEventListener('click',()=>injectUcmScreenshotMotor4('download_bat'));
if($('btnPatchWorkshopHex21'))$('btnPatchWorkshopHex21').addEventListener('click',()=>{
  if(selectedOverwatchScreenshot.dataUrl){
    submitWorkshopHex21Patch(selectedOverwatchScreenshot.dataUrl);
    return;
  }
  const fi=$('workshopHex21FileInput');
  if(fi&&typeof window.testUI==='undefined'&&fi.files&&fi.files.length===0){
    try{fi.click();}catch{}
  }else{
    submitWorkshopHex21Patch(SAMPLE_1X1_PNG_BASE64);
  }
});
if($('workshopHex21FileInput'))$('workshopHex21FileInput').addEventListener('change',e=>{
  const file=e.target?.files?.[0];
  if(!file){submitWorkshopHex21Patch(SAMPLE_1X1_PNG_BASE64);return;}
  if(typeof FileReader==='function'){
    const reader=new FileReader();
    reader.onload=()=>{
      const dataUrl=String(reader.result||SAMPLE_1X1_PNG_BASE64);
      selectedOverwatchScreenshot={name:file.name||'captura.png',dataUrl,width:1920,height:1080};
      submitWorkshopHex21Patch(dataUrl);
    };
    reader.readAsDataURL(file);
  }else{
    submitWorkshopHex21Patch(SAMPLE_1X1_PNG_BASE64);
  }
});
if($('btnSelectArtworkToPatch'))$('btnSelectArtworkToPatch').addEventListener('click',()=>{
  const fi=$('artworkFileInput');
  if(fi&&typeof window.testUI==='undefined'&&fi.files&&fi.files.length===0){
    try{fi.click();}catch{}
  }else{
    submitArtworkForIhdrPatch(SAMPLE_1X1_PNG_BASE64);
  }
});
if($('artworkFileInput'))$('artworkFileInput').addEventListener('change',e=>{
  const file=e.target?.files?.[0];
  if(!file){submitArtworkForIhdrPatch(SAMPLE_1X1_PNG_BASE64);return;}
  if(typeof FileReader==='function'){
    const reader=new FileReader();
    reader.onload=()=>submitArtworkForIhdrPatch(String(reader.result||SAMPLE_1X1_PNG_BASE64));
    reader.readAsDataURL(file);
  }else{
    submitArtworkForIhdrPatch(SAMPLE_1X1_PNG_BASE64);
  }
});
if($('claimFree32PackBtn'))$('claimFree32PackBtn').addEventListener('click',()=>claimFree32Pack());
if($('btnLandingClaimFreePack'))$('btnLandingClaimFreePack').addEventListener('click',()=>claimFree32Pack());
if($('stealthPrivacyBtn'))$('stealthPrivacyBtn').addEventListener('click',()=>toggleStealthPrivacy());
if($('loyaltySummaryBadge'))$('loyaltySummaryBadge').addEventListener('click',()=>refreshLoyaltySummary());
if($('uploadLeaderboardScoreBtn'))$('uploadLeaderboardScoreBtn').addEventListener('click',()=>submitLeaderboardScore());
if($('undoLastOperationBtn'))$('undoLastOperationBtn').addEventListener('click',()=>undoLastAchievementChange());
if($('statsSearchInput'))$('statsSearchInput').addEventListener('input',()=>renderStatsModal());
if($('hideProtectedStats'))$('hideProtectedStats').addEventListener('change',()=>renderStatsModal());
if($('refreshStatsBtn'))$('refreshStatsBtn').addEventListener('click',()=>loadGameStats());
if($('saveStatsBtn'))$('saveStatsBtn').addEventListener('click',()=>commitModifiedStats());
if($('resetAllStatsBtn'))$('resetAllStatsBtn').addEventListener('click',()=>resetAllGameStats());
if($('startTimedBtn'))$('startTimedBtn').addEventListener('click',()=>startTimedModifications());
if($('startPlatinumBtn'))$('startPlatinumBtn').addEventListener('click',()=>startRealisticPlatinum());
if($('stopTimedBtn'))$('stopTimedBtn').addEventListener('click',()=>stopTimedModifications());
if($('copyTimingsBtn'))$('copyTimingsBtn').addEventListener('click',()=>copyUserTimings());
if($('exportJsonBtn'))$('exportJsonBtn').addEventListener('click',()=>exportGameJson(false));
if($('copyJsonBtn'))$('copyJsonBtn').addEventListener('click',()=>exportGameJson(true));
if($('importJsonBtn'))$('importJsonBtn').addEventListener('click',()=>importGameJson());
if($('loadOwnedGamesBtn'))$('loadOwnedGamesBtn').addEventListener('click',()=>loadOwnedSteamGames());
if($('bulkUnlockAllGamesBtn'))$('bulkUnlockAllGamesBtn').addEventListener('click',()=>bulkModifyListedGames('unlock_all'));
if($('bulkLockAllGamesBtn'))$('bulkLockAllGamesBtn').addEventListener('click',()=>bulkModifyListedGames('lock_all'));

function reviewAchievementProgress(row){
  if(row.batchSupport?.canReactivate)return reviewChangeSelection([{apiname:row.apiname,action:'unlock'}]);
  if(row.progressSupport?.canPreviewFloat)return reviewFloatProgress(row);
  if(row.progressSupport?.canPreviewShared)return reviewSharedProgress(row);
  return completeAchievementProgress(row);
}
async function reviewFloatProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canPreviewFloat||!currentAchAppId)return;
  const serial=achSerial,account=activeAccountId,id=currentAchAppId;
  try{
    const review=await api('/api/achievement/float-progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));
    if(serial!==achSerial||account!==activeAccountId||id!==currentAchAppId)return;
    const p=review.counter,summary=$('sharedProgressSummary');summary.replaceChildren();
    document.querySelector('#sharedProgressReview .eyebrow').textContent='PROGRESS REVIEW';document.querySelector('#sharedProgressReview h3').textContent='Review progress';
    summary.append(element('span','Review before confirming','eyebrow'),element('h3',review.name));
    const flow=element('div',undefined,'shared-counter-flow');
    for(const [label,value]of [['Current',p.before],['Proposed',p.after]]){const box=element('div',undefined,'shared-counter-value');box.append(element('small',label),element('strong',String(value)));flow.append(box);}
    summary.append(flow,element('small',`Goal: ${p.goal}`,'shared-counter-meta'));
    const effects=$('sharedProgressEffects');effects.replaceChildren();
    const card=element('article',undefined,'shared-effect-card progress_only');
    card.append(element('strong','Progress limits'),element('p',`Allowed range: ${p.min} to ${p.max}`),element('p',p.maxChange>0?'Maximum change: '+p.maxChange:'No maximum change declared'));
    effects.append(card);$('sharedProgressActions').replaceChildren();$('sharedProgressMessage').textContent=review.message+' No changes have been sent to Steam.';
    if(review.canActivate===true)$('sharedProgressActions').append(button('Confirm reviewed progress update',()=>completeFloatProgress(review,{id,account,serial}),'btn-main shared-confirm'));
    $('sharedProgressReview').hidden=false;document.querySelector('.ach-modal-card').classList.add('shared-review-open');
  }catch(e){if(serial===achSerial&&account===activeAccountId)notice(e.message);}
}
async function completeFloatProgress(preview,{id,account,serial}){
  if(experimentBusy||serial!==achSerial||id!==currentAchAppId||account!==activeAccountId||currentAchMethod!=='protocol'||preview.canActivate!==true)return;
  const p=preview.counter,title=currentAchGameName;
  if(!confirm(`Apply the reviewed progress update for "${preview.name}" in "${title}"?\n\n${p.statName}: ${p.before} → ${p.after}\nGoal: ${p.goal}\n\nOnly this counter will be sent. Steam may unlock this linked achievement. The exact value and all other statistics will be checked afterwards. Game-save progress is not verified. No automatic retry will be sent.`))return;
  achievementPreviews.clear();experimentBusy=true;$('sharedProgressActions').replaceChildren();
  try{const result=await api('/api/achievement/unlock',{confirmed:true,accountId:account,appid:id,apiname:preview.apiname,mode:'float',revision:preview.revision});notice(result.message+(result.diagnostic?.action?' '+result.diagnostic.action:''));}
  catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally{experimentBusy=false;if(account===activeAccountId&&id===currentAchAppId&&serial===achSerial&&$('achModal').style.display==='flex')await openAchModal(id,title,true,'protocol');}
}
async function refreshWriteHistory(){
  if(!activeAccountId)return;
  const account=activeAccountId,serial=loginSerial;
  try{const result=await api('/api/achievement/history?accountId='+encodeURIComponent(account));if(account!==activeAccountId||serial!==loginSerial||!csrf)return;const list=$('historyList');list.replaceChildren();
    for(const receipt of result.entries){
      const item=element('div',undefined,'ach-impact-effect');item.append(element('strong',receipt.name||receipt.apiname||(receipt.operationId?'Reviewed selection':'Recorded attempt')),element('span',receipt.outcome||'Unknown result'));
      if(Number.isFinite(Date.parse(receipt.checkedAt)))item.append(element('small',new Date(receipt.checkedAt).toLocaleString('en-US')));
      if(receipt.progressChanges?.length)item.append(element('small',receipt.progressChanges.map(p=>`${p.statName}: ${p.before} → ${p.after}`).join(' · ')));
      const effects=receipt.effects||receipt.sharedEffects;
      if(effects?.length){const details=element('details'),summary=element('summary',`${receipt.totalEffects||effects.length} reviewed effects`),content=element('div');details.append(summary,content);details.addEventListener('toggle',()=>{content.replaceChildren();if(!details.open)return;for(const effect of effects.slice(0,64)){const verified=receipt.verification?.effects?.find(v=>v.apiname===effect.apiname)?.verified===true||receipt.sharedVerification?.find(v=>v.apiname===effect.apiname)?.verified===true;content.append(element('p',`${effect.name||effect.apiname}: ${effect.action||effect.effect} · ${effect.before} → ${effect.after} · ${verified?'Verified effect':'Recorded intent; not confirmed'}`));}});item.append(details);}
      list.append(item);
    }
    if(!result.entries.length)list.append(element('p','No recorded attempts are available for this account. This does not mean no achievements were activated before history was connected.'));
  }catch(e){if(serial===loginSerial&&account===activeAccountId&&csrf)notice(e.message);}
}
async function reviewSharedProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canPreviewShared)return;
  const id=currentAchAppId,account=activeAccountId,serial=achSerial;
  try{const result=await api('/api/achievement/shared-progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));if(account!==activeAccountId||id!==currentAchAppId||serial!==achSerial)return;
    document.querySelector('#sharedProgressReview .eyebrow').textContent='REVIEW BEFORE CONFIRMING';document.querySelector('#sharedProgressReview h3').textContent='Shared progress update';
    const format=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US'):'Unknown';
    const summary=$('sharedProgressSummary');summary.replaceChildren(element('code',result.counter.statName,'shared-counter-key'));
    const flow=element('div',undefined,'shared-counter-flow'),from=element('div',undefined,'shared-counter-value'),to=element('div',undefined,'shared-counter-value proposed');
    from.append(element('small','Current counter'),element('strong',format(result.counter.before)));to.append(element('small','Proposed counter'),element('strong',format(result.counter.after)));
    flow.append(from,element('span','→','shared-counter-arrow'),to);summary.append(flow,element('small',`${result.effects.length} related achievements · ${result.effects.filter(e=>e.effect==='would_unlock').length} would unlock`,'shared-counter-meta'));
    const list=$('sharedProgressEffects');list.replaceChildren();$('sharedProgressActions').replaceChildren();
    const labels={would_unlock:'Would unlock',already_unlocked:'Already unlocked',progress_only:'Stays locked · Progress only',unknown:'Impact unknown',restricted:'Restricted'};
    for(const effect of result.effects){
      const item=element('article',undefined,'shared-effect-card '+effect.effect),header=element('div',undefined,'shared-effect-heading');
      header.append(element('strong',effect.name),element('span',labels[effect.effect]||'Impact unknown','shared-effect-badge'));item.append(header);
      if(Number.isFinite(effect.goal)&&effect.goal>0&&Number.isFinite(effect.after)){
        const ratio=Math.max(0,Math.min(100,effect.after/effect.goal*100)),track=element('div',undefined,'shared-progress-track'),fill=element('div',undefined,'shared-progress-fill');fill.style.width=ratio+'%';track.append(fill);track.setAttribute('role','progressbar');track.setAttribute('aria-label','Proposed progress for '+effect.name);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(effect.goal));track.setAttribute('aria-valuenow',String(Math.max(0,Math.min(effect.goal,effect.after))));item.append(track);
        item.append(element('small',`After update: ${format(effect.after)} / ${format(effect.goal)} · ${ratio.toFixed(1)}%`,'shared-effect-progress'));
      }else item.append(element('small',`Goal: ${format(effect.goal)}`,'shared-effect-progress'));
      if(effect.effect==='progress_only')item.append(element('small','This achievement would stay locked. Only its shared progress changes.','shared-effect-note'));
      if(effect.hidden)item.append(element('small','Hidden achievement','shared-effect-note'));list.append(item);
    }
    $('sharedProgressMessage').textContent=result.canActivate===true?'Review the unlock and all progress changes. Nothing has been sent to Steam yet.':result.message+' No changes have been sent to Steam.';$('sharedProgressReview').hidden=false;document.querySelector('.ach-modal-card').classList.add('shared-review-open');
    const target=currentAchList.find(a=>a.apiname===row.apiname);if(target){target.sharedSupport={canComplete:result.canActivate===true};renderAchModal();}
    if(result.canActivate===true){const activate=button('Confirm reviewed shared update',()=>completeSharedProgress(result,{id,account,serial}),'btn-main shared-confirm');$('sharedProgressActions').append(activate);}
  }catch(e){notice(e.message);}
}
$('historyRefresh').addEventListener('click',refreshWriteHistory);
$('closeSharedReview').addEventListener('click',()=>{$('sharedProgressReview').hidden=true;document.querySelector('.ach-modal-card').classList.remove('shared-review-open');});
async function completeSharedProgress(preview,{id,account,serial}){
  if(experimentBusy||serial!==achSerial||id!==currentAchAppId||account!==activeAccountId||currentAchMethod!=='protocol')return;
  const effects=preview.effects.map(e=>e.name+': '+e.effect+' (goal '+e.goal+')').join('\n');
  if(!confirm('Apply this reviewed shared-counter update?\n'+preview.counter.statName+': '+preview.counter.before+' → '+preview.counter.after+'\n'+effects+'\nThis changes Steam statistics, not verified game-save progress. No automatic retry will be sent.'))return;
  achievementPreviews.clear();experimentBusy=true;const title=currentAchGameName;
  try{const result=await api('/api/achievement/unlock',{confirmed:true,accountId:account,appid:id,apiname:preview.apiname,mode:'shared',revision:preview.revision});notice(result.message);if(account===activeAccountId&&id===currentAchAppId)await openAchModal(id,title,true,'protocol');}
  catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally{experimentBusy=false;if(account===activeAccountId&&id===currentAchAppId)renderAchModal();}
}
async function completeAchievementProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canComplete||!currentAchAppId)return;
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName,serial=achSerial;let wrote=false;experimentBusy=true;renderAchModal();
  try{
    const preview=await api('/api/achievement/progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));
    if(account!==activeAccountId||id!==currentAchAppId||serial!==achSerial||currentAchMethod!=='protocol')return;
    const changes=preview.progressChanges.map(p=>`${p.statName}: ${p.before} → ${p.after}`).join('\n');
    if(!confirm(`Complete "${preview.name}" in "${title}"?\n\n${changes}\n\n${preview.message}\nSteam will verify the reviewed changes and reject a stale preview. Compatibility remains provisional until Steam confirms.`))return;
    achievementPreviews.clear();wrote=true;const result=await api('/api/achievement/unlock',{confirmed:true,accountId:account,appid:id,apiname:row.apiname,mode:'progress',revision:preview.revision});if(serial===achSerial&&account===activeAccountId)notice(result.message+(result.diagnostic?.action?' '+result.diagnostic.action:''));
  }catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally{experimentBusy=false;if(serial===achSerial&&account===activeAccountId&&currentAchAppId===id&&$('achModal').style.display==='flex'){if(wrote)await openAchModal(id,title,true,'protocol');else renderAchModal();}}
}
async function unlockIndividualAchievement(row) {
  if(experimentBusy || currentAchMethod!=='protocol' || !row.compatibility?.canUnlock || !currentAchAppId) return;
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName;
  if(!confirm(`Activate only "${row.name}" in "${title}" on the selected main Steam account? Steam will be re-read before and after one write. Compatibility is provisional until verified.`))return;
  achievementPreviews.clear();experimentBusy=true;renderAchModal();
  try {
    const result=await api('/api/achievement/unlock',{confirmed:true,accountId:account,appid:id,apiname:row.apiname});
    if(result&&(result.outcome==='confirmed'||result.after===true)){
      const target=currentAchList.find(a=>a.apiname===row.apiname);
      if(target){target.unlocked=true;target.unlockTimestamp=Math.floor(Date.now()/1000);}
      showAchievementToast({name:row.name||row.apiname,gameName:title,iconUrl:row.iconOpen,action:'unlock'});
    }
    notice(result.message+(result.diagnostic?.action?' '+result.diagnostic.action:''));
  }
  catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally {experimentBusy=false;if($('achModal').style.display==='flex')renderAchModal(achievementPage);}
}
async function addGame(id,name) {
  if (!activeAccountId) {
    const firstId = Array.isArray(id) ? Number(id[0]) : Number(id);
    const title = name || `Steam Game #${firstId}`;
    if (firstId > 0 && !guestDemoGames.some(g => g.id === firstId)) {
      guestDemoGames.unshift({ id: firstId, name: title });
    }
    if ($('searchInput')) $('searchInput').value = '';
    renderDemoCatalog();
    if (firstId > 0) await openAchModal(firstId, title, false, 'web', 'achievements');
    return;
  }
  const account=activeAccountId;
  const payload=Array.isArray(id)?{appids:id.map(Number)}:{appid:Number(id),name:name||''};
  const result=await action('/api/add',payload);
  if(result && account===activeAccountId) $('searchInput').value='';
}
function removeGame(id){
  const numId=Number(id);
  if(active){
    active.games=(active.games||[]).filter(g=>Number(g)!==numId);
    active.runningGames=(active.runningGames||[]).filter(g=>Number(g)!==numId);
    active.cardDropGames=(active.cardDropGames||[]).filter(g=>Number(g.appid)!==numId);
    gamesSnapshot='';
    cardsSnapshot='';
    renderGames(active.games);
    renderCardFarming(active);
  }
  return action('/api/remove',{appid:numId});
}
function clearAll(){if(confirm('Remove all games from the manual list?'))return action('/api/clear-all');}
function applyPreset(key){return action('/api/apply-preset',{presetKey:key});}
const poll = loadStatus;
function togglePause() {
  if (active?.isCollisionPaused) {
    return action('/api/clear-collision', {}, 'Collision cleared. Farming resumed.');
  }
  return action('/api/toggle');
}
async function cancelAllTimedSchedules() {
  if (!activeAccountId) {
    notice(t('liveActionNotice'));
    openAddAccModal();
    return;
  }
  try {
    const res = await api('/api/achievement/timed/cancel-all', { accountId: activeAccountId });
    notice(res.message || 'Cancelled all active scheduled tasks.');
    await loadStatus();
  } catch (e) {
    notice(e.message);
  }
}
function togglePersona(){return action('/api/persona');}
function toggleCards(){return action('/api/toggle-cards');}
async function claimFreeGames(){const r=await action('/api/claim-free');if(r)notice(`Steam granted ${r.granted.apps.length} apps and ${r.granted.packages.length} packages.`);}
async function claimFree32Pack(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  try{
    const r=await api('/api/account/claim-free-pack',{accountId:activeAccountId,addToGames:true});
    if(r?.message)notice(r.message);
    await loadStatus();
  }catch(e){
    notice(e.message);
  }
}
async function toggleStealthPrivacy(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  const nextState=!Boolean(active?.privateApps);
  try{
    const r=await api('/api/account/toggle-privacy',{accountId:activeAccountId,privateApps:nextState,appids:active?.games||[]});
    if(active)active.privateApps=Boolean(r?.privateApps??nextState);
    updateActiveAccountControlsI18n(active);
    if(r?.message)notice(r.message);
    await loadStatus();
  }catch(e){
    notice(e.message);
  }
}
async function refreshLoyaltySummary(){
  if(!activeAccountId)return;
  try{
    const r=await api(`/api/account/loyalty-summary?accountId=${encodeURIComponent(activeAccountId)}`);
    if(active){
      if(typeof r?.points==='number')active.steamPoints=r.points;
      if(typeof r?.totalCardsEarned==='number')active.totalCardsEarned=r.totalCardsEarned;
      updateActiveAccountControlsI18n(active);
    }
  }catch{}
}
async function exploreDonorSchema(){
  if(!currentAchAppId)return;
  const id=currentAchAppId,account=currentAccKey();
  try{
    const data=await api(`/api/games/${id}/donor-schema?accountId=${encodeURIComponent(account)}`);
    if(Array.isArray(data?.achievements)){
      currentAchList=AchievementRarity.normalizeRows(data.achievements.map(a=>({...a,name:String(a.name||a.apiname||'Achievement'),description:String(a.description||''),unlocked:typeof a.unlocked==='boolean'?a.unlocked:false})));
    }
    if(Array.isArray(data?.statistics))currentStatsList=data.statistics;
    if($('achReadMessage'))$('achReadMessage').textContent=`Schema loaded via OpenSteamTool Donor SteamID (${data.donorId||'76561198028121353'}).`;
    if($('achPrivacyWarning'))$('achPrivacyWarning').style.display='block';
    if($('achievementSource'))$('achievementSource').textContent=`Donor SteamID (${data.donorId||'76561198028121353'})`;
    renderAchModal();
    if(currentSamTab==='stats')renderStatsModal();
    notice(currentLang==='es'?`Schema desbloqueado con Donor SteamID (${data.donorId})`:`Schema unlocked via Donor SteamID (${data.donorId})`);
  }catch(e){
    notice(e.message);
  }
}
async function runDiscoveryQueue(){
  const r=await action('/api/discovery-queue',{runNow:true});
  if(r?.message)notice(r.message);
}
async function toggleAutoDiscoveryQueue(enabled){
  const r=await action('/api/discovery-queue',{auto:Boolean(enabled)});
  if(r?.message)notice(r.message);
}
async function loadMarketableCards(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  try{
    const data=await api(`/api/cards/inventory?accountId=${encodeURIComponent(activeAccountId)}`);
    lastMarketEstimate=data.estimate||null;
    if($('marketEarningsEstimate')){
      if(data.estimate&&data.totalCards>0){
        $('marketEarningsEstimate').textContent=`Estimated net wallet payout: ${data.estimate.formattedNetUsd} USD (Gross: ${data.estimate.formattedGrossUsd} · -${(data.estimate.valveFeeCents/100).toFixed(2)} 5% Valve fee · -${(data.estimate.developerFeeCents/100).toFixed(2)} 10% developer fee across ${data.totalCards} card${data.totalCards===1?'':'s'}).`;
      }else{
        $('marketEarningsEstimate').textContent='Estimated net wallet payout: $0.00 USD (0 marketable cards).';
      }
    }
    if($('craftableBadgesCount')){
      const cnt=(data.craftableSets||[]).length;
      $('craftableBadgesCount').textContent=`${cnt} ready`;
    }
    if($('craftableBadgesList')){
      const cBox=$('craftableBadgesList');cBox.replaceChildren();
      for(const set of data.craftableSets||[]){
        cBox.append(button(`Craft Badge: ${set.title} (#${set.appid}, ${set.cardCount} cards)`,()=>craftBadgeForGame(set.appid),'btn-purple sam-quick-btn'));
      }
    }
    const box=$('marketCardsList');if(!box)return;
    box.replaceChildren();
    if(!data.cards?.length){
      box.append(element('small','No marketable trading cards found in your Steam inventory (753/6).'));
      return;
    }
    for(const c of data.cards.slice(0,40)){
      const row=element('div',undefined,'cards-game');
      const info=element('div',undefined,'cards-game-identity');
      info.append(element('strong',c.name),element('small',c.type));
      const sellBtn=button('Quick-Sell',()=>quickSellMarketCards([c.assetid]),'btn-action-sm');
      row.append(info,sellBtn);
      box.append(row);
    }
    notice(`Found ${data.totalCards} marketable trading card${data.totalCards===1?'':'s'}${data.estimate?` (Est. net: ${data.estimate.formattedNetUsd} USD)`:''}.`);
  }catch(e){
    notice(e.message);
  }
}
async function quickSellMarketCards(assetids=null){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  try{
    const identitySecret=($('marketIdentitySecretInput')?.value||'').trim();
    const res=await api('/api/cards/sell',{
      accountId:activeAccountId,
      ...(Array.isArray(assetids)?{assetids}:{}),
      ...(identitySecret?{identitySecret}:{})
    });
    if($('marketIdentitySecretInput')&&identitySecret)$('marketIdentitySecretInput').value='';
    notice(res.message||'Market quick-sell completed.');
    await loadMarketableCards();
  }catch(e){
    notice(e.message);
  }
}
async function claimDailyPoints(){
  if(!activeAccountId){notice(t('liveActionNotice'));openAddAccModal();return;}
  try{
    const res=await api('/api/points/claim-daily',{accountId:activeAccountId});
    const msg=res.message||(res.ok?'Daily Points Shop item claimed!':'No free daily Points Shop promotion available.');
    if($('discoveryQueueStatus'))$('discoveryQueueStatus').textContent=msg;
    notice(msg);
  }catch(e){
    notice(e.message);
  }
}
function applyStatusUpdate(data){
  if(!data||!Array.isArray(data.accounts))return;
  accounts=data.accounts;
  if(!accounts.some(a=>a.id===activeAccountId))activeAccountId=accounts[0]?.id||'';
  active=accounts.find(a=>a.id===activeAccountId)||null;
  renderAccountsTabs(accounts,activeAccountId);
  if(data.presets)renderPresets(data.presets);
  updateLocalBridgeBadge(data);
  renderCardFarming(active);
  renderAutomationsPanel(active);
  setGuestModeLayout(!active);
  if(active){
    const dispName=streamerMode?maskText(active.name,2):active.name;
    const dispProf=streamerMode?maskText(active.profileName||active.user,2):(active.profileName||active.user);
    const dispSteamId=streamerMode?maskText(active.linkedSteamId,5):active.linkedSteamId;
    $('userLabel').textContent=[dispName,dispProf].filter(Boolean).join(' · ');
    $('connectionDetails').textContent=`${active.connected?'Steam connected':'Steam disconnected'} · ${active.webSessionReady?'Web session ready':'Web session not ready'}${dispSteamId?' · Steam ID: '+dispSteamId:''}`;
    $('statusText').textContent=!active.connected?(active.error||'Disconnected'):active.isCollisionPaused?'Playing on another device':active.isSleepPaused?'Sleep schedule active':active.isPaused?'Paused':active.cardFarming&&!active.cardsReady?'Checking card drops':active.isFarming?'Activity sent to Steam':'No active games';
    $('badgeStatus').className='badge-status'+(!active.isFarming?' paused':'');
    updateActiveAccountControlsI18n(active);
    const activeParallelCount=Math.max((active.runningGames||[]).length,(active.games||[]).length);
    $('gamesCountVal').textContent=activeParallelCount+' / 32';
    const pct=Math.min(100,Math.round(activeParallelCount/32*100));$('capacityPercent').textContent=pct+'%';$('capacityFill').style.width=pct+'%';
    renderGames(active.games);
  }
}
function connectSSE(){
  if(eventSource){try{eventSource.close();}catch{}eventSource=null;}
  if(!active||!activeAccountId||typeof window.EventSource!=='function'||sseFailures>=3)return;
  try{
    const es=new window.EventSource(`/api/events?account=${encodeURIComponent(activeAccountId)}&csrf=${encodeURIComponent(csrf)}`);
    eventSource=es;
    es.onmessage=e=>{
      sseFailures=0;
      try{
        const payload=JSON.parse(e.data);
        if(payload&&payload.type==='achievement_unlocked'){
          showAchievementToast({
            name:payload.name||payload.apiname,
            gameName:payload.gameTitle||(`AppID ${payload.appid||currentAchAppId||''}`),
            iconUrl:payload.iconUrl,
            action:payload.action||'unlock'
          });
          return;
        }
        applyStatusUpdate(payload);
      }catch{}
    };
    es.onerror=()=>{
      try{es.close();}catch{}
      if(eventSource===es)eventSource=null;
      if(++sseFailures<3){
        const tmr=setTimeout(connectSSE,5000);
        tmr.unref?.();
      }
    };
  }catch{}
}
async function saveSleep(){const fields=['sleepEnabled','sleepStart','sleepEnd','timezoneInput'],versions=draftSettings.snapshot(fields),account=activeAccountId;const saved=await action('/api/set-sleep',{enabled:$('sleepEnabled').checked,start:Number($('sleepStart').value),end:Number($('sleepEnd').value),timezone:$('timezoneInput').value},'Sleep schedule updated. Equal start and end hours disable sleep mode.');if(saved&&account===activeAccountId)draftSettings.commit(fields,versions);return saved;}
async function saveCustomStatus(){const fields=['customStatusInput'],versions=draftSettings.snapshot(fields),account=activeAccountId;const saved=await action('/api/custom-status',{status:$('customStatusInput').value},'Custom status updated.');if(saved&&account===activeAccountId)draftSettings.commit(fields,versions);return saved;}
async function saveWebhook(){try{await api('/api/set-webhook',{webhook:$('webhookInput').value.trim()});$('webhookInput').value='';notice('Webhook updated.');await loadStatus();}catch(e){notice(e.message);}}
let debounce;
const VALVE_EXCLUSIVES_SEARCH_CATALOG = [
  { id: 753, name: 'Steam (Cliente / Ecosistema Oficial Valve)' },
  { id: 7, name: 'Steam Client (Núcleo Ejecutable 2003)' },
  { id: 8, name: 'WinUI (Interfaz Octubre 2003)' },
  { id: 92, name: 'Codename: Gordon (Reliquia 2004 Retirada)' },
  { id: 766, name: 'Steam Workshop (Subsistema Oficial)' },
  { id: 202352, name: 'Steam Trading Card Beta Access (Mayo 2013)' },
  { id: 1675200, name: 'Steam Deck (Consola Hardware Oficial)' },
  { id: 1675180, name: 'Steam Deck Deposit (Reserva Fundacional 2021)' },
  { id: 593110, name: 'Steam News (Subsistema Oficial Eventos)' },
  { id: 765, name: 'Steam Greenlight (Subsistema Histórico 2012)' },
  { id: 202351, name: 'Steam Community Beta Access (Agosto 2012)' },
  { id: 258280, name: 'Steam Music Beta (2014)' },
  { id: 248210, name: 'Steam Family Sharing Beta (2013)' },
  { id: 218800, name: 'Steam Software Beta Access (2012)' },
  { id: 221410, name: 'Steam for Linux Beta (2012)' },
  { id: 1059530, name: 'Valve Index VR Kit' },
  { id: 353380, name: 'Steam Controller' },
  { id: 353370, name: 'Steam Link' },
  { id: 250820, name: 'SteamVR' },
  { id: 340, name: 'Half-Life 2: Lost Coast' },
  { id: 211, name: 'Source SDK' },
  { id: 480, name: 'Spacewar (Steamworks SDK)' },
  { id: 760, name: 'Steam Screenshots (Subsistema UCM)' },
  { id: 767, name: 'Steam Artwork (Obras de Arte)' },
  { id: 761, name: 'Steam Cloud / Video' },
  { id: 245070, name: 'Steam Summer Getaway Sale 2013' },
  { id: 267420, name: 'Steam Holiday Sale 2013 (Snow Globe)' },
  { id: 303700, name: 'Steam Summer Adventure 2014' },
  { id: 335590, name: 'Steam Holiday Sale 2014' },
  { id: 368020, name: 'Monster Summer Sale 2015' },
  { id: 425280, name: 'Steam Holiday Sale 2015' },
  { id: 480730, name: 'Steam Summer Picnic Sale 2016' },
  { id: 566020, name: 'The Steam Awards 2016' },
  { id: 639900, name: 'Steam Summer Sale 2017' },
  { id: 876740, name: 'Intergalactic Summer Sale 2018 (Salien)' },
  { id: 991980, name: 'The Steam Winter Sale 2018' },
  { id: 2021850, name: 'Steam 3000 Summer Sale 2022 (Clorthax)' },
  { id: 223910, name: 'Saxxy Awards 2012' },
  { id: 261310, name: '3rd Annual Saxxy Awards 2013' },
  { id: 321770, name: '4th Annual Saxxy Awards 2014' },
  { id: 405270, name: '5th Annual Saxxy Awards 2015' },
  { id: 551410, name: '6th Annual Saxxy Awards 2016' },
  { id: 807210, name: '7th Annual Saxxy Awards 2017' }
];

function matchLocalValveExclusives(rawTerm) {
  const clean = String(rawTerm || '').toLowerCase().trim();
  if (!clean) return [];
  const idMatch = clean.match(/^(?:appid|id|#)?\s*(\d+)$/i);
  const numId = idMatch ? Number(idMatch[1]) : null;
  const matches = [];
  for (const item of VALVE_EXCLUSIVES_SEARCH_CATALOG) {
    if (
      numId === item.id ||
      (numId !== null && String(item.id).startsWith(String(numId))) ||
      `id${item.id}` === clean ||
      item.name.toLowerCase().includes(clean)
    ) {
      matches.push({
        id: item.id,
        name: `✨ ${item.name} · #${item.id}`,
        cleanName: item.name.replace(/\s*\([^)]*\)\s*$/, ''),
        img: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`
      });
    }
  }
  if (numId && !matches.some(m => m.id === numId)) {
    matches.push({
      id: numId,
      name: `➕ Agregar AppID #${numId}`,
      cleanName: `AppID ${numId}`,
      img: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${numId}/header.jpg`
    });
  }
  return matches.slice(0, 6);
}

$('searchInput').addEventListener('input',()=>{
  clearTimeout(debounce); const serial=++searchSerial,term=$('searchInput').value.trim(); $('searchResults').replaceChildren(); $('searchResults').style.display='none';
  if(!term)return;
  const localExclusives = matchLocalValveExclusives(term);
  if (localExclusives.length) {
    for (const item of localExclusives) {
      const b = button(item.name, () => { addGame(item.id, item.cleanName || item.name); $('searchResults').style.display = 'none'; }, 'search-item');
      b.prepend(image(item.img));
      $('searchResults').append(b);
    }
    $('searchResults').style.display = 'block';
  }
  debounce=setTimeout(async()=>{
    try{
      const list=await api('/api/search?term='+encodeURIComponent(term));
      if(serial!==searchSerial)return;
      $('searchResults').replaceChildren();
      const seen = new Set();
      for (const item of [...localExclusives, ...(list || [])]) {
        if (seen.has(Number(item.id))) continue;
        seen.add(Number(item.id));
        const b=button(item.name,()=>{addGame(item.id,item.cleanName||item.name);$('searchResults').style.display='none';},'search-item');
        b.prepend(image(item.img));
        $('searchResults').append(b);
      }
      $('searchResults').style.display=$('searchResults').childNodes.length?'block':'none';
    }catch(e){if(!localExclusives.length)notice(e.message);}
  },250);
});
$('searchInput').addEventListener('keydown',event=>{
  if(event.key!=='Enter')return;
  const raw=$('searchInput').value.trim();
  const singleIdMatch = raw.match(/^(?:appid|id|#)?\s*(\d+)$/i);
  if(singleIdMatch){
    const numId = Number(singleIdMatch[1]);
    const relic = VALVE_EXCLUSIVES_SEARCH_CATALOG.find(x => x.id === numId);
    $('searchResults').style.display='none';
    return addGame(numId, relic ? relic.name.replace(/\s*\([^)]*\)\s*$/, '') : undefined);
  }
  const ids=raw.split(/[\s,;]+/).map(tok => tok.replace(/^(?:appid|id|#)/i, '')).filter(Boolean);
  if(ids.length>1&&ids.every(x=>/^\d+$/.test(x))){
    $('searchResults').style.display='none';
    return addGame(ids.map(Number));
  }
});
$('pinInput').addEventListener('keydown',event=>{if(event.key==='Enter')unlock();});
document.addEventListener('click',event=>{if(!$('searchResults').contains(event.target)&&event.target!==$('searchInput'))$('searchResults').style.display='none';});
setInterval(()=>{if(document.hidden||!active)return;const start=active?.sessionStartTime, count=active?.runningGames?.length||0;const seconds=start&&active.isFarming?Math.max(0,Math.floor((Date.now()-start)/1000)):0;$('timerVal').textContent=`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;$('hoursVal').textContent=(seconds/3600*count).toFixed(1)+' estimated hrs';},1000);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if($('achModal')?.style.display==='flex')closeAchModal();
    if($('addAccModal')?.style.display==='flex')closeAddAccModal();
    if($('showcaseModal')?.style.display==='flex')closeShowcaseModal();
    return;
  }
  if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    const tag=(document.activeElement?.tagName||'').toUpperCase();
    const isEditable=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||document.activeElement?.isContentEditable;
    if(!isEditable){
      event.preventDefault();
      if($('achModal')?.style.display==='flex'&&$('achSearchInput'))$('achSearchInput').focus();
      else if($('searchInput'))$('searchInput').focus();
    }
  }
});
$('achModal').addEventListener('click',event=>{if(event.target===$('achModal'))closeAchModal();});
setInterval(()=>{if(!document.hidden)return loadStatus();},10000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){achievementLive.stop();return;}loadStatus();if(liveContext){achievementLive.start(liveContext);achievementLive.wake();}});
let networkBannerTimer=null;
function handleNetworkStatusChange(isOnline){
  const banner=$('networkStatusBanner');
  clearTimeout(networkBannerTimer);
  if(!isOnline){
    achievementLive.stop();
    if(banner){
      banner.textContent=t('offlineBannerText');
      banner.className='network-status-banner offline';
      banner.hidden=false;
    }
  }else{
    if(banner){
      banner.textContent=t('onlineBannerText');
      banner.className='network-status-banner online';
      banner.hidden=false;
      networkBannerTimer=setTimeout(()=>{banner.hidden=true;},4000);
      networkBannerTimer.unref?.();
    }
    if(liveContext){achievementLive.start(liveContext);achievementLive.wake();}
  }
}
window.addEventListener('offline',()=>handleNetworkStatusChange(false));
window.addEventListener('online',()=>handleNetworkStatusChange(true));
window.addEventListener('focus',()=>{if(!document.hidden)achievementLive.wake();});
document.querySelector('[data-event-0]').addEventListener('click', function(event) { unlock(); });
document.querySelector('[data-event-1]').addEventListener('click', function(event) { submitGuard(); });
document.querySelector('[data-event-2]').addEventListener('click', function(event) { submitAddAccount(); });
document.querySelector('[data-event-3]').addEventListener('click', function(event) { closeAddAccModal(); });
$('achReadMode').addEventListener('change',()=>{if(currentAchAppId)openAchModal(currentAchAppId,currentAchGameName,true,$('achReadMode').value);});
$('achCompatibilityFilter').addEventListener('change',()=>{achievementPage=0;filterCompatibility=$('achCompatibilityFilter').value;renderAchModal();});
document.querySelector('[data-event-4]').addEventListener('click', function(event) { forceRefreshAchievements(); });
document.querySelector('[data-event-5]').addEventListener('click', function(event) { closeAchModal(); });
document.querySelector('[data-event-6]').addEventListener('click', function(event) { setFilter('status', 'all'); });
document.querySelector('[data-event-7]').addEventListener('click', function(event) { setFilter('status', 'unlocked'); });
document.querySelector('[data-event-8]').addEventListener('click', function(event) { setFilter('status', 'locked'); });
document.querySelector('[data-event-9]').addEventListener('click', function(event) { setFilter('rarity', 'mythic'); });
document.querySelector('[data-event-10]').addEventListener('click', function(event) { setFilter('rarity', 'epic'); });
document.querySelector('[data-event-11]').addEventListener('click', function(event) { setFilter('rarity', 'rare'); });
if($('filterRarityCommonBtn'))$('filterRarityCommonBtn').addEventListener('click',()=>setFilter('rarity','common'));
if($('runDiscoveryQueueBtn'))$('runDiscoveryQueueBtn').addEventListener('click',()=>runDiscoveryQueue());
if($('claimDailyPointsBtn'))$('claimDailyPointsBtn').addEventListener('click',()=>claimDailyPoints());
if($('cancelAllTimedBtn'))$('cancelAllTimedBtn').addEventListener('click',()=>cancelAllTimedSchedules());
if($('autoDiscoveryQueueToggle'))$('autoDiscoveryQueueToggle').addEventListener('change',e=>toggleAutoDiscoveryQueue(e.target.checked));
if($('loadInventoryCardsBtn'))$('loadInventoryCardsBtn').addEventListener('click',()=>loadMarketableCards());
if($('quickSellCardsBtn'))$('quickSellCardsBtn').addEventListener('click',()=>quickSellMarketCards(null));
if($('btnSoundToggle')){$('btnSoundToggle').textContent=soundMuted?'Sound: OFF':'Sound: ON';$('btnSoundToggle').addEventListener('click',()=>toggleSoundMute());}
if($('btnStreamerMode')){$('btnStreamerMode').textContent=streamerMode?'Streamer Mode: ON':'Streamer Mode: OFF';$('btnStreamerMode').addEventListener('click',()=>toggleStreamerMode());}
if($('btnShowcaseCard'))$('btnShowcaseCard').addEventListener('click',()=>openShowcaseModal());
if($('closeShowcaseBtn'))$('closeShowcaseBtn').addEventListener('click',()=>closeShowcaseModal());
if($('downloadShowcaseBtn'))$('downloadShowcaseBtn').addEventListener('click',()=>downloadShowcaseCard());
if($('craftBadgeBtn'))$('craftBadgeBtn').addEventListener('click',()=>craftBadgeForGame());
if($('clusterStartAllBtn'))$('clusterStartAllBtn').addEventListener('click',()=>runClusterAction('start_all'));
if($('clusterPauseAllBtn'))$('clusterPauseAllBtn').addEventListener('click',()=>runClusterAction('pause_all'));
if($('clusterCardsAllBtn'))$('clusterCardsAllBtn').addEventListener('click',()=>runClusterAction('cards_on_all'));
if($('btnViewGrid'))$('btnViewGrid').addEventListener('click',()=>setLibraryViewMode('grid'));
if($('btnViewList'))$('btnViewList').addEventListener('click',()=>setLibraryViewMode('list'));
if($('langSelect')){$('langSelect').value=currentLang;$('langSelect').addEventListener('change',e=>applyLanguage(e.target.value));}
if($('samResetStatsOnLockToggle'))$('samResetStatsOnLockToggle').checked=true;
if($('btnOledTheme'))$('btnOledTheme').addEventListener('click',()=>toggleOledTheme());
if($('copySteamIdBtn'))$('copySteamIdBtn').addEventListener('click',async()=>{
  const rawSid=active?.linkedSteamId||active?.steamId64||active?.mySteamID||'';
  if(!rawSid)return;
  try{await navigator.clipboard?.writeText(rawSid);}catch{}
  notice(currentLang==='es'?`SteamID64 copiado: ${streamerMode?maskText(rawSid,5):rawSid}`:`SteamID64 copied: ${streamerMode?maskText(rawSid,5):rawSid}`);
});
if($('btnLandingConnect'))$('btnLandingConnect').addEventListener('click',()=>openAddAccModal());
if($('headerGuestConnectBtn'))$('headerGuestConnectBtn').addEventListener('click',()=>openAddAccModal());
if($('btnLandingLiveDemo'))$('btnLandingLiveDemo').addEventListener('click',()=>{
  try{$('gamesGrid')?.scrollIntoView?.({behavior:'smooth'});}catch{}
  openAchModal(730,'Counter-Strike 2',false,'web','achievements');
});
if($('footerLinkSam'))$('footerLinkSam').addEventListener('click',e=>{e.preventDefault();openAchModal(730,'Counter-Strike 2',false,active?.connected?'auto':'web','achievements');});
if($('footerLinkAsf'))$('footerLinkAsf').addEventListener('click',e=>{if($('cardsPanel')){$('cardsPanel').hidden=false;$('cardsPanel').open=true;}});
if($('footerLinkTasks'))$('footerLinkTasks').addEventListener('click',e=>{if($('automationsPanel'))$('automationsPanel').open=true;});
applyOledTheme(oledTheme);
applyLanguage(currentLang);
setLibraryViewMode(libraryViewMode);
document.querySelector('[data-event-12]').addEventListener('change', function(event) { setSort(this.value); });
document.querySelector('[data-event-13]').addEventListener('input', function(event) { onSearchInput(this.value); });
document.querySelector('[data-event-15]').addEventListener('click', function(event) { openAddAccModal(); });
document.querySelector('[data-event-16]').addEventListener('click', function(event) { reloginAccount(); });
document.querySelector('[data-event-17]').addEventListener('click', function(event) { logoutSteam(); });
document.querySelector('[data-event-18]').addEventListener('click', function(event) { deleteCurrentAccount(); });
document.querySelector('[data-event-19]').addEventListener('click', function(event) { toggleCards(); });
document.querySelector('[data-event-20]').addEventListener('click', function(event) { claimFreeGames(); });
document.querySelector('[data-event-21]').addEventListener('click', function(event) { togglePersona(); });
document.querySelector('[data-event-22]').addEventListener('click', function(event) { changePanelPassword(); });
document.querySelector('[data-event-23]').addEventListener('click', function(event) { lock(); });
document.querySelector('[data-event-24]').addEventListener('click', function(event) { togglePause(); });
document.querySelector('[data-event-25]').addEventListener('click', function(event) { clearAll(); });
document.querySelector('[data-event-26]').addEventListener('click', function(event) { saveCustomStatus(); });
document.querySelector('[data-event-27]').addEventListener('click', function(event) { saveWebhook(); });
document.querySelector('[data-event-28]').addEventListener('click', function(event) { saveSleep(); });
document.querySelector('[data-event-29]').addEventListener('click', function(event) { editChatAdmins(); });
checkAuth();

if($('rescanCardsBtn'))$('rescanCardsBtn').addEventListener('click',async()=>{
  if(!activeAccountId)return notice(t('liveActionNotice'));
  try{
    $('rescanCardsBtn').disabled=true;
    $('rescanCardsBtn').textContent=currentLang==='es'?'⏳ Escaneando…':'⏳ Scanning…';
    const res=await api('/api/cards/rescan',{accountId:activeAccountId});
    await loadStatus();
    const count=(res?.cardDropGames||[]).length;
    notice(count>0?`✅ Escaneo completado: ${count} juegos con cromos pendientes encontrados.`:`✅ Escaneo completado (${res?.badgePagesScanned||1} páginas verificadas): ya obtuviste todos los cromos disponibles de tu cuenta (0 pendientes).`);
  }catch(e){notice(e.message);}finally{
    if($('rescanCardsBtn')){$('rescanCardsBtn').disabled=false;$('rescanCardsBtn').textContent='🔄 Re-escanear insignias';}
  }
});


/* ==========================================================================
   v63 — Sliding Hero Game Carousel & Dedicated SteamHunters Scheduler Menu
   ========================================================================== */


function stepHeroCarousel(delta) {
  if (heroCarouselSlideCount <= 1) return;
  heroCarouselIndex = (heroCarouselIndex + delta + heroCarouselSlideCount) % heroCarouselSlideCount;
  updateHeroCarouselPosition();
}

function goToHeroCarouselSlide(idx) {
  if (heroCarouselSlideCount <= 0) return;
  heroCarouselIndex = Math.max(0, Math.min(heroCarouselSlideCount - 1, idx));
  updateHeroCarouselPosition();
}

function updateHeroCarouselPosition() {
  const track = $('heroCarouselTrack');
  if (track) {
    track.style.transform = `translate3d(-${heroCarouselIndex * 100}%, 0, 0)`;
  }
  const dotsWrap = $('heroCarouselDots');
  if (dotsWrap) {
    [...dotsWrap.children].forEach((dot, i) => {
      dot.classList.toggle('active', i === heroCarouselIndex);
    });
  }
}

function openSchedulerForGame(appid) {
  const panel = $('scheduledAchievementsPanel');
  if (panel) {
    panel.open = true;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const sel = $('schedDashboardGameSelect');
  if (sel && appid) {
    sel.value = String(appid);
    previewDashboardSchedule();
  }
}

function renderHeroCarousel(account) {
  const section = $('heroCarouselSection');
  const track = $('heroCarouselTrack');
  const dots = $('heroCarouselDots');
  if (!section || !track || !dots) return;
  if (!account) {
    section.hidden = true;
    return;
  }
  const runningSet = new Set(account.isFarming ? (account.runningGames || []) : []);
  const timedMap = new Map((account.activeTimedJobs || []).map(j => [Number(j.appid), j]));
  const dropMap = new Map((account.cardDropGames || []).filter(g => g && g.remaining > 0).map(g => [Number(g.appid), g]));
  const allIds = [...new Set([
    ...[...timedMap.keys()],
    ...(account.runningGames || []),
    ...(account.games || []),
    ...[...dropMap.keys()]
  ])].filter(id => Number.isInteger(Number(id)) && Number(id) > 0).slice(0, 8);

  if (!allIds.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const snap = JSON.stringify([account.id, allIds, account.gameNames, [...runningSet], [...timedMap.entries()], [...dropMap.entries()], currentLang]);
  if (snap === heroCarouselSnapshot) return;
  heroCarouselSnapshot = snap;

  const slides = [];
  const dotBtns = [];
  allIds.forEach((id, idx) => {
    const numId = Number(id);
    const dropInfo = dropMap.get(numId);
    const timedJob = timedMap.get(numId);
    const title = dropInfo?.name || account.gameNames?.[numId] || `AppID ${numId}`;
    const isRunning = runningSet.has(numId);

    const slide = element('div', undefined, 'hero-slide');
    const bgImg = image(
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${numId}/library_hero.jpg`,
      'hero-slide-bg',
      [
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${numId}/header.jpg`,
        `https://cdn.akamai.steamstatic.com/steam/apps/${numId}/header.jpg`
      ]
    );
    const overlay = element('div', undefined, 'hero-slide-overlay');
    const content = element('div', undefined, 'hero-slide-content');

    const topBadges = element('div', undefined, 'hero-slide-badges');
    const statusText = timedJob
      ? `⏱️ SteamHunters Activo (${timedJob.completedCount}/${timedJob.totalCount})`
      : isRunning
        ? (dropInfo ? `🃏 Farmeando Cromos (${dropInfo.remaining} restantes)` : '🟢 Farmeando Horas en Vivo')
        : '⚡ En Biblioteca Activa';
    const statusBadge = element('span', statusText, 'hero-status-pill' + (isRunning || timedJob ? ' active' : ''));
    const appBadge = element('span', `AppID #${numId}`, 'hero-appid-pill');
    topBadges.append(statusBadge, appBadge);

    const titleEl = element('h3', title, 'hero-slide-title');
    const subEl = element(
      'p',
      timedJob
        ? `Desbloqueando logros solos en orden de obtención · Próximo: ${timedJob.nextItem?.name || 'en cola'} (${timedJob.nextRunAt ? new Date(timedJob.nextRunAt).toLocaleTimeString('en-US') : 'pronto'})`
        : 'Abrí sus logros ordenados por % de obtención o activá el programador automático con curva real de SteamHunters.',
      'hero-slide-sub'
    );

    const actions = element('div', undefined, 'hero-slide-actions');
    const achBtn = button('🏆 Logros (Orden de Obtención)', () => openAchModal(numId, title, false, account.connected ? 'auto' : 'web', 'achievements'), 'btn-main sam-quick-btn');
    const schedBtn = button('⏱️ Programar Logros (SteamHunters)', () => openSchedulerForGame(numId), 'btn-action-sm sam-quick-btn');
    actions.append(achBtn, schedBtn);

    const floatPreview = element('div', undefined, 'hero-slide-floating-card');
    const floatCapsule = image(
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${numId}/header.jpg`,
      'hero-floating-capsule-img',
      [`https://cdn.akamai.steamstatic.com/steam/apps/${numId}/header.jpg`]
    );
    const floatMeta = element('div', undefined, 'hero-floating-capsule-meta');
    floatMeta.append(
      element('strong', title, 'hero-floating-capsule-title'),
      element('span', isRunning ? '● LIVE IN STEAM' : `APP #${numId}`, 'hero-floating-capsule-badge' + (isRunning ? ' live' : ''))
    );
    floatPreview.append(floatCapsule, floatMeta);

    content.append(topBadges, titleEl, subEl, actions);
    slide.append(bgImg, overlay, content, floatPreview);
    slides.push(slide);

    const dot = element('button', '', 'hero-carousel-dot' + (idx === heroCarouselIndex ? ' active' : ''));
    dot.type = 'button';
    dot.setAttribute('aria-label', `Ver ${title}`);
    dot.addEventListener('click', () => goToHeroCarouselSlide(idx));
    dotBtns.push(dot);
  });

  heroCarouselSlideCount = slides.length;
  if (heroCarouselIndex >= heroCarouselSlideCount) heroCarouselIndex = 0;
  track.replaceChildren(...slides);
  dots.replaceChildren(...dotBtns);
  updateHeroCarouselPosition();

  if (!heroCarouselTimer && typeof window.testUI === 'undefined') {
    heroCarouselTimer = setInterval(() => {
      if (!document.hidden && heroCarouselSlideCount > 1) stepHeroCarousel(1);
    }, 6500);
  }
}

function renderScheduledAchievementsPanel(account) {
  const sel = $('schedDashboardGameSelect');
  const activeBox = $('schedActiveJobsList');
  const badge = $('schedPanelSummaryBadge');
  if (!sel || !activeBox) return;

  if (!account) {
    if (badge) badge.textContent = 'Conecta tu cuenta';
    activeBox.replaceChildren();
    return;
  }

  const dropGames = (account.cardDropGames || []).map(g => Number(g.appid));
  const timedGames = (account.activeTimedJobs || []).map(j => Number(j.appid));
  const allGames = [...new Set([...(account.games || []), ...timedGames, ...dropGames])].filter(id => Number.isInteger(Number(id)) && Number(id) > 0);

  const gamesSnap = JSON.stringify([account.id, allGames, account.gameNames]);
  if (gamesSnap !== schedGamesListSnapshot) {
    schedGamesListSnapshot = gamesSnap;
    const prevVal = sel.value;
    const opts = allGames.map(id => {
      const title = account.gameNames?.[id] || (account.cardDropGames || []).find(g => Number(g.appid) === Number(id))?.name || `AppID ${id}`;
      const opt = element('option', `${title} (#${id})`);
      opt.value = String(id);
      return opt;
    });
    if (!opts.length) {
      const emptyOpt = element('option', 'Agregá un juego arriba en Controles de juegos...');
      emptyOpt.value = '';
      opts.push(emptyOpt);
    }
    sel.replaceChildren(...opts);
    if (prevVal && allGames.includes(Number(prevVal))) sel.value = prevVal;
  }

  const timedJobs = Array.isArray(account.activeTimedJobs) ? account.activeTimedJobs : [];
  if (badge) {
    badge.textContent = timedJobs.length
      ? `🟢 ${timedJobs.length} programación${timedJobs.length === 1 ? '' : 'es'} activa${timedJobs.length === 1 ? '' : 's'}`
      : 'Listo para programar';
  }

  activeBox.replaceChildren();
  if (!timedJobs.length) {
    const emptyMsg = element('div', 'No hay juegos desbloqueando logros en automático en este momento.', 'sched-empty-state');
    activeBox.append(emptyMsg);
    return;
  }

  for (const job of timedJobs) {
    const gTitle = account.gameNames?.[job.appid] || ('AppID ' + job.appid);
    const pct = job.totalCount ? Math.round((job.completedCount / job.totalCount) * 100) : 0;
    const card = element('div', undefined, 'sched-job-card');

    const head = element('div', undefined, 'sched-job-head');
    const titleWrap = element('div');
    titleWrap.append(
      element('strong', gTitle + ' (#' + job.appid + ')'),
      element('span', ' · ' + job.completedCount + '/' + job.totalCount + ' logros (' + pct + '%)', 'sched-job-progress-label')
    );
    const isPaused = job.pausedManually || job.pausedByCollision;
    const inSession = Boolean(job.inActiveSessionWindow);
    const pillText = job.pausedByCollision
      ? '⏸️ Pausa por juego en PC'
      : job.pausedManually
        ? '⏸️ En Pausa Manual'
        : inSession
          ? '🟢 Jugando sesión activa en Steam'
          : '🌙 En descanso de Playtime (Juego cerrado)';
    const statePill = element(
      'span',
      pillText,
      'sched-job-pill' + (isPaused ? ' paused' : inSession ? ' active' : ' resting')
    );
    head.append(titleWrap, statePill);

    const barBg = element('div', undefined, 'progress-bar-bg');
    const barFill = element('div', undefined, 'progress-bar-fill');
    barFill.style.width = pct + '%';
    barBg.append(barFill);

    const sessionBanner = element('div', undefined, 'sched-job-session-banner');
    const plannedHrsStr = job.plannedPlaytimeHours ? (' · 🎮 Playtime total planificado: ~' + job.plannedPlaytimeHours + ' h') : '';
    if (!isPaused && inSession && job.currentSessionWindow) {
      const endStr = new Date(job.currentSessionWindow.endAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' hs';
      sessionBanner.textContent = '🟢 Juego abierto ahora en Steam (cierra automáticamente a las ' + endStr + ' al terminar esta sesión)' + plannedHrsStr;
    } else if (!isPaused && !inSession && job.nextSessionWindow) {
      const nextOpenStr = formatHumanScheduleDate(job.nextSessionWindow.startAt, Math.max(0, Date.parse(job.nextSessionWindow.startAt) - Date.now()));
      const nextCloseStr = new Date(job.nextSessionWindow.endAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' hs';
      sessionBanner.textContent = '🛡️ Juego cerrado en Steam para no inflar horas · Próxima sesión activa: abre ' + nextOpenStr + ' → cierra ' + nextCloseStr + ' (' + job.nextSessionWindow.durationHours + 'h)' + plannedHrsStr;
    } else if (plannedHrsStr) {
      sessionBanner.textContent = '🛡️ Control inteligente de sesiones activo' + plannedHrsStr;
    }

    const nextInfo = element('div', undefined, 'sched-job-next');
    if (job.nextItem) {
      const nextTimeStr = job.nextRunAt ? new Date(job.nextRunAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const pctBadge = typeof job.nextItem.percent === 'number' ? (' (' + job.nextItem.percent.toFixed(1) + '% global)') : '';
      nextInfo.textContent = '🎯 Próximo en desbloquear: "' + job.nextItem.name + '"' + pctBadge + ' a las ' + nextTimeStr;
    } else if (job.nextRunAt) {
      nextInfo.textContent = '🎯 Próximo desbloqueo a las ' + new Date(job.nextRunAt).toLocaleTimeString('en-US');
    }

    const upcomingWrap = element('div', undefined, 'sched-upcoming-chips');
    if (Array.isArray(job.upcomingQueue) && job.upcomingQueue.length > 0) {
      job.upcomingQueue.slice(0, 5).forEach((q, idx) => {
        const tStr = q.runAt ? new Date(q.runAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const pStr = typeof q.percent === 'number' ? (' · ' + q.percent.toFixed(1) + '%') : '';
        const chip = element('span', '#' + (job.completedCount + idx + 1) + ' ' + q.name + pStr + ' (' + tStr + ')', 'sched-queue-chip');
        upcomingWrap.append(chip);
      });
    }

    const actionsRow = element('div', undefined, 'sam-row-actions');
    const pauseResumeBtn = button(
      isPaused ? '▶️ Reanudar' : '⏸️ Pausar',
      async () => {
        try {
          await api('/api/achievement/timed', { accountId: account.id, appid: job.appid, action: isPaused ? 'resume' : 'pause' });
          await loadStatus();
        } catch (e) { notice(e.message); }
      },
      'btn-action-sm sam-quick-btn'
    );
    const openModalBtn = button(
      '🏆 Ver logros',
      () => openAchModal(job.appid, gTitle, false, account.connected ? 'auto' : 'web', 'achievements'),
      'btn-action-sm sam-quick-btn'
    );
    const cancelBtn = button(
      '✕ Cancelar',
      async () => {
        try {
          await api('/api/achievement/timed', { accountId: account.id, appid: job.appid, action: 'cancel' });
          await loadStatus();
        } catch (e) { notice(e.message); }
      },
      'btn-clear sam-quick-btn'
    );
    actionsRow.append(pauseResumeBtn, openModalBtn, cancelBtn);

    card.append(head, barBg);
    if (sessionBanner.textContent) card.append(sessionBanner);
    card.append(nextInfo);
    if (upcomingWrap.childNodes.length) card.append(upcomingWrap);
    card.append(actionsRow);
    activeBox.append(card);
  }
}

function updateModalExternalHunterLinks(appid) {
  const num = Number(appid || currentAchAppId || 550);
  if (num <= 0) return;
  const uUrl = 'https://steamhunters.com/apps/' + num + '/users?state=completed';
  const aUrl = 'https://steamhunters.com/apps/' + num + '/achievements';
  const sUrl = 'https://astats.astats.nl/astats/Steam_Game_Info.php?AppID=' + num;
  for (const id of ['modalLinkSteamHuntersUsers', 'linkModalSteamHuntersUsers']) if ($(id)) $(id).href = uUrl;
  for (const id of ['modalLinkSteamHuntersAchs', 'linkModalSteamHuntersAchs']) if ($(id)) $(id).href = aUrl;
  for (const id of ['modalLinkAstatsGame', 'linkModalAStats']) if ($(id)) $(id).href = sUrl;
}

function updateSchedBannerForApp(appid) {
  const num = Number(appid || 0);
  const img = $('schedSelectedGameBanner');
  if (img && num > 0) {
    img.src = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + num + '/header.jpg';
  }
  if (num > 0) {
    const uUrl = 'https://steamhunters.com/apps/' + num + '/users?state=completed';
    const aUrl = 'https://steamhunters.com/apps/' + num + '/achievements';
    const sUrl = 'https://astats.astats.nl/astats/Steam_Game_Info.php?AppID=' + num;
    for (const id of ['dashLinkSteamHuntersUsers', 'linkDashSteamHuntersUsers']) if ($(id)) $(id).href = uUrl;
    for (const id of ['dashLinkSteamHuntersAchs', 'linkDashSteamHuntersAchs']) if ($(id)) $(id).href = aUrl;
    for (const id of ['dashLinkAstatsGame', 'linkDashAStats']) if ($(id)) $(id).href = sUrl;
  }
}

function extractAppIdFromDonorUrl(rawUrl) {
  const m = String(rawUrl || '').match(new RegExp('/(?:apps|stats)/(\\d{1,10})(?:\\b|/|$)', 'i'));
  return m ? Number(m[1]) : 0;
}

function ensureSchedGameSelectAppId(appid) {
  const num = Number(appid || 0);
  if (!num) return 0;
  const sel = $('schedDashboardGameSelect');
  if (!sel) return num;
  let opt = [...sel.options].find(o => Number(o.value) === num);
  if (!opt) {
    const title = active?.gameNames?.[num] || ('AppID #' + num);
    opt = new Option(title + ' (#' + num + ')', String(num));
    sel.prepend(opt);
  }
  if (Number(sel.value) !== num) {
    sel.value = String(num);
    updateSchedBannerForApp(num);
  }
  return num;
}

function formatHumanScheduleDate(isoStr, offsetMs) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const calDays = Math.max(0, Math.round((targetMidnight - todayMidnight) / 86400000));
  const timePart = d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' hs';
  if (calDays === 0) {
    return 'Hoy · ' + timePart;
  }
  if (calDays === 1) {
    return 'Mañana · ' + timePart;
  }
  if (calDays === 2) {
    return 'Pasado mañana (+2d) · ' + timePart;
  }
  const datePart = d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' });
  return datePart + ' (+' + calDays + 'd) · ' + timePart;
}

function renderSchedulePreviewBox(res, box, isDonor = false) {
  if (!box || !res) return;
  box.replaceChildren();
  const isDonorMode = Boolean(isDonor || res.donorMode);

  if (isDonorMode) {
    const donorPlaytime = res.donorHoursPlayed ?? res.donorPlaytimeHours ?? res.plannedPlaytimeHours ?? null;
    if (donorPlaytime && $('schedTargetPlaytimeInput') && !$('schedTargetPlaytimeInput').value) {
      $('schedTargetPlaytimeInput').placeholder = 'Auto (~' + donorPlaytime + ' hs)';
    }
    const donorCard = element('div', undefined, 'sched-donor-telemetry-card');
    const donorTitleRow = element('div', undefined, 'sched-donor-telemetry-head');
    const donorIdentity = '🧬 Donante reconocido: ' + (res.donorName || res.donorLabel || 'Jugador Verificado') + (res.donorSteamId ? (' (' + res.donorSteamId + ')') : '');
    donorTitleRow.append(element('strong', donorIdentity, 'sched-donor-name'));
    if (donorPlaytime !== null && donorPlaytime !== undefined) {
      donorTitleRow.append(element('span', '🎮 Playtime del donante: ~' + donorPlaytime + ' h en Steam', 'sched-donor-hours-pill'));
    }
    donorCard.append(donorTitleRow);

    const fullRangeStr = res.donorFirstUnlockAt && res.donorLastUnlockAt
      ? (' (' + new Date(res.donorFirstUnlockAt).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' → ' + new Date(res.donorLastUnlockAt).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ')')
      : '';
    const fullDonorSpan = res.donorFullDurationTextEs || res.durationTextEs || (res.estimatedDays + ' días');
    const fullDonorLine = element('div', '🏆 Platino del donante: ' + (res.donorTotalUnlockedCount ?? res.scheduledCount) + '/' + (res.totalGameAchievements ?? res.scheduledCount) + ' logros a lo largo de ' + fullDonorSpan + fullRangeStr, 'sched-donor-meta-line');
    donorCard.append(fullDonorLine);

    const plannedHrs = res.plannedPlaytimeHours || donorPlaytime || 25;
    const sessCnt = res.sessionCount || (Array.isArray(res.sessions) ? res.sessions.length : 1);
    const queueSpanLabel = res.durationTextEs || (res.estimatedDays + ' días');
    const userQueueLine = element('div', undefined, 'sched-donor-queue-line');
    userQueueLine.textContent = '⏱️ Plan inteligente de horas y sesiones: ' + res.scheduledCount + ' logros en ' + sessCnt + ' sesiones activas · 🎮 El bot abrirá el juego SOLO ~' + plannedHrs + ' h totales (cerrándolo en las pausas de madrugada/días sin jugar a lo largo de ' + queueSpanLabel + ' para NO inflar tus horas).';
    donorCard.append(userQueueLine);
    box.append(donorCard);
  } else {
    const estDays = Number(res.estimatedDays || 1);
    const estMonths = Number(res.estimatedMonths || (estDays / 30).toFixed(1));
    const spanText = res.durationTextEs
      ? res.durationTextEs
      : estDays >= 45
        ? ('~' + estMonths + ' meses (' + estDays + ' días)')
        : estDays > 1
          ? ('~' + estDays + ' días')
          : 'sesión de hoy';
    const summary = element('div', undefined, 'sched-preview-summary');
    summary.textContent = '📊 ' + (res.alreadyUnlockedCount ?? 0) + '/' + (res.totalGameAchievements ?? res.scheduledCount ?? 0) + ' ya desbloqueados · ' + (res.scheduledCount ?? (res.queue?.length || 0)) + ' logros en orden progresivo a lo largo de ' + spanText + '.';
    box.append(summary);
  }

  if (Array.isArray(res.skippedSpecial) && res.skippedSpecial.length > 0) {
    const alertBox = element('div', undefined, 'sched-skipped-alert');
    const alertTitle = element('strong', '🛡️ ' + res.skippedSpecial.length + ' logro' + (res.skippedSpecial.length === 1 ? '' : 's') + ' de fecha/evento especial omitido' + (res.skippedSpecial.length === 1 ? '' : 's') + ' por seguridad:');
    const chipsWrap = element('div', undefined, 'sched-skipped-chips');
    for (const sk of res.skippedSpecial) {
      const chip = element('span', sk.label + ': ' + sk.name, 'sched-skipped-chip');
      chip.title = sk.reasonEs || '';
      chipsWrap.append(chip);
    }
    alertBox.append(alertTitle, chipsWrap);
    box.append(alertBox);
  }

  if (!res.queue?.length) {
    box.append(element('p', '✅ No quedan logros elegibles pendientes para programar.', 'pioneer-card-desc'));
    return;
  }

  const listWrap = element('div', undefined, 'sched-preview-list');
  res.queue.slice(0, 80).forEach(item => {
    const row = element('div', undefined, 'sched-preview-row');
    const pctNum = typeof item.percent === 'number' ? item.percent : null;
    const pctStr = pctNum !== null ? (pctNum.toFixed(1) + '%') : '—';
    let tierBadgeText;
    if (item.donorUnlockedAt) {
      const dtStr = new Date(item.donorUnlockedAt).toLocaleString('es-UY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const deltaStr = item.donorDeltaLabelEs ? (' · ' + item.donorDeltaLabelEs) : '';
      tierBadgeText = 'Donante (' + dtStr + deltaStr + ')';
    } else {
      tierBadgeText = pctNum === null ? 'Progreso' : pctNum >= 45 ? 'Común' : pctNum >= 15 ? 'Campaña' : pctNum >= 4 ? 'Raro' : 'Grind Largo';
    }
    const tierKindClass = item.donorUnlockedAt
      ? ' tier-donor'
      : (pctNum === null ? ' tier-campaign' : pctNum >= 45 ? ' tier-common' : pctNum >= 15 ? ' tier-campaign' : pctNum >= 4 ? ' tier-rare' : ' tier-grind rare');
    const nameWrap = element('div', undefined, 'sched-step-name-wrap');
    const badgesInline = element('div', undefined, 'sched-step-badges-inline');
    badgesInline.append(
      element('span', tierBadgeText + ' · ' + pctStr, 'sched-step-tier' + tierKindClass + (pctNum !== null && pctNum < 5 && !tierKindClass.includes('rare') ? ' rare' : ''))
    );
    if (item.isSessionStart && item.sessionStartAt) {
      const openTime = new Date(item.sessionStartAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' hs';
      badgesInline.append(element('span', '🟢 Abre juego ' + openTime + ' (' + (item.sessionDurationHours || 1.5) + 'h)', 'sched-session-window-pill open'));
    }
    if (item.isSessionEnd && item.sessionEndAt) {
      const closeTime = new Date(item.sessionEndAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' hs';
      badgesInline.append(element('span', '🌙 Cierra juego ' + closeTime, 'sched-session-window-pill close'));
    }
    nameWrap.append(
      element('strong', item.name, 'sched-step-name'),
      badgesInline
    );
    row.append(
      element('span', '#' + item.step, 'sched-step-num'),
      nameWrap,
      element('span', formatHumanScheduleDate(item.estimatedAt, item.offsetMs), 'sched-step-time')
    );
    listWrap.append(row);
  });
  box.append(listWrap);
}

async function previewModalSchedule() {
  if (!currentAchAppId || !activeAccountId) return;
  updateModalExternalHunterLinks(currentAchAppId);
  const donorInput = ($('copyTimingsSourceInput')?.value || '').trim();
  if (donorInput) {
    return copyUserTimings(true);
  }
  const box = $('modalSchedulePreviewBox');
  if (!box) return;
  const skipDateSpecific = $('modalSkipDateSpecificToggle') ? Boolean($('modalSkipDateSpecificToggle').checked) : true;
  box.replaceChildren(element('p', '⏳ Calculando cronograma de platinador legal según la dificultad de cada logro…', 'pioneer-card-desc'));
  try {
    const res = await api('/api/achievement/timed', {
      accountId: activeAccountId,
      appid: currentAchAppId,
      action: 'preview',
      spacing: 'platinum',
      order: 'progression',
      pacingMode: selectedPlatinumPace,
      skipDateSpecific,
      percentages: buildCurrentPercentagesMap(),
      bulkAction: 'unlock_all'
    });
    renderSchedulePreviewBox(res, box, false);
  } catch (e) {
    box.replaceChildren(element('p', e.message, 'pioneer-card-desc'));
  }
}

async function previewDashboardSchedule() {
  const donorSource = ($('schedDonorProfileInput')?.value || '').trim();
  const urlAppId = extractAppIdFromDonorUrl(donorSource);
  if (urlAppId) ensureSchedGameSelectAppId(urlAppId);
  const appid = Number($('schedDashboardGameSelect')?.value || urlAppId || 0);
  const pace = $('schedDashboardPaceSelect')?.value || 'legal_completionist';
  const skipDateSpecific = $('schedSkipDateSpecificToggle') ? Boolean($('schedSkipDateSpecificToggle').checked) : true;
  const includeAlreadyUnlocked = Boolean($('schedIncludeUnlockedToggle')?.checked);
  const targetPlaytimeHours = Number($('schedTargetPlaytimeInput')?.value || 0) || null;
  const box = $('schedPreviewBox');
  if (!box) return;
  if (!activeAccountId || !appid) return;
  updateSchedBannerForApp(appid);

  if (donorSource) {
    box.replaceChildren(element('p', '⏳ Reconociendo datos del donante y calculando sesiones activas de Playtime…', 'pioneer-card-desc'));
    try {
      const res = await api('/api/achievement/copy-timings', {
        accountId: activeAccountId,
        appid,
        source: donorSource,
        action: 'preview',
        realisticDonor: true,
        skipDateSpecific,
        includeAlreadyUnlocked,
        ...(targetPlaytimeHours ? { targetPlaytimeHours } : {})
      });
      renderSchedulePreviewBox(res, box, true);
      return;
    } catch (e) {
      box.replaceChildren(element('p', '⚠️ ' + e.message, 'pioneer-card-desc'));
      return;
    }
  }

  box.replaceChildren(element('p', '⏳ Calculando cronograma de platinador legal según la dificultad de cada logro…', 'pioneer-card-desc'));
  try {
    const res = await api('/api/achievement/timed', {
      accountId: activeAccountId,
      appid,
      action: 'preview',
      spacing: 'platinum',
      order: 'progression',
      pacingMode: pace,
      skipDateSpecific,
      bulkAction: 'unlock_all'
    });
    renderSchedulePreviewBox(res, box, false);
  } catch (e) {
    box.replaceChildren(element('p', e.message, 'pioneer-card-desc'));
  }
}

async function cloneDashboardDonorProfile() {
  const source = ($('schedDonorProfileInput')?.value || '').trim();
  const urlAppId = extractAppIdFromDonorUrl(source);
  if (urlAppId) ensureSchedGameSelectAppId(urlAppId);
  const appid = Number($('schedDashboardGameSelect')?.value || urlAppId || 0);
  const skipDateSpecific = $('schedSkipDateSpecificToggle') ? Boolean($('schedSkipDateSpecificToggle').checked) : true;
  const includeAlreadyUnlocked = Boolean($('schedIncludeUnlockedToggle')?.checked);
  const targetPlaytimeHours = Number($('schedTargetPlaytimeInput')?.value || 0) || null;
  if (!activeAccountId) return notice(t('liveActionNotice'));
  if (!appid) return notice('Elegí un juego de la lista primero.');
  if (!source) return notice('Pegá el link del perfil de SteamHunters, SteamCommunity o SteamID64 arriba, o tocá Auto-Programar con IA Legal.');

  const btn = $('schedCloneDonorBtn');
  const fb = $('schedDashboardFeedback');
  const box = $('schedPreviewBox');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Clonando sesiones y Playtime del donante…'; }
    const res = await api('/api/achievement/copy-timings', {
      accountId: activeAccountId,
      appid,
      source,
      realisticDonor: true,
      skipDateSpecific,
      includeAlreadyUnlocked,
      ...(targetPlaytimeHours ? { targetPlaytimeHours } : {})
    });
    if (fb && res?.message) fb.textContent = '✅ ' + res.message;
    if (box) renderSchedulePreviewBox(res, box, true);
    notice(res?.message || 'Perfil clonado y programado con éxito.');
    await loadStatus();
  } catch (e) {
    if (fb) fb.textContent = '⚠️ ' + e.message;
    notice(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧬 Clonar Perfil Pegado'; }
  }
}

async function startDashboardSchedule() {
  const appid = Number($('schedDashboardGameSelect')?.value || 0);
  const pace = $('schedDashboardPaceSelect')?.value || 'legal_completionist';
  const skipDateSpecific = $('schedSkipDateSpecificToggle') ? Boolean($('schedSkipDateSpecificToggle').checked) : true;
  if (!activeAccountId) return notice(t('liveActionNotice'));
  if (!appid) return notice('Elegí un juego de la lista primero.');

  const btn = $('schedStartDashboardBtn');
  const fb = $('schedDashboardFeedback');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Activando programación legal…'; }
    const res = await api('/api/achievement/timed', {
      accountId: activeAccountId,
      appid,
      spacing: 'platinum',
      order: 'progression',
      pacingMode: pace,
      skipDateSpecific,
      bulkAction: 'unlock_all'
    });
    if (fb && res?.message) fb.textContent = `✅ ${res.message}`;
    notice(res?.message || 'Programación legal activada.');
    await loadStatus();
    await previewDashboardSchedule();
  } catch (e) {
    if (fb) fb.textContent = `⚠️ ${e.message}`;
    notice(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Auto-Programar sin Link (IA Legal)'; }
  }
}

if ($('heroCarouselPrev')) $('heroCarouselPrev').addEventListener('click', () => stepHeroCarousel(-1));
if ($('heroCarouselNext')) $('heroCarouselNext').addEventListener('click', () => stepHeroCarousel(1));
if ($('schedPreviewQueueBtn')) $('schedPreviewQueueBtn').addEventListener('click', () => previewDashboardSchedule());
if ($('schedStartDashboardBtn')) $('schedStartDashboardBtn').addEventListener('click', () => startDashboardSchedule());
if ($('schedDonorProfileInput')) {
  $('schedDonorProfileInput').addEventListener('paste', () => {
    setTimeout(() => previewDashboardSchedule(), 40);
  });
  $('schedDonorProfileInput').addEventListener('change', () => previewDashboardSchedule());
}
if ($('schedIncludeUnlockedToggle')) {
  $('schedIncludeUnlockedToggle').addEventListener('change', () => previewDashboardSchedule());
}
if ($('schedTargetPlaytimeInput')) {
  $('schedTargetPlaytimeInput').addEventListener('change', () => previewDashboardSchedule());
}
if ($('modalTargetPlaytimeInput')) {
  $('modalTargetPlaytimeInput').addEventListener('change', () => { if (($('copyTimingsSourceInput')?.value || '').trim()) copyUserTimings(true); });
}
if ($('modalIncludeUnlockedToggle')) {
  $('modalIncludeUnlockedToggle').addEventListener('change', () => {
    if (($('copyTimingsSourceInput')?.value || '').trim()) copyUserTimings(true);
  });
}
if ($('copyTimingsSourceInput')) {
  $('copyTimingsSourceInput').addEventListener('paste', () => {
    setTimeout(() => {
      if (typeof window.testUI === 'undefined' && ($('copyTimingsSourceInput')?.value || '').trim()) copyUserTimings(true);
    }, 40);
  });
}
if ($('schedOpenGameModalBtn')) $('schedOpenGameModalBtn').addEventListener('click', () => {
  const appid = Number($('schedDashboardGameSelect')?.value || 0);
  if (!appid) return notice('Elegí un juego primero.');
  const title = active?.gameNames?.[appid] || `AppID ${appid}`;
  openAchModal(appid, title, false, active?.connected ? 'auto' : 'web', 'achievements');
});


/* ==========================================================================
   v64 — Multi-User Isolation Controls, Quick Relic Chips, Platinum Radar & Autopilot
   ========================================================================== */

for (const chip of document.querySelectorAll('.relic-quick-chip[data-relic-id]')) {
  chip.addEventListener('click', () => {
    const id = Number(chip.dataset.relicId);
    const name = chip.dataset.relicName || `AppID ${id}`;
    if (id > 0) addGame(id, name);
  });
}

if ($('btnAddAllValveRelicsQuick')) {
  $('btnAddAllValveRelicsQuick').addEventListener('click', () => {
    farmExclusiveRelics('all');
  });
}

if ($('ownerUnlockNavBtn')) {
  $('ownerUnlockNavBtn').addEventListener('click', () => {
    if ($('lockModal')) {
      $('lockModal').style.setProperty('display', 'flex', 'important');
      $('pinInput')?.focus();
    }
  });
}

if ($('browserLogoutNavBtn')) {
  $('browserLogoutNavBtn').addEventListener('click', async () => {
    try {
      await api('/api/panel/logout', {});
      activeAccountId = '';
      active = null;
      accounts = [];
      await checkAuth();
      notice('Cerraste sesión en este navegador. Tu bot sigue funcionando en la nube.');
    } catch (e) {
      notice(e.message);
    }
  });
}

function renderPlatinumRadar(account) {
  const listEl = $('platinumRadarList');
  const badgeEl = $('platinumRadarCountBadge');
  if (!listEl) return;
  if (!account) {
    listEl.replaceChildren();
    return;
  }
  const games = Array.isArray(account.games) ? account.games : [];
  const timedMap = new Map((account.activeTimedJobs || []).map(j => [Number(j.appid), j]));
  if (badgeEl) {
    badgeEl.textContent = `${games.length} juegos auditados`;
  }
  if (!games.length) {
    listEl.replaceChildren(element('div', 'Agregá juegos arriba para escanear su progreso al 100% y validez en SteamHunters.', 'sched-empty-state'));
    return;
  }

  const rows = [];
  for (const id of games.slice(0, 6)) {
    const numId = Number(id);
    const title = account.gameNames?.[numId] || `AppID ${numId}`;
    const job = timedMap.get(numId);
    const cached = achCache.get(`${account.id}:${numId}`);
    let statusStr = '✅ Sin ráfagas SAM · Listo para curva SteamHunters';
    let pctVal = null;
    if (job) {
      pctVal = job.totalCount ? Math.round((job.completedCount / job.totalCount) * 100) : 0;
      statusStr = `⏱️ En cola SteamHunters: ${job.completedCount}/${job.totalCount} (${pctVal}%)`;
    } else if (cached?.achievements?.length) {
      const done = cached.achievements.filter(a => a.unlocked === true).length;
      const tot = cached.achievements.length;
      pctVal = Math.round((done / tot) * 100);
      statusStr = `${done}/${tot} logros (${pctVal}%) · Orden de obtención verificado`;
    }

    const row = element('div', undefined, 'platinum-radar-row');
    const info = element('div', undefined, 'platinum-radar-info');
    info.append(
      element('strong', `${title} (#${numId})`),
      element('small', statusStr)
    );
    const actions = element('div', undefined, 'sam-row-actions');
    actions.append(
      button('⏱️ Programar', () => openSchedulerForGame(numId), 'btn-action-sm sam-quick-btn'),
      button('🏆 Logros', () => openAchModal(numId, title, false, account.connected ? 'auto' : 'web', 'achievements'), 'btn-action-sm sam-quick-btn')
    );
    row.append(info, actions);
    rows.push(row);
  }
  listEl.replaceChildren(...rows);
}

if ($('saveAutopilotRulesBtn')) {
  $('saveAutopilotRulesBtn').addEventListener('click', async () => {
    if (!activeAccountId) return notice(t('liveActionNotice'));
    try {
      const res = await api('/api/account/autopilot-rules', {
        accountId: activeAccountId,
        autoRotateAtHours: Number($('autopilotRotateHoursSelect')?.value || 0),
        minHoursBeforePlatinum: Number($('autopilotMinHoursSelect')?.value || 0),
        dynamicStatusRotator: Boolean($('autopilotDynamicStatusToggle')?.checked)
      });
      notice(res?.message || 'Reglas de Piloto Automático activadas.');
      await loadStatus();
    } catch (e) {
      notice(e.message);
    }
  });
}

for (const cardBtn of document.querySelectorAll('.sched-mode-card[data-sched-mode]')) {
  cardBtn.addEventListener('click', () => {
    const mode = cardBtn.dataset.schedMode || 'legal_completionist';
    for (const b of document.querySelectorAll('.sched-mode-card')) {
      b.classList.toggle('active', b === cardBtn);
    }
    if ($('schedDashboardPaceSelect')) $('schedDashboardPaceSelect').value = mode;
    previewDashboardSchedule();
  });
}
if ($('schedDashboardGameSelect')) {
  $('schedDashboardGameSelect').addEventListener('change', () => {
    updateSchedBannerForApp(Number($('schedDashboardGameSelect').value || 0));
    previewDashboardSchedule();
  });
}
if ($('schedSkipDateSpecificToggle')) {
  $('schedSkipDateSpecificToggle').addEventListener('change', () => previewDashboardSchedule());
}


if ($('btnPreviewDonorModal')) {
  $('btnPreviewDonorModal').addEventListener('click', () => previewModalSchedule());
}
if ($('schedCloneDonorBtn')) {
  $('schedCloneDonorBtn').addEventListener('click', () => cloneDashboardDonorProfile());
}
for (const mCard of document.querySelectorAll('.modal-sched-mode-card[data-modal-mode]')) {
  mCard.addEventListener('click', () => {
    const mode = mCard.dataset.modalMode || 'legal_completionist';
    for (const b of document.querySelectorAll('.modal-sched-mode-card')) {
      b.classList.toggle('active', b === mCard);
    }
    setPlatinumPacingMode(mode);
    if (typeof window.testUI === 'undefined') previewModalSchedule();
  });
}
if ($('modalSkipDateSpecificToggle')) {
  $('modalSkipDateSpecificToggle').addEventListener('change', () => {
    if (typeof window.testUI === 'undefined') previewModalSchedule();
  });
}


/* ==========================================================================
   v70 — Direct Steam Login Hero Panel + Native Steam QR Code Authentication
   ========================================================================== */

let autoQrStartedForGuest = false;

async function startSteamQrSession(targetContainerId = 'quickQrCanvasBox') {
  const serial = ++loginSerial;
  loginPollTransientErrors = 0;
  const qrBox = $(targetContainerId);
  if (qrBox) {
    delete qrBox.dataset.lastQrUrl;
    qrBox.replaceChildren(element('div', '⏳ Generando código QR oficial de Steam…', 'qr-placeholder'));
  }
  if ($('quickQrStatusText')) $('quickQrStatusText').textContent = 'Conectando con Steam…';
  if ($('steamLoginMessage') && targetContainerId === 'modalQrImageWrap') {
    $('steamLoginMessage').textContent = 'Generando código QR oficial de Steam…';
  }
  try {
    const labelName = ($('quickLoginLabel')?.value || $('newAccName')?.value || '').trim();
    const data = await api('/api/steam/qr-login', { method: 'qr', name: labelName, accountId: loginTarget });
    if (serial !== loginSerial) {
      try { await api('/api/steam/cancel', { attemptId: data.attemptId }); } catch {}
      return;
    }
    loginAttempt = data.attemptId;
    handleLogin(data);
  } catch (e) {
    if (serial !== loginSerial) return;
    if (qrBox) qrBox.replaceChildren(element('div', `⚠️ ${e.message || 'No se pudo generar el QR'}`, 'qr-placeholder'));
    if ($('quickQrStatusText')) $('quickQrStatusText').textContent = 'Tocá Generar QR para reintentar';
    if ($('steamLoginMessage') && targetContainerId === 'modalQrImageWrap') $('steamLoginMessage').textContent = e.message;
  }
}

async function submitQuickInlineLogin() {
  const user = ($('quickLoginUser')?.value || '').trim();
  const password = $('quickLoginPassword')?.value || '';
  const name = ($('quickLoginLabel')?.value || '').trim();
  if (!user || !password) {
    if ($('quickLoginStatusMsg')) $('quickLoginStatusMsg').textContent = 'Ingresá tu usuario y contraseña de Steam, o escaneá el código QR a la derecha.';
    return;
  }
  const serial = ++loginSerial;
  loginPollTransientErrors = 0;
  if ($('btnQuickLoginSubmit')) $('btnQuickLoginSubmit').disabled = true;
  if ($('quickLoginStatusMsg')) $('quickLoginStatusMsg').textContent = 'Conectando con Steam…';
  try {
    const payload = { name: name || user, user, password, accountId: null };
    if ($('quickLoginPassword')) $('quickLoginPassword').value = '';
    const data = await api('/api/steam/login', payload);
    delete payload.password;
    if (serial !== loginSerial) {
      try { await api('/api/steam/cancel', { attemptId: data.attemptId }); } catch {}
      return;
    }
    loginAttempt = data.attemptId;
    handleLogin(data);
  } catch (e) {
    if (serial !== loginSerial) return;
    if ($('quickLoginStatusMsg')) $('quickLoginStatusMsg').textContent = e.message;
    if ($('btnQuickLoginSubmit')) $('btnQuickLoginSubmit').disabled = false;
  }
}

async function submitQuickGuardCode() {
  const id = loginAttempt;
  if (!id) return;
  const code = ($('quickGuardCodeInput')?.value || '').trim();
  if (!code) return;
  try {
    if ($('quickGuardCodeInput')) $('quickGuardCodeInput').value = '';
    handleLogin(await api('/api/steam/guard', { attemptId: id, code }));
  } catch (e) {
    if ($('quickLoginStatusMsg')) $('quickLoginStatusMsg').textContent = e.message;
    notice(e.message);
  }
}

function switchAuthModalTab(mode = 'credentials') {
  const isQr = mode === 'qr';
  if ($('modalTabCredentialsBtn')) $('modalTabCredentialsBtn').classList.toggle('active', !isQr);
  if ($('modalTabQrBtn')) $('modalTabQrBtn').classList.toggle('active', isQr);
  if ($('modalCredentialsBox')) $('modalCredentialsBox').hidden = isQr;
  if ($('modalCredentialsFooter')) $('modalCredentialsFooter').style.display = isQr ? 'none' : 'flex';
  if ($('modalQrBox')) $('modalQrBox').hidden = !isQr;
  if (isQr) {
    startSteamQrSession('modalQrImageWrap');
  }
}

if ($('btnQuickLoginSubmit')) $('btnQuickLoginSubmit').addEventListener('click', () => submitQuickInlineLogin());
if ($('quickLoginPassword')) $('quickLoginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitQuickInlineLogin(); });
if ($('btnQuickGuardSubmit')) $('btnQuickGuardSubmit').addEventListener('click', () => submitQuickGuardCode());
if ($('quickGuardCodeInput')) $('quickGuardCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitQuickGuardCode(); });
if ($('btnStartQuickQr')) $('btnStartQuickQr').addEventListener('click', () => startSteamQrSession('quickQrCanvasBox'));
if ($('modalTabCredentialsBtn')) $('modalTabCredentialsBtn').addEventListener('click', () => switchAuthModalTab('credentials'));
if ($('modalTabQrBtn')) $('modalTabQrBtn').addEventListener('click', () => switchAuthModalTab('qr'));
if ($('btnRefreshModalQr')) $('btnRefreshModalQr').addEventListener('click', () => startSteamQrSession('modalQrImageWrap'));
if ($('cancelAddAccBtn')) $('cancelAddAccBtn').addEventListener('click', () => closeAddAccModal());

if ($('newAccPassword')) $('newAccPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitAddAccount(); });
if ($('newAccUser')) $('newAccUser').addEventListener('keydown', e => { if (e.key === 'Enter' && $('newAccPassword')?.value) submitAddAccount(); });

if (typeof document?.querySelectorAll === 'function' && typeof window.testUI === 'undefined') {
  ['scheduledAchievementsPanel', 'automationsPanel', 'overwatch2003Panel', 'cardsPanel', 'badgeCrafterSection'].forEach(id => {
    const el = $(id);
    if (el) el.open = false;
  });
  document.querySelectorAll('.quick-presets, .advanced-settings').forEach(el => {
    el.open = false;
  });
  document.querySelectorAll('.apple-menubar-links a.apple-menu-link[href^="#"]').forEach(link => {
    link.addEventListener('click', () => {
      const targetId = (link.getAttribute('href') || '').slice(1);
      const targetEl = targetId ? $(targetId) : null;
      if (targetEl && targetEl.tagName === 'DETAILS') {
        targetEl.open = true;
      }
    });
  });
}

if ($('overwatchScreenshotTagPresetSelect') && $('overwatchScreenshotCustomTagInput')) {
  $('overwatchScreenshotTagPresetSelect').addEventListener('change', () => {
    $('overwatchScreenshotCustomTagInput').style.display = $('overwatchScreenshotTagPresetSelect').value === 'custom' ? 'block' : 'none';
  });
}

