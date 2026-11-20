package io.github.mediagrabber;

import android.graphics.Bitmap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** WebViewClient جاهز. إن كان لديك عميل خاص، ورّث هذا الصنف أو استدعِ دوال MediaGrabber يدويًا. */
public class MediaGrabberClient extends WebViewClient {
    private final MediaGrabber grabber;

    public MediaGrabberClient(MediaGrabber grabber) { this.grabber = grabber; }

    @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        grabber.onPageStarted(url);
    }

    @Override public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        grabber.onPageFinished();
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        grabber.onRequest(request);
        return super.shouldInterceptRequest(view, request);
    }
}
