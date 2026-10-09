/** Discrete, two-sided vertex/triangle repulsion (Bridson et al., SIGGRAPH 2002).
 * Spatial cells avoid the quadratic all-pairs scan. This is not continuous CCD.
 * Each call: triangle planes are computed once (positions at the start of the
 * pass), triangles are binned into a dense grid over the cloth's box
 * (cellStart counted then summed, cellEntries filled: Ten Minute Physics 11),
 * and the hot loop allocates nothing; the cheap plane and barycentric tests run
 * before the neighbour-exclusion lookups.
 */
export function projectClothSurface(x,index,inverseMass,distance,excluded,previous=null) {
  if(!index.length||distance<=0)return;
  const count=x.length/3,faces=index.length/3,cellSize=Math.max(distance*3,0.035);
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let v=0;v<count;v++){const px=x[v*3],py=x[v*3+1],pz=x[v*3+2];if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;if(pz<minZ)minZ=pz;if(pz>maxZ)maxZ=pz;}
  const lo0=Math.floor((minX-distance)/cellSize),lo1=Math.floor((minY-distance)/cellSize),lo2=Math.floor((minZ-distance)/cellSize);
  const nx=Math.floor((maxX+distance)/cellSize)-lo0+1,ny=Math.floor((maxY+distance)/cellSize)-lo1+1,nz=Math.floor((maxZ+distance)/cellSize)-lo2+1;
  const cells=nx*ny*nz,start=new Int32Array(cells+1),range=new Int32Array(faces*6),plane=new Float64Array(faces*4),large=[];
  // Pass 1: each triangle's plane and cell range; count entries per cell.
  for(let f=0;f<faces;f++){
    const a=index[f*3]*3,b=index[f*3+1]*3,c=index[f*3+2]*3;
    const ux=x[b]-x[a],uy=x[b+1]-x[a+1],uz=x[b+2]-x[a+2],vx=x[c]-x[a],vy=x[c+1]-x[a+1],vz=x[c+2]-x[a+2];
    let px=uy*vz-uz*vy,py=uz*vx-ux*vz,pz=ux*vy-uy*vx;const len=Math.hypot(px,py,pz);
    if(len<1e-10){range[f*6]=1;range[f*6+3]=0;continue;}
    px/=len;py/=len;pz/=len;plane[f*4]=px;plane[f*4+1]=py;plane[f*4+2]=pz;plane[f*4+3]=px*x[a]+py*x[a+1]+pz*x[a+2];
    const i0=Math.floor((Math.min(x[a],x[b],x[c])-distance)/cellSize)-lo0,i1=Math.floor((Math.max(x[a],x[b],x[c])+distance)/cellSize)-lo0;
    const j0=Math.floor((Math.min(x[a+1],x[b+1],x[c+1])-distance)/cellSize)-lo1,j1=Math.floor((Math.max(x[a+1],x[b+1],x[c+1])+distance)/cellSize)-lo1;
    const k0=Math.floor((Math.min(x[a+2],x[b+2],x[c+2])-distance)/cellSize)-lo2,k1=Math.floor((Math.max(x[a+2],x[b+2],x[c+2])+distance)/cellSize)-lo2;
    range.set([i0,j0,k0,i1,j1,k1],f*6);
    // Long/slender faces use direct candidates; expanding their box into many cells gains nothing.
    if((i1-i0+1)*(j1-j0+1)*(k1-k0+1)>4096){large.push(f);range[f*6]=1;range[f*6+3]=0;continue;}
    for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)start[(k*ny+j)*nx+i]++;
  }
  for(let i=1;i<=cells;i++)start[i]+=start[i-1];
  const entries=new Int32Array(start[cells]);
  // Pass 2: fill (backwards, so each cell's triangles end in increasing order).
  for(let f=faces-1;f>=0;f--){
    const i0=range[f*6],j0=range[f*6+1],k0=range[f*6+2],i1=range[f*6+3],j1=range[f*6+4],k1=range[f*6+5];
    for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)entries[--start[(k*ny+j)*nx+i]]=f;
  }
  const edgeKey=(a,b)=>a<b?a*4194304+b:b*4194304+a;
  const test=(p,f)=>{
    const a=index[f*3],b=index[f*3+1],c=index[f*3+2];
    if(p===a||p===b||p===c)return;
    const pnx=plane[f*4],pny=plane[f*4+1],pnz=plane[f*4+2];
    if(!pnx&&!pny&&!pnz)return;
    const signed=pnx*x[p*3]+pny*x[p*3+1]+pnz*x[p*3+2]-plane[f*4+3];
    if(signed>=distance||signed<=-distance)return;
    const ux=x[b*3]-x[a*3],uy=x[b*3+1]-x[a*3+1],uz=x[b*3+2]-x[a*3+2],vx=x[c*3]-x[a*3],vy=x[c*3+1]-x[a*3+1],vz=x[c*3+2]-x[a*3+2];
    const px=x[p*3]-x[a*3],py=x[p*3+1]-x[a*3+1],pz=x[p*3+2]-x[a*3+2];
    const uu=ux*ux+uy*uy+uz*uz,uv=ux*vx+uy*vy+uz*vz,vv=vx*vx+vy*vy+vz*vz,pu=px*ux+py*uy+pz*uz,pv=px*vx+py*vy+pz*vz,den=uu*vv-uv*uv;
    if(den<1e-15)return;
    const beta=(vv*pu-uv*pv)/den,gamma=(uu*pv-uv*pu)/den,alpha=1-beta-gamma;
    if(alpha<0||beta<0||gamma<0)return;
    if(excluded.has(edgeKey(p,a))||excluded.has(edgeKey(p,b))||excluded.has(edgeKey(p,c)))return;
    const w=inverseMass[p]+inverseMass[a]*alpha*alpha+inverseMass[b]*beta*beta+inverseMass[c]*gamma*gamma;if(!w)return;
    let sign=Math.sign(signed);
    if(!sign&&previous)sign=Math.sign((previous[p*3]-previous[a*3])*pnx+(previous[p*3+1]-previous[a*3+1])*pny+(previous[p*3+2]-previous[a*3+2])*pnz);
    sign ||= p>a?1:-1;
    const maximumWeight=Math.max(inverseMass[p],inverseMass[a]*alpha,inverseMass[b]*beta,inverseMass[c]*gamma);
    const correction=Math.min((distance-Math.abs(signed))/w,distance/maximumWeight)*sign;
    const kp=correction*inverseMass[p],ka=-correction*inverseMass[a]*alpha,kb=-correction*inverseMass[b]*beta,kc=-correction*inverseMass[c]*gamma;
    x[p*3]+=pnx*kp;x[p*3+1]+=pny*kp;x[p*3+2]+=pnz*kp;
    x[a*3]+=pnx*ka;x[a*3+1]+=pny*ka;x[a*3+2]+=pnz*ka;
    x[b*3]+=pnx*kb;x[b*3+1]+=pny*kb;x[b*3+2]+=pnz*kb;
    x[c*3]+=pnx*kc;x[c*3+1]+=pny*kc;x[c*3+2]+=pnz*kc;
  };
  for(let p=0;p<count;p++) {
    const i=Math.floor(x[p*3]/cellSize)-lo0,j=Math.floor(x[p*3+1]/cellSize)-lo1,k=Math.floor(x[p*3+2]/cellSize)-lo2;
    if(i>=0&&i<nx&&j>=0&&j<ny&&k>=0&&k<nz){const cell=(k*ny+j)*nx+i;for(let e=start[cell],end=start[cell+1];e<end;e++)test(p,entries[e]);}
    for(let e=0;e<large.length;e++)test(p,large[e]);
  }
}
