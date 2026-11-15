import { spawn } from 'node:child_process';

// A development-only read-only scan. No skill installation or runtime dependency.
// Pin the tool so audit results are reviewable; updating it is deliberate.
const child=spawn(process.platform==='win32'?'npx.cmd':'npx',
  ['--yes','modern-web-guidance@1.0.0','legacy-scan','web','--json'],
  {stdio:'inherit',env:{...process.env,DISABLE_TELEMETRY:'1'}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code ?? 1;});
