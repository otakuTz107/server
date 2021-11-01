let qs=require('querystring');
module.exports=async function(ctx){
  await new Promise((f,r)=>{
    let data='';
    ctx.req.setEncoding('utf8')
    ctx.req.on('data',o=>data+=o);
    ctx.req.on('end',()=>{
      ctx._queryObj={ ...qs.parse(ctx._query), ...qs.parse(data) }

      ctx._bodyContent=`from done:<p>${JSON.stringify(ctx._queryObj)}</p>`; 
      f()
    })
  });
}