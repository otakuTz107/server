const Koa=require('koa'), fs=require('fs'), crypto=require('crypto');
const mimeObj={
//文本
  "js": "text/javascript; charset=UTF-8",
  "css": "text/css; charset=UTF-8",
  "txt": "text/plain; charset=UTF-8",
  "html": "text/html; charset=UTF-8",
  "xml": "text/xml",
  
  "json": "application/json",
//video
  "mp4": "video/mp4",
//audio
  "mp3": "audio/mpeg",
//image
  "ico": "image/x-icon",
  "png": "image/png",
  "jpg": "image/jpeg",
  "gif": "image/gif",
  "webp": "image/webp",
}
const koa=new Koa();
/* ctx._bodyContent, ctx._url, ctx._query, ctx._suffix, ctx._end, ctx._range, ctx._deleteMe */

koa.on('error',err=>console.log('koaErr',err)); /* 会捕获fs.createReadStream()的文件不存在的错误 */
process.on('uncaughtException', (reason,errName)=>console.log('uncaughtException '+reason))
process.on('unhandledRejection', (reason,promise)=>console.log('unhandledRejection '+reason))
/*koa.silent=true;*/

koa.use(async (ctx,next)=>{
  try{await next(); }catch(err){ console.log('catch err',err); }
  ctx.set('connection','close')
  if(ctx._end)return; /* ctx._end为true, 意味着ctx.status为301/304这类 */
  
  if(!ctx.has('content-type'))ctx.set('content-type',getMIME(ctx._suffix))
  if(ctx._bodyContent)ctx.body=ctx._bodyContent;
})
.use(async (ctx,next)=>{
  /* 主页 */
  if(ctx.url=='/' || ctx.url=='/index.html')ctx._bodyContent=fs.createReadStream('./index.html'); /* 由于该ReadStream时pipe(res), 所以res触发'close'时, 该ReadStream也会close */
  else{
    await next(); if(ctx._end)return;
    /* .my后缀的模块 */
    if(ctx._suffix=='my'){ /* 有另一种写法, 在koaServer.js, 只是优化了require.cache[id]=undefined的情况, 但是添加了不少代码 */
      let {size,mtimeMs,ctimeMs}=ctx._fileInfo??fs.statSync(ctx._url), id=require.resolve(ctx._url);
      ctx._hash=crypto.createHash('md5').update(`${size}${mtimeMs}${ctimeMs}`).digest('base64');
      if(require.cache[id]?._hash && require.cache[id]._hash!==ctx._hash)deleteRequireCache(ctx._url); 
      await require(ctx._url)(ctx);
      ctx._deleteMe? deleteRequireCache(ctx._url) : require.cache[id]._hash=ctx._hash;
    }
    /* 普通文件 */
    else{ ctx._bodyContent=fs.createReadStream(ctx._url,{start:ctx._range.start,end:ctx._range.end}); }
  }
})
.use((ctx,next)=>{
  /* CORS 跨域请求 */
  if(ctx.method.toUpperCase()=='OPTIONS'){
    ctx.headers['access-control-request-method']? ctx.set('access-control-allow-methods',ctx.headers['access-control-request-method']) : '';
    ctx.headers['access-control-request-headers']? ctx.set('access-control-allow-headers',ctx.headers['access-control-request-headers']) : '';
    if(ctx.headers.origin){ ctx.set('access-control-max-age',86400); ctx.set('access-control-allow-origin',ctx.headers.origin); }
    ctx._end=true; return;
  }
  if(ctx.headers.origin){
    ctx.set('access-control-allow-credentials',true);
    ctx.set('access-control-allow-origin',ctx.headers.origin)
  }
  next()
})
.use((ctx,next)=>{
  let arr=ctx.url.split('?'); 
  ctx._url='.'+arr[0];
  /* url的query(get) */
  ctx._query=arr[1]
  /* url的后缀: ctx._suffix */
  ctx._suffix=/(?<=\.)[^.]+$/.exec(arr[0]);
  if(ctx._suffix){ctx._suffix=ctx._suffix[0]}
  else{
    if(/\/$/.test(ctx._url)){ctx._url+='index.html';ctx._suffix='html'}
    /* localhost/test 会跳转到 localhost/test/, 这样浏览器当前访问的就是test目录了, 而不是根目录 */
    else{ ctx.redirect(ctx._url+'/'); ctx._end=true; return}
  }
  next()
})
.use((ctx,next)=>{
  /* 支持Range;  ctx._range */
  next()
  if(ctx.headers.range){
    let total=fs.statSync(ctx._url).size, arr=/bytes\s*=\s*(\d+)\s*-\s*(\d*)/.exec(ctx.headers.range);
    arr[1]=parseInt(arr[1]); 
    arr[2]= arr[2] ? parseInt(arr[2]) : total-1 ;
    let m=arr[2]-arr[1];
    if(m>0){
      ctx._range={start:arr[1], end:arr[2]}
      ctx.status=206; ctx.set('content-range',`bytes ${arr[1]}-${arr[2]}/${total}`); 
      ctx.set('accept-ranges','bytes'); ctx.set('content-length',m<total?m+1:total);
      return;
    }
  }
  ctx._range={start:0, end:Infinity};
})
.listen(4444)


function deleteRequireCache(url,i){
  url=require.resolve(url);
  if(!i){
    let arr=require.cache[require.resolve(__filename)].children;
    arr.splice(arr.indexOf(require.cache[url]),1);
  }
  if(require.cache[url]){  //有时候 多个require.cache[url] 的children会包含同一个module, 所以要判断是否重复删除
    for(let module of require.cache[url].children)deleteRequireCache(module.id,true);
    delete require.cache[url]
  }
}
function getMIME(str){
  let mime=mimeObj[str];
  return mime?mime:"text/html;charset=utf-8"
}
