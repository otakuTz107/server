const Koa=require('koa'), fs=require('fs'), util=require('util'), crypto=require('crypto'), http=require('http');
const mimeObj=require('./ContentType.js'), session=require('./modules/koaSession.js');

/* 自定义ctx的属性: ctx._bodyContent, ctx._url, ctx._query, ctx._suffix, ctx._end, ctx._deleteMe, ctx._range*/
/* 1.ctx._deleteMe,  值为 true 时(在 .my 文件里), 会不缓存 该require模块 ) 
   2.ctx._bodyContent,  调用 ctx.body=*ReadableStream* 时, 如果这是 content-type 头没设置, koa会自动设为 'application/octet-stream';  而用 ctx._bodyContent 代替 ctx.body 就不会自动设置响应头
*/
/* 不稳定的属性: ctx._hash, ctx._fileInfo, */
const conf={
  logDir: './log',
  /* ENOENT, createReadStream()打开不存在文件;  ECONNRESET, 主要是<video>发送range request, 但是没完全接收数据就中断请求;
     ECANCELED, 操作被取消  */
  logExcludeErrCode:['ENOENT','ECONNRESET','ECANCELED'],
}
/*不存在 logDir 目录则创建*/
fs.mkdir(conf.logDir,{recursive:true},err=>console.log('创建log目录:',err));

const koa=new Koa();
/* koa-session的signed选项用的keys */
koa.keys=crypto.randomBytes(16).toString('hex');

process.on('uncaughtException', (reason,errName)=>_log(reason))
process.on('unhandledRejection', (reason,promise)=>_log(reason))
koa.on('error',err=>_log(err));
koa.silent=true;

/* 设置server */
const server=http.createServer({maxHeaderSize:16384},koa.callback()).listen(4444)
server.headersTimeout=60000;
server.requestTimeout=0;
server.setTimeout=120000;
server.keepAliveTimeout=5000;
server.maxHeadersCount=2000;

koa.use(async (ctx,next)=>{
  _log=_log.bind(ctx); 
  try{await next();}catch(err){ _log(err) }
  ctx.set('connection','close'); /*关闭默认的keep-alive*/
  if(ctx._end)return; /* ctx._end为true, 意味着ctx.status为 304 / 301 这类 */
  
  if(!ctx.has('content-type'))ctx.set('content-type',getMIME(ctx._suffix));
  if(ctx._bodyContent)ctx.body=ctx._bodyContent;
})
.use(async (ctx,next)=>{
  /* 缓存 */
  await next(); if(ctx._end)return; 
  if(ctx._suffix=='html' || ctx.has('cache-control') || ctx.has('set-cookie') || ctx._deleteMe ){ ctx.set('cache-control','no-store'); return }
  if(!ctx._hash){
    let {mtime,size,mtimeMs,ctimeMs}=ctx._fileInfo??fs.statSync(ctx._url);  ctx._hash=getHash({size,mtimeMs,ctimeMs});  ctx._fileInfo={mtime};
  }
  mtime=ctx._fileInfo.mtime.toISOString();
  if(ctx.headers['if-none-match']===ctx._hash || ctx.headers['if-modified-since']===mtime){ ctx.status=304; ctx._end=true; }
  else{ ctx.set('last-modified',mtime); ctx.set('etag',ctx._hash) }
})
.use(session(koa))
.use(async (ctx,next)=>{
  /* 主页 */
  if(ctx.url=='/' || ctx.url=='/index.html'){ctx._bodyContent=fs.createReadStream('./index.html'); ctx.set('cache-control','no-store')} /* 由于该ReadStream时pipe(res), 所以res触发'close'时, 该ReadStream也会close */
  else{
    await next();  if(ctx._end)return;
    /* .my后缀的模块 */
    if(ctx._suffix=='my'){ /* 有另一种写法, 在baseKoaServer.js, 无论require.cache[id]是否为undefined, 都会生成hash(但是代码少一点) */
      let id=require.resolve(ctx._url);
      if(require.cache[id]){
        let {size,mtimeMs,ctimeMs,mtime}=ctx._fileInfo??fs.statSync(ctx._url); /* 如果请求头存在 range 头, 在解析range */
        ctx._hash=getHash({size,mtimeMs,ctimeMs}); ctx._fileInfo={mtime};
        if(require.cache[id]._hash!==ctx._hash){
          deleteRequireCache(ctx._url); await require(ctx._url)(ctx); ctx._deleteMe? deleteRequireCache(ctx._url) : require.cache[id]._hash=ctx._hash;
        }else{
          await require(ctx._url)(ctx) /* async 函数的返回值会被封装成Promise */
        }
      }else{
        await require(ctx._url)(ctx);
        if(ctx._deleteMe)deleteRequireCache(ctx._url)
        else{
          let {size,mtimeMs,ctimeMs,mtime}=ctx._fileInfo??fs.statSync(ctx._url); ctx._fileInfo={mtime};
          ctx._hash=getHash({size,mtimeMs,ctimeMs}); require.cache[id]._hash=ctx._hash;
        }
      }
    }
    /* 普通文件 */
    else{ctx._bodyContent=fs.createReadStream(ctx._url,{start:ctx._range.start,end:ctx._range.end}); ctx.set('content-type','text/html')}
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
  if(ctx._suffix){ ctx._suffix=ctx._suffix[0] }
  else{
    if(/\/$/.test(ctx._url)){ctx._url+='index.html';ctx._suffix='html'}
    /* localhost/test 会跳转到 localhost/test/, 这样浏览器当前访问的就是test目录了, 而不是根目录 */
    else{ ctx.status=ctx.method.toUpperCase()=='GET'?301:308; ctx.set('Location',ctx._url+'/'); ctx._end=true; return}
  }
  next()
})
.use((ctx,next)=>{
  /* 支持Range */
  next()
  if(ctx.headers.range){
    let {size,mtime,mtimeMs,ctimeMs}=fs.statSync(ctx._url), arr=/bytes\s*=\s*(\d+)\s*-\s*(\d*)/.exec(ctx.headers.range);
    ctx._fileInfo={size,mtime,mtimeMs,ctimeMs};
    arr[1]=parseInt(arr[1]); 
    arr[2]= arr[2] ? parseInt(arr[2]) : size-1 ;
    let m=arr[2]-arr[1];
    if(m>0){
      ctx._range={start:arr[1], end:arr[2]}
      ctx.status=206; ctx.set('content-range',`bytes ${arr[1]}-${arr[2]}/${size}`); 
      ctx.set('accept-ranges','bytes'); ctx.set('content-length',m<size?m+1:size);
      return;
    }
  }
  ctx._range={start:0, end:Infinity};
})


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
function getHash(obj){ return crypto.createHash('md5').update(`${obj.size}${obj.mtimeMs}${obj.ctimeMs}`).digest('base64'); }
function getMIME(str){
  let mime=mimeObj[str];
  return mime?mime:"text/html;charset=utf-8"
}
function _log(err){
  /* 由于 _log=_log.bind(ctx), 所以this指向ctx */
  if(conf.logExcludeErrCode.indexOf(err.code)>-1)return;
  let date=new Date(); 
  let name=`${date.getFullYear()}-${(date.getMonth()+1)}-${date.getDate()}`; 
  fs.appendFileSync(`${conf.logDir}/${name}.txt`,`${date.toLocaleString()}\nurl: ${this?.url},  ip: ${this?.socket?.remoteAddress}\n${err.stack}\n\n`)
}
