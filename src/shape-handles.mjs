import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector3 } from 'three';

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
  foot: 'pé', hand: 'mão', fingers: 'dedos', eyebrows: 'sobrancelhas', breast: 'mama', nipple: 'mamilo', tone: 'tônus', ankle: 'tornozelo', wrist: 'pulso',
  diameter: 'espessura', distance: 'distância', measure: 'medida', concave: 'côncavo', convex: 'convexo', pointed: 'pontudo', square: 'quadrado',
  shape: 'formato', inner: 'interno', top: 'topo', trunk: 'tronco', brown: 'sobrancelha', asym: 'assimetria', asymm: 'assimetria', l: '', r: '',
};
// Whole labels for the targets whose name does not read word by word: MakeHuman's own slider labels
// (data/modifiers/modeling_sliders.json), in Portuguese. Keyed by the name without its side prefix.
const labels = {
  // Measured on the targets: height 1, 2, 3 open the eye at its inner part, middle and outer part.
  'eye-height1-decr-incr': 'abertura junto ao nariz', 'eye-height2-decr-incr': 'abertura no meio', 'eye-height3-decr-incr': 'abertura no canto externo',
  'eye-push1-in-out': 'canto externo para os lados', 'eye-push2-in-out': 'canto interno para os lados',
  'eye-corner1-down-up': 'canto externo para cima', 'eye-corner2-down-up': 'canto interno para cima',
  'eye-eyefold-down-up': 'posição da prega', 'eye-eyefold-angle-down-up': 'ângulo da prega', 'eye-eyefold-concave-convex': 'volume da prega',
  'nose-width1-decr-incr': 'largura do dorso', 'nose-width2-decr-incr': 'largura do meio', 'nose-width3-decr-incr': 'largura da base',
  'nose-base-down-up': 'base para cima', 'nose-compression-compress-uncompress': 'compressão',
  'mouth-angles-down-up': 'cantos para cima', 'mouth-upperlip-ext-down-up': 'curvatura do lábio superior', 'mouth-lowerlip-ext-down-up': 'curvatura do lábio inferior',
  'mouth-upperlip-middle-down-up': 'meio do lábio superior', 'mouth-lowerlip-middle-down-up': 'meio do lábio inferior',
  'mouth-laugh-lines-in-out': 'sulco nasolabial', 'mouth-philtrum-volume-decr-incr': 'volume do filtro', 'mouth-cupidsbow-decr-incr': 'arco do cupido',
  'mouth-cupidsbow-width-decr-incr': 'largura do arco do cupido',
  'ear-flap-decr-incr': 'orelha de abano', 'ear-wing-decr-incr': 'orelha em asa', 'ear-rot-backward-forward': 'rotação',
  'ear-shape-pointed-triangle': 'formato pontudo↔triangular', 'ear-shape-square-round': 'formato quadrado↔redondo',
  'head-oval': 'oval', 'head-round': 'redonda', 'head-rectangular': 'retangular', 'head-square': 'quadrada', 'head-triangular': 'triangular',
  'head-invertedtriangular': 'triângulo invertido', 'head-diamond': 'losango', 'head-age-decr-incr': 'idade',
  'head-back-scale-depth-decr-incr': 'profundidade da parte de trás', 'neck-back-scale-depth-decr-incr': 'profundidade da nuca',
  'torso-vshape-decr-incr': 'formato em V', 'torso-muscle-dorsi-decr-incr': 'dorsais', 'torso-muscle-pectoral-decr-incr': 'peitorais',
  'leg-valgus-decr-incr': 'joelho para dentro↔fora', 'cheek-inner-decr-incr': 'volume interno', 'chin-jaw-drop-decr-incr': 'tônus da lateral do queixo',
  'chin-prognathism-decr-incr': 'queixo projetado', 'pelvis-tone-decr-incr': 'tônus da pelve', 'stomach-tone-decr-incr': 'tônus abdominal',
  'measure-napetowaist-dist-decr-incr': 'nuca à cintura', 'measure-waisttohip-dist-decr-incr': 'cintura ao quadril', 'measure-frontchest-dist-decr-incr': 'largura do peito',
};
/** A readable Portuguese label for a MakeHuman category name. */
export function categoryLabel(name) {
  if (labels[name.replace(/^[lr]-/, '')]) return labels[name.replace(/^[lr]-/, '')];
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
      // Every target the adjustment drives (both sides when symmetric), for drawing its area.
      const other = sided ? (side === 'left' ? 'right' : 'left') : null;
      const targets = [positive, negative, ...(other && category.opposites ? [category.opposites[`positive-${other}`], category.opposites[`negative-${other}`]] : [])].filter(Boolean).map(t => `${group}/${t}`);
      const own = [positive, negative].filter(Boolean).map(t => `${group}/${t}`);
      list.push({ name, group, sided, side: x >= 0 ? 'l' : 'r', plus, minus, size, targets, own, onlyPositive: !category.opposites, plusPeak: peak(positive), minusPeak: peak(negative) });
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
      // The part is the region of the point (regionOf: chin, nose…); inside it, the adjustment that carries
      // the point farthest along the pull wins (pulling the chin down takes its height, 17 mm, not its
      // cleft, 1.5 mm). With nothing fitting there, the smallest area anywhere (moving the whole head also
      // moves the chin, but loses).
      const pull = delta.length(), options = [], region = this.regionOf(drag.candidates);
      for (const candidate of drag.candidates) for (const [sign, d, peak] of [[1, candidate.plus, candidate.plusPeak], [-1, candidate.minus, candidate.minusPeak]]) {
        const length = d.length();
        if (length < 1e-9 || (sign < 0 && candidate.onlyPositive)) continue;
        const cosine = delta.dot(d) / (length * pull);
        if (cosine < 0.6 || length < 0.5 * peak) continue;
        options.push({ cosine, candidate, along: delta.dot(d) / pull });
      }
      let best = null;
      for (const option of options.filter(option => option.candidate.group === region)) {
        if (!best || option.along > best.along || (option.along === best.along && option.candidate.size < best.candidate.size)) best = option;
      }
      if (!best) for (const option of options) {
        if (!best || option.candidate.size < best.candidate.size || (option.candidate.size === best.candidate.size && option.cosine > best.cosine)) best = option;
      }
      if (!best) return null;
      const key = best.candidate.sided && (single || !this.symmetry) ? `${best.candidate.side}-${best.candidate.name}` : best.candidate.name;
      drag.chosen = { ...best.candidate, key, start: drag.value(key) };
      // The part being pulled stays lit (one side only with Alt or without symmetry).
      this.highlight(key === best.candidate.name ? best.candidate : { ...best.candidate, targets: best.candidate.own });
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
  /**
   * The region a point belongs to: the group (chin, nose, ears…) of the most local adjustment whose core
   * holds it (it moves the point at least half as much as anywhere). Whole-body scales also have their
   * core at the head, but their area is thousands of vertices, so they never decide the region.
   */
  regionOf(candidates) {
    let best = null;
    for (const candidate of candidates) {
      const core = candidate.plus.length() >= 0.5 * candidate.plusPeak || (!candidate.onlyPositive && candidate.minus.length() >= 0.5 * candidate.minusPeak);
      if (core && (!best || candidate.size < best.size)) best = candidate;
    }
    return best?.group ?? null;
  }
  /**
   * Before a pull, light the part under the cursor (The Sims 4 Create-a-Sim lights the part to be
   * pulled; MetaHuman Creator shows its markers): the most local adjustment whose core holds this point,
   * the one a pull would most likely take. Null when off the body.
   */
  hover(ndc) {
    if (this.drag) return;
    const at = this.vertexAt(ndc);
    if (at?.v === this.hoverVertex) return;
    this.hoverVertex = at?.v;
    if (!at) { this.highlight(null); return; }
    // The pull's rule (move()) without a direction yet: in the point's region, the adjustment that moves
    // the point most.
    const candidates = this.candidates(at.v, this.renderer.current.context.positions[at.v * 3]), region = this.regionOf(candidates);
    let best = null, most = 0;
    for (const candidate of candidates) {
      if (candidate.group !== region) continue;
      const plus = candidate.plus.length(), minus = candidate.onlyPositive ? 0 : candidate.minus.length();
      const reach = Math.max(plus >= 0.5 * candidate.plusPeak ? plus : 0, minus >= 0.5 * candidate.minusPeak ? minus : 0);
      if (reach > most) { most = reach; best = candidate; }
    }
    this.highlight(best);
  }
  /**
   * Draw `candidate`'s area over the skin: a mesh sharing the body's positions and morph targets (the body
   * rests in its bind pose while molding), one RGBA colour per corner with alpha from how far the
   * adjustment moves that vertex, drawn without depth writes and with a polygon offset, like a decal.
   */
  highlight(candidate) {
    const body = this.renderer.current?.body;
    const key = candidate && body ? `${candidate.targets.join('|')}` : null;
    if (key === this.lit && this.overlay?.parent === body) return;
    this.lit = key;
    if (this.overlay) { this.overlay.removeFromParent(); this.overlay.geometry.dispose(); this.overlay.material.dispose(); this.overlay = null; }
    if (!key) return;
    const morpher = this.renderer.current.context.data.morpher, unit = this.renderer.current.context.positions.unitScale ?? 0.1;
    const source = body.geometry, ids = source.userData.baseIds, strength = new Map();
    for (const name of candidate.targets) {
      const t = morpher.localByName.get(name), peak = this.peakOf(name);
      if (!t || !peak) continue;
      for (let e = t.start; e < t.start + t.count; e++) {
        const d = Math.hypot(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]) * t.scale * unit / peak;
        if (d > 0.05) strength.set(morpher.lIdx[e], Math.max(strength.get(morpher.lIdx[e]) ?? 0, Math.min(1, d)));
      }
    }
    const count = source.getAttribute('position').count, colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const s = strength.get(ids[i]) ?? 0;
      colors.set([0.66, 0.55, 1, 0.12 + 0.43 * s], i * 4);
      if (!s) colors[i * 4 + 3] = 0;
    }
    const index = source.index.array, kept = [];
    for (let i = 0; i < index.length; i += 3) if (colors[index[i] * 4 + 3] || colors[index[i + 1] * 4 + 3] || colors[index[i + 2] * 4 + 3]) kept.push(index[i], index[i + 1], index[i + 2]);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', source.getAttribute('position'));
    geometry.setAttribute('color', new BufferAttribute(colors, 4));
    geometry.morphAttributes = source.morphAttributes; geometry.morphTargetsRelative = source.morphTargetsRelative;
    geometry.setIndex(kept);
    const overlay = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    overlay.name = 'MoldHighlight'; overlay.renderOrder = 2;
    overlay.morphTargetInfluences = body.morphTargetInfluences; overlay.morphTargetDictionary = body.morphTargetDictionary;
    body.add(overlay);
    this.overlay = overlay;
  }
}
