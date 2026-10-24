# Requires numpy, scipy and Pillow for offline image processing only.
# Writes draft candidates and audit data. No catalog, runtime or hosted data is modified.
import json,math,heapq,collections
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import argparse
parser=argparse.ArgumentParser(description='Conservative pixel extraction; candidates require visual review before runtime inclusion.')
parser.add_argument('--output', type=Path, required=True)
args=parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
ROOT=Path(__file__).resolve().parents[1]
CAT=json.loads((ROOT/'web/data/huddle-catalog.json').read_text())
seedtext=(ROOT/'web/data/madden-editable-seed.js').read_text(); SEEDS=json.loads(seedtext.split('= ',1)[1].rstrip().removesuffix(';'))

def thin(m):
 m=np.pad(m,1).astype(np.uint8)
 for _ in range(80):
  changed=False
  for step in [0,1]:
   c=m[1:-1,1:-1]; ps=[m[:-2,1:-1],m[:-2,2:],m[1:-1,2:],m[2:,2:],m[2:,1:-1],m[2:,:-2],m[1:-1,:-2],m[:-2,:-2]]
   n=sum(ps); trans=sum((ps[i]==0)&(ps[(i+1)%8]==1) for i in range(8))
   a,b=(ps[0]*ps[2]*ps[4],ps[2]*ps[4]*ps[6]) if step==0 else (ps[0]*ps[2]*ps[6],ps[0]*ps[4]*ps[6])
   remove=(c==1)&(n>=2)&(n<=6)&(trans==1)&(a==0)&(b==0)
   if remove.any(): c[remove]=0;changed=True
  if not changed:break
 return m[1:-1,1:-1].astype(bool)

def components(m):
 lab,n=ndi.label(m,np.ones((3,3))); out=[]
 for i,s in enumerate(ndi.find_objects(lab),1):
  y,x=s; yy,xx=np.where(lab[s]==i);out.append((x.start,y.start,x.stop-x.start,y.stop-y.start,np.column_stack((xx+x.start,yy+y.start))))
 return out

seedImage=np.array(Image.open(ROOT/'web/data/huddle-art/88bb9bbfe7c4fbbb8bca.jpg'))
LINE_MASK=(seedImage.min(2)>165)&((seedImage.max(2)-seedImage.min(2))<45)
PLAYER_LINE={n:LINE_MASK[y-4:y+5,x-4:x+5] for n,x,y in zip(['LT','LG','C','RG','RT'],[242,258,274,291,307],[182,180,176,180,182])}
CROSS_TEMPLATES=[]
for tr in SEEDS.values():
 im=np.array(Image.open(ROOT/'web'/tr['image']));wh=(im.min(2)>165)&((im.max(2)-im.min(2))<45)
 for p in tr['players']:
  if p['label'] not in ['LT','LG','C','RG','RT','QB']:
   x,y=map(round,p['at']);k=wh[y-4:y+5,x-4:x+5]
   if not any(np.array_equal(k,q) for q in CROSS_TEMPLATES):CROSS_TEMPLATES.append(k)
CROSS_TEMPLATES=CROSS_TEMPLATES[:12]
PLAYER_CROSS=((seedImage.min(2)>165)&((seedImage.max(2)-seedImage.min(2))<45))[174:182,112:121]

