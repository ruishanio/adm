package com.ruinext.androidtool.fixture;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** 专用模拟器测试页：启动时写入测试偏好，用于核对清除数据的实际效果。 */
public final class SmokeActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getSharedPreferences("adm-smoke", MODE_PRIVATE).edit().putString("fixture", "ADM_TEST_ONLY").commit();
        TextView text = new TextView(this);
        text.setText("ADM 应用管理验证夹具");
        setContentView(text);
    }
}
