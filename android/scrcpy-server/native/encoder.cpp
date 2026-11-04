#include <jni.h>
#include <wels/codec_api.h>

#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

namespace {
struct Encoder {
    ISVCEncoder *codec = nullptr;
    int width;
    int height;
    std::vector<uint8_t> yuv;

    Encoder(int w, int h) : width(w), height(h), yuv(w * h * 3 / 2) {}
    ~Encoder() {
        if (codec) {
            codec->Uninitialize();
            WelsDestroySVCEncoder(codec);
        }
    }
};

// ImageReader 的 RGBA 行尾可能有填充，输出为连续的 BT.601 限幅 I420。
void convert(const uint8_t *rgba, int stride, Encoder &e, SSourcePicture &pic) {
    int area = e.width * e.height;
    uint8_t *y = e.yuv.data(), *u = y + area, *v = u + area / 4;
    for (int row = 0; row < e.height; ++row) {
        const uint8_t *src = rgba + row * stride;
        for (int col = 0; col < e.width; ++col, src += 4) {
            *y++ = ((66 * src[0] + 129 * src[1] + 25 * src[2] + 128) >> 8) + 16;
            if (!(row & 1) && !(col & 1)) {
                *u++ = ((-38 * src[0] - 74 * src[1] + 112 * src[2] + 128) >> 8) + 128;
                *v++ = ((112 * src[0] - 94 * src[1] - 18 * src[2] + 128) >> 8) + 128;
            }
        }
    }
    pic.iColorFormat = videoFormatI420;
    pic.iPicWidth = e.width;
    pic.iPicHeight = e.height;
    pic.iStride[0] = e.width;
    pic.iStride[1] = pic.iStride[2] = e.width / 2;
    pic.pData[0] = e.yuv.data();
    pic.pData[1] = pic.pData[0] + area;
    pic.pData[2] = pic.pData[1] + area / 4;
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_genymobile_scrcpy_video_CompatibilityEncoder_open(JNIEnv *, jclass, jint w, jint h, jint fps) {
    if (w <= 0 || h <= 0 || w > 1280 || h > 1280 || (w & 1) || (h & 1) || fps < 1 || fps > 30) {
        return 0;
    }
    std::unique_ptr<Encoder> e(new Encoder(w, h));
    SEncParamExt params{};
    if (WelsCreateSVCEncoder(&e->codec) || e->codec->GetDefaultParams(&params)) {
        return 0;
    }
    params.iUsageType = SCREEN_CONTENT_REAL_TIME;
    params.iPicWidth = w;
    params.iPicHeight = h;
    params.fMaxFrameRate = fps;
    params.iTargetBitrate = 3000000;
    params.iRCMode = RC_BITRATE_MODE;
    params.iSpatialLayerNum = params.iTemporalLayerNum = 1;
    params.iMultipleThreadIdc = 2;
    params.uiIntraPeriod = fps;
    params.bEnableAdaptiveQuant = false;
    params.bEnableBackgroundDetection = false;
    auto &layer = params.sSpatialLayers[0];
    layer.iVideoWidth = w;
    layer.iVideoHeight = h;
    layer.fFrameRate = fps;
    layer.iSpatialBitrate = params.iTargetBitrate;
    if (e->codec->InitializeExt(&params)) {
        return 0;
    }
    return reinterpret_cast<jlong>(e.release());
}

// 返回 Annex B 总字节数；flags 分别记录前置参数集字节数、是否为 IDR。跳帧成功返回零。
extern "C" JNIEXPORT jint JNICALL
Java_com_genymobile_scrcpy_video_CompatibilityEncoder_encodeRgba(JNIEnv *env, jclass, jlong handle, jobject pixels, jint stride,
        jint pixelStride, jlong pts, jobject output, jintArray flags) {
    auto &e = *reinterpret_cast<Encoder *>(handle);
    auto *src = static_cast<uint8_t *>(env->GetDirectBufferAddress(pixels));
    auto *dst = static_cast<uint8_t *>(env->GetDirectBufferAddress(output));
    jlong capacity = env->GetDirectBufferCapacity(output);
    if (!src || !dst || pixelStride != 4 || stride < e.width * 4 ||
            env->GetDirectBufferCapacity(pixels) < jlong(stride) * (e.height - 1) + e.width * 4) {
        return -1;
    }
    SSourcePicture pic{};
    pic.uiTimeStamp = pts / 1000;
    convert(src, stride, e, pic);
    SFrameBSInfo info{};
    if (e.codec->EncodeFrame(&pic, &info)) {
        return -1;
    }
    int total = 0;
    jint metadata[] = {0, info.eFrameType == videoFrameTypeIDR};
    for (int i = 0; i < info.iLayerNum; ++i) {
        const auto &layer = info.sLayerInfo[i];
        const uint8_t *nal = layer.pBsBuf;
        for (int j = 0; j < layer.iNalCount; ++j) {
            int len = layer.pNalLengthInByte[j];
            if (len < 5 || len > capacity - total) {
                return -1;
            }
            // OpenH264 产生四字节起始码。SPS/PPS 位于该访问单元的图像数据之前。
            int type = nal[4] & 31;
            if (type == 7 || type == 8) {
                if (metadata[0] != total) {
                    return -1;
                }
                metadata[0] += len;
            }
            std::memcpy(dst + total, nal, len);
            total += len;
            nal += len;
        }
    }
    env->SetIntArrayRegion(flags, 0, 2, metadata);
    return total;
}

extern "C" JNIEXPORT void JNICALL
Java_com_genymobile_scrcpy_video_CompatibilityEncoder_close(JNIEnv *, jclass, jlong handle) {
    delete reinterpret_cast<Encoder *>(handle);
}
