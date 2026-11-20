import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Generate independently navigable HTML documents. CSS is present during HTML
// parsing on every external/bundled/inline case, matching the actual entry page.
export async function prepareStyleCases(dist,index,driver) {
  const paths=[...index.matchAll(/<link rel="stylesheet" href="\.\/([^"<>]+)">/g)].map(m=>m[1]);
  const shell=index.split('<body>')[1].split('<script')[0];
  // The editor's styles are same-directory resources. An import appearing late
  // in a concatenated stylesheet would be ignored, so resolve imports first.
  async function source(file) {
    let css=await readFile(join(dist,file),'utf8');
    for(const match of [...css.matchAll(/@import\s+['"]\.\/([^'"]+)['"]\s*;/g)]) {
      const prefix=file.includes('/')?file.slice(0,file.lastIndexOf('/')+1):'';
      css=css.replace(match[0],await source(prefix+match[1]));
    }
    return css;
  }
  const allCss=(await Promise.all(paths.map(source))).join('\n');
  await writeFile(join(dist,'film-style-bundled.css'),allCss);
  const empty=await Promise.all(paths.map(async (_,i)=>{
    const file='film-style-empty-'+i+'.css';await writeFile(join(dist,file),'/* empty control */\n');return file;
  }));
  await writeFile(join(dist,'film-style-stage.js'),driver);
  const link=file=>`<link rel="stylesheet" href="./${file}">`;
  const cases={};
  async function add(id,{files=[],mode='external',body=shell,children=[]}={}) {
    const head=mode==='inline'?'<style>'+allCss+'</style>':mode==='external'?files.map(link).join('\n'):'';
    const href='film-style-'+id+'.html';
    await writeFile(join(dist,href),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="film-style-case" content="${id}"><title>Styles · ${id}</title>${head}<body>${body}<script type="module" src="./film-style-stage.js"></script></body></html>`);
    cases[id]={href,mode,files,children};return id;
  }
  async function group(start,end) {
    const id='group-'+start+'-'+end,children=[];
    if(end-start>1) {
      const mid=start+Math.ceil((end-start)/2);
      children.push(await group(start,mid),await group(mid,end));
    }
    return add(id,{files:paths.slice(start,end),children});
  }
  const full=await group(0,paths.length);
  await Promise.all([
    add('blank-a',{body:''}),add('blank-b',{body:''}),add('blank-final',{body:''}),add('shell'),
    add('empty-links',{files:empty}),add('empty-single',{files:empty.slice(0,1)}),
    add('real-network',{files:paths,mode:'fetch'}),add('real-dynamic',{files:paths,mode:'dynamic'}),
    add('real-single',{files:['film-style-bundled.css']}),add('real-inline',{files:paths,mode:'inline'}),
  ]);
  await writeFile(join(dist,'film-style-cases.json'),JSON.stringify({full,cases}));
  await writeFile(join(dist,'film-style.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>独立文档样式测量</title><body><script type="module" src="./film-style-stage.js"></script></body></html>');
}
