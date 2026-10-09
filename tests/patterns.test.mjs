import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatternTemplate, triangulatePanel, normalizePattern, mirrorPanel, panelMeasurements, patternTypes } from '../src/patterns.mjs';
import { garmentTypes, costumeTypes, footwearTypes, normalizeGarment, newGarment, bodyCollider,bodyLayout } from '../src/tailor.mjs';
import { buildPatternPanels,coveredPatternFaces,draftPanels } from '../src/pattern-cloth.mjs';
import { drapeCloth } from '../src/cloth.mjs';
import { SurfaceCollider } from '../src/collision.mjs';
import { createHuman } from '../src/human-three.mjs';
import { projectClothSurface } from '../src/cloth-contact.mjs';
import { BufferGeometry,DoubleSide,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial,PerspectiveCamera,Scene,Vector2 } from 'three';
import { ClothEditor } from '../src/cloth-editor.mjs';
import { defaultCharacter,normalizeCharacter } from '../src/state.mjs';
import { studioSpec } from '../src/renderer-three.mjs';
import * as patterns from '../src/patterns.mjs';

test('editable component templates cover existing garment types and survive normalization', () => {
  // Every garment type but the carnival pieces (cut on the body, or plumes and fringe) has a 2D pattern.
  assert.deepEqual(garmentTypes.filter(type => !costumeTypes.includes(type) && !footwearTypes.includes(type)), patternTypes);
  for (const type of patternTypes) {
    const patternData = createPatternTemplate(type);
    assert.ok(patternData.panels.length > 0, type);
    for (const panel of patternData.panels) assert.ok(triangulatePanel(panel, 0.06).index.length > 0);
    const garment = normalizeGarment({ type, patternData });
    assert.deepEqual(garment.patternData, normalizePattern(patternData));
    assert.deepEqual(normalizeGarment(JSON.parse(JSON.stringify(garment))), garment);
  }
});

test('imported duplicate panel IDs are disambiguated and spatial edits survive save/reopen', () => {
  const pattern=createPatternTemplate('tank');
  pattern.panels.push(structuredClone(pattern.panels[0]));
  pattern.edits=[{panel:pattern.panels[0].id,center:[0.1,0.2],radius:0.04,delta:[0.01,0,0]}];
  pattern.pinRegions=[{panel:pattern.panels[0].id,center:[0.1,0.2],radius:0.03}];
  const normalized=normalizePattern(pattern);
  assert.equal(new Set(normalized.panels.map(p=>p.id)).size,normalized.panels.length);
  assert.deepEqual(normalizePattern(JSON.parse(JSON.stringify(normalized))),normalized);
  assert.equal(normalized.edits.length,1);
  assert.equal(normalized.pinRegions.length,1);
});

test('surface authoring preserves a saved pattern while using original body-cut geometry', async () => {
  const patternData=createPatternTemplate('tshirt');
  const garment=normalizeGarment({type:'tshirt',patternData,authoringMode:'surface'});
  assert.equal(garment.authoringMode,'surface');
  assert.deepEqual(garment.patternData,patternData);
  const human=await createHuman({ageYears:30,heightMeters:1.7,clothing:{style:'tailor',garments:[garment]},hair:{style:'none'}});
  const sources=human.group.getObjectByName('Outfit').geometry.userData.patternSources;
  assert.ok(sources.every(source=>source===null),'surface cut uses body vertex origins');
  human.dispose();
  assert.equal(normalizeGarment({type:'tshirt',patternData}).authoringMode,'pattern');
});

test('attaching a new pattern to a legacy garment infers pattern authoring', () => {
  const garment=newGarment('tshirt');
  assert.equal(Object.hasOwn(garment,'authoringMode'),false,'an unchosen mode stays unspecified');
  garment.patternData=createPatternTemplate('tshirt');
  assert.equal(normalizeGarment(garment).authoringMode,'pattern');
  assert.equal(normalizeGarment({...garment,authoringMode:'surface'}).authoringMode,'surface');
});

