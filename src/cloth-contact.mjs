/** Discrete, two-sided vertex/triangle repulsion (Bridson et al., SIGGRAPH 2002).
 * Spatial cells avoid the quadratic all-pairs scan. This is not continuous CCD.
 */
export function projectClothSurface(x,index,inverseMass,distance,excluded,previous=null) {
  if(!index.length||distance<=0)return;
  const cellSize=Math.max(distance*3,0.035),grid=new Map(),large=[];
  for(let f=0;f<index.length;f+=3) {
    const ids=[index[f],index[f+1],index[f+2]],lo=[],hi=[];
    for(let c=0;c<3;c++){lo.push(Math.floor((Math.min(...ids.map(v=>x[v*3+c]))-distance)/cellSize));hi.push(Math.floor((Math.max(...ids.map(v=>x[v*3+c]))+distance)/cellSize));}
    // Long/slender faces use direct candidates; expanding their AABB into millions
    // of empty cells would exhaust memory without improving contact accuracy.
    if((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1)>4096){large.push(f);continue;}
    for(let a=lo[0];a<=hi[0];a++)for(let b=lo[1];b<=hi[1];b++)for(let c=lo[2];c<=hi[2];c++){const key=`${a}:${b}:${c}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(f);}
  }
  const edgeKey=(a,b)=>a<b?a*4194304+b:b*4194304+a;
  for(let p=0;p<x.length/3;p++) {
    const key=[0,1,2].map(c=>Math.floor(x[p*3+c]/cellSize)).join(':');
    for(const candidates of [grid.get(key)??[],large])for(const f of candidates) {
      const a=index[f],b=index[f+1],c=index[f+2];
      if(p===a||p===b||p===c||excluded.has(edgeKey(p,a))||excluded.has(edgeKey(p,b))||excluded.has(edgeKey(p,c)))continue;
      const ux=x[b*3]-x[a*3],uy=x[b*3+1]-x[a*3+1],uz=x[b*3+2]-x[a*3+2],vx=x[c*3]-x[a*3],vy=x[c*3+1]-x[a*3+1],vz=x[c*3+2]-x[a*3+2];
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const len=Math.hypot(nx,ny,nz);if(len<1e-10)continue;nx/=len;ny/=len;nz/=len;
      const px=x[p*3]-x[a*3],py=x[p*3+1]-x[a*3+1],pz=x[p*3+2]-x[a*3+2],signed=px*nx+py*ny+pz*nz;
      if(Math.abs(signed)>=distance)continue;
      const uu=ux*ux+uy*uy+uz*uz,uv=ux*vx+uy*vy+uz*vz,vv=vx*vx+vy*vy+vz*vz,pu=px*ux+py*uy+pz*uz,pv=px*vx+py*vy+pz*vz,den=uu*vv-uv*uv;
      if(den<1e-15)continue;
      const beta=(vv*pu-uv*pv)/den,gamma=(uu*pv-uv*pu)/den,alpha=1-beta-gamma;
      if(alpha<0||beta<0||gamma<0)continue;
      const w=inverseMass[p]+inverseMass[a]*alpha*alpha+inverseMass[b]*beta*beta+inverseMass[c]*gamma*gamma;if(!w)continue;
      let sign=Math.sign(signed);
      if(!sign&&previous)sign=Math.sign((previous[p*3]-previous[a*3])*nx+(previous[p*3+1]-previous[a*3+1])*ny+(previous[p*3+2]-previous[a*3+2])*nz);
      sign ||= p>a?1:-1;
      const maximumWeight=Math.max(inverseMass[p],inverseMass[a]*alpha,inverseMass[b]*beta,inverseMass[c]*gamma);
      const correction=Math.min((distance-Math.abs(signed))/w,distance/maximumWeight)*sign;
      for(const [id,weight] of [[p,inverseMass[p]],[a,-inverseMass[a]*alpha],[b,-inverseMass[b]*beta],[c,-inverseMass[c]*gamma]]){x[id*3]+=nx*correction*weight;x[id*3+1]+=ny*correction*weight;x[id*3+2]+=nz*correction*weight;}
    }
  }
}
