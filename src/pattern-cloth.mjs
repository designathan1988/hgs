import { BufferGeometry, DoubleSide, Euler, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Triangle, Vector3 } from 'three';
import { triangulatePanel } from './patterns.mjs';
import { SurfaceCollider } from './collision.mjs';

/** Place metre-sized panels around anatomical sections, then transfer actual body skinning. */
export function buildPatternPanels(context,garment,layout,layer,skin=null) {
  const pattern=garment.patternData,P=context.positions,{data}=context,k=layout.k;
  const out={pos:[],normal:[],uv:[],joints:[],weights:[],keys:[],origins:[],index:[],pieceOf:[],materials:[],sources:[],rest:[],seams:[],sewnBoundaryEdges:new Set(),pattern:true};
  const pins=[],authoredPins=[],compliance=[],elasticity=[],thickness=[],ranges=new Map();
  const section=(candidates,y,side,region)=>{
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,nearest=Infinity;
    for(const v of candidates)nearest=Math.min(nearest,Math.abs(P[v*3+1]-y));
    for(const v of candidates)if(Math.abs(P[v*3+1]-y)<=Math.max(0.018*k,nearest+0.009*k)){minX=Math.min(minX,P[v*3]);maxX=Math.max(maxX,P[v*3]);minZ=Math.min(minZ,P[v*3+2]);maxZ=Math.max(maxZ,P[v*3+2]);}
    if(!Number.isFinite(minX))return {x:0,z:layout.frontZ,rx:0.16*k,rz:0.1*k};
    return {x:(minX+maxX)/2,z:(minZ+maxZ)/2,rx:Math.max((maxX-minX)/2,0.01*k),rz:Math.max((maxZ-minZ)/2,0.01*k)};
  };
  pattern.panels.forEach((piece,pieceIndex)=>{
    const mesh=triangulatePanel(piece,pattern.resolution),offset=out.pos.length/3,place=piece.placement,region=place.region,side=place.side;
    const candidates=[];
    for(let v=0;v<P.length/3;v++) {
      const signed=side==='r'?P[v*3]<=0:side==='l'?P[v*3]>=0:true;
      const include=region==='arm'||region==='hand'?layout.armW[v]>0.55&&signed:region==='leg'||region==='foot'?layout.legW[v]>0.55&&signed:region==='head'?layout.headW[v]>0.45:layout.armW[v]<0.3&&layout.headW[v]<0.3;
      if(include)candidates.push(v);
    }
    const minY=Math.min(...mesh.points.map(p=>p[1]));
    const rotation=new Euler(...place.rotation),translation=new Vector3(...place.offset).multiplyScalar(k);
    const limb=region==='arm'||region==='hand'?layout.arms[side==='r'?'r':'l']:layout.legs[side==='r'?'r':'l'];
    // 0.58 m is the full sleeve draft (0.08 + 0.5). Retarget its length to
    // the actual shoulder/wrist chain, including in the flat rest metric.
    const lengthScale=region==='arm'?limb.length/0.58:k;
    const pieceHeight=Math.max(...mesh.points.map(p=>p[1]))-minY;
    for(let i=0;i<mesh.points.length;i++) {
      const [u,v]=mesh.points[i];let position,normal;
      if(['arm','leg','hand','foot'].includes(region)) {
        const along=(region==='hand'||region==='foot'?limb.length-0.025*k:region==='arm'&&piece.component==='cuff'?limb.length-pieceHeight*lengthScale:0)+v*lengthScale;
        const direction=along<limb.l1?limb.u1:limb.u2;
        const center=along<limb.l1?limb.A.clone().addScaledVector(direction,along):limb.B.clone().addScaledVector(direction,along-limb.l1);
        const forward=new Vector3(0,0,1).addScaledVector(direction,-direction.z).normalize(),lateral=forward.clone().cross(direction).normalize();
        if(side==='r')lateral.negate();
        const circumference=region==='leg'?0.45:region==='arm'?piece.component==='cuff'?0.24:0.3:region==='hand'?0.18:0.25;
        let radius=circumference*k/(Math.PI*2);
        for(const id of candidates) {
          const d=new Vector3(P[id*3],P[id*3+1],P[id*3+2]).sub(center);
          if(Math.abs(d.dot(direction))<0.018*k)radius=Math.max(radius,Math.hypot(d.dot(lateral),d.dot(forward)));
        }
        const angle=u/circumference*Math.PI*2+(region==='arm'?Math.PI/2:0);
        normal=lateral.multiplyScalar(Math.sin(angle)).addScaledVector(forward,Math.cos(angle));
        position=center.addScaledVector(normal,radius+(0.004+garment.fit*0.012)*k);
      } else {
        const top=region==='head'?context.body.geometry.boundingBox.max.y:region==='skirt'?layout.hipY+(layout.waistY-layout.hipY)*0.8:piece.component==='collar'?layout.neckY:layout.neckY-0.025*k;
        const y=top-v*k,s=section(candidates,y+translation.y,side,region);
        const halfWidth=region==='head'?0.3:region==='skirt'?0.6:0.52;
        const angle=side==='back'?Math.PI-u/halfWidth*Math.PI:u/halfWidth*Math.PI;
        const rx=s.rx+(0.004+garment.fit*0.015)*k,rz=s.rz+(0.004+garment.fit*0.015)*k;
        normal=new Vector3(Math.sin(angle),0,Math.cos(angle)).normalize();
        position=new Vector3(s.x+Math.sin(angle)*rx,y,s.z+Math.cos(angle)*rz);
      }
      // Rotation/translation are around the panel's anatomical attachment.
      if(place.rotation.some(x=>x!==0)) {const anchor=region==='arm'||region==='leg'||region==='hand'||region==='foot'?limb.A:new Vector3(0,layout.neckY,layout.frontZ);position.sub(anchor).applyEuler(rotation).add(anchor);normal.applyEuler(rotation);}
      position.add(translation);
      let nearest=-1,best=Infinity;
      for(const id of candidates){const d=(position.x-P[id*3])**2+(position.y-P[id*3+1])**2+(position.z-P[id*3+2])**2;if(d<best){best=d;nearest=id;}}
      if(nearest<0)nearest=0;
      out.pos.push(...position.toArray());out.normal.push(...normal.toArray());out.uv.push(u,v);
      for(let j=0;j<4;j++){out.joints.push(data.joints[nearest*4+j]);out.weights.push(data.weights[nearest*4+j]/65535);}
      out.origins.push(nearest);out.keys.push(-1);out.pieceOf.push(pieceIndex);out.materials.push(piece.material);
      out.sources.push({garment:layer,pattern:pattern.id,panel:piece.id,uv:[u,v]});
      out.rest.push(u*k,v*lengthScale,0);
      const explicit=piece.pins.some(point=>mesh.edges[point]?.[0]===i);
      const regionPinned=pattern.pinRegions.some(pin=>pin.panel===piece.id&&Math.hypot(pin.center[0]-u,pin.center[1]-v)<=pin.radius);
      authoredPins.push(explicit||regionPinned?1:0);
      // Hold attachment points to keep panels at their actual shoulder/waist/head position.
      const attachedToOther=pattern.seams.some(s=>s.kind!=='opening'&&((s.a.panel===piece.id&&pattern.panels.find(p=>p.id===s.b.panel)?.component!==piece.component)||(s.b.panel===piece.id&&pattern.panels.find(p=>p.id===s.a.panel)?.component!==piece.component)));
      const anchor=piece.component==='body'||!attachedToOther;
      pins.push(explicit||regionPinned||(anchor&&Math.abs(v-minY)<0.002)?1:0);
      compliance.push(1e-8+(1-piece.material.stiffness)*2e-6);
      elasticity.push(0.97+piece.material.elasticity*0.06);
      thickness.push(piece.material.thickness*k);
    }
    // Draft coordinates have Y downward. Orient each triangle against the known
    // outward anatomical normal so layer collision uses the exterior of the cloth.
    for(let i=0;i<mesh.index.length;i+=3) {
      let [a,b,c]=mesh.index.slice(i,i+3).map(v=>v+offset);
      const A=new Vector3(...out.pos.slice(a*3,a*3+3)),B=new Vector3(...out.pos.slice(b*3,b*3+3)),C=new Vector3(...out.pos.slice(c*3,c*3+3));
      const normal=new Vector3(...out.normal.slice(a*3,a*3+3));
      if(B.sub(A).cross(C.sub(A)).dot(normal)<0)[b,c]=[c,b];
      out.index.push(a,b,c);
    }
    ranges.set(piece.id,{mesh,offset});
  });
  for(const sewing of pattern.seams) {
    if(sewing.kind==='opening')continue;
    const a=ranges.get(sewing.a.panel),b=ranges.get(sewing.b.panel);
    const ae=sewing.a.hole===undefined?a?.mesh.edges[sewing.a.edge]:a?.mesh.holeEdges[sewing.a.hole]?.[sewing.a.edge];
    const be=sewing.b.hole===undefined?b?.mesh.edges[sewing.b.edge]:b?.mesh.holeEdges[sewing.b.hole]?.[sewing.b.edge];
    if(!ae||!be)continue;
    for(const [edge,offset] of [[ae,a.offset],[be,b.offset]])for(let i=0;i<edge.length-1;i++){const x=edge[i]+offset,y=edge[i+1]+offset;out.sewnBoundaryEdges.add(x<y?`${x}:${y}`:`${y}:${x}`);}
    const count=Math.max(ae.length,be.length);
    for(let i=0;i<count;i++){const t=i/(count-1),ai=ae[Math.round(t*(ae.length-1))]+a.offset,bi=be[Math.round((sewing.reverse?1-t:t)*(be.length-1))]+b.offset;if(ai!==bi)out.seams.push({a:ai,b:bi,rest:0,compliance:sewing.compliance});}
  }
  out.pinned=Uint8Array.from(pins);out.particleCompliance=Float32Array.from(compliance);
  out.authoredPins=Uint8Array.from(authoredPins);
  out.particleSlack=Float32Array.from(elasticity);
  out.particleThickness=Float32Array.from(thickness);
  out.thickness=Math.max(...pattern.panels.map(p=>p.material.thickness),0.004)*k;
  const placementHit={};
  if(skin)for(let v=0;v<out.pos.length/3;v++) {
    if(!skin.closest(...out.pos.slice(v*3,v*3+3),0.2*k,placementHit))continue;
    if(placementHit.distance<out.particleThickness[v])for(const [c,key] of [[0,'x'],[1,'y'],[2,'z']])out.pos[v*3+c]=placementHit[key]+placementHit[`n${key}`]*out.particleThickness[v];
    out.normal[v*3]=placementHit.nx;out.normal[v*3+1]=placementHit.ny;out.normal[v*3+2]=placementHit.nz;
  }
  // Sewn vertices share one anatomical attachment, including pinned neckline
  // endpoints. Independent front/back pins otherwise make a seam impossible.
  const parent=Array.from({length:out.pos.length/3},(_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const seam of out.seams){const a=find(seam.a),b=find(seam.b);if(a!==b)parent[b]=a;}
  const groups=new Map();for(let i=0;i<parent.length;i++){const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(i);}
  out.seamGroups=[...groups.values()].filter(g=>g.length>1);
  const hit={};
  for(const group of out.seamGroups){
    const xyz=[0,1,2].map(c=>group.reduce((sum,v)=>sum+out.pos[v*3+c],0)/group.length),n=[0,1,2].map(c=>group.reduce((sum,v)=>sum+out.normal[v*3+c],0)/group.length);
    const thickness=Math.max(...group.map(v=>out.particleThickness[v]));
    if(skin?.closest(...xyz,0.2*k,hit)){if(hit.distance<thickness){xyz[0]=hit.x+hit.nx*thickness;xyz[1]=hit.y+hit.ny*thickness;xyz[2]=hit.z+hit.nz*thickness;}n.splice(0,3,hit.nx,hit.ny,hit.nz);}
    const magnitude=Math.hypot(...n)||1;
    for(const v of group)for(let c=0;c<3;c++){out.pos[v*3+c]=xyz[c];out.normal[v*3+c]=n[c]/magnitude;}
  }
  // Fit automatically created anchors as boundary chords, not just endpoints.
  // Author-set pins keep their attachment; generated pins may move outward to
  // make their fixed edge feasible on a curved anatomical surface.
  const owners=new Map();for(const group of out.seamGroups)for(const v of group)owners.set(v,group);
  const automatic=v=>out.pinned[v]&&!(owners.get(v)??[v]).some(id=>out.authoredPins[id]);
  if(skin)for(let iteration=0;iteration<8;iteration++){
    let adjusted=false;
    for(let f=0;f<out.index.length;f+=3)for(let e=0;e<3;e++){
      const a=out.index[f+e],b=out.index[f+(e+1)%3];if(!out.pinned[a]||!out.pinned[b])continue;
      const wa=automatic(a)?1:0,wb=automatic(b)?1:0;if(!wa&&!wb)continue;
      const midpoint=[0,1,2].map(c=>(out.pos[a*3+c]+out.pos[b*3+c])/2),thickness=(out.particleThickness[a]+out.particleThickness[b])/2;
      if(!skin.closest(...midpoint,0.2*k,hit)||hit.distance>=thickness)continue;
      const delta=(thickness-hit.distance)*2/(wa+wb);
      for(const [v,w] of [[a,wa],[b,wb]])if(w)for(const id of owners.get(v)??[v]){out.pos[id*3]+=hit.nx*delta;out.pos[id*3+1]+=hit.ny*delta;out.pos[id*3+2]+=hit.nz*delta;}
      adjusted=true;
    }
    if(!adjusted)break;
  }
  return out;
}

/** Barycentric face contacts keep coarse triangles outside the collision surface.
 * A vertex-only check can miss a breast or shoulder passing through a face.
 */
export function projectPanelContacts(points,panel,collider,k) {
  const samples=[[1,0,0],[0,1,0],[0,0,1],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5],[1/3,1/3,1/3]],hit={};
  const membership=new Map();
  for(const group of panel.seamGroups){
    const xyz=[0,1,2].map(c=>group.reduce((sum,v)=>sum+points[v*3+c],0)/group.length),thickness=Math.max(...group.map(v=>panel.particleThickness[v]));
    if(collider.deepest(...xyz,0.08*k,thickness,0.08*k,hit)&&hit.distance<thickness){xyz[0]+=hit.nx*(thickness-hit.distance);xyz[1]+=hit.ny*(thickness-hit.distance);xyz[2]+=hit.nz*(thickness-hit.distance);}
    const mass=group.some(v=>panel.pinned?.[v])?0:1/group.length;
    const entry={vertices:group,mass};for(const v of group){membership.set(v,entry);for(let c=0;c<3;c++)points[v*3+c]=xyz[c];}
  }
  const member=v=>membership.get(v)??{vertices:[v],mass:panel.pinned?.[v]?0:1};
  let accumulated=null,contactCounts=null;
  const pushContact=(ids,bary,n,push,thickness)=>{
    const contributions=new Map();for(let i=0;i<3;i++){const group=member(ids[i]);contributions.set(group,(contributions.get(group)??0)+bary[i]);}
    let denominator=0,strongest=0;for(const [group,weight] of contributions){denominator+=group.mass*weight*weight;strongest=Math.max(strongest,group.mass*weight);}if(!denominator)return;
    const correction=Math.min(push/denominator,2*thickness/strongest);
    for(const [group,baryWeight] of contributions)for(const v of group.vertices){const weight=group.mass*baryWeight;if(!weight)continue;for(let c=0;c<3;c++){const delta=n[c]*correction*weight;if(accumulated)accumulated[v*3+c]+=delta;else points[v*3+c]+=delta;}if(contactCounts)contactCounts[v]++;}
  };
  for(let iteration=0;iteration<12;iteration++) {
    let deepest=0;
    for(let f=0;f<panel.index.length;f+=3) {
      const ids=panel.index.slice(f,f+3),thickness=ids.reduce((s,v)=>s+panel.particleThickness[v],0)/3;
      for(const bary of samples) {
        const xyz=[0,1,2].map(c=>ids.reduce((s,v,i)=>s+points[v*3+c]*bary[i],0));
        if(!collider.deepest(...xyz,0.08*k,thickness,0.08*k,hit)||hit.distance>=thickness)continue;
        const push=thickness-hit.distance;deepest=Math.max(deepest,push);
        pushContact(ids,bary,[hit.nx,hit.ny,hit.nz],push,thickness);
      }
    }
    // Reciprocal contacts detect dense skin vertices protruding through the
    // unsampled interior of a coarse cloth face, such as an upper arm cap.
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setIndex(panel.index);geometry.computeVertexNormals();
    const surface=new SurfaceCollider(0.012*k);surface.layers.push(collider.layers[0]);surface.add(points,geometry.attributes.normal.array,panel.index,{orient:true});surface.layers.shift();
    const body=collider.layers[0];
    // The surface is a coordinate snapshot. Jacobi averaging applies its
    // contacts together, so dense skin samples cannot repeat stale pushes.
    accumulated=new Float32Array(points.length);contactCounts=new Uint32Array(points.length/3);
    for(let v=0;v<body.positions.length/3;v++){
      const xyz=body.positions.slice(v*3,v*3+3),normal=body.normals.slice(v*3,v*3+3);
      if(!surface.closest(...xyz,0.08*k,hit,normal)||Math.min(hit.u,hit.v,hit.w)<1e-6)continue;
      const ids=[hit.a,hit.b,hit.c],bary=[hit.u,hit.v,hit.w],thickness=ids.reduce((s,id,i)=>s+panel.particleThickness[id]*bary[i],0),push=hit.distance+thickness;
      if(push<=0)continue;
      deepest=Math.max(deepest,push);pushContact(ids,bary,[hit.nx,hit.ny,hit.nz],push,thickness);
    }
    for(let v=0;v<contactCounts.length;v++)if(contactCounts[v])for(let c=0;c<3;c++)points[v*3+c]+=accumulated[v*3+c]/contactCounts[v];
    accumulated=null;contactCounts=null;
    geometry.dispose();
    if(deepest<1e-5*k)break;
  }
}