test('opening an existing stitched edge removes its seam and dart from solver input', async () => {
  const original=createPatternTemplate('tank'),selected={a:{panel:'body-front',edge:4},b:{panel:'body-back',edge:4},kind:'opening'};
  original.seams.push({a:selected.a,b:{panel:'body-back',edge:3},kind:'dart'});
  const before=JSON.stringify(original),opened=patterns.setPatternConnection(original,selected);
  assert.equal(JSON.stringify(original),before,'the source remains intact for undo');
  const same=(a,b)=>a.panel===b.panel&&a.edge===b.edge&&(a.hole??null)===(b.hole??null);
  assert.equal(opened.seams.some(s=>s.kind!=='opening'&&[s.a,s.b].some(ref=>same(ref,selected.a)||same(ref,selected.b))),false);
  assert.ok(opened.seams.some(s=>s.kind==='opening'&&same(s.a,selected.a)&&same(s.b,selected.b)));
  const human=await createHuman({clothing:{style:'none'},hair:{style:'none'},shoes:'none'});human.context.body=human.body;
  const garment=normalizeGarment({type:'tank',patternData:opened}),panel=buildPatternPanels(human.context,garment,bodyLayout(human.context),0,bodyCollider(human.context));
  const draft=triangulatePanel(opened.panels.find(p=>p.id==='body-front'),opened.resolution),edge=new Set(draft.edges[4].map(v=>draft.points[v].join(',')));
  assert.equal(panel.seams.some(s=>[panel.sources[s.a],panel.sources[s.b]].some(source=>source.panel==='body-front'&&edge.has(source.uv.join(',')))),false,'the open edge is absent from actual XPBD seam constraints');
  const restored=patterns.setPatternConnection(opened,{...selected,kind:'seam'});
  assert.equal(restored.seams.some(s=>s.kind==='opening'&&[s.a,s.b].some(ref=>same(ref,selected.a)||same(ref,selected.b))),false,'sewing again clears the opening marker');
  human.dispose();
});

test('triangulation retains holes, curved edges and conforming shared refinement', () => {
  const panel = { id: 'cut', contour: [{x:0,y:0,out:[0.3,-0.2]},{x:1,y:0,in:[0.7,-0.2]},{x:1,y:1},{x:0,y:1}], holes: [[{x:0.3,y:0.3},{x:0.3,y:0.7},{x:0.7,y:0.7},{x:0.7,y:0.3}]] };
  const mesh = triangulatePanel(panel, 0.1);
  assert.ok(mesh.points.length > 60);
  let area = 0;
  for (let i = 0; i < mesh.index.length; i += 3) {
    const [a,b,c] = mesh.index.slice(i,i+3).map(v=>mesh.points[v]);
    const x=(a[0]+b[0]+c[0])/3, y=(a[1]+b[1]+c[1])/3;
    assert.ok(!(x>0.3&&x<0.7&&y>0.3&&y<0.7), 'hole has no faces');
    area += Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  }
  assert.ok(area > 0.84 && area < 1.05, area);
  assert.ok(mesh.edges[0].length > 2, 'Bezier boundary is sampled');
  assert.ok(panelMeasurements(panel).perimeter > 4);
  const reflected = mirrorPanel(panel);
  assert.equal(reflected.contour[1].x, -1);
  assert.equal(reflected.contour[0].out[0], -0.3);
  assert.equal(mesh.holeEdges.length,1);
  assert.equal(mesh.holeEdges[0].length,4);
  assert.ok(mesh.holeEdges[0][0].every(v=>v>=mesh.edges[0][0]&&v<mesh.points.length));
});

