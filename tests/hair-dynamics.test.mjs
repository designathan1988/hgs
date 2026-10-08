import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { HairDynamics, hairContactAudit } from '../src/hair-dynamics.mjs';
import { LOCK_POINTS as N, lockSurface } from '../src/locks.mjs';

function guide(root, direction, length = .2, extra = {}) {
  const rootP = new Vector3(...root), d = new Vector3(...direction).normalize(), x = new Float32Array(N * 3), seg = length / (N - 1);
  for (let i = 0; i < N; i++) x.set(rootP.clone().addScaledVector(d, i * seg).toArray(), i * 3);
  return { rootP, rootN: new Vector3(0, 1, 0), root: { v: [0, 1, 2], w: [1, 0, 0] }, x, rest: Float32Array.from(x), seg, styled: true, fixed: false, pins: new Map(), facing: new Float32Array(N * 3), width: .012, volume: .8, taper: .3, curl: 0, turns: 2, twist: 0, stiffness: .1, bend: 0, ...extra };
}
const state = locks => ({ locks, frame: { C: new Vector3(), R: .11 }, collider: null });
const stretch = locks => Math.max(...locks.flatMap(l => Array.from({length:N-1},(_,i)=>Math.abs(new Vector3().fromArray(l.x,(i+1)*3).distanceTo(new Vector3().fromArray(l.x,i*3))/l.seg-1))));

test('live gravity advances current poses over time and off freezes without resetting design', () => {
  const s = state([guide([0,.3,0],[1,.2,0])]), physics = new HairDynamics(s, { surface: lockSurface });
  const design = [...s.locks[0].rest], before = [...s.locks[0].x];
  for (let i=0;i<30;i++) physics.advance(1/60,{on:true,strength:1});
  assert.ok(s.locks[0].x.at(-2) < before.at(-2) - .04);
  assert.deepEqual([...s.locks[0].rest],design); assert.ok(stretch(s.locks)<.002);
  const frozen = [...s.locks[0].x];
  for (let i=0;i<30;i++) physics.advance(1/60,{on:false,strength:1});
  assert.deepEqual([...s.locks[0].x],frozen);
  physics.advance(1/60,{on:true,strength:1}); assert.notDeepEqual([...s.locks[0].x],before);
});

test('live gravity is invariant to render delta grouping and preserves explicit pins', () => {
  const a=state([guide([0,.3,0],[1,.3,.2])]), b=state([guide([0,.3,0],[1,.3,.2])]);
  for(const s of [a,b]) s.locks[0].pins.set(8,new Vector3().fromArray(s.locks[0].x,24));
  const pa=new HairDynamics(a,{surface:lockSurface}),pb=new HairDynamics(b,{surface:lockSurface});
  for(let i=0;i<30;i++)pa.advance(1/60,{on:true,strength:1});for(let i=0;i<60;i++)pb.advance(1/120,{on:true,strength:1});
  for(let i=0;i<N*3;i++)assert.ok(Math.abs(a.locks[0].x[i]-b.locks[0].x[i])<.00001);
  assert.ok(new Vector3().fromArray(a.locks[0].x,24).distanceTo(a.locks[0].pins.get(8))<.000001);assert.ok(stretch(a.locks)<.002);
});

test('shared attachment is a zero-radius closed tip, not a hidden positive-volume cap', () => {
  const s=state([guide([0,.3,0],[1,.2,0]),guide([0,.3,0],[-1,.2,0])]);new HairDynamics(s,{surface:lockSurface});
  for(const l of s.locks){const mesh=lockSurface(l,s);for(let i=0;i<13;i++)assert.ok(new Vector3().fromArray(mesh.pos,i*3).distanceTo(l.rootP)<.000001);}
  assert.equal(hairContactAudit(s,lockSurface).penetrating,0);
});

test('actual swept solid contacts separate crossing free guides without moving roots or editing design', () => {
  const s=state([guide([-.09,.3,0],[1,0,0],.25),guide([.09,.3,.003],[-1,0,0],.25)]),p=new HairDynamics(s,{surface:lockSurface});
  const design=s.locks.map(l=>[...l.rest]), roots=s.locks.map(l=>l.rootP.toArray());
  assert.ok(hairContactAudit(s,lockSurface).penetrating>0);
  for(let i=0;i<90;i++)p.advance(1/60,{on:true,strength:1});
  const audit=hairContactAudit(s,lockSurface);assert.ok(audit.maxPenetration<.0005,JSON.stringify(audit));assert.ok(stretch(s.locks)<.002);
  for(let k=0;k<s.locks.length;k++){assert.deepEqual([...s.locks[k].rest],design[k]);assert.ok(new Vector3().fromArray(s.locks[k].x).distanceTo(new Vector3(...roots[k]))<.000001);}
});

test('overlapping fully fixed solids are reported infeasible rather than moved or hidden', () => {
  const s=state([guide([0,.3,0],[1,0,0],.2,{fixed:true}),guide([0,.3,0],[1,0,0],.2,{fixed:true})]),p=new HairDynamics(s,{surface:lockSurface}),before=s.locks.map(l=>[...l.x]);
  p.advance(1/60,{on:true,strength:1});assert.ok(p.stats.infeasibleContacts>0);assert.ok(p.stats.maxPenetration>.001);
  assert.deepEqual(s.locks.map(l=>[...l.x]),before);assert.equal(s.locks.length,2);
});
