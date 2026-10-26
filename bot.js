'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const SteamUser = require('steam-user');
if (SteamUser && SteamUser.prototype) {
  if (typeof SteamUser.prototype.webLogOn === 'function' && !SteamUser.prototype.webLogOn._sfSafeWrapped) {
    const origProtoWebLogOn = SteamUser.prototype.webLogOn;
    const safeProtoWebLogOn = function (...args) {
      if (!this.steamID) return;
      try {
        const r = origProtoWebLogOn.apply(this, args);
        if (r && typeof r.catch === 'function') r.catch(() => {});
        return r;
      } catch (err) {
        console.warn(`[Steam] Ignored webLogOn after disconnect: ${err?.message || err}`);
      }
    };
    safeProtoWebLogOn._sfSafeWrapped = true;
    SteamUser.prototype.webLogOn = safeProtoWebLogOn;
  }
  if (typeof SteamUser.prototype._handleLogOnResponse === 'function' && !SteamUser.prototype._handleLogOnResponse._sfSafeWrapped) {
    const origProtoHandleLogOn = SteamUser.prototype._handleLogOnResponse;
    const safeProtoHandleLogOn = function (...args) {
      try {
        const r = origProtoHandleLogOn.apply(this, args);
        if (r && typeof r.catch === 'function') {
          return r.catch(err => {
            console.warn(`[Steam] Ignored async _handleLogOnResponse race: ${err?.message || err}`);
          });
        }
        return r;
      } catch (err) {
        console.warn(`[Steam] Ignored sync _handleLogOnResponse race: ${err?.message || err}`);
      }
    };
    safeProtoHandleLogOn._sfSafeWrapped = true;
    SteamUser.prototype._handleLogOnResponse = safeProtoHandleLogOn;
  }
}
const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType } = require('steam-session');
const { atomicWrite, appId, hour, sleepNow, hashPassword, verifyPassword, Vault, validClientToken } = require('./lib/core');
const {
  readProtocol,
  parseSnapshot,
  requestSnapshot,
  libraryCorroborates,
  parseGameStats,
  writeGameStats,
  exportGameData,
  computeAchievementAnalytics,
  parseExternalUserTimings,
  classifyProgressionPhase,
  sortAchievementsByProgression,
  buildRealisticPlatinumSchedule,
  TimedModificationManager,
  findOrListLeaderboards,
  getLeaderboardEntries,
  uploadLeaderboardScore,
  fetchUnownedGameSchema,
  getLivePlayerCount,
  DEFAULT_32_FREE_APPIDS,
  claimFreeLicenses,
  toggleAppsPrivacy,
  uploadRichPresence,
  fetchSteamPointsSummary,
  fetchTotalCardsEarned
} = require('./lib/steam-protocol');
const { TARGET, unlockModelMania } = require('./lib/achievement-experiment');
const { unlockAchievement, prepare, prepareShared, prepareFloat, applyChanges, store } = require('./lib/achievement-writer');
const {AchievementOperations,cleanOperation}=require('./lib/achievement-operations');
const {selection:changeSelection,buildBulkSelection,prepareChanges}=require('./lib/achievement-changes');
const { gameRequirements } = require('./lib/game-requirements');
const { scanCandidates } = require('./lib/achievement-candidates');
const { runReadOnlyProbes,runSharedImpactProbes } = require('./lib/achievement-probes');
const {AchievementJournal}=require('./lib/achievement-journal');
const {AppState}=require('./lib/app-state');
const {sharedPreview,floatPreview}=require('./lib/achievement-progress');
const {ownedFloatLibrary,scanFloatBatch}=require('./lib/float-discovery');
const { ResultCache } = require('./lib/cache');
const {ResourceBudget}=require('./lib/resources');
const {createPercentageReader}=require('./lib/rarity-history');
const {revisionFor,changesBetween}=require('./lib/achievement-sync');
const { remote, achievements, parseCards, parseCraftableBadges, craftSteamBadge, estimateCardBatchNet, DEMO_CATALOG, fetchPublicDemoAchievements, exploreDiscoveryQueue, fetchSellableCards, quickSellCards, fetchHowLongToBeat } = require('./lib/steam-data');
const {
  RELIC_OFFICIAL_NAMES,
  safeSteamFetch,
  setProfileShowcaseSlotServerSide,
  fillCollectorShowcaseWithRelics,
  injectUcmScreenshotServerSide,
  executePioneerExploitServerSide,
  patchPngForInfiniteHeight,
  patchWorkshopHex21,
  MarketSniperService,
  AlchemyTransmuter,
  LevelOptimizer
} = require('./lib/rea-overwatch-2003');

