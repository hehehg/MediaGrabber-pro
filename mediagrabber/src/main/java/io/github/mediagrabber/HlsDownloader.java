package io.github.mediagrabber;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** تنزيل HLS (يدعم AES-128 المفتوح) ودمج المقاطع في ملف واحد. لا يدعم DRM. */
final class HlsDownloader {
    private static final Pattern ATTR = Pattern.compile("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)");

    private static final class Seg { String url, keyUri, iv; long n; }

    private static Map<String, String> attrs(String s) {
        Map<String, String> m = new HashMap<>();
        Matcher x = ATTR.matcher(s);
        while (x.find()) {
            String v = x.group(2);
            if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) v = v.substring(1, v.length() - 1);
            m.put(x.group(1), v);
        }
        return m;
    }

    private static String tail(String l) { return l.substring(l.indexOf(':') + 1); }

    private static String abs(String base, String ref) throws IOException {
        return new URL(new URL(base), ref).toString();
    }

    static void download(Context ctx, String url, String name, Map<String, String> h) throws Exception {
        String text = text(url, h);
        String audio = null;
        if (text.contains("#EXT-X-STREAM-INF")) {
            String[] lines = text.split("\\r?\\n");
            long bestBw = -1; String best = null, group = null;
            List<Map<String, String>> media = new ArrayList<>();
            for (int i = 0; i < lines.length; i++) {
                String l = lines[i].trim();
                if (l.startsWith("#EXT-X-STREAM-INF:")) {
                    Map<String, String> a = attrs(tail(l));
                    int j = i + 1;
                    while (j < lines.length && (lines[j].trim().isEmpty() || lines[j].startsWith("#"))) j++;
                    if (j >= lines.length) break;
                    long bw = 0;
                    try { bw = Long.parseLong(a.get("BANDWIDTH")); } catch (Exception ignored) { }
                    if (bw > bestBw) { bestBw = bw; best = abs(url, lines[j].trim()); group = a.get("AUDIO"); }
                } else if (l.startsWith("#EXT-X-MEDIA:")) {
                    Map<String, String> a = attrs(tail(l));
                    if ("AUDIO".equals(a.get("TYPE")) && a.get("URI") != null) media.add(a);
                }
            }
            if (best == null) throw new IOException("قائمة تشغيل غير صالحة");
            for (Map<String, String> a : media) {
                if (group != null && group.equals(a.get("GROUP-ID"))) { audio = abs(url, a.get("URI")); break; }
            }
            url = best;
            text = text(url, h);
        }
        one(ctx, url, text, name, h);
        if (audio != null) one(ctx, audio, text(audio, h), name + ".audio", h);
    }

    private static void one(Context ctx, String url, String text, String name, Map<String, String> h) throws Exception {
        List<Seg> segs = new ArrayList<>();
        long seq = 0;
        String keyUri = null, iv = null, map = null;
        for (String raw : text.split("\\r?\\n")) {
            String l = raw.trim();
            if (l.isEmpty()) continue;
            if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                seq = Long.parseLong(tail(l).trim());
            } else if (l.startsWith("#EXT-X-KEY:")) {
                Map<String, String> a = attrs(tail(l));
                String m = a.get("METHOD");
                if ("NONE".equals(m)) { keyUri = null; iv = null; }
                else {
                    if (!"AES-128".equals(m)) throw new IOException("تشفير غير مدعوم (" + m + ") — محتوى محمي بـ DRM");
                    String kf = a.get("KEYFORMAT");
                    if (kf != null && !"identity".equals(kf)) throw new IOException("مفتاح DRM غير مدعوم");
                    keyUri = abs(url, a.get("URI"));
                    iv = a.get("IV");
                }
            } else if (l.startsWith("#EXT-X-MAP:")) {
                map = abs(url, attrs(tail(l)).get("URI"));
            } else if (!l.startsWith("#")) {
                Seg s = new Seg();
                s.url = abs(url, l); s.keyUri = keyUri; s.iv = iv; s.n = seq + segs.size();
                segs.add(s);
            }
        }
        if (segs.isEmpty()) throw new IOException("لا توجد مقاطع في القائمة");
        boolean fmp4 = map != null;
        Storage.Out out = Storage.create(ctx, name + (fmp4 ? ".mp4" : ".ts"), fmp4 ? "video/mp4" : "video/mp2t");
        ExecutorService ex = Executors.newFixedThreadPool(4);
        try {
            Map<String, byte[]> keys = new ConcurrentHashMap<>();
            if (map != null) out.write(read(map, h));
            ArrayDeque<Future<byte[]>> q = new ArrayDeque<>();
            int next = 0;
            while (next < segs.size() && q.size() < 8) q.add(ex.submit(task(segs.get(next++), h, keys)));
            while (!q.isEmpty()) {
                out.write(q.poll().get());
                if (next < segs.size()) q.add(ex.submit(task(segs.get(next++), h, keys)));
            }
            out.finish(ctx);
        } catch (Exception e) {
            out.abort(ctx);
            Exception cause = (e instanceof ExecutionException && e.getCause() instanceof Exception) ? (Exception) e.getCause() : e;
            throw cause;
        } finally {
            ex.shutdownNow();
        }
    }

    private static Callable<byte[]> task(final Seg s, final Map<String, String> h, final Map<String, byte[]> keys) {
        return () -> {
            Exception err = null;
            for (int t = 0; t < 3; t++) {
                try {
                    byte[] d = read(s.url, h);
                    if (s.keyUri != null) {
                        byte[] k = keys.get(s.keyUri);
                        if (k == null) { k = read(s.keyUri, h); keys.put(s.keyUri, k); }
                        d = decrypt(d, k, ivBytes(s.iv, s.n));
                    }
                    return d;
                } catch (Exception e) {
                    err = e;
                    Thread.sleep(500L * (t + 1));
                }
            }
            throw err;
        };
    }

    private static byte[] ivBytes(String iv, long n) {
        byte[] out = new byte[16];
        if (iv != null) {
            String hex = (iv.startsWith("0x") || iv.startsWith("0X")) ? iv.substring(2) : iv;
            StringBuilder sb = new StringBuilder(hex);
            while (sb.length() < 32) sb.insert(0, '0');
            for (int i = 0; i < 16; i++) out[i] = (byte) Integer.parseInt(sb.substring(i * 2, i * 2 + 2), 16);
        } else {
            ByteBuffer.wrap(out).putLong(8, n);
        }
        return out;
    }

    private static byte[] decrypt(byte[] data, byte[] key, byte[] iv) throws Exception {
        Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return c.doFinal(data);
    }

    private static String text(String url, Map<String, String> h) throws IOException {
        return new String(read(url, h), StandardCharsets.UTF_8);
    }

    static byte[] read(String url, Map<String, String> h) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        for (Map.Entry<String, String> e : h.entrySet()) if (e.getValue() != null) c.setRequestProperty(e.getKey(), e.getValue());
        try {
            int code = c.getResponseCode();
            if (code >= 400) throw new IOException("HTTP " + code);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] b = new byte[16384];
                int n;
                while ((n = in.read(b)) != -1) bo.write(b, 0, n);
                return bo.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }
}
