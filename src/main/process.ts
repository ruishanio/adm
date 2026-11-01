import { spawn } from 'node:child_process';
export interface RunOptions {
  signal?: AbortSignal;
  timeout?: number;
  input?: string;
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type Runner = (executable: string, args: string[], options?: RunOptions) => Promise<ProcessResult>;
/** 使用参数数组启动 ADB；取消或超时只终止本次客户端，不影响 ADB 服务及其他设备。 */
export const runProcess: Runner = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted)
      return reject(new Error('已停止等待；设备上的操作可能继续，请刷新核对结果。'));
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: 'pipe' });
    const chunks: Buffer[] = [],
      errors: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      child.kill('SIGKILL');
    };
    const cancel = () => stop('已停止等待；设备上的操作可能继续，请刷新核对结果。');
    const timer = setTimeout(
      () => stop('操作超时；设备端可能仍在处理，请刷新核对结果。'),
      options.timeout ?? 20000,
    );
    options.signal?.addEventListener('abort', cancel, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    };
    const collect = (list: Buffer[]) => (data: Buffer) => {
      size += data.length;
      if (size > 16 * 1024 * 1024) stop('设备输出过大，请缩小操作范围。');
      else list.push(data);
    };
    child.stdout.on('data', collect(chunks));
    child.stderr.on('data', collect(errors));
    child.stdin.on('error', () => {
      /* 配对进程提前结束时不让 EPIPE 终止应用。 */
    });
    child.on('error', (error) => {
      cleanup();
      reject(new Error(`无法启动 ADB：${error.message}`));
    });
    child.on('close', (code) => {
      cleanup();
      if (failure) reject(failure);
      else
        resolve({
          stdout: Buffer.concat(chunks).toString('utf8'),
          stderr: Buffer.concat(errors).toString('utf8'),
          code: code ?? -1,
        });
    });
    child.stdin.end(options.input ? options.input + '\n' : undefined);
  });
