const SVG_NS='http://www.w3.org/2000/svg';
export const DIGITAL_EXPORT_MATRIX={a:.86,b:0,c:-.1204,d:.7396,e:118,f:78};

// Bake the on-screen affine tabletop view into the standalone PNG source. All
// field layers share one transform, including the captured WebGL chip image.
export function projectDigitalExport(root,{material=false}={}) {
  const doc=root.ownerDocument;
  const make=(tag,attributes)=>{
    const node=doc.createElementNS(SVG_NS,tag);
    for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));
    return node;
  };
  const transform=Object.values(DIGITAL_EXPORT_MATRIX).join(' ');
  const plane=make('g',{'data-digital-projection':'','transform':`matrix(${transform})`});
  for(const node of [...root.children])if(node.tagName.toLowerCase()!=='defs')plane.append(node);
  const background=make('rect',{width:1000,height:800,fill:'#14101c'});
  const shadow=make('rect',{x:0,y:22,width:1000,height:800,rx:24,fill:'#08060c',opacity:.6,transform:`matrix(${transform})`});
  const edge=make('rect',{x:0,y:12,width:1000,height:800,rx:20,fill:'#332a43',stroke:'#73617f','stroke-width':1,transform:`matrix(${transform})`});
  const lowerEdge=make('rect',{x:0,y:16,width:1000,height:800,rx:20,fill:'#211a2c',transform:`matrix(${transform})`});
  root.append(background,shadow,lowerEdge,edge,plane);
  if(material)for(const label of plane.querySelectorAll('.player-label'))label.setAttribute('transform','translate(0 -3.7)');
  return root;
}
