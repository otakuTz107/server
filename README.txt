baseKoaServer,  基本用于测试, 只有很简单的功能: 
  1.功能性脚本为 .my 后缀, eg: test.my文件: module.exports=function(ctx){ ctx._bodyContent='hellow' };   对应url: http://127.0.0.1/test.my
  2.range请求(requestHeader包含'range'), 
  3.跨域请求(allow all origin)

koaServer,  比baseKoaServer多了缓存 & session, 以及很多基于缓存的改动
  --不缓存规则(主动响应 'cache-control: no-store' ):
      1.后缀(ctx_suffix)为'html'
      2.已设置 'cache-control / set-cookie' 字段
      3.ctx._deleteMe为true


新加的ctx属性:
  #ctx._bodyContent,  相当于ctx.body;  区别是: 直接用 ctx.body=fs.createReadStream(...) 的话, ctx会自动设置 'content-type':'application/octet-stream' 
  
  #ctx._url = req.url.split('?')[0], 
  #ctx._query = req.url.split('?')[1], 
  #ctx._suffix = String,  ctx._url的文件后缀(默认'html')
  
  #ctx._end = Boolean,  Server响应 301/304 这类时, 设 _end 为true可以减少代码流程
  #ctx._deleteMe = Boolean,  在 .my 脚本里, 设 _deleteMe 为true的话, 会在执行完该脚本后, 移除该脚本的require缓存, 同时也会移除该脚本所引用的module缓存(非内置)
  #ctx._range = {start: Int, end: Int},  对应请求头的Range字段, 默认 start:0, end:Infinity;
  
(可忽略)
  #ctx._fileInfo = {size,mtime,mtimeMs,ctimeMs},  对应 fs.statSync(ctx._url) ;  size,mtimeMs,ctimeMs 用于 etag 字段的值;  mtime 用于 last-modified 字段的值
  #ctx._hash = crypto.createHash('md5').update(`${size}${mtimeMs}${ctimeMs}`).digest('base64')