const PRESETS = {
  relics: { name: 'Valve Exclusivos (202352 Beta Cromos, 753, 7, 92, 766...)', games: [202352, 753, 7, 92, 766, 765, 202351, 248210, 1675200, 1059530, 353380, 353370, 250820, 340, 211, 480, 8, 760, 767, 761] },
  competitive: { name: 'Competitive', games: [730, 440, 570, 252490, 1172470, 578080] },
  valve: { name: 'Valve Classics', games: [10, 240, 220, 550, 620] },
  aaa: { name: 'AAA Hits', games: [271590, 1938090, 1091500, 292030, 379720] }
};
const WRITE_UNAVAILABLE = 'This legacy route cannot change achievements. Use the dashboard to review and confirm a concrete selection.';
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function text(value, max = 128) {
  if (typeof value !== 'string' || value.length > max) throw fail('Invalid or overly long text.');
  return value.trim();
}
function createApp(options = {}) {
  const directory = options.directory || process.env.DATA_DIR || path.join(__dirname, 'data');
  const configFile = path.join(directory, 'config.json');
  const template = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const cfg = options.config || (fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : structuredClone(template));
  cfg.accounts ||= []; cfg.timezone ||= 'America/Montevideo';
  new Intl.DateTimeFormat('en', { timeZone: cfg.timezone });
  const environmentToken = process.env.STEAM_REFRESH_TOKEN || '';
  const environmentAccountId = process.env.STEAM_ACCOUNT_ID || 'main';
  if (environmentToken && !validClientToken(environmentToken)) throw new Error('STEAM_REFRESH_TOKEN is invalid or has expired.');
  if (environmentToken && !cfg.accounts.some(acc => acc.id === environmentAccountId)) cfg.accounts.push({ id: environmentAccountId, name: 'Main account', user: '', games: [], gameNames: {}, personaState: 1 });
  const isEnvironmentAccount = acc => Boolean(environmentToken && acc.id === environmentAccountId);
  const vault = new Vault(directory);
  const isAuthorizedAccount = acc => Boolean(acc && (isEnvironmentAccount(acc) || vault.records?.[acc.id]));
  if(options.restoredTokens){vault.records={};for(const [id,token]of Object.entries(options.restoredTokens))vault.set(id,token);atomicWrite(vault.file,vault.records);}
  const persistence=options.persistence;
  if(persistence)cfg.persistenceCheckpoint ||= crypto.randomUUID();
  const save = () => {persistence?.assert();atomicWrite(configFile, cfg);persistence?.save(cfg,vault);};
  // Migrate runtime credentials away from config; never persist passwords or local achievement overlays.
  if (!cfg.accounts.length && cfg.user) cfg.accounts.push({ id: crypto.randomUUID(), name: cfg.user, user: cfg.user, games: cfg.games || [], gameNames: cfg.gameNames || {}, refreshToken: cfg.refreshToken });
  for (const acc of cfg.accounts) {
    acc.games = [...new Set((acc.games || []).map(appId))].slice(0, 32); acc.gameNames ||= {};
    acc.sleepMode ||= { enabled: false, start: 3, end: 8 }; acc.chatAdmins ||= []; acc.personaState = acc.personaState === 7 ? 7 : 1;
    if (acc.personaState !== 7) { acc.stealthFarming = false; acc.privateApps = false; }
    if (acc.refreshToken && validClientToken(acc.refreshToken)) vault.set(acc.id, acc.refreshToken);
    delete acc.refreshToken; delete acc.pass; delete acc.unlockedAchievements; delete acc.achievementQueue;
  }
  for (const field of ['user', 'pass', 'refreshToken', 'webPin', 'activeAccountId', 'games', 'gameNames', 'unlockedAchievements', 'achievementQueue']) delete cfg[field];
  if (!cfg.panelAuth) {
    const password = process.env.PANEL_PASSWORD || crypto.randomBytes(18).toString('base64url');
    if (password.length < 12 || password.length > 256) throw new Error('PANEL_PASSWORD must contain 12 to 256 characters.');
    cfg.panelAuth = hashPassword(password);
    if (!process.env.PANEL_PASSWORD && !options.silent) console.log(`Initial dashboard password (save it): ${password}`);
  }
  save();
  vault.onChange=save;
  const journal=options.achievementJournal || new AchievementJournal({cfg,save,url:process.env.ACHIEVEMENT_DATABASE_URL||''});
  const operations=options.operationsJournal||new AchievementOperations(journal);
  journal.ready().then(()=>{if(!options.silent)console.log('[Achievement journal] '+JSON.stringify(journal.status()));}).catch(()=>{if(!options.silent)console.log('[Achievement journal] Persistent history unavailable; activation is blocked.');});
  const sessions = new Map(), attempts = new Map(), rates = new Map(), clients = new Map(), states = new Map(), lastOperations = new Map();
  const User = options.SteamUser || SteamUser;
  const Session = options.LoginSession || LoginSession;
  const steamRead = options.achievements || achievements;
  const protocolRead = options.protocolReader || readProtocol;
  const progressSnapshotRead=options.progressSnapshotReader || requestSnapshot;
  const experimentWrite = options.experimentWriter || unlockModelMania;
  const individualWrite = options.individualWriter || unlockAchievement;
  const changesWrite=options.changesWriter||applyChanges;
  const statsWrite = options.statsWriter || ((client, id, changes, opts) => writeGameStats(client, id, changes, { read: progressSnapshotRead, send: store, ...opts }));
  const discoveryRun = options.discoveryQueueRunner || exploreDiscoveryQueue;
  const cardsInventoryRead = options.cardsInventoryReader || fetchSellableCards;
  const cardsQuickSell = options.cardsQuickSeller || quickSellCards;
  const badgeCraft = options.badgeCrafter || craftSteamBadge;
  const demoAchievementsRead = options.demoAchievementsReader || fetchPublicDemoAchievements;
  const timedManager = new TimedModificationManager({
    pool: options.timedPool || journal.pool || null,
    file: path.join(directory, 'timed-jobs.json'),
    ...(Array.isArray(options.timedRetryDelaysMs) ? { retryDelaysMs: options.timedRetryDelaysMs } : {}),
    onScheduleChange: accountId => {
      const acc = cfg.accounts.find(a => a.id === accountId);
      if (acc) farming(acc, true);
    }
  });
  function buildProgressBar(completed, total, width = 12) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeDone = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
    const filled = Math.round((safeDone / safeTotal) * width);
    const pct = Math.round((safeDone / safeTotal) * 100);
    return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))} ${safeDone}/${safeTotal} (${pct}%)`;
  }
  function rarityMeta(percent) {
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return { label: 'Unknown', color: 0x64748b };
    if (percent < 5) return { label: 'Mythic / Legendary', color: 0xf59e0b };
    if (percent < 20) return { label: 'Epic', color: 0xa855f7 };
    if (percent <= 50) return { label: 'Rare', color: 0x38bdf8 };
    return { label: 'Common', color: 0x10b981 };
  }
  function makeTimedItemExecutor(accountId, id, stealth = false) {
    return async item => {
      const acc = cfg.accounts.find(a => a.id === accountId);
      if (!acc) throw fail('Steam disconnected.');
      let st = stateFor(accountId), client = clients.get(accountId), identity = client?.steamID?.toString();
      if ((!st.connected || !client || !identity) && !options.silent) {
        for (let w = 0; w < 24 && !closing; w++) {
          await new Promise(r => setTimeout(r, 500));
          st = stateFor(accountId); client = clients.get(accountId); identity = client?.steamID?.toString();
          if (st.connected && client && identity) break;
        }
      }
      if (!st.connected || !client || !identity) throw fail('Steam disconnected.');
      if (!stealth && !st.isCollisionPaused && !st.isSleepPaused && Array.isArray(st.playedGames) && !st.playedGames.includes(id)) {
        try { farming(acc, true); } catch {}
      }
      const [snap, recs] = await Promise.all([progressSnapshotRead(client, id), operations.latest(identity, id)]);
      const view = parseSnapshot(snap, id);
      const currentAch = view.achievements.find(a => a.apiname === item.apiname);
      if (item.action === 'unlock' && currentAch?.unlocked === true) {
        console.log(`[TimedExecutor] Achievement ${item.apiname} on ${id} is ALREADY UNLOCKED. Skipping write.`);
        return;
      }
      if (item.action === 'remove' && currentAch?.unlocked === false) {
        console.log(`[TimedExecutor] Achievement ${item.apiname} on ${id} is ALREADY LOCKED. Skipping write.`);
        return;
      }
      const singleSel = [{ apiname: item.apiname, action: item.action }];
      const plan = prepareChanges(snap, id, singleSel, recs, undefined, { bulk: true, resetCounters: item.action === 'remove', allowRetoggle: true });
      const hasSchema = await operations.schema();
      const r = await changesWrite(client, id, singleSel, { expectedRevision: plan.revision, bulk: true, resetCounters: item.action === 'remove', allowRetoggle: true, overrideCooldown: true, stealth: Boolean(stealth), readHistory: () => operations.latest(identity, id), beforeSend: async p => hasSchema ? operations.reserve(identity, p, { overrideCooldown: true }) : cleanOperation({ ...p, operationId: crypto.randomUUID(), checkedAt: new Date().toISOString(), outcome: 'requested' }) });
      if (hasSchema) try { await operations.finish(identity, r); } catch {}
      try {
        const achRow = view.achievements.find(a => a.apiname === item.apiname);
        const pctCached = percentageCache.get(String(id) + ':api') || percentageCache.get(String(id) + ':titles');
        const pct = pctCached?.percentages?.[item.apiname] ?? achRow?.percent ?? null;
        const rMeta = rarityMeta(pct);
        const jobStatus = timedManager.status(accountId, id);
        const doneNow = (jobStatus.completedCount || 0) + 1;
        const totalNow = jobStatus.totalCount || 1;
        const gameTitle = acc.gameNames?.[id] || `AppID ${id}`;
        const iconUrl = achRow?.iconOpen && /^https:\/\//i.test(achRow.iconOpen) ? achRow.iconOpen : undefined;
        emitAchievementUnlockedEvent({
          accountId,
          appid: id,
          apiname: item.apiname,
          name: achRow?.name || item.apiname,
          description: achRow?.description || '',
          iconUrl: iconUrl || '',
          gameTitle,
          action: item.action
        });
        notify(
          `${item.action === 'remove' ? '🔒 Achievement Locked' : '🏆 Achievement Unlocked'} · ${gameTitle}`,
          `**${achRow?.name || item.apiname}**${achRow?.description ? `\n${achRow.description}` : ''}`,
          {
            color: rMeta.color,
            ...(iconUrl ? { thumbnail: { url: iconUrl } } : {}),
            fields: [
              { name: 'Rarity', value: `${rMeta.label}${pct !== null ? ` (${Number(pct).toFixed(1)}%)` : ''}`, inline: true },
              { name: 'Task Progress', value: buildProgressBar(doneNow, totalNow), inline: true }
            ]
          }
        );
      } catch {}
      st.webSessionVersion++; achievementCache.clear(); farming(acc, true);
    };
  }
  journal.ready().then(() => {
    if (journal.pool && !timedManager.pool) timedManager.setPool(journal.pool);
    return timedManager.rehydrate({
      executeItemFactory: (accId, appid, jobCfg) => makeTimedItemExecutor(accId, appid, Boolean(jobCfg?.stealth)),
      isCollisionPaused: accId => Boolean(stateFor(accId).isCollisionPaused)
    });
  }).catch(() => {});
  const requirementsRead = options.requirementsReader || gameRequirements;
  const percentagesRead=options.percentagesReader||createPercentageReader();
  const requirementsCache = new ResultCache({maxEntries:32,maxBytes:128*1024,ttl:3600000}),requirementsPending=new Map();
  const experimentBusy = new Set();
  const achievementCache = new ResultCache({maxBytes:2*1024*1024,maxEntries:24}), achievementPending = new Map();
  const floatLibraryCache=new ResultCache({maxBytes:256*1024,maxEntries:3,ttl:1800000});
  const budget=options.resourceBudget||new ResourceBudget();
  const startupDiagnostics=options.startupDiagnostics??(process.env.STEAM_STARTUP_DIAGNOSTICS==='1');
  const namePending=new Map();
  const percentageCache=new ResultCache({maxBytes:256*1024,maxEntries:16,ttl:3600000}),percentagePending=new Map();
  const donorFetchCache=new ResultCache({maxBytes:512*1024,maxEntries:16,ttl:5*60000});
const staticFiles = new Map(Object.entries({ '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/achievement-live.js': ['achievement-live.js','text/javascript'], '/draft-settings.js': ['draft-settings.js','text/javascript'], '/achievement-availability.js': ['achievement-availability.js', 'text/javascript'], '/achievement-rarity.js': ['achievement-rarity.js', 'text/javascript'], '/manifest.json': ['manifest.json', 'application/json'], '/style.css': ['style.css', 'text/css'], '/logo.svg': ['logo.svg', 'image/svg+xml'], '/favicon.ico': ['logo.svg', 'image/svg+xml'] }).map(([route, [file, type]]) => {
    const body = fs.readFileSync(path.join(__dirname, 'public', file));
    return [route, { body, type, etag: '"' + crypto.createHash('sha256').update(body).digest('hex') + '"' }];
  }));
  let closing = false;
  const sseListeners = new Set();
  const localBridgeListeners = new Set();
  let localBridgeLastHeartbeat = 0;
  function isLocalBridgeConnected() {
    return localBridgeListeners.size > 0 || (localBridgeLastHeartbeat > 0 && Date.now() - localBridgeLastHeartbeat < 60000);
  }
  function emitSseEvent(eventPayload) {
    if (!sseListeners.size) return;
    for (const listener of sseListeners) {
      try { listener(eventPayload); } catch {}
    }
  }
  function emitAchievementUnlockedEvent({ accountId, appid, apiname, name, description, iconUrl, gameTitle, action = 'unlock' } = {}) {
    emitSseEvent({
      type: 'achievement_unlocked',
      accountId: accountId || '',
      appid: Number(appid) || 0,
      apiname: String(apiname || ''),
      name: String(name || apiname || 'Steam Achievement'),
      description: String(description || ''),
      iconUrl: String(iconUrl || ''),
      gameTitle: String(gameTitle || `AppID ${appid}`),
      action: action === 'remove' ? 'remove' : 'unlock',
      timestamp: new Date().toISOString()
    });
  }
  const ownerCookieKey = crypto.createHash('sha256').update('sf-owner-isolation-v1:' + String(cfg.panelAuth || 'default')).digest();
  function signOwnedCookie(ownedSet, isAdmin = false) {
    const ids = [...new Set([...(ownedSet || [])].map(String).filter(Boolean))].slice(0, 16);
    const payload = Buffer.from(JSON.stringify({ ids, adm: Boolean(isAdmin) })).toString('base64url');
    const sig = crypto.createHmac('sha256', ownerCookieKey).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  function parseOwnedCookie(cookieHeader = '') {
    const m = String(cookieHeader || '').match(/(?:^|;\s*)sf_owned=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?:;|$)/);
    if (!m) return { ids: new Set(), isAdmin: false };
    const [payload, sig] = m[1].split('.');
    const expected = crypto.createHmac('sha256', ownerCookieKey).update(payload).digest('base64url');
    if (sig !== expected) return { ids: new Set(), isAdmin: false };
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return {
        ids: new Set(Array.isArray(parsed?.ids) ? parsed.ids.map(String) : []),
        isAdmin: Boolean(parsed?.adm)
      };
    } catch {
      return { ids: new Set(), isAdmin: false };
    }
  }
  function visibleAccountsForSession(sess) {
    if (!sess) return [];
    if (sess.isAdmin) return cfg.accounts;
    const owned = sess.ownedAccounts instanceof Set ? sess.ownedAccounts : new Set();
    return cfg.accounts.filter(a => owned.has(a.id));
  }
  function buildStatusPayload(sess = null) {
    const acctList = sess ? visibleAccountsForSession(sess) : [];
    return {
      accounts: acctList.map(publicAccount),
      isAdminSession: Boolean(sess?.isAdmin),
      totalServerAccounts: cfg.accounts.length,
      demoCatalog: DEMO_CATALOG,
      timezone: cfg.timezone,
      webhookConfigured: Boolean(cfg.discordWebhook),
      localBridgeConnected: isLocalBridgeConnected(),
      presets: Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, count: p.games.length })),
      achievementHistoryStorage: journal.status(),
      achievementProbes: stateFor(environmentAccountId).achievementProbes || null,
      achievementCandidates: stateFor(environmentAccountId).achievementCandidates || null,
      achievementPersistence: stateFor(environmentAccountId).achievementPersistence || null,
      capabilities: { achievementRead: true, achievementWrite: true, achievementWriteMode: 'individual_and_reviewed', achievementBatchWrite: true, achievementRemove: true, achievementSelectionLimit: 8192, achievementBulkUnlockAll: true, achievementBulkLockAll: true, achievementBulkLimit: 8192, sharedCounterPreview: true, sharedCounterWrite: true, statisticsRead: true, statisticsWrite: true, timedModifications: true, copyUserTimings: true, jsonImportExport: true, analyticsAndUndo: true, multiGameBulk: true }
    };
  }
  function emitStatusChange() {
    if (!sseListeners.size) return;
    try {
      for (const listener of sseListeners) {
        try { listener(); } catch {}
      }
    } catch {}
  }
  function stateFor(id) {
    if (!states.has(id)) states.set(id, { connected: false, isPaused: false, isFarming: false, isCollisionPaused: false, isSleepPaused: false, sessionStartTime: null, playedGames: [], inspectPreviousGames: null, inspectingAppId: null, cardDropGames: [], cardsReady: false, scanning: false, webCookies: '', webSessionVersion: 0, linkCheckStarted: false, lastWebRefresh: 0, profileName: '', tokenAccountMatches: false, steamId64: '', error: '', reconnectTimer: null, retryCount: 0 });
    const state=states.get(id);if(state.pausedInitialized!==true){state.isPaused=Boolean(cfg.accounts.find(a=>a.id===id)?.paused);state.pausedInitialized=true;}return state;
  }
  function syncSleep(acc) { const st = stateFor(acc.id); st.isSleepPaused = sleepNow(acc.sleepMode, acc.timezone || cfg.timezone); }
  function selectOptimalCardGames(cardDropGames, manualGames, st = null, acc = null) {
    const restingSet = new Set((acc?.id && typeof timedManager?.restingApps === 'function' ? timedManager.restingApps(acc.id) : []).map(Number));
    const excludedSet = new Set([...(Array.isArray(acc?.excludedCardApps) ? acc.excludedCardApps : []).map(Number), ...restingSet]);
    const cleanManual = (Array.isArray(manualGames) ? manualGames : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && !excludedSet.has(n));
    if (!Array.isArray(cardDropGames) || !cardDropGames.length) return cleanManual.slice(0, 32);
    const validDrops = cardDropGames.filter(
      g => g && Number.isInteger(Number(g.appid)) && Number(g.appid) > 0 && Number(g.remaining) > 0 && !excludedSet.has(Number(g.appid))
    );
    if (!validDrops.length) return cleanManual.slice(0, 32);
    const under2h = validDrops
      .filter(g => typeof g.hoursPlayed === 'number' && g.hoursPlayed < 2.0)
      .map(g => Number(g.appid));
    if (under2h.length > 0) {
      return [...new Set(under2h)].slice(0, 32);
    }
    const over2h = [...new Set(validDrops.map(g => Number(g.appid)))];
    const rot = Math.max(0, Number(st?.cardRotateIdx || 0)) % over2h.length;
    return [over2h[rot]];
  }
  function farming(acc, force = false) {
    if(persistence && !persistence.available)return;
    const st = stateFor(acc.id); syncSleep(acc);
    const client = clients.get(acc.id); if (!client) return;
    const restingSet = new Set((typeof timedManager.restingApps === 'function' ? timedManager.restingApps(acc.id) : []).map(Number));
    const excludedSet = new Set([...(Array.isArray(acc.excludedCardApps) ? acc.excludedCardApps : []).map(Number), ...restingSet]);
    const timedSyncApps = timedManager.activeNonStealthApps(acc.id);
    const manualGames = (acc.games || []).map(Number).filter(id => id > 0 && !excludedSet.has(id)).slice(0, 32);
    let games = [];
    if (timedSyncApps.length) {
      games = [...new Set(timedSyncApps)].slice(0, 32);
    } else if (acc.cardFarming) {
      if (!st.cardsReady && st.connected && st.webCookies && !st.scanning) {
        setImmediate(() => scan(acc).catch(() => {}));
      }
      games = selectOptimalCardGames(st.cardDropGames, manualGames, st, acc);
    } else {
      games = manualGames;
    }
    const collisionActive = !acc.ignoreSessionCollision && st.isCollisionPaused;
    if (st.inspectingAppId && st.connected && !st.isPaused && !collisionActive && !st.isSleepPaused) {
      const baseGames = Array.isArray(st.inspectPreviousGames) && st.inspectPreviousGames.length ? st.inspectPreviousGames : games;
      games = [st.inspectingAppId, ...baseGames.filter(x => x !== st.inspectingAppId)].slice(0, 32);
    }
    if (!st.connected || st.isPaused || collisionActive || st.isSleepPaused) games = [];
    const list = (!acc.cardFarming && st.ghostGameFirst && acc.customStatus)
      ? [acc.customStatus, ...games.slice(0, 31)]
      : [...games];
    if (!acc.cardFarming && !st.ghostGameFirst && games.length && acc.customStatus && list.length < 32) {
      list.push(acc.customStatus);
    }
    const now = Date.now();
    const needKeepalive = games.length > 0 && (now - (st.lastGamesPlayedSentAt || 0) >= 5 * 60000);
    if (!force && !needKeepalive && JSON.stringify(list) === JSON.stringify(st.playedGames)) return;
    try {
      if (games.length > 0 && st.connected && typeof client.setPersona === 'function') {
        client.setPersona(SteamUser.EPersonaState?.Online ?? 1);
      }
      client.gamesPlayed(list);
      st.playedGames = list;
      st.lastGamesPlayedSentAt = now;
      if (games.length && !st.isFarming) st.sessionStartTime = now;
      if (!games.length) st.sessionStartTime = null;
      st.isFarming = games.length > 0;
      if (games.length > 0 && st.connected) {
        const wantPrivateApps = Boolean(acc.personaState === 7 || acc.stealthFarming);
        const allKnownApps = [...new Set([295250, ...games, ...(acc.games || []), ...(st.cardDropGames || []).map(g => Number(g.appid))])].filter(x => Number.isInteger(x) && x > 0);
        const appKey = `${wantPrivateApps}:${allKnownApps.join(',')}`;
        if (allKnownApps.length && (force || st.lastAppliedAppPrivacyKey !== appKey)) {
          st.lastAppliedAppPrivacyKey = appKey;
          for (let i = 0; i < allKnownApps.length; i += 32) {
            toggleAppsPrivacy(client, allKnownApps.slice(i, i + 32), wantPrivateApps).catch(() => {});
          }
        }
      }
      emitStatusChange();
    } catch { st.isFarming = false; st.sessionStartTime = null; st.error = 'Could not update Steam activity.'; }
  }
  async function webhook(title, description, extraEmbed = {}, customWebhookUrl = '') {
    const targetUrl = customWebhookUrl || cfg.discordWebhook;
    if (!targetUrl) return;
    const embed = { color: 0x3b82f6, title, description, timestamp: new Date().toISOString(), footer: { text: 'SteamFarmer · Grupo Privado' }, ...extraEmbed };
    await remote(targetUrl, { method: 'POST', body: JSON.stringify({ username: 'SteamFarmer Cloud', embeds: [embed] }), maxBytes: 65536 });
  }
  function notify(title, description, extraEmbed = {}, acc = null) {
    webhook(title, description, extraEmbed, acc?.discordWebhook || '').catch(() => {});
  }
  let cardScanChain = Promise.resolve();
  function scan(acc) {
    const st = stateFor(acc.id);
    if (!st.connected || !st.webCookies || st.scanning) return Promise.resolve();
    const runTask = () => runSingleCardScan(acc);
    const next = cardScanChain.then(runTask, runTask);
    cardScanChain = next.catch(() => {});
    return next;
  }
  async function runSingleCardScan(acc) {
    const st = stateFor(acc.id);
    if (!st.connected || !st.webCookies || st.scanning) return;
    let release = () => {}; try { release = budget.acquire('small'); } catch {}
    st.scanning = true;
    const client = clients.get(acc.id);
    const current = () => !closing && cfg.accounts.includes(acc) && states.get(acc.id) === st && clients.get(acc.id) === client && st.connected && Boolean(st.webCookies) && acc.cardFarming;
    try {
      const previousDrops = new Map((st.cardDropGames || []).map(g => [g.appid, g]));
      const found = new Map(), craftableFound = new Map();
      let pagesScanned = 0;
      for (let page = 1; page <= 50; page++) {
        if(!current())return;
        const badgeUrl = st.steamId64 ? `https://steamcommunity.com/profiles/${st.steamId64}/badges/?l=english&p=${page}` : `https://steamcommunity.com/my/badges/?l=english&p=${page}`;
        const cleanCookie = st.webCookies.replace(/(?:^|;\s*)Steam_Language=[^;]*/gi, '').replace(/^;\s*/, '');
        const badgeCookie = cleanCookie ? `${cleanCookie}; Steam_Language=english` : 'Steam_Language=english';
        const result = await remote(badgeUrl, { cookie: badgeCookie });
        if(!current())return;
        if (/\/login/.test(result.finalUrl) || !/badge_row|badges_empty|badge_empty/i.test(result.body)) throw new Error('Web session expired or unrecognized badge response.');
        pagesScanned++;
        for (const item of parseCards(result.body)) { found.set(item.appid, item); if (item.name) { acc.gameNames ||= {}; acc.gameNames[item.appid] = item.name; } }
        for (const cb of parseCraftableBadges(result.body)) craftableFound.set(cb.appid, cb);
        if (!new RegExp('[?&](?:amp;)?p=' + (page + 1) + '(?:["&])').test(result.body)) break;
        if (page === 50) throw new Error('Too many badge pages; scan incomplete.');
      }
      st.badgePagesScanned = pagesScanned;
      if (!current()) return;
      if (typeof client?.getUserOwnedApps === 'function' && [...found.values()].some(g => g.hoursPlayed === undefined)) {
        try {
          const lib = await ownedFloatLibrary(client);
          for (const g of lib.games) {
            if (found.has(g.appid)) {
              const entry = found.get(g.appid);
              if (!entry.name && g.name) entry.name = g.name;
              if (entry.hoursPlayed === undefined && typeof g.playtimeMinutes === 'number') {
                entry.hoursPlayed = Math.round((g.playtimeMinutes / 60) * 10) / 10;
              }
            }
          }
        } catch {}
      }
      for (const [appid, prev] of previousDrops) {
        const cur = found.get(appid);
        const nowRem = cur ? cur.remaining : 0;
        if (prev.remaining > nowRem) {
          const dropped = prev.remaining - nowRem;
          const gameTitle = cur?.name || prev.name || acc.gameNames?.[appid] || `AppID ${appid}`;
          notify(
            `🃏 Trading Card Dropped · ${gameTitle}`,
            `Obtained **${dropped}** trading card${dropped === 1 ? '' : 's'} in **${gameTitle}**.`,
            {
              color: 0xa855f7,
              fields: [
                { name: 'Remaining Drops', value: String(nowRem), inline: true },
                { name: 'Badge Progress', value: buildProgressBar(prev.remaining - nowRem, prev.remaining), inline: true }
              ]
            }
          );
        }
      }
      const excludedSet = new Set((Array.isArray(acc.excludedCardApps) ? acc.excludedCardApps : []).map(Number));
      st.cardDropGames = [...found.values()].filter(g => !excludedSet.has(Number(g.appid))); st.craftableBadges = [...craftableFound.values()]; st.cardsReady = true; st.cardError = ''; st.cardScanAt = new Date().toISOString(); farming(acc, true);
    } catch { if(current()){st.cardError = 'Could not update card drops; keeping the previous scan.'; try { client?.webLogOn(); } catch {}} }
    finally { st.scanning = false;release(); }
  }
  function connect(acc) {
    if (closing || clients.has(acc.id) || (persistence && !persistence.available)) return;
    const maxSimConn = Number(process.env.MAX_STEAM_CONNECTIONS) || 12; if(clients.size>=maxSimConn){stateFor(acc.id).error=`Free-plan memory protection allows up to ${maxSimConn} simultaneous Steam connections. Your saved profile has not been removed.`;return;}
    const st = stateFor(acc.id);
    const useVaultOverride = Boolean(acc.preferVaultToken && vault.get(acc.id));
    const token = useVaultOverride ? vault.get(acc.id) : (isEnvironmentAccount(acc) ? environmentToken : vault.get(acc.id));
    if (!token || !validClientToken(token)) { st.error = 'Please sign in again.'; return; }
    const client = new User({ renewRefreshTokens: useVaultOverride || !isEnvironmentAccount(acc), autoRelogin: false, dataDirectory: path.join(directory, 'steam-cache') });
    if (typeof client.webLogOn === 'function') {
      const origWebLogOn = client.webLogOn.bind(client);
      client.webLogOn = function (...args) {
        if (!this.steamID) return;
        try {
          const r = origWebLogOn(...args);
          if (r && typeof r.catch === 'function') r.catch(() => {});
          return r;
        } catch (err) {
          console.warn(`[Steam] Ignored webLogOn on disconnected client (${acc.id}): ${err?.message || err}`);
        }
      };
    }
    if (typeof client._handleLogOnResponse === 'function') {
      const origHandleLogOn = client._handleLogOnResponse.bind(client);
      client._handleLogOnResponse = function (...args) {
        try {
          const r = origHandleLogOn(...args);
          if (r && typeof r.catch === 'function') {
            return r.catch(err => console.warn(`[Steam] Ignored logon race (${acc.id}): ${err?.message || err}`));
          }
          return r;
        } catch (err) {
          console.warn(`[Steam] Ignored logon sync race (${acc.id}): ${err?.message || err}`);
        }
      };
    }
    clients.set(acc.id, client); st.error = 'Connecting to Steam…';
    const isCurrent = () => !closing && clients.get(acc.id) === client && cfg.accounts.includes(acc);
    client.on('refreshToken', token => { if (isCurrent() && (useVaultOverride || !isEnvironmentAccount(acc))) { try { vault.set(acc.id, token); } catch { st.error = 'Could not save the renewed session.'; } } });
    client.on('loggedOn', () => {
      if (!isCurrent()) return;
      if(st.reconnectTimer){clearTimeout(st.reconnectTimer);st.reconnectTimer=null;}
      try {
        const sock = client._connection?.stream || client._connection?.socket || client._connection;
        sock?.setNoDelay?.(true);
        sock?.setKeepAlive?.(true, 15000);
      } catch {}
      st.connected = true; st.error = ''; st.retryCount = 0; st.linkCheckStarted = false; st.achievementPersistence = null; st.candidateScanStarted = false; st.steamId64 = client.steamID.toString();
      try { st.tokenAccountMatches = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub === st.steamId64; } catch { st.tokenAccountMatches = false; }
      console.log(`[Steam] ${acc.id}: connected; token account matches: ${st.tokenAccountMatches}`);
      acc.mySteamID = st.steamId64;try{save();}catch{disconnect(acc.id);return;}
      st.isCollisionPaused = !acc.ignoreSessionCollision && Boolean(client.playingState?.blocked || st.collisionReconnectPending);
      if (st.isCollisionPaused) timedManager.pauseAccount(acc.id); else timedManager.resumeAccount(acc.id);
      if (st.collisionReconnectPending) {
        const checkTimer = setTimeout(() => {
          if (!isCurrent() || !st.connected) return;
          if (!client.playingState?.blocked) {
            st.collisionReconnectPending = false;
            if (st.isCollisionPaused) {
              st.isCollisionPaused = false;
              st.playingOnPcAppId = 0;
              timedManager.resumeAccount(acc.id);
              farming(acc, true);
              emitStatusChange();
            }
          }
        }, 3500);
        checkTimer.unref?.();
      }
      timedManager.rehydrate({
        accountId: acc.id,
        executeItemFactory: (accId, appid, jobCfg) => makeTimedItemExecutor(accId, appid, Boolean(jobCfg?.stealth)),
        isCollisionPaused: accId => Boolean(stateFor(accId).isCollisionPaused)
      }).catch(() => {});
      acc.personaState = acc.personaState === 7 ? 7 : (SteamUser.EPersonaState?.Online ?? 1); client.setPersona(SteamUser.EPersonaState?.Online ?? 1); farming(acc, true);
      notify(`${acc.name} connected`, 'Steam session connected.');
      resolveNames(acc).catch(() => {});
    });
    client.on('accountInfo', name => { if (isCurrent()) st.profileName = name || ''; });
    client.on('webSession', (_, cookies) => { if (isCurrent()) { st.webCookies = cookies.map(c => c.split(';')[0]).join('; '); st.webSessionVersion++; console.log(`[Steam] ${acc.id}: authenticated web session ready`);
      if(startupDiagnostics&&isEnvironmentAccount(acc)&&typeof client.getUserOwnedApps==='function'&&!st.candidateScanStarted){
        st.candidateScanStarted=true;
        const timer=setTimeout(()=>{if(!isCurrent()||!st.connected)return;st.achievementCandidates={state:'running'};
budget.run(()=>runReadOnlyProbes(client),'small').then(result=>{if(isCurrent()&&st.connected){st.achievementProbes=result;console.log('[Achievement guard probes] '+JSON.stringify(result));}}).then(async()=>{if(!isCurrent()||!st.connected)return;const report=await budget.run(()=>runSharedImpactProbes(client),'small');if(isCurrent()&&st.connected){st.sharedCounterReviews=report;console.log('[Shared counter impact probes] '+JSON.stringify({checkedAt:report.checkedAt,results:report.results.map(r=>({appid:r.appid,game:r.game,name:r.name,counter:r.counter,message:r.message,completeImpact:r.completeImpact,effects:r.effects?.length,wouldUnlock:r.effects?.filter(e=>e.effect==='would_unlock').map(e=>e.name).slice(0,8),unknown:r.effects?.filter(e=>e.effect==='unknown').length,restricted:r.effects?.filter(e=>e.effect==='restricted').length,writesSent:r.writesSent}))}));}}).then(async()=>{if(!isCurrent()||!st.connected)return;try{const view=await protocolRead(client,220,{timeoutMs:6000});const row=view.achievements.find(a=>a.apiname==='HL2_HIT_CANCOP_WITHCAN');if(isCurrent()&&st.connected){st.hiddenAchievementPersistence={appid:220,apiname:'HL2_HIT_CANCOP_WITHCAN',name:row?.name,hidden:row?.hidden,unlocked:row?.unlocked??null,checkedAt:view.checkedAt,afterReconnect:true};console.log('[Hidden achievement persistence check] '+JSON.stringify(st.hiddenAchievementPersistence));}}catch{console.log('[Hidden achievement persistence check] Reading unavailable; no write was sent.');}}).then(()=>{if(!isCurrent()||!st.connected)return;return scanCandidates(client,[3764200,3932890,...acc.games],{fullLibrary:true,maxGames:12,maxDurationMs:60000,onCandidate:entry=>console.log('[Hidden achievement candidate] '+JSON.stringify(entry))}).then(result=>{if(isCurrent()&&st.connected){st.achievementCandidates=result;console.log('[Achievement candidate scan] '+JSON.stringify(result));}});}).catch(()=>{if(isCurrent())st.achievementCandidates={state:'unavailable',message:'The read-only library scan could not finish. No achievement writes were sent.'};});
        },8000);timer.unref();
      }
      const checkApp = acc.games.includes(550) ? 550 : acc.games[0] || 3764200;
      if (startupDiagnostics && checkApp && st.connected && client.steamID && !st.linkCheckStarted) { st.linkCheckStarted = true;
        if (isEnvironmentAccount(acc) && typeof client._send === 'function') protocolRead(client,3764200).then(result=>{
          if(!isCurrent() || !st.connected) return;
          const rows=result.achievements.filter(a=>a.apiname==='46' && a.name==='Model Mania');
          st.achievementPersistence={appid:3764200,apiname:'46',name:'Model Mania',unlocked:rows.length===1?rows[0].unlocked:null,checkedAt:new Date().toISOString(),afterReconnect:true};
          console.log('[Achievement persistence check] '+JSON.stringify(st.achievementPersistence));
        }).catch(()=>{if(isCurrent())st.achievementPersistence={appid:3764200,name:'Model Mania',unlocked:null,error:'Could not read the achievement after reconnect.'};});
        if (typeof client._send === 'function') protocolRead(client, checkApp).then(result => { if (isCurrent()) console.log(`[Steam protocol check] app=${checkApp} verified=${result.verified} count=${result.achievements.length} unlocked=${result.achievements.filter(a=>a.unlocked===true).length} serverControlled=${result.diagnostics.serverControlled}`); }).catch(err => { if (isCurrent()) console.warn(`[Steam protocol check] app=${checkApp}: ${err.status ? err.message : 'unavailable'}`); });
        steamRead(acc, st, checkApp, process.env.STEAM_API_KEY || '').then(result => { if (isCurrent()) console.log(`[Steam link check] account=${acc.id} app=${checkApp} source=${result.source || 'none'} personalVerified=${Boolean(result.verified)} count=${result.achievements?.length || 0} unlocked=${(result.achievements || []).filter(a=>a.unlocked===true).length} diagnostics=${JSON.stringify(result.diagnostics?.personal || {})}`); }).catch(() => { if (isCurrent()) console.warn(`[Steam link check] account=${acc.id}: achievement retrieval unavailable`); }); }
      if (acc.cardFarming) scan(acc).catch(() => {}); } });
    client.on('playingState', (blocked, playingApp) => {
      if (!isCurrent()) return;
      st.playingOnPcAppId = blocked ? (Number(playingApp) || 0) : 0;
      if (!blocked) st.collisionReconnectPending = false;
      if (acc.ignoreSessionCollision) {
        if (st.isCollisionPaused) {
          st.isCollisionPaused = false;
          timedManager.resumeAccount(acc.id);
          farming(acc, true);
        }
        return;
      }
      const changed = st.isCollisionPaused !== blocked;
      st.isCollisionPaused = blocked;
      if (blocked) {
        timedManager.pauseAccount(acc.id);
        console.log(`[Collision] PC game detected (${acc.id}, app=${st.playingOnPcAppId}). Pausing farming immediately & keeping session alive.`);
      } else {
        timedManager.resumeAccount(acc.id);
        console.log(`[Collision] PC game closed (${acc.id}). Auto-resuming farming.`);
      }
      if (changed) farming(acc, true);
      emitStatusChange();
    });
    client.on('user', (sid, user) => {
      if (!isCurrent()) return;
      const sidStr = typeof sid?.getSteamID64 === 'function' ? sid.getSteamID64() : sid?.toString?.();
      if (sidStr && sidStr === st.steamId64) {
        const hasGameId = Boolean(user?.gameid && String(user.gameid) !== '0');
        const isPlayingAnything = Boolean(hasGameId || user?.game_name || user?.game_extra_info);
        if (!isPlayingAnything && st.isCollisionPaused && !client.playingState?.blocked) {
          console.log(`[Collision] Detected PC user stopped playing (${acc.id}). Auto-resuming farming.`);
          st.isCollisionPaused = false;
          st.collisionReconnectPending = false;
          st.playingOnPcAppId = 0;
          if (client.playingState) client.playingState.blocked = false;
          timedManager.resumeAccount(acc.id);
          farming(acc, true);
          emitStatusChange();
        }
      }
    });
    function offline(err) {
      if (!isCurrent()) return;
      st.connected = false; st.isFarming = false; st.sessionStartTime = null; st.playedGames = []; st.webCookies = ''; st.cardsReady = false;
      const eresult = Number(err?.eresult) || 0;
      const isCollisionKick = [6, 15, 34].includes(eresult);
      const needsLogin = [5, 27, 63, 65, 85, 88].includes(eresult);
      console.warn(`[Steam] ${acc.id}: disconnected; result code: ${eresult}`);
      if (isCollisionKick) {
        acc.ignoreSessionCollision = false;
        st.isCollisionPaused = true;
        st.collisionReconnectPending = true;
        st.error = 'Jugando en tu PC · En pausa automática (reconectando en espera sin cerrar tu juego)…';
        timedManager.pauseAccount(acc.id);
        try { save(); } catch {}
        emitStatusChange();
        if (st.reconnectTimer) clearTimeout(st.reconnectTimer);
        st.reconnectTimer = setTimeout(() => {
          st.reconnectTimer = null; if (!isCurrent()) return;
          clients.delete(acc.id); client.removeAllListeners(); client.on('error', () => {}); try { client.logOff(); } catch {} connect(acc);
        }, 3500);
        return;
      }
      const isRateLimited = eresult === 84 || eresult === 87;
      st.error = needsLogin
        ? 'Steam rejected the session. Please sign in again.'
        : (isRateLimited ? 'Límite temporal de Steam (RateLimit); reintentando con pausa segura…' : 'Steam disconnected; reconnecting…');
      if (needsLogin) {
        if (st.reconnectTimer) { clearTimeout(st.reconnectTimer); st.reconnectTimer = null; }
        if (isEnvironmentAccount(acc)) st.error = 'Update STEAM_REFRESH_TOKEN in Render: Steam rejected the session.';
        emitStatusChange();
        return;
      }
      const retryDelayMs = isRateLimited
        ? (45000 + crypto.randomInt(0, 15000))
        : Math.min(300000, 5000 * 2 ** Math.min(st.retryCount++, 6));
      if (!st.reconnectTimer) st.reconnectTimer = setTimeout(() => {
        st.reconnectTimer = null; if (!isCurrent()) return;
        clients.delete(acc.id); client.removeAllListeners(); client.on('error', () => {}); try { client.logOff(); } catch {} connect(acc);
      }, retryDelayMs);
    }
    client.on('error', offline); client.on('disconnected', () => offline());
    client.on('friendMessage', async (steamid, message) => {
      const senderId = steamid.toString();
      if (!isCurrent() || (!(acc.chatAdmins || []).includes(senderId) && senderId !== st.steamId64)) return;
      const command = message.trim().toLowerCase();
      if (command === '!pause') st.isPaused = true;
      if (command === '!resume') st.isPaused = false;
      if (command === '!pause' || command === '!resume') {acc.paused=st.isPaused;try{save();if(persistence)await persistence.flush();}catch{disconnect(acc.id);return;}farming(acc);}
      if (command === '!cards') {
        const drops = (st.cardDropGames || []).reduce((s, g) => s + (Number(g.remaining) || 0), 0);
        try { client.chatMessage(steamid, `SteamFarmer (${acc.name}): ${drops} cromos pendientes en ${(st.cardDropGames || []).length} juegos.`); } catch {}
        return;
      }
      if (command === '!games') {
        try { client.chatMessage(steamid, `SteamFarmer (${acc.name}): ${(acc.games || []).length}/32 juegos en lista (${(st.playedGames || []).length} activos ahora).`); } catch {}
        return;
      }
      if (['!pause', '!resume', '!status', '!help'].includes(command)) {
        try { client.chatMessage(steamid, `SteamFarmer: ${st.connected ? 'connected' : 'disconnected'}, ${st.isFarming ? 'activity sent' : 'paused'}. Commands: !status !pause !resume !cards !games`); } catch {}
      }
    });
    try { client.logOn({ refreshToken: token, logonID: crypto.randomInt(1, 0xffffffff), machineName: 'SteamFarmer personal' }); }
    catch { st.error = 'Could not use the saved session. Please sign in again.'; clients.delete(acc.id); }
  }
  function ensureAccountServices(acc) {
    const st = stateFor(acc.id);
    const client = clients.get(acc.id);
    if (!st.marketSniper) st.marketSniper = new MarketSniperService(st.webCookies, acc.id);
    else st.marketSniper.setCookies(st.webCookies);
    if (!st.alchemyTransmuter) st.alchemyTransmuter = new AlchemyTransmuter(st.webCookies);
    else st.alchemyTransmuter.setCookies(st.webCookies);
    if (!st.levelOptimizer) st.levelOptimizer = new LevelOptimizer(st.webCookies);
    else st.levelOptimizer.setCookies(st.webCookies);
    return { st, client };
  }
  function disconnect(id) {
    const st = states.get(id);
    if (st?.reconnectTimer) clearTimeout(st.reconnectTimer);
    st?.marketSniper?.stopScanning?.();
    const client = clients.get(id); clients.delete(id);
    if (client) { client.removeAllListeners(); client.on('error', () => {}); try { client.gamesPlayed([]); client.logOff(); } catch {} }
    states.delete(id);
  }
  async function resolveNames(acc) {
    if(namePending.has(acc.id))return namePending.get(acc.id);
    const task=(async()=>{
      let dirty = false;
      for (const id of acc.games) {
        if (!acc.gameNames[id] && RELIC_OFFICIAL_NAMES[id]) {
          acc.gameNames[id] = RELIC_OFFICIAL_NAMES[id];
          dirty = true;
        }
      }
      if (dirty) save();
      const missing = acc.games.filter(id => !acc.gameNames[id]);
      for (let i = 0; i < missing.length; i += 2) {
        if (closing || !cfg.accounts.includes(acc)) break;
        const batch = missing.slice(i, i + 2);
        await Promise.all(batch.map(async id => {
          try {
            const data = JSON.parse((await budget.run(() => remote(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic&l=english`, { maxBytes: 128 * 1024 }), 'small')).body);
            if (data[id]?.success && cfg.accounts.includes(acc) && acc.games.includes(id) && typeof data[id].data.name === 'string') {
              acc.gameNames[id] = data[id].data.name.slice(0, 256);
              dirty = true;
            }
          } catch {}
        }));
      }
      if (dirty && !closing && cfg.accounts.includes(acc)) {
        save();
        emitStatusChange();
      }
    })().finally(()=>namePending.delete(acc.id));namePending.set(acc.id,task);return task;
  }
  function getAccount(req, url, data = {}) {
    const id = data.accountId || url.searchParams.get('accountId');
    if (!id) throw fail('Select an account explicitly.');
    const acc = cfg.accounts.find(a => a.id === id); if (!acc) throw fail('Account not found.', 404);
    if (req && req.headers) {
      let sess = null;
      try {
        sess = panelSession(req).session;
      } catch {}
      const owned = sess?.ownedAccounts instanceof Set ? sess.ownedAccounts : new Set();
      if (!sess || (!sess.isAdmin && !owned.has(acc.id))) {
        throw fail('This account is not linked to your browser session. Sign in with your own Steam account.', 403);
      }
    }
    return acc;
  }
  function publicAccount(acc) {
    const st = stateFor(acc.id);
    const timedSyncApps = timedManager.activeNonStealthApps(acc.id);
    const under2hCount = (st.cardDropGames || []).filter(g => typeof g.hoursPlayed === 'number' && g.hoursPlayed < 2.0).length;
    const farmingPhase = !st.connected || st.isPaused || st.isCollisionPaused || st.isSleepPaused
      ? 'paused'
      : timedSyncApps.length
        ? 'timed_sync'
        : acc.cardFarming && st.cardsReady && (st.cardDropGames || []).length
          ? 'accumulating_2h'
          : st.isFarming
            ? 'manual'
            : 'idle';
    return { ...acc, personaState: acc.personaState === 7 ? 7 : 1, ignoreSessionCollision: Boolean(acc.ignoreSessionCollision), stealthFarming: Boolean(acc.stealthFarming), privateApps: Boolean(acc.stealthFarming || acc.privateApps), steamDeckSpoofed: Boolean(st.steamDeckSpoofed), steamPoints: st.steamPoints ?? null, totalCardsEarned: st.totalCardsEarned ?? null, tokenSource: isEnvironmentAccount(acc) ? 'environment' : 'local', encryptedSession: isAuthorizedAccount(acc), webSessionReady: Boolean(st.webCookies), tokenAccountMatches: st.tokenAccountMatches, profileName: st.profileName, linkedSteamId: st.steamId64 || acc.mySteamID || '', connected: st.connected, error: st.error, cardError: st.cardError || '', isFarming: st.isFarming, isPaused: st.isPaused, isCollisionPaused: st.isCollisionPaused, isSleepPaused: st.isSleepPaused, sessionStartTime: st.sessionStartTime, runningGames: st.playedGames.filter(x => typeof x === 'number'), cardDropGames: st.cardDropGames, cardsReady: st.cardsReady, scanning: Boolean(st.scanning), badgePagesScanned: st.badgePagesScanned || 0, cardScanAt:st.cardScanAt||null, autoDiscoveryQueue: Boolean(acc.autoDiscoveryQueue), lastDiscoveryQueueAt: st.lastDiscoveryQueueAt || acc.lastDiscoveryQueueAt || null, farmingPhase, activeTimedJobs: timedManager.listForAccount(acc.id), recentTimedEvents: timedManager.recentEventsForAccount(acc.id), craftableBadges: st.craftableBadges || [], hasIdentitySecret: Boolean(vault.get(acc.id + ':identity_secret')), gameCount: acc.games.length };
  }
  function rate(key, limit, window = 60000) {
    const now = Date.now(); let r = rates.get(key); if (!r || now >= r.until) { r = { count: 0, until: now + window }; rates.set(key, r); }
    if(rates.size>2048){for(const [k,v]of rates)if(v.until<=now)rates.delete(k);if(rates.size>2048){rates.delete(key);throw fail('The server is receiving too many requests.',429);}}
    if (++r.count > limit) throw fail('Too many requests. Please wait a moment.', 429);
  }
  function panelSession(req) {
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)sf_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session = token ? sessions.get(token) : null;
    if (!session || session.expires <= Date.now()) { if (token) sessions.delete(token); throw fail('Sign in to the dashboard.', 401); }
    return { token, session };
  }
  const originValue = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
  const origin = originValue ? new URL(originValue).origin : null;
  if (origin && !origin.startsWith('https://')) throw new Error('The public origin must use HTTPS.');
  function checkOrigin(req, publicGet = false) {
    const expected = origin || `http://${req.headers.host}`;
    if (!origin && !/^((localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/.test(req.headers.host || '')) throw fail('Invalid host. Configure PUBLIC_ORIGIN for remote access.', 403);
    if (!publicGet && req.headers.origin && req.headers.origin !== expected) throw fail('Origin not allowed.', 403);
    if (!publicGet && req.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site request rejected.', 403);
  }
  async function json(res, status, body) {
    res.setHeader('Cache-Control','no-store');
    if(body?.achievementHistoryStorage){body.applicationStorage=persistence?.status()||{mode:'local',persistent:false,available:true};const mem=process.memoryUsage();body.resources={rssBytes:mem.rss,heapUsedBytes:mem.heapUsed,externalBytes:mem.external,...budget.status(),steamConnections:clients.size,cacheBytes:achievementCache.bytes+requirementsCache.bytes+percentageCache.bytes+(percentagesRead.bytes?.()||0)};}
    if(status<400 && persistence && (body?.success===true || body?.phase==='authenticated')){
      try{await persistence.flush();}catch{status=503;body={error:'Persistent storage failed. The change was not confirmed as saved. Restart after checking Neon.'};}
    }
    if (!res.writableEnded && !res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
  }
  async function readBody(req) {
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw fail('application/json is required.',415);
    const bytes=await new Promise((resolve,reject)=>{
      let size=0,done=false;const chunks=[];
      const cleanup=()=>{req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',error);req.removeListener('aborted',aborted);};
      const error=()=>{if(done)return;done=true;cleanup();chunks.length=0;reject(fail('The request could not be read.',400));};
      const aborted=()=>error();
      const maxBytes=/^\/api\/(?:artwork\/patch|overwatch2003\/)/i.test(req.url||'')?30*1024*1024:65536;const data=chunk=>{if(done)return;size+=chunk.length;if(size>maxBytes){done=true;cleanup();chunks.length=0;req.once('error',()=>{});req.resume();reject(fail('Request too large.',413));}else chunks.push(chunk);};
      const end=()=>{if(done)return;done=true;cleanup();resolve(Buffer.concat(chunks,size));};
      req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);
    });
    try{const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=JSON.parse(body||'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}catch{throw fail('Invalid JSON.');}
  }
  function cancelAttempt(id) {
    const a = attempts.get(id); if (!a) return; a.phase = 'cancelled';
    try { a.login.cancelLoginAttempt(); } catch {}a.login.removeAllListeners();a.login.on('error',()=>{}); attempts.delete(id);
  }
  function findAttempt(id, owner) {
    const a = attempts.get(id);
    if (!a) throw fail('Login attempt not found.', 404);
    if (a.owner !== owner && sessions.has(owner) && a.phase !== 'cancelled') {
      a.owner = owner;
    }
    return a;
  }
  function attemptView(a) { return { attemptId: a.id, phase: a.phase, guards: a.guards, error: a.error || '', accountId: a.accountId || null, qrChallengeUrl: a.qrChallengeUrl || '', qrStatus: a.qrStatus || '' }; }
  async function startLogin(data, owner) {
    rate(`steam:${owner}`, 10, 5 * 60000);
    for (const [id, a] of attempts) if (a.owner === owner && ['starting', 'guard', 'waiting'].includes(a.phase)) cancelAttempt(id);
    if (attempts.size >= 8) {
      for (const [oldId, oldA] of attempts) {
        if (!['starting', 'guard', 'waiting', 'saving'].includes(oldA.phase) || Date.now() - oldA.created > 300000) {
          cancelAttempt(oldId);
        }
      }
    }
    if (attempts.size >= 8) throw fail('Too many pending login attempts.', 429);
    const isQrMode = data.method === 'qr' || data.qr === true;
    const user = isQrMode ? '' : text(data.user, 128);
    const name = text(data.name || user || 'Steam QR', 64);
    if (!isQrMode && (!user || typeof data.password !== 'string' || !data.password || data.password.length > 256)) throw fail('Enter your Steam login name and password.');
    let existing;
    if (data.accountId) existing = getAccount(null, new URL('http://localhost'), data);
    if(!existing&&cfg.accounts.length>=16)throw fail('Maximum 16 saved profiles on the free-plan memory budget.',409);
    if (existing && isEnvironmentAccount(existing)) throw fail('This account uses STEAM_REFRESH_TOKEN in Render. Update that variable to replace its session.', 409);
    const login = new Session(EAuthTokenPlatformType.SteamClient, { machineFriendlyName: 'SteamFarmer personal', machineId: true });
    login.loginTimeout = 300000;
    const a = { id: crypto.randomUUID(), login, owner, phase: 'starting', guards: [], error: '', created: Date.now(), targetId: existing?.id };
    attempts.set(a.id, a);
    const alive = () => attempts.get(a.id) === a && ['starting', 'guard', 'waiting', 'saving'].includes(a.phase) && !closing;
    login.on('timeout', () => { if (alive() && a.phase !== 'authenticated') { a.phase = 'expired'; a.error = 'Login attempt expired. Please try again.'; } });
    login.on('error', err => {
      if (!alive() || a.phase === 'authenticated' || a.phase === 'saving') return;
      const msg = String(err?.message || '');
      if ((a.phase === 'guard' || a.phase === 'waiting') && /network|timeout|ECONNRESET|ETIMEDOUT|socket|fetch/i.test(msg)) {
        return;
      }
      a.phase = 'failed';
      a.error = 'Steam rejected the login or is unavailable.';
    });
    login.on('authenticated', async () => {
      if (!alive()) return;
      try {
        const steamid = login.steamID.toString();
        let acc = a.targetId
          ? cfg.accounts.find(acc => acc.id === a.targetId)
          : (cfg.accounts.find(acc => !isEnvironmentAccount(acc) && (acc.mySteamID === steamid || String(acc.user||'').toLowerCase() === login.accountName.toLowerCase()))
            || cfg.accounts.find(acc => acc.mySteamID === steamid || String(acc.user||'').toLowerCase() === login.accountName.toLowerCase()));
        if (a.targetId && (!acc || (acc.mySteamID && acc.mySteamID !== steamid))) throw Error('Account identity mismatch');
        if (a.targetId && acc && isEnvironmentAccount(acc)) throw Error('Account managed through an environment variable');
        const fresh = !acc;
        acc ||= { id: crypto.randomUUID(), name, user: login.accountName, games: [], gameNames: {}, personaState: SteamUser.EPersonaState.Online, cardFarming: false, sleepMode: { enabled: false, start: 3, end: 8 }, customStatus: '', chatAdmins: [] };
        if(fresh&&cfg.accounts.length>=16)throw Error('Profile limit reached while authenticating');
        const oldAccount=fresh?null:structuredClone(acc),oldTokenRecord=vault.records[acc.id];
        a.phase='saving';
        vault.set(acc.id, login.refreshToken);
        if (isEnvironmentAccount(acc)) acc.preferVaultToken = true;
        acc.mySteamID = steamid; acc.user = login.accountName; acc.claimedByBrowser = true;
        if (name && (!acc.name || acc.name === 'Main account')) acc.name = name;
        if (fresh) cfg.accounts.push(acc); save();if(persistence)await persistence.flush();
        if(attempts.get(a.id)!==a||a.phase==='cancelled'||closing){
          if(!closing){if(fresh)cfg.accounts=cfg.accounts.filter(x=>x!==acc);else Object.assign(acc,oldAccount);if(oldTokenRecord)vault.records[acc.id]=oldTokenRecord;else delete vault.records[acc.id];atomicWrite(vault.file,vault.records);save();if(persistence)await persistence.flush();}return;
        }
        const ownerSess = sessions.get(a.owner);
        if (ownerSess) {
          ownerSess.ownedAccounts ||= new Set();
          ownerSess.ownedAccounts.add(acc.id);
        }
        const existingSt = stateFor(acc.id);
        const alreadyLive = !fresh && clients.has(acc.id) && existingSt.connected && existingSt.steamId64 === steamid;
        if (!alreadyLive) {
          disconnect(acc.id);
          const maxSimConnAuth = Number(process.env.MAX_STEAM_CONNECTIONS) || 12;
          if (clients.size >= maxSimConnAuth) {
            const idleId = [...clients.keys()].find(cid => cid !== acc.id);
            if (idleId) disconnect(idleId);
          }
          connect(acc);
        }
        a.accountId = acc.id; a.phase = 'authenticated';
        emitStatusChange();
      } catch { a.phase = 'failed'; a.error = 'Could not save the session or the account does not match the selected profile.'; }
    });
    login.on('remoteInteraction', () => {
      if (alive()) a.qrStatus = 'scanned';
    });
    try {
      if (isQrMode) {
        if (typeof login.startWithQR !== 'function') throw new Error('QR_NOT_SUPPORTED');
        const qrResult = await login.startWithQR();
        if (alive()) {
          a.qrChallengeUrl = String(qrResult?.qrChallengeUrl || login.qrChallengeUrl || '');
          a.qrStatus = 'ready';
          a.phase = 'waiting';
        }
        login.on('polling', () => {
          if (alive() && login.qrChallengeUrl) a.qrChallengeUrl = String(login.qrChallengeUrl);
        });
      } else {
        const result = await login.startWithCredentials({ accountName: user, password: data.password });
        if (alive()) {
          a.guards = (result.validActions || []).map(g => ({ type: g.type, label: EAuthSessionGuardType[g.type] || 'Steam Guard', detail: g.detail || '' }));
          a.phase = result.actionRequired ? 'guard' : 'waiting';
        }
      }
    } catch { if (alive()) { a.phase = 'failed'; a.error = isQrMode ? 'Could not generate Steam QR code right now.' : 'Invalid credentials, Steam rate limit or connection unavailable.'; } }
    return attemptView(a);
  }
  const server = http.createServer(async (req, res) => {
    let releaseResource;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Permitted-Cross-Domain-Policies', 'none'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      // Public liveness probe: exposes no Steam account data; Render probes may use an internal Host.
      if ((url.pathname === '/healthz' || url.pathname === '/ping') && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(closing ? 503 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: !closing }));
      }
      // Public GET pages may be reached from bookmarks, search engines or external links.
      // All API requests and mutations continue to enforce origin/Fetch Metadata checks.
      checkOrigin(req, req.method === 'GET' && ['/', '/app.js', '/achievement-live.js', '/draft-settings.js', '/achievement-availability.js', '/achievement-rarity.js', '/manifest.json', '/style.css', '/logo.svg', '/favicon.ico'].includes(url.pathname));
      if (!['GET', 'POST'].includes(req.method)) throw fail('Method not allowed.', 405);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw fail('Route not found.', 404);
        const item = staticFiles.get(url.pathname); if (!item) throw fail('Route not found.', 404);
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); res.setHeader('ETag', item.etag);
        if ((req.headers['if-none-match'] || '').split(',').map(value => value.trim().replace(/^W\//, '')).some(value => value === item.etag || value === '*')) { res.writeHead(304); return res.end(); }
        res.writeHead(200, { 'Content-Type': item.type + '; charset=utf-8' }); return res.end(item.body);
      }
      const ip = req.socket.remoteAddress; rate(`api:${ip}`, 600);
      if(req.method==='POST')await persistence?.flush();
      if (url.pathname === '/api/panel/login' && req.method === 'POST') {
        rate(`panel:${ip}`, 5, 5 * 60000);
        const data = await readBody(req);
        if (!verifyPassword(data.password, cfg.panelAuth)) throw fail('Incorrect password.', 401);
        for(const [id,s]of sessions)if(s.expires<=Date.now())sessions.delete(id);
        if(sessions.size>=16)throw fail('Too many dashboard sessions. Sign out of an existing session first.',429);
        const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(32).toString('hex');
        const allIds = new Set(cfg.accounts.map(a => a.id));
        sessions.set(token, { csrf, expires: Date.now() + 30 * 24 * 3600000, isAdmin: true, ownedAccounts: allIds });
        const sec = origin?.startsWith('https:') ? '; Secure' : '';
        res.setHeader('Set-Cookie', [
          `sf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${sec}`,
          `sf_owned=${signOwnedCookie(allIds, true)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${sec}`
        ]);
        return json(res, 200, { csrf, isAdmin: true });
      }
      if (url.pathname === '/api/panel/session' && req.method === 'GET') {
        const cookieOwned = parseOwnedCookie(req.headers.cookie);
        try {
          const { session } = panelSession(req);
          session.ownedAccounts ||= new Set();
          for (const id of cookieOwned.ids) session.ownedAccounts.add(id);
          if (cookieOwned.isAdmin) session.isAdmin = true;
          return json(res, 200, { csrf: session.csrf, isAdmin: Boolean(session.isAdmin) });
        } catch {
          for (const [id, s] of sessions) if (s.expires <= Date.now()) sessions.delete(id);
          if (sessions.size >= 256) {
            const guestKey = [...sessions.entries()].find(([k, v]) => !v.isAdmin && (!v.ownedAccounts || v.ownedAccounts.size === 0))?.[0];
            const oldest = guestKey || sessions.keys().next().value;
            if (oldest) sessions.delete(oldest);
          }
          const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(32).toString('hex');
          sessions.set(token, { csrf, expires: Date.now() + 30 * 24 * 3600000, isAdmin: cookieOwned.isAdmin, ownedAccounts: cookieOwned.ids });
          res.setHeader('Set-Cookie', `sf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${origin?.startsWith('https:') ? '; Secure' : ''}`);
          return json(res, 200, { csrf, isAdmin: Boolean(cookieOwned.isAdmin) });
        }
      }
      const { token, session } = panelSession(req);
      const assertPanelSession=()=>{if(sessions.get(token)!==session||session.expires<=Date.now())throw fail('The dashboard session changed. No new Steam write is permitted.',401);};
      let data = {};
      if (req.method === 'POST') {
        if (req.headers['x-csrf-token'] !== session.csrf) throw fail('Invalid session. Reload the dashboard.', 403);
        data = await readBody(req);
      }
      if(['/api/achievement/progress-preview','/api/achievement/float-progress-preview','/api/achievement/float-search','/api/achievement/shared-progress-preview','/api/achievement/unlock','/api/achievement/change-preview','/api/achievement/change','/api/achievement/changes','/api/achievement-experiment','/api/stats','/api/achievement/import','/api/achievement/undo','/api/achievement/bulk-apps'].includes(url.pathname)){try{releaseResource=budget.acquire('heavy');}catch(e){if(!data?.directApply&&!['/api/achievement/change','/api/achievement/changes','/api/stats','/api/achievement/undo','/api/achievement/bulk-apps'].includes(url.pathname))throw e;}}
      else if(['/api/search','/api/game-requirements','/api/achievement/percentages','/api/claim-free','/api/achievement/history','/api/achievement/timed','/api/achievement/export','/api/achievement/analytics','/api/achievement/copy-timings','/api/cards/inventory','/api/cards/estimate','/api/cards/sell','/api/badges/craft','/api/cluster/status','/api/cluster/action','/api/game/inspect-start','/api/game/inspect-stop','/api/points/claim-daily','/api/account/claim-free-pack','/api/account/toggle-privacy','/api/account/loyalty-summary'].includes(url.pathname)||/^\/api\/games\/\d+\/(live-players|leaderboards|donor-schema)$/.test(url.pathname))releaseResource=budget.acquire('small');
      if (url.pathname === '/api/panel/logout' && req.method === 'POST') {
        for (const [id, a] of attempts) if (a.owner === token) cancelAttempt(id);
        sessions.delete(token);
        const sec = origin?.startsWith('https:') ? '; Secure' : '';
        res.setHeader('Set-Cookie', [
          `sf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${sec}`,
          `sf_owned=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${sec}`
        ]);
        return json(res, 200, { success: true });
      }
      if (url.pathname === '/api/panel/password' && req.method === 'POST') {
        const password = text(data.password, 256); if (password.length < 12) throw fail('Use at least 12 characters.');
        if (!verifyPassword(data.currentPassword, cfg.panelAuth)) throw fail('The current password is incorrect.', 401);
        cfg.panelAuth = hashPassword(password); save();
        for (const id of attempts.keys()) cancelAttempt(id);
        sessions.clear(); return json(res, 200, { success: true });
      }
      if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, buildStatusPayload(session));
      if (url.pathname === '/api/events' && req.method === 'GET') {
        const accountId = url.searchParams.get('account') || url.searchParams.get('accountId') || '';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write(':\n\n');
        if (accountId && !cfg.accounts.some(a => a.id === accountId)) {
          res.write('data: {"error":"no_bot"}\n\n');
          return res.end();
        }
        const sendUpdate = (customEvent = null) => {
          try {
            if (customEvent && customEvent.type === 'achievement_unlocked') {
              if (!session.isAdmin && !(session.ownedAccounts instanceof Set && session.ownedAccounts.has(customEvent.accountId))) return;
              res.write(`data: ${JSON.stringify(customEvent)}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify(buildStatusPayload(session))}\n\n`);
            }
          } catch {}
        };
        sendUpdate();
        if (url.searchParams.get('once') === '1') return res.end();
        const isBridge = url.searchParams.get('bridge') === '1';
        sseListeners.add(sendUpdate);
        if (isBridge) {
          localBridgeListeners.add(sendUpdate);
          localBridgeLastHeartbeat = Date.now();
          emitStatusChange();
        }
        const hb = setInterval(() => {
          try { res.write(':\n\n'); } catch {}
        }, 20000);
        hb.unref?.();
        req.on('close', () => {
          clearInterval(hb);
          sseListeners.delete(sendUpdate);
          if (isBridge) {
            localBridgeListeners.delete(sendUpdate);
            emitStatusChange();
          }
        });
        return;
      }
      if (url.pathname === '/api/local-bridge/heartbeat' && req.method === 'POST') {
        if (data.connected === false) {
          localBridgeLastHeartbeat = 0;
        } else {
          localBridgeLastHeartbeat = Date.now();
        }
        emitStatusChange();
        return json(res, 200, { ok: true, localBridgeConnected: isLocalBridgeConnected() });
      }
      if (url.pathname === '/api/points/claim-daily' && req.method === 'POST') {
        const acc = getAccount(req, url, data), st = stateFor(acc.id);
        if (!st.connected || !st.webCookies) {
          return json(res, 200, { ok: false, error: 'not_connected', message: 'Connect your Steam account and web session first.' });
        }
        const sessionId = (st.webCookies.match(/(?:^|;\s*)sessionid=([^;]+)/) || [])[1] || '';
        const claimUrl = 'https://store.steampowered.com/points/claimdailypromotion';
        try {
          let resultJson = {};
          if (typeof options.pointsClaimer === 'function') {
            resultJson = await options.pointsClaimer({ url: claimUrl, cookies: st.webCookies, sessionId, accountId: acc.id });
          } else {
            const resp = await remote(claimUrl, {
              method: 'POST',
              headers: {
                Cookie: st.webCookies,
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://store.steampowered.com/points/shop'
              },
              body: new URLSearchParams({ sessionid: sessionId }).toString()
            });
            resultJson = JSON.parse(resp.body || '{}');
          }
          const ok = resultJson?.success === 1;
          return json(res, 200, {
            ok,
            data: resultJson,
            message: ok ? 'Daily Points Shop item claimed successfully!' : 'No free daily Points Shop promotion available right now.'
          });
        } catch (e) {
          return json(res, 200, { ok: false, error: e.message || 'claim_failed', message: 'Could not claim daily Points Shop item.' });
        }
      }
      if ((url.pathname === '/api/steam/login' || url.pathname === '/api/steam/qr-login') && req.method === 'POST') {
        const loginPayload = url.pathname === '/api/steam/qr-login' ? { ...data, method: 'qr' } : data;
        const view = await startLogin(loginPayload, token);
        if (view.phase === 'authenticated' && view.accountId) {
          session.ownedAccounts ||= new Set();
          session.ownedAccounts.add(view.accountId);
          res.setHeader('Set-Cookie', `sf_owned=${signOwnedCookie(session.ownedAccounts, session.isAdmin)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${origin?.startsWith('https:') ? '; Secure' : ''}`);
        }
        return json(res, 200, view);
      }
      if (url.pathname === '/api/steam/login-status' && req.method === 'GET') {
        const view = attemptView(findAttempt(url.searchParams.get('attemptId'), token));
        if (view.phase === 'authenticated' && view.accountId) {
          session.ownedAccounts ||= new Set();
          session.ownedAccounts.add(view.accountId);
          res.setHeader('Set-Cookie', `sf_owned=${signOwnedCookie(session.ownedAccounts, session.isAdmin)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${origin?.startsWith('https:') ? '; Secure' : ''}`);
        }
        return json(res, 200, view);
      }
      if (url.pathname === '/api/steam/cancel' && req.method === 'POST') { findAttempt(data.attemptId, token); cancelAttempt(data.attemptId); return json(res, 200, { success: true }); }
      if (url.pathname === '/api/steam/guard' && req.method === 'POST') {
        rate(`guard:${token}`, 8, 5 * 60000); const a = findAttempt(data.attemptId, token);
        if (a.phase !== 'guard') throw fail('This login attempt no longer accepts codes.');
        const code = text(data.code, 10); if (!/^[a-zA-Z0-9]{5}$/.test(code)) throw fail('Steam Guard codes must contain 5 characters.');
        try { await a.login.submitSteamGuardCode(code); if (a.phase === 'guard') a.phase = 'waiting'; } catch { throw fail('Incorrect or expired code. Please retry.'); }
        const view = attemptView(a);
        if (view.phase === 'authenticated' && view.accountId) {
          session.ownedAccounts ||= new Set();
          session.ownedAccounts.add(view.accountId);
          res.setHeader('Set-Cookie', `sf_owned=${signOwnedCookie(session.ownedAccounts, session.isAdmin)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${origin?.startsWith('https:') ? '; Secure' : ''}`);
        }
        return json(res, 200, view);
      }
      if (url.pathname === '/api/search' && req.method === 'GET') {
        rate(`search:${token}`, 30); const term = text(url.searchParams.get('term') || '', 100);
        if (!term) return json(res, 200, []);
        const cleanTerm = term.toLowerCase().trim();
        const idMatch = cleanTerm.match(/^(?:appid|id|#)?\s*(\d+)$/i);
        const searchedId = idMatch ? Number(idMatch[1]) : null;
        const relicMatches = [];
        for (const [idStr, rName] of Object.entries(RELIC_OFFICIAL_NAMES)) {
          const rId = Number(idStr);
          if (searchedId === rId || String(rId).startsWith(searchedId ? String(searchedId) : '___') || rName.toLowerCase().includes(cleanTerm) || (`id${rId}` === cleanTerm)) {
            relicMatches.push({
              id: rId,
              name: `${rName} (AppID #${rId} · Exclusivo Valve)`,
              img: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${rId}/header.jpg`,
              isRelic: true
            });
          }
        }
        let storeItems = [];
        try {
          const queryForStore = searchedId ? String(searchedId) : term;
          const r = JSON.parse((await remote(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(queryForStore)}&l=english&cc=UY`)).body);
          storeItems = (r.items || []).slice(0, 6).map(i => ({ id: i.id, name: i.name, img: i.tiny_image }));
        } catch {}
        const seen = new Set();
        const merged = [];
        for (const item of [...relicMatches.slice(0, 6), ...storeItems]) {
          if (!seen.has(Number(item.id))) {
            seen.add(Number(item.id));
            merged.push(item);
          }
        }
        if (searchedId && !seen.has(searchedId)) {
          merged.unshift({
            id: searchedId,
            name: RELIC_OFFICIAL_NAMES[searchedId] || `AppID #${searchedId}`,
            img: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${searchedId}/header.jpg`
          });
        }
        return json(res, 200, merged.slice(0, 8));
      }
      if (url.pathname === '/api/account/autopilot-rules' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        acc.autopilotRules = {
          autoRotateAtHours: Math.max(0, Math.min(10000, Number(data.autoRotateAtHours) || 0)),
          minHoursBeforePlatinum: Math.max(0, Math.min(500, Number(data.minHoursBeforePlatinum) || 0)),
          dynamicStatusRotator: Boolean(data.dynamicStatusRotator),
          autoPauseAfterDropDone: Boolean(data.autoPauseAfterDropDone)
        };
        if (acc.autopilotRules.dynamicStatusRotator && !acc.customStatus) {
          acc.customStatus = `⚡ SteamFarmer Cloud · ${(acc.games || []).length}/32 juegos`;
        }
        save();
        farming(acc, true);
        return json(res, 200, {
          success: true,
          autopilotRules: acc.autopilotRules,
          message: 'Reglas de Piloto Automático guardadas y activadas en tu cuenta.'
        });
      }
      if(url.pathname === '/api/game-requirements' && req.method === 'GET') {
        const id=appId(url.searchParams.get('appid'));const cached=requirementsCache.get(String(id));if(cached)return json(res,200,cached);
        rate(`requirements:${token}`,20,60000);
        if(!requirementsPending.has(id))requirementsPending.set(id,Promise.resolve().then(()=>requirementsRead(id)).then(result=>{requirementsCache.set(String(id),result);return result;}).finally(()=>requirementsPending.delete(id)));
        return json(res,200,await requirementsPending.get(id));
      }
      if(url.pathname==='/api/achievement/percentages'&&req.method==='GET'){
        const id=appId(url.searchParams.get('appid'));
        if(url.searchParams.get('accountId')==='demo'){
          const demoRes=await demoAchievementsRead(id,process.env.STEAM_API_KEY||'');
          const pctMap={};for(const a of demoRes.achievements||[]){if(a.apiname&&typeof a.percent==='number')pctMap[a.apiname]=a.percent;}
          return json(res,200,{appid:id,percentages:pctMap});
        }
        getAccount(req,url);rate(`percentages:${token}`,20,60000);
        const includeTitles=url.searchParams.get('titles')==='1',key=String(id)+(includeTitles?':titles':':api');
        const cached=url.searchParams.get('refresh')==='1'?null:percentageCache.get(key);if(cached)return json(res,200,cached);
        if(!percentagePending.has(key))percentagePending.set(key,(async()=>{
          const result=await percentagesRead(id,{includeTitles});if(Object.keys(result.percentages||{}).length||Object.keys(result.titlePercentages||{}).length)percentageCache.set(key,result);return result;
        })().finally(()=>percentagePending.delete(key)));
        return json(res,200,await percentagePending.get(key));
      }
      const achPathMatch = url.pathname.match(/^\/api\/achievements\/(\d+)$/);
      if ((url.pathname === '/api/achievements' || achPathMatch) && req.method === 'GET') {
        if (achPathMatch && !url.searchParams.get('appid')) url.searchParams.set('appid', achPathMatch[1]);
        if (!url.searchParams.get('accountId') && url.searchParams.get('account')) url.searchParams.set('accountId', url.searchParams.get('account'));
        rate(`ach:${token}`, 40);
        if (url.searchParams.get('accountId') === 'demo') {
          const id = appId(url.searchParams.get('appid'));
          const demoData = await demoAchievementsRead(id, process.env.STEAM_API_KEY || '');
          return json(res, 200, demoData);
        }
        const acc = getAccount(req, url); const st = stateFor(acc.id);
        const id = appId(url.searchParams.get('appid'));
        const requestedMethod = url.searchParams.get('method') || 'web';let method=requestedMethod;
        if (!['web','protocol','auto'].includes(method)) throw fail('Unknown achievement verification method.');
        if (method === 'protocol' && !st.connected) throw fail('Connect to Steam before using direct verification.', 409);
        const key = `${acc.id}:${id}:${st.steamId64 || acc.mySteamID || ''}:${st.webSessionVersion}:${method}`;
        const cached = achievementCache.get(key);
        const live=url.searchParams.get('live')==='1',known=url.searchParams.get('revision');
        if(known!==null&&!/^[a-f0-9]{64}$/.test(known))throw fail('Invalid achievement reading revision.');
        const readingRevision=result=>crypto.createHash('sha256').update(JSON.stringify([acc.id,id,st.steamId64||acc.mySteamID||'',revisionFor(result)])).digest('hex');
        const reply=result=>{
          const stateRevision=result.stateRevision||readingRevision(result),metadata={stateRevision,checkedAt:result.checkedAt,source:result.source,readingMethod:result.readingMethod,readDurationMs:result.readDurationMs,message:result.message||'',verified:result.verified};
          if(known===stateRevision)return {unchanged:true,...metadata};
          const delta=known&&cached?.stateRevision===known?changesBetween(cached.achievements,result.achievements):null;
          return {...result,stateRevision,...(delta?{observedChanges:{...delta,observedAt:result.checkedAt}}:{})};
        };
        const freshLive=url.searchParams.get('refresh')!=='1'&&cached&&Date.now()-Date.parse(cached.checkedAt)<5000;
        if(cached&&(live?freshLive:url.searchParams.get('refresh')!=='1'))return json(res,200,reply(cached));
        if (!achievementPending.has(key)) {
          releaseResource=budget.acquire('heavy');
          const readClient=clients.get(acc.id),readVersion=st.webSessionVersion;
          const readStarted=Date.now();
          const historyTask=st.connected&&readClient
            ?new Promise(resolve=>{
              const timer=setTimeout(()=>resolve({unavailable:true}),6000);
              Promise.resolve().then(()=>operations.latest(st.steamId64,id)).then(receipts=>{clearTimeout(timer);resolve({receipts});},()=>{clearTimeout(timer);resolve({unavailable:true});});
            })
            :Promise.resolve({receipts:new Map()});
          const task = Promise.resolve().then(async () => {
            const skipLib=Boolean(st.lastLockedAppId===id&&st.lastAchievementWrite&&Date.now()-st.lastAchievementWrite<300000);
            const syncWithSteamWebIfDisagreed=async protoRes=>{
              if(skipLib||!protoRes||protoRes.diagnostics?.method!=='ClientGetUserStats'||!Array.isArray(protoRes.achievements)||!protoRes.achievements.length)return protoRes;
              const protoUnlocked=protoRes.achievements.filter(a=>a.unlocked===true).length;
              const libUnlocked=protoRes.diagnostics?.librarySummary?.unlocked??null;
              if(libUnlocked===protoRes.achievements.length&&protoUnlocked<libUnlocked){
                for(const r of protoRes.achievements){if(!r.serverControlled){r.unlocked=true;r.removalSupport={...(r.removalSupport||{}),canRemove:true};}}
                protoRes.diagnostics.statsUnlocked=protoRes.achievements.filter(a=>a.unlocked===true).length;
                protoRes.stateConflict=false;protoRes.verified=true;
                return protoRes;
              }
              if((libUnlocked!==null&&libUnlocked>protoUnlocked)||(protoUnlocked===0&&(st.webCookies||process.env.STEAM_API_KEY))){
                try{
                  const webRes=await steamRead(acc,st,id,process.env.STEAM_API_KEY||'');
                  const webUnlockedRows=(webRes?.achievements||[]).filter(w=>w.unlocked===true);
                  if(webUnlockedRows.length>protoUnlocked){
                    const byApi=new Map(webUnlockedRows.filter(w=>w.apiname).map(w=>[w.apiname,w]));
                    const byTitle=new Map(webUnlockedRows.filter(w=>w.name).map(w=>[String(w.name).trim().toLowerCase(),w]));
                    for(const r of protoRes.achievements){
                      const match=(r.apiname&&byApi.get(r.apiname))||(r.name&&byTitle.get(String(r.name).trim().toLowerCase()));
                      if(match&&!r.serverControlled){
                        r.unlocked=true;
                        if(!r.unlockTimestamp&&match.unlockTimestamp)r.unlockTimestamp=match.unlockTimestamp;
                        if(!r.unlockDate&&match.unlockDate)r.unlockDate=match.unlockDate;
                        r.removalSupport={...(r.removalSupport||{}),canRemove:true};
                      }
                    }
                    protoRes.diagnostics.statsUnlocked=protoRes.achievements.filter(a=>a.unlocked===true).length;
                    protoRes.stateConflict=false;protoRes.verified=true;
                  }
                }catch{}
              }
              return protoRes;
            };
            if(requestedMethod==='auto'&&st.connected&&readClient){
              try{const result=await syncWithSteamWebIfDisagreed(await protocolRead(readClient,id,skipLib?{timeoutMs:2500,skipLibrarySummary:true}:{timeoutMs:2500}));if(result.verified||result.stateConflict){method='protocol';return result;}}
              catch{try{const result=await syncWithSteamWebIfDisagreed(await protocolRead(readClient,id,skipLib?{timeoutMs:4500,skipLibrarySummary:true}:{timeoutMs:4500}));if(result.verified||result.stateConflict){method='protocol';return result;}}catch{}}
              method='web';
            }
            else if(requestedMethod==='auto')method='web';
            if(method==='protocol')return syncWithSteamWebIfDisagreed(await protocolRead(readClient,id,skipLib?{skipLibrarySummary:true}:undefined));
            const webResult=await steamRead(acc,st,id,process.env.STEAM_API_KEY||'');
            if(st.connected&&readClient&&requestedMethod!=='auto'&&(!webResult.verified||(webResult.achievements?.length&&webResult.achievements.every(a=>!a.compatibility)))){
              try{
                const directResult=await protocolRead(readClient,id,{timeoutMs:6000});
                if(directResult.verified&&directResult.achievements?.some(a=>typeof a.unlocked==='boolean'&&a.apiname)){method='protocol';return directResult;}
              }catch{}
            }
            return webResult;
          }).then(async result => {
            result.readingMethod=method;
            if(!cfg.accounts.includes(acc)||states.get(acc.id)!==st||clients.get(acc.id)!==readClient||(method==='web'&&st.webSessionVersion!==readVersion))throw fail('The selected Steam session changed during verification. Refresh again.',409);
            let receipts=new Map(),historyUnavailable=false;
            if(method==='protocol'){const history=await historyTask;receipts=history.receipts||new Map();historyUnavailable=Boolean(history.unavailable);if(historyUnavailable)result.historyWarning='Persistent write history is unavailable. Achievement reads remain available, but activation is blocked.';}
            if(method==='protocol') for(const row of result.achievements||[]) {
              const receipt=receipts.get(row.apiname);
              const receiptConfirmed=!receipt||['confirmed','already_unlocked','observed_unlocked'].includes(receipt.outcome);
              const removed=receiptConfirmed&&receipt?.action==='remove'&&receipt.after===false;
              const pendingRemoval=removed&&!receipt.bulk&&!libraryCorroborates(result.diagnostics?.librarySummary,result.diagnostics?.statsUnlocked,result.achievements.length,receipt.verifiedAt||receipt.checkedAt);
              if(pendingRemoval){row.unlocked=null;row.unlockTimestamp=0;row.compatibility={status:'insufficient_data',code:'removal_library_pending',canUnlock:false,reason:'This removal is awaiting an updated Steam library reading.',action:'Check this achievement in Steam and refresh. No automatic retry is sent.'};if(row.progressSupport)row.progressSupport={...row.progressSupport,canComplete:false,canPreviewFloat:false,canPreviewShared:false};}
              const removalReason=historyUnavailable?'Recorded history could not be verified. Restore the history connection and refresh.':!receiptConfirmed?'A previous attempt needs review before another change.':row.removalSupport?.reason;
              const canDirectUnlock=!pendingRemoval&&!historyUnavailable&&row.unlocked===false&&!row.serverControlled&&Number.isInteger(row.statId)&&Number.isInteger(row.bitIndex)&&receiptConfirmed;
              row.batchSupport={canRemove:!pendingRemoval&&!historyUnavailable&&row.removalSupport?.canRemove===true&&receiptConfirmed,removalReason,canReactivate:!pendingRemoval&&!historyUnavailable&&(removed||canDirectUnlock)};
              if(receipt) row.lastWriteOutcome=receipt.outcome;
              if(receiptConfirmed&&row.unlocked===true&&receipt?.after===true&&receipt.before===false&&(!receipt.action||receipt.action==='unlock')){row.panelOperationAt=receipt.checkedAt;row.panelVerifiedAt=receipt.verifiedAt||null;}
              if(row.compatibility?.status==='provisional' && receiptConfirmed && receipt) row.compatibility={...row.compatibility,validatedOnAccount:true};
              if(receipt && !removed && !receiptConfirmed && row.unlocked!==true && row.compatibility) row.compatibility={...row.compatibility,status:receipt.outcome==='rejected'?'steam_rejected':receipt.outcome==='unknown'||receipt.outcome==='requested'?'pending_verification':'attempted',canUnlock:false,reason:receipt.message||'A write was already attempted for this achievement. The result must be checked; automatic retries are disabled.',code:receipt.diagnostic?.code||'previous_attempt',action:receipt.diagnostic?.action||'Refresh to verify the actual Steam state. A repeated write requires review.'};
              if(receipt&&!removed&&!receiptConfirmed&&row.unlocked!==true&&row.progressSupport)row.progressSupport={...row.progressSupport,canComplete:false,reason:row.compatibility.reason};
              if(historyUnavailable&&row.unlocked!==true){row.compatibility={status:'insufficient_data',code:'history_unavailable',canUnlock:false,reason:result.historyWarning,action:'Restore the persistent history connection before activating achievements.'};if(row.progressSupport)row.progressSupport={...row.progressSupport,canComplete:false};}
            }
            const pendingRemovals=(result.achievements||[]).filter(r=>r.compatibility?.code==='removal_library_pending').length;
            if(pendingRemovals&&!result.stateConflict){result.verified=false;result.message=`${pendingRemovals} achievement${pendingRemovals===1?' is':'s are'} awaiting removal confirmation. The other achievements remain available. Check Steam and refresh after making changes there.`;}
            result.readDurationMs=Date.now()-readStarted;
            result.stateRevision=readingRevision(result);if(!historyUnavailable&&!(requestedMethod==='auto'&&method==='web'&&st.connected))achievementCache.set(key, result);
            console.log(`[Achievements] account=${acc.id} app=${id} source=${result.source || 'none'} verified=${Boolean(result.verified)} durationMs=${result.readDurationMs} webSession=${Boolean(st.webCookies)}`);
            if(result.diagnostics?.retainedUnlockDateCount)console.log('[Achievement state evidence]',JSON.stringify({appid:id,count:result.diagnostics.retainedUnlockDateCount,rows:result.diagnostics.retainedUnlockDates}));
            if(result.diagnostics?.librarySummary)console.log('[Achievement library summary]',JSON.stringify({appid:id,statistics:result.diagnostics.statsUnlocked,summary:result.diagnostics.librarySummary,conflict:result.stateConflict}));
            if (result.outcome === 'catalog' && st.connected && Date.now() - st.lastWebRefresh > 120000) { st.lastWebRefresh = Date.now(); try { clients.get(acc.id)?.webLogOn(); } catch {} }
            return result;
          }).finally(() => achievementPending.delete(key));
          achievementPending.set(key, task);
        }
        return json(res, 200, reply(await achievementPending.get(key)));
      }
                  if(url.pathname==='/api/game/inspect-start'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id);
        const id=appId(data.appid);
        if(Boolean(data.stealth))return json(res,200,{success:true,stealth:true,appid:id,playedGames:st.playedGames});
        if(!st.connected||!client||st.isCollisionPaused||st.isSleepPaused)return json(res,200,{success:false,appid:id,playedGames:st.playedGames});
        if(!Array.isArray(st.inspectPreviousGames))st.inspectPreviousGames=[...st.playedGames];
        st.inspectingAppId=id;
        const merged=[id,...st.playedGames.filter(x=>x!==id)].slice(0,32);
        try{
          client.gamesPlayed(merged);
          st.playedGames=merged;
          if(!st.isFarming)st.sessionStartTime=Date.now();
          st.isFarming=merged.filter(x=>typeof x==='number').length>0;
        }catch{}
        return json(res,200,{success:true,inspecting:true,appid:id,playedGames:st.playedGames});
      }
      if(url.pathname==='/api/game/inspect-stop'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id);
        st.inspectingAppId=null;
        if(Array.isArray(st.inspectPreviousGames)){
          const restored=st.inspectPreviousGames;
          st.inspectPreviousGames=null;
          if(st.connected&&client&&!st.isCollisionPaused&&!st.isSleepPaused){
            try{
              client.gamesPlayed(restored);
              st.playedGames=restored;
              st.isFarming=restored.filter(x=>typeof x==='number').length>0;
              if(!st.isFarming)st.sessionStartTime=null;
            }catch{}
          }else{
            farming(acc,true);
          }
        }else{
          farming(acc,true);
        }
        return json(res,200,{success:true,restored:true,playedGames:st.playedGames});
      }
      if(url.pathname==='/api/cards/estimate'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id);
        const steamid=st.steamId64||acc.mySteamID;
        if(!st.connected||!st.webCookies||!steamid)throw fail('Connect to Steam with an active web session to estimate card earnings.',409);
        rate(`cards-est:${acc.id}`,15,60000);
        const inv=await cardsInventoryRead(steamid,st.webCookies);
        const customBuyerCents=url.searchParams.get('buyerCents')?Number(url.searchParams.get('buyerCents')):null;
        const estimate=estimateCardBatchNet(inv.cards,{customBuyerCents});
        return json(res,200,{steamid,totalCards:inv.totalCards,...estimate,checkedAt:new Date().toISOString()});
      }
      if(url.pathname==='/api/badges/craft'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id);
        const steamid=st.steamId64||acc.mySteamID;
        if(!st.connected||!st.webCookies||!steamid)throw fail('Connect to Steam with an active web session to craft badges.',409);
        rate(`badge-craft:${acc.id}`,10,60000);
        const id=appId(data.appid);
        const result=await badgeCraft(steamid,st.webCookies,{appid:id,series:Number(data.series)||1,borderColor:Number(data.borderColor)||0});
        if(result.success&&Array.isArray(st.craftableBadges)){
          st.craftableBadges=st.craftableBadges.filter(b=>b.appid!==id);
        }
        return json(res,200,result);
      }
      if(url.pathname==='/api/cluster/status'&&req.method==='GET'){
        const scopedList=visibleAccountsForSession(session);
        const pubAccounts=scopedList.map(publicAccount);
        return json(res,200,{
          totalAccounts:pubAccounts.length,
          connectedCount:pubAccounts.filter(a=>a.connected).length,
          farmingCount:pubAccounts.filter(a=>a.isFarming).length,
          totalRunningGames:pubAccounts.reduce((n,a)=>n+(a.runningGames?.length||0),0),
          totalPendingCards:pubAccounts.reduce((n,a)=>n+(a.cardDropGames||[]).reduce((s,g)=>s+(g.remaining||0),0),0),
          accounts:pubAccounts
        });
      }
      if(url.pathname==='/api/cluster/action'&&req.method==='POST'){
        const clusterAction=text(String(data.action||'start_all'),32);
        if(!['start_all','resume_all','pause_all','cards_on_all'].includes(clusterAction))throw fail('Unknown cluster action.',400);
        const scopedAccounts=visibleAccountsForSession(session);
        let affected=0;
        for(const acc of scopedAccounts){
          const st=stateFor(acc.id);
          if(clusterAction==='pause_all'){
            st.isPaused=true;acc.paused=true;farming(acc,true);affected++;
          }else if(clusterAction==='start_all'||clusterAction==='resume_all'){
            st.isPaused=false;acc.paused=false;
            if(!st.connected&&isAuthorizedAccount(acc)&&options.connect!==false)connect(acc);
            farming(acc,true);affected++;
          }else if(clusterAction==='cards_on_all'){
            acc.cardFarming=true;st.isPaused=false;acc.paused=false;farming(acc,true);
            if(st.connected&&st.webCookies)scan(acc).catch(()=>{});
            affected++;
          }
        }
        save();
        const pubAccounts=scopedAccounts.map(publicAccount);
        return json(res,200,{
          success:true,
          action:clusterAction,
          affected,
          accounts:pubAccounts,
          message:`Cluster action "${clusterAction}" applied across ${affected} profile${affected===1?'':'s'}.`
        });
      }
      if(url.pathname==='/api/cards/inventory'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id);
        const steamid=st.steamId64||acc.mySteamID;
        if(!st.connected||!st.webCookies||!steamid)throw fail('Connect to Steam with an active web session to read your card inventory.',409);
        rate(`cards-inv:${acc.id}`,15,60000);
        const result=await cardsInventoryRead(steamid,st.webCookies);
        return json(res,200,result);
      }
      if(url.pathname==='/api/cards/sell'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id);
        const steamid=st.steamId64||acc.mySteamID;
        if(!st.connected||!st.webCookies||!steamid)throw fail('Connect to Steam with an active web session to sell trading cards.',409);
        rate(`cards-sell:${acc.id}`,10,60000);
        const rawSecret=typeof data.identitySecret==='string'&&data.identitySecret.trim()?text(data.identitySecret.trim(),128):'';
        if(rawSecret)vault.set(acc.id+':identity_secret',rawSecret);
        const identitySecret=rawSecret||vault.get(acc.id+':identity_secret')||'';
        const result=await cardsQuickSell(steamid,st.webCookies,{
          assetids:Array.isArray(data.assetids)?data.assetids:null,
          customPriceCents:data.priceCents?Number(data.priceCents):null,
          currency:Number(data.currency)||1,
          maxCards:Number(data.maxCards)||25,
          identitySecret
        });
        return json(res,200,{
          ...result,
          message:`Listed ${result.soldCount}/${result.processedCount} card${result.processedCount===1?'':'s'} on the Steam Market${result.autoConfirmedCount?` (${result.autoConfirmedCount} auto-confirmed via 2FA)`:result.requiresConfirmationCount?` (${result.requiresConfirmationCount} awaiting Steam Guard mobile confirmation)`:''}.`
        });
      }
      if(url.pathname==='/api/stats'&&req.method==='GET'){
        if(url.searchParams.get('accountId')==='demo'){
          const id=appId(url.searchParams.get('appid'));
          const demoData=await demoAchievementsRead(id,process.env.STEAM_API_KEY||'');
          return json(res,200,{appid:id,demoMode:true,checkedAt:new Date().toISOString(),stats:demoData.statistics||[]});
        }
        const acc=getAccount(req,url),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||!identity)throw fail('Reading statistics requires the connected main Steam account.',409);
        rate(`stats-read:${acc.id}`,30,60000);
        const id=appId(url.searchParams.get('appid'));
        const snapshot=await progressSnapshotRead(client,id);
        if(!cfg.accounts.includes(acc)||clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected)throw fail('The Steam session changed while reading statistics.',409);
        const parsed=parseGameStats(snapshot,id);
        return json(res,200,{appid:id,checkedAt:new Date().toISOString(),crcStats:parsed.crcStats,stats:parsed.stats});
      }
      if((url.pathname==='/api/stats'||url.pathname==='/api/achievement/wipe')&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Editing statistics requires the available connected main Steam account.',409);
        rate(`stats-write:${acc.id}`,20,60000);
        const id=appId(data.appid),resetAll=Boolean(url.pathname==='/api/achievement/wipe'||data.wipeStats||data.resetAll||data.action==='reset_all'),stealth=Boolean(data.stealth);
        if(experimentBusy.has(acc.id))throw fail('An operation is already running.',409);
        const existingUndoJob=timedManager.status(acc.id,id);
        if(existingUndoJob?.active)console.log(`[TimedSync] Manual achievement undo detected on app ${id}. Cancelling pending timed schedule.`);
        timedManager.cancel(acc.id,id);
        experimentBusy.add(acc.id);
        try{
          assertPanelSession();
          const result=await statsWrite(client,id,data.changes,{resetAll,stealth});
          st.lastAchievementWrite=Date.now();
          if(resetAll)st.lastLockedAppId=id;
          return json(res,200,result);
        }finally{experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();if(st.inspectingAppId===id&&Array.isArray( data?.selection )&&data.selection.some(s=>s?.action==='remove')||data?.bulkAction==='lock_all'){st.inspectingAppId=null;st.inspectPreviousGames=null;try{if(!stealth&&client?.gamesPlayed)client.gamesPlayed([]);}catch{}}farming(acc,true);}
      }
      if(url.pathname==='/api/achievement/analytics'&&req.method==='GET'){
        if(url.searchParams.get('accountId')==='demo'){
          const id=appId(url.searchParams.get('appid'));
          const demoData=await demoAchievementsRead(id,process.env.STEAM_API_KEY||'');
          return json(res,200,{appid:id,demoMode:true,checkedAt:new Date().toISOString(),canUndo:false,...computeAchievementAnalytics(demoData.achievements||[],demoData.statistics||[])});
        }
        const acc=getAccount(req,url),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||!identity)throw fail('Analytics requires the connected main Steam account.',409);
        rate(`ach-analytics:${acc.id}`,20,60000);
        const id=appId(url.searchParams.get('appid'));
        const snapshot=await progressSnapshotRead(client,id);
        const view=parseSnapshot(snapshot,id);
        return json(res,200,{appid:id,checkedAt:new Date().toISOString(),canUndo:lastOperations.has(`${acc.id}:${id}`),...computeAchievementAnalytics(view.achievements,view.statistics)});
      }
      if(url.pathname==='/api/achievement/undo'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Undo requires the available connected main Steam account.',409);
        rate(`ach-undo:${acc.id}`,15,60000);
        const id=appId(data.appid),stealth=Boolean(data.stealth);
        const last=lastOperations.get(`${acc.id}:${id}`);
        if(!last||!Array.isArray(last.selection)||!last.selection.length)throw fail('No recent operation is recorded to undo for this game.',404);
        if(experimentBusy.has(acc.id))throw fail('An operation is already running.',409);
        experimentBusy.add(acc.id);
        try{
          const [snapshot,receipts]=await Promise.all([progressSnapshotRead(client,id),operations.latest(identity,id)]);
          const view=parseSnapshot(snapshot,id);
          const byApi=new Map(view.achievements.map(a=>[a.apiname,a]));
          const invertSel=last.selection
            .map(s=>({apiname:s.apiname,action:s.action==='unlock'?'remove':'unlock'}))
            .filter(s=>{const row=byApi.get(s.apiname);return row&&row.unlocked===(s.action==='remove');});
          if(!invertSel.length)throw fail('The achievements from the last operation are already in their previous state.',409);
          const resetCounters=invertSel.some(s=>s.action==='remove');
          const plan=prepareChanges(snapshot,id,invertSel,receipts,undefined,{bulk:true,resetCounters,allowRetoggle:true});
          const hasSchema=await operations.schema();
          const result=await changesWrite(client,id,invertSel,{expectedRevision:plan.revision,bulk:true,resetCounters,allowRetoggle:true,overrideCooldown:true,stealth,readHistory:()=>operations.latest(identity,id),beforeSend:async p=>hasSchema?operations.reserve(identity,p,{overrideCooldown:true}):cleanOperation({...p,operationId:crypto.randomUUID(),checkedAt:new Date().toISOString(),outcome:'requested'})});
          if(hasSchema)try{await operations.finish(identity,result);}catch{}
          lastOperations.delete(`${acc.id}:${id}`);
          return json(res,200,{...result,undoneCount:invertSel.length,message:`Undid ${invertSel.length} achievement change${invertSel.length===1?'':'s'}.`});
        }finally{experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();farming(acc,true);}
      }
      if(url.pathname==='/api/achievement/copy-timings'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Copying user timings requires the available connected main Steam account.',409);
        rate(`copy-timings:${acc.id}`,18,60000);
        const sourceInput=String(data.source||'').trim();
        if(!sourceInput||sourceInput.length>262144)throw fail('Pegá el enlace de un perfil (SteamHunters, SteamCommunity o SteamID64).',400);
        const urlAppMatch=sourceInput.match(/\/(?:apps|stats)\/(\d{1,10})(?:\b|\/|$)/i);
        const detectedAppId=urlAppMatch?Number(urlAppMatch[1]):null;
        const id=appId(data.appid||detectedAppId),stealth=Boolean(data.stealth);
        let rawPayload=sourceInput;
        let donorLabel=sourceInput.slice(0,64);
        const donorCacheKey=`${id}:${sourceInput.slice(0,256)}`;
        const cachedDonorFetch=donorFetchCache.get(donorCacheKey);
        if(cachedDonorFetch?.rawPayload){
          rawPayload=cachedDonorFetch.rawPayload;
          if(cachedDonorFetch.donorLabel)donorLabel=cachedDonorFetch.donorLabel;
        }else if(!sourceInput.startsWith('<')&&!sourceInput.startsWith('{')&&!sourceInput.startsWith('[')){
          let targetUrl=null;
          let fallbackSteamHuntersUrl=/^https?:\/\/(?:www\.)?steamhunters\.com\//i.test(sourceInput)?sourceInput:null;
          const sid64Match=sourceInput.match(/(7656119\d{10})/);
          const steamUrlMatch=sourceInput.match(/https?:\/\/(?:www\.)?(?:steamcommunity\.com|steamhunters\.com)\/(id|profiles)\/([^/?#]+)/i);
          if(sid64Match){
            donorLabel=`SteamID ${sid64Match[1]}`;
            targetUrl=`https://steamcommunity.com/profiles/${sid64Match[1]}/stats/${id}/?xml=1`;
          }else if(steamUrlMatch){
            const kind=steamUrlMatch[1].toLowerCase()==='profiles'?'profiles':'id';
            const ident=steamUrlMatch[2];
            donorLabel=ident;
            targetUrl=`https://steamcommunity.com/${kind}/${encodeURIComponent(ident)}/stats/${id}/?xml=1`;
          }else if(fallbackSteamHuntersUrl){
            try{
              const shPage=await remote(fallbackSteamHuntersUrl,{maxBytes:512*1024});
              const shSid=shPage.body.match(/(7656119\d{10})/);
              if(shSid){
                donorLabel=`SteamHunters (${shSid[1]})`;
                targetUrl=`https://steamcommunity.com/profiles/${shSid[1]}/stats/${id}/?xml=1`;
              }
            }catch{}
            if(!targetUrl)throw fail('No se pudo extraer el SteamID64 de ese enlace de SteamHunters. Copiá el link del perfil del jugador (ej. steamhunters.com/id/... o steamcommunity.com/id/...).',400);
          }else if(/^[a-zA-Z0-9_-]{2,64}$/.test(sourceInput)){
            donorLabel=sourceInput;
            targetUrl=`https://steamcommunity.com/id/${encodeURIComponent(sourceInput)}/stats/${id}/?xml=1`;
          }else{
            throw fail('Ingresá un enlace válido de SteamHunters, SteamCommunity, un SteamID64 de 17 dígitos o tu nombre personalizado.',400);
          }
          let fetched=null;
          try{
            fetched=await remote(targetUrl,{maxBytes:512*1024});
          }catch(fetchErr){
            if(fallbackSteamHuntersUrl){
              try{
                const shPage=await remote(fallbackSteamHuntersUrl,{maxBytes:512*1024});
                const shSid=shPage.body.match(/(7656119\d{10})/);
                if(shSid){
                  donorLabel=`${donorLabel} (${shSid[1]})`;
                  fetched=await remote(`https://steamcommunity.com/profiles/${shSid[1]}/stats/${id}/?xml=1`,{maxBytes:512*1024});
                }
              }catch{}
            }
            if(!fetched)throw fetchErr;
          }
          rawPayload=fetched.body;
          if((/<error>/i.test(rawPayload)||!/<achievement\b/i.test(rawPayload))&&fallbackSteamHuntersUrl){
            try{
              const shPage=await remote(fallbackSteamHuntersUrl,{maxBytes:512*1024});
              const shSid=shPage.body.match(/(7656119\d{10})/);
              if(shSid){
                const retryFetched=await remote(`https://steamcommunity.com/profiles/${shSid[1]}/stats/${id}/?xml=1`,{maxBytes:512*1024});
                if(/<achievement\b/i.test(retryFetched.body))rawPayload=retryFetched.body;
              }
            }catch{}
          }
          if(/<privacyState>\s*(private|friendsonly)\s*<\/privacyState>/i.test(rawPayload)){
            throw fail('Ese perfil de jugador tiene las estadísticas de juegos en privado en Steam. Elegí otro jugador de la lista de SteamHunters.',409);
          }
          donorFetchCache.set(donorCacheKey,{rawPayload,donorLabel,cachedHoursPlayed:null});
        }
        const snapshot=await progressSnapshotRead(client,id,{skipLibrarySummary:true});
        const view=parseSnapshot(snapshot,id);
        const includeAlreadyUnlockedReq=Boolean(data.includeAlreadyUnlocked);
        const donorReport=require('./lib/steam-protocol').parseDonorProfileReport(rawPayload,view.achievements,{includeAlreadyUnlocked:includeAlreadyUnlockedReq});
        let timings=donorReport.timings;
        let autoIncludedUnlocked=false;
        if(!timings.length&&donorReport.allDonorUnlocked.length){
          timings=donorReport.allDonorUnlocked.filter(e=>!e.serverControlled).map(e=>({apiname:e.apiname,unlockTimestamp:e.unlockTimestamp,alreadyUnlockedByUser:e.alreadyUnlockedByUser}));
          autoIncludedUnlocked=true;
        }
        if(!timings.length)throw fail('No se encontraron logros con fecha pública en ese perfil para este juego (verificá que el jugador tenga sus detalles de juego públicos en Steam).',409);
        if(donorReport.donorName)donorLabel=donorReport.donorName;

        // Si el XML de stats no trajo <hoursOnRecord>, buscar el Playtime real del donante en /games?tab=all&xml=1 o en SteamHunters
        if(donorReport.donorHoursPlayed==null&&cachedDonorFetch?.cachedHoursPlayed!=null){
          donorReport.donorHoursPlayed=cachedDonorFetch.cachedHoursPlayed;
        }
        if(donorReport.donorHoursPlayed==null&&!sourceInput.startsWith('<')&&!sourceInput.startsWith('{')&&!sourceInput.startsWith('[')){
          const lookupPromises=[];
          if(donorReport.donorSteamId64){
            lookupPromises.push(
              remote(`https://steamcommunity.com/profiles/${donorReport.donorSteamId64}/games?tab=all&xml=1`,{timeoutMs:3500,maxBytes:1024*1024})
                .then(gRes=>{
                  const gRx=new RegExp(`<game>[\\s\\S]*?<appID>\\s*${id}\\s*<\\/appID>[\\s\\S]*?<\\/game>`,'i');
                  const gMatch=gRes.body.match(gRx);
                  if(gMatch){
                    const hMatch=gMatch[0].match(/<hoursOnRecord>\s*([\d.,]+)\s*<\/hoursOnRecord>/i);
                    if(hMatch){
                      const parsed=Number(String(hMatch[1]).replace(/,/g,''));
                      if(Number.isFinite(parsed)&&parsed>0)donorReport.donorHoursPlayed=parsed;
                    }
                  }
                })
                .catch(()=>{})
            );
          }
          if(/^https?:\/\/(?:www\.)?steamhunters\.com\//i.test(sourceInput)){
            lookupPromises.push(
              remote(sourceInput,{timeoutMs:3500,maxBytes:512*1024})
                .then(shRes=>{
                  const ptMatch=shRes.body.match(/(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*playtime/i);
                  if(ptMatch){
                    const hrs=Number(ptMatch[1])+(ptMatch[2]?Number(ptMatch[2])/60:0);
                    if(Number.isFinite(hrs)&&hrs>0&&donorReport.donorHoursPlayed==null){
                      donorReport.donorHoursPlayed=Number(hrs.toFixed(1));
                    }
                  }
                })
                .catch(()=>{})
            );
          }
          if(lookupPromises.length)await Promise.allSettled(lookupPromises);
          if(donorReport.donorHoursPlayed!=null){
            donorFetchCache.set(donorCacheKey,{rawPayload,donorLabel,cachedHoursPlayed:donorReport.donorHoursPlayed});
          }
        }

        if(data.realisticDonor){
          let percentagesMap=data.percentages&&typeof data.percentages==='object'&&Object.keys(data.percentages).length?data.percentages:(percentageCache.get(String(id)+':api')?.percentages||null);
          if(!percentagesMap){
            try{
              const pctRes=await percentagesRead(id,{includeTitles:false});
              if(pctRes?.percentages&&typeof pctRes.percentages==='object'){
                percentagesMap=pctRes.percentages;
                if(Object.keys(percentagesMap).length)percentageCache.set(String(id)+':api',pctRes);
              }
            }catch{}
          }
          const achievementsByApi=new Map((view.achievements||[]).map(a=>[a.apiname,a]));
          const nowMs=Date.now();
          const skipDateSpecific=data.skipDateSpecific!==false;
          const compressHiatus=Boolean(data.compressHiatus);
          const userTargetPlaytime=Number(data.targetPlaytimeHours||0)>0?Number(data.targetPlaytimeHours):null;
          const donorSched=require('./lib/steam-protocol').buildDonorRealisticSchedule(timings,{
            achievementsByApi,
            percentagesMap,
            skipDateSpecific,
            compressHiatus,
            donorReport,
            targetPlaytimeHours:userTargetPlaytime,
            currentFarmedHours:Number(data.currentFarmedHours)||0,
            baseNowMs:nowMs
          });
          const previewQueue=donorSched.items.map((it,idx)=>({
            step:idx+1,
            apiname:it.apiname,
            name:it.name||it.apiname,
            percent:it.percent??null,
            donorUnlockedAt:it.donorUnlockTimestamp?new Date(it.donorUnlockTimestamp*1000).toISOString():null,
            donorDeltaFromPrevSec:it.donorDeltaFromPrevSec??0,
            donorDeltaFromStartSec:it.donorDeltaFromStartSec??0,
            donorDeltaLabelEs:it.donorDeltaLabelEs||'',
            alreadyUnlockedByUser:Boolean(it.alreadyUnlockedByUser),
            sessionIndex:it.sessionIndex||1,
            isSessionStart:Boolean(it.isSessionStart),
            isSessionEnd:Boolean(it.isSessionEnd),
            sessionStartAt:it.sessionStartAt||null,
            sessionEndAt:it.sessionEndAt||null,
            sessionDurationHours:it.sessionDurationHours||null,
            offsetMs:donorSched.customDelaysMs[idx]||0,
            estimatedAt:new Date(nowMs+(donorSched.customDelaysMs[idx]||0)).toISOString()
          }));
          const skippedList=(donorSched.skippedSpecial||[]).map(it=>({
            apiname:it.apiname,
            name:it.name||it.apiname,
            percent:it.percent??null,
            label:it.specialCondition?.label||'📅 Fecha/Evento Especial',
            reasonEs:it.specialCondition?.reasonEs||''
          }));
          const commonDonorMeta={
            donorMode:true,
            donorLabel,
            donorName:donorReport.donorName||donorLabel,
            donorSteamId:donorReport.donorSteamId64||null,
            donorHoursPlayed:donorReport.donorHoursPlayed??donorSched.donorPlaytimeHours??null,
            donorHoursLast2Weeks:donorReport.donorHoursLast2Weeks??null,
            donorTotalUnlockedCount:donorReport.donorTotalUnlockedCount,
            donorFirstUnlockAt:donorReport.donorFirstUnlockAt,
            donorLastUnlockAt:donorReport.donorLastUnlockAt,
            donorFullDurationTextEs:donorSched.donorFullDurationTextEs||donorReport.donorFullDurationTextEs,
            donorFullDaysExact:donorReport.donorFullDaysExact,
            donorFullHoursExact:donorReport.donorFullHoursExact,
            durationTextEs:donorSched.durationTextEs,
            plannedPlaytimeHours:donorSched.plannedPlaytimeHours,
            donorPlaytimeHours:donorSched.donorPlaytimeHours,
            sessionCount:donorSched.sessionCount,
            sessions:donorSched.sessions,
            estimatedHours:donorSched.estimatedHours,
            estimatedDays:donorSched.estimatedDays,
            estimatedMonths:donorSched.estimatedMonths,
            includeAlreadyUnlocked:Boolean(includeAlreadyUnlockedReq||autoIncludedUnlocked),
            detectedAppId:detectedAppId||id
          };
          if(data.action==='preview'){
            return json(res,200,{
              preview:true,
              ...commonDonorMeta,
              appid:id,
              totalGameAchievements:(view.achievements||[]).length,
              alreadyUnlockedCount:(view.achievements||[]).filter(a=>a.unlocked===true).length,
              pendingCount:donorReport.pendingTimings.length,
              scheduledCount:previewQueue.length,
              skippedSpecialCount:skippedList.length,
              skippedSpecial:skippedList,
              summaryTextEs:donorSched.summaryTextEs,
              queue:previewQueue
            });
          }
          if(!donorSched.items.length)throw fail('Todos los logros restantes en ese perfil corresponden a eventos de fecha específica protegidos.',409);
          if((includeAlreadyUnlockedReq||autoIncludedUnlocked)&&(view.achievements||[]).some(a=>a.unlocked===true)){
            try{
              const receipts=await operations.latest(identity,id);
              const lockSel=buildBulkSelection(snapshot,id,'lock_all',receipts,{allowRetoggle:true,forceLockAll:true});
              await changesWrite(client,id,lockSel,{expectedRevision:undefined,bulk:true,resetCounters:true,wipeStats:true,allowRetoggle:true,overrideCooldown:true,stealth});
            }catch{}
          }
          const status=timedManager.start({
            accountId:acc.id,
            appid:id,
            items:donorSched.items,
            customDelaysMs:donorSched.customDelaysMs,
            sessions:donorSched.sessions,
            plannedPlaytimeHours:donorSched.plannedPlaytimeHours,
            donorPlaytimeHours:donorSched.donorPlaytimeHours,
            estimatedDays:donorSched.estimatedDays,
            summaryTextEs:donorSched.summaryTextEs,
            spacing:'copied',
            order:'copied',
            stealth,
            pausedByCollision:Boolean(st.isCollisionPaused),
            executeItem:makeTimedItemExecutor(acc.id,id,stealth)
          });
          return json(res,200,{
            ...status,
            ...commonDonorMeta,
            copiedCount:donorSched.items.length,
            totalGameAchievements:(view.achievements||[]).length,
            alreadyUnlockedCount:(view.achievements||[]).filter(a=>a.unlocked===true).length,
            pendingCount:donorReport.pendingTimings.length,
            scheduledCount:previewQueue.length,
            skippedSpecial:skippedList,
            summaryTextEs:donorSched.summaryTextEs,
            queue:previewQueue,
            message:donorSched.summaryTextEs
          });
        }

        const minTs=timings[0].unlockTimestamp,maxTs=timings[timings.length-1].unlockTimestamp;
        const rawSpanMs=Math.max(0,(maxTs-minTs)*1000);
        const maxWindowMinutes=Math.max(1,Math.min(1440,Number(data.maxMinutes||60)));
        const maxWindowMs=maxWindowMinutes*60000;
        const scale=rawSpanMs>maxWindowMs?maxWindowMs/rawSpanMs:1;
        const customDelaysMs=timings.map(t=>Math.trunc((t.unlockTimestamp-minTs)*1000*scale));
        const items=timings.map(t=>({apiname:t.apiname,action:'unlock'}));
        const status=timedManager.start({
          accountId:acc.id,
          appid:id,
          items,
          customDelaysMs,
          spacing:'copied',
          order:'copied',
          stealth,
          pausedByCollision:Boolean(st.isCollisionPaused),
          executeItem:makeTimedItemExecutor(acc.id,id,stealth)
        });
        return json(res,200,{...status,copiedCount:items.length,message:`Copied unlock timings for ${items.length} achievement${items.length===1?'':'s'} and started replay schedule.`});
      }
      if(url.pathname==='/api/achievement/bulk-apps'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Multi-app bulk operations require the available connected main Steam account.',409);
        rate(`bulk-apps:${acc.id}`,6,60000);
        const mode=data.bulkAction==='lock_all'?'lock_all':'unlock_all';
        const stealth=Boolean(data.stealth);
        const targetApps=(Array.isArray(data.appids)&&data.appids.length?data.appids.map(appId):acc.games).slice(0,32);
        if(!targetApps.length)throw fail('Add at least one game to your list first.',400);
        if(experimentBusy.has(acc.id))throw fail('An operation is already running.',409);
        experimentBusy.add(acc.id);
        const results=[];
        try{
          const hasSchema=await operations.schema();
          for(const id of targetApps){
            try{
              const existingBulkJob=timedManager.status(acc.id,id);
              if(existingBulkJob?.active)console.log(`[TimedSync] Manual bulk achievement changes detected on app ${id}. Cancelling pending timed schedule.`);
              timedManager.cancel(acc.id,id);
              const [snapshot,receipts]=await Promise.all([progressSnapshotRead(client,id,{timeoutMs:6000}),operations.latest(identity,id)]);
              const forceLockAll=mode==='lock_all';
              const sel=buildBulkSelection(snapshot,id,mode,receipts,{allowRetoggle:true,forceLockAll});
              const resetCounters=mode==='lock_all';
              const plan=prepareChanges(snapshot,id,sel,receipts,undefined,{bulk:true,resetCounters,allowRetoggle:true,forceLockAll});
              const r=await changesWrite(client,id,sel,{expectedRevision:plan.revision,bulk:true,bulkAction:mode,wipeStats:forceLockAll,forceLockAll,resetCounters,allowRetoggle:true,overrideCooldown:true,stealth,readHistory:()=>operations.latest(identity,id),beforeSend:async p=>hasSchema?operations.reserve(identity,p,{overrideCooldown:true}):cleanOperation({...p,operationId:crypto.randomUUID(),checkedAt:new Date().toISOString(),outcome:'requested'})});
              if(hasSchema)try{await operations.finish(identity,r);}catch{}
              results.push({appid:id,outcome:r.outcome,count:sel.length});
            }catch(e){
              results.push({appid:id,outcome:'skipped',reason:e.message});
            }
          }
          const updatedGames=results.filter(r=>r.outcome==='confirmed').length;
          return json(res,200,{mode,updatedGames,totalGames:targetApps.length,results,message:`Processed ${targetApps.length} game${targetApps.length===1?'':'s'}: ${updatedGames} updated on Steam.`});
        }finally{experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();farming(acc,true);}
      }
      if(url.pathname==='/api/achievement/export'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||!identity)throw fail('Exporting requires the connected main Steam account.',409);
        rate(`ach-export:${acc.id}`,20,60000);
        const id=appId(url.searchParams.get('appid'));
        const snapshot=await progressSnapshotRead(client,id);
        return json(res,200,exportGameData(snapshot,id));
      }
      if(url.pathname==='/api/achievement/import'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Importing requires the available connected main Steam account.',409);
        rate(`ach-import:${acc.id}`,10,60000);
        const id=appId(data.appid),stealth=Boolean(data.stealth);
        if(experimentBusy.has(acc.id))throw fail('An operation is already running.',409);
        const existingImportJob=timedManager.status(acc.id,id);
        if(existingImportJob?.active)console.log(`[TimedSync] Manual achievement import detected on app ${id}. Cancelling pending timed schedule.`);
        timedManager.cancel(acc.id,id);
        experimentBusy.add(acc.id);
        try{
          let achievementsApplied=0,statsApplied=0;
          if(Array.isArray(data.achievements)&&data.achievements.length){
            const snapshot=await progressSnapshotRead(client,id);
            const view=parseSnapshot(snapshot,id);
            const currentByApi=new Map(view.achievements.map(a=>[a.apiname,a]));
            const toChange=[];
            for(const item of data.achievements){
              if(!item||typeof item.apiname!=='string')continue;
              const cur=currentByApi.get(item.apiname);
              if(!cur||cur.serverControlled)continue;
              const wantUnlocked=Boolean(item.unlocked);
              if(cur.unlocked!==wantUnlocked)toChange.push({apiname:item.apiname,action:wantUnlocked?'unlock':'remove'});
            }
            if(toChange.length){
              const receipts=await operations.latest(identity,id);
              const plan=prepareChanges(snapshot,id,toChange,receipts,undefined,{bulk:true,resetCounters:true,allowRetoggle:true});
              const hasSchema=await operations.schema();
              const resAch=await changesWrite(client,id,toChange,{expectedRevision:plan.revision,bulk:true,resetCounters:true,allowRetoggle:true,overrideCooldown:true,stealth,readHistory:()=>operations.latest(identity,id),beforeSend:async p=>hasSchema?operations.reserve(identity,p,{overrideCooldown:true}):cleanOperation({...p,operationId:crypto.randomUUID(),checkedAt:new Date().toISOString(),outcome:'requested'})});
              if(hasSchema)try{await operations.finish(identity,resAch);}catch{}
              lastOperations.set(`${acc.id}:${id}`,{selection:toChange,at:new Date().toISOString()});
              achievementsApplied=toChange.length;
            }
          }
          if(Array.isArray(data.stats)&&data.stats.length){
            const resStats=await statsWrite(client,id,data.stats,{stealth});
            statsApplied=resStats.changedCount||0;
          }
          return json(res,200,{appid:id,outcome:'confirmed',achievementsApplied,statsApplied,message:`Imported ${achievementsApplied} achievement changes and ${statsApplied} statistics.`});
        }finally{experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();farming(acc,true);}
      }
      const livePlayersMatch = url.pathname.match(/^\/api\/games\/(\d+)\/live-players$/);
      if ((livePlayersMatch || url.pathname === '/api/live-players') && req.method === 'GET') {
        const id = appId(livePlayersMatch ? livePlayersMatch[1] : url.searchParams.get('appid'));
        const visibleList = visibleAccountsForSession(session);
        const reqId = url.searchParams.get('accountId') || '';
        const accObj = reqId && reqId !== 'demo' ? visibleList.find(a => a.id === reqId) : visibleList[0];
        const client = accObj ? clients.get(accObj.id) : null;
        let webCount = null;
        try {
          const webRes = await safeSteamFetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`, { timeoutMs: 3500 });
          if (webRes && webRes.ok) {
            const parsed = await webRes.json();
            if (typeof parsed?.response?.player_count === 'number' && parsed.response.player_count >= 0) {
              webCount = parsed.response.player_count;
            }
          }
        } catch {}
        const cmCount = webCount === null && client ? await getLivePlayerCount(client, id, { timeoutMs: 1200 }) : null;
        const liveCount = typeof webCount === 'number' ? webCount : (typeof cmCount === 'number' ? cmCount : null);
        const fallbackMap = { 730: 1184200, 440: 78450, 570: 642100, 620: 3890, 550: 28400, 690790: 2410, 34830: 420 };
        const playerCount = typeof liveCount === 'number' ? liveCount : (fallbackMap[id] ?? 0);
        return json(res, 200, { appid: id, playerCount, live: typeof liveCount === 'number' });
      }
      const donorSchemaMatch = url.pathname.match(/^\/api\/games\/(\d+)\/donor-schema$/);
      if (donorSchemaMatch && req.method === 'GET') {
        const id = appId(donorSchemaMatch[1]);
        const acc = getAccount(req, url), client = clients.get(acc.id);
        const schemaRes = await fetchUnownedGameSchema(client, id);
        return json(res, 200, {
          appid: id,
          donorId: schemaRes.donorId,
          achievements: schemaRes.achievements || [],
          statistics: schemaRes.statistics || []
        });
      }
      const ostExportMatch = url.pathname.match(/^\/api\/games\/(\d+)\/opensteamtool-export$/);
      if (ostExportMatch && req.method === 'GET') {
        const id = appId(ostExportMatch[1]);
        const reqAccId = url.searchParams.get('accountId') || '';
        const acc = reqAccId && reqAccId !== 'demo' && visibleAccountsForSession(session).length ? getAccount(req, url) : null;
        const client = acc ? clients.get(acc.id) : null;
        const schemaRes = await fetchUnownedGameSchema(client, id);
        const achList = (schemaRes.achievements || []).map(a => ({
          apiname: a.apiname,
          name: a.name || a.apiname,
          description: a.description || '',
          unlocked: true,
          unlockTimestamp: Math.floor(Date.now() / 1000)
        }));
        const luaScript = [
          `-- OpenSteamTool / GreenLuma / Spacewar (AppID 480) Achievement Config for AppID ${id}`,
          `-- Generated by SteamFarmer REA Engine (Donor SteamID: ${schemaRes.donorId})`,
          `addappid(${id})`,
          ...achList.map(a => `-- Achievement: ${a.apiname} (${a.name})`)
        ].join('\n');
        return json(res, 200, {
          ok: true,
          format: 'OpenSteamTool-REA-v1',
          appid: id,
          spacewarAppId: 480,
          donorId: schemaRes.donorId,
          achievements: achList,
          statistics: schemaRes.statistics || [],
          luaScript
        });
      }
      if (url.pathname === '/api/account/loyalty-summary' && req.method === 'GET') {
        const reqAccId = url.searchParams.get('accountId') || '';
        if (reqAccId === 'demo' || !visibleAccountsForSession(session).length) {
          return json(res, 200, { accountId: 'demo', points: 14500, pointsSpent: 3200, totalCardsEarned: 48 });
        }
        const acc = getAccount(req, url), st = stateFor(acc.id), client = clients.get(acc.id);
        const [pts, cards] = await Promise.all([
          fetchSteamPointsSummary(client),
          fetchTotalCardsEarned(client)
        ]);
        const points = pts?.points ?? st.steamPoints ?? 0;
        const pointsSpent = pts?.pointsSpent ?? 0;
        const totalCardsEarned = typeof cards === 'number' ? cards : (st.totalCardsEarned ?? 0);
        st.steamPoints = points;
        st.totalCardsEarned = totalCardsEarned;
        return json(res, 200, { accountId: acc.id, points, pointsSpent, totalCardsEarned });
      }
      if (url.pathname === '/api/account/toggle-privacy' && req.method === 'POST') {
        const acc = getAccount(req, url, data), st = stateFor(acc.id), client = clients.get(acc.id);
        const makePrivate = data.privateApps !== undefined ? Boolean(data.privateApps) : (data.private !== undefined ? Boolean(data.private) : !Boolean(acc.stealthFarming || acc.privateApps));
        acc.stealthFarming = makePrivate;
        acc.privateApps = makePrivate;
        save();
        const targetApps = Array.isArray(data.appids) && data.appids.length ? data.appids.map(appId) : acc.games;
        let privateUpdated = false;
        if (st.connected && client && targetApps.length) {
          privateUpdated = await toggleAppsPrivacy(client, targetApps, makePrivate);
        }
        return json(res, 200, {
          ok: true,
          success: true,
          privateApps: acc.stealthFarming,
          stealthFarming: acc.stealthFarming,
          privateUpdated,
          appids: targetApps,
          message: acc.stealthFarming
            ? 'Stealth Farming (Private Apps) enabled: farmed games are hidden from friends.'
            : 'Stealth Farming disabled: farmed games are visible on your profile.'
        });
      }
      if (url.pathname === '/api/account/claim-free-pack' && req.method === 'POST') {
        const acc = getAccount(req, url, data), st = stateFor(acc.id), client = clients.get(acc.id);
        if (!st.connected || !client) throw fail('Connect your Steam account first.', 409);
        const packIds = Array.isArray(data.appids) && data.appids.length
          ? data.appids.slice(0, 32).map(appId)
          : DEFAULT_32_FREE_APPIDS;
        const resClaim = await claimFreeLicenses(client, packIds);
        for (const gid of packIds) {
          if (acc.games.length >= 32) break;
          if (!acc.games.includes(gid)) acc.games.push(gid);
        }
        save();
        farming(acc, true);
        resolveNames(acc).catch(() => {});
        return json(res, 200, {
          ok: true,
          success: true,
          eresult: resClaim.eresult,
          granted: resClaim.granted,
          grantedPackages: resClaim.grantedPackages || [],
          totalRequested: packIds.length,
          totalGames: acc.games.length,
          message: `Claimed 32 Free Farming Games pack (${resClaim.granted.length} new licenses granted · ${acc.games.length}/32 slots active).`
        });
      }
      if (url.pathname === '/api/toggle-collision-bypass' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st, client } = ensureAccountServices(acc);
        acc.ignoreSessionCollision = data.ignoreSessionCollision !== undefined
          ? Boolean(data.ignoreSessionCollision)
          : !Boolean(acc.ignoreSessionCollision);
        if (acc.ignoreSessionCollision) {
          st.isCollisionPaused = false;
          if (client?.playingState) client.playingState.blocked = false;
          timedManager.resumeAccount(acc.id);
        }
        save();
        farming(acc, true);
        return json(res, 200, {
          success: true,
          ignoreSessionCollision: acc.ignoreSessionCollision,
          message: acc.ignoreSessionCollision
            ? 'Colisión de sesión ignorada: SteamFarmer seguirá farmeando en línea aunque uses Steam en tu PC.'
            : 'Detección de colisión activada: Se pausará cuando juegues en tu PC.'
        });
      }
      // --- M1: MARKET SNIPER ---
      if (url.pathname === '/api/sniper/start' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st } = ensureAccountServices(acc);
        st.marketSniper.setTargets(data.targets || []);
        st.marketSniper.startScanning(Number(data.intervalMs) || 2000);
        const stInfo = st.marketSniper.getStatus();
        return json(res, 200, {
          success: true,
          status: stInfo,
          message: stInfo.lastLog || 'Francotirador de Mercado activado.'
        });
      }
      if (url.pathname === '/api/sniper/scan-once' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st } = ensureAccountServices(acc);
        st.marketSniper.setTargets(data.targets || []);
        const wasActive = st.marketSniper.active;
        st.marketSniper.active = true;
        await st.marketSniper._poll();
        st.marketSniper.active = wasActive;
        const stInfo = st.marketSniper.getStatus();
        return json(res, 200, {
          success: true,
          status: stInfo,
          message: stInfo.lastLog || 'Escaneo de Mercado completado.'
        });
      }
      if (url.pathname === '/api/sniper/stop' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st } = ensureAccountServices(acc);
        st.marketSniper?.stopScanning?.();
        return json(res, 200, {
          success: true,
          status: st.marketSniper ? st.marketSniper.getStatus() : { active: false },
          message: 'Francotirador de Mercado detenido.'
        });
      }
      if (url.pathname === '/api/sniper/status' && req.method === 'GET') {
        if (url.searchParams.get('accountId') === 'demo' || !visibleAccountsForSession(session).length) {
          return json(res, 200, { active: false, targetsCount: 0, boughtCount: 0 });
        }
        const acc = getAccount(req, url);
        const { st } = ensureAccountServices(acc);
        return json(res, 200, st.marketSniper ? st.marketSniper.getStatus() : { active: false });
      }
      // --- M2: ALCHEMY TRANSMUTER ---
      if (url.pathname === '/api/alchemy/convert-gems' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st } = ensureAccountServices(acc);
        try {
          const resData = await st.alchemyTransmuter.convertItemToGems(data.assetId || '1', data.appId || 753);
          return json(res, 200, { success: true, ...resData });
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        }
      }
      if (url.pathname === '/api/alchemy/craft-booster' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st } = ensureAccountServices(acc);
        try {
          const resData = await st.alchemyTransmuter.craftHighValueBooster(data.appId || 730, data.tradabilityPreference || 1);
          return json(res, 200, resData);
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        } finally {
          try { farming(acc, true); } catch {}
        }
      }
      // --- M3: LEVEL OPTIMIZER ---
      if (url.pathname === '/api/level/craft' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st } = ensureAccountServices(acc);
        try {
          const resData = await st.levelOptimizer.craftBadge(data.appId || 730, data.series || 1, data.borderColor || 0);
          return json(res, 200, resData);
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        }
      }
      // --- M5 & MOTOR 4: LONG ARTWORK IHDR + 0x21 WORKSHOP PATCHER ---
      if (url.pathname === '/api/artwork/patch' && req.method === 'POST') {
        try {
          const rawStr = String(data.imagePayload || '').trim();
          const isGif = /^data:image\/gif;base64,/i.test(rawStr) || data.mode === 'workshop_hex21';
          const base64Data = rawStr.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
          const buffer = Buffer.from(base64Data, 'base64');
          if (isGif) {
            const patchedGif = patchWorkshopHex21(buffer);
            const mime = /^data:image\/gif/i.test(rawStr) ? 'image/gif' : 'image/png';
            return json(res, 200, {
              success: true,
              workshopHex21Applied: true,
              previousLastByte: patchedGif.previousLastByte,
              newLastByte: patchedGif.newLastByte,
              patchedBase64: `data:${mime};base64,${patchedGif.patchedBuffer.toString('base64')}`,
              message: patchedGif.message
            });
          }
          const patched = patchPngForInfiniteHeight(buffer, Number(data.targetHeight) || 3840, {
            appendWorkshopHex21: Boolean(data.appendWorkshopHex21)
          });
          return json(res, 200, {
            success: true,
            originalHeight: patched.originalHeight,
            patchedHeight: patched.patchedHeight,
            workshopHex21Applied: patched.workshopHex21Applied,
            patchedBase64: `data:image/png;base64,${patched.patchedBuffer.toString('base64')}`,
            message: patched.message
          });
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        }
      }
      // --- MOTOR 3: SERVER-SIDE SHOWCASE INJECTOR & APPID 753 REVIEW + CS2 WIDGETS + EXPLOIT #3 ---
      if (url.pathname === '/api/overwatch2003/farm-relics' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st, client } = ensureAccountServices(acc);
        const allRelicIds = [202352, 245070, 765, 202351, 248210, 593110, 258280, 1675180, 223910, 267420, 303700, 368020, 753, 7, 92, 766, 1675200, 1059530, 353380, 353370, 250820, 340, 211, 480, 8];
        const targetIds = data.mode === 'single' && Number(data.appId) > 0
          ? [Number(data.appId)]
          : (Array.isArray(data.appIds) && data.appIds.length ? data.appIds.map(Number).filter(n => n > 0) : allRelicIds);
        acc.gameNames ||= {};
        for (const gid of targetIds) {
          if (RELIC_OFFICIAL_NAMES[gid]) acc.gameNames[gid] = RELIC_OFFICIAL_NAMES[gid];
          else if (!acc.gameNames[gid]) acc.gameNames[gid] = `AppID ${gid}`;
        }
        acc.games = [...new Set([...targetIds, ...(acc.games || [])])].slice(0, 32);
        acc.paused = false;
        st.isPaused = false;
        st.isCollisionPaused = false;
        if (client?.playingState) client.playingState.blocked = false;
        save();
        if (st.connected && client) {
          claimFreeLicenses(client, targetIds).catch(() => {});
        }
        farming(acc, true);
        const namesAdded = targetIds.map(id => `${id} (${acc.gameNames[id]})`).slice(0, 6).join(', ');
        return json(res, 200, {
          success: true,
          farmedAppIds: targetIds,
          totalGames: acc.games.length,
          isFarming: st.isFarming,
          message: `✅ ¡Farmeo de Horas Activado! Se agregaron a tu Biblioteca de Juegos y están acumulando horas en vivo: ${namesAdded}${targetIds.length > 6 ? ' y ' + (targetIds.length - 6) + ' más' : ''}.`
        });
      }
      if (url.pathname === '/api/overwatch2003/showcase-inject' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st, client } = ensureAccountServices(acc);
        const sid64 = st.steamId64 || acc.mySteamID || '';
        try {
          if (data.fillCollectorRelics) {
            const defaultRelics = Number(data.slotsCount) === 12
              ? [753, 766, 92, 1675200, 1059530, 353380, 353370, 250820, 340, 211, 220, 10]
              : [753, 766, 92, 1675200];
            const relicIds = Array.isArray(data.relicAppIds) && data.relicAppIds.length
              ? data.relicAppIds.map(Number)
              : defaultRelics;
            // También agregarlos a la Biblioteca de Juegos para que acumulen horas
            acc.gameNames ||= {};
            for (const gid of relicIds) {
              if (RELIC_OFFICIAL_NAMES[gid]) acc.gameNames[gid] = RELIC_OFFICIAL_NAMES[gid];
            }
            acc.games = [...new Set([...relicIds, ...(acc.games || [])])].slice(0, 32);
            st.isPaused = false; acc.paused = false; st.isCollisionPaused = false; save();
            farming(acc, true);
            const resData = await fillCollectorShowcaseWithRelics({
              steamId64: sid64,
              cookieString: st.webCookies,
              purchaseId: data.purchaseId || 0,
              targetInstance: data.targetInstance || 'second',
              relicAppIds: relicIds
            });
            if (data.alsoInjectFavorite) {
              const favApp = Number(data.appId) || relicIds[0] || 202352;
              try {
                await setProfileShowcaseSlotServerSide({
                  steamId64: sid64,
                  cookieString: st.webCookies,
                  customizationType: 6,
                  purchaseId: data.purchaseId || 0,
                  targetInstance: data.targetInstance || 'both',
                  slotIndex: 0,
                  appId: favApp
                });
                resData.favoriteAppIdInjected = favApp;
                resData.message = `🌟 ¡TODOS LOS EVENTOS DESTACADOS! Se inyectaron los ${relicIds.length} Eventos Históricos (${relicIds.join(', ')}) en tu Coleccionista de Juegos y el AppID ${favApp} (${RELIC_OFFICIAL_NAMES[favApp] || 'Evento'}) en tu Vitrina de Juego Favorito, además de dejarlos farmeando horas en vivo.`;
              } catch {}
            }
            return json(res, 200, resData);
          }
          const targetAppId = Number(data.appId) || 753;
          // Agregar automáticamente a la Biblioteca de Juegos y activar farmeo de horas
          acc.gameNames ||= {};
          if (RELIC_OFFICIAL_NAMES[targetAppId]) acc.gameNames[targetAppId] = RELIC_OFFICIAL_NAMES[targetAppId];
          if (!acc.games.includes(targetAppId)) {
            acc.games = [targetAppId, ...(acc.games || [])].slice(0, 32);
          }
          st.isPaused = false; acc.paused = false; st.isCollisionPaused = false; save();
          farming(acc, true);
          const resData = await setProfileShowcaseSlotServerSide({
            steamId64: sid64,
            cookieString: st.webCookies,
            customizationType: Number(data.customizationType) || 6,
            purchaseId: data.purchaseId || 0,
            targetInstance: data.targetInstance || 'second',
            slotIndex: Number(data.slotIndex) || 0,
            appId: targetAppId
          });
          return json(res, 200, resData);
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        }
      }
      // --- MOTOR 4: UCM SCREENSHOT INJECTOR (EMSG 5514 + GABE NEWELL TAG + CUSTOM PHOTO, DATE & EXACT TIME) ---
      if (url.pathname === '/api/overwatch2003/inject-screenshot' && req.method === 'POST') {
        const acc = getAccount(req, url, data);
        const { st, client } = ensureAccountServices(acc);
        const customAppId = Math.max(1, Math.trunc(Number(data.appId) || 753));
        try {
          const resData = await injectUcmScreenshotServerSide(client, {
            appId: customAppId,
            activeGames: st.playedGames?.length ? st.playedGames.filter(x => typeof x === 'number') : acc.games,
            datePreset: data.datePreset || 'screenshots_beta_feb1_2011',
            customTimestamp: data.customTimestamp,
            customTime: data.customTime,
            tagPreset: data.tagPreset !== undefined ? data.tagPreset : 'gabe',
            customTaggedInput: data.customTaggedInput || '',
            taggedSteamIds: Array.isArray(data.taggedSteamIds) ? data.taggedSteamIds : undefined,
            caption: data.caption,
            photoName: data.photoName,
            imagePayload: data.imagePayload,
            thumbPayload: data.thumbPayload,
            width: data.width,
            height: data.height,
            filename: data.filename,
            thumbname: data.thumbname
          });
          return json(res, 200, resData);
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        }
      }
      // --- MOTOR 5: PIONEER EXPLOITS LAB + ANCIENT & BETA BADGES UNLOCKER ---
      if (url.pathname === '/api/overwatch2003/pioneer-exploit' && req.method === 'POST') {
        try {
          const isAnimatedOnly = ['animated_gif_screenshot', 'create_impossible_guide_202352', 'wishlist_impossible_valve_apps', 'steam_chat_special_fx_injector', 'profile_comment_wall_graffiti', 'profile_comment_invisible_tower', 'start_autonomous_comment_guardian', 'stop_live_2003_daemons'].includes(data.exploitType);
          const acc = (isAnimatedOnly && (data.accountId === 'demo' || !visibleAccountsForSession(session).length))
            ? null
            : getAccount(req, url, data);
          const svc = acc ? ensureAccountServices(acc) : null;
          const client = svc ? svc.client : null;
          const st = svc ? svc.st : (acc ? stateFor(acc.id) : null);
          const sid64 = st?.steamId64 || acc?.mySteamID || client?.steamID?.toString?.() || '';
          const cookieStr = st?.webCookies || '';

          if ((data.exploitType === 'activate_trading_card_beta_202352' || data.exploitType === 'unlock_all_historical_events' || data.exploitType === 'fill_showcases_all_events') && acc) {
            const eventList = (data.exploitType === 'unlock_all_historical_events' || data.exploitType === 'fill_showcases_all_events')
              ? [202352, 245070, 765, 202351, 248210, 593110, 258280, 1675180, 223910, 267420, 303700, 368020, 753, 7, 92, 766]
              : [202352, 202351, 765, 753, 7];
            acc.gameNames ||= {};
            for (const bid of eventList) {
              if (RELIC_OFFICIAL_NAMES[bid]) acc.gameNames[bid] = RELIC_OFFICIAL_NAMES[bid];
            }
            acc.games = [...new Set([...eventList, ...(acc.games || [])])].slice(0, 32);
                acc.paused = false;
            if (st) {
              st.isPaused = false;
              st.isCollisionPaused = false;
            }
            if (client?.playingState) client.playingState.blocked = false;
            save();
          }

          const resData = await executePioneerExploitServerSide(client, {
            exploitType: String(data.exploitType || 'ghost_custom_game'),
            customText: String(data.customText || ''),
            badgeId: Number(data.badgeId ?? 1),
            targetAppId: Number(data.targetAppId || 753),
            saleAppId: Number(data.saleAppId || 245070),
            borderColor: Number(data.borderColor || 0),
            steamId64: sid64,
            cookieString: cookieStr,
            activeGames: Array.isArray(acc?.games) && acc.games.length ? acc.games : [202352, 753, 7, 730, 10]
          });

          if (data.exploitType === 'ghost_custom_game' && acc && resData?.titleApplied) {
            acc.customStatus = resData.titleApplied;
            acc.paused = false;
            if (st) {
              st.ghostGameFirst = true;
              st.isPaused = false;
              st.isCollisionPaused = false;
            }
            save();
            farming(acc, true);
          } else if ((data.exploitType === 'activate_trading_card_beta_202352' || data.exploitType === 'unlock_all_historical_events' || data.exploitType === 'fill_showcases_all_events') && acc) {
            farming(acc, true);
          }

          return json(res, 200, resData);
        } catch (err) {
          return json(res, 400, { success: false, error: err.message });
        }
      }
      const gameLbMatch = url.pathname.match(/^\/api\/games\/(\d+)\/leaderboards$/);
      if((url.pathname==='/api/leaderboards'||gameLbMatch)&&req.method==='GET'){
        const id=appId(gameLbMatch ? gameLbMatch[1] : url.searchParams.get('appid'));
        const name=text(url.searchParams.get('name')||'',128);
        if(url.searchParams.get('accountId')==='demo'||!cfg.accounts.length){
          return json(res,200,await findOrListLeaderboards(null,id,{name}));
        }
        const acc=getAccount(req,url),client=clients.get(acc.id);
        return json(res,200,await findOrListLeaderboards(client,id,{name}));
      }
      if(url.pathname==='/api/leaderboards/entries'&&req.method==='GET'){
        const id=appId(url.searchParams.get('appid'));
        const leaderboardId=Number(url.searchParams.get('leaderboardId'))||101;
        const dataRequest=Number(url.searchParams.get('dataRequest'))||0;
        if(url.searchParams.get('accountId')==='demo'||!cfg.accounts.length){
          return json(res,200,await getLeaderboardEntries(null,id,leaderboardId,{dataRequest,steamId64:'76561198000000000',personaName:'Demo Player'}));
        }
        const acc=getAccount(req,url),st=stateFor(acc.id),client=clients.get(acc.id);
        return json(res,200,await getLeaderboardEntries(client,id,leaderboardId,{dataRequest,steamId64:st.steamId64||acc.mySteamID||'',personaName:st.profileName||acc.name||''}));
      }
      if(url.pathname==='/api/leaderboards/upload'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Uploading leaderboard scores requires the available connected main Steam account.',409);
        rate(`lb-upload:${acc.id}`,15,60000);
        const id=appId(data.appid);
        const leaderboardId=Number(data.leaderboardId)||101;
        const result=await uploadLeaderboardScore(client,id,leaderboardId,data.score,{
          scoreMethod:data.scoreMethod,
          stealth:Boolean(data.stealth),
          steamId64:identity,
          personaName:st.profileName||acc.name||'SteamFarmer Player'
        });
        return json(res,200,result);
      }
      if(url.pathname==='/api/achievement/timed/cancel-all'&&req.method==='POST'){
        const acc=getAccount(req,url,data);
        const cancelledCount=timedManager.cancelAllForAccount(acc.id);
        await timedManager.flush();
        farming(acc,true);
        return json(res,200,{success:true,cancelledCount,message:`Cancelled all active scheduled tasks (${cancelledCount} stopped).`});
      }
      if(url.pathname==='/api/achievement/hltb'&&req.method==='GET'){
        const id=url.searchParams.get('appid')?appId(url.searchParams.get('appid')):null;
        const title=text(url.searchParams.get('title')||'',256);
        const hltb=await fetchHowLongToBeat(title,{appid:id});
        return json(res,200,hltb);
      }
      if(url.pathname==='/api/achievement/timed'&&req.method==='GET'){
        const id=appId(url.searchParams.get('appid'));
        if(url.searchParams.get('accountId')==='demo')return json(res,200,{active:false,demoMode:true,appid:id});
        const acc=getAccount(req,url);
        return json(res,200,timedManager.status(acc.id,id));
      }
      if(url.pathname==='/api/achievement/timed'&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        const id=appId(data.appid);
        if(data.action==='cancel'){
          const cancelled=timedManager.cancel(acc.id,id);
          return json(res,200,{active:false,cancelled,appid:id,message:'Timed modification schedule stopped.'});
        }
        if(data.action==='pause'){
          const paused=timedManager.pauseJob(acc.id,id);
          return json(res,200,{...timedManager.status(acc.id,id),paused,message:'Timed modification schedule paused.'});
        }
        if(data.action==='resume'){
          const resumed=timedManager.resumeJob(acc.id,id);
          return json(res,200,{...timedManager.status(acc.id,id),resumed,message:'Timed modification schedule resumed.'});
        }
        if(data.action==='unlock_next_now'){
          if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Timed modifications require the available connected main Steam account.',409);
          const stepRes=await timedManager.unlockNextNow(acc.id,id);
          return json(res,200,{
            ...timedManager.status(acc.id,id),
            ...stepRes,
            message:`⚡ Logro "${stepRes.unlockedItem?.name||stepRes.unlockedItem?.apiname}" desbloqueado ahora (${stepRes.completedCount}/${stepRes.totalCount}).`
          });
        }
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Timed modifications require the available connected main Steam account.',409);
        rate(`ach-timed:${acc.id}`,15,60000);
        const [snapshot,receipts]=await Promise.all([progressSnapshotRead(client,id,{skipLibrarySummary:true}),operations.latest(identity,id)]);
        const parsedView = (() => { try { return parseSnapshot(snapshot, id); } catch { return { achievements: [] }; } })();
        const nameByApi = new Map((parsedView.achievements || []).map(a => [a.apiname, a]));
        const bulkAction=data.bulkAction?text(String(data.bulkAction),32):null;
        const rawItems=Array.isArray(data.selection)&&data.selection.length
          ?changeSelection(data.selection,{bulk:true})
          :buildBulkSelection(snapshot,id,bulkAction||'unlock_all',receipts,{allowRetoggle:true});
        const stealth=Boolean(data.stealth);
        const spacing=['even','random','natural','platinum'].includes(data.spacing)?data.spacing:'even';
        const order=spacing==='platinum'?'progression':(['random','progression'].includes(data.order)?data.order:'selection');
        let percentagesMap=data.percentages&&typeof data.percentages==='object'?data.percentages:null;
        if((spacing==='platinum'||order==='progression'||data.action==='preview')&&(!percentagesMap||!Object.keys(percentagesMap).length)){
          const cachedPct=percentageCache.get(String(id)+':api')?.percentages;
          if(cachedPct&&Object.keys(cachedPct).length){
            percentagesMap=cachedPct;
          }else{
            try{
              const pctRes=await percentagesRead(id,{includeTitles:false});
              if(pctRes?.percentages&&typeof pctRes.percentages==='object'){
                percentagesMap=pctRes.percentages;
                if(Object.keys(percentagesMap).length)percentageCache.set(String(id)+':api',pctRes);
              }
            }catch{}
          }
        }
        const items=rawItems.map(it=>{
          const meta=nameByApi.get(it.apiname);
          const pctVal=percentagesMap?.[it.apiname]??meta?.percent??null;
          return {
            ...it,
            name:meta?.name||it.apiname,
            description:meta?.description||'',
            percent:typeof pctVal==='number'&&Number.isFinite(pctVal)?pctVal:null
          };
        });
        const maxItems=Math.max(0,Math.min(500,Math.trunc(Number(data.maxItems)||0)));
        const skipDateSpecific = data.skipDateSpecific !== false;
        if(data.action==='preview'){
          const nowMs=Date.now();
          const pace=typeof data.pacingMode==='string'?data.pacingMode:'legal_completionist';
          const plat=require('./lib/steam-protocol').buildRealisticPlatinumSchedule(
            maxItems>0?require('./lib/steam-protocol').sortAchievementsByProgression(items,percentagesMap).slice(0,maxItems):items,
            {percentagesMap,pacingMode:pace,skipDateSpecific,baseNowMs:nowMs}
          );
          const previewQueue=plat.items.map((it,idx)=>({
            step:idx+1,
            apiname:it.apiname,
            name:it.name||it.apiname,
            percent:it.percent??null,
            phase:it.phase||1,
            phaseLabel:it.phaseLabel||'Progreso',
            offsetMs:plat.offsetsMs[idx]||0,
            estimatedAt:new Date(nowMs+(plat.offsetsMs[idx]||0)).toISOString()
          }));
          const skippedList=(plat.skippedSpecial||[]).map(it=>({
            apiname:it.apiname,
            name:it.name||it.apiname,
            percent:it.percent??null,
            label:it.specialCondition?.label||'📅 Fecha/Evento Especial',
            reasonEs:it.specialCondition?.reasonEs||''
          }));
          return json(res,200,{
            preview:true,
            appid:id,
            totalGameAchievements:(parsedView.achievements||[]).length,
            alreadyUnlockedCount:(parsedView.achievements||[]).filter(a=>a.unlocked===true).length,
            pendingCount:rawItems.length,
            scheduledCount:previewQueue.length,
            skippedSpecialCount:skippedList.length,
            skippedSpecial:skippedList,
            estimatedDays:plat.estimatedDays,
            estimatedMonths:plat.estimatedMonths,
            pacingMode:plat.pacingMode,
            summaryTextEs:plat.summaryTextEs,
            queue:previewQueue
          });
        }
        let hltbData = null;
        if (spacing === 'platinum') {
          const gameTitle = text(data.gameTitle || acc.gameNames?.[id] || DEMO_CATALOG.find(g => g.id === id)?.name || '', 256);
          hltbData = await fetchHowLongToBeat(gameTitle, { appid: id }).catch(() => null);
        }
        const status=timedManager.start({
          accountId:acc.id,
          appid:id,
          items,
          percentagesMap,
          targetHours:Number(data.targetHours)||hltbData?.completionistHours||null,
          hltbData,
          pacingMode:typeof data.pacingMode==='string'?data.pacingMode:null,
          currentFarmedHours:Number(data.currentFarmedHours)||0,
          skipDateSpecific,
          maxItems,
          amount:Number(data.amount)||5,
          units:['seconds','minutes','hours'].includes(data.units)?data.units:'minutes',
          spacing,
          order,
          stealth,
          pausedByCollision:Boolean(st.isCollisionPaused),
          executeItem:makeTimedItemExecutor(acc.id,id,stealth)
        });
        const msg=spacing==='platinum'&&status.summaryTextEs
          ?status.summaryTextEs
          :`Scheduled ${status.totalCount||items.length} achievement${(status.totalCount||items.length)===1?'':'s'} (${status.order} order, ${status.spacing} spacing).`;
        return json(res,200,{...status,...(hltbData?{hltb:hltbData}:{}),message:msg});
      }
      if(url.pathname==='/api/achievement/shared-progress-preview'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id);
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused)throw fail('Shared-counter preview requires the available connected main account.',409);
        rate(`shared-preview:${acc.id}`,10,60000);
        const id=appId(url.searchParams.get('appid')),name=text(url.searchParams.get('apiname')||'',256),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!identity)throw fail('Steam is disconnected.',409);
        const snapshot=await progressSnapshotRead(client,id);
        if(clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected||st.isCollisionPaused)throw fail('Steam changed during the impact review.',409);
        const review=sharedPreview(snapshot,id,name);
        try{
          prepareShared(snapshot,id,name,{expectedRevision:review.revision});
          const members=review.effects.filter(e=>e.unlocked===false).map(e=>e.apiname);
          if((await journal.sharedConflicts(identity,id,members)).length)throw fail('A related achievement has a previous or unresolved write. Review history before any shared update.',409);
          review.canActivate=true;review.message='Persistent group reservations are available. Review every effect; one achievement would unlock and all related progress will be verified.';
        }catch(e){review.canActivate=false;review.message=e.status?e.message:'Shared-counter activation cannot be verified right now. No write is permitted.';}
        return json(res,200,review);
      }
      if(url.pathname==='/api/achievement/history'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id),identity=st.steamId64||acc.mySteamID;
        rate(`achievement-history:${token}`,20,60000);
        const before=url.searchParams.get('before');if(before&&!Number.isFinite(Date.parse(before)))throw fail('Invalid history date.');
        const [legacy,recent]=identity?await Promise.all([journal.list(identity,{before}),operations.list(identity,before)]):[[],[]];
        return json(res,200,{storage:journal.status(),entries:[...legacy,...recent].sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt)).slice(0,100),limit:100});
      }
      if(['/api/achievement/change-preview','/api/achievement/change','/api/achievement/changes'].includes(url.pathname)&&req.method==='POST'){
        const acc=getAccount(req,url,data),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||!identity||identity!==st.steamId64)throw fail('Reviewed changes require the available connected main Steam account.',409);
        const id=appId(data.appid),preview=url.pathname.endsWith('change-preview'),wipeStats=Boolean(data.wipeStats),directApply=Boolean(data.directApply||wipeStats);
        const forceFreshTimestamp=Boolean(data.forceFreshTimestamp)||data.bulkAction==='refresh_dates',preserveRetainedDates=Boolean(data.preserveRetainedDates);
        const bulkAction=data.bulkAction!==undefined?text(String(data.bulkAction),32):(wipeStats&&!Array.isArray(data.selection)?'lock_all':undefined);
        if(bulkAction&&!['unlock_all','lock_all','refresh_dates'].includes(bulkAction))throw fail('Select unlock_all or lock_all for bulk achievement operations.',400);
        const bulk=Boolean(data.bulk||bulkAction||directApply||forceFreshTimestamp||(Array.isArray(data.selection)&&data.selection.length>32)),resetCounters=Boolean(data.resetCounters||wipeStats),allowRetoggle=Boolean(data.allowRetoggle)||bulk,overrideCooldown=data.overrideCooldown!==false,stealth=Boolean(data.stealth);
        const filterNames=Array.isArray(data.filterNames)?data.filterNames.slice(0,8192).map(v=>text(String(v),256)):undefined;
        const selected=bulkAction&&!Array.isArray(data.selection)?null:changeSelection(data.selection,{bulk});
        rate(`reviewed-${preview?'preview':'write'}:${acc.id}`,preview?30:20,60000);
        const current=()=>{assertPanelSession();if(!cfg.accounts.includes(acc)||clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused||st.steamId64!==identity)throw fail('The Steam session changed during the operation.',409);};
        if(preview){
          const [snapshot,receipts]=await Promise.all([progressSnapshotRead(client,id),operations.latest(identity,id)]);current();
          const effectiveSelection=selected||buildBulkSelection(snapshot,id,bulkAction,receipts,{filterNames,allowRetoggle});
          const plan=prepareChanges(snapshot,id,effectiveSelection,receipts,undefined,{bulk,resetCounters,allowRetoggle});cleanOperation(plan);const available=await operations.schema();current();
          return json(res,200,{appid:id,...(bulk?{bulk:true,resetCounters}:{}),...(bulkAction?{bulkAction}:{}),selection:plan.selection,effects:plan.effects,progressChanges:plan.progressChanges,revision:plan.revision,canActivate:available,message:available?'Review every unlock, removal and progress change. Compatibility remains provisional until Steam confirms the complete operation.':'Persistent reviewed-operation reservations are not installed. The selection can be reviewed, but cannot be sent yet.'});
        }
        if(!directApply&&(typeof data.revision!=='string'||!/^[a-f0-9]{64}$/.test(data.revision)))throw fail('Review a fresh selection before confirming.');
        if(data.confirmed!==true)throw fail('Explicitly confirm the exact reviewed changes before sending.');
        if(experimentBusy.has(acc.id))throw fail('An achievement operation is already running.',409);
        const hasSchema=await operations.schema();
        if(!hasSchema&&!directApply)throw fail('Persistent reviewed-operation reservations must be installed first.',503);
        const existingJob=timedManager.status(acc.id,id);
        if(existingJob?.active){
          console.log(`[TimedSync] Manual achievement changes detected on app ${id}. Cancelling pending timed schedule.`);
        }
        timedManager.cancel(acc.id,id);
        experimentBusy.add(acc.id);
        try{
          try {
            const sock = client._connection?.stream || client._connection?.socket || client._connection;
            sock?.setNoDelay?.(true);
            sock?.setKeepAlive?.(true, 15000);
          } catch {}
          if (!stealth && typeof client.gamesPlayed === 'function') {
            try {
              const nextPlayed = st.inspectingAppId === id ? [id, ...st.playedGames.filter(x => x !== id)].slice(0, 32) : [id];
              client.gamesPlayed(nextPlayed);
              st.playedGames = nextPlayed;
            } catch {}
          }
          let writeSelection=selected;
          let expectedRevision=data.revision;
          let preloadedSnapshot=null,preloadedReceipts=null;
          const forceLockAll=Boolean((directApply||wipeStats)&&(bulkAction==='lock_all'||wipeStats||(Array.isArray(writeSelection)&&writeSelection.some(s=>s.action==='remove'))));
          if(!writeSelection&&bulkAction||directApply){
            const [snapshot,receipts]=await Promise.all([progressSnapshotRead(client,id,{skipLibrarySummary:directApply}),operations.latest(identity,id)]);current();
            if(forceLockAll&&Array.isArray(snapshot?.stats)&&snapshot.stats.every(s=>(Number(s.stat_value)>>>0)===0)){
              Object.defineProperty(snapshot,'_reconciledFromSteam',{value:true,enumerable:false,configurable:true});
            }
            preloadedSnapshot=snapshot;preloadedReceipts=receipts;
            if(!writeSelection&&bulkAction)writeSelection=buildBulkSelection(snapshot,id,bulkAction,receipts,{filterNames,allowRetoggle,forceLockAll});
            if(directApply){
              const autoPlan=prepareChanges(snapshot,id,writeSelection,receipts,undefined,{bulk,resetCounters,allowRetoggle,forceFreshTimestamp,forceLockAll});
              expectedRevision=autoPlan.revision;
            }
          }
          const result=await changesWrite(client,id,writeSelection,{expectedRevision,initialSnapshot:preloadedSnapshot,initialReceipts:preloadedReceipts,fastDirect:directApply,preserveGamesPlayed:true,bulk,bulkAction,wipeStats:Boolean(wipeStats||bulkAction==='lock_all'),forceLockAll,resetCounters,allowRetoggle,forceFreshTimestamp,preserveRetainedDates,overrideCooldown,stealth,readHistory:()=>operations.latest(identity,id),beforeSend:async plan=>{if(!directApply)await persistence?.flush();current();const intent=hasSchema?await operations.reserve(identity,plan,{overrideCooldown}):cleanOperation({...plan,operationId:crypto.randomUUID(),checkedAt:new Date().toISOString(),outcome:'requested'});current();st.lastAchievementWrite=Date.now();if(bulkAction==='lock_all'||wipeStats||(Array.isArray(writeSelection)&&writeSelection.some(s=>s.action==='remove')))st.lastLockedAppId=id;else if(st.lastLockedAppId===id)st.lastLockedAppId=null;if(!stealth){try{if(typeof client.gamesPlayed==='function'){const nextPlayed=st.inspectingAppId===id?[id,...st.playedGames.filter(x=>x!==id)].slice(0,32):[id];client.gamesPlayed(nextPlayed);st.playedGames=nextPlayed;}}catch{}}return intent;}});
          if(hasSchema){try{await operations.finish(identity,result);}catch{result.historyPersisted=false;result.message+=' History saving failed. The durable intent must be reviewed; do not retry.';}}
          lastOperations.set(`${acc.id}:${id}`,{selection:writeSelection,at:new Date().toISOString()});
          if(result.outcome==='confirmed'&&Array.isArray(writeSelection)&&writeSelection.length){
            const firstItem=writeSelection.find(s=>s.action==='unlock')||writeSelection[0];
            if(firstItem){
              emitAchievementUnlockedEvent({
                accountId:acc.id,
                appid:id,
                apiname:firstItem.apiname,
                name:firstItem.apiname,
                description:writeSelection.length>1?`${writeSelection.length} achievements modified`:(''),
                gameTitle:acc.gameNames?.[id]||`AppID ${id}`,
                action:firstItem.action
              });
            }
          }
          return json(res,200,result);
        }finally{experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();farming(acc,true);}
      }
      if(url.pathname==='/api/achievement/float-search'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||!identity)throw fail('Decimal search requires the connected main Steam account.',409);
        rate(`float-search:${acc.id}`,12,60000);
        const position=url.searchParams.get('cursor')||'0';if(!/^\d{1,4}$/.test(position))throw fail('Invalid decimal search position.');const cursor=Number(position);
        const key=JSON.stringify([acc.id,identity,st.webSessionVersion]);let library=floatLibraryCache.get(key);
        if(!library){library=await ownedFloatLibrary(client);floatLibraryCache.set(key,library);if(!floatLibraryCache.get(key))throw fail('This library exceeds the bounded decimal search cache.',409);}
        if(cursor>0&&url.searchParams.get('revision')!==library.revision)throw fail('The library changed or the search expired. Start a new decimal search.',409);
        if(cursor>library.games.length)throw fail('Invalid decimal search position.');
        const result=await scanFloatBatch(client,library,cursor,{read:protocolRead});
        if(!cfg.accounts.includes(acc)||clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected||!st.tokenAccountMatches)throw fail('Steam changed during decimal search.',409);
        console.log('[Decimal search] '+JSON.stringify({checkedAt:result.checkedAt,cursor:result.cursor,nextCursor:result.nextCursor,totalGames:result.totalGames,failedReads:result.games.filter(g=>!g.readable).length,candidates:result.candidates,writesSent:0}));
        return json(res,200,result);
      }
      if(url.pathname==='/api/achievement/float-progress-preview'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id);
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused)throw fail('Decimal preview requires the available connected main Steam account.',409);
        rate(`float-preview:${acc.id}`,10,60000);
        const id=appId(url.searchParams.get('appid')),apiName=text(url.searchParams.get('apiname')||'',256),client=clients.get(acc.id),identity=client?.steamID?.toString();
        if(!identity)throw fail('Steam is disconnected.',409);
        const snapshot=await progressSnapshotRead(client,id);
        if(clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused)throw fail('The Steam session changed during the decimal preview.',409);
        const review=floatPreview(snapshot,id,apiName);
        try{
          prepareFloat(snapshot,id,apiName,{expectedRevision:review.revision});
          if(!journal.status().persistent)throw fail('Decimal writes require persistent PostgreSQL history.',503);
          if(await journal.get(identity,id,apiName))throw fail('A previous write requires review. Automatic retries are disabled.',409);
          review.canActivate=true;review.message='Review the exact counter change. Only this counter will be sent; Steam must confirm its value and the linked achievement in a fresh read. Compatibility remains provisional.';
        }catch(e){review.canActivate=false;review.message=e.status?e.message:'Persistent history cannot be verified. No decimal write is permitted.';}
        return json(res,200,review);
      }
      if(url.pathname==='/api/achievement/progress-preview'&&req.method==='GET'){
        const acc=getAccount(req,url),st=stateFor(acc.id);
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches||st.isCollisionPaused)throw fail('Progress preview requires the available connected main Steam account.',409);
        rate(`progress-preview:${acc.id}`,10,60000);
        const id=appId(url.searchParams.get('appid')),apiName=text(url.searchParams.get('apiname')||'',256),client=clients.get(acc.id);
        if(await journal.get(st.steamId64,id,apiName))throw fail('A write was already attempted for this achievement. Refresh to verify; retries require review.',409);
        const identity=client.steamID?.toString(),snapshot=await progressSnapshotRead(client,id);
        if(clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected||st.isCollisionPaused)throw fail('The Steam session changed during the preview.',409);
        const plan=prepare(snapshot,id,apiName,{allowProgress:true});
        if(!plan.payload)throw fail('This achievement is already unlocked.',409);
        return json(res,200,{appid:id,apiname:apiName,name:plan.target.name,revision:plan.revision,progressChanges:plan.progressChanges,message:'This operation changes the selected Steam achievement and its linked counter. Game saves and publisher progress are not verified.'});
      }
      if (url.pathname === '/api/achievement/unlock' && req.method === 'POST') {
        if(data.confirmed!==true)throw fail('Confirm the concrete achievement change before sending.');
        const acc=getAccount(req,url,data),st=stateFor(acc.id);
        if(!isAuthorizedAccount(acc)||!st.connected||!st.tokenAccountMatches)throw fail('Individual activation requires the connected main account managed by Render.',409);
        if(st.isCollisionPaused)throw fail('Stop playing on the other device before unlocking an achievement.',409);
        const id=appId(data.appid),apiName=text(data.apiname,256);
        const mode=data.mode||'achievement';if(!['achievement','progress','shared','float'].includes(mode))throw fail('Unknown activation mode.');
        if(mode!=='achievement'&&(typeof data.revision!=='string'||!/^[a-f0-9]{64}$/.test(data.revision)))throw fail('Review a fresh progress preview before confirming.');
        if(mode==='float'&&!journal.status().persistent)throw fail('Decimal writes require persistent PostgreSQL history.',503);
        if(!apiName||data.achievements!==undefined||data.unlock===false)throw fail('Select exactly one achievement to activate.');
        rate(`individual:${acc.id}`,5,60000);
        if(experimentBusy.has(acc.id))throw fail('An achievement activation is already running.',409);
        const client=clients.get(acc.id);if(!client)throw fail('Steam is not connected.',409);
        const identity=client.steamID?.toString();
        if(mode==='float'&&identity!==st.steamId64)throw fail('The Steam identity could not be verified for this progress update.',409);
        const existingUnlockJob=timedManager.status(acc.id,id);
        if(existingUnlockJob?.active){
          console.log(`[TimedSync] Manual achievement unlock detected on app ${id}. Cancelling pending timed schedule.`);
        }
        timedManager.cancel(acc.id,id);
        experimentBusy.add(acc.id);
        let reserved=false;
        try {
          const result=await individualWrite(client,id,apiName,{allowProgress:mode==='progress',sharedProgress:mode==='shared',floatProgress:mode==='float',expectedRevision:mode!=='achievement'?data.revision:undefined,beforeSend:async evidence=>{
            await persistence?.flush();
            assertPanelSession();
            if(clients.get(acc.id)!==client||!st.connected||st.isCollisionPaused||mode==='float'&&(!st.tokenAccountMatches||st.steamId64!==identity))throw fail('The Steam session changed.',409);
            if(await journal.get(st.steamId64,id,apiName))throw fail('A write was already attempted for this achievement. Automatic retries are disabled.',409);
            if((await operations.latest(st.steamId64,id)).get(apiName)?.action==='remove')throw fail('Use the reviewed selection to change an achievement with a previous removal. Its Steam library state must be checked first.',409);
            if(st.lastAchievementWrite && Date.now()-st.lastAchievementWrite<60000)throw fail('Wait one minute between achievement writes.',429);
            if(mode==='shared')await journal.reserveShared(st.steamId64,id,apiName,evidence);else await journal.reserve(st.steamId64,id,apiName,evidence);
            reserved=true;st.lastAchievementWrite=Date.now();
            assertPanelSession();
            if(clients.get(acc.id)!==client||!st.connected||st.isCollisionPaused||mode==='float'&&(!st.tokenAccountMatches||st.steamId64!==identity))throw fail('Steam changed while the write intent was being recorded. No write was sent.',409);
            try{if(typeof client.gamesPlayed==='function'){client.gamesPlayed([id]);st.playedGames=[id];}}catch{}
            console.log('[Achievement activation requested] '+JSON.stringify(evidence));
          }});
          if(reserved)try{if(mode==='shared')await journal.finishShared(st.steamId64,id,apiName,result);else await journal.finish(st.steamId64,id,apiName,result);}catch{result.historyPersisted=false;result.message+=' The result could not be saved to history; the recorded intent remains pending. Do not retry.';}
          if(result?.outcome==='confirmed'||result?.after===true){
            emitAchievementUnlockedEvent({
              accountId:acc.id,
              appid:id,
              apiname:apiName,
              name:result.name||apiName,
              gameTitle:acc.gameNames?.[id]||`AppID ${id}`,
              action:'unlock'
            });
          }
          console.log('[Achievement activation result] '+JSON.stringify(result));
          return json(res,200,result);
        } finally {experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();farming(acc,true);}
      }
      if (url.pathname === '/api/achievement-experiment' && req.method === 'POST') {
        if(data.confirmed!==true)throw fail('Confirm the concrete achievement change before sending.');
        rate(`experiment:${token}`, 3, 60000);
        const acc = getAccount(req,url,data), st = stateFor(acc.id);
        if (!isEnvironmentAccount(acc) || !st.connected || !st.tokenAccountMatches) throw fail('The experiment requires the connected main account managed by Render.',409);
        if (st.isCollisionPaused) throw fail('Stop playing on the other device before the experiment.',409);
        if (data.appid !== TARGET.appid || data.name !== TARGET.name || typeof data.apiname !== 'string' || !data.apiname || data.apiname.length>256) throw fail('Only the selected Model Mania achievement is authorized for this experiment.');
        if (experimentBusy.has(acc.id)) throw fail('An experiment is already running.',409);
        const client=clients.get(acc.id); if(!client) throw fail('Steam is not connected.',409);
        experimentBusy.add(acc.id);
        let reserved=false;
        try {
          const result=await experimentWrite(client,{expectedApiname:data.apiname,beforeSend:async evidence=>{
            await persistence?.flush();
            assertPanelSession();
            if(clients.get(acc.id)!==client || !st.connected || st.isCollisionPaused) throw fail('The Steam session changed.',409);
            const key=st.steamId64+':'+TARGET.appid;
            cfg.achievementExperiments ||= {};
            if(cfg.achievementExperiments[key]) throw fail('One write was already attempted for this account. Refresh to verify; retries require a new review.',409);
            await journal.reserve(st.steamId64,TARGET.appid,data.apiname,evidence);reserved=true;
            assertPanelSession();
            if(clients.get(acc.id)!==client||!st.connected||st.isCollisionPaused)throw fail('Steam changed while the write intent was being recorded. No write was sent.',409);
            cfg.achievementExperiments[key]={...evidence,outcome:'requested'};save();await persistence?.flush();
            assertPanelSession();
            console.log('[Achievement experiment requested] '+JSON.stringify(evidence));
          }});
          if(reserved)try{await journal.finish(st.steamId64,TARGET.appid,data.apiname,result);}catch{result.historyPersisted=false;result.message=(result.message||'Steam returned a result.')+' The result could not be saved to history; the intent remains pending. Do not retry.';}
          if(cfg.achievementExperiments?.[st.steamId64+':'+TARGET.appid]) {cfg.achievementExperiments[st.steamId64+':'+TARGET.appid]=result;save();}
          console.log('[Achievement experiment result] '+JSON.stringify(result));
          return json(res,200,result);
        } finally {experimentBusy.delete(acc.id);st.webSessionVersion++;achievementCache.clear();}
      }
      if (['/api/unlock-batch', '/api/lock-batch', '/api/queue-achievements'].includes(url.pathname) && req.method === 'POST') throw fail(WRITE_UNAVAILABLE, 501);
      if (url.pathname === '/api/set-webhook' && req.method === 'POST') {
        const target = text(data.webhook || '', 512);
        if (target && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(target)) throw fail('Enter an official HTTPS Discord webhook URL.');
        cfg.discordWebhook = target; save(); if (target) await webhook('SteamFarmer connected', 'Webhook configured directly with Discord.'); return json(res, 200, { success: true });
      }
      const routes = ['/api/account/remove', '/api/steam/logout', '/api/steam/web-session', '/api/add', '/api/load-owned', '/api/discovery-queue', '/api/remove', '/api/clear-all', '/api/apply-preset', '/api/toggle', '/api/clear-collision', '/api/persona', '/api/custom-status', '/api/toggle-cards', '/api/claim-free', '/api/set-sleep', '/api/chat-admins'];
      if (req.method !== 'POST' || !routes.includes(url.pathname)) throw fail('Route not found.', 404);
      const acc = getAccount(req, url, data); const st = stateFor(acc.id);
      if (isEnvironmentAccount(acc) && ['/api/account/remove', '/api/steam/logout'].includes(url.pathname)) throw fail('To forget this account, remove STEAM_REFRESH_TOKEN in Render and redeploy. Use Pause to stop activity.', 409);
      switch (url.pathname) {
        case '/api/steam/web-session':
          if (st.connected) { st.lastWebRefresh = Date.now(); clients.get(acc.id).webLogOn(); }
          else { disconnect(acc.id); connect(acc); }
          break;
        case '/api/account/remove':
          for (const [id, a] of attempts) if (a.targetId === acc.id) cancelAttempt(id);
          disconnect(acc.id); vault.remove(acc.id); cfg.accounts = cfg.accounts.filter(a => a.id !== acc.id); save(); break;
        case '/api/steam/logout':
          for (const [id, a] of attempts) if (a.targetId === acc.id) cancelAttempt(id);
          disconnect(acc.id); vault.remove(acc.id); stateFor(acc.id).error = 'Session removed. Please sign in again.'; break;
        case '/api/add': {
          const rawIds = Array.isArray(data.appids) && data.appids.length ? data.appids.slice(0, 32).map(appId) : [appId(data.appid)];
          acc.gameNames ||= {};
          if (Array.isArray(acc.excludedCardApps)) {
            const rawSet = new Set(rawIds.map(Number));
            acc.excludedCardApps = acc.excludedCardApps.filter(x => !rawSet.has(Number(x)));
          }
          for (const id of rawIds) {
            if (RELIC_OFFICIAL_NAMES[id] && !acc.gameNames[id]) acc.gameNames[id] = RELIC_OFFICIAL_NAMES[id];
            if (rawIds.length === 1 && data.name) acc.gameNames[id] = text(data.name, 256);
          }
          acc.games = [...new Set([...(acc.games || []), ...rawIds])];
          if (acc.games.length > 32) {
            if (rawIds.length === 1 && !data.allowRotate) throw fail('Maximum 32 games.');
            acc.games = [...new Set([...rawIds, ...(acc.games || [])])].slice(0, 32);
          }
          save(); farming(acc, true); resolveNames(acc).catch(() => {}); break;
        }
        case '/api/load-owned': {
          if (!st.connected) throw fail('Connect your Steam account first.', 409);
          const client = clients.get(acc.id);
          if (!client) throw fail('Steam is not connected.', 409);
          const lib = await ownedFloatLibrary(client);
          let added = 0;
          for (const g of lib.games) {
            if (acc.games.length >= 32) break;
            if (!acc.games.includes(g.appid)) {
              acc.games.push(g.appid);
              added++;
            }
            if (g.name) acc.gameNames[g.appid] = text(g.name, 256);
          }
          save(); farming(acc, true);
          return json(res, 200, { success: true, added, totalGames: acc.games.length, ownedCount: lib.games.length, message: `Loaded ${added} game${added===1?'':'s'} from your Steam library (${acc.games.length}/32 slots).` });
        }
        case '/api/remove': {
          const id = appId(data.appid);
          acc.games = (acc.games || []).filter(g => Number(g) !== id);
          delete acc.gameNames[id];
          if (Array.isArray(st.cardDropGames) && st.cardDropGames.some(g => Number(g.appid) === id)) {
            st.cardDropGames = st.cardDropGames.filter(g => Number(g.appid) !== id);
            acc.excludedCardApps = [...new Set([...(acc.excludedCardApps || []).map(Number), id])];
          }
          if (st.inspectingAppId === id) {
            st.inspectingAppId = null;
            st.inspectPreviousGames = null;
          }
          save();
          farming(acc, true);
          break;
        }
        case '/api/clear-all': acc.games = []; acc.gameNames = {}; st.inspectingAppId = null; st.inspectPreviousGames = null; save(); farming(acc, true); break;
        case '/api/apply-preset': { const p = PRESETS[data.presetKey]; if (!p) throw fail('Invalid preset.'); acc.games = [...new Set([...acc.games, ...p.games])].slice(0, 32); save(); farming(acc); resolveNames(acc).catch(() => {}); break; }
        case '/api/toggle': {
          const client = clients.get(acc.id);
          if (st.isCollisionPaused) {
            console.log(`[Collision] Manual override: clearing collision pause for ${acc.id}`);
            st.isCollisionPaused = false;
            if (client?.playingState) client.playingState.blocked = false;
            timedManager.resumeAccount(acc.id);
            st.isPaused = false;
          } else {
            st.isPaused = !st.isPaused;
          }
          acc.paused = st.isPaused;
          save();
          farming(acc, true);
          break;
        }
        case '/api/clear-collision': {
          const client = clients.get(acc.id);
          st.isCollisionPaused = false;
          if (client?.playingState) client.playingState.blocked = false;
          st.isPaused = false;
          acc.paused = false;
          timedManager.resumeAccount(acc.id);
          save();
          farming(acc, true);
          return json(res, 200, { success: true, message: 'Collision cleared. Farming resumed.' });
        }
        case '/api/persona': {
          acc.personaState = acc.personaState === 7 ? 1 : 7;
          if (acc.personaState === 1) {
            acc.stealthFarming = false;
            acc.privateApps = false;
          }
          if (acc.ignoreSessionCollision && st.isCollisionPaused) {
            st.isCollisionPaused = false;
            const c = clients.get(acc.id);
            if (c?.playingState) c.playingState.blocked = false;
          }
          if (st.connected) {
            const client = clients.get(acc.id);
            if (client) {
              client.setPersona(SteamUser.EPersonaState?.Online ?? 1);
              const wantPrivate = acc.personaState === 7 || Boolean(acc.stealthFarming);
              const allKnownApps = [...new Set([...(st.playedGames || []).filter(x => typeof x === 'number'), ...(acc.games || []), ...(st.cardDropGames || []).map(g => Number(g.appid))])].filter(x => Number.isInteger(x) && x > 0);
              if (allKnownApps.length) {
                st.lastAppliedAppPrivacy = wantPrivate;
                toggleAppsPrivacy(client, allKnownApps, wantPrivate).catch(() => {});
              }
              farming(acc, true);
              setTimeout(() => { if (!closing) farming(acc, true); }, 500).unref?.();
            }
          }
          save();
          return json(res, 200, {
            success: true,
            personaState: acc.personaState,
            privateApps: Boolean(acc.stealthFarming),
            statusText: acc.personaState === 7 ? 'Invisible' : 'En línea',
            playedGames: st.playedGames
          });
        }
        case '/api/custom-status': acc.customStatus = text(data.status || '', 64); save(); farming(acc); break;
        case '/api/toggle-cards': acc.cardFarming = !acc.cardFarming; if (acc.cardFarming) { st.inspectingAppId = null; st.inspectPreviousGames = null; st.isPaused = false; acc.paused = false; st.cardsReady = false; } save(); if (acc.cardFarming) await scan(acc).catch(() => {}); farming(acc, true); break;
        case '/api/cards/rescan': {
          acc.cardFarming = true;
          st.cardsReady = false;
          st.cardError = '';
          save();
          await scan(acc).catch(() => {});
          farming(acc, true);
          return json(res, 200, {
            success: true,
            cardsReady: st.cardsReady,
            cardDropGames: st.cardDropGames || [],
            badgePagesScanned: st.badgePagesScanned || 0,
            cardError: st.cardError || ''
          });
        }
        case '/api/set-sleep': {
          if (typeof data.enabled !== 'boolean') throw fail('Invalid sleep schedule state.');
          const zone = text(data.timezone || cfg.timezone, 64); try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw fail('Invalid time zone.'); }
          acc.sleepMode = { enabled: data.enabled, start: hour(data.start), end: hour(data.end) }; acc.timezone = zone; cfg.timezone = zone; save(); farming(acc); break;
        }
        case '/api/chat-admins': {
          if (!Array.isArray(data.steamids) || data.steamids.length > 20 || data.steamids.some(id => typeof id !== 'string' || !/^7656119\d{10}$/.test(id))) throw fail('Enter valid SteamID64s.');
          acc.chatAdmins = [...new Set(data.steamids)]; save(); break;
        }
        case '/api/discovery-queue': {
          if (typeof data.auto === 'boolean') {
            acc.autoDiscoveryQueue = data.auto;
            save();
            if (!data.runNow) {
              return json(res, 200, { success: true, autoDiscoveryQueue: acc.autoDiscoveryQueue, message: acc.autoDiscoveryQueue ? 'Daily Auto Discovery Queue enabled.' : 'Daily Auto Discovery Queue disabled.' });
            }
          }
          if (!st.connected || !st.webCookies) throw fail('An active Steam web session is required to explore the Discovery Queue.', 409);
          rate(`discovery-queue:${acc.id}`, 5, 60000);
          const result = await discoveryRun(st.webCookies, { queues: Number(data.queues) || 3 });
          st.lastDiscoveryQueueAt = result.checkedAt;
          acc.lastDiscoveryQueueAt = result.checkedAt;
          save();
          return json(res, 200, { success: true, autoDiscoveryQueue: Boolean(acc.autoDiscoveryQueue), ...result, message: `Explored ${result.completedQueues} Discovery Queue${result.completedQueues === 1 ? '' : 's'} (${result.totalCleared} apps cleared).` });
        }
        case '/api/claim-free': {
          if (!st.connected) throw fail('Steam is not connected.', 409);
          if(st.claimPending)throw fail('A license request is already running.',429);rate(`claim-free:${acc.id}`,1,60000);
          const client=clients.get(acc.id),identity=client?.steamID?.toString();if(!identity)throw fail('Steam is not connected.',409);st.claimPending=true;let timer;
          let result;
          try{result=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(fail('Steam did not respond in time.',504)),15000);timer.unref();client.requestFreeLicense([730,440,570,230410,1172470],(err,packages,apps)=>err?reject(fail('Steam rejected the license request.',502)):resolve({packages:packages||[],apps:apps||[]}));});assertPanelSession();if(!cfg.accounts.includes(acc)||clients.get(acc.id)!==client||client.steamID?.toString()!==identity||!st.connected)throw fail('The Steam session changed during the license request.',409);}
          finally{clearTimeout(timer);st.claimPending=false;}
          return json(res, 200, { success: true, granted: result });
        }
      }
      return json(res, 200, { success: true });
    } catch (err) { if(err.status===429)res.setHeader('Retry-After','3');json(res, err.status || 502, { error: err.status ? err.message : 'The operation failed. Check the server connection or permissions.',...(err.diagnostic?{diagnostic:err.diagnostic}:{}) }); }
    finally{releaseResource?.();}
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  server.maxConnections=64;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
  const timers = [setInterval(() => {
    if (closing) return;
    for (const acc of cfg.accounts) {
      const st = stateFor(acc.id);
      const client = clients.get(acc.id);
      if (st.isCollisionPaused && !st.collisionReconnectPending && client && client.playingState && !client.playingState.blocked) {
        st.isCollisionPaused = false;
        st.playingOnPcAppId = 0;
        timedManager.resumeAccount(acc.id);
      }
      farming(acc);
    }
  }, 30000), setInterval(() => {
    if (closing) return;
    for (const acc of cfg.accounts) {
      const st = stateFor(acc.id);
      const client = clients.get(acc.id);
      if (acc.cardFarming && st.connected && client && !st.isPaused && !st.isCollisionPaused && !st.isSleepPaused) {
        const now = Date.now();
        const sinceLastPulse = now - (st.lastCardDropPulseAt || 0);
        if (sinceLastPulse >= 25 * 60000) {
          st.lastCardDropPulseAt = now;
          st.cardRotateIdx = (st.cardRotateIdx || 0) + 1;
          try {
            client.gamesPlayed([]);
            setTimeout(() => { if (!closing) { farming(acc, true); scan(acc).catch(() => {}); } }, 2500).unref?.();
          } catch {
            scan(acc).catch(() => {});
          }
        } else {
          scan(acc).catch(() => {});
        }
      } else if (acc.cardFarming) {
        scan(acc).catch(() => {});
      }
      const lastDq = Date.parse(st.lastDiscoveryQueueAt || acc.lastDiscoveryQueueAt || '');
      if (acc.autoDiscoveryQueue && st.connected && st.webCookies && (!Number.isFinite(lastDq) || Date.now() - lastDq >= 24 * 3600000)) {
        discoveryRun(st.webCookies, { queues: 3 }).then(r => { st.lastDiscoveryQueueAt = r.checkedAt; acc.lastDiscoveryQueueAt = r.checkedAt; save(); }).catch(() => {});
      }
    }
  }, 10 * 60000), setInterval(() => {
    for (const [token, s] of sessions) if (s.expires <= Date.now()) sessions.delete(token);
    for (const [id, a] of attempts) if (Date.now() - a.created > 5 * 60000 || !sessions.has(a.owner)) cancelAttempt(id);
    achievementCache.prune();requirementsCache.prune();percentageCache.prune();donorFetchCache.prune();percentagesRead.prune?.();
    if (process.memoryUsage().rss > 330 * 1024 * 1024) {
      achievementCache.clear();
      requirementsCache.clear();
      floatLibraryCache.clear();
    }
    for (const [key, r] of rates) if (r.until <= Date.now()) rates.delete(key);
    for (const acc of cfg.accounts) if (stateFor(acc.id).connected) farming(acc);
  }, 30000)];
  if (!options.silent && origin && origin.startsWith('https://')) {
    const keepAliveTimer = setInterval(() => {
      if (!closing) fetch(origin + '/healthz').catch(() => {});
    }, 9 * 60000);
    keepAliveTimer.unref?.();
    timers.push(keepAliveTimer);
  }
  if(!options.silent)timers.push(setInterval(()=>{const m=process.memoryUsage();console.log('[Resources] '+JSON.stringify({rssMiB:Number((m.rss/1048576).toFixed(1)),heapMiB:Number((m.heapUsed/1048576).toFixed(1)),externalMiB:Number((m.external/1048576).toFixed(1)),...budget.status(),steamConnections:clients.size,cacheBytes:achievementCache.bytes+requirementsCache.bytes+percentageCache.bytes+(percentagesRead.bytes?.()||0)}));},60000));
  timers.forEach(t => t.unref());
  if(!options.silent)console.log('[Resource budget] '+JSON.stringify({...budget.status(),heapLimitMiB:Math.round(require('node:v8').getHeapStatistics().heap_size_limit/1048576),startupDiagnostics,steamConnectionLimit:Number(process.env.MAX_STEAM_CONNECTIONS)||12}));
  for(const acc of cfg.accounts)stateFor(acc.id).isPaused=Boolean(acc.paused);
  if(persistence)persistence.onFailure=()=>{for(const id of clients.keys())disconnect(id);};
  const connectStaggered = () => {
    if (options.silent || cfg.accounts.length <= 1) {
      cfg.accounts.forEach(connect);
      return;
    }
    cfg.accounts.forEach((acc, idx) => {
      if (idx === 0) connect(acc);
      else {
        const t = setTimeout(() => { if (!closing) connect(acc); }, idx * 2800);
        t.unref?.();
      }
    });
  };
  if (options.connect !== false) connectStaggered();
  return { server, cfg, vault, clients, states, attempts, sessions, journal, persistence, timedManager, startConnections:()=>{persistence?.assert();connectStaggered();}, close: async () => { closing = true; timedManager.cancelAll(); timers.forEach(clearInterval); for (const id of attempts.keys()) cancelAttempt(id); for (const id of clients.keys()) disconnect(id); sessions.clear(); achievementCache.clear();requirementsCache.clear();percentageCache.clear();donorFetchCache.clear(); percentagesRead.clear?.(); if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await journal.close(); } };
}
if (require.main === module) {
  process.on('unhandledRejection', err => {
    console.warn(`[Process] Handled async rejection without crashing: ${err?.stack || err?.message || err}`);
  });
  process.on('uncaughtException', err => {
    const msg = String(err?.message || err || '');
    if (/Cannot log onto steamcommunity\.com|without first being connected|Not Logged In|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/i.test(msg)) {
      console.warn(`[Process] Ignored transient Steam socket exception: ${msg}`);
      return;
    }
    console.error(`[Process] Uncaught exception: ${err?.stack || msg}`);
  });
  if (process.env.ENABLE_ENV_AUTOLOGIN !== '1') {
    delete process.env.STEAM_REFRESH_TOKEN;
    delete process.env.STEAM_ACCOUNT_ID;
  }
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  if (host !== '127.0.0.1' && !publicOrigin) throw new Error('Configure PUBLIC_ORIGIN for remote access.');
  if (publicOrigin && !publicOrigin.startsWith('https://')) throw new Error('The public origin must use HTTPS.');
  createPersistentApp({ connect: false }).then(app => {
    app.server.listen(port, host, () => {
      console.log(`SteamFarmer: ${publicOrigin || `http://${host}:${port}`} · health /healthz`);
      const bootDelayMs = process.env.RENDER ? 2500 : 200;
      const bootTimer = setTimeout(() => {
        try { app.startConnections(); } catch (e) { console.warn(`[Steam] Startup connect warning: ${e?.message || e}`); }
      }, bootDelayMs);
      bootTimer.unref?.();
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)).catch(() => process.exit(1)));
  }).catch(() => { console.error('[Application memory] Startup blocked: configuration could not be restored or saved. Check Neon connectivity and APP_STATE_KEY; existing data was not replaced.'); process.exitCode = 1; });
}
async function createPersistentApp(options={}){
  const url=process.env.APP_DATABASE_URL||'';
  if(!url && !options.persistence)return createApp(options);
  const persistence=options.persistence || new AppState({url,key:process.env.APP_STATE_KEY});
  let app;
  try{
    const restored=await persistence.load();
    app=createApp({...options,connect:false,persistence,config:restored?.config||options.config,restoredTokens:restored?.tokens});
    await persistence.flush();await app.journal.ready();
    if(!options.silent)console.log('[Application memory] '+JSON.stringify({...persistence.status(),accounts:app.cfg.accounts.length,checkpoint:app.cfg.persistenceCheckpoint||null}));
    // Keep the synchronous factory used by tests; bootstrap restores before connecting.
    const close=app.close;app.close=async()=>{try{await close();}finally{await persistence.close();}};
    /* Preserve user ignoreSessionCollision setting across restarts */if(options.connect!==false)app.startConnections();
    return app;
  }catch(err){await app?.close().catch(()=>{});await persistence.close().catch(()=>{});throw err;}
}
module.exports = { createApp,createPersistentApp };
