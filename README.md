baseKoaServer,  基本用于测试, 只有很简单的功能: 
  1.基本的文件访问, 
  2.range请求(requestHeader包含'range'), 
  3.跨域请求(allow all origin)

koaServer,  比baseKoaServer多了缓存, 以及很多基于缓存的改动
