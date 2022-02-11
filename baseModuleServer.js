const Koa=require('koa'), crypto=require('crypto'), qs=require('querystring'), fs=require('fs');
const mimeObj={
/*文本*/
  "js": "text/javascript; charset=UTF-8",
  "css": "text/css; charset=UTF-8",
  "txt": "text/plain; charset=UTF-8",
  "html": "text/html; charset=UTF-8",
  "xml": "text/xml",
  
  "json": "application/json",
/*video*/
  "mp4": "video/mp4",
/*audio*/
  "mp3": "audio/mpeg",
/*image*/
  "ico": "image/x-icon",
  "png": "image/png",
  "jpg": "image/jpeg",
  "gif": "image/gif",
  "webp": "image/webp",
}, conf={
  logDir: './log',
  /* ENOENT, createReadStream()打开不存在文件;  ECONNRESET, 主要是<video>发送range request, 但是没完全接收数据就中断请求;
     ECANCELED, 操作被取消  */
  logExcludeErrCode:['ENOENT','ECONNRESET','ECANCELED'],
}
/*不存在 logDir 目录则创建*/
fs.mkdir(conf.logDir,{recursive:true},err=>console.log('创建log目录:',err));;

const koa=new Koa();
/* ctx._bodyContent, ctx._url, ctx._query, ctx._suffix, ctx._post, ctx._end, ctx._deleteMe */

/* 手动抛出Err时, 用 throw new ManualErr(str) */
class ManualErr extends Error{ constructor(str){super(str); this.name=this.constructor.name;} }
koa.on('error',err=>_log(err)); /* 会捕获fs.createReadStream()的文件不存在的错误 */
process.on('uncaughtException', (reason,errName)=>_log(reason))
process.on('unhandledRejection', (reason,promise)=>_log(reason))
/*koa.silent=true;*/

koa.use(async (ctx,next)=>{
  _log=_log.bind(ctx);
  try{await next(); }catch(err){ _log(err); }
  ctx.set('connection','close')
  if(ctx._end)return; /* ctx._end为true, 意味着ctx.status为301/304这类 */
  
  if(!ctx.has('content-type'))ctx.set('content-type',getMIME(ctx._suffix))
  if(ctx._bodyContent)ctx.body=ctx._bodyContent;
})
.use(async (ctx,next)=>{
  await next(); if(ctx._end)return;
  /* .my后缀的模块 */
  if(ctx._suffix=='my'){ /* 有另一种写法, 在koaServer.js, 只是优化了require.cache[id]=undefined的情况, 但是添加了不少代码 */
    let {size,mtimeMs,ctimeMs}=fs.statSync(ctx._url), id=require.resolve(ctx._url);
    ctx._hash=crypto.createHash('md5').update(`${size}${mtimeMs}${ctimeMs}`).digest('base64');
    if(require.cache[id]?._hash && require.cache[id]._hash!==ctx._hash)deleteRequireCache(ctx._url); 
    await require(ctx._url)(ctx);
    ctx._deleteMe? deleteRequireCache(ctx._url) : require.cache[id]._hash=ctx._hash;
  }
})
.use(async (ctx,next)=>{
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
  await next();
})
.listen(4444)


function getMIME(str){
  let mime=mimeObj[str];
  return mime?mime:"text/html;charset=utf-8"
}
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
function _log(err){
  /* 由于 _log=_log.bind(ctx), 所以this指向ctx */
  if(conf.logExcludeErrCode.indexOf(err.code)>-1)return;
  let date=new Date(); 
  let name=`${date.getFullYear()}-${(date.getMonth()+1)}-${date.getDate()}`; 
  fs.appendFileSync(`${conf.logDir}/${name}.txt`,`${date.toLocaleString()}\nurl: ${this?.url},  ip: ${this?.socket?.remoteAddress}\n${err.stack}\n\n`)
}


