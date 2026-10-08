import { Vector3 } from 'three';
import { collisionRadius, constrainLockPose, gravityWeight } from './locks.mjs';

// XPBD position integration and Gauss-Seidel constraints, Macklin et al. 2016,
// https://matthias-research.github.io/pages/publications/XPBD.pdf (Eq.18).
// Current pose + velocity are advanced; q/design is never a reset target.
// Müller et al.2012 §3.2 explains why a static grooming/FTL pass is not dynamics:
// https://matthias-research.github.io/pages/publications/FTLHairFur.pdf .
// The swept convex sections below (rendered elliptical RMF/curl vertices) serve
// the lock-lock audit only; GJK original: Gilbert,Johnson,Keerthi1988,
// https://graphics.stanford.edu/courses/cs164-09-spring/Handouts/paper_GJKoriginal.pdf .
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>scale(a,1/(Math.hypot(...a)||1)), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TOL=1e-5, MARGIN=.00015;
const triple=(a,b,c)=>cross(cross(a,b),c);
// v turned by the shortest rotation taking unit a onto unit b (Rodrigues; half turn about a perpendicular when opposite).
const rotateFromTo=(a,b,v)=>{const k=cross(a,b),c=dot(a,b);if(c<-.9999){const p=norm(cross(a,Math.abs(a[0])<.7?[1,0,0]:[0,1,0]));return sub(scale(p,2*dot(p,v)),v);}const kv=cross(k,v);return add(add(v,kv),scale(cross(k,kv),1/(1+c)));};
const vertex=(p,i)=>[p[i],p[i+1],p[i+2]];
function support(a,b,d){let ma=-Infinity,mb=Infinity,ia=0,ib=0;for(let i=0;i<a.length;i+=3){const t=a[i]*d[0]+a[i+1]*d[1]+a[i+2]*d[2];if(t>ma){ma=t;ia=i;}}for(let i=0;i<b.length;i+=3){const t=b[i]*d[0]+b[i+1]*d[1]+b[i+2]*d[2];if(t<mb){mb=t;ib=i;}}return[a[ia]-b[ib],a[ia+1]-b[ib+1],a[ia+2]-b[ib+2]];}
function simplexDirection(s){
  const a=s[0],ao=scale(a,-1),ab=sub(s[1],a);
  if(s.length===2){if(dot(ab,ao)>0){const d=triple(ab,ao,ab);return Math.hypot(...d)>1e-12?d:cross(ab,Math.abs(ab[0])<.7?[1,0,0]:[0,1,0]);}s.splice(1);return ao;}
  const ac=sub(s[2],a),abc=cross(ab,ac);
  if(s.length===3){
    if(dot(cross(abc,ac),ao)>0){if(dot(ac,ao)>0){s.splice(1,1);return triple(ac,ao,ac);}s.splice(2);return simplexDirection(s);}
    if(dot(cross(ab,abc),ao)>0){s.splice(2);return simplexDirection(s);}
    if(dot(abc,ao)>0)return abc;
    [s[1],s[2]]=[s[2],s[1]];return scale(abc,-1);
  }
  for(const face of [[1,2,3],[2,3,1],[3,1,2]]){
    let n=cross(sub(s[face[0]],a),sub(s[face[1]],a));if(dot(n,sub(s[face[2]],a))>0)n=scale(n,-1);
    if(dot(n,ao)>1e-12){const b=s[face[0]],c=s[face[1]];s.splice(0,s.length,a,b,c);return simplexDirection(s);}
  }
  return null;
}
export function convexVolumesIntersect(a,b){
  let d=[1,.123,.317],s=[support(a,b,d)];d=scale(s[0],-1);
  for(let i=0;i<32;i++){
    if(Math.hypot(...d)<1e-12)return true;
    const p=support(a,b,d);if(dot(p,d)<-1e-12)return false;
    if(s.some(q=>Math.hypot(...sub(q,p))<1e-10))return false;
    s.unshift(p);d=simplexDirection(s);if(d===null)return true;
  }
  return true; // Conservative on a numerically degenerate support iteration.
}
function projection(p,n){let min=Infinity,max=-Infinity;for(let i=0;i<p.length;i+=3){const d=p[i]*n[0]+p[i+1]*n[1]+p[i+2]*n[2];min=Math.min(min,d);max=Math.max(max,d);}return[min,max];}
function sectionAxes(p){const end=p.length-39,c0=scale(add(vertex(p,0),vertex(p,18)),.5),c1=scale(add(vertex(p,end),vertex(p,end+18)),.5);let w=sub(vertex(p,0),vertex(p,18)),r=sub(vertex(p,9),vertex(p,27));if(Math.hypot(...w)<1e-10){w=sub(vertex(p,end),vertex(p,end+18));r=sub(vertex(p,end+9),vertex(p,end+27));}return {center:scale(add(c0,c1),.5),axes:[norm(w),norm(r),norm(sub(c1,c0))]};}
function contact(a,b){
  const axes=[a.axes[1],b.axes[1],a.axes[0],b.axes[0],a.axes[2],b.axes[2],sub(a.center,b.center),cross(a.axes[2],b.axes[2])];let depth=Infinity,normal=null;
  for(const axis of axes){if(Math.hypot(...axis)<1e-8)continue;const n=norm(axis),[amin,amax]=projection(a.p,n),[bmin,bmax]=projection(b.p,n);if(Math.min(amax,bmax)-Math.max(amin,bmin)<=TOL)return null;
    const positive=bmax-amin,negative=amax-bmin;if(Math.min(positive,negative)<depth){depth=Math.min(positive,negative);normal=positive<negative?n:scale(n,-1);}}
  if(!normal||!convexVolumesIntersect(a.p,b.p))return null;
  return{a,b,normal,depth};
}

