module.exports=require('koa-session').bind(null,{
  key: 'koa.sess',
	maxAge: 86400000,
	httpOnly: true,
	renew: true,
	rolling: false,
	signed: true,
	secure: false,
	autoCommit: true,
	overWrite: true,
})