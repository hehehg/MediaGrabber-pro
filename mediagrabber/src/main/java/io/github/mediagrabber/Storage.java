package io.github.mediagrabber;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/** حفظ الملفات في مجلد التنزيلات/MediaGrabber (MediaStore على أندرويد 10+). */
final class Storage {
    static final class Out {
        private final OutputStream os;
        private final Uri uri;
        private final File file;

        Out(OutputStream os, Uri uri, File file) { this.os = os; this.uri = uri; this.file = file; }

        void write(byte[] b) throws IOException { os.write(b); }

        void finish(Context c) throws IOException {
            os.close();
            if (uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                c.getContentResolver().update(uri, v, null, null);
            } else if (file != null) {
                MediaScannerConnection.scanFile(c, new String[]{file.getAbsolutePath()}, null, null);
            }
        }

        void abort(Context c) {
            try { os.close(); } catch (IOException ignored) { }
            try {
                if (uri != null) c.getContentResolver().delete(uri, null, null);
                else if (file != null) //noinspection ResultOfMethodCallIgnored
                    file.delete();
            } catch (Exception ignored) { }
        }
    }

    static Out create(Context c, String name, String mime) throws IOException {
        name = name.replaceAll("[\\\\/:*?\"<>|]+", "_");
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MediaGrabber");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri u = c.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (u == null) throw new IOException("تعذّر إنشاء الملف");
            OutputStream os = c.getContentResolver().openOutputStream(u);
            if (os == null) throw new IOException("تعذّر فتح الملف");
            return new Out(new BufferedOutputStream(os, 1 << 16), u, null);
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "MediaGrabber");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File f = new File(dir, name);
        int i = 1;
        String stem = name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name;
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')) : "";
        while (f.exists()) f = new File(dir, stem + " (" + (i++) + ")" + ext);
        return new Out(new BufferedOutputStream(new FileOutputStream(f), 1 << 16), null, f);
    }
}
