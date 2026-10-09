import { ShapeUtils, Vector2 } from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const vector = (v, n) => Array.from({length:n}, (_,i)=>clamp(finite(v?.[i]),-4,4));
const point = p => ({x:clamp(finite(p?.x),-4,4),y:clamp(finite(p?.y),-4,4), ...(Array.isArray(p?.in)?{in:vector(p.in,2)}:{}), ...(Array.isArray(p?.out)?{out:vector(p.out,2)}:{})});
const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v??'')?v.toLowerCase():fallback;
export const panelComponents = ['body','sleeve','collar','hood','pocket','cuff','leg','skirt','hand','foot'];
const componentNames={body:'Corpo',sleeve:'Manga',collar:'Gola',hood:'Capuz',pocket:'Bolso',cuff:'Punho',leg:'Perna',skirt:'Saia',hand:'Luva',foot:'Meia'};
const sideNames={front:'frente',back:'costas',l:'esquerda',r:'direita'};
export function normalizePattern(value) {
  if (!value || !Array.isArray(value.panels)) return null;
  const panels = value.panels.slice(0,48).map((p,i)=>({
    id: typeof p.id==='string'?p.id.slice(0,64):`panel-${i}`, name: String(p.name??`Peça ${i+1}`).slice(0,80),
    component: panelComponents.includes(p.component)?p.component:'body',
    contour: (p.contour??[]).slice(0,128).map(point), holes:(p.holes??[]).slice(0,16).map(h=>h.slice(0,128).map(point)).filter(h=>h.length>=3),
    placement:{region:['torso','arm','leg','head','skirt','hand','foot'].includes(p.placement?.region)?p.placement.region:'torso', side:['front','back','l','r'].includes(p.placement?.side)?p.placement.side:'front',offset:vector(p.placement?.offset,3),rotation:vector(p.placement?.rotation,3)},
    material:{thickness:clamp(finite(p.material?.thickness,0.004),0.001,0.02),elasticity:clamp(finite(p.material?.elasticity,0.5),0,1),stiffness:clamp(finite(p.material?.stiffness,0.5),0,1),color:color(p.material?.color,'#3c5a78'),color2:color(p.material?.color2,'#e9e4da'),pattern:['solid','stripes','pinstripe','checks','gradient'].includes(p.material?.pattern)?p.material.pattern:'solid',scale:clamp(finite(p.material?.scale,0.5),0,1)},
    pins:(p.pins??[]).filter(v=>Number.isInteger(v)&&v>=0&&v<(p.contour?.length??0)),
  })).filter(p=>p.contour.length>=3);
  const used=new Set();for(const panel of panels){const original=panel.id;let suffix=1;while(used.has(panel.id))panel.id=`${original.slice(0,56)}-${suffix++}`;used.add(panel.id);}
  const ids = new Set(panels.map(p=>p.id));
  const edgeReference=ref=>({panel:ref.panel,edge:Math.max(0,Math.trunc(finite(ref.edge))),...(Number.isInteger(ref.hole)&&ref.hole>=0?{hole:ref.hole}:{})});
  const seams=(value.seams??[]).slice(0,128).filter(s=>ids.has(s.a?.panel)&&ids.has(s.b?.panel)).map(s=>({a:edgeReference(s.a),b:edgeReference(s.b),reverse:!!s.reverse,kind:['seam','dart','opening'].includes(s.kind)?s.kind:'seam',compliance:clamp(finite(s.compliance,1e-8),0,0.001)}));
  const edits=(value.edits??[]).slice(0,20000).filter(e=>ids.has(e.panel)&&Array.isArray(e.center)&&Array.isArray(e.delta)).map(e=>({panel:e.panel,center:vector(e.center,2),radius:clamp(finite(e.radius,0.02),0.002,1),delta:vector(e.delta,3)}));
  const pinRegions=(value.pinRegions??[]).slice(0,256).filter(e=>ids.has(e.panel)&&Array.isArray(e.center)).map(e=>({panel:e.panel,center:vector(e.center,2),radius:clamp(finite(e.radius,0.03),0.002,1)}));
  return {version:1,id:typeof value.id==='string'?value.id.slice(0,80):'pattern',panels,seams,edits,pinRegions,resolution:clamp(finite(value.resolution,0.055),0.02,0.15)};
}

