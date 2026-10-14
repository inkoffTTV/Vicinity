package app.vicinity.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;

/**
 * Пока идёт звонок или вы в голосовом канале, приложение держит уведомление «Идёт звонок»:
 * так Android не отключает микрофон и не выгружает приложение, когда оно свёрнуто.
 */
public class CallService extends Service {
    static final String CHANNEL = "calls";
    private static final int ID = 1;

    static void createChannel(Context ctx) {
        NotificationChannel ch = new NotificationChannel(CHANNEL, ctx.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#2bc6a4"))
                .setContentTitle(getString(R.string.call_ongoing))
                .setContentText(getString(R.string.call_ongoing_text))
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(ID, n);
            }
        } catch (RuntimeException e) {
            // Нет разрешения на микрофон или запуск из фона запрещён — обойдёмся без службы
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Приложение смахнули из списка недавних — звонок завершён, уведомление убираем
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
