package lol.tvn.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import org.json.JSONObject;

/**
 * TVN in a full-screen web view: https://tvn.lol, with file picking, EXPORT saving and full-screen video. TVN Full
 * carries the whole site in its assets and answers tvn.lol from them, so the page keeps its real address (YouTube
 * embeds need it) and opens without a connection; only adding a YouTube channel or podcast goes to tvn.lol.
 */
public class MainActivity extends Activity {
  private static final String HOME = "https://tvn.lol/";
  private static final String SITE = "tvn.lol";
  private static final int PICK_FILES = 1;
  private static final String OFFLINE =
      "<!doctype html><meta name=viewport content='width=device-width'><body style='margin:0;height:100vh;display:grid;place-items:center;"
          + "background:#000;color:#c9d3dc;font:16px sans-serif'><div style='text-align:center'>TVN needs an internet connection."
          + "<br><br><a href='" + HOME + "' style='color:#e8c35a'>TRY AGAIN</a></div></body>";

  /**
   * Runs in the TVN page only. EXPORT hands the browser a temporary blob address and releases it at once; a web
   * view cannot download that, so the page's blobs are kept until saved, and a download link sends its file to
   * the app over a private message port that only the TVN page holds.
   */
  private static final String SAVE_BRIDGE =
      "(function(){if(window.__tvnApp)return;window.__tvnApp=true;var port=null,kept=new Map();"
          + "var make=URL.createObjectURL,drop=URL.revokeObjectURL;"
          + "URL.createObjectURL=function(o){var u=make.call(URL,o);if(o instanceof Blob&&!(o instanceof File))kept.set(u,o);return u};"
          + "URL.revokeObjectURL=function(u){var b=kept.get(u);setTimeout(function(){kept.delete(u);drop.call(URL,u)},b?60000:0)};"
          + "window.addEventListener('message',function(e){if(!port&&e.source===null&&e.data==='tvn-app'&&e.ports&&e.ports[0])port=e.ports[0]});"
          + "var click=HTMLAnchorElement.prototype.click;"
          + "HTMLAnchorElement.prototype.click=function(){var b=kept.get(this.href);if(!port||!b||!this.hasAttribute('download'))return click.call(this);"
          + "var name=this.getAttribute('download')||'tvn-export.json',r=new FileReader();"
          + "r.onload=function(){port.postMessage(JSON.stringify({name:name,type:b.type||'application/octet-stream',data:String(r.result).split(',')[1]||''}))};"
          + "r.readAsDataURL(b)}})()";