/** Opening a selected edge unsews its existing seam/dart; the source is kept for undo. */
export function setPatternConnection(pattern,connection) {
  const same=(a,b)=>a&&b&&a.panel===b.panel&&a.edge===b.edge&&(a.hole??null)===(b.hole??null);
  const touches=seam=>[seam.a,seam.b].some(ref=>same(ref,connection.a)||same(ref,connection.b));
  const seams=pattern.seams.filter(seam=>!touches(seam)||(connection.kind!=='opening'&&seam.kind!=='opening'));
  return normalizePattern({...pattern,seams:[...seams,connection]});
}

/** Length of contour edge `e` (its Bézier control polygon, an upper bound close to the curve's). */
export function contourEdgeLength(contour,e) {
  const a=contour[e],b=contour[(e+1)%contour.length],c=a.out??[a.x,a.y],d=b.in??[b.x,b.y];
  return Math.hypot(a.x-c[0],a.y-c[1])+Math.hypot(c[0]-d[0],c[1]-d[1])+Math.hypot(d[0]-b.x,d[1]-b.y);
}

/**
 * Cubic handles are absolute metres; every edge keeps its original identity. `steps[e]`, when
 * given, fixes the number of segments of edge e: two edges sewn together get the same count, so
 * their points pair one to one (GarmentCode's stitch flattening adds vertices to match them).
 */
export function sampleContour(contour, resolution=0.04, stepsOf=null) {
  const points=[],edges=[];
  for(let e=0;e<contour.length;e++) {
    const a=contour[e],b=contour[(e+1)%contour.length],c=a.out??[a.x,a.y],d=b.in??[b.x,b.y];
    const length=contourEdgeLength(contour,e);
    const steps=stepsOf?.[e]??Math.max(1,Math.min(80,Math.ceil(length/resolution))); const ids=[];
    for(let i=0;i<steps;i++) {const t=i/steps,u=1-t;ids.push(points.length);points.push([u*u*u*a.x+3*u*u*t*c[0]+3*u*t*t*d[0]+t*t*t*b.x,u*u*u*a.y+3*u*u*t*c[1]+3*u*t*t*d[1]+t*t*t*b.y]);}
    edges.push(ids);
  }
  edges.forEach((ids,e)=>ids.push(edges[(e+1)%edges.length][0]));
  return {points,edges};
}

/** Three's hole-aware triangulation; uniform shared-edge subdivision is conforming. */
/**
 * Delaunay triangulation of 2D points (Bowyer–Watson): each point is inserted into a super
 * triangle; the triangles whose circumcircle contains it are removed and the edges of the hole
 * they leave are joined to it; triangles touching the super triangle are dropped at the end.
 */
export function delaunay(points) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y] of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const size=Math.max(maxX-minX,maxY-minY,1e-6)*20,cx=(minX+maxX)/2,cy=(minY+maxY)/2,n=points.length;
  const all=[...points,[cx-size,cy-size],[cx+size,cy-size],[cx,cy+size]];
  const circle=(a,b,c)=>{
    const [ax,ay]=all[a],[bx,by]=all[b],[qx,qy]=all[c],d=2*(ax*(by-qy)+bx*(qy-ay)+qx*(ay-by));
    if(Math.abs(d)<1e-18)return [cx,cy,Infinity];
    const ux=((ax*ax+ay*ay)*(by-qy)+(bx*bx+by*by)*(qy-ay)+(qx*qx+qy*qy)*(ay-by))/d,uy=((ax*ax+ay*ay)*(qx-bx)+(bx*bx+by*by)*(ax-qx)+(qx*qx+qy*qy)*(bx-ax))/d;
    return [ux,uy,(ax-ux)**2+(ay-uy)**2];
  };
  let triangles=[[n,n+1,n+2,...circle(n,n+1,n+2)]];
  for(let p=0;p<n;p++){
    const [px,py]=all[p],kept=[],edges=new Map();
    for(const t of triangles){
      if((px-t[3])**2+(py-t[4])**2<t[5]*(1-1e-12)){for(const [a,b] of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){const key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,edges.has(key)?null:[a,b]);}}
      else kept.push(t);
    }
    for(const edge of edges.values())if(edge)kept.push([edge[0],edge[1],p,...circle(edge[0],edge[1],p)]);
    triangles=kept;
  }
  return triangles.filter(t=>t[0]<n&&t[1]<n&&t[2]<n).flatMap(t=>[t[0],t[1],t[2]]);
}