def players(a):
 w=(a.min(2)>165)&((a.max(2)-a.min(2))<45);w[:120]=False;w[229:]=False
 ps=[]
 for x,y,width,h,pts in components(w):
  if 6<=width<=15 and 6<=h<=24 and 27<=len(pts)<=185:
   cy=y+min(h,9)/2;ps.append([round(x+(width-1)/2,1),round(cy,1)])
 # Receiver crosses are matched by glyph shape, avoiding arrowheads mistaken for players.
 # Linemen and the QB still require individually visible white components.
 ol=[]
 for name,target,ty in zip(['LT','LG','C','RG','RT'],[242,258,274,291,307],[182,180,176,180,182]):
  choices=[(i,p) for i,p in enumerate(ps) if abs(p[0]-target)<6 and 160<p[1]<198]
  if not choices:
   template=PLAYER_LINE[name];matches=[]
   for py in range(ty-7,ty+8):
    for px in range(target-2,target+3):
     patch=w[py-4:py+5,px-4:px+5];score=(patch==template).mean()
     if score>=.86:matches.append((score,px,py))
   if not matches:return None,'line_anchors'
   score,px,py=max(matches,key=lambda v:(v[0],-abs(v[1]-target)-abs(v[2]-ty)))
   choices=[(-len(ol)-1,[float(px),float(py)])]
  i,p=min(choices,key=lambda ip:abs(ip[1][1]-ty)+abs(ip[1][0]-target))
  ol.append((i,{'label':name,'at':p}))
 if len({i for i,p in ol})!=5:return None,'line_anchors'
 liney=np.median([p['at'][1] for i,p in ol]);oline={i for i,p in ol}
 qb=[(i,p) for i,p in enumerate(ps) if abs(p[0]-274)<7 and p[1]>liney+10]
 qb=[(i,p) for i,p in qb if w[round(p[1])-4:round(p[1])+5,round(p[0])-4:round(p[0])+5].sum()>=48]
 if not qb:return None,'quarterback_anchor'
 qb=[min(qb,key=lambda ip:ip[1][1])]
 i,qb=qb[0];used=oline|{i}
 score=np.maximum.reduce([ndi.correlate(w.astype(float),2*template.astype(float)-1,mode='constant')+(1-template).sum() for template in CROSS_TEMPLATES])
 maxima=(score>=81*.84)&(score==ndi.maximum_filter(score,size=(7,7)))
 yy,xx=np.where(maxima); candidates=[]
 for px,py in sorted(zip(xx,yy),key=lambda p:-score[p[1],p[0]]):
  if py<155 or py>224 or any(math.dist([px,py],p['at'])<9 for _,p in ol) or math.dist([px,py],qb)<9:continue
  if all(math.dist([px,py],q)>8 for q in candidates):candidates.append([float(px),float(py)])
 elig=sorted(candidates)
 if len(elig)!=5:return None,'eligible_count'
 # Neutral position labels: images do not name receivers or actual roster positions.
 result=[p for i,p in ol]+[{'label':'QB','at':qb}]+[{'label':f'E{i+1}','at':p} for i,p in enumerate(elig)]
 return result,None

def graph(pts):
 s=set(map(tuple,pts));g={}
 for x,y in s:
  ns=[]
  for dx,dy in [(0,1),(1,0),(0,-1),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1)]:
   if (x+dx,y+dy) not in s:continue
   if dx and dy and ((x+dx,y) in s or (x,y+dy) in s):continue
   ns.append((x+dx,y+dy))
  g[x,y]=ns
 return g

def distances(g,start):
 d={start:0};prev={};todo=[(0,start)]
 while todo:
  cost,p=heapq.heappop(todo)
  if cost!=d[p]:continue
  for q in g[p]:
   v=cost+math.dist(p,q)
   if v<d.get(q,1e9):d[q]=v;prev[q]=p;heapq.heappush(todo,(v,q))
 return d,prev

def route_paths(g, near):
 # Remove only short arrowhead spurs, preserving player-side starts.
 g={p:set(ns) for p,ns in g.items()}
 roots=[root for owner,root in near]
 for _ in range(3):
  discard=set()
  for leaf in [p for p,ns in g.items() if len(ns)==1]:
   if any(math.dist(leaf,r)<12 for r in roots):continue
   branch=[leaf];prev=None;cur=leaf
   while len(g[cur])<=2:
    nxt=[n for n in g[cur] if n!=prev]
    if not nxt:break
    prev,cur=cur,nxt[0];branch.append(cur)
    if len(branch)>9:break
   if len(branch)<=9 and len(g[cur])>=3:discard.update(branch[:-1])
  if not discard:break
  for p in discard:
   for q in g[p]:g[q].discard(p)
   del g[p]
 paths=[]
 for owner,start in near:
  if start not in g:return None,'unclear_start'
  if len(g[start])>2:return None,'unclear_start'
  path=[start];seen={start}
  while True:
   cur=path[-1];ns=[n for n in g[cur] if n not in seen]
   if not ns:break
   if len(ns)==1:nxt=ns[0]
   else:
    # A crossing may be followed only when its straight continuation is unambiguous.
    if len(path)<7:return None,'ambiguous_junction'
    incoming=np.array(cur)-np.array(path[-7]);incoming=incoming/np.linalg.norm(incoming)
    scored=sorted([(float(np.dot((np.array(q)-cur)/np.linalg.norm(np.array(q)-cur),incoming)),q) for q in ns],reverse=True)
    if scored[0][0]<.85 or scored[0][0]-scored[1][0]<.35:return None,'ambiguous_junction'
    nxt=scored[0][1]
   seen.add(nxt);path.append(nxt)
   if len(path)>1500:return None,'cycle'
  if len(path)<20:return None,'route_too_short'
  if any(other['label']!=owner['label'] and math.dist(path[-1],r)<12 for other,r in near):return None,'connected_players'
  paths.append((owner,path))
 # The paths must cross, not share stretches or merge into the same assignment.
 if len(paths)>1:
  for i,(_,a) in enumerate(paths):
   for _,b in paths[i+1:]:
    if len(set(a)&set(b))>6 or math.dist(a[-1],b[-1])<12:return None,'merged_routes'
 return paths,None

