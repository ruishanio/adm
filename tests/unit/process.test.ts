import { expect, it } from 'vitest';
import { runProcess } from '../../src/main/process';
it('本地参数不经过 shell 展开', async () => {
  const value = "hello;$(touch /tmp/never-run) '$HOME'";
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]);
  expect(result.stdout).toBe(value);
  expect(result.code).toBe(0);
});
it('取消只终止当前子进程并说明结果未知', async () => {
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    signal: controller.signal,
  });
  controller.abort();
  await expect(promise).rejects.toThrow('设备上的操作可能继续');
  expect((await runProcess(process.execPath, ['-e', 'console.log("ok")'])).stdout).toContain('ok');
});
it('超时与输出上限终止等待', async () => {
  await expect(
    runProcess(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { timeout: 25 }),
  ).rejects.toThrow('超时');
  await expect(
    runProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(17*1024*1024))']),
  ).rejects.toThrow('输出过大');
});
