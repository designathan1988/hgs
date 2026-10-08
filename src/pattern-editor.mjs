import { createPatternTemplate, createComponent, mirrorPanel, normalizePattern, panelComponents, panelMeasurements, sampleContour, setPatternConnection } from './patterns.mjs';

const NS='http://www.w3.org/2000/svg';
const labels={body:'Corpo',sleeve:'Manga',collar:'Gola',hood:'Capuz',pocket:'Bolso',cuff:'Punho',leg:'Perna',skirt:'Saia',hand:'Luva',foot:'Meia'};
function element(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
function svg(tag,attrs){const el=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));return el;}

/** Native SVG drafting. onChange receives the complete garment, only after each committed edit. */
export class PatternEditor {
  constructor(container,{garment,onChange=()=>{}}={}) {
    this.container=container;this.onChange=onChange;this.garment=structuredClone(garment);this.active=0;this.selected=0;this.selectedHole=null;this.tool='select';this.draft=[];this.edge=null;this.sewStart=null;
    this.root=element('section');this.root.className='pattern-editor';this.root.style.cssText='border:1px solid #415366;padding:10px;border-radius:8px;display:grid;gap:8px;background:#152131;color:#dce9f3;font:12px system-ui;';container.append(this.root);this.render();
  }
  setGarment(garment){this.garment=structuredClone(garment);this.active=Math.min(this.active,Math.max(0,(garment?.patternData?.panels.length??1)-1));this.render();}
  get pattern(){return this.garment?.patternData;}
  get panel(){return this.pattern?.panels[this.active];}
  get selectedPoint(){return ((this.selectedHole===null?this.panel.contour:this.panel.holes[this.selectedHole])??[])[this.selected]??this.panel.contour[0];}
  commit(){this.garment={...this.garment,patternData:normalizePattern(this.pattern)};this.onChange(structuredClone(this.garment));this.render();}
  button(parent,text,action){const b=element('button',text);b.type='button';b.style.cssText='font:inherit;padding:5px 7px;background:#25394d;color:inherit;border:1px solid #5a7184;border-radius:4px;cursor:pointer;';b.addEventListener('click',action);parent.append(b);return b;}
  select(parent,label,options,value,onChange){const wrap=element('label',label+' '),select=element('select');select.style.cssText='max-width:145px;font:inherit;background:#203247;color:inherit;padding:4px;';for(const [v,text] of options){const option=element('option',text);option.value=v;select.append(option);}select.value=value;select.addEventListener('change',()=>onChange(select.value));wrap.append(select);parent.append(wrap);return select;}
  number(parent,label,value,step,onChange,min,max){const wrap=element('label',label+' '),input=element('input');input.type='number';input.value=value;input.step=step;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;input.style.cssText='width:62px;background:#203247;color:inherit;border:1px solid #536c82;font:inherit;padding:4px;';input.addEventListener('change',()=>{if(Number.isFinite(input.valueAsNumber))onChange(input.valueAsNumber);});wrap.append(input);parent.append(wrap);}
  row(){const row=element('div');row.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:6px';this.root.append(row);return row;}
  begin(tool){this.tool=tool;this.draft=[];this.sewStart=null;this.render();}
  finishDrawing(){
    if(this.draft.length<3&&this.tool!=='cut')return;
    if(this.tool==='draw') {const panel=createComponent('body',`custom-${Date.now()}`,this.garment);panel.name='Contorno livre';panel.contour=this.draft;this.pattern.panels.push(panel);this.active=this.pattern.panels.length-1;}
    if(this.tool==='hole')this.panel.holes.push(this.draft);
    if(this.tool==='cut'&&this.draft.length>=2){const a=this.draft[0],b=this.draft.at(-1),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,nx=-dy/length*0.002,ny=dx/length*0.002;this.panel.holes.push([{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}]);}
    this.tool='select';this.draft=[];this.commit();
  }
  edgeClick(edge,hole=null){
    this.edge=edge;this.edgeHole=hole;
    if(['seam','dart','opening'].includes(this.tool)) {
      const ref={panel:this.panel.id,edge,...(hole!==null?{hole}:{})};
      if(!this.sewStart){this.sewStart=ref;this.render();return;}
      this.garment={...this.garment,patternData:setPatternConnection(this.pattern,{a:this.sewStart,b:ref,reverse:this.reverse??false,kind:this.tool,compliance:1e-8})};this.sewStart=null;this.commit();
    }else if(this.tool==='point'){
      const contour=hole===null?this.panel.contour:this.panel.holes[hole];
      const a=contour[edge],b=contour[(edge+1)%contour.length];contour.splice(edge+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
      // Original edge references after the inserted edge shift by one, keeping other stitches attached.
      for(const s of this.pattern.seams)for(const ref of [s.a,s.b])if(ref.panel===this.panel.id&&(ref.hole??null)===hole&&ref.edge>edge)ref.edge++;
      if(hole===null)this.panel.pins=this.panel.pins.map(p=>p>edge?p+1:p);this.selected=edge+1;this.selectedHole=hole;this.commit();
    }else this.render();
  }
  render(){
    this.root.replaceChildren();const top=this.row();this.button(top,'Gerar molde editável',()=>{this.garment={...this.garment,authoringMode:'pattern',patternData:createPatternTemplate(this.garment.type,this.garment)};this.active=0;this.commit();});
    if(!this.pattern?.panels.length){this.root.append(element('p','Gere os painéis do modelo para desenhar contornos, costurar e ajustar o tecido.'));return;}
    this.select(top,'Peça',this.pattern.panels.map((p,i)=>[String(i),p.name]),String(this.active),v=>{this.active=Number(v);this.selected=0;this.selectedHole=null;this.render();});
    const tools=this.row();for(const [tool,label] of [['select','Mover pontos'],['draw','Novo contorno'],['point','Inserir ponto'],['hole','Abertura'],['cut','Corte'],['seam','Costurar'],['dart','Pence'],['opening','Borda aberta']]){const b=this.button(tools,label,()=>this.begin(tool));if(this.tool===tool)b.style.background='#426b83';}
    const componentRow=this.row();this.select(componentRow,'Componente',[['','Adicionar…'],...panelComponents.map(c=>[c,labels[c]])],'',v=>{if(!v)return;const panel=createComponent(v,`${v}-${Date.now()}`,this.garment);this.pattern.panels.push(panel);this.active=this.pattern.panels.length-1;this.commit();});
    this.button(componentRow,'Duplicar',()=>{const p=structuredClone(this.panel);p.id=`${p.id}-${Date.now()}`;p.name+=' cópia';this.pattern.panels.push(p);this.active=this.pattern.panels.length-1;this.commit();});
    this.button(componentRow,'Espelhar',()=>{this.pattern.panels.push(mirrorPanel(this.panel,`${this.panel.id}-${Date.now()}`));this.active=this.pattern.panels.length-1;this.commit();});
    const reverse=element('label','Inverter costura '),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=!!this.reverse;checkbox.onchange=()=>{this.reverse=checkbox.checked;};reverse.append(checkbox);componentRow.append(reverse);
    const instruction=this.sewStart?'Escolha outra peça e clique na borda a associar.':this.tool==='draw'||this.tool==='hole'||this.tool==='cut'?'Clique para adicionar pontos; dê duplo clique ou finalize.':'Arraste pontos e alças; clique em uma borda para selecionar.';
    this.root.append(element('p',instruction));
    if(['draw','hole','cut'].includes(this.tool))this.button(this.row(),'Finalizar desenho',()=>this.finishDrawing());
    const bounds=[...this.panel.contour,...this.panel.holes.flat()];
    const minX=Math.min(...bounds.map(p=>p.x))*1000-50,minY=Math.min(...bounds.map(p=>p.y))*1000-50,maxX=Math.max(...bounds.map(p=>p.x))*1000+50,maxY=Math.max(...bounds.map(p=>p.y))*1000+50;
    const width=Math.max(350,maxX-minX),height=Math.max(400,maxY-minY),viewX=(maxX+minX-width)/2,viewY=(maxY+minY-height)/2;
    const canvas=svg('svg',{viewBox:`${viewX} ${viewY} ${width} ${height}`,role:'img','aria-label':'Editor de molde em milímetros'});canvas.style.cssText='width:100%;height:340px;touch-action:none;background:#edf4f7;border-radius:5px;';this.root.append(canvas);this.canvas=canvas;
    const pointFromEvent=e=>{const pt=canvas.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const transformed=pt.matrixTransform(canvas.getScreenCTM().inverse());return{x:Math.round(transformed.x)/1000,y:Math.round(transformed.y)/1000};};
    const path=contour=>{let d=`M ${contour[0].x*1000} ${contour[0].y*1000}`;for(let i=0;i<contour.length;i++){const a=contour[i],b=contour[(i+1)%contour.length];d+=a.out||b.in?` C ${(a.out??[a.x,a.y]).map(x=>x*1000).join(' ')} ${(b.in??[b.x,b.y]).map(x=>x*1000).join(' ')} ${b.x*1000} ${b.y*1000}`:` L ${b.x*1000} ${b.y*1000}`;}return d+' Z';};
    // Millimetre grid and a single active piece keep point editing legible on narrow inspectors.
    for(let x=Math.floor(viewX/50)*50;x<=viewX+width;x+=50)canvas.append(svg('line',{x1:x,y1:viewY,x2:x,y2:viewY+height,stroke:'#c9d8df','stroke-width':1}));
    for(let y=Math.floor(viewY/50)*50;y<=viewY+height;y+=50)canvas.append(svg('line',{x1:viewX,y1:y,x2:viewX+width,y2:y,stroke:'#c9d8df','stroke-width':1}));
    const fill=svg('path',{d:path(this.panel.contour)+this.panel.holes.map(path).join(' '),fill:this.panel.material.color,'fill-opacity':0.55,'fill-rule':'evenodd',stroke:'#274a61','stroke-width':2});canvas.append(fill);
    for(const region of this.pattern.pinRegions??[])if(region.panel===this.panel.id)canvas.append(svg('circle',{cx:region.center[0]*1000,cy:region.center[1]*1000,r:region.radius*1000,fill:'#ed8749','fill-opacity':0.2,stroke:'#b95122','stroke-width':3,'pointer-events':'none','aria-label':'Região fixa'}));
    const sampled=sampleContour(this.panel.contour,0.012);
    sampled.edges.forEach((ids,e)=>{const line=svg('polyline',{points:ids.map(v=>sampled.points[v].map(c=>c*1000).join(',')).join(' '),fill:'none',stroke:e===this.edge?'#f58c35':'transparent','stroke-width':12});line.addEventListener('click',event=>{event.stopPropagation();this.edgeClick(e);});canvas.append(line);const a=sampled.points[ids[Math.floor(ids.length/2)]];const label=svg('text',{x:a[0]*1000,y:a[1]*1000-8,fill:'#19374d','font-size':18});label.textContent=String(e+1);canvas.append(label);});
    this.panel.holes.forEach((contour,hole)=>{
      const sampled=sampleContour(contour,0.012);
      sampled.edges.forEach((ids,edge)=>{const line=svg('polyline',{points:ids.map(v=>sampled.points[v].map(c=>c*1000).join(',')).join(' '),fill:'none',stroke:edge===this.edge&&hole===this.edgeHole?'#f58c35':'#597a8d','stroke-opacity':0.6,'stroke-width':8});line.addEventListener('click',event=>{event.stopPropagation();this.edgeClick(edge,hole);});canvas.append(line);});
    });
    const draggable=(p,index,handle,hole=null)=>{
      const coords=handle?p[handle]:[p.x,p.y],circle=svg('circle',{cx:coords[0]*1000,cy:coords[1]*1000,r:handle?6:9,fill:handle?'#9858ac':hole===null&&this.panel.pins.includes(index)?'#c65328':index===this.selected&&hole===this.selectedHole?'#f2a545':'#255873',stroke:'#fff','stroke-width':2});canvas.append(circle);
      circle.addEventListener('pointerdown',event=>{
        event.stopPropagation();this.selected=index;this.selectedHole=hole;if(this.tool!=='select')return;
        circle.setPointerCapture(event.pointerId);let last=pointFromEvent(event),moved=false;
        const move=e=>{const next=pointFromEvent(e),dx=next.x-last.x,dy=next.y-last.y;if(dx||dy)moved=true;if(handle)p[handle]=[next.x,next.y];else{p.x+=dx;p.y+=dy;for(const h of ['in','out'])if(p[h]){p[h][0]+=dx;p[h][1]+=dy;}}last=next;circle.setAttribute('cx',(handle?p[handle][0]:p.x)*1000);circle.setAttribute('cy',(handle?p[handle][1]:p.y)*1000);fill.setAttribute('d',path(this.panel.contour)+this.panel.holes.map(path).join(' '));};
        const up=()=>{circle.removeEventListener('pointermove',move);circle.removeEventListener('pointerup',up);if(moved)this.commit();else this.render();};circle.addEventListener('pointermove',move);circle.addEventListener('pointerup',up);
      });
    };
    this.panel.contour.forEach((p,i)=>{for(const h of ['in','out'])if(p[h]){canvas.append(svg('line',{x1:p.x*1000,y1:p.y*1000,x2:p[h][0]*1000,y2:p[h][1]*1000,stroke:'#9858ac','stroke-width':2}));draggable(p,i,h);}draggable(p,i);});
    this.panel.holes.forEach((h,hole)=>h.forEach((p,i)=>{for(const handle of ['in','out'])if(p[handle])draggable(p,i,handle,hole);draggable(p,i,null,hole);}));
    const draftLine=svg('polyline',{points:this.draft.map(p=>`${p.x*1000},${p.y*1000}`).join(' '),fill:'none',stroke:'#b64064','stroke-width':4});canvas.append(draftLine);
    canvas.addEventListener('click',e=>{if(['draw','hole','cut'].includes(this.tool)){const point=pointFromEvent(e);if(!this.draft.length||Math.hypot(point.x-this.draft.at(-1).x,point.y-this.draft.at(-1).y)>0.002)this.draft.push(point);draftLine.setAttribute('points',this.draft.map(p=>`${p.x*1000},${p.y*1000}`).join(' '));}});canvas.addEventListener('dblclick',e=>{e.preventDefault();this.finishDrawing();});
    const edits=this.row();this.button(edits,'Curva Bézier',()=>{const p=this.selectedPoint;p.in=[p.x-0.035,p.y];p.out=[p.x+0.035,p.y];this.commit();});
    this.button(edits,'Reta',()=>{const p=this.selectedPoint;delete p.in;delete p.out;this.commit();});
    this.button(edits,'Fixar / soltar ponto',()=>{if(this.selectedHole!==null)return;const pins=this.panel.pins,idx=pins.indexOf(this.selected);if(idx<0)pins.push(this.selected);else pins.splice(idx,1);this.commit();});
    const p=this.selectedPoint;this.number(edits,'X mm',Math.round(p.x*1000),1,v=>{p.x=v/1000;this.commit();});this.number(edits,'Y mm',Math.round(p.y*1000),1,v=>{p.y=v/1000;this.commit();});
    const measured=panelMeasurements(this.panel);this.root.append(element('p',`Largura ${(measured.width*100).toFixed(1)} cm · altura ${(measured.height*100).toFixed(1)} cm · perímetro ${(measured.perimeter*100).toFixed(1)} cm · área ${(measured.area*10000).toFixed(0)} cm²`));
    const placement=this.row();this.select(placement,'Região',[['torso','Tronco'],['arm','Braço'],['leg','Perna'],['head','Cabeça'],['skirt','Saia'],['hand','Mão'],['foot','Pé']],this.panel.placement.region,v=>{this.panel.placement.region=v;this.commit();});this.select(placement,'Lado',[['front','Frente'],['back','Costas'],['l','Esquerda'],['r','Direita']],this.panel.placement.side,v=>{this.panel.placement.side=v;this.commit();});
    for(const [key,unit,factor] of [['offset','mm',1000],['rotation','°',180/Math.PI]]){const row=this.row();for(let i=0;i<3;i++)this.number(row,`${key==='offset'?'Posição':'Rotação'} ${'XYZ'[i]} ${unit}`,Math.round(this.panel.placement[key][i]*factor),1,v=>{this.panel.placement[key][i]=v/factor;this.commit();});}
    const material=this.row();this.number(material,'Espessura mm',this.panel.material.thickness*1000,0.5,v=>{this.panel.material.thickness=v/1000;this.commit();},1,20);for(const [key,label] of [['elasticity','Elasticidade'],['stiffness','Rigidez']])this.number(material,label,this.panel.material[key],0.05,v=>{this.panel.material[key]=v;this.commit();},0,1);
    const appearance=this.row();for(const [key,label] of [['color','Cor'],['color2','Cor 2']]){const wrap=element('label',label+' '),input=element('input');input.type='color';input.value=this.panel.material[key];input.addEventListener('change',()=>{this.panel.material[key]=input.value;this.commit();});wrap.append(input);appearance.append(wrap);}this.select(appearance,'Estampa',[['solid','Lisa'],['stripes','Listras'],['pinstripe','Risca'],['checks','Xadrez'],['gradient','Degradê']],this.panel.material.pattern,v=>{this.panel.material.pattern=v;this.commit();});this.number(appearance,'Escala',this.panel.material.scale,0.05,v=>{this.panel.material.scale=v;this.commit();},0,1);
    const stitches=element('details'),summary=element('summary',`Costuras e pences (${this.pattern.seams.length})`);stitches.append(summary);this.pattern.seams.forEach((s,i)=>{const row=element('div',`${s.kind}: ${s.a.panel} / ${s.a.edge+1} ↔ ${s.b.panel} / ${s.b.edge+1}`);row.style.marginTop='5px';this.button(row,'Inverter',()=>{s.reverse=!s.reverse;this.commit();});stitches.append(row);});this.root.append(stitches);
  }
  destroy(){this.root.remove();}
}
