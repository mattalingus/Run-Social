/**
 * Expo config plugin: PaceUp Android Home Screen Widget + Live Tracking Notification
 *
 * What this does:
 *  WIDGET:
 *  1. Writes PaceUpWidgetSmall + PaceUpWidgetMedium AppWidgetProvider classes
 *  2. Writes PaceUpWidgetDataHelper shared utility (reads SharedPreferences)
 *  3. Writes RemoteViews XML layouts (small + medium)
 *  4. Writes widget info XML + string resources
 *  5. Injects widget <receiver> entries into AndroidManifest.xml
 *
 *  LIVE NOTIFICATION (foreground service path):
 *  6. Writes PaceUpLiveNotificationService — Android ForegroundService that:
 *     - Maintains an ongoing notification on the lock screen
 *     - Renders GPS coordinates as a green polyline on a dark Canvas bitmap
 *     - Attaches the bitmap as the notification large icon (live route map)
 *     - Updates notification + bitmap on each GPS fix
 *  7. Writes PaceUpNativeModule — ReactContextBaseJavaModule exposing:
 *     - writeWidgetData(json) — writes to SharedPreferences + broadcasts widget update
 *     - startLiveNotification(params) — starts the foreground service
 *     - updateLiveNotification(params) — updates stats + route bitmap
 *     - stopLiveNotification() — stops the foreground service + dismisses notification
 *  8. Writes PaceUpNativePackage — ReactPackage that registers the module
 *  9. Injects <service> + permissions into AndroidManifest.xml
 */

const { withAndroidManifest, withDangerousMod, withMainApplication } = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const PACKAGE_NAME = "com.paceup";
const SHARED_PREFS_FILE = "paceup_widget_prefs";
const SHARED_PREFS_KEY = "paceup_widget_data";

// ─── Small widget layout XML ─────────────────────────────────────────────────

const SMALL_LAYOUT_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="12dp"
    android:background="#050C09"
    android:gravity="top">

    <TextView
        android:id="@+id/widget_small_brand"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="PaceUp"
        android:textColor="#00D97E"
        android:textSize="11sp"
        android:textStyle="bold" />

    <View
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />

    <TextView
        android:id="@+id/widget_small_empty"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="No runs scheduled"
        android:textColor="#888888"
        android:textSize="13sp"
        android:visibility="gone" />

    <TextView
        android:id="@+id/widget_small_label"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="NEXT RUN"
        android:textColor="#888888"
        android:textSize="9sp"
        android:textAllCaps="true"
        android:visibility="visible" />

    <TextView
        android:id="@+id/widget_small_title"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text=""
        android:textColor="#FFFFFF"
        android:textSize="14sp"
        android:textStyle="bold"
        android:maxLines="2"
        android:ellipsize="end" />

    <TextView
        android:id="@+id/widget_small_until"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text=""
        android:textColor="#00D97E"
        android:textSize="12sp"
        android:textStyle="bold" />

    <TextView
        android:id="@+id/widget_small_distance"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text=""
        android:textColor="#888888"
        android:textSize="11sp" />

