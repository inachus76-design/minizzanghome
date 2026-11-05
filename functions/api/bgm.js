const KEY='background-music';
const MAX=20*1024*1024;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(request,secret){
  const provided=request.headers.get('Authorization')||'';
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([hash(provided),hash('Bearer '+secret)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function onRequest({request,env}){
  if(!env.MUSIC_STORE)return json({error:'음악 저장소 연결을 준비 중이에요.'},503);
  try{
    if(request.method==='PUT'){
      if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<16)return json({error:'관리자 비밀번호 설정을 준비 중이에요.'},503);
      if(!await authorized(request,env.ADMIN_PASSWORD))return json({error:'관리자 비밀번호를 확인해 주세요.'},401);
      const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'허용되지 않은 요청이에요.'},403);
      if(Number(request.headers.get('Content-Length'))>MAX)return json({error:'20MB 이하의 파일을 선택해 주세요.'},413);
      const mime=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
      const types=new Set(['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/wave','audio/ogg','application/ogg','audio/flac','audio/x-flac','audio/webm','application/octet-stream']);
      if(!types.has(mime))return json({error:'지원하는 음악 파일을 선택해 주세요.'},415);
      // Read with a hard bound even when Content-Length is missing or incorrect.
      const reader=request.body?.getReader();if(!reader)return json({error:'음악 파일이 없어요.'},400);
      let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX){await reader.cancel();return json({error:'20MB 이하의 파일을 선택해 주세요.'},413);}chunks.push(value);}
      if(!size)return json({error:'비어 있는 파일은 저장할 수 없어요.'},400);
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      let title;try{title=decodeURIComponent(request.headers.get('X-Track-Title')||'').trim().slice(0,80);}catch{return json({error:'곡 이름을 확인해 주세요.'},400);}
      if(!title)return json({error:'곡 이름을 입력해 주세요.'},400);
      const version=crypto.randomUUID();await env.MUSIC_STORE.put(KEY,bytes.buffer,{metadata:{title,mime,version,size}});return json({ok:true,version});
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD, PUT'}});
    const {value,metadata}=await env.MUSIC_STORE.getWithMetadata(KEY,{type:'arrayBuffer'});
    if(new URL(request.url).searchParams.has('info'))return json({available:!!value,title:metadata?.title||'',version:metadata?.version||''});
    if(!value)return json({error:'아직 등록된 음악이 없어요.'},404);
    const headers={'Content-Type':metadata?.mime||'audio/mpeg','Cache-Control':'no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
    const range=request.headers.get('Range');let start=0,end=value.byteLength-1,status=200;
    if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${value.byteLength}`}});
      if(!m[1])start=Math.max(0,value.byteLength-Number(m[2]));else start=Number(m[1]);if(m[1]&&m[2])end=Math.min(end,Number(m[2]));
      if(!Number.isSafeInteger(start)||start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${value.byteLength}`}});
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${value.byteLength}`;
    }
    headers['Content-Length']=String(end-start+1);return new Response(request.method==='HEAD'?null:value.slice(start,end+1),{status,headers});
  }catch{return json({error:'저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'},503);}
}
