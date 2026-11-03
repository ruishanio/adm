/** 原生二进制包与 WebCodecs 的边界；只保留实时帧，拥堵后等待关键帧重新同步。 */
export function parseVideoPacket(buffer: ArrayBuffer) {
  if (buffer.byteLength < 32) throw new Error('视频包不完整。');
  const view = new DataView(buffer);
  const width = view.getUint32(16),
    height = view.getUint32(20),
    configSize = view.getUint32(28);
  if (!width || !height || width > 8192 || height > 8192 || configSize > buffer.byteLength - 32)
    throw new Error('视频包尺寸无效。');
  return {
    sequence: Number(view.getBigUint64(0)),
    timestamp: Number(view.getBigUint64(8)),
    width,
    height,
    key: view.getUint32(24) === 1,
    config: new Uint8Array(buffer, 32, configSize),
    data: new Uint8Array(buffer, 32),
  };
}
export function h264Codec(data: Uint8Array) {
  for (let i = 0; i + 7 <= data.length; i++) {
    const prefix =
      data[i] === 0 && data[i + 1] === 0
        ? data[i + 2] === 1
          ? 3
          : data[i + 2] === 0 && data[i + 3] === 1
            ? 4
            : 0
        : 0;
    if (prefix && (data[i + prefix]! & 31) === 7)
      return (
        'avc1.' +
        [...data.slice(i + prefix + 1, i + prefix + 4)].map((v) => v.toString(16).padStart(2, '0')).join('')
      );
  }
  throw new Error('视频配置中缺少 H.264 参数。');
}
export function createDecoder(
  canvas: () => HTMLCanvasElement | undefined,
  onFrame: (width: number, height: number) => void,
  onError: (error: string) => void,
) {
  let decoder: VideoDecoder | undefined,
    signature = '',
    waiting = true,
    disposed = false;
  function reset() {
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = undefined;
    signature = '';
    waiting = true;
  }
  function receive(buffer: ArrayBuffer) {
    const packet = parseVideoPacket(buffer);
    if (disposed) return packet.sequence;
    if ((decoder?.decodeQueueSize ?? 0) > 3) {
      reset();
      return packet.sequence;
    }
    if (waiting && !packet.key) return packet.sequence;
    try {
      if (packet.key && packet.config.length) {
        const codec = h264Codec(packet.config),
          next = `${codec}:${packet.width}:${packet.height}`;
        if (signature !== next) {
          reset();
          decoder = new VideoDecoder({
            output(frame) {
              try {
                const element = canvas();
                if (!disposed && element) {
                  if (element.width !== frame.displayWidth || element.height !== frame.displayHeight) {
                    element.width = frame.displayWidth;
                    element.height = frame.displayHeight;
                  }
                  element.getContext('2d', { alpha: false })?.drawImage(frame, 0, 0);
                  onFrame(frame.displayWidth, frame.displayHeight);
                }
              } finally {
                frame.close();
              }
            },
            error(error) {
              if (!disposed) {
                reset();
                onError(error.message);
              }
            },
          });
          decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' });
          signature = next;
        }
        waiting = false;
      }
      decoder?.decode(
        new EncodedVideoChunk({
          type: packet.key ? 'key' : 'delta',
          timestamp: packet.timestamp,
          data: packet.data,
        }),
      );
    } catch (error) {
      reset();
      onError(error instanceof Error ? error.message : String(error));
    }
    return packet.sequence;
  }
  return {
    receive,
    dispose() {
      disposed = true;
      reset();
    },
  };
}