</LinearLayout>
`;

const MEDIUM_LAYOUT_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="horizontal"
    android:padding="14dp"
    android:background="#050C09">

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="match_parent"
        android:layout_weight="1"
        android:orientation="vertical"
        android:gravity="top">

        <TextView
            android:id="@+id/widget_med_brand"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="PaceUp"
            android:textColor="#00D97E"
            android:textSize="11sp"
            android:textStyle="bold" />

        <View
            android:layout_width="match_parent"
            android:layout_height="0dp"
            android:layout_weight="1" />

        <TextView
            android:id="@+id/widget_med_empty"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="No upcoming runs"
            android:textColor="#888888"
            android:textSize="12sp"
            android:visibility="gone" />

        <TextView
            android:id="@+id/widget_med_label"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="NEXT RUN"
            android:textColor="#888888"
            android:textSize="9sp"
            android:textAllCaps="true"
            android:visibility="visible" />

        <TextView
            android:id="@+id/widget_med_title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text=""
            android:textColor="#FFFFFF"
            android:textSize="13sp"
            android:textStyle="bold"
            android:maxLines="2"
            android:ellipsize="end" />

        <TextView
            android:id="@+id/widget_med_until"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text=""
            android:textColor="#00D97E"
            android:textSize="12sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/widget_med_distance"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text=""
            android:textColor="#888888"
            android:textSize="11sp" />
    </LinearLayout>

    <View
        android:layout_width="1dp"
        android:layout_height="match_parent"
        android:layout_marginHorizontal="12dp"
        android:background="#1FFFFFFF" />

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="match_parent"
        android:layout_weight="1"
        android:orientation="vertical"
        android:gravity="top">

        <TextView
            android:id="@+id/widget_med_week_label"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="THIS WEEK"
            android:textColor="#888888"
            android:textSize="9sp"
            android:textAllCaps="true" />

        <TextView
            android:id="@+id/widget_med_week_miles"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="0.0 mi"
            android:textColor="#FFFFFF"
            android:textSize="20sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/widget_med_week_pct"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text=""
            android:textColor="#888888"
            android:textSize="10sp" />

        <FrameLayout
            android:layout_width="match_parent"
            android:layout_height="4dp"
            android:layout_marginTop="6dp">

            <View
                android:layout_width="match_parent"
                android:layout_height="4dp"
                android:background="#26FFFFFF" />

            <View
                android:id="@+id/widget_med_progress_fill"
                android:layout_width="0dp"
                android:layout_height="4dp"
                android:background="#00D97E" />
        </FrameLayout>
    </LinearLayout>
</LinearLayout>
`;

const WIDGET_INFO_SMALL_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="110dp"
    android:minHeight="110dp"
    android:targetCellWidth="2"
    android:targetCellHeight="2"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/paceup_widget_small"
    android:widgetCategory="home_screen"
    android:description="@string/paceup_widget_description" />
`;

const WIDGET_INFO_MEDIUM_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="220dp"
    android:minHeight="110dp"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/paceup_widget_medium"
    android:widgetCategory="home_screen"
    android:description="@string/paceup_widget_description" />
`;

const WIDGET_STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="paceup_widget_small_name">PaceUp (Small)</string>
    <string name="paceup_widget_medium_name">PaceUp (Medium)</string>
    <string name="paceup_widget_description">Your next run and weekly progress</string>
</resources>
`;

// ─── Java/Kotlin sources ──────────────────────────────────────────────────────

const WIDGET_DATA_HELPER_JAVA = (pkg) => `package ${pkg};

import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;
import org.json.JSONException;

import java.util.Locale;

public class PaceUpWidgetDataHelper {

    public static final String PREFS_FILE = "${SHARED_PREFS_FILE}";
    public static final String DATA_KEY = "${SHARED_PREFS_KEY}";

    public static class WidgetData {
        public String nextRunTitle = "";
        public double nextRunTimestamp = 0;
        public String distanceRange = "";
        public double weeklyMiles = 0;
        public double monthlyGoal = 0;
    }

    public static WidgetData load(Context ctx) {
        WidgetData d = new WidgetData();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        String json = prefs.getString(DATA_KEY, "{}");
        try {
            JSONObject obj = new JSONObject(json);
            d.nextRunTitle = obj.optString("nextRunTitle", "");
            d.nextRunTimestamp = obj.optDouble("nextRunTimestamp", 0);
            d.distanceRange = obj.optString("distanceRangeMiles", "");
            d.weeklyMiles = obj.optDouble("weeklyMiles", 0);
            d.monthlyGoal = obj.optDouble("monthlyGoal", 0);
        } catch (JSONException ignored) {}
        return d;
    }

