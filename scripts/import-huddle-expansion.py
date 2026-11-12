#!/usr/bin/env python3
"""Add eight Madden 27 team catalogs without replacing reviewed entries.

Run from the repository root after `node scripts/materialize-huddle.mjs`.
The URL, name, formation, group and season must match to reuse a reviewed trace.
"""
import concurrent.futures, datetime, hashlib, json, subprocess, time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'web/data/huddle-catalog.json'
CACHE = Path('/tmp/madden-27-expansion-cache')
CACHE.mkdir(exist_ok=True)
TEAMS = [('49ers','49ers','San Francisco'), ('bengals','Bengals','Cincinnati'),
         ('bills','Bills','Buffalo'), ('chiefs','Chiefs','Kansas City'),
         ('cowboys','Cowboys','Dallas'), ('dolphins','Dolphins','Miami'),
         ('lions','Lions','Detroit'), ('packers','Packers','Green Bay')]

def get(url):
    path = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if path.exists(): return path.read_bytes()
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=45) as r:
                body = r.read()
            path.write_bytes(body)
            return body
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt + 1)

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(); self.group=''; self.h3=False; self.capture=None; self.current=None; self.formations=[]; self.plays=[]; self.text=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs); classes=a.get('class','').split()
        if tag=='h3': self.h3=True; self.group=''
        if tag=='a' and 'playbooks-list__link' in classes: self.capture='formation'; self.current={'url':a['href'],'name':'','group':self.group.strip()}
        if tag=='a' and 'play-tile2' in classes: self.capture='play'; self.current={'url':a['href'],'name':'','imageUrl':None}
        if self.capture=='play' and tag=='img': self.current['imageUrl']=a.get('src')
        if self.capture=='play' and 'play-tile2__info' in classes: self.in_info=True
    def handle_data(self, text):
        self.text.append(text)
        if self.h3: self.group += text
        if self.capture=='formation': self.current['name'] += text
        if self.capture=='play' and getattr(self,'in_info',False): self.current['name'] += text
    def handle_endtag(self, tag):
        if tag=='h3': self.h3=False
        if tag=='div' and getattr(self,'in_info',False): self.in_info=False
        if tag=='a' and self.capture:
            self.current['name']=self.current['name'].strip()
            (self.formations if self.capture=='formation' else self.plays).append(self.current)
            self.capture=None; self.current=None

def parse(url):
    p=Parser(); p.feed(get(url).decode('utf8')); return p
def team_page(team):
    tid,name,city=team; url=f'https://huddle.gg/playbooks/{tid}-off/'
    p=parse(url)
    if 'Madden 27' not in ''.join(p.text) or not p.formations: raise ValueError('Unexpected season/empty team: '+url)
    for f in p.formations: f['url']=urljoin(url,f['url'])
    return {'id':tid,'name':name,'city':city,'game':'Madden 27','sourceUrl':url,'formations':p.formations}
def formation_page(task):
    t,f=task; p=parse(f['url']); out=[]
    if not p.plays: raise ValueError('Empty formation: '+f['url'])
    for row in p.plays:
        url=urljoin(f['url'],row['url']); image=row['imageUrl']
        if not image or not image.startswith('https://play-art.s3.amazonaws.com/madden-27/'): raise ValueError('Unexpected image: '+str(image))
        digest=lambda s: hashlib.sha256(s.encode()).hexdigest()[:20]
        out.append({'id':t['id']+'-'+digest(url),'team':t['id'],'name':row['name'],'group':f['group'],'formation':f['name'],'game':'Madden 27','sourceUrl':url,'imageUrl':image,'image':'data/huddle-art/'+digest(image)+'.jpg'})
    return t['id'],f,out

def main():
    catalog=json.loads(CATALOG.read_text())
    existing={team['id'] for team in catalog['teams']}
    if any(team[0] in existing for team in TEAMS): raise ValueError('An expansion team already exists; refusing to duplicate data')
    traces=json.loads(subprocess.check_output(['node','--input-type=module','-e',
      'import {EDITABLE_TRACES} from "./web/data/madden-editable.js"; console.log(JSON.stringify(EDITABLE_TRACES))'],cwd=ROOT,text=True))
    key=lambda x:(x['game'],x['group'],x['formation'],x['name'],x['imageUrl'])
    reviewed={key(x):x for x in traces.values()}
    counts={}
    for t in traces.values(): counts[(t['group'],t['formation'])]=counts.get((t['group'],t['formation']),0)+1
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        teams=list(pool.map(team_page,TEAMS))
        tasks=[(t,f) for t in teams for f in t['formations'] if counts.get((f['group'],f['name']),0)]
        print('Teams:',len(teams),'formations overlapping reviewed examples:',len(tasks),flush=True)
        results=list(pool.map(formation_page,tasks))
    gathered={t['id']:[] for t in teams}
    for tid,f,plays in results: gathered[tid].extend(plays)
    added=[]; aliases={}
    for t in teams:
        unique={p['id']:p for p in gathered[t['id']]}; plays=list(unique.values())
        plays.sort(key=lambda p:(key(p) not in reviewed,p['group'],p['formation'],p['name']))
        if len(plays)<40: raise ValueError(f'Only {len(plays)} source plays for {t["id"]}')
        plays=plays[:max(40,sum(key(p) in reviewed for p in plays))]
        for p in plays:
            if key(p) in reviewed: aliases[p['id']]=reviewed[key(p)]['id']
        formations=[]
        for f in t['formations']:
            n=sum(p['formation']==f['name'] and p['group']==f['group'] for p in plays)
            if n: formations.append({**f,'playCount':n})
        t['formations']=formations; t['playCount']=len(plays); added.extend(plays)
        print(t['id'],len(plays),'reviewed',sum(p['id'] in aliases for p in plays),flush=True)
    # Existing source art is already materialized; download only genuinely new images.
    images={p['imageUrl']:ROOT/'web'/p['image'] for p in added}
    def save_image(item):
        url,path=item
        if path.exists(): return
        b=get(url)
        if not b.startswith(b'\xff\xd8'): raise ValueError('Image is not JPEG: '+url)
        path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(b)
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool: list(pool.map(save_image,images.items()))
    catalog['teams'].extend(teams); catalog['plays'].extend(added)
    catalog['expansionFetchedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'web/data/madden-team-trace-aliases.js').write_text('export const TEAM_TRACE_ALIASES = '+json.dumps(aliases,ensure_ascii=False,indent=2)+';\n')
    print('Wrote catalog and',len(aliases),'reviewed aliases',flush=True)
if __name__=='__main__': main()
