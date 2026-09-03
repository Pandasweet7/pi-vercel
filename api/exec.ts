// TEMP-DIAG: run an arbitrary command in the Tiger sandbox and return its
// output. Used to iterate on sandbox-image issues (apt/dpkg failures) without
// redeploying. DELETE BEFORE SHIPPING.
import { Sandbox } from '@vercel/sandbox';
import { sandboxNameFor } from '../src/lib/stableId.js';

function safeUrl(u: string): URL {
  try {
    return new URL(u);
  } catch {
    return new URL(u, 'http://vercel.internal');
  }
}

async function handler(req: Request): Promise<Response> {
  const url = safeUrl(req.url);
  const cmd = url.searchParams.get('cmd') || 'echo ok';
  const name = sandboxNameFor('Tiger');

  const env = {
    HOME: '/data/home',
    DEBIAN_FRONTEND: 'noninteractive',
    TERM: 'dumb',
  };

  let output: string;
  try {
    const sb = await Sandbox.getOrCreate({ name, resume: true, timeout: 600000 });
    const r = await sb.runCommand({ cmd: 'bash', args: ['-lc', cmd], env, sudo: url.searchParams.get('s') === '1' });
    const out = (await r.stdout()).slice(-8000);
    const err = (await r.stderr()).slice(-8000);
    output = `exit=${r.exitCode}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`;
  } catch (e) {
    output = `SDK_ERR: ${String((e as Error)?.message ?? e)}`;
  }
  return new Response(output, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export const GET = handler;
export const POST = handler;
