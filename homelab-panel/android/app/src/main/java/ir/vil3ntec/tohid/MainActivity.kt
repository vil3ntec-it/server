package ir.vil3ntec.tohid

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import java.io.OutputStream

/**
 *  توحید — همان برنامهٔ وب، داخلِ یک برنامهٔ واقعیِ اندروید.
 *
 *  فایلِ HTML یک بایت هم عوض نشده. هر کاری که لازم بوده اینجا در سمتِ
 *  اندروید انجام شده، نه با دست بردن در خودِ برنامه.
 *
 *  چرا از appassets.androidplatform.net روی https بار می‌شود، نه file://
 *  ─────────────────────────────────────────────────────────────────────
 *  برنامه برای بررسی امضای اشتراک از crypto.subtle استفاده می‌کند و آن فقط
 *  در «زمینهٔ امن» وجود دارد. file:// زمینهٔ امن نیست، پس crypto.subtle
 *  اصلاً تعریف نمی‌شد و بررسی License از کار می‌افتاد. WebViewAssetLoader
 *  همان فایل‌ها را روی یک مبدأ https سرو می‌کند و مشکل حل می‌شود.
 *
 *  و چون سرورِ خانگی روی http ساده است، محتوای ترکیبی باز گذاشته می‌شود تا
 *  صفحهٔ https بتواند با آن حرف بزند.
 */
class MainActivity : AppCompatActivity() {

  private lateinit var web: WebView
  private var filePathCallback: ValueCallback<Array<Uri>>? = null
  private var pendingPermission: PermissionRequest? = null
  private var pendingBytes: ByteArray? = null

  /** انتخاب فایل — برای بازگرداندن بکاپ و گذاشتن عکس روی جنس */
  private val pickFiles = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val callback = filePathCallback ?: return@registerForActivityResult
    filePathCallback = null
    callback.onReceiveValue(
      WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
    )
  }

  /** دوربین — برای اسکنر بارکد و عکسِ جنس */
  private val askCamera = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) { granted ->
    val request = pendingPermission ?: return@registerForActivityResult
    pendingPermission = null
    if (granted) request.grant(request.resources) else request.deny()
  }

  /** جایی که کاربر انتخاب می‌کند فایلِ خروجی کجا ذخیره شود */
  private val saveFile = registerForActivityResult(
    ActivityResultContracts.CreateDocument("*/*")
  ) { uri ->
    val data = pendingBytes
    pendingBytes = null
    if (uri == null || data == null) return@registerForActivityResult
    try {
      contentResolver.openOutputStream(uri)?.use { out: OutputStream -> out.write(data) }
      toast("فایل ذخیره شد")
    } catch (e: Exception) {
      toast("ذخیره نشد: ${e.message}")
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, true)

    web = WebView(this)
    setContentView(web)

    val loader = WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
      .build()

    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true          // localStorage — همهٔ داده‌های برنامه اینجاست
      databaseEnabled = true
      allowFileAccess = false           // لازم نیست، پس بسته می‌ماند
      allowContentAccess = false
      mediaPlaybackRequiresUserGesture = false
      // صفحهٔ https باید بتواند با سرورِ خانگی روی http حرف بزند
      mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
      useWideViewPort = true
      loadWithOverviewMode = false
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      textZoom = 100                    // اندازهٔ متنِ سیستم چیدمان را به‌هم نریزد
    }

    web.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(
        view: WebView, request: WebResourceRequest
      ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

      override fun onPageFinished(view: WebView, url: String) {
        injectBridge(view)
      }

      override fun shouldOverrideUrlLoading(
        view: WebView, request: WebResourceRequest
      ): Boolean {
        val url = request.url
        // خودِ برنامه داخل می‌ماند؛ پیوندهای بیرونی (مثلاً واتساپ) در
        // برنامهٔ خودشان باز شوند
        if (url.host == "appassets.androidplatform.net") return false
        return try {
          startActivity(Intent(Intent.ACTION_VIEW, url))
          true
        } catch (e: Exception) {
          false
        }
      }
    }

    web.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        // فقط دوربین، و فقط وقتی خودِ کاربر اسکنر را باز کرده باشد
        if (request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }) {
          if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
          ) {
            request.grant(request.resources)
          } else {
            pendingPermission = request
            askCamera.launch(Manifest.permission.CAMERA)
          }
        } else {
          request.deny()
        }
      }

      override fun onShowFileChooser(
        webView: WebView,
        callback: ValueCallback<Array<Uri>>,
        params: FileChooserParams
      ): Boolean {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = callback
        return try {
          pickFiles.launch(params.createIntent())
          true
        } catch (e: Exception) {
          filePathCallback = null
          false
        }
      }
    }

    web.addJavascriptInterface(Bridge(), "AndroidBridge")

    // دکمهٔ برگشتِ گوشی: اول داخلِ برنامه عقب می‌رود، بعد بیرون می‌آید
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (web.canGoBack()) web.goBack() else finish()
      }
    })

    if (savedInstanceState != null) {
      web.restoreState(savedInstanceState)
    } else {
      web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    web.saveState(outState)
  }

  private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

  /**
   * دو چیز در WebView کار نمی‌کنند و برنامه به هر دو نیاز دارد:
   *
   *   • دانلودِ blob: — «پشتیبان‌گیری» و «خروجی اکسل» فایل را در حافظه
   *     می‌سازند و با یک لینک دانلود می‌کنند. WebView چنین لینکی را نادیده
   *     می‌گیرد و کاربر فکر می‌کند دکمه خراب است.
   *   • window.print — «چاپ فاکتور» در WebView هیچ کاری نمی‌کند.
   *
   * این تکه‌کد از سمتِ اندروید تزریق می‌شود و هر دو را به خودِ سیستم‌عامل
   * وصل می‌کند. فایلِ HTML دست‌نخورده می‌ماند.
   */
  private fun injectBridge(view: WebView) {
    val js = """
      (function () {
        if (window.__tohidBridge) return;
        window.__tohidBridge = true;

        window.print = function () { AndroidBridge.printPage(); };

        function send(blob, name) {
          var reader = new FileReader();
          reader.onload = function () {
            var s = String(reader.result);
            var comma = s.indexOf(',');
            AndroidBridge.saveFile(name, blob.type || 'application/octet-stream', s.slice(comma + 1));
          };
          reader.readAsDataURL(blob);
        }

        document.addEventListener('click', function (e) {
          var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
          if (!a) return;
          var href = a.getAttribute('href') || '';
          if (href.indexOf('blob:') !== 0 && href.indexOf('data:') !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          var name = a.getAttribute('download') || 'file';
          fetch(href).then(function (r) { return r.blob(); }).then(function (b) { send(b, name); });
        }, true);
      })();
    """.trimIndent()
    view.evaluateJavascript(js, null)
  }

  inner class Bridge {
    @JavascriptInterface
    fun saveFile(name: String, mime: String, base64: String) {
      val bytes = try {
        Base64.decode(base64, Base64.DEFAULT)
      } catch (e: Exception) {
        runOnUiThread { toast("فایل خوانده نشد") }
        return
      }
      runOnUiThread {
        pendingBytes = bytes
        saveFile.launch(name)
      }
    }

    @JavascriptInterface
    fun printPage() {
      runOnUiThread {
        val manager = getSystemService(PRINT_SERVICE) as PrintManager
        val adapter = web.createPrintDocumentAdapter("توحید")
        manager.print(
          "توحید",
          adapter,
          PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build()
        )
      }
    }
  }
}
