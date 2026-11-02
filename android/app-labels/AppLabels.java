package com.ruinext.adm;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Looper;
import org.json.JSONObject;

/** 通过设备自己的资源管理器读取主用户应用名称，不安装 APK、不修改应用数据。 */
public final class AppLabels {
    public static void main(String[] args) {
        try {
            Looper.prepareMainLooper();
            // app_process 没有 Activity；获取系统上下文后使用公开的 PackageManager 解析资源。
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object thread = activityThread.getMethod("systemMain").invoke(null);
            Context context = (Context) activityThread.getMethod("getSystemContext").invoke(thread);
            PackageManager pm = context.getPackageManager();
            JSONObject labels = new JSONObject();
            for (ApplicationInfo app : pm.getInstalledApplications(0)) {
                try {
                    CharSequence label = pm.getApplicationLabel(app);
                    if (label != null) labels.put(app.packageName, label.toString());
                } catch (RuntimeException ignored) {
                    // 单个应用资源损坏或在查询期间被移除，不影响其他应用的名称。
                }
            }
            // 标记独立一行，避开部分系统向 stdout 输出的启动诊断信息。
            System.out.println("ADM_LABELS_V1:" + labels.toString());
            System.exit(0);
        } catch (Throwable error) {
            System.err.println("ADM app labels unavailable: " + error.getClass().getSimpleName());
            System.exit(1);
        }
    }
}