def simplify(points,eps=1.5):
 if len(points)<3:return points
 a,b=np.array(points[0]),np.array(points[-1]);v=b-a
 dist=np.abs(v[0]*(np.array(points)-a)[:,1]-v[1]*(np.array(points)-a)[:,0])/max(np.linalg.norm(v),1e-6)
 i=int(dist.argmax())
 if dist[i]<=eps:return [points[0],points[-1]]
 return simplify(points[:i+1],eps)[:-1]+simplify(points[i:],eps)

def process(row):
 a=np.array(Image.open(ROOT/'web'/row['image']).convert('RGB')).astype(float)
 if a.shape[:2]!=(256,554):return None,'image_dimensions'
 ps,err=players(a)
 if err:return None,err
 red,green,blue=a[:,:,0],a[:,:,1],a[:,:,2]
 masks={'yellow':(red>60)&(green>60)&(np.minimum(red,green)-blue>22)&(red/np.maximum(green,1)<1.55), 'red':(red>60)&(red-green>25)&(red-blue>15),'blue':(blue>60)&(blue-red>22)&(blue-green>12)}
 routes=[];owners=[]; eligible=[p for p in ps if p['label'].startswith('E')]
 for color,mask in masks.items():
  mask[222:]=False;mask[:,:10]=False;mask[:,544:]=False
  # A 3px close repairs JPEG-size gaps only. Larger missing segments are rejected.
  mask=ndi.binary_closing(mask,structure=np.ones((3,3)))
  if color=='blue':
   # Only bridge gaps hidden by an identified offensive lineman's white marker.
   occluded=np.zeros(mask.shape,bool)
   for p in ps[:5]:
    px,py=map(round,p['at']);occluded[max(0,py-5):min(222,py+13),px-7:px+8]=True
   mask |= ndi.binary_closing(mask,structure=np.ones((13,3))) & occluded
  for x,y,w,h,pixels in components(mask):
   if len(pixels)<25:continue
   if max(w,h)<16:continue
   sk=thin(mask[y:y+h,x:x+w]); yy,xx=np.where(sk);pts=np.column_stack((xx+x,yy+y))
   if len(pts)<18:continue
   near=[]
   for p in eligible:
    ds=np.linalg.norm(pts-np.array(p['at']),axis=1)
    if ds.min()<9:near.append((p,tuple(pts[ds.argmin()])))
   if not near:return None,'unassigned_route'
   g=graph(pts)
   paths,err=route_paths(g,near)
   if err:return None,err
   pathmask=np.ones(sk.shape,bool)
   for _,path in paths:
    for px,py in path:pathmask[py-y,px-x]=False
   if ndi.distance_transform_edt(pathmask)[sk].max()>9:return None,'uncovered_branch'
   for owner,path in paths:
    points=simplify(path);points[0]=owner['at']
    routes.append({'owner':owner['label'],'points':[[float(x),float(y)] for x,y in points],'ink':color,'kind':'block' if color=='blue' else 'route','optional':False})
    owners.append(owner['label'])
 if len(routes)!=5 or len(set(owners))!=5:return None,'incomplete_assignments'
 if sum(r['kind']=='route' for r in routes)<3:return None,'insufficient_visible_routes'
 return {**row,'traceVersion':1,'coordinateSystem':{'width':554,'height':256,'lineOfScrimmageY':174},'method':'conservative-pixel-trace-v1','players':ps,'routes':routes,'reviewNotes':['自动沿原图像素提取：仅收录 11 个站位清楚、5 条非锋线路线起点明确、连通路径及交叉延续方向可判断的图。E1–E5 为站位标签，不代表真实球员身份；蓝线按保护图示处理。']},None

def main():
 known={r['image']:r for r in SEEDS.values()};out=dict(SEEDS);audit=[];cache={};stats=collections.Counter()
 for i,row in enumerate(CAT['plays']):
  if row['id'] in SEEDS:status='seed';err=None;trace=SEEDS[row['id']]
  elif row['image'] in known:
   source=known[row['image']];trace={**source,**row,'method':'identical-image-reuse'};status='identical';err=None;out[row['id']]=trace
  else:
   if row['image'] not in cache:cache[row['image']]=process(row)
   trace,err=cache[row['image']]
   if trace:trace={**trace,**row};out[row['id']]=trace;status='candidate'
   else:status='original'
  stats[status]+=1
  if err:stats[err]+=1
  audit.append({'id':row['id'],'team':row['team'],'name':row['name'],'formation':row['group']+' '+row['formation'],'image':row['image'],'status':status,'reason':err})
  if i%100==0:print(i,dict(stats),flush=True)
 (args.output/'candidates.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 (args.output/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
 print('FINAL',dict(stats),flush=True)
if __name__=='__main__':main()
