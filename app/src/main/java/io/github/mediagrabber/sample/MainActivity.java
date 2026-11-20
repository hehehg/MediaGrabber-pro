package io.github.mediagrabber.sample;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

import java.util.ArrayList;
import java.util.List;

import io.github.mediagrabber.MediaGrabber;
import io.github.mediagrabber.MediaItem;

/** مثال كامل: متصفح بسيط مدمج فيه MediaGrabber. */
public class MainActivity extends Activity {
    private WebView web;
    private MediaGrabber grabber;
    private List<MediaItem> latest = new ArrayList<>();
    private boolean picking;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);

        LinearLayout top = new LinearLayout(this);
        final EditText url = new EditText(this);
        url.setHint("https://");
        url.setSingleLine(true);
        url.setImeOptions(EditorInfo.IME_ACTION_GO);
        Button go = new Button(this);
        go.setText("اذهب");
        top.addView(url, new LinearLayout.LayoutParams(0, -2, 1f));
        top.addView(go);

        web = new WebView(this);
        grabber = MediaGrabber.attach(web);

        LinearLayout bar = new LinearLayout(this);
        Button panel = new Button(this); panel.setText("اللوحة");
        final Button pick = new Button(this); pick.setText("التقاط بالنقر");
        final Button list = new Button(this); list.setText("القائمة (0)");
        for (Button x : new Button[]{panel, pick, list}) bar.addView(x, new LinearLayout.LayoutParams(0, -2, 1f));

        root.addView(top);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1f));
        root.addView(bar);
        setContentView(root);

        grabber.setListener((items, drm) -> {
            latest = items;
            list.setText("القائمة (" + items.size() + ")");
        });

        Runnable load = () -> {
            String u = url.getText().toString().trim();
            if (u.isEmpty()) return;
            if (!u.startsWith("http")) u = "https://" + u;
            web.loadUrl(u);
        };
        go.setOnClickListener(v -> load.run());
        url.setOnEditorActionListener((v, a, e) -> { load.run(); return true; });
        panel.setOnClickListener(v -> grabber.togglePanel());
        pick.setOnClickListener(v -> { picking = !picking; grabber.setPickMode(picking); pick.setText(picking ? "إيقاف الالتقاط" : "التقاط بالنقر"); });
        list.setOnClickListener(v -> {
            if (latest.isEmpty()) return;
            final String[] labels = new String[latest.size()];
            for (int i = 0; i < labels.length; i++) labels[i] = latest.get(i).kind + " • " + latest.get(i).displayName();
            new AlertDialog.Builder(this).setTitle("الوسائط المكتشفة")
                    .setItems(labels, (d, i) -> grabber.download(latest.get(i))).show();
        });

        url.setText("https://");
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
