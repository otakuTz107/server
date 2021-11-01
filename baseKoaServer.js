process.on('uncaughtException', (reason,errName)=>console.log('processException '+reason))
process.on('unhandledRejection', (reason,promise)=>console.log('processRejection '+reason))

const Koa=require('koa'), fs=require('fs'), crypto=require('crypto');
const mimeObj=require('./ContentType.js');
/* ctx._bodyContent, ctx._url, ctx._query, ctx._suffix, ctx._end, ctx._range */

const koa=new Koa(); koa.on('error',err=>console.log('koaErr',err)); /* 会捕获fs.createReadStream()的文件不存在的错误 */

koa.use(async (ctx,next)=>{
  try{await next(); }catch(err){ console.log('catch err',err); }
  ctx.set('connection','close')
  if(ctx._end)return; /* ctx._end为true, 意味着ctx.status为301/304这类 */
  
  if(!ctx.has('content-type'))ctx.set('content-type',getMIME(ctx._suffix))
  if(ctx._bodyContent)ctx.body=ctx._bodyContent;
  else{ ctx.body='null'; }
})
.use(async (ctx,next)=>{
  /* 主页 */
  if(ctx.url=='/' || ctx.url=='/index.html')ctx._bodyContent=fs.createReadStream('./index.html'); /* 由于该ReadStream时pipe(res), 所以res触发'close'时, 该ReadStream也会close */
  else{
    await next(); if(ctx._end)return;
    /* .my后缀的模块 */
    if(/\.my$/.test(ctx._url)){
      let {size,mtimeMs,ctimeMs}=ctx._fileInfo??fs.statSync(ctx._url), id=require.resolve(ctx._url);
      ctx._hash=crypto.createHash('md5').update(`${size}${mtimeMs}${ctimeMs}`).digest('base64');
      if(require.cache[id]?._hash && require.cache[id]._hash!==ctx._hash)deleteRequireCache(ctx._url); 
      await require(ctx._url)(ctx);
      ctx._deleteMy? deleteRequireCache(ctx._url) : require.cache[id]._hash=ctx._hash;
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
  /* 重定向用url(未处理) */
  ctx._ReUrl='.'+arr[0]
  /* fs用的url(已处理) */
  ctx._url='.'+arr[0];
  /* url的query(get) */
  ctx._query=arr[1]
  /* url的后缀: ctx._suffix */
  ctx._suffix=/(?<=\.)[^.]+$/.exec(arr[0]);
  if(ctx._suffix){ctx._suffix=ctx._suffix[0]}
  else{
    if(/\/$/.test(ctx._url)){ctx._url+='index.html';}
    /* localhost/test 会跳转到 localhost/test/, 这样浏览器当前访问的就是test目录了, 而不是根目录 */
    else{ ctx.redirect(ctx._ReUrl+'/'); ctx._end=true; return}
  }
  next()
})
.use((ctx,next)=>{
  /* 支持Range */
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
  for(let module of require.cache[url].children)deleteRequireCache(module.id,true);
  delete require.cache[url]
}
function getMIME(str){
  let mime=mimeObj[str];
  return mime?mime:"text/html;charset=utf-8"
}
