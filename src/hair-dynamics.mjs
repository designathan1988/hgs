import { Vector3 } from 'three';
import { constrainLockPose } from './locks.mjs';

// XPBD position integration and Gauss-Seidel constraints, Macklin et al. 2016,
// https://matthias-research.github.io/pages/publications/XPBD.pdf (Eq.18).
// Current pose + velocity are advanced; q/design is never a reset target.
// Müller et al.2012 §3.2 explains why a static grooming/FTL pass is not dynamics:
// https://matthias-research.github.io/pages/publications/FTLHairFur.pdf .
// Collision envelopes are convex sections containing the *rendered* elliptical
// RMF/curl vertices, not centreline spheres or the old 0.4-thickness layers.
// GJK original: Gilbert,Johnson,Keerthi1988, https://graphics.stanford.edu/courses/cs164-09-spring/Handouts/paper_GJKoriginal.pdf .
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>scale(a,1/(Math.hypot(...a)||1)), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TOL=1e-5, MARGIN=.00015;
const triple=(a,b,c)=>cross(cross(a,b),c);
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

export class HairDynamics{
  constructor(state,{surface,fixedStep=1/120,iterations=20,maskAt=()=>0}={}){
    if(typeof surface!=='function')throw new TypeError('HairDynamics requires the rendered lock surface function');
    this.state=state;this.surface=surface;this.h=fixedStep;this.iterations=iterations;this.maskAt=maskAt;this.records=new Map();this.accumulator=0;this.time=0;this.bodyAudit=true;this.stats={steps:0,maxStretch:0,maxPenetration:0,penetrating:0,infeasibleContacts:0,droppedTime:0};this.sync();
  }
  sync(){for(const lock of this.state.locks){lock.rootTaper=true;if(!this.records.has(lock)||this.records.get(lock).x.length!==lock.x.length){const n=lock.x.length/3;this.records.set(lock,{lock,x:Float64Array.from(lock.x),old:Float64Array.from(lock.x),last:Float32Array.from(lock.x),v:new Float64Array(lock.x.length),w:new Float64Array(n),lambda:new Float64Array(n-1),bendLambda:new Float64Array(Math.max(0,n-2)),n});this.bodyAudit=true;}const r=this.records.get(lock);if(r.last.some((v,i)=>v!==lock.x[i])){r.x.set(lock.x);r.v.fill(0);this.bodyAudit=true;}r.w.fill(lock.fixed||lock.hold?0:1);r.w[0]=0;for(const [i]of lock.pins)r.w[i]=0;for(let i=1;i<r.n;i++)if(this.maskAt(lock,new Vector3().fromArray(lock.x,i*3))>=1-1e-6)r.w[i]=0;}
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
  anchors(piece){const r=this.records.get(piece.lock),f=clamp(piece.u,0,1)*(r.n-1),i=Math.min(r.n-2,Math.floor(f)),t=f-i;return{r,indices:[i,i+1],weights:[1-t,t],p:[0,1,2].map(k=>r.x[i*3+k]*(1-t)+r.x[(i+1)*3+k]*t)};}
  buildContacts(active=null){this.publish();const pieces=sweptHairPieces(this.state,this.surface,active), contacts=[];let infeasible=0;
    for(const hit of contactPairs(pieces)){
      const a=this.anchors(hit.a),b=this.anchors(hit.b),n=hit.normal,minimum=dot(sub(a.p,b.p),n)+hit.depth+MARGIN;
      const mobility=[a,b].reduce((sum,p)=>sum+p.indices.reduce((s,i,k)=>s+p.r.w[i]*p.weights[k]**2,0),0);
      if(mobility<1e-12){infeasible++;continue;}contacts.push({a,b,n,minimum,lambda:0});
    }
    const head=this.state.collider?.head,hit={};
    if(head)for(const piece of pieces){const a=this.anchors(piece),center=piece.center;let radius=0;for(let i=0;i<piece.p.length;i+=3)radius=Math.max(radius,Math.hypot(piece.p[i]-center[0],piece.p[i+1]-center[1],piece.p[i+2]-center[2]));radius=Math.max(.012,radius+MARGIN+this.h*this.h*9.81);
      // Every layer is tested: the nearest skin surface must not hide a garment.
      // Following the initial/deformed-pose audit, a surface outside the swept
      // piece's enclosing sphere cannot intersect it, so a smaller query is exact.
      for(const layer of head.layers){if(!layer.closest(...center,this.bodyAudit?Math.max(.07,radius):radius,hit))continue;const n=[hit.nx,hit.ny,hit.nz],minimum=dot([hit.x,hit.y,hit.z],n)+MARGIN+(dot(a.p,n)-projection(piece.p,n)[0]);const mobility=a.indices.reduce((s,i,k)=>s+a.r.w[i]*a.weights[k]**2,0);if(dot(a.p,n)>=minimum)continue;if(mobility<1e-12){infeasible++;continue;}contacts.push({a,b:null,n,minimum,lambda:0});}}
    this.stats.infeasibleContacts=infeasible;return contacts;
  }
  projectContact(c){const point=p=>[0,1,2].map(k=>p.r.x[p.indices[0]*3+k]*p.weights[0]+p.r.x[p.indices[1]*3+k]*p.weights[1]);const a=point(c.a),b=c.b?point(c.b):[0,0,0],C=dot(sub(a,b),c.n)-c.minimum;let mass=0;for(const p of[c.a,c.b].filter(Boolean))for(let k=0;k<2;k++)mass+=p.r.w[p.indices[k]]*p.weights[k]**2;if(!mass)return;const next=Math.max(0,c.lambda-C/mass),change=next-c.lambda;c.lambda=next;for(const[p,sign]of[[c.a,1],[c.b,-1]])if(p)for(let k=0;k<2;k++){const i=p.indices[k],amount=sign*change*p.r.w[i]*p.weights[k];for(let j=0;j<3;j++)p.r.x[i*3+j]+=c.n[j]*amount;}}
  substep(strength){
    const started=performance.now();let contactMs=0;
    for(const r of this.records.values()){r.old.set(r.x);r.lambda.fill(0);r.bendLambda.fill(0);for(let i=1;i<r.n;i++)if(r.w[i]){const o=i*3;r.v[o+1]-=9.81*strength*this.h;for(let k=0;k<3;k++)r.x[o+k]+=r.v[o+k]*this.h;}this.fix(r);}
    let contacts=[];this.stats.stalledContacts=0;
    for(let pass=0;pass<this.iterations;pass++){
      if(pass===0||pass===Math.floor(this.iterations/2)){const at=performance.now();contacts=this.buildContacts();contactMs+=performance.now()-at;}
      for(const r of this.records.values()){for(let i=0;i+1<r.n;i++)this.distance(r,i,i+1,r.lock.seg,0,r.lambda,i);const stiffness=r.lock.stiffness??.35,compliance=.002*(1-stiffness)**2+.000005;for(let i=0;i+2<r.n;i++){const rest=r.lock.rest,d=Math.hypot(rest[(i+2)*3]-rest[i*3],rest[(i+2)*3+1]-rest[i*3+1],rest[(i+2)*3+2]-rest[i*3+2]);this.distance(r,i,i+2,d,compliance,r.bendLambda,i);}this.fix(r);}
      for(const c of contacts)this.projectContact(c);
    }
    // Reconstruct momentum, then remove separating correction velocity at
    // penetration contacts (zero restitution). Initial overlap correction must
    // not become an artificial launch away from the head.
    for(const r of this.records.values()){
      const protectedPoints=new Map();for(let i=1;i<r.n;i++)if(!r.w[i]&&!r.lock.pins.has(i))protectedPoints.set(i,new Vector3().fromArray(r.old,i*3));
      const publicPose=r.lock.x;r.lock.x=r.x;
      try{constrainLockPose(r.lock,this.state,{reference:r.old,protectedPoints,fixFollicle:false});}finally{r.lock.x=publicPose;}
    }
    const decay=Math.exp(-3*this.h);
    for(const r of this.records.values())for(let i=0;i<r.n;i++)for(let k=0;k<3;k++)r.v[i*3+k]=r.w[i]?(r.x[i*3+k]-r.old[i*3+k])/this.h*decay:0;
    for(const c of contacts)for(const[p,sign]of[[c.a,1],[c.b,-1]])if(p)for(const i of p.indices){const o=i*3,normal=scale(c.n,sign),speed=dot(vertex(p.r.v,o),normal);if(speed>0)for(let k=0;k<3;k++)p.r.v[o+k]-=normal[k]*speed;}
    this.publish();let maxStretch=0;for(const r of this.records.values())for(let i=1;i<r.n;i++)maxStretch=Math.max(maxStretch,Math.abs(Math.hypot(r.x[i*3]-r.x[(i-1)*3],r.x[i*3+1]-r.x[(i-1)*3+1],r.x[i*3+2]-r.x[(i-1)*3+2])/r.lock.seg-1));this.stats.maxStretch=maxStretch;
    const auditAt=performance.now(),audit=hairContactAudit(this.state,this.surface);Object.assign(this.stats,audit);this.stats.maxPenetration=audit.maxPenetration;this.stats.timings={contactMs,auditMs:performance.now()-auditAt,totalMs:performance.now()-started};this.bodyAudit=false;
    this.stats.validPose=audit.penetrating===0&&this.stats.infeasibleContacts===0;
    this.stats.error=this.stats.validPose?null:'O contato entre mechas não convergiu.';
  }
  publish(){for(const r of this.records.values()){r.lock.x.set(r.x);r.last.set(r.lock.x);}}
}

