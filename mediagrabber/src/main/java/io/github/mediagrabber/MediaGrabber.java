package io.github.mediagrabber;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * يربط WebView بسكربت الالتقاط (mg-core.js):
 * اكتشاف الفيديو/الصوت/الصور، لوحة تنزيل داخل الصفحة، ووضع الالتقاط بالنقر.
 *
 * الاستخدام:  MediaGrabber g = MediaGrabber.attach(webView);
 */
public class MediaGrabber {
    public interface Listener {
        void onMediaChanged(List<MediaItem> items, boolean drm);
    }

    private static String coreJs;

    private final Context ctx;
    private final WebView web;
    private final String userAgent;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, MediaItem> items = new LinkedHashMap<>();
    private final Map<String, Storage.Out> blobs = new HashMap<>();
    private boolean drm;
    private boolean docStartInjected;
    private volatile String pageUrl = "";
    private Listener listener;

    /** يضبط الـ WebView (JavaScript + جسر + مستمع التنزيل + WebViewClient). */
    public static MediaGrabber attach(WebView webView) { return new MediaGrabber(webView); }

    private MediaGrabber(WebView web) {
        this.web = web;
        this.ctx = web.getContext().getApplicationContext();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        this.userAgent = s.getUserAgentString();
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "MGAndroid");
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            String name = URLUtil.guessFileName(url, cd, mime);
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                js("window.__MG&&__MG.saveBlobUrl('" + esc(url) + "','" + esc(name) + "')");
            } else {
                downloadUrl(url, null, name, pageUrl);
            }
        });
        web.setWebViewClient(new MediaGrabberClient(this));
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(web, core(), Collections.singleton("*"));
                docStartInjected = true;
            }
        } catch (Throwable ignored) { }
    }

    public void setListener(Listener l) { listener = l; }

    public List<MediaItem> getItems() {
        synchronized (items) { return new ArrayList<>(items.values()); }
    }

    /** إظهار/إخفاء لوحة الوسائط داخل الصفحة. */
    public void togglePanel() { js("window.__MG&&__MG.togglePanel()"); }

    /** تفعيل/إيقاف وضع الالتقاط بالنقر. */
    public void setPickMode(boolean on) { js("window.__MG&&__MG.setPick(" + on + ")"); }

    public void scan() { js("window.__MG&&__MG.scan()"); }

    /** تنزيل عنصر مكتشف. */
    public void download(MediaItem it) {
        if (it.page) js("window.__MG&&__MG.download('" + esc(it.id) + "')");
        else downloadUrl(it.url, it.kind, it.displayName(), pageUrl);
    }

    /* ---- تُستدعى من MediaGrabberClient (أو من عميلك الخاص) ---- */
    public void onPageStarted(String url) {
        pageUrl = url == null ? "" : url;
        synchronized (items) { items.clear(); drm = false; }
        notifyChanged();
        if (!docStartInjected) {
            try { web.evaluateJavascript(core(), null); } catch (Throwable ignored) { }
        }
    }

    public void onPageFinished() { scan(); }

    public void onRequest(WebResourceRequest r) {
        try {
            if (!"GET".equalsIgnoreCase(r.getMethod())) return;
            String u = r.getUrl().toString();
            String k = kindOf(u);
            if (k == null || k.equals("image")) return;
            MediaItem it = new MediaItem();
            it.id = "net"; it.url = u; it.key = u; it.kind = k;
            boolean added;
            synchronized (items) { added = !items.containsKey(u); if (added) items.put(u, it); }
            if (added) notifyChanged();
        } catch (Throwable ignored) { }
    }

    /* ---- داخلي ---- */
    private static String kindOf(String url) {
        String u = url.toLowerCase(Locale.ROOT).split("[?#]")[0];
        if (u.matches(".*\\.(ts|m4s|cmfv|cmfa|cmft)$")) return null;
        if (u.endsWith(".m3u8")) return "hls";
        if (u.endsWith(".mpd")) return "dash";
        if (u.matches(".*\\.(mp4|m4v|webm|mkv|mov|avi|flv|3gp|ogv)$")) return "video";
        if (u.matches(".*\\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$")) return "audio";
        if (u.matches(".*\\.(jpe?g|png|gif|webp|avif|bmp|svg)$")) return "image";
        return null;
    }

    private synchronized String core() {
        if (coreJs == null) {
            try (InputStream in = ctx.getAssets().open("mg-core.js")) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int n;
                while ((n = in.read(b)) != -1) bo.write(b, 0, n);
                coreJs = bo.toString("UTF-8");
            } catch (IOException e) {
                coreJs = "";
            }
        }
        return coreJs;
    }

    private void js(String code) { ui.post(() -> web.evaluateJavascript(code, null)); }

    private static String esc(String s) {
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", " ");
    }

    private void toast(String m) { ui.post(() -> Toast.makeText(ctx, m, Toast.LENGTH_SHORT).show()); }

    private void notifyChanged() {
        final Listener l = listener;
        if (l == null) return;
        final List<MediaItem> copy = getItems();
        final boolean d = drm;
        ui.post(() -> l.onMediaChanged(copy, d));
    }

    private Map<String, String> headers(String url, String referer) {
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", userAgent);
        String c = CookieManager.getInstance().getCookie(url);
        if (c != null) h.put("Cookie", c);
        if (referer != null && !referer.isEmpty()) h.put("Referer", referer);
        return h;
    }

    private void downloadUrl(final String url, String kind, String name, String referer) {
        if ("hls".equals(kind)) {
            final Map<String, String> h = headers(url, referer);
            final String base = name.replaceAll("\\.[^.]+$", "");
            new Thread(() -> {
                try {
                    toast("بدأ تنزيل البث…");
                    HlsDownloader.download(ctx, url, base, h);
                    toast("اكتمل التنزيل ✔ (التنزيلات/MediaGrabber)");
                } catch (Exception e) {
                    toast("فشل التنزيل: " + e.getMessage());
                }
            }).start();
            return;
        }
        if ("dash".equals(kind)) {
            toast("تنزيل DASH غير مدعوم هنا — شغّل الفيديو واستخدم «بث (التقاط)»");
            return;
        }
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "MediaGrabber/" + name);
            for (Map.Entry<String, String> e : headers(url, referer).entrySet()) r.addRequestHeader(e.getKey(), e.getValue());
            ((DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            toast("بدأ التنزيل: " + name);
        } catch (Exception e) {
            toast("تعذّر التنزيل: " + e.getMessage());
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void post(String json) {
            try {
                JSONObject m = new JSONObject(json);
                String type = m.getString("type");
                JSONObject d = m.optJSONObject("data");
                if (d == null) return;
                if ("items".equals(type)) {
                    JSONArray arr = d.optJSONArray("items");
                    synchronized (items) {
                        if (arr != null) for (int i = 0; i < arr.length(); i++) {
                            MediaItem it = MediaItem.from(arr.getJSONObject(i));
                            if (!it.url.isEmpty() && !it.url.startsWith("data:")) items.put(it.key, it);
                        }
                        if (d.optBoolean("drm")) drm = true;
                    }
                    notifyChanged();
                } else if ("download".equals(type)) {
                    String url = d.getString("url");
                    String name = d.optString("name", "media");
                    downloadUrl(url, d.optString("kind"), name, d.optString("referer", pageUrl));
                }
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void chunk(String id, String name, String mime, int index, boolean last, String b64) {
            try {
                Storage.Out o;
                synchronized (blobs) { o = blobs.get(id); }
                if (o == null) {
                    o = Storage.create(ctx, name, mime);
                    synchronized (blobs) { blobs.put(id, o); }
                }
                o.write(Base64.decode(b64, Base64.DEFAULT));
                if (last) {
                    o.finish(ctx);
                    synchronized (blobs) { blobs.remove(id); }
                    toast("تم الحفظ: " + name);
                }
            } catch (Exception e) {
                Storage.Out o;
                synchronized (blobs) { o = blobs.remove(id); }
                if (o != null) o.abort(ctx);
                toast("فشل الحفظ: " + e.getMessage());
            }
        }
    }
}
