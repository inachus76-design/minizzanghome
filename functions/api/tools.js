const KEY='classroom-tools';
const defaults=[{id:'timer',icon:'◷',name:'타이머',description:'준비 중',url:''},{id:'draw',icon:'✿',name:'랜덤 뽑기',description:'준비 중',url:''},{id:'memo',icon:'▤',name:'수업 메모',description:'준비 중',url:''}];
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(request,secret){const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [a,b]=await Promise.all([hash(request.headers.get('Authorization')||''),hash('Bearer '+secret)]);let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
export async function onRequest({request,env}){
  if(!env.MUSIC_STORE)return json({error:'도구 저장소에 연결하지 못했어요.'},503);
  try{
    if(request.method==='GET'){const saved=await env.MUSIC_STORE.get(KEY,{type:'json'});return json(saved||{items:defaults});}
    if(request.method!=='PUT')return new Response(null,{status:405,headers:{Allow:'GET, PUT'}});
    if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<16)return json({error:'관리자 설정을 확인해 주세요.'},503);
    if(!await authorized(request,env.ADMIN_PASSWORD))return json({error:'관리자 비밀번호를 확인해 주세요.'},401);
    const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'허용되지 않은 요청이에요.'},403);
    const reader=request.body?.getReader();if(!reader)return json({error:'저장할 내용을 확인해 주세요.'},400);let size=0,text='';const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return json({error:'도구 목록이 너무 커요.'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
    let data;try{data=JSON.parse(text);}catch{return json({error:'목록 형식이 올바르지 않아요.'},400);}
    if(!Array.isArray(data.items)||data.items.length>30)return json({error:'도구는 최대 30개까지 저장할 수 있어요.'},400);
    const items=[],ids=new Set();
    for(const item of data.items){
      if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{1,60}$/.test(item.id)||ids.has(item.id))return json({error:'도구 식별자를 확인해 주세요.'},400);
      if(typeof item.name!=='string'||!item.name.trim()||item.name.length>40||typeof item.description!=='string'||item.description.length>120||typeof item.icon!=='string'||!item.icon.trim()||item.icon.length>12||typeof item.url!=='string'||item.url.length>2000)return json({error:'도구 이름, 아이콘, 설명을 확인해 주세요.'},400);
      const url=item.url.trim();if(url){try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw 0;}catch{return json({error:'링크는 https:// 또는 http://로 시작하는 주소를 입력해 주세요.'},400);}}
      ids.add(item.id);items.push({id:item.id,name:item.name.trim(),icon:item.icon.trim(),description:item.description.trim(),url});
    }
    const previous=await env.MUSIC_STORE.get(KEY);if(previous)await env.MUSIC_STORE.put(KEY+'-previous',previous);
    const saved={items,version:crypto.randomUUID()};await env.MUSIC_STORE.put(KEY,JSON.stringify(saved));return json({ok:true,...saved});
  }catch{return json({error:'저장하지 못했어요. 잠시 후 다시 시도해 주세요.'},503);}
}