const insidePolygon=(polygon,x,y)=>{let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;};
const segmentDistance=(polygon,x,y)=>{let best=Infinity;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [ax,ay]=polygon[j],[bx,by]=polygon[i],dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(ax+t*dx-x,ay+t*dy-y));}return best;};

/**
 * `options.steps[e]` / `options.holeSteps[h][e]` fix edge segment counts (see sampleContour) and
 * `options.levels` the number of 1→4 refinements; panels sewn together must share both, so the
 * points of two stitched edges stay paired one to one after refinement. With `options.spacing`
 * the panel is meshed for simulation instead: its outline sampled at the spacing (or the given
 * counts), a triangular lattice of interior points at that spacing kept 0.6 spacings from the
 * outline, all joined by Delaunay triangulation and clipped to the panel (no refinement).
 */
export function triangulatePanel(panel,resolution=0.055,options={}) {
  if(options.spacing)return latticePanel(panel,options);
  const outer=sampleContour(panel.contour,resolution,options.steps),holes=(panel.holes??[]).map((h,i)=>sampleContour(h,resolution,options.holeSteps?.[i]));
  const points=[...outer.points,...holes.flatMap(h=>h.points)],toVector=p=>new Vector2(...p);
  let index=ShapeUtils.triangulateShape(outer.points.map(toVector),holes.map(h=>h.points.map(toVector))).flat();
  const edges=outer.edges.map(e=>[...e]),holeEdges=[];let offset=outer.points.length;const boundaries=[...edges];
  for(const hole of holes){const local=hole.edges.map(e=>e.map(v=>v+offset));holeEdges.push(local);boundaries.push(...local);offset+=hole.points.length;}
  // Split all triangles together to avoid hanging nodes. Bounds keep desktop editing responsive.
  const fixed=Number.isInteger(options.levels);
  let levels=0;
  for(;fixed?levels<options.levels:levels<3&&index.length/3<1200;levels++) {
    let longest=0;for(let i=0;i<index.length;i+=3)for(let k=0;k<3;k++){const a=points[index[i+k]],b=points[index[i+(k+1)%3]];longest=Math.max(longest,Math.hypot(a[0]-b[0],a[1]-b[1]));}
    if(!fixed&&longest<=resolution*2)break;
    const mids=new Map(),mid=(a,b)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;if(!mids.has(key)){mids.set(key,points.length);points.push([(points[a][0]+points[b][0])/2,(points[a][1]+points[b][1])/2]);}return mids.get(key);};
    const next=[];for(let i=0;i<index.length;i+=3){const [a,b,c]=index.slice(i,i+3),ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}index=next;
    for(const boundary of boundaries){const next=[];for(let j=0;j<boundary.length-1;j++)next.push(boundary[j],mid(boundary[j],boundary[j+1]));next.push(boundary.at(-1));boundary.splice(0,boundary.length,...next);}
  }
  return {points,index,edges,holeEdges,boundaries,levels};
}

