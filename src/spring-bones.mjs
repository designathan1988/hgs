import { Quaternion, Vector3 } from 'three';

/**
 * Spring joints after the VRMC_springBone 1.0 reference algorithm: per joint
 * pair (head rotates, tail moves), from the root of each chain to its tip,
 *   inertia   = (currentTail − prevTail) · (1 − dragForce)
 *   stiffness = Δt · parentWorldRotation · initialLocalRotation · boneAxis · stiffness
 *   external  = Δt · gravityDir · gravityPower
 *   nextTail  = currentTail + inertia + stiffness + external, kept at bone length,
 * pushed out of sphere/capsule colliders (plus the joint's hitRadius), then the
 * head rotates by initialLocalRotation · fromTo(boneAxis, nextTail in the rest
 * frame). `definition` uses bone names (hair-rig.mjs).
 */
export class SpringBones {
  constructor(root, definition) {
    this.root = root;
    const find = name => root.getObjectByName(name);
    this.colliders = (definition?.colliders ?? []).map(({ bone, shape }) => {
      const node = find(bone);
      if (!node) return null;
      if (shape.sphere) return { node, radius: shape.sphere.radius, offset: new Vector3(...shape.sphere.offset), tail: null };
      return { node, radius: shape.capsule.radius, offset: new Vector3(...shape.capsule.offset), tail: new Vector3(...shape.capsule.tail) };
    }).filter(Boolean);
    this.chains = (definition?.springs ?? []).map(spring => {
      const nodes = spring.joints.map(joint => find(joint.node));
      if (nodes.some(node => !node)) return null;
      const groups = spring.colliderGroups ?? [], members = new Set(groups.flatMap(g => definition.colliderGroups[g]?.colliders ?? []));
      const pairs = [];
      for (let i = 0; i + 1 < nodes.length; i++) {
        const joint = spring.joints[i], head = nodes[i], tail = nodes[i + 1];
        pairs.push({
          head, tail, settings: joint,
          gravity: new Vector3(...(joint.gravityDir ?? [0, -1, 0])).normalize(),
          initialLocalRotation: head.quaternion.clone(),
          boneAxis: tail.position.clone().normalize(),
          length: tail.position.length() * head.getWorldScale(new Vector3()).x,
          prevTail: new Vector3(), currentTail: new Vector3(),
        });
      }
      // `center` (VRMC_springBone 1.0): inertia is evaluated in this node's space, so the body's own travel
      // (running, the hips' sway) is not inertia; the tails are kept in its space between frames.
      return { pairs, colliders: this.colliders.filter((_, i) => members.has(i)), center: spring.center ? find(spring.center) ?? null : null };
    }).filter(Boolean);
    this.reset();
  }
  get active() { return this.chains.length > 0; }
  /** Rest the joints at their initial rotation and restart the simulation from the current pose. */
  reset() {
    for (const chain of this.chains) for (const pair of chain.pairs) pair.head.quaternion.copy(pair.initialLocalRotation);
    this.root.updateMatrixWorld(true);
    for (const chain of this.chains) for (const pair of chain.pairs) {
      pair.tail.getWorldPosition(pair.currentTail);
      if (chain.center) chain.center.worldToLocal(pair.currentTail);
      pair.prevTail.copy(pair.currentTail);
    }
  }
  update(delta) {
    if (!this.chains.length) return;
    const dt = Math.min(Math.max(delta, 0), 1 / 30);
    if (dt <= 0) return;
    this.root.updateMatrixWorld(true);
    const world = new Vector3(), parentRotation = new Quaternion(), next = new Vector3(), inertia = new Vector3(), stiffness = new Vector3();
    const center = new Vector3(), tailPoint = new Vector3(), segment = new Vector3(), closest = new Vector3(), toLocal = new Quaternion(), to = new Vector3();
    const currentWorld = new Vector3(), prevWorld = new Vector3();
    for (const chain of this.chains) {
      const colliders = chain.colliders.map(c => ({ radius: c.radius, a: c.offset.clone().applyMatrix4(c.node.matrixWorld), b: c.tail ? c.tail.clone().applyMatrix4(c.node.matrixWorld) : null }));
      const space = chain.center?.matrixWorld ?? null;
      for (const pair of chain.pairs) {
        const { head, settings } = pair;
        head.getWorldPosition(world);
        head.parent.getWorldQuaternion(parentRotation);
        // Both tails taken to the world through the center's current transform: its motion cancels out.
        currentWorld.copy(pair.currentTail); prevWorld.copy(pair.prevTail);
        if (space) { currentWorld.applyMatrix4(space); prevWorld.applyMatrix4(space); }
        inertia.subVectors(currentWorld, prevWorld).multiplyScalar(1 - (settings.dragForce ?? 0.5));
        stiffness.copy(pair.boneAxis).applyQuaternion(pair.initialLocalRotation).applyQuaternion(parentRotation).multiplyScalar(dt * (settings.stiffness ?? 1));
        next.copy(currentWorld).add(inertia).add(stiffness).addScaledVector(pair.gravity, dt * (settings.gravityPower ?? 0));
        next.sub(world).setLength(pair.length).add(world);
        const hitRadius = settings.hitRadius ?? 0;
        for (const collider of colliders) {
          if (collider.b) {
            segment.subVectors(collider.b, collider.a);
            const t = Math.max(0, Math.min(1, tailPoint.subVectors(next, collider.a).dot(segment) / Math.max(1e-12, segment.lengthSq())));
            center.copy(collider.a).addScaledVector(segment, t);
          } else center.copy(collider.a);
          closest.subVectors(next, center);
          const reach = collider.radius + hitRadius, distance = closest.length();
          if (distance < reach) {
            next.copy(center).addScaledVector(distance > 1e-9 ? closest.divideScalar(distance) : closest.set(0, 1, 0), reach);
            next.sub(world).setLength(pair.length).add(world);
          }
        }
        pair.prevTail.copy(pair.currentTail); pair.currentTail.copy(next);
        if (chain.center) chain.center.worldToLocal(pair.currentTail);
        // Rotate the head so its rest axis points at the new tail.
        toLocal.copy(parentRotation).multiply(pair.initialLocalRotation).invert();
        to.subVectors(next, world).applyQuaternion(toLocal).normalize();
        head.quaternion.copy(pair.initialLocalRotation).multiply(new Quaternion().setFromUnitVectors(pair.boneAxis, to));
        head.updateMatrixWorld(true);
      }
    }
  }
}