    public static PendingIntent buildLaunchIntent(Context ctx) {
        Intent intent = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (intent == null) {
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse("paceup://discover"));
        }
        return PendingIntent.getActivity(ctx, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static String buildUntilLabel(double timestamp) {
        if (timestamp <= 0) return "";
        long nowSec = System.currentTimeMillis() / 1000L;
        long diff = (long) timestamp - nowSec;
        if (diff <= 0) return "Starting soon";
        long hours = diff / 3600;
        long minutes = (diff % 3600) / 60;
        if (hours >= 24) { long days = hours / 24; return "in " + days + "d"; }
        if (hours >= 1) return "in " + hours + "h " + minutes + "m";
        if (minutes >= 1) return "in " + minutes + "m";
        return "Starting soon";
    }

    public static int resId(Context ctx, String name) {
        return ctx.getResources().getIdentifier(name, "id", ctx.getPackageName());
    }

    public static void bindRunSection(RemoteViews views, boolean hasRun, String title,
            String untilLabel, String distRange, String emptyId, String labelId,
            String titleId, String untilId, String distanceId, Context ctx) {
        int emptyVis = hasRun ? android.view.View.GONE : android.view.View.VISIBLE;
        int runVis   = hasRun ? android.view.View.VISIBLE : android.view.View.GONE;
        views.setViewVisibility(resId(ctx, emptyId), emptyVis);
        views.setViewVisibility(resId(ctx, labelId), runVis);
        views.setViewVisibility(resId(ctx, titleId), runVis);
        views.setViewVisibility(resId(ctx, untilId),
                (!untilLabel.isEmpty() && hasRun) ? android.view.View.VISIBLE : android.view.View.GONE);
        views.setViewVisibility(resId(ctx, distanceId),
                (!distRange.isEmpty() && hasRun) ? android.view.View.VISIBLE : android.view.View.GONE);
        views.setTextViewText(resId(ctx, titleId), title);
        views.setTextViewText(resId(ctx, untilId), untilLabel);
        views.setTextViewText(resId(ctx, distanceId), distRange.isEmpty() ? "" : distRange + " mi");
    }
}
`;

const WIDGET_SMALL_JAVA = (pkg) => `package ${pkg};

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

public class PaceUpWidgetSmall extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }
    public static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        PaceUpWidgetDataHelper.WidgetData d = PaceUpWidgetDataHelper.load(ctx);
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.paceup_widget_small);
        views.setOnClickPendingIntent(android.R.id.content, PaceUpWidgetDataHelper.buildLaunchIntent(ctx));
        boolean hasRun = !d.nextRunTitle.isEmpty();
        String until = PaceUpWidgetDataHelper.buildUntilLabel(d.nextRunTimestamp);
        PaceUpWidgetDataHelper.bindRunSection(views, hasRun, d.nextRunTitle, until, d.distanceRange,
                "widget_small_empty", "widget_small_label", "widget_small_title",
                "widget_small_until", "widget_small_distance", ctx);
        mgr.updateAppWidget(widgetId, views);
    }
}
`;

const WIDGET_MEDIUM_JAVA = (pkg) => `package ${pkg};

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;
import java.util.Locale;

public class PaceUpWidgetMedium extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }
    public static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        PaceUpWidgetDataHelper.WidgetData d = PaceUpWidgetDataHelper.load(ctx);
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.paceup_widget_medium);
        views.setOnClickPendingIntent(android.R.id.content, PaceUpWidgetDataHelper.buildLaunchIntent(ctx));
        boolean hasRun = !d.nextRunTitle.isEmpty();
        String until = PaceUpWidgetDataHelper.buildUntilLabel(d.nextRunTimestamp);
        PaceUpWidgetDataHelper.bindRunSection(views, hasRun, d.nextRunTitle, until, d.distanceRange,
                "widget_med_empty", "widget_med_label", "widget_med_title",
                "widget_med_until", "widget_med_distance", ctx);
        views.setTextViewText(PaceUpWidgetDataHelper.resId(ctx, "widget_med_week_miles"),
                String.format(Locale.US, "%.1f mi", d.weeklyMiles));
        if (d.monthlyGoal > 0) {
            double weeklyGoal = d.monthlyGoal / 4.0;
            double pct = Math.min(d.weeklyMiles / weeklyGoal, 1.0);
            views.setTextViewText(PaceUpWidgetDataHelper.resId(ctx, "widget_med_week_pct"),
                    String.format(Locale.US, "%.0f%% of %.0f mi/wk", pct * 100, weeklyGoal));
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                try {
                    views.setViewLayoutWidth(PaceUpWidgetDataHelper.resId(ctx, "widget_med_progress_fill"),
                            (float) pct, android.util.TypedValue.COMPLEX_UNIT_FRACTION);
                } catch (Exception ignored) {}
            }
        }
        mgr.updateAppWidget(widgetId, views);
    }
}
`;

// ─── ForegroundService for live lock-screen notification + route bitmap ───────

const LIVE_NOTIFICATION_SERVICE_JAVA = (pkg) => `package ${pkg};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONObject;

public class PaceUpLiveNotificationService extends Service {