function latticePanel(panel,{spacing:h,steps,holeSteps}) {
  const outer=sampleContour(panel.contour,h,steps),holes=(panel.holes??[]).map((hole,i)=>sampleContour(hole,h,holeSteps?.[i]));
  const points=[...outer.points,...holes.flatMap(hole=>hole.points)];
  const edges=outer.edges.map(e=>[...e]),holeEdges=[],boundaries=[...edges];
  let offset=outer.points.length;
  for(const hole of holes){const local=hole.edges.map(e=>e.map(v=>v+offset));holeEdges.push(local);boundaries.push(...local);offset+=hole.points.length;}
  const outline=outer.points,cut=holes.map(hole=>hole.points),inside=(x,y)=>insidePolygon(outline,x,y)&&!cut.some(c=>insidePolygon(c,x,y));
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y] of outline){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const row=h*Math.sqrt(3)/2;
  for(let j=0,y=minY+row/2;y<maxY;j++,y+=row)for(let x=minX+(j%2?h/2:0);x<maxX;x+=h){
    if(!inside(x,y)||segmentDistance(outline,x,y)<0.6*h||cut.some(c=>segmentDistance(c,x,y)<0.6*h))continue;
    points.push([x,y]);
  }
  const all=delaunay(points),index=[];
  for(let i=0;i<all.length;i+=3){
    const [a,b,c]=[all[i],all[i+1],all[i+2]],x=(points[a][0]+points[b][0]+points[c][0])/3,y=(points[a][1]+points[b][1]+points[c][1])/3;
    if(inside(x,y))index.push(a,b,c);
  }
  // Each outline edge keeps its closing point (the next edge's first), as sampleContour returns it.
  return {points,index,edges,holeEdges,boundaries,levels:0};
}
export function panelMeasurements(panel) {
  const sampled=sampleContour(panel.contour,0.005).points;
  const area=Math.abs(ShapeUtils.area(sampled.map(p=>new Vector2(...p))))-(panel.holes??[]).reduce((s,h)=>s+Math.abs(ShapeUtils.area(sampleContour(h,0.005).points.map(p=>new Vector2(...p)))),0);
  return {area,perimeter:sampled.reduce((s,p,i)=>s+Math.hypot(p[0]-sampled[(i+1)%sampled.length][0],p[1]-sampled[(i+1)%sampled.length][1]),0),width:Math.max(...sampled.map(p=>p[0]))-Math.min(...sampled.map(p=>p[0])),height:Math.max(...sampled.map(p=>p[1]))-Math.min(...sampled.map(p=>p[1]))};
}
export function mirrorPanel(panel,id=`${panel.id}-mirror`) {
  const copy=structuredClone(panel);copy.id=id;copy.name=`${panel.name??panel.id} espelhada`;
  const mirror=p=>({...p,x:-p.x,...(p.in?{in:[-p.in[0],p.in[1]]}:{}),...(p.out?{out:[-p.out[0],p.out[1]]}:{})});
  copy.contour=copy.contour.map(mirror);copy.holes=(copy.holes??[]).map(h=>h.map(mirror));
  if(copy.placement?.side==='l')copy.placement.side='r';else if(copy.placement?.side==='r')copy.placement.side='l';
  return copy;
}
export function createComponent(component='body',id=`${component}-${Date.now()}`,garment={}) {
  const dimensions={body:[0.52,0.58],sleeve:[0.3,0.5],collar:[0.38,0.055],hood:[0.3,0.32],pocket:[0.14,0.17],cuff:[0.24,0.07],leg:[0.45,0.85],skirt:[0.6,0.6],hand:[0.18,0.2],foot:[0.25,0.25]};
  const [w,h]=dimensions[component]??dimensions.body;
  const region={sleeve:'arm',cuff:'arm',leg:'leg',skirt:'skirt',hood:'head',hand:'hand',foot:'foot'}[component]??'torso';
  return normalizePattern({panels:[{id,name:componentNames[component]??component,component,contour:[{x:-w/2,y:0},{x:w/2,y:0},{x:w/2,y:h},{x:-w/2,y:h}],placement:{region,side:region==='arm'||region==='leg'||region==='hand'||region==='foot'?'l':'front',offset:[0,component==='pocket'?-0.24:0,component==='pocket'?0.012:0]},material:garment}]}).panels[0];
}