  private WebView web;
  private FrameLayout root;
  private View fullscreen;
  private WebChromeClient.CustomViewCallback fullscreenDone;
  private ValueCallback<Uri[]> picked;
  private WebMessagePort[] ports;
  private boolean full;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    setContentView(root);
    immersive();
    full = bundled("index.html") != null;

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setSupportMultipleWindows(false);
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(true);
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (!request.isForMainFrame()) return false;
        Uri url = request.getUrl();
        if (ownPage(url)) return false;
        openOutside(url);
        return true;
      }

      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (!full || !"GET".equals(request.getMethod())) return null;
        Uri url = request.getUrl();
        String host = url.getHost();
        if (!"https".equals(url.getScheme()) || host == null || !(host.equals(SITE) || host.equals("www." + SITE))) return null;
        String path = url.getPath() == null || url.getPath().isEmpty() ? "/" : url.getPath();
        if (path.startsWith("/api/")) return null;
        String name = path.equals("/") ? "index.html" : path.substring(1);
        InputStream body = name.contains("..") ? null : bundled(name);
        if (body == null) {
          name = "index.html";
          body = bundled(name);
        }
        String type = typeOf(name);
        WebResourceResponse response = new WebResourceResponse(type, type.startsWith("text/") || type.endsWith("json") ? "utf-8" : null, body);
        response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
        return response;
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        if (ownPage(Uri.parse(url))) connectSaving();
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) view.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null);
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onShowCustomView(View view, CustomViewCallback callback) {
        if (fullscreen != null) {
          callback.onCustomViewHidden();
          return;
        }
        fullscreen = view;
        fullscreenDone = callback;
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setVisibility(View.GONE);
        immersive();
      }

      @Override
      public void onHideCustomView() {
        leaveFullscreen();
      }

      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (picked != null) picked.onReceiveValue(null);
        picked = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
        try {
          startActivityForResult(intent, PICK_FILES);
        } catch (ActivityNotFoundException missing) {
          picked = null;
          return false;
        }
        return true;
      }
    });

    if (saved != null) web.restoreState(saved);
    else web.loadUrl(HOME);
  }

  /** A file of the site carried in the app, or null. */
  private InputStream bundled(String name) {
    try {
      return getAssets().open("site/" + name);
    } catch (IOException missing) {
      return null;
    }
  }

  private static String typeOf(String name) {
    String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
    switch (ext) {
      case "html": return "text/html";
      case "js": case "mjs": return "text/javascript";
      case "css": return "text/css";
      case "json": case "map": return "application/json";
      case "webmanifest": return "application/manifest+json";
      case "svg": return "image/svg+xml";
      case "png": return "image/png";
      case "jpg": case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      case "gif": return "image/gif";
      case "ico": return "image/x-icon";
      case "woff2": return "font/woff2";
      case "woff": return "font/woff";
      case "ttf": return "font/ttf";
      case "txt": return "text/plain";
      default: return "application/octet-stream";
    }
  }

  private static boolean ownPage(Uri url) {
    String scheme = url.getScheme();
    if ("about".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)) return true;
    String host = url.getHost();
    return "https".equals(scheme) && host != null && (host.equals(SITE) || host.equals("www." + SITE));
  }

  private void openOutside(Uri url) {
    String scheme = url.getScheme();
    if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) return;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, url));
    } catch (ActivityNotFoundException ignored) {
      // Nothing on this device opens it.
    }
  }

  /** Gives the TVN page its end of a fresh message port; only the top page is addressed. */
  private void connectSaving() {
    web.evaluateJavascript(SAVE_BRIDGE, ignored -> {
      ports = web.createWebMessageChannel();
      ports[0].setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
        @Override
        public void onMessage(WebMessagePort port, WebMessage message) {
          save(message.getData());
        }
      });
      web.postWebMessage(new WebMessage("tvn-app", new WebMessagePort[] {ports[1]}), Uri.parse(HOME));
    });
  }

  private void save(String json) {
    try {
      JSONObject file = new JSONObject(json);
      String name = new File(file.optString("name", "tvn-export.json")).getName();
      if (name.isEmpty()) name = "tvn-export.json";
      byte[] bytes = Base64.decode(file.optString("data", ""), Base64.DEFAULT);
      String type = file.optString("type", "application/octet-stream");
      if (Build.VERSION.SDK_INT >= 29) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, type);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (target == null) throw new IllegalStateException("no destination");
        try (OutputStream out = getContentResolver().openOutputStream(target)) {
          out.write(bytes);
        }
        Toast.makeText(this, "Saved to Downloads: " + name, Toast.LENGTH_LONG).show();
      } else {
        File folder = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File target = new File(folder, name);
        try (FileOutputStream out = new FileOutputStream(target)) {
          out.write(bytes);
        }
        Toast.makeText(this, "Saved: " + target.getAbsolutePath(), Toast.LENGTH_LONG).show();
      }
    } catch (Exception failed) {
      Toast.makeText(this, "The file could not be saved", Toast.LENGTH_LONG).show();
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    if (request != PICK_FILES || picked == null) {
      super.onActivityResult(request, result, data);
      return;
    }
    Uri[] uris = null;
    if (result == RESULT_OK && data != null) {
      if (data.getClipData() != null) {
        uris = new Uri[data.getClipData().getItemCount()];
        for (int i = 0; i < uris.length; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
      } else if (data.getData() != null) {
        uris = new Uri[] {data.getData()};
      }
    }
    picked.onReceiveValue(uris);
    picked = null;
  }

  private void leaveFullscreen() {
    if (fullscreen == null) return;
    root.removeView(fullscreen);
    fullscreen = null;
    web.setVisibility(View.VISIBLE);
    if (fullscreenDone != null) fullscreenDone.onCustomViewHidden();
    fullscreenDone = null;
    immersive();
  }

  @SuppressWarnings("deprecation")
  private void immersive() {
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = getWindow().getInsetsController();
      if (controller != null) {
        controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
  }

  @Override
  public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (focused) immersive();
  }

  @Override
  @SuppressWarnings("deprecation")
  public void onBackPressed() {
    if (fullscreen != null) leaveFullscreen();
    else if (web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    web.saveState(state);
  }

  @Override
  protected void onPause() {
    super.onPause();
    web.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    web.onResume();
    immersive();
  }

  @Override
  protected void onDestroy() {
    if (ports != null) for (WebMessagePort port : ports) port.close();
    web.destroy();
    super.onDestroy();
  }
}
