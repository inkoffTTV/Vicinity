package app.vicinity.android;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Окно Vicinity для Android: веб-клиент с сервера (BuildConfig.APP_URL) во WebView. Дизайн и функции
 * обновляются вместе с сайтом; приложение даёт камеру и микрофон, уведомления, выбор и скачивание файлов,
 * звонок в свёрнутом виде и страницу «нет связи».
 *
 * Мост для веб-клиента — window.VicinityAndroid (web/src/lib/android.ts).
 */
public class MainActivity extends Activity {
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";
    private static final String START_PATH = "/channels/@me";
    private static final String CHANNEL_MESSAGES = "messages";
    private static final String EXTRA_TAG = "vicinity.notification.tag";

    private static final int REQ_MEDIA = 1;
    private static final int REQ_FILES = 2;
    private static final int REQ_NOTIFY = 3;

    private FrameLayout root;
    private WebView web;
    private String appHost;

    private PermissionRequest pendingMedia;
    private ValueCallback<Uri[]> pendingFiles;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean inCall;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appHost = Uri.parse(BuildConfig.APP_URL).getHost();
        createChannels();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0e1015"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupInsets();
        setupWebView();

        // Открыли по ссылке (приглашение, подарок, профиль) — сразу на нужный экран
        String link = deepLinkPath(getIntent());
        String url = BuildConfig.APP_URL + (link != null ? link : START_PATH);
        String tag = getIntent().getStringExtra(EXTRA_TAG);
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (web.getUrl() == null) web.loadUrl(url);
        else if (link != null) openDeepLink(link);
        if (tag != null) dispatchNotificationClick(tag);
    }

    /** Путь экрана из ссылки: https://<сайт>/invite/… или vicinity://invite/… → /invite/…; null — не наша ссылка */
    private String deepLinkPath(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null) return null;
        String path;
        if ("vicinity".equalsIgnoreCase(uri.getScheme())) {
            String host = uri.getHost() == null ? "" : uri.getHost();
            path = "/" + host + (uri.getPath() == null ? "" : uri.getPath());
        } else if (isAppUrl(uri)) {
            path = uri.getPath();
        } else {
            return null;
        }
        if (path == null || !path.matches("^/(invite|gift|u|users|channels)/[A-Za-z0-9@_/-]*$")) return null;
        return path;
    }

    /** Открыть экран в уже загруженном клиенте без перезагрузки (web/src/lib/router.ts, событие vicinity-open) */
    private void openDeepLink(String path) {
        String current = web.getUrl();
        if (current == null || !isAppUrl(Uri.parse(current))) {
            web.loadUrl(BuildConfig.APP_URL + path);
            return;
        }
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('vicinity-open', {detail: " + JSONObject.quote(path) + "}))", null);
    }

    // Android 15 рисует окно под системными панелями: отступаем на их высоту и на высоту клавиатуры,
    // чтобы поле ввода не пряталось под ней. На старых версиях то же делает adjustResize.
    private void setupInsets() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        getWindow().setDecorFitsSystemWindows(false);
        WindowInsetsController controller = getWindow().getInsetsController();
        if (controller != null) {
            controller.setSystemBarsAppearance(0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (customView != null) {
                v.setPadding(0, 0, 0, 0);
                return WindowInsets.CONSUMED;
            }
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " VicinityAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        web.setBackgroundColor(Color.parseColor("#0e1015"));
        web.addJavascriptInterface(new Bridge(), "VicinityAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                download(url, userAgent, contentDisposition, mimeType));
    }

    private boolean isAppUrl(Uri uri) {
        return "https".equals(uri.getScheme()) && appHost != null && appHost.equalsIgnoreCase(uri.getHost());
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppUrl(uri)) return false;
            // Чужие ссылки (и mailto:, tel:) — в браузере или подходящем приложении
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {
                // открыть нечем
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isAppUrl(request.getUrl())) view.loadUrl(OFFLINE_URL);
        }
    }

    private class Chrome extends WebChromeClient {
        // Камера и микрофон для звонков: системное разрешение спрашиваем по первому запросу сайта
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!isAppUrl(request.getOrigin())) {
                    request.deny();
                    return;
                }
                List<String> missing = new ArrayList<>();
                for (String r : request.getResources()) {
                    String p = androidPermission(r);
                    if (p != null && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
                }
                if (missing.isEmpty()) {
                    grantAllowed(request);
                    return;
                }
                if (pendingMedia != null) pendingMedia.deny();
                pendingMedia = request;
                requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingMedia == request) pendingMedia = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(intent, REQ_FILES);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }

        // Без этого <video> до первого кадра показывает серый значок «play»
        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }

        // Полный экран (демонстрация экрана, видео) — поверх всего, без системных панелей
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setSystemBarsHidden(true);
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            customViewCallback = null;
            setSystemBarsHidden(false);
        }
    }

    private void setSystemBarsHidden(boolean hidden) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                if (hidden) {
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(WindowInsets.Type.systemBars());
                } else {
                    c.show(WindowInsets.Type.systemBars());
                }
            }
            root.requestApplyInsets();
        } else {
            getWindow().getDecorView().setSystemUiVisibility(hidden
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : 0);
        }
    }

    private static String androidPermission(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    // Отдаём сайту только то, на что есть системное разрешение; ничего — отказ
    private void grantAllowed(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        for (String r : request.getResources()) {
            String p = androidPermission(r);
            if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) allowed.add(r);
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MEDIA && pendingMedia != null) {
            PermissionRequest r = pendingMedia;
            pendingMedia = null;
            grantAllowed(r);
            if (inCall) startCallService();
        } else if (requestCode == REQ_NOTIFY) {
            prefs().edit().putBoolean("notify_asked", true).apply();
            String state = notificationPermission();
            web.evaluateJavascript("window.__vicinityNotifyPermission && window.__vicinityNotifyPermission(" + JSONObject.quote(state) + ")", null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILES || pendingFiles == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] {data.getData()};
            }
        }
        pendingFiles.onReceiveValue(result);
        pendingFiles = null;
    }

    // Вложения — в «Загрузки» через системный менеджер загрузок (с уведомлением о готовности)
    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme())) {
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request req = new DownloadManager.Request(uri);
            req.setMimeType(mimeType);
            req.addRequestHeader("User-Agent", userAgent);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) req.addRequestHeader("Cookie", cookies);
            req.setTitle(name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(req);
            Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
        }
    }

    // --- Уведомления ---

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel messages = new NotificationChannel(CHANNEL_MESSAGES, getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH);
        messages.enableVibration(true);
        nm.createNotificationChannel(messages);
        CallService.createChannel(this);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("vicinity", MODE_PRIVATE);
    }

    /** Состояние как у Notification.permission в браузере: granted / denied / default */
    private String notificationPermission() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return prefs().getBoolean("notify_asked", false) ? "denied" : "default";
        }
        return nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    private void showNotification(String title, String body, String tag) {
        if (!"granted".equals(notificationPermission())) return;
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_TAG, tag);
        PendingIntent pi = PendingIntent.getActivity(this, tag.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#2bc6a4"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        getSystemService(NotificationManager.class).notify(tag, 0, n);
    }

    private void dispatchNotificationClick(String tag) {
        getSystemService(NotificationManager.class).cancel(tag, 0);
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('vicinity-notification-click', {detail: " + JSONObject.quote(tag) + "}))", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String link = deepLinkPath(intent);
        if (link != null) openDeepLink(link);
        String tag = intent.getStringExtra(EXTRA_TAG);
        if (tag != null) dispatchNotificationClick(tag);
    }

    // --- Звонок в свёрнутом виде ---

    private void startCallService() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        try {
            startForegroundService(new Intent(this, CallService.class));
        } catch (RuntimeException ignored) {
            // система не дала запустить службу — звонок идёт, пока приложение на экране
        }
    }

    private void setInCall(boolean active) {
        if (active == inCall) return;
        inCall = active;
        if (active) startCallService();
        else stopService(new Intent(this, CallService.class));
    }

    /** Мост для веб-клиента. Методы вызываются не из главного потока — всё, что трогает окно, через runOnUiThread */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public String notificationPermission() {
            return MainActivity.this.notificationPermission();
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                } else {
                    onRequestPermissionsResult(REQ_NOTIFY, new String[0], new int[0]);
                }
            });
        }

        @JavascriptInterface
        public void notify(String title, String body, String tag) {
            runOnUiThread(() -> showNotification(title == null ? "" : title, body == null ? "" : body, tag == null ? "vicinity" : tag));
        }

        @JavascriptInterface
        public void closeNotification(String tag) {
            if (tag != null) getSystemService(NotificationManager.class).cancel(tag, 0);
        }

        @JavascriptInterface
        public void setInCall(boolean active) {
            runOnUiThread(() -> MainActivity.this.setInCall(active));
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(BuildConfig.APP_URL + START_PATH));
        }
    }

    // --- Жизненный цикл ---

    @Override
    public void onBackPressed() {
        if (customView != null) {
            web.getWebChromeClient().onHideCustomView();
        } else if (web.canGoBack() && !OFFLINE_URL.equals(web.getUrl())) {
            web.goBack();
        } else {
            // Сворачиваем, а не закрываем: так продолжают приходить сообщения и не рвётся звонок
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        stopService(new Intent(this, CallService.class));
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