    public static final String CHANNEL_ID = "paceup_live_tracking";
    public static final int NOTIFICATION_ID = 9001;

    public static final String ACTION_START  = "${pkg}.action.LIVE_START";
    public static final String ACTION_UPDATE = "${pkg}.action.LIVE_UPDATE";
    public static final String ACTION_STOP   = "${pkg}.action.LIVE_STOP";

    public static final String EXTRA_ELAPSED  = "elapsed";
    public static final String EXTRA_DISTANCE = "distance";
    public static final String EXTRA_PACE     = "pace";
    public static final String EXTRA_TYPE     = "activityType";
    public static final String EXTRA_COORDS   = "routePayload";
    public static final String EXTRA_RUN_ID   = "runId";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        ensureChannel();
        Notification notif = buildNotification(intent);
        startForeground(NOTIFICATION_ID, notif);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Live Tracking", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows real-time stats while a run, ride, or walk is active.");
                ch.setSound(null, null);
                ch.enableVibration(false);
                ch.setShowBadge(false);
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification buildNotification(Intent intent) {
        String elapsed  = intent.getStringExtra(EXTRA_ELAPSED);
        String distance = intent.getStringExtra(EXTRA_DISTANCE);
        String pace     = intent.getStringExtra(EXTRA_PACE);
        String type     = intent.getStringExtra(EXTRA_TYPE);
        String coords   = intent.getStringExtra(EXTRA_COORDS);
        String runId    = intent.getStringExtra(EXTRA_RUN_ID);
        if (elapsed  == null) elapsed  = "00:00";
        if (distance == null) distance = "0.00 mi";
        if (pace     == null) pace     = "--:-- /mi";
        if (type     == null) type     = "run";

        // Activity-specific label and emoji for the notification title
        // "Run" = running person, "Ride" = bicycle, "Walk" = walking person
        String emoji;
        String label;
        if ("Ride".equals(type)) {
            emoji = "\\uD83D\\uDEB4"; // 🚴
            label = "Ride";
        } else if ("Walk".equals(type)) {
            emoji = "\\uD83D\\uDEB6"; // 🚶
            label = "Walk";
        } else {
            emoji = "\\uD83C\\uDFC3"; // 🏃
            label = "Run";
        }

        // Activity-type small icon: 24×24 green circle with initials (R/W/B) drawn on dark bg
        Bitmap iconBitmap = renderActivityIcon(type);

        // Build tap intent — opens live-tracking or group run screen
        Intent tapIntent;
        if (runId != null && !runId.isEmpty()) {
            tapIntent = new Intent(Intent.ACTION_VIEW,
                    android.net.Uri.parse("paceup://run-live/" + runId));
        } else {
            tapIntent = new Intent(Intent.ACTION_VIEW,
                    android.net.Uri.parse("paceup://run-tracking"));
        }
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tapPi = PendingIntent.getActivity(this, 0, tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Render route map bitmap
        Bitmap routeBitmap = renderRouteBitmap(coords);

        // Title includes emoji + label so activity type is visible in the notification header
        String title = emoji + " " + label + " in Progress";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(elapsed + "  \\u00b7  " + distance + "  \\u00b7  " + pace)
                .setOngoing(true)
                .setAutoCancel(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColor(0xFF00D97E)
                .setSilent(true)
                .setContentIntent(tapPi);

        // Use the activity-type icon bitmap for the small icon via IconCompat
        if (iconBitmap != null) {
            builder.setSmallIcon(IconCompat.createWithBitmap(iconBitmap));
        } else {
            builder.setSmallIcon(android.R.drawable.ic_menu_mylocation);
        }

        if (routeBitmap != null) {
            builder.setLargeIcon(routeBitmap);
            builder.setStyle(new NotificationCompat.BigPictureStyle()
                    .bigPicture(routeBitmap)
                    .bigLargeIcon((android.graphics.Bitmap) null));
        }

        return builder.build();
    }

    /**
     * Render a 64×64 activity-type icon: green circle with a single letter.
     * Used as the notification small icon to distinguish run / ride / walk.
     */
    private Bitmap renderActivityIcon(String type) {
        try {
            int size = 64;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            // Transparent background (required for small icons)
            canvas.drawColor(Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR);
            Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            circlePaint.setColor(Color.rgb(0, 217, 126)); // #00D97E
            canvas.drawCircle(size / 2f, size / 2f, size / 2f, circlePaint);
            Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setColor(Color.rgb(5, 12, 9)); // #050C09
            textPaint.setTextSize(32f);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            String letter = "Ride".equals(type) ? "B" : "Walk".equals(type) ? "W" : "R";
            canvas.drawText(letter, size / 2f, size / 2f + 11f, textPaint);
            return bmp;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Render the accumulated GPS route as a green polyline on a dark #050C09 background.
     * Returns a 256x256 Bitmap suitable for use as a notification large icon.
     * Returns null if fewer than 2 coordinates are available.
     */
    private Bitmap renderRouteBitmap(String routePayload) {
        if (routePayload == null || routePayload.isEmpty()) return null;
        try {
            JSONArray arr = new JSONArray(routePayload);
            if (arr.length() < 2) return null;

            // Find bounding box
            double minLat = Double.MAX_VALUE, maxLat = -Double.MAX_VALUE;
            double minLng = Double.MAX_VALUE, maxLng = -Double.MAX_VALUE;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject pt = arr.getJSONObject(i);
                double lat = pt.getDouble("latitude");
                double lng = pt.getDouble("longitude");
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
            }

            // Square up the bounding box with padding
            double latSpan = maxLat - minLat;
            double lngSpan = maxLng - minLng;
            double pad = Math.max(Math.max(latSpan, lngSpan) * 0.15, 0.0001);
            minLat -= pad; maxLat += pad;
            minLng -= pad; maxLng += pad;
            latSpan = maxLat - minLat;
            lngSpan = maxLng - minLng;

            int size = 256;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);

            // Dark background #050C09
            canvas.drawColor(Color.rgb(5, 12, 9));

            // Green path paint
            Paint paint = new Paint();
            paint.setColor(Color.rgb(0, 217, 126));
            paint.setStrokeWidth(4f);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setAntiAlias(true);

            Path routePath = new Path();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject pt = arr.getJSONObject(i);
                double lat = pt.getDouble("latitude");
                double lng = pt.getDouble("longitude");
                float x = (float) ((lng - minLng) / lngSpan * (size - 20)) + 10;
                float y = (float) ((maxLat - lat) / latSpan * (size - 20)) + 10;
                if (i == 0) routePath.moveTo(x, y);
                else routePath.lineTo(x, y);
            }
            canvas.drawPath(routePath, paint);

            // Draw start dot (white) and end dot (bright green)
            Paint dotPaint = new Paint();
            dotPaint.setAntiAlias(true);

            JSONObject first = arr.getJSONObject(0);
            float sx = (float) ((first.getDouble("longitude") - minLng) / lngSpan * (size - 20)) + 10;
            float sy = (float) ((maxLat - first.getDouble("latitude")) / latSpan * (size - 20)) + 10;
            dotPaint.setColor(Color.WHITE);
            canvas.drawCircle(sx, sy, 6f, dotPaint);

            JSONObject last = arr.getJSONObject(arr.length() - 1);
            float ex = (float) ((last.getDouble("longitude") - minLng) / lngSpan * (size - 20)) + 10;
            float ey = (float) ((maxLat - last.getDouble("latitude")) / latSpan * (size - 20)) + 10;
            dotPaint.setColor(Color.rgb(0, 217, 126));
            canvas.drawCircle(ex, ey, 8f, dotPaint);

            return bmp;
        } catch (Exception e) {
            return null;
        }
    }
}
`;

// ─── React Native bridge module ───────────────────────────────────────────────

const NATIVE_MODULE_JAVA = (pkg) => `package ${pkg};

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReadableMap;

