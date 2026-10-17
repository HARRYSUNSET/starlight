package com.starlight.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User-selected document export; no broad storage permission or remote upload. */
@CapacitorPlugin(name = "StarlightArchive")
public class ArchivePlugin extends Plugin {
    @PluginMethod
    public void saveBackup(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.length() > 200 * 1024 * 1024) {
            call.reject("备份内容为空或过大，请按作品分别导出");
            return;
        }
        String name = call.getString("name", "starlight-backup.json");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
        try { startActivityForResult(call, intent, "saveDocument"); }
        catch (Exception error) { call.reject("无法打开文件保存器", error); }
    }

    @ActivityCallback
    private void saveDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("已取消导出");
            return;
        }
        getBridge().execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (output == null) throw new java.io.IOException("无法写入目标文件");
                output.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
                output.flush();
                call.resolve();
            } catch (Exception error) { call.reject("备份保存失败，请检查剩余空间", error); }
        });
    }
}
