import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function buildInfo(cwd: string) {
  const builtAt = new Date().toISOString();
  function gitValue(args: string[]): string {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch (error) {
      console.warn('Build support details: Git metadata is unavailable.', error instanceof Error ? error.message : error);
      return 'Unavailable';
    }
  }
  return {
    number: process.env.GITHUB_RUN_NUMBER
      ? `${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
      : `local-${builtAt}-${randomUUID().slice(0, 8)}`,
    commit: process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']),
    branch: process.env.GITHUB_REF_NAME || gitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
    builtAt,
  };
}