import androidx.annotation.NonNull;

public class PaceUpNativeModule extends ReactContextBaseJavaModule {

    PaceUpNativeModule(ReactApplicationContext context) {
        super(context);
    }

    @NonNull
    @Override
    public String getName() { return "PaceUpAndroidBridge"; }

    /** Write widget data to SharedPreferences and broadcast widget update. */
    @ReactMethod
    public void writeWidgetData(String json, Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            SharedPreferences prefs = ctx.getSharedPreferences(
                    PaceUpWidgetDataHelper.PREFS_FILE, Context.MODE_PRIVATE);
            prefs.edit().putString(PaceUpWidgetDataHelper.DATA_KEY, json).apply();
            broadcastWidgetUpdate(ctx);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("WIDGET_ERR", e.getMessage(), e);
        }
    }

    /** Start the foreground live-tracking notification service. */
    @ReactMethod
    public void startLiveNotification(ReadableMap params, Promise promise) {
        try {
            launchService(PaceUpLiveNotificationService.ACTION_START, params, promise);
        } catch (Exception e) {
            promise.reject("LIVE_ERR", e.getMessage(), e);
        }
    }

    /** Update stats + route bitmap in the foreground notification. */
    @ReactMethod
    public void updateLiveNotification(ReadableMap params, Promise promise) {
        try {
            launchService(PaceUpLiveNotificationService.ACTION_UPDATE, params, promise);
        } catch (Exception e) {
            promise.reject("LIVE_ERR", e.getMessage(), e);
        }
    }

    /** Stop the foreground notification service. */
    @ReactMethod
    public void stopLiveNotification(Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Intent intent = new Intent(ctx, PaceUpLiveNotificationService.class);
            intent.setAction(PaceUpLiveNotificationService.ACTION_STOP);
            ctx.startService(intent);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("LIVE_ERR", e.getMessage(), e);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void launchService(String action, ReadableMap params, Promise promise) {
        Context ctx = getReactApplicationContext();
        Intent intent = new Intent(ctx, PaceUpLiveNotificationService.class);
        intent.setAction(action);
        if (params != null) {
            if (params.hasKey("elapsed"))       intent.putExtra(PaceUpLiveNotificationService.EXTRA_ELAPSED,  params.getString("elapsed"));
            if (params.hasKey("distance"))      intent.putExtra(PaceUpLiveNotificationService.EXTRA_DISTANCE, params.getString("distance"));
            if (params.hasKey("pace"))          intent.putExtra(PaceUpLiveNotificationService.EXTRA_PACE,     params.getString("pace"));
            if (params.hasKey("activityType"))  intent.putExtra(PaceUpLiveNotificationService.EXTRA_TYPE,     params.getString("activityType"));
            if (params.hasKey("routePayload"))  intent.putExtra(PaceUpLiveNotificationService.EXTRA_COORDS,   params.getString("routePayload"));
            if (params.hasKey("runId"))         intent.putExtra(PaceUpLiveNotificationService.EXTRA_RUN_ID,   params.getString("runId"));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
        promise.resolve(null);
    }

    private void broadcastWidgetUpdate(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] smallIds = mgr.getAppWidgetIds(new ComponentName(ctx, PaceUpWidgetSmall.class));
        int[] medIds   = mgr.getAppWidgetIds(new ComponentName(ctx, PaceUpWidgetMedium.class));
        for (int id : smallIds) PaceUpWidgetSmall.updateWidget(ctx, mgr, id);
        for (int id : medIds)   PaceUpWidgetMedium.updateWidget(ctx, mgr, id);
    }
}
`;

const NATIVE_PACKAGE_JAVA = (pkg) => `package ${pkg};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;

