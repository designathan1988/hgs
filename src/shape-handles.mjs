import { Plane, Raycaster, Vector3 } from 'three';

/**
 * Direct manipulation of the body (The Sims 4 Create-a-Sim: pull the part
 * you want to change; MetaHuman Creator: markers, symmetric by default). A
 * press on the skin finds the base vertex under the cursor and every MakeHuman
 * regional adjustment whose targets move it; the drag picks the adjustment
 * whose displacement d at that vertex best follows the cursor and sets its
 * value so the vertex follows the pointer: value = start + Δp·d / |d|² (a
 * target is linear in its weight, so this is the least-squares step).
 */

// Groups left out: asymmetry targets, the empty "measure" group, breast macros (Corpo → Busto).
const skipGroups = new Set(['asym', 'measure', 'breast']);

export const regionNames = {
  head: 'Cabeça', forehead: 'Testa', eyebrows: 'Sobrancelhas', eyes: 'Olhos', nose: 'Nariz', mouth: 'Boca', chin: 'Queixo',
  cheek: 'Bochechas', ears: 'Orelhas', neck: 'Pescoço', torso: 'Tronco', stomach: 'Abdome', hip: 'Quadril', buttocks: 'Glúteos',
  pelvis: 'Pelve', arms: 'Braços', hands: 'Mãos', legs: 'Pernas', feet: 'Pés',
};
const words = {
  scale: '', horiz: 'largura', vert: 'altura', depth: 'profundidade', trans: 'posição', 'in-out': 'dentro↔fora', 'down-up': 'baixo↔cima',
  'backward-forward': 'trás↔frente', 'decr-incr': '', fat: 'gordura', muscle: 'músculo', circ: 'circunferência', height: 'altura', length: 'comprimento',
  dist: 'distância', width: 'largura', volume: 'volume', angle: 'ângulo', upperarm: 'braço', lowerarm: 'antebraço', upperleg: 'coxa', lowerleg: 'perna',
  upperlegs: 'coxas', lowerlegs: 'pernas', shoulder: 'ombro', hips: 'quadril', waist: 'cintura', bust: 'busto', underbust: 'sob o busto', calf: 'panturrilha',
  thigh: 'coxa', knee: 'joelho', neck: 'pescoço', nose: 'nariz', mouth: 'boca', chin: 'queixo', cheek: 'bochecha', eye: 'olho', ear: 'orelha',
  lowerlip: 'lábio inferior', upperlip: 'lábio superior', nostrils: 'narinas', point: 'ponta', head: 'cabeça', torso: 'tronco', hip: 'quadril',
  stomach: 'barriga', pregnant: 'gestação', navel: 'umbigo', buttocks: 'glúteos', forehead: 'testa', temple: 'têmpora', jaw: 'mandíbula',
  triangle: 'triângulo', double: 'papada', prominent: 'proeminência', bones: 'ossos', round: 'arredondado', flaring: 'abertura', compression: 'compressão',
  curve: 'curva', hump: 'giba', septumangle: 'ângulo do septo', nubian: 'núbio', greek: 'grego', bulge: 'saliência', cleft: 'covinha', lobe: 'lóbulo',
  epicanthus: 'epicanto', bag: 'olheira', fold: 'prega', lid: 'pálpebra', cupid: 'arco do cupido', size: 'tamanho', open: 'abertura', dimples: 'covinhas',
};
/** A readable Portuguese label for a MakeHuman category name. */
export function categoryLabel(name) {
  let text = name.replace(/^[lr]-/, '');
  for (const pair of ['in-out', 'down-up', 'backward-forward', 'decr-incr']) text = text.replace(pair, ` ${pair} `);
  const parts = text.split(/[\s]+/).flatMap(part => words[part] !== undefined ? [words[part]] : part.split('-').map(w => words[w] ?? w));
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export class ShapeHandles {
  constructor(renderer) { this.renderer = renderer; this.ray = new Raycaster(); this.symmetry = true; this.drag = null; this.peaks = new Map(); }
  /** The largest displacement target `name` makes at any vertex (metres, weight 1): the core of its area. */
  peakOf(name) {
    if (this.peaks.has(name)) return this.peaks.get(name);
    const morpher = this.renderer.current.context.data.morpher, t = morpher.localByName.get(name);
    let peak = 0;
    if (t) {
      const unit = this.renderer.current.context.positions.unitScale ?? 0.1;
      for (let e = t.start; e < t.start + t.count; e++) peak = Math.max(peak, Math.hypot(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]));
      peak *= t.scale * unit;
    }
    this.peaks.set(name, peak);
    return peak;
  }
  /** The base vertex under the cursor on the body (the hit triangle's corner nearest the hit), or null. */
  vertexAt(ndc) {
    const human = this.renderer.current, body = human?.body;
    const ids = body?.geometry.userData.baseIds;
    if (!ids) return null;
    this.ray.setFromCamera(ndc, this.renderer.viewCamera);
    const hit = this.ray.intersectObject(body, false)[0];
    if (!hit?.face || !hit.barycoord) return null;
    const corners = [hit.face.a, hit.face.b, hit.face.c], weights = hit.barycoord.toArray();
    const corner = corners[weights.indexOf(Math.max(...weights))];
    return { v: ids[corner], point: hit.point.clone() };
  }
  /** Displacement of base vertex `v` by target `name` at weight 1, metres (zero when the target does not move it). */
  deltaAt(name, v) {
    const morpher = this.renderer.current.context.data.morpher, t = morpher.localByName.get(name), out = new Vector3();
    if (!t) return out;
    const unit = this.renderer.current.context.positions.unitScale ?? 0.1;
    for (let e = t.start; e < t.start + t.count; e++) {
      if (morpher.lIdx[e] !== v) continue;
      return out.set(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]).multiplyScalar(t.scale * unit);
    }
    return out;
  }
  /** Adjustments that move base vertex `v`, with their displacement towards +1 and towards -1. */
  candidates(v, x) {
    const morpher = this.renderer.current.context.data.morpher, list = [];
    for (const [name, { group, category }] of morpher.sliders) {
      if (skipGroups.has(group)) continue;
      const sided = Boolean(category.has_left_and_right), side = sided ? (x >= 0 ? 'left' : 'right') : 'unsided';
      const positive = category.opposites ? category.opposites[`positive-${side}`] : category.targets?.[0];
      const negative = category.opposites ? category.opposites[`negative-${side}`] : undefined;
      const plus = positive ? this.deltaAt(`${group}/${positive}`, v) : new Vector3();
      const minus = negative ? this.deltaAt(`${group}/${negative}`, v) : new Vector3();
      if (plus.lengthSq() + minus.lengthSq() < 1e-14) continue;
      // Region size: how many vertices the adjustment moves (the smaller, the more local).
      const size = Math.max(morpher.localByName.get(`${group}/${positive}`)?.count ?? 0, morpher.localByName.get(`${group}/${negative}`)?.count ?? 0);
      const peak = target => target ? this.peakOf(`${group}/${target}`) : 0;
      list.push({ name, group, sided, side: x >= 0 ? 'l' : 'r', plus, minus, size, onlyPositive: !category.opposites, plusPeak: peak(positive), minusPeak: peak(negative) });
    }
    return list;
  }
  /** Press at `ndc`; `value(key)` reads an adjustment's current value. True when the press is on the body. */
  begin(ndc, value) {
    const at = this.vertexAt(ndc);
    if (!at) return false;
    const positions = this.renderer.current.context.positions;
    const candidates = this.candidates(at.v, positions[at.v * 3]);
    if (!candidates.length) return false;
    const normal = this.renderer.viewCamera.getWorldDirection(new Vector3());
    this.drag = { ...at, candidates, value, chosen: null, plane: new Plane().setFromNormalAndCoplanarPoint(normal, at.point) };
    return true;
  }
  /**
   * Drag to `ndc`. Returns { key, category, value, label } for the adjustment
   * that follows the pointer, or null while the pointer has not moved enough
   * to choose one. `single` (Alt) changes one side only.
   */
  move(ndc, { single = false } = {}) {
    const drag = this.drag;
    if (!drag) return null;
    this.ray.setFromCamera(ndc, this.renderer.viewCamera);
    const now = this.ray.ray.intersectPlane(drag.plane, new Vector3());
    if (!now) return null;
    const delta = now.sub(drag.point);
    if (!drag.chosen) {
      // Wait for 3 mm of movement, then keep the adjustment that best follows the pointer.
      if (delta.length() < 0.003) return null;
      // MetaHuman Creator: each marker acts on a limited area. The part grabbed is an adjustment that
      // moves this point along the pull (cosine ≥ 0.6) and whose area this point is the core of (it
      // moves here at least half as much as anywhere): an eye corner that barely moves the nose is out.
      // Among those, the smallest area wins (moving the whole torso also moves the nose, but loses).
      let best = null;
      const pull = delta.length();
      for (const candidate of drag.candidates) for (const [sign, d, peak] of [[1, candidate.plus, candidate.plusPeak], [-1, candidate.minus, candidate.minusPeak]]) {
        const length = d.length();
        if (length < 1e-9 || (sign < 0 && candidate.onlyPositive)) continue;
        const cosine = delta.dot(d) / (length * pull);
        if (cosine < 0.6 || length < 0.5 * peak) continue;
        if (!best || candidate.size < best.candidate.size || (candidate.size === best.candidate.size && cosine > best.cosine)) best = { cosine, candidate };
      }
      if (!best) return null;
      const key = best.candidate.sided && (single || !this.symmetry) ? `${best.candidate.side}-${best.candidate.name}` : best.candidate.name;
      drag.chosen = { ...best.candidate, key, start: drag.value(key) };
    }
    const c = drag.chosen;
    // Whichever direction the value moves, the displacement of that direction's target leads.
    const towards = d => d.lengthSq() > 1e-14 ? delta.dot(d) / d.lengthSq() : 0;
    const up = towards(c.plus), down = c.onlyPositive ? 0 : towards(c.minus);
    const step = Math.abs(up) >= Math.abs(down) ? up : -down;
    const value = Math.max(c.onlyPositive ? 0 : -1, Math.min(1, c.start + step));
    return { key: c.key, category: c.name, value, label: `${regionNames[c.group] ?? c.group} · ${categoryLabel(c.name)}` };
  }
  end() { const chosen = Boolean(this.drag?.chosen); this.drag = null; return chosen; }
}
