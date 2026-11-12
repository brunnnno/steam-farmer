'use strict';

const STAGE_LABELS = {
  1: 'Fase 1: Prólogo / Inicio',
  2: 'Fase 2: Progresión de Historia',
  3: 'Fase 3: Coleccionables / Retos Secundarios',
  4: 'Fase 4: Hitos Difíciles / Bosses Finales',
  5: 'Fase 5: Platino / 100%'
};

const ROMAN_MAP = new Map([
  ['i', 1], ['ii', 2], ['iii', 3], ['iv', 4], ['v', 5],
  ['vi', 6], ['vii', 7], ['viii', 8], ['ix', 9], ['x', 10]
]);

function parseNumberOrRoman(val) {
  if (val == null) return NaN;
  const s = String(val).trim().toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (ROMAN_MAP.has(s)) return ROMAN_MAP.get(s);
  return NaN;
}

/**
 * Heuristic & Rule-based Directed Acyclic Graph (DAG) for Achievement Dependencies.
 * Prevents illogical timeline anomalies (e.g. unlocking Chapter 5 before Chapter 1,
 * or Final Boss before Prologue) by establishing topological prerequisite chains.
 */
class AchievementDependencyGraph {
  constructor(items = [], { percentagesMap = null } = {}) {
    this.rawItems = Array.isArray(items) ? items : [];
    this.percentagesMap = percentagesMap instanceof Map
      ? percentagesMap
      : new Map(Object.entries(percentagesMap || {}));
    this.nodes = new Map();
    this.adj = new Map();
    this.inDegree = new Map();

    this._buildGraph();
  }