export function sweptHairPieces(state,surface,active=null){
  const pieces=[];
  for(const [lockIndex,lock]of state.locks.entries()){
    if(active&&!active.has(lock))continue;
    if((lock.density??1)<=0)continue;const part=surface(lock,state,{sides:12}),rings=(part.pos.length/3-1-(lock.tipShape==='flat'?1:0))/13;
    const intervals=[];
    for(let j=0;j+1<rings;j++){
      const u=(part.uv[j*26+1]+part.uv[(j+1)*26+1])*.5,index=Math.min(lock.x.length/3-2,Math.floor(u*(lock.x.length/3-1))),last=intervals.at(-1);
      if(last?.index===index)last.end=j+2;else intervals.push({start:j,end:j+2,index});
    }
    // A control interval contains every original swept triangle vertex in its
    // convex envelope. Grouping does not drop rings or shrink contact extents.
    for(const interval of intervals){
      const j=interval.start,p=part.pos.slice(j*39,interval.end*39), min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[i+k]);max[k]=Math.max(max[k],p[i+k]);}
      if(max.every((v,k)=>v-min[k]<1e-9))continue;
      const frame=sectionAxes(p),u=(part.uv[j*26+1]+part.uv[(interval.end-1)*26+1])*.5;
      pieces.push({p,min,max,...frame,lock,lockIndex,u,ring:j});
    }
  }return pieces;
}
function contactPairs(pieces){
  const cell=.035,grid=new Map(),pairs=new Set(),found=[];
  pieces.forEach((a,i)=>{const lo=a.min.map(v=>Math.floor(v/cell)),hi=a.max.map(v=>Math.floor(v/cell));
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
      const key=`${x},${y},${z}`,list=grid.get(key)??[];
      for(const j of list){const b=pieces[j];if(a.lockIndex===b.lockIndex)continue;const pair=j*pieces.length+i;if(pairs.has(pair))continue;pairs.add(pair);if(a.min.some((v,k)=>v>b.max[k]||a.max[k]<b.min[k]))continue;const hit=contact(a,b);if(hit)found.push(hit);}
      if(!grid.has(key))grid.set(key,list);list.push(i);
    }});return found;
}
export function hairContactAudit(state,surface){const contacts=contactPairs(sweptHairPieces(state,surface));return{penetrating:contacts.length,maxPenetration:contacts.reduce((m,c)=>Math.max(m,c.depth),0),pairs:[...new Set(contacts.map(c=>`${c.a.lockIndex}:${c.b.lockIndex}`))]};}

