package io.github.mediagrabber;

import org.json.JSONObject;

import java.net.URLDecoder;

/** عنصر وسائط مكتشف في الصفحة. */
public class MediaItem {
    public String id = "", key = "", url = "", kind = "", mime = "", title = "", poster = "";
    public long size;
    public int width, height;
    /** true = يلزم تنزيله من داخل الصفحة (blob / بث ملتقط). */
    public boolean page;

    static MediaItem from(JSONObject o) {
        MediaItem m = new MediaItem();
        m.id = o.optString("id", "");
        m.url = o.optString("url", "");
        m.key = o.optString("key", m.url);
        m.kind = o.optString("kind", "");
        m.mime = o.optString("mime", "");
        m.title = o.optString("title", "");
        m.poster = o.optString("poster", "");
        m.size = o.optLong("size", 0);
        m.width = o.optInt("w", 0);
        m.height = o.optInt("h", 0);
        m.page = o.optBoolean("page", false);
        return m;
    }

    public String displayName() {
        String n = "";
        if (url.startsWith("http")) {
            try {
                String p = url.split("[?#]")[0];
                n = URLDecoder.decode(p.substring(p.lastIndexOf('/') + 1), "UTF-8");
            } catch (Exception ignored) { }
        }
        if (!n.matches(".*\\.[A-Za-z0-9]{2,5}$")) {
            String base = title.isEmpty() ? kind : title;
            if (base.length() > 80) base = base.substring(0, 80);
            String ext;
            switch (kind) {
                case "audio": ext = "mp3"; break;
                case "image": ext = "jpg"; break;
                default: ext = "mp4";
            }
            n = base + "." + ext;
        }
        return n.replaceAll("[\\\\/:*?\"<>|]+", "_");
    }
}
