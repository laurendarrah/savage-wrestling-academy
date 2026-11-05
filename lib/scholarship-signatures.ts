export const electronicConsent='I consent to use an electronic signature for this agreement and intend my drawn signature to record my acceptance. I can save or print a copy of the signed agreement.';
export type Point=[number,number];
export type Signature={method:'typed'}|{method:'drawn';strokes:Point[][]};
export type SignatureRecord=Signature&{version:1;termsRevision:number;termsSha256:string;signedAt:string;signer:string;accountEmail:string;consent:string};
export function cleanSignature(value:unknown):Signature|null{
 if(!value||typeof value!=='object')return null;
 const v=value as {method?:unknown;strokes?:unknown};
 if(v.method==='typed')return {method:'typed'};
 if(v.method!=='drawn'||!Array.isArray(v.strokes)||v.strokes.length<1||v.strokes.length>100)return null;
 const strokes:Point[][]=[];
 let count=0,moved=false;
 for(const stroke of v.strokes){
  if(!Array.isArray(stroke)||stroke.length<2)return null;
  count+=stroke.length;if(count>2000)return null;
  const points:Point[]=[];
  for(const point of stroke){
   if(!Array.isArray(point)||point.length!==2||point.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))return null;
   points.push([point[0],point[1]]);
  }
  if(points.some(p=>Math.hypot(p[0]-points[0][0],p[1]-points[0][1])>.015))moved=true;
  strokes.push(points);
 }
 return moved?{method:'drawn',strokes}:null;
}
