package fr.anounis.gaming;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Widget écran d'accueil : les 3 dernières infos, lues dans les préférences écrites par l'appli. */
public class WidgetProvider extends AppWidgetProvider {
    private static final int[] TITLES = { R.id.w_t1, R.id.w_t2, R.id.w_t3 };
    private static final int[] SUBS = { R.id.w_s1, R.id.w_s2, R.id.w_s3 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_news);
            try {
                // deux sources : l'appli (à l'ouverture) et la tâche de fond (toutes les 30 min) ; on prend la plus récente
                JSONObject app = new JSONObject(context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("widget", "{}"));
                JSONObject bg = new JSONObject(context.getSharedPreferences("fr.anounis.gaming.check", Context.MODE_PRIVATE).getString("widget", "{}"));
                JSONObject data = bg.optLong("at", 0) > app.optLong("at", 0) ? bg : app;
                JSONArray items = data.optJSONArray("items");
                for (int i = 0; i < 3; i++) {
                    if (items != null && i < items.length()) {
                        JSONObject it = items.getJSONObject(i);
                        views.setTextViewText(TITLES[i], it.optString("t"));
                        views.setTextViewText(SUBS[i], it.optString("s"));
                        views.setViewVisibility(TITLES[i], View.VISIBLE);
                        views.setViewVisibility(SUBS[i], View.VISIBLE);
                    } else {
                        views.setTextViewText(TITLES[i], i == 0 ? "Ouvre l'appli pour charger le fil" : "");
                        views.setViewVisibility(SUBS[i], View.GONE);
                    }
                }
            } catch (Exception e) {
                views.setTextViewText(R.id.w_t1, "Ouvre l'appli pour charger le fil");
            }
            Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (open != null) {
                PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                views.setOnClickPendingIntent(R.id.w_root, pi);
            }
            manager.updateAppWidget(id, views);
        }
    }
}
