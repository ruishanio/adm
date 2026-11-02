package com.ruinext.adm;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Looper;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.List;
import java.util.TreeSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** 临时读取主用户的应用资源和进程快照；不安装 APK、不修改应用数据。 */
public final class AppLabels {
    private static long apkSize(ApplicationInfo app) {
        long total = size(app.sourceDir);
        if (app.splitSourceDirs != null) {
            for (String path : app.splitSourceDirs) total = Math.addExact(total, size(path));
        }
        return total;
    }
    private static long size(String path) {
        File file = new File(path);
        if (!file.isFile() || !file.canRead() || file.length() <= 0) throw new IllegalStateException("APK unavailable");
        return file.length();
    }
    /** 按请求包名输出有界的 PNG 缩略图，Canvas 同时支持位图、矢量及自适应图标。 */
    private static void icons(PackageManager pm, String[] args) throws Exception {
        if (args.length > 25) throw new IllegalArgumentException("Too many icons");
        JSONObject result = new JSONObject();
        for (int i = 1; i < args.length; i++) {
            try {
                Drawable icon = pm.getApplicationIcon(args[i]);
                Bitmap bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
                try {
                    int width = Math.max(1, icon.getIntrinsicWidth());
                    int height = Math.max(1, icon.getIntrinsicHeight());
                    float scale = 64f / Math.max(width, height);
                    int w = Math.max(1, Math.round(width * scale));
                    int h = Math.max(1, Math.round(height * scale));
                    icon.setBounds((64 - w) / 2, (64 - h) / 2, (64 + w) / 2, (64 + h) / 2);
                    icon.draw(new Canvas(bitmap));
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
                    result.put(args[i], Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                } finally { bitmap.recycle(); }
            } catch (Exception ignored) {
                // 单个图标损坏时由桌面端回退默认图标，不能阻止整个列表展示。
            }
        }
        System.out.println("ADM_ICONS_V1:" + result.toString());
    }
    private static void running(Context context) throws Exception {
        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes = am.getRunningAppProcesses();
        // 查询受限或系统无法返回进程时必须表示未知，不能将所有应用误标为未运行。
        if (processes == null || processes.isEmpty()) throw new IllegalStateException("Process list unavailable");
        TreeSet<String> packages = new TreeSet<>();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (process.uid / 100000 != 0 || process.pkgList == null) continue;
            for (String name : process.pkgList) packages.add(name);
        }
        if (packages.isEmpty()) throw new IllegalStateException("Package association unavailable");
        System.out.println("ADM_RUNNING_V1:" + new JSONArray(packages).toString());
    }
    public static void main(String[] args) {
        try {
            Looper.prepareMainLooper();
            // app_process 没有 Activity；获取系统上下文后使用公开接口解析资源。
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object thread = activityThread.getMethod("systemMain").invoke(null);
            Context context = (Context) activityThread.getMethod("getSystemContext").invoke(thread);
            PackageManager pm = context.getPackageManager();
            if (args.length > 0 && "icons".equals(args[0])) icons(pm, args);
            else if (args.length > 0 && "running".equals(args[0])) running(context);
            else {
                JSONObject labels = new JSONObject();
                JSONObject metadata = new JSONObject();
                for (ApplicationInfo app : pm.getInstalledApplications(0)) {
                    JSONObject item = new JSONObject();
                    try {
                        CharSequence label = pm.getApplicationLabel(app);
                        if (label != null) labels.put(app.packageName, label.toString());
                    } catch (Exception ignored) { }
                    try {
                        PackageInfo info = pm.getPackageInfo(app.packageName, 0);
                        JSONObject version = new JSONObject();
                        version.put("name", info.versionName == null ? "" : info.versionName);
                        version.put("code", String.valueOf(Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode));
                        item.put("version", version);
                    } catch (Exception ignored) { }
                    try { item.put("apkSize", apkSize(app)); } catch (Exception ignored) { }
                    try {
                        Intent launch = pm.getLaunchIntentForPackage(app.packageName);
                        if (launch == null) launch = pm.getLeanbackLaunchIntentForPackage(app.packageName);
                        if (launch != null && launch.getComponent() != null)
                            item.put("launchComponent", launch.getComponent().flattenToString());
                    } catch (Exception ignored) { }
                    metadata.put(app.packageName, item);
                }
                // 版本化标记避开厂商 stdout 诊断信息；名称协议保留兼容，新增元数据独立解析。
                System.out.println("ADM_LABELS_V1:" + labels.toString());
                System.out.println("ADM_APPS_V1:" + metadata.toString());
            }
            System.exit(0);
        } catch (Throwable error) {
            System.err.println("ADM app reader unavailable: " + error.getClass().getSimpleName());
            System.exit(1);
        }
    }
}