/** Cull only skin enclosed by real cloth faces. Open edges and holes remain visible. */
export function coveredPatternFaces(context,panel,points,normals,skin,layout) {
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setIndex(panel.index);geometry.computeBoundingBox();
  const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material),ray=new Raycaster(),triangle=new Triangle(),bary=new Vector3(),origin=new Vector3(),direction=new Vector3();
  const heights=new Map();for(let v=0;v<points.length/3;v++){const piece=panel.pieceOf?.[v]??0,y=points[v*3+1],range=heights.get(piece)??[Infinity,-Infinity];range[0]=Math.min(range[0],y);range[1]=Math.max(range[1],y);heights.set(piece,range);}
  const key=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`,uses=new Map();
  for(let f=0;f<panel.index.length;f+=3)for(let e=0;e<3;e++){const edge=key(panel.index[f+e],panel.index[f+(e+1)%3]);uses.set(edge,(uses.get(edge)??0)+1);}
  const boundary=(a,b)=>uses.get(key(a,b))===1&&!panel.sewnBoundaryEdges.has(key(a,b));
  const cache=new Map(),P=context.positions;
  const enclosed=(xyz,normal)=>{
    if(xyz[1]<geometry.boundingBox.min.y||xyz[1]>geometry.boundingBox.max.y)return false;
    origin.fromArray(xyz);direction.fromArray(normal).normalize();if(!direction.lengthSq())return false;
    ray.set(origin,direction);ray.near=0.001*layout.k;
    for(const hit of ray.intersectObject(mesh,false)){
      const range=heights.get(panel.pieceOf?.[hit.face.a]??0);if(xyz[1]<range[0]||xyz[1]>range[1])continue;
      if(hit.face.normal.dot(direction)<=0)return false;
      const {a,b,c}=hit.face;
      triangle.a.fromArray(points,a*3);triangle.b.fromArray(points,b*3);triangle.c.fromArray(points,c*3);triangle.getBarycoord(hit.point,bary);
      if(bary.x<1e-6&&boundary(b,c)||bary.y<1e-6&&boundary(a,c)||bary.z<1e-6&&boundary(a,b))continue;
      return true;
    }
    return false;
  };
  const vertex=v=>{if(!cache.has(v))cache.set(v,enclosed(P.slice(v*3,v*3+3),layout.normals.slice(v*3,v*3+3)));return cache.get(v);};
  const covered=new Set();
  layout.faces.forEach((face,f)=>{const ids=[0,1,2,3].map(i=>context.data.faces[face*4+i]);if(!ids.every(vertex))return;const xyz=[0,1,2].map(c=>ids.reduce((s,v)=>s+P[v*3+c],0)/4),normal=[0,1,2].map(c=>ids.reduce((s,v)=>s+layout.normals[v*3+c],0)/4);if(enclosed(xyz,normal))covered.add(f);});
  geometry.dispose();material.dispose();return covered;
}