public class PaceUpNativePackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext ctx) {
        return Collections.singletonList(new PaceUpNativeModule(ctx));
    }
    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext ctx) {
        return Collections.emptyList();
    }
}
`;

// ─── Plugin ──────────────────────────────────────────────────────────────────

function withAndroidWidget(config) {
  const pkg = config.android?.package ?? PACKAGE_NAME;

  // 1. Write native source files
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const pkgPath = pkg.replace(/\./g, "/");
      const javaSrcDir = path.join(androidRoot, "app", "src", "main", "java", ...pkgPath.split("/"));
      fs.mkdirSync(javaSrcDir, { recursive: true });

      fs.writeFileSync(path.join(javaSrcDir, "PaceUpWidgetDataHelper.java"), WIDGET_DATA_HELPER_JAVA(pkg), "utf8");
      fs.writeFileSync(path.join(javaSrcDir, "PaceUpWidgetSmall.java"),      WIDGET_SMALL_JAVA(pkg),        "utf8");
      fs.writeFileSync(path.join(javaSrcDir, "PaceUpWidgetMedium.java"),     WIDGET_MEDIUM_JAVA(pkg),       "utf8");
      fs.writeFileSync(path.join(javaSrcDir, "PaceUpLiveNotificationService.java"), LIVE_NOTIFICATION_SERVICE_JAVA(pkg), "utf8");
      fs.writeFileSync(path.join(javaSrcDir, "PaceUpNativeModule.java"),     NATIVE_MODULE_JAVA(pkg),       "utf8");
      fs.writeFileSync(path.join(javaSrcDir, "PaceUpNativePackage.java"),    NATIVE_PACKAGE_JAVA(pkg),      "utf8");

      // Layout directory
      const layoutDir = path.join(androidRoot, "app", "src", "main", "res", "layout");
      fs.mkdirSync(layoutDir, { recursive: true });
      fs.writeFileSync(path.join(layoutDir, "paceup_widget_small.xml"),  SMALL_LAYOUT_XML,  "utf8");
      fs.writeFileSync(path.join(layoutDir, "paceup_widget_medium.xml"), MEDIUM_LAYOUT_XML, "utf8");

      // XML directory (widget info)
      const xmlDir = path.join(androidRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "paceup_widget_info_small.xml"),  WIDGET_INFO_SMALL_XML,  "utf8");
      fs.writeFileSync(path.join(xmlDir, "paceup_widget_info_medium.xml"), WIDGET_INFO_MEDIUM_XML, "utf8");

      // Values directory (strings)
      const valuesDir = path.join(androidRoot, "app", "src", "main", "res", "values");
      fs.mkdirSync(valuesDir, { recursive: true });
      fs.writeFileSync(path.join(valuesDir, "paceup_widget_strings.xml"), WIDGET_STRINGS_XML, "utf8");

      return cfg;
    },
  ]);

  // 2. Register the ReactPackage in MainApplication (handles both Java and Kotlin variants)
  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Only add if not already present (idempotent)
    if (src.includes("PaceUpNativePackage")) return cfg;

    const isKotlin = cfg.modResults.path?.endsWith(".kt");

    if (isKotlin) {
      // Kotlin MainApplication.kt (Expo SDK 52+ / New Architecture)
      // Import
      src = src.replace(
        /^(import com\.facebook\.react\.ReactApplication)/m,
        `import ${pkg}.PaceUpNativePackage\n$1`
      );
      // Inject into getPackages() apply block: look for "// add(MyReactNativePackage())" comment
      // or just before the closing brace of the apply block.
      src = src.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{[^}]*)(})/s,
        `$1  add(PaceUpNativePackage())\n      $2`
      );
    } else {
      // Java MainApplication.java (older SDK)
      src = src.replace(
        /^(import com\.facebook\.react\.ReactApplication;)/m,
        `import ${pkg}.PaceUpNativePackage;\n$1`
      );
      src = src.replace(
        /packages\.add\(new PackageList\(this\)\.getPackages\(\)\);/,
        `packages.add(new PackageList(this).getPackages());\n          packages.add(new PaceUpNativePackage());`
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });

  // 3. Inject AndroidManifest.xml entries
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application?.[0];
    if (!app) return cfg;

    app.receiver = app.receiver ?? [];
    app.service  = app.service  ?? [];

    // Idempotency: skip if already added
    const alreadyAdded = app.receiver.some(
      (r) => r.$?.["android:name"] === ".PaceUpWidgetSmall"
    );
    if (alreadyAdded) return cfg;

    // Small widget receiver
    app.receiver.push({
      $: {
        "android:name": ".PaceUpWidgetSmall",
        "android:exported": "true",
        "android:label": "@string/paceup_widget_small_name",
      },
      "intent-filter": [{ action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] }],
      "meta-data": [{ $: { "android:name": "android.appwidget.provider", "android:resource": "@xml/paceup_widget_info_small" } }],
    });

    // Medium widget receiver
    app.receiver.push({
      $: {
        "android:name": ".PaceUpWidgetMedium",
        "android:exported": "true",
        "android:label": "@string/paceup_widget_medium_name",
      },
      "intent-filter": [{ action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] }],
      "meta-data": [{ $: { "android:name": "android.appwidget.provider", "android:resource": "@xml/paceup_widget_info_medium" } }],
    });

    // Foreground service
    app.service.push({
      $: {
        "android:name": ".PaceUpLiveNotificationService",
        "android:exported": "false",
        "android:foregroundServiceType": "location",
      },
    });

    return cfg;
  });

  return config;
}

module.exports = withAndroidWidget;
