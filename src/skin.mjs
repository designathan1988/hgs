/**
 * Skin weights as glTF 2.0 requires them (Skinned Mesh Attributes): weights
 * are never negative, a joint has at most one non-zero weight per vertex, the
 * weights of a vertex sum to 1, unused joint slots are 0, and clients may read
 * only one set of four. Every skinned mesh of a character goes through
 * `sanitizeSkin`; `auditCharacter` reports the checks of a finished character.
 */

/** Merge repeated joints, keep the four largest weights, zero unused slots and normalise. Throws on a vertex left without weight. */
export function sanitizeSkin(geometry, name = 'mesh') {
  const index = geometry.getAttribute('skinIndex'), weight = geometry.getAttribute('skinWeight');
  if (!index || !weight) return geometry;
  const merged = new Map();
  for (let v = 0; v < index.count; v++) {
    merged.clear();
    for (let k = 0; k < index.itemSize; k++) {
      const w = weight.getComponent(v, k);
      if (w > 0) { const joint = index.getComponent(v, k); merged.set(joint, (merged.get(joint) ?? 0) + w); }
    }
    const top = [...merged].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const sum = top.reduce((total, [, w]) => total + w, 0);
    if (!(sum > 0)) throw new Error(`${name}: o vértice ${v} ficou sem peso de esqueleto`);
    for (let k = 0; k < 4; k++) {
      index.setComponent(v, k, top[k]?.[0] ?? 0);
      weight.setComponent(v, k, (top[k]?.[1] ?? 0) / sum);
    }
  }
  index.needsUpdate = true; weight.needsUpdate = true;
  return geometry;
}

/**
 * Checks of a built character: weight sums, influences, unused slots and
 * duplicates per skinned mesh, one shared Skeleton, morph target counts, and
 * the per-corner body ids. Returns a report; `ok` is false on any violation.
 */
export function auditCharacter(human, { tolerance = 1e-6 } = {}) {
  const skinned = [], meshes = [], skeletons = new Set(), problems = [];
  human.group.traverse(object => { if (object.isSkinnedMesh) skinned.push(object); });
  for (const mesh of skinned) {
    const geometry = mesh.geometry, index = geometry.getAttribute('skinIndex'), weight = geometry.getAttribute('skinWeight');
    skeletons.add(mesh.skeleton);
    const entry = { name: mesh.name, vertices: geometry.getAttribute('position').count, triangles: geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3,
      maxInfluences: 0, minSum: Infinity, maxSum: -Infinity, unweighted: 0, zeroWeightJoint: 0, duplicates: 0, outOfRange: 0, morphTargets: geometry.morphAttributes.position?.length ?? 0 };
    if (!index || !weight || index.itemSize !== 4 || weight.itemSize !== 4) { problems.push(`${mesh.name}: sem JOINTS_0/WEIGHTS_0 de 4 componentes`); meshes.push(entry); continue; } // entry is a report row, not iterated
    for (let v = 0; v < index.count; v++) {
      let sum = 0, used = 0; const seen = new Set();
      for (let k = 0; k < 4; k++) {
        const w = weight.getComponent(v, k), j = index.getComponent(v, k);
        if (w < 0) entry.outOfRange++;
        if (j >= mesh.skeleton.bones.length) entry.outOfRange++;
        if (w > 0) { used++; if (seen.has(j)) entry.duplicates++; seen.add(j); } else if (j !== 0) entry.zeroWeightJoint++;
        sum += w;
      }
      if (sum <= 0) entry.unweighted++;
      entry.maxInfluences = Math.max(entry.maxInfluences, used);
      entry.minSum = Math.min(entry.minSum, sum); entry.maxSum = Math.max(entry.maxSum, sum);
    }
    for (const [kind, list] of Object.entries(geometry.morphAttributes)) for (const target of list) if (target.count !== entry.vertices) problems.push(`${mesh.name}: alvo de morph ${kind} "${target.name}" com ${target.count} vértices em vez de ${entry.vertices}`);
    const baseIds = geometry.userData.baseIds;
    if (baseIds && baseIds.length !== entry.vertices) problems.push(`${mesh.name}: baseIds (${baseIds.length}) diferente dos vértices (${entry.vertices})`);
    if (entry.unweighted) problems.push(`${mesh.name}: ${entry.unweighted} vértices sem peso`);
    if (entry.duplicates) problems.push(`${mesh.name}: ${entry.duplicates} juntas repetidas com peso`);
    if (entry.zeroWeightJoint) problems.push(`${mesh.name}: ${entry.zeroWeightJoint} juntas de peso zero com índice diferente de 0`);
    if (entry.outOfRange) problems.push(`${mesh.name}: ${entry.outOfRange} pesos negativos ou juntas fora do esqueleto`);
    if (Math.abs(entry.minSum - 1) > tolerance || Math.abs(entry.maxSum - 1) > tolerance) problems.push(`${mesh.name}: soma dos pesos entre ${entry.minSum} e ${entry.maxSum}`);
    meshes.push(entry);
  }
  if (skeletons.size > 1) problems.push(`${skeletons.size} esqueletos diferentes; o personagem deve ter um só`);
  const skeleton = human.body.skeleton;
  // Mirrored bones (Blender-symmetric rig: tails mirrored, roll negated) have
  // mirrored Y (along the bone) and Z axes at rest; X flips to stay right-handed.
  const restWorld = bone => skeleton.boneInverses[skeleton.bones.indexOf(bone)].clone().invert();
  let mirrorError = 0;
  for (const left of skeleton.bones) {
    if (!/_l$/.test(left.name)) continue;
    const right = skeleton.bones.find(bone => bone.name === left.name.replace(/_l$/, '_r'));
    if (!right) continue;
    const a = restWorld(left).elements, b = restWorld(right).elements;
    for (const column of [4, 8]) mirrorError = Math.max(mirrorError, Math.hypot(-a[column] - b[column], a[column + 1] - b[column + 1], a[column + 2] - b[column + 2]));
  }
  if (mirrorError > 0.1) problems.push(`eixos dos ossos esquerdo/direito não espelhados (desvio ${mirrorError.toFixed(3)})`);
  return { ok: problems.length === 0, problems, meshes, skeletons: skeletons.size, bones: skeleton.bones.length, mirrorError };
}