  _buildGraph() {
    for (let i = 0; i < this.rawItems.length; i++) {
      const item = this.rawItems[i];
      const api = String(item.apiname || `ach_${i}`);
      const pct = typeof item.percent === 'number' && Number.isFinite(item.percent)
        ? item.percent
        : (this.percentagesMap.get(api) ?? this.percentagesMap.get(api.toLowerCase()) ?? null);
      const node = {
        ...item,
        apiname: api,
        name: String(item.name || api),
        description: String(item.description || ''),
        percent: typeof pct === 'number' && Number.isFinite(pct) ? pct : null,
        dependencies: new Set(),
        depth: 0,
        _origIdx: i
      };
      node.stage = this._inferStage(node);
      this.nodes.set(api, node);
      this.adj.set(api, new Set());
      this.inDegree.set(api, 0);
    }

    const list = [...this.nodes.values()];

    // Heurística 1: Secuencias numéricas en nombre / apiname (Chapter 1 -> Chapter 2, Level 10 -> Level 20)
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j];
        if (this._isSequentialPrerequisite(a, b)) {
          this._addEdge(a.apiname, b.apiname);
        }
      }
    }

    // Heurística 2: Prólogo / Tutorial / Inicio vs Final / Epílogo / 100%
    const prologues = list.filter(a => this._isPrologue(a));
    const finals = list.filter(a => this._isEpilogueOrFinal(a) && !this._isPlatinum(a));
    const platinums = list.filter(a => this._isPlatinum(a));

    for (const a of prologues) {
      for (const b of list) {
        if (a.apiname !== b.apiname && (this._isEpilogueOrFinal(b) || this._isPlatinum(b))) {
          this._addEdge(a.apiname, b.apiname);
        }
      }
    }
    for (const f of finals) {
      for (const p of platinums) {
        if (f.apiname !== p.apiname) {
          this._addEdge(f.apiname, p.apiname);
        }
      }
    }

    // Heurística 3: Mismo stat subyacente con umbral creciente (Kill 10 -> Kill 100)
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j];
        const statA = a.progressDetails?.statName;
        const statB = b.progressDetails?.statName;
        const maxA = Number(a.progressDetails?.maximum);
        const maxB = Number(b.progressDetails?.maximum);
        if (statA && statB && statA === statB && Number.isFinite(maxA) && Number.isFinite(maxB)) {
          if (maxA < maxB) {
            this._addEdge(a.apiname, b.apiname);
          }
        }
      }
    }
  }

  _inferStage(item) {
    if (this._isPlatinum(item)) return 5;
    if (this._isPrologue(item)) return 1;
    if (this._isEpilogueOrFinal(item)) return 4;
    const t = (item.name + ' ' + item.apiname + ' ' + item.description).toLowerCase();
    if (/\b(collectible|coleccionable|secret|secreto|hidden|oculto|find all|challenge|reto)\b/i.test(t)) return 3;
    const p = item.percent;
    if (typeof p === 'number' && Number.isFinite(p)) {
      if (p > 60) return 1;
      if (p >= 30) return 2;
      if (p >= 10) return 3;
      return 4;
    }
    return 2;
  }

  _isSequentialPrerequisite(a, b) {
    const patterns = [
      /\b(chapter|cap[ií]tulo|act|acto|episode|episodio|stage|fase|part|parte|level|nivel|rank|rango|wave|oleada)\s*([0-9]+|[ivx]+)\b/i
    ];

    for (const srcField of ['name', 'description']) {
      const sA = String(a[srcField] || '').toLowerCase();
      const sB = String(b[srcField] || '').toLowerCase();
      for (const pat of patterns) {
        const mA = sA.match(pat);
        const mB = sB.match(pat);
        if (mA && mB && mA[1].toLowerCase() === mB[1].toLowerCase()) {
          const numA = parseNumberOrRoman(mA[2]);
          const numB = parseNumberOrRoman(mB[2]);
          if (!isNaN(numA) && !isNaN(numB) && numA < numB) {
            return true;
          }
        }
      }
    }

    // API name suffix sequence (e.g. CHAP_1 -> CHAP_2, ACT_1 -> ACT_2)
    const apiMatchA = String(a.apiname || '').match(/^([A-Za-z]+(?:_[A-Za-z]+)*?)_(\d+)$/);
    const apiMatchB = String(b.apiname || '').match(/^([A-Za-z]+(?:_[A-Za-z]+)*?)_(\d+)$/);
    if (apiMatchA && apiMatchB && apiMatchA[1].toLowerCase() === apiMatchB[1].toLowerCase()) {
      const prefix = apiMatchA[1].toLowerCase();
      if (/^(act|chap|chapter|ep|episode|stage|mission|lvl|level|rank|tier|wave|boss|story|part|kill|slayer)/.test(prefix)) {
        const numA = parseInt(apiMatchA[2], 10);
        const numB = parseInt(apiMatchB[2], 10);
        if (!isNaN(numA) && !isNaN(numB) && numA < numB) {
          return true;
        }
      }
    }

    // Cumulative description template (e.g. "Kill 10 enemies" -> "Kill 100 enemies")
    const descA = String(a.description || '').toLowerCase().trim();
    const descB = String(b.description || '').toLowerCase().trim();
    const numRegex = /\b(\d{1,3}(?:,\d{3})+|\d+)\b/;
    const dmA = descA.match(numRegex);
    const dmB = descB.match(numRegex);
    if (dmA && dmB) {
      const tplA = descA.replace(numRegex, '<n>');
      const tplB = descB.replace(numRegex, '<n>');
      if (tplA.length >= 8 && tplA === tplB) {
        const nA = parseNumberOrRoman(dmA[1]);
        const nB = parseNumberOrRoman(dmB[1]);
        if (!isNaN(nA) && !isNaN(nB) && nA < nB) return true;
      }
    }

    return false;
  }

  _isPrologue(item) {
    const t = (item.name + ' ' + item.apiname + ' ' + item.description).toLowerCase();
    return /\b(prologue|pr[oó]logo|tutorial|first step|primer paso|welcome|bienvenido|begin|comienzo)\b/i.test(t);
  }

  _isPlatinum(item) {
    const t = (item.name + ' ' + item.apiname + ' ' + item.description).toLowerCase();
    return /\b(platinum|platino|all achievements|todos los logros|all complete|completista|100%)\b/i.test(t);
  }

  _isEpilogueOrFinal(item) {
    const t = (item.name + ' ' + item.apiname + ' ' + item.description).toLowerCase();
    return /\b(epilogue|ep[ií]logo|the end|el final|final boss|jefe final|all complete|master|platinum|completista|beat the game)\b/i.test(t);
  }

  _wouldCreateCycle(fromApi, toApi) {
    if (fromApi === toApi) return true;
    const stack = [toApi];
    const visited = new Set();
    while (stack.length > 0) {
      const curr = stack.pop();
      if (curr === fromApi) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const next of this.adj.get(curr) || []) {
        stack.push(next);
      }
    }
    return false;
  }

  _addEdge(fromApi, toApi) {
    const targets = this.adj.get(fromApi);
    if (!targets || targets.has(toApi) || this._wouldCreateCycle(fromApi, toApi)) return;
    targets.add(toApi);
    this.inDegree.set(toApi, (this.inDegree.get(toApi) || 0) + 1);
    this.nodes.get(toApi)?.dependencies.add(fromApi);
  }

  topologicalSort() {
    const inDegree = new Map(this.inDegree);
    const queue = [];
    const depths = new Map();

    for (const [api, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(api);
        depths.set(api, 0);
      }
    }

    const compareApis = (a, b) => {
      const nA = this.nodes.get(a);
      const nB = this.nodes.get(b);
      const stA = nA?._rarityPhase ?? nA?.stage ?? 2;
      const stB = nB?._rarityPhase ?? nB?.stage ?? 2;
      if (stA !== stB) return stA - stB;
      const pctA = nA?.percent ?? -1;
      const pctB = nB?.percent ?? -1;
      if (pctB !== pctA) return pctB - pctA;
      return (nA?._origIdx ?? 0) - (nB?._origIdx ?? 0);
    };

    // Ordenar raíces por porcentaje de rareza (% mayor primero -> más común)
    queue.sort(compareApis);

    const result = [];

    while (queue.length > 0) {
      const current = queue.shift();
      const node = this.nodes.get(current);
      const currentDepth = depths.get(current) || 0;
      node.depth = currentDepth;
      node.parents = [...node.dependencies];
      result.push(node);

      const neighbors = [...(this.adj.get(current) || [])];
      neighbors.sort(compareApis);

      for (const neighbor of neighbors) {
        const nextDeg = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, nextDeg);
        depths.set(neighbor, Math.max(depths.get(neighbor) || 0, currentDepth + 1));
        if (nextDeg === 0) {
          queue.push(neighbor);
          queue.sort(compareApis);
        }
      }
    }

    // Si hubo ciclos o nodos aislados no procesados, agregarlos al final manteniendo su orden
    if (result.length < this.nodes.size) {
      for (const [, node] of this.nodes.entries()) {
        if (!result.includes(node)) {
          node.depth = 1;
          node.parents = [...node.dependencies];
          result.push(node);
        }
      }
    }

    return result.map(({ _origIdx, dependencies, ...cleanNode }) => ({
      ...cleanNode,
      phase: cleanNode.phase ?? Math.min(4, cleanNode.stage || 1),
      phaseLabel: cleanNode.phaseLabel || STAGE_LABELS[cleanNode.stage] || STAGE_LABELS[2]
    }));
  }

  annotateAchievements(achievements = this.rawItems) {
    this.topologicalSort();
    return achievements.map((ach, idx) => {
      const api = String(ach?.apiname || `ach_${idx}`);
      const node = this.nodes.get(api);
      if (!node) return ach;
      const allDeps = [...node.dependencies].map(k => this.nodes.get(k)).filter(Boolean);
      // Use direct predecessor (highest depth / closest parent) for concise UI display
      allDeps.sort((a, b) => (b.depth - a.depth) || ((a.percent ?? 100) - (b.percent ?? 100)));
      const directParents = allDeps.length ? [allDeps[0]] : [];
      const missingParents = directParents.filter(p => p.unlocked !== true).map(p => ({ apiname: p.apiname, name: p.name }));
      const blockedByDependency = ach?.unlocked !== true && missingParents.length > 0;
      const parentNames = directParents.map(p => p.name);
      const requiresText = missingParents.length > 0
        ? `Requiere antes: ${missingParents.map(p => p.name).join(', ')}`
        : parentNames.length > 0
          ? `Requiere antes: ${parentNames.join(', ')}`
          : '';
      return {
        ...ach,
        dependencyInfo: {
          stage: node.stage,
          stageLabel: STAGE_LABELS[node.stage] || STAGE_LABELS[2],
          depth: node.depth,
          parents: [...node.dependencies],
          parentNames,
          missingParents,
          blockedByDependency,
          requiresText
        }
      };
    });
  }
}

module.exports = { STAGE_LABELS, AchievementDependencyGraph };