test('XPBD joins separated sewn vertices and separates nonadjacent cloth particles', () => {
  const points = new Float32Array([0,0,0, 1,0,0, 0,0.001,0, 1,0.001,0]);
  drapeCloth(points, [], new SurfaceCollider(0.02), { frames: 1, substeps: 1, gravity: 0, seams: [{a:0,b:1,rest:0,compliance:0}], selfCollision:true, thickness:0.01 });
  assert.ok(Math.abs(points[0]-points[3]) < 1e-5, 'sewn pair joins');
  assert.ok(Math.hypot(points[6]-points[9],points[7]-points[10],points[8]-points[11]) > 0.01, 'free nonadjacent pair separated');
});

test('self collision separates coincident unconnected cloth while preserving pins', () => {
  const points=new Float32Array([0,0,0,0,0,0]);
  drapeCloth(points,[],new SurfaceCollider(0.02),{frames:1,substeps:1,gravity:0,pinned:[1,0],selfCollision:true,thickness:0.01});
  assert.deepEqual(Array.from(points.slice(0,3)),[0,0,0]);
  assert.ok(Math.hypot(...points.slice(3))>=0.0199,'a coincident free particle separates from a pinned one');
});

test('self collision keeps a free particle off the interior of a pinned cloth triangle', () => {
  const points=new Float32Array([-0.1,0,-0.1,0.1,0,-0.1,0,0,0.1,0,0.001,0]);
  drapeCloth(points,[0,2,1],new SurfaceCollider(0.02),{frames:1,substeps:1,gravity:0,pinned:[1,1,1,0],selfCollision:true,thickness:0.01});
  assert.ok(Math.abs(points[10])>=0.0199,'a vertex cannot pass between widely spaced particles');
});

test('pinned contact near a fixed triangle corner cannot launch the free corners', () => {
  const points=new Float32Array([0,0,0,0.1,0,0,0,0,0.1,0.00005,0.001,0.00005]);
  projectClothSurface(points,[0,1,2],new Float32Array([0,1,1,0]),0.02,new Set());
  assert.ok(Math.abs(points[4])<0.03&&Math.abs(points[7])<0.03,'ill-conditioned barycentric contact stays bounded');
});

test('custom sewing templates connect sleeves to their bodice and dress to its skirt', () => {
  const shirt=createPatternTemplate('tshirt');
  for(const side of ['l','r'])assert.ok(shirt.seams.some(s=>s.a.panel===`sleeve-${side}`&&s.b.panel==='body-front'));
  const dress=createPatternTemplate('dress');
  assert.ok(dress.seams.some(s=>s.a.panel==='body-front'&&s.b.panel==='skirt-front'));
});

test('requested shorts length scales both sides of each drafted leg evenly', () => {
  const shorts=createPatternTemplate('shorts',{leg:0.32});
  const requested=0.12+0.78*0.32;
  for(const leg of shorts.panels){assert.ok(Math.abs(leg.contour[2].y-requested)<1e-9);assert.ok(Math.abs(leg.contour[3].y-requested)<1e-9);}
});

test('anatomical pattern placement begins outside the actual body surface', async () => {
  const human=await createHuman({ageYears:30,gender:0,clothing:{style:'none'},hair:{style:'none'},shoes:'none'});human.context.body=human.body;
  const garment=newGarment('tshirt');garment.patternData=createPatternTemplate('tshirt',garment);
  const skin=bodyCollider(human.context),panel=buildPatternPanels(human.context,garment,bodyLayout(human.context),0,skin),hit={};let inside=0;
  for(let v=0;v<panel.pos.length/3;v++)if(skin.closest(...panel.pos.slice(v*3,v*3+3),0.08,hit)&&hit.distance<-.0025)inside++;
  human.dispose();
  assert.equal(inside,0,'draft placement must not seed vertices deeper than the cloth collision shell');
});

