# Media Grabber — محمّل الوسائط

إضافة متصفح (Chrome / Edge / Brave / Opera / Kiwi) **ووحدة Android WebView** تعملان بنفس السكربت (`extension/core/mg-core.js`).

## الميزات
1. **عرض الوسائط**: يكتشف الفيديو والصوت والصور (من الصفحة ومن طلبات الشبكة) ويعرضها في لوحة مع زر تنزيل مباشر، وزر ⬇ فوق مشغّلات الفيديو.
2. **الالتقاط بالنقر** 🎯: فعّله ثم اضغط على أي صورة/فيديو/خلفية فيُنزَّل فورًا (Esc للخروج، أو `Alt+Shift+P`).

### الأنواع المدعومة
| النوع | الحالة |
|---|---|
| mp4 / webm / mp3 / صور وغيرها (روابط مباشرة) | ✅ |
| `blob:` و `data:` | ✅ |
| HLS (`.m3u8`) بما فيه تشفير AES-128 المفتوح، والصوت المنفصل | ✅ يُدمج في ملف واحد |
| DASH (`.mpd`) غير المشفّر (في الإضافة) | ✅ |
| بث MSE (مواقع تبني الفيديو بالـ JavaScript) | ✅ التقاط أثناء التشغيل (مسار الفيديو والصوت منفصلان أحيانًا) |
| **DRM** (Widevine / PlayReady / FairPlay / SAMPLE-AES / CENC) | ❌ غير مدعوم عمدًا — تُعرض رسالة تنبيه |

## الإضافة
حمّل `MediaGrabber-extension-*.zip` من صفحة **Releases**، فُكّ الضغط، ثم `chrome://extensions` ← وضع المطوّر ← **Load unpacked**.

## دمجها في تطبيق أندرويد
أضف وحدة `mediagrabber` (أو ملف AAR من Releases + `androidx.webkit:webkit:1.11.0`) ثم:

**Java**
```java
MediaGrabber grabber = MediaGrabber.attach(webView);   // يجهّز WebView بالكامل
grabber.setListener((items, drm) -> { /* قائمة الوسائط المكتشفة */ });
grabber.togglePanel();        // لوحة داخل الصفحة
grabber.setPickMode(true);    // الالتقاط بالنقر
```
**Kotlin**
```kotlin
val grabber = MediaGrabber.attach(webView)
grabber.setListener { items, drm -> }
```
إن كان لديك `WebViewClient` خاص فورّث `MediaGrabberClient` أو استدعِ `grabber.onPageStarted(url)` و`grabber.onPageFinished()` و`grabber.onRequest(request)` من عميلك.
على أندرويد 9 وأقل اطلب إذن `WRITE_EXTERNAL_STORAGE`. الملفات تُحفظ في `التنزيلات/MediaGrabber`.

> تنبيه أمني: جسر `MGAndroid` يمكن لأي صفحة تُحمَّل في الـ WebView استدعاؤه. استخدمه مع صفحات تثق بها أو قيّد المواقع المسموحة.

## البناء والـ Release
كل `commit` على `main` يشغّل `.github/workflows/build.yml` الذي يبني APK + AAR + zip الإضافة وينشر **Release** جديدًا تلقائيًا. الـ APK موقّع بمفتاح تجريبي (debug) للتجربة؛ للنشر الحقيقي استخدم مفتاحك.

## الاستخدام المسؤول
استخدمها فقط لتنزيل محتوى تملكه أو يُسمح بتنزيله، والتزم بحقوق النشر وشروط المواقع.