// Hair-hair interaction follows Müller, Kim & Chentanez 2012 §3.5 (after
// Petrovic et al. 2005): explicit contact between every pair of locks is
// expensive and, for thick overlapping locks, does not converge, so locks
// interact through a density grid. Each particle splats trilinear weights and
// its velocity onto the 8 surrounding nodes; friction blends a velocity
// towards the averaged grid velocity (Eq. 10) and repulsion moves particles
// down the density gradient (Eq. 11, pushing from denser to sparser, as the
// pressure of Petrovic et al.). With ~70 thick locks rather than thousands of
// strands a lock's own particles dominate the field around it, so its own
// share is removed before the gradient is taken. Skin and clothing remain
// hard contacts (§3.6: collision with the character is essential).
const STRETCH_TOLERANCE=.01, BODY_TOLERANCE=.001;
export class HairDynamics{
  constructor(state,{fixedStep=1/120,iterations=20,maskAt=()=>0,friction=.05,repulsionSpeed=null,cell=null}={}){
    this.state=state;this.h=fixedStep;this.iterations=iterations;this.maskAt=maskAt;this.records=new Map();this.accumulator=0;this.time=0;
    // s_friction of Eq. 10; repulsionSpeed is the separation speed Eq. 11 settles to
    // under the velocity decay (default: one lock thickness per second); cell is
    // the grid spacing (default: 1.5 lock thicknesses, so touching locks share cells).
    this.friction=friction;this.repulsionOption=repulsionSpeed;this.cellOption=cell;
    this.stats={steps:0,maxStretch:0,maxPenetration:0,penetrating:0,infeasibleContacts:0,droppedTime:0};this.sync();
  }
  sync(){let thickness=0,count=0;for(const lock of this.state.locks){thickness+=(lock.width??.05)*(lock.volume??.18);count++;}
    this.thickness=Math.max(.002,count?thickness/count:.009);this.cell=this.cellOption??Math.max(.006,1.5*this.thickness);this.repulsionSpeed=this.repulsionOption??this.thickness;
    // Root and follicle point are immovable (TressFX: "the first two vertices are
    // immovable"; the static groom holds both too).
    for(const lock of this.state.locks){lock.rootTaper=true;if(!this.records.has(lock)||this.records.get(lock).x.length!==lock.x.length){const n=lock.x.length/3;this.records.set(lock,{lock,x:Float64Array.from(lock.x),old:Float64Array.from(lock.x),last:Float32Array.from(lock.x),v:new Float64Array(lock.x.length),w:new Float64Array(n),lambda:new Float64Array(n-1),n});}const r=this.records.get(lock);if(r.last.some((v,i)=>v!==lock.x[i])){r.x.set(lock.x);r.v.fill(0);}r.w.fill(lock.fixed||lock.hold?0:1);r.w[0]=r.w[1]=0;for(const [i]of lock.pins)r.w[i]=0;for(let i=1;i<r.n;i++)if(this.maskAt(lock,new Vector3().fromArray(lock.x,i*3))>=1-1e-6)r.w[i]=0;}
    for(const lock of this.records.keys())if(!this.state.locks.includes(lock))this.records.delete(lock);
  }
  pause(){this.accumulator=0;for(const r of this.records.values())r.v.fill(0);}
  advance(delta,{on=true,strength=1}={}){
    if(!on){this.pause();return false;}this.sync();if(!Number.isFinite(delta)||delta<=0)return false;
    const admitted=Math.min(delta,.25);this.stats.droppedTime+=Math.max(0,delta-admitted);this.accumulator+=admitted;let moved=false;
    while(this.accumulator+1e-10>=this.h){this.substep(clamp(strength,0,1));this.accumulator-=this.h;this.time+=this.h;this.stats.steps++;moved=true;}return moved;
  }
  fix(r){const l=r.lock;r.x.set(l.rootP.toArray(),0);for(const[i,p]of l.pins)r.x.set(p.toArray(),i*3);for(let i=1;i<r.n;i++)if(!r.w[i]&&!l.pins.has(i))r.x.set(r.old.subarray(i*3,i*3+3),i*3);}
  distance(r,a,b,length,compliance,lambda,index){const p=r.x,o=a*3,q=b*3,dx=p[q]-p[o],dy=p[q+1]-p[o+1],dz=p[q+2]-p[o+2],d=Math.hypot(dx,dy,dz);if(d<1e-12)return;const alpha=compliance/(this.h*this.h),sum=r.w[a]+r.w[b]+alpha;if(!sum)return;const change=(-(d-length)-alpha*lambda[index])/sum;lambda[index]+=change;const k=change/d;for(const[j,t]of[[o,-r.w[a]],[q,r.w[b]]]){p[j]+=dx*k*t;p[j+1]+=dy*k*t;p[j+2]+=dz*k*t;}}
  // Hard contacts are only skin and clothing; locks meet each other through the density grid.
  // PBD static collision (Müller et al. 2006): the surface point q closest to the particle and its
  // normal n give (p - q)·n ≥ thickness, the clearance the static groom and the exact-length pass
  // keep (collisionRadius; FTL §3.4: the collision thickness of a curl is its radius). Root and
  // follicle point are held, as in the groom.
  buildContacts(){this.publish();const collider=this.state.collider,contacts=[],p=[0,0,0];let infeasible=0;
    if(collider)for(const r of this.records.values())for(let i=2;i<r.n;i++){const o=i*3;p[0]=r.x[o];p[1]=r.x[o+1];p[2]=r.x[o+2];
      if(!collider.resolve(p,0,Math.min(.028,collisionRadius(r.lock,i))))continue;
      // A held point grazing the skin within the tolerance cannot move and does not invalidate the pose.
      if(!r.w[i]){if(collider.depth>MARGIN+BODY_TOLERANCE)infeasible++;continue;}
      const n=[...collider.normal];contacts.push({a:{r,indices:[i,i],weights:[1,0]},b:null,n,minimum:dot(vertex(r.x,o),n)+collider.depth,lambda:0});}
    this.stats.infeasibleContacts=infeasible;return contacts;
  }
  /** TressFX local shape constraint (AMD, TressFXSimulation.hlsl) towards the design shape
   * `rest`: from the root, the rotation taking the design edge (i-1→i) onto the current one
   * carries the design edge (i→i+1); vertex i+1 moves towards that target and vertex i by the
   * opposite amount. The stiffness s = ½·min(stiffness, .95) is released where the static groom
   * lets gravity turn that segment (gravityWeight: the Firmeza ramp and hair lying on the head),
   * so with gravity on a lock settles where the groom hangs it, moving on the way. */
  localShape(r,strength){const x=r.x,g=r.lock.rest,s=.5*Math.min(r.lock.stiffness??.35,.95);if(s<=0)return;
    if(!r.ramp||r.ramp.strength!==strength||r.ramp.stiffness!==r.lock.stiffness||r.ramp.rest.some((v,i)=>v!==g[i])){const k=new Float64Array(r.n),hit={};for(let i=1;i<r.n;i++)k[i]=s*(1-gravityWeight(this.state,r.lock,i,strength,hit));r.ramp={k,strength,stiffness:r.lock.stiffness,rest:Float32Array.from(g)};}
    for(let i=1;i+1<r.n;i++){const o=i*3,f=r.ramp.k[i+1];if(f<=0)continue;const edge=sub(vertex(g,o+3),vertex(g,o)),target=add(vertex(x,o),rotateFromTo(norm(sub(vertex(g,o),vertex(g,o-3))),norm(sub(vertex(x,o),vertex(x,o-3))),edge)),del=scale(sub(target,vertex(x,o+3)),f);
      if(r.w[i])for(let k=0;k<3;k++)x[o+k]-=del[k];if(r.w[i+1])for(let k=0;k<3;k++)x[o+3+k]+=del[k];}
  }
  projectContact(c){const point=p=>[0,1,2].map(k=>p.r.x[p.indices[0]*3+k]*p.weights[0]+p.r.x[p.indices[1]*3+k]*p.weights[1]);const a=point(c.a),b=c.b?point(c.b):[0,0,0],C=dot(sub(a,b),c.n)-c.minimum;let mass=0;for(const p of[c.a,c.b].filter(Boolean))for(let k=0;k<2;k++)mass+=p.r.w[p.indices[k]]*p.weights[k]**2;if(!mass)return;const next=Math.max(0,c.lambda-C/mass),change=next-c.lambda;c.lambda=next;for(const[p,sign]of[[c.a,1],[c.b,-1]])if(p)for(let k=0;k<2;k++){const i=p.indices[k],amount=sign*change*p.r.w[i]*p.weights[k];for(let j=0;j<3;j++)p.r.x[i*3+j]+=c.n[j]*amount;}}
  /** Density-grid friction (Eq. 10) and repulsion (Eq. 11); `decay` is the per-step velocity decay. */
  hairHair(decay){
    const cell=this.cell,grid=new Map(),key=(i,j,k)=>`${i},${j},${k}`;
    // Trilinear weights of p on its 8 grid nodes, with their derivatives (per metre).
    const corners=(p,o,visit)=>{const fx=p[o]/cell,fy=p[o+1]/cell,fz=p[o+2]/cell,i=Math.floor(fx),j=Math.floor(fy),k=Math.floor(fz),tx=fx-i,ty=fy-j,tz=fz-k;
      for(let c=0;c<8;c++){const dx=c&1,dy=c>>1&1,dz=c>>2&1,wx=dx?tx:1-tx,wy=dy?ty:1-ty,wz=dz?tz:1-tz,sx=(dx?1:-1)/cell,sy=(dy?1:-1)/cell,sz=(dz?1:-1)/cell;
        visit(key(i+dx,j+dy,k+dz),wx*wy*wz,sx*wy*wz,wx*sy*wz,wx*wy*sz);}};
    const records=[...this.records.values()];
    for(const r of records)for(let i=0;i<r.n;i++)corners(r.x,i*3,(id,w)=>{let node=grid.get(id);if(!node)grid.set(id,node=[0,0,0,0]);node[0]+=w;node[1]+=w*r.v[i*3];node[2]+=w*r.v[i*3+1];node[3]+=w*r.v[i*3+2];});
    const push=this.repulsionSpeed*(1-decay);
    for(const r of records){
      // This lock's own density, removed so a lock is not pushed by itself.
      const own=new Map();for(let i=0;i<r.n;i++)corners(r.x,i*3,(id,w)=>own.set(id,(own.get(id)??0)+w));
      for(let i=1;i<r.n;i++){if(!r.w[i])continue;const o=i*3;let vx=0,vy=0,vz=0,mass=0,density=0,gx=0,gy=0,gz=0;
        corners(r.x,o,(id,w,dx,dy,dz)=>{const node=grid.get(id);if(node[0]>1e-12){vx+=w*node[1]/node[0];vy+=w*node[2]/node[0];vz+=w*node[3]/node[0];mass+=w;}const other=Math.max(0,node[0]-(own.get(id)??0));density+=w*other;gx+=dx*other;gy+=dy*other;gz+=dz*other;});
        if(mass>1e-12){const f=this.friction;r.v[o]=(1-f)*r.v[o]+f*vx/mass;r.v[o+1]=(1-f)*r.v[o+1]+f*vy/mass;r.v[o+2]=(1-f)*r.v[o+2]+f*vz/mass;}
        const g=Math.hypot(gx,gy,gz);if(density>1e-9&&g>1e-9){r.v[o]-=push*gx/g;r.v[o+1]-=push*gy/g;r.v[o+2]-=push*gz/g;}
      }
    }
  }
  substep(strength){
    const started=performance.now();let contactMs=0;
    // Integration, then the local shape constraint (TressFXSettings default: 2 iterations;
    // global shape constraint off), then length and collision (TressFX order).
    for(const r of this.records.values()){r.old.set(r.x);r.lambda.fill(0);for(let i=1;i<r.n;i++)if(r.w[i]){const o=i*3;r.v[o+1]-=9.81*strength*this.h;for(let k=0;k<3;k++)r.x[o+k]+=r.v[o+k]*this.h;}this.fix(r);for(let pass=0;pass<2;pass++){this.localShape(r,strength);this.fix(r);}}
    let contacts=[];this.stats.stalledContacts=0;
    for(let pass=0;pass<this.iterations;pass++){
      if(pass===0||pass===Math.floor(this.iterations/2)){const at=performance.now();contacts=this.buildContacts();contactMs+=performance.now()-at;}
      for(const r of this.records.values()){for(let i=0;i+1<r.n;i++)this.distance(r,i,i+1,r.lock.seg,0,r.lambda,i);this.fix(r);}
      for(const c of contacts)this.projectContact(c);
    }
    // Reconstruct momentum, then remove separating correction velocity at
    // penetration contacts (zero restitution). Initial overlap correction must
    // not become an artificial launch away from the head.
    // The exact-length pass turns points out of the same skin/clothing clearance (FTL §3.1).
    for(const r of this.records.values()){
      const protectedPoints=new Map();for(let i=1;i<r.n;i++)if(!r.w[i]&&!r.lock.pins.has(i))protectedPoints.set(i,new Vector3().fromArray(r.old,i*3));
      const publicPose=r.lock.x;r.lock.x=r.x;
      try{constrainLockPose(r.lock,this.state,{reference:r.old,protectedPoints,fixFollicle:false});}finally{r.lock.x=publicPose;}
    }
    const decay=Math.exp(-3*this.h);
    for(const r of this.records.values())for(let i=0;i<r.n;i++)for(let k=0;k<3;k++)r.v[i*3+k]=r.w[i]?(r.x[i*3+k]-r.old[i*3+k])/this.h*decay:0;
    for(const c of contacts)for(const[p,sign]of[[c.a,1],[c.b,-1]])if(p)for(const i of p.indices){const o=i*3,normal=scale(c.n,sign),speed=dot(vertex(p.r.v,o),normal);if(speed>0)for(let k=0;k<3;k++)p.r.v[o+k]-=normal[k]*speed;}
    // Velocity corrections after the position step (§3.5: "executed after PBD integration").
    const gridAt=performance.now();this.hairHair(decay);const gridMs=performance.now()-gridAt;
    // Depth still inside the skin/clothing clearance after the solve (metres), queried on the
    // surface itself: the step's contacts are a fixed linearisation (PBD) and a point sliding
    // over the curved head passes under its old tangent plane without entering the head.
    let bodyViolation=0;const collider=this.state.collider,probe=[0,0,0];
    if(collider)for(const r of this.records.values())for(let i=2;i<r.n;i++){if(!r.w[i])continue;probe[0]=r.x[i*3];probe[1]=r.x[i*3+1];probe[2]=r.x[i*3+2];if(collider.resolve(probe,0,Math.min(.028,collisionRadius(r.lock,i))))bodyViolation=Math.max(bodyViolation,collider.depth-MARGIN);}
    this.publish();let maxStretch=0;for(const r of this.records.values())for(let i=1;i<r.n;i++)maxStretch=Math.max(maxStretch,Math.abs(Math.hypot(r.x[i*3]-r.x[(i-1)*3],r.x[i*3+1]-r.x[(i-1)*3+1],r.x[i*3+2]-r.x[(i-1)*3+2])/r.lock.seg-1));this.stats.maxStretch=maxStretch;
    this.stats.penetrating=0;this.stats.maxPenetration=Math.max(0,bodyViolation);this.stats.timings={contactMs,gridMs,totalMs:performance.now()-started};
    // What a step leaves inside the clearance is pushed out by the next step's contacts (PBD), so it
    // is reported, not fatal; a pose fails only when it diverges (stretch) or a held point is inside.
    const stretched=maxStretch>STRETCH_TOLERANCE;
    this.stats.validPose=!stretched&&this.stats.infeasibleContacts===0;
    this.stats.error=this.stats.validPose?null:stretched?'As mechas esticaram além do comprimento.':'Um ponto preso está dentro do corpo ou da roupa.';
  }
  publish(){for(const r of this.records.values()){r.lock.x.set(r.x);r.last.set(r.lock.x);}}
}