test('hood and cuff contacts cannot launch the garment beyond its body and drafted dimensions', async () => {
  const garment=newGarment('hoodie');garment.patternData=createPatternTemplate('hoodie',garment);
  const human=await createHuman({ageYears:30,gender:0,clothing:{style:'tailor',garments:[garment]},hair:{style:'none'},shoes:'none'});
  const body=human.body.geometry.boundingBox,outfit=human.group.getObjectByName('Outfit').geometry;outfit.computeBoundingBox();
  const widths=garment.patternData.panels.map(panel=>panelMeasurements(panel).width),heights=garment.patternData.panels.map(panel=>panelMeasurements(panel).height);
  const k=(body.max.y-body.min.y)/1.7,box=outfit.boundingBox;
  assert.ok(box.max.x-box.min.x<=body.max.x-body.min.x+Math.max(...widths)*k,'body contact must not accumulate corrections into remote sheets');
  assert.ok(box.max.y-box.min.y<=body.max.y-body.min.y+Math.max(...heights)*k,'a hood stays within its anatomical/draft extent');
  human.dispose();
});

test('hood contacts also stay bounded on the actual studio default body proportions', async () => {
  const garment=newGarment('hoodie');garment.patternData=createPatternTemplate('hoodie',garment);
  const person=normalizeCharacter({...defaultCharacter,outfit:4,garments:[garment],hairPreset:'careca'}),spec=studioSpec(person);spec.shoes='none';
  const human=await createHuman(spec),body=human.body.geometry.boundingBox,outfit=human.group.getObjectByName('Outfit').geometry;outfit.computeBoundingBox();
  const widths=garment.patternData.panels.map(panel=>panelMeasurements(panel).width),k=(body.max.y-body.min.y)/1.7,box=outfit.boundingBox;
  assert.ok(box.max.x-box.min.x<=body.max.x-body.min.x+Math.max(...widths)*k,'the real studio shape must not produce remote cuff sheets');
  human.dispose();
});

test('automatic pinned hood/cuff boundary chords begin outside the real skin', async () => {
  const human=await createHuman({ageYears:30,gender:0,clothing:{style:'none'},hair:{style:'none'},shoes:'none'});human.context.body=human.body;
  const garment=newGarment('hoodie');garment.patternData=createPatternTemplate('hoodie',garment);
  const skin=bodyCollider(human.context),panel=buildPatternPanels(human.context,garment,bodyLayout(human.context),0,skin),hit={};let inside=0;
  for(let f=0;f<panel.index.length;f+=3)for(let e=0;e<3;e++){const a=panel.index[f+e],b=panel.index[f+(e+1)%3];if(!panel.pinned[a]||!panel.pinned[b])continue;const center=[0,1,2].map(c=>(panel.pos[a*3+c]+panel.pos[b*3+c])/2);if(skin.closest(...center,0.08,hit)&&hit.distance<0)inside++;}
  human.dispose();assert.equal(inside,0,'fixed boundary chords must not start embedded in skin');
});

test('full hoodie sleeves end at the anatomical wrist and its cuffs are sewn to them', async () => {
  const person=normalizeCharacter({...defaultCharacter,outfit:4,hairPreset:'careca'}),spec=studioSpec(person);spec.clothing={style:'none'};spec.shoes='none';
  const human=await createHuman(spec);human.context.body=human.body;const layout=bodyLayout(human.context),skin=bodyCollider(human.context),garment=newGarment('hoodie');garment.patternData=createPatternTemplate('hoodie',garment);
  const panel=buildPatternPanels(human.context,garment,layout,0,skin);
  for(const side of ['l','r']){
    const limb=layout.arms[side];let farthest=-Infinity;
    panel.sources.forEach((source,v)=>{if(source.panel!==`sleeve-${side}`)return;const x=panel.pos[v*3]-limb.B.x,y=panel.pos[v*3+1]-limb.B.y,z=panel.pos[v*3+2]-limb.B.z;farthest=Math.max(farthest,limb.l1+x*limb.u2.x+y*limb.u2.y+z*limb.u2.z);});
    assert.ok(farthest<=limb.length,'a full sleeve must not begin beyond the hand');
    assert.ok(panel.seams.some(s=>panel.sources[s.a].panel===`cuff-${side}`&&panel.sources[s.b].panel===`sleeve-${side}`),'the cuff joins the sleeve instead of hanging as an independent piece');
  }
  human.dispose();
});

