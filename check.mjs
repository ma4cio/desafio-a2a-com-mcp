import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const env={...process.env,REQUEST_STATE_SECRET:randomBytes(32).toString('hex')};
const children=['servidor-mcp/server.mjs','agente/server.mjs'].map(f=>spawn(process.execPath,[f],{env,stdio:['ignore','inherit','inherit'],windowsHide:true}));
await new Promise(r=>setTimeout(r,2000));
const p=spawn(process.env.PYTHON || 'python',['-u','validador/validar.py','--agente','http://127.0.0.1:7300','--mcp','http://127.0.0.1:7301'],{stdio:'inherit',windowsHide:true});
p.on('error',e=>{console.error(e.message);children.forEach(c=>c.kill());process.exitCode=1;});
p.on('exit',code=>{children.forEach(c=>c.kill());process.exitCode=code ?? 1;});