/** Component drafting follows GarmentCode's panel/edge/sewing representation, without a dependency. */
export function createPatternTemplate(type='tshirt',garment={}) {
  const panels=[],seams=[];
  const add=(component,id,side,length)=>{const p=createComponent(component,id,garment);p.placement.side=side;p.name+=` ${sideNames[side]??side}`;if(length){const ratio=length/p.contour[2].y;for(const v of p.contour)v.y*=ratio;}panels.push(p);return p;};
  const pair=(component,length)=>{const a=add(component,`${component}-front`,'front',length),b=add(component,`${component}-back`,'back',length);for(const edge of [1,3])seams.push({a:{panel:a.id,edge},b:{panel:b.id,edge},kind:'seam',reverse:false});return [a,b];};
  if(['tshirt','longsleeve','tank','hoodie','dress','paint'].includes(type)) {
    const bodies=pair('body',0.38+0.24*(garment.length??0.85));
    // Neck and shoulder contour; six stable edges are available for sewing.
    for(const p of bodies){const h=p.contour[2].y;p.contour=[{x:-0.26,y:0.04},{x:-0.075,y:0},{x:0.075,y:0,out:[0.11,0.04]},{x:0.26,y:0.04},{x:0.20,y:0.18},{x:0.24,y:h},{x:-0.24,y:h},{x:-0.20,y:0.18}];if(p.placement.side==='front'){p.contour[1].out=[-0.045,0.1];p.contour[2].in=[0.045,0.1];}}
    seams.splice(0,seams.length,...[4,6].map(edge=>({a:{panel:bodies[0].id,edge},b:{panel:bodies[1].id,edge},kind:'seam'})));
    for(const edge of [0,2])seams.push({a:{panel:bodies[0].id,edge},b:{panel:bodies[1].id,edge},kind:'seam'});
    if(['tshirt','longsleeve','hoodie'].includes(type)) for(const side of ['l','r']) {
      const p=add('sleeve',`sleeve-${side}`,side,0.08+0.5*(garment.sleeve??(type==='tshirt'?0.3:1))-(type==='hoodie'?0.07:0));
      // A sleeve narrows from the armhole (30 cm round) towards the wrist (about 23 cm for a long
      // sleeve), as a drafted sleeve block does; a rectangle hung as a bell at the hand.
      const length=p.contour[2].y,narrow=0.15-0.035*Math.max(0,Math.min(1,(length-0.15)/0.4));
      p.contour[2].x=narrow;p.contour[3].x=-narrow;
      p.contour.splice(1,0,{x:0,y:0});
      seams.push({a:{panel:p.id,edge:2},b:{panel:p.id,edge:4},reverse:true,kind:'seam'});
      for(const [body,edge] of [['body-front',0],['body-back',1]])seams.push({a:{panel:p.id,edge},b:{panel:body,edge:side==='l'?3:7},reverse:body==='body-front'?side==='l':side==='r',kind:'seam'});
    }
    if(type==='hoodie'){
      const h=add('hood','hood','back');h.placement.offset=[0,0.025,0];
      for(const side of ['l','r']){const cuff=add('cuff',`cuff-${side}`,side);seams.push({a:{panel:cuff.id,edge:1},b:{panel:cuff.id,edge:3},reverse:true,kind:'seam'},{a:{panel:cuff.id,edge:0},b:{panel:`sleeve-${side}`,edge:3},reverse:true,kind:'seam'});}
      add('pocket','pocket','front');
    }
    if(type==='dress'){pair('skirt',0.15+0.7*(garment.length??0.7));for(const side of ['front','back'])seams.push({a:{panel:`body-${side}`,edge:5},b:{panel:`skirt-${side}`,edge:0},reverse:true,kind:'seam'});}
  } else if(['pants','shorts'].includes(type))for(const side of ['l','r']){const p=add('leg',`leg-${side}`,side,0.12+0.78*(garment.leg??(type==='shorts'?0.32:1)));seams.push({a:{panel:p.id,edge:1},b:{panel:p.id,edge:3},reverse:true,kind:'seam'});}
  else if(type==='skirt')pair('skirt',0.15+0.7*(garment.length??0.45));
  else if(type==='socks'||type==='gloves')for(const side of ['l','r']){const p=add(type==='socks'?'foot':'hand',`${type}-${side}`,side);seams.push({a:{panel:p.id,edge:1},b:{panel:p.id,edge:3},reverse:true,kind:'seam'});}
  return normalizePattern({id:`pattern-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,panels,seams});
}