test('skin culling detects loose opaque cloth and preserves a true hole', () => {
  const positions=new Float32Array([-0.01,-0.01,0,0.01,-0.01,0,0.01,0.01,0,-0.01,0.01,0]);
  const normals=new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),index=[0,1,2,0,2,3];
  const context={positions,data:{faces:new Uint16Array([0,1,2,3])}},layout={faces:[0],normals,k:1};
  const skin=new SurfaceCollider(0.012).add(positions,normals,index);
  const contour=[{x:-0.1,y:-0.1},{x:0.1,y:-0.1},{x:0.1,y:0.1},{x:-0.1,y:0.1}];
  const make=holes=>{const draft=triangulatePanel({contour,holes},0.055),points=draft.points.flatMap(p=>[...p,0.04]),normals=draft.points.flatMap(()=>[0,0,1]);return coveredPatternFaces(context,{index:draft.index,sewnBoundaryEdges:new Set()},Float32Array.from(points),Float32Array.from(normals),skin,layout);};
  assert.equal(make([]).has(0),true,'a covered face remains covered when the cloth is loose');
  assert.equal(make([[{x:-0.02,y:-0.02},{x:-0.02,y:0.02},{x:0.02,y:0.02},{x:0.02,y:-0.02}]]).has(0),false,'skin remains visible through a genuine pattern hole');
  const above=new Float32Array([-0.01,0.2999,0.009,0.01,0.2999,0.009,0.01,0.3001,0.011,-0.01,0.3001,0.011]);
  const aboveNormals=new Float32Array([0,-1,0.1,0,-1,0.1,0,-1,0.1,0,-1,0.1]);
  const draft=triangulatePanel({contour,holes:[]},0.055),points=Float32Array.from(draft.points.flatMap(p=>[...p,0.04]));
  assert.equal(coveredPatternFaces({positions:above,data:context.data},{index:draft.index,sewnBoundaryEdges:new Set()},points,Float32Array.from(draft.points.flatMap(()=>[0,0,1])),skin,{...layout,normals:aboveNormals}).has(0),false,'an outward ray passing through cloth below does not erase skin above its neckline');
  const outside=Float32Array.from(positions,(value,i)=>i%3===2?0.08:value),outsideNormals=Float32Array.from(normals,value=>-value);
  assert.equal(coveredPatternFaces({positions:outside,data:context.data},{index:draft.index,sewnBoundaryEdges:new Set()},points,Float32Array.from(draft.points.flatMap(()=>[0,0,1])),skin,{...layout,normals:outsideNormals}).has(0),false,'skin outside the garment is retained when its outward ray enters the fabric');
  const offset=draft.points.length,multiPoints=new Float32Array([...points,-0.1,0.35,-0.04,0.1,0.35,-0.04,0.1,0.55,-0.04,-0.1,0.55,-0.04]),multiIndex=[...draft.index,offset,offset+2,offset+1,offset,offset+3,offset+2];
  const pieceOf=[...Array(offset).fill(0),1,1,1,1];
  assert.equal(coveredPatternFaces({positions:above,data:context.data},{index:multiIndex,pieceOf,sewnBoundaryEdges:new Set()},multiPoints,new Float32Array(multiPoints.length),skin,{...layout,normals:aboveNormals}).has(0),false,'adding a higher hood piece does not extend the bodice neckline coverage');
});

