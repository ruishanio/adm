package com.genymobile.scrcpy.video;

import android.graphics.PixelFormat;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import com.genymobile.scrcpy.device.Streamer;
import com.genymobile.scrcpy.model.ConfigurationException;
import com.genymobile.scrcpy.model.Size;
import com.genymobile.scrcpy.util.Ln;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** ADM 的进程内 H.264 编码器。仅系统编码器故障后接管同一条视频流。 */
public final class CompatibilityEncoder {
    private static boolean available;

    private CompatibilityEncoder() {
    }

    public static void loadIfSupported(String jar) {
        if (Build.VERSION.SDK_INT < 23 || !"x86_64".equals(System.getProperty("os.arch"))) {
            return;
        }
        try {
            System.load(jar + "!/lib/x86_64/libadmopenh264.so");
            available = true;
        } catch (UnsatisfiedLinkError error) {
            Ln.w("ADM compatibility encoder unavailable", error);
        }
    }

    static boolean isAvailable() {
        return available;
    }

    static VideoConstraints constraints(int size) {
        return new VideoConstraints(size > 0 ? Math.min(size, 1280) : 1280, 2, null);
    }

    /** 按已协商尺寸重新准备采集；旋转、录像请求关键帧和退出均沿用 scrcpy 的重置机制。 */
    static void stream(SurfaceCapture capture, CaptureControl control, Streamer streamer, int requestedSize, float requestedFps,
            AtomicBoolean stopped) throws IOException, ConfigurationException {
        int fps = requestedFps > 0 ? Math.max(1, Math.min((int) requestedFps, 30)) : 30;
        capture.applyNewVideoConstraints(constraints(requestedSize));
        HandlerThread notifications = new HandlerThread("ADM video frames");
        notifications.start();
        try {
            Handler handler = new Handler(notifications.getLooper());
            while (!stopped.get() && !capture.isClosed()) {
                int reset = control.consumeReset();
                if ((reset & CaptureControl.RESET_REASON_TERMINATED) != 0) {
                    break;
                }
                capture.prepare();
                Size size = capture.getSize();
                try (ImageReader reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), PixelFormat.RGBA_8888, 3)) {
                    // 通知只表示“有最新帧”。网络或编码较慢时不积压旧画面。
                    Semaphore ready = new Semaphore(0);
                    reader.setOnImageAvailableListener(ignored -> {
                        if (ready.availablePermits() == 0) {
                            ready.release();
                        }
                    }, handler);
                    capture.start(reader.getSurface());
                    try {
                        streamer.writeSessionMeta(size.getWidth(), size.getHeight(), (reset & CaptureControl.RESET_REASON_CLIENT_RESIZED) != 0, true);
                        encode(reader, ready, control, streamer, size, fps, stopped);
                    } finally {
                        capture.stop();
                    }
                }
            }
        } finally {
            notifications.quitSafely();
        }
    }

    private static void encode(ImageReader reader, Semaphore ready, CaptureControl control, Streamer streamer, Size size, int fps,
            AtomicBoolean stopped) throws IOException {
        ByteBuffer output = ByteBuffer.allocateDirect(2 * 1024 * 1024);
        int[] flags = new int[2];
        long encoder = open(size.getWidth(), size.getHeight(), fps);
        if (encoder == 0) {
            throw new IOException("OpenH264 initialization failed");
        }
        try {
            long nextFrame = 0;
            while (!stopped.get() && !control.isResetRequested()) {
                if (!ready.tryAcquire(100, TimeUnit.MILLISECONDS)) {
                    continue;
                }
                long delay = nextFrame - SystemClock.uptimeMillis();
                if (delay > 0) {
                    SystemClock.sleep(delay);
                }
                try (Image frame = reader.acquireLatestImage()) {
                    if (frame == null) {
                        continue;
                    }
                    nextFrame = SystemClock.uptimeMillis() + 1000 / fps;
                    Image.Plane pixels = frame.getPlanes()[0];
                    long pts = frame.getTimestamp() / 1000;
                    output.clear();
                    int bytes = encodeRgba(encoder, pixels.getBuffer(), pixels.getRowStride(), pixels.getPixelStride(), pts, output, flags);
                    if (bytes < 0) {
                        throw new IOException("OpenH264 failed to encode a frame");
                    }
                    // scrcpy 分开发送 SPS/PPS 与图像，桌面解码和 MP4 录制共用相同协议。
                    if (flags[0] > 0) {
                        output.limit(flags[0]);
                        streamer.writePacket(output, pts, true, false);
                    }
                    if (bytes > flags[0]) {
                        output.limit(bytes);
                        output.position(flags[0]);
                        streamer.writePacket(output, pts, false, flags[1] != 0);
                    }
                }
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } finally {
            close(encoder);
        }
    }

    private static native long open(int width, int height, int fps);
    private static native int encodeRgba(long encoder, ByteBuffer pixels, int rowStride, int pixelStride, long pts, ByteBuffer output, int[] flags);
    private static native void close(long encoder);
}
