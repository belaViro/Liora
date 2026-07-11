(() => {
  const script = document.currentScript;
  const endpoint = script?.dataset?.endpoint || `${location.protocol}//${location.hostname}:3100/api/events`;
  const getId = (key, sessionOnly=false) => { const store=sessionOnly?sessionStorage:localStorage; let value=store.getItem(key); if(!value){value=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;store.setItem(key,value)} return value };
  const visitorId=getId('liora_visitor_id'), sessionId=getId('liora_session_id',true);
  let deviceModel='', modelLoaded=false;
  async function detectModel(){if(modelLoaded)return;modelLoaded=true;try{if(navigator.userAgentData?.getHighEntropyValues){const x=await navigator.userAgentData.getHighEntropyValues(['model']);deviceModel=x.model||''}}catch(_){}}
  async function track(eventName='page_view', options={}){await detectModel();const body={event_name:eventName,category:options.category||'general',visitor_id:visitorId,user_id:window.LIORA_USER_ID||'',session_id:sessionId,path:location.pathname+location.search,language:navigator.language,screen:`${screen.width}x${screen.height}`,device_model:deviceModel,success:options.success,duration_ms:options.duration_ms||0};try{await nativeFetch(endpoint,{method:'POST',mode:'cors',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}catch(_){}}
  const nativeFetch=window.fetch.bind(window);
  function classify(input,init){const url=typeof input==='string'?input:(input?.url||'');if(url.includes('/api/events')||url.includes(':3100/'))return null;if(url.includes('/api/memory/preprocess')||url.includes('/api/compute/understand'))return 'memory_parsed';if(url.includes('/api/compute/embed'))return 'memory_embedding';if(url.includes('/api/luoyi/chat'))return 'luoyi_chat';if(url.includes('/api/graph/explore')){try{const q=JSON.parse(init?.body||'{}').question||'';if(/故事|story/i.test(q))return 'memory_story_generated';if(/路径|path|侦探/i.test(q))return 'relation_path_explored'}catch(_){}return 'ai_call'}return null}
  window.fetch=async function(input,init){const eventName=classify(input,init);if(!eventName)return nativeFetch(input,init);const started=performance.now();try{const response=await nativeFetch(input,init);track(eventName,{category:'ai',success:response.ok,duration_ms:Math.round(performance.now()-started)});return response}catch(error){track(eventName,{category:'ai',success:false,duration_ms:Math.round(performance.now()-started)});throw error}};
  window.lioraAnalytics={track,visitorId};
  track('page_view',{category:'traffic'});
  setInterval(()=>track('heartbeat',{category:'traffic'}),60000);
})();