test('3D panel picking interpolates the actual clicked triangle centre in pattern metres', () => {
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,0.055,0,0,0,0.055,0],3));geometry.setIndex([0,1,2]);
  geometry.userData.patternSources=[[0,0],[0.055,0],[0,0.055]].map(uv=>({garment:0,pattern:'shirt',panel:'front',uv}));
  const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));mesh.name='Outfit';const group=new Group();group.add(mesh);group.updateMatrixWorld(true);
  const camera=new PerspectiveCamera(60,1,0.01,10);camera.position.set(0.055/3,0.055/3,1);camera.lookAt(0.055/3,0.055/3,0);camera.updateMatrixWorld(true);
  const editor=new ClothEditor({scene:new Scene(),current:{group}}),source=editor.pieceAt(new Vector2(0,0),camera);
  assert.equal(source.panel,'front');
  assert.ok(Math.abs(source.uv[0]-0.055/3)<1e-7&&Math.abs(source.uv[1]-0.055/3)<1e-7,'the click centre does not jump to a mesh corner');
  geometry.dispose();mesh.material.dispose();editor.line.geometry.dispose();editor.line.material.dispose();
});

test('custom pattern generates skinned pieces with saved seams and material metadata', async () => {
  const garment = normalizeGarment({ type: 'tshirt', patternData: createPatternTemplate('tshirt') });
  const human = await createHuman({ ageYears:30, heightMeters:1.7, clothing:{style:'tailor',garments:[garment]}, hair:{style:'none'},shoes:'none' });
  const outfit = human.group.getObjectByName('Outfit');
  assert.ok(outfit?.isSkinnedMesh);
  assert.ok(outfit.geometry.userData.pieceOf.some(v=>v>0));
  assert.ok(outfit.geometry.getAttribute('skinWeight').array.every(Number.isFinite));
  assert.ok(outfit.userData.patterns[0].seams.length > 0);
  assert.ok(outfit.geometry.getAttribute('position').array.every(Number.isFinite));
  assert.ok(human.body.geometry.index.count<human.body.geometry.attributes.position.count/4*6,'skin fully inside the authored garment is culled');
  human.context.body=human.body;
  const skin=bodyCollider(human.context),position=outfit.geometry.attributes.position.array,sources=outfit.geometry.userData.patternSources,hit={};
  let inside=0;
  for(let f=0;f<outfit.geometry.index.array.length;f+=3){const ids=Array.from(outfit.geometry.index.array.slice(f,f+3));if(ids.some(v=>!sources[v]))continue;const center=[0,1,2].map(k=>ids.reduce((sum,v)=>sum+position[v*3+k],0)/3);if(skin.closest(...center,0.08,hit)&&hit.distance<-.0025)inside++;}
  assert.equal(inside,0,'triangle interiors stay outside skin, not only their corners');
  const sourceMap=new Map(sources.map((s,i)=>s?[`${s.panel}:${s.uv.join(',')}`,i]:['',-1]));
  // The simulation mesh is drafted with one segment count per seam (stitch flattening), so the
  // sewn points pair one to one; a welded seam puts both sides at one position.
  const drafted=draftPanels(garment.patternData);
  for(const seam of garment.patternData.seams.filter(s=>s.kind!=='opening'))assert.equal(drafted.get(seam.a.panel).edges[seam.a.edge].length,drafted.get(seam.b.panel).edges[seam.b.edge].length,'both sides of a seam have the same number of points');
  for(const seam of garment.patternData.seams){
    const A=drafted.get(seam.a.panel),B=drafted.get(seam.b.panel),ae=A.edges[seam.a.edge],be=B.edges[seam.b.edge],count=Math.max(ae.length,be.length);
    for(let i=0;i<count;i++){const t=i/(count-1),a=sourceMap.get(`${seam.a.panel}:${A.points[ae[Math.round(t*(ae.length-1))]].join(',')}`),b=sourceMap.get(`${seam.b.panel}:${B.points[be[Math.round((seam.reverse?1-t:t)*(be.length-1))]].join(',')}`);assert.ok(Math.hypot(...[0,1,2].map(k=>position[a*3+k]-position[b*3+k]))<1e-4,'final surface contact preserves the stitched boundary');}
  }
  human.dispose();
});
