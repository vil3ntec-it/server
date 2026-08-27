package ir.vil3ntec.tohid

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
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
import androidx.appcompat.app.AlertDialog
import androidx.core.view.WindowCompat
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.LinearLayout
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
  private lateinit var prefs: SharedPreferences

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

  /** اجازهٔ بلوتوث — برای دیدن و وصل شدن به چاپگرِ حرارتی */
  private val askBluetooth = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) { granted ->
    if (granted) askPrinter() else toast("بدون اجازهٔ بلوتوث، چاپگر پیدا نمی‌شود")
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

    prefs = getSharedPreferences("tohid", MODE_PRIVATE)

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
      ): WebResourceResponse? =
        // اول فایل‌های خودِ برنامه، بعد چیزهایی که وگرنه از اینترنت می‌آمدند
        loader.shouldInterceptRequest(request.url)
          ?: Offline.handle(this@MainActivity, request.url)

      override fun onPageFinished(view: WebView, url: String) {
        injectBridge(view)
        applyServerAddress(view)
        // بارِ اول: بپرس آدرس سرور کجاست. اگر کاربر خالی بگذارد، دیگر
        // نمی‌پرسیم — برنامه بدونِ سرور هم کامل کار می‌کند.
        if (!prefs.contains(KEY_SERVER)) {
          prefs.edit().putString(KEY_SERVER, "").apply()
          view.post { askServerAddress() }
        }
        handleShortcut(intent)
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

  /* ------------------------- تنظیماتِ خودِ برنامه ------------------------- */

  /**
   * صفحه تمام‌صفحه است و نوار عنوان ندارد — عمداً، تا هیچ‌چیز شبیه مرورگر
   * نباشد. پس تنظیمات از دو راه در دسترس است:
   *   • بارِ اول خودش می‌پرسد
   *   • بعد از آن: نگه داشتنِ آیکنِ برنامه روی صفحهٔ گوشی
   */
  private fun handleShortcut(intent: Intent?) {
    when (intent?.getStringExtra(EXTRA_OPEN)) {
      "server" -> askServerAddress()
      "printer" -> askPrinter()
    }
    intent?.removeExtra(EXTRA_OPEN)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleShortcut(intent)
  }

  /**
   * آدرس سرور.
   *
   * خودِ برنامه هیچ جایی برای وارد کردنِ آدرس سرور ندارد — نه در تنظیمات و
   * نه جای دیگر؛ فقط از localStorage می‌خواندش. پس این صفحه را سمتِ اندروید
   * می‌گذاریم و مقدار را در همان کلید می‌نشانیم. برنامه دست‌نخورده می‌ماند.
   */
  private fun askServerAddress() {
    val input = EditText(this).apply {
      hint = "http://192.168.1.10:4700"
      setText(prefs.getString(KEY_SERVER, "") ?: "")
      setSingleLine()
    }
    val box = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(48, 24, 48, 0)
      addView(input)
    }
    AlertDialog.Builder(this)
      .setTitle("آدرس سرور")
      .setMessage("آدرس را از پنل، بخش «برنامه توحید» → «تنظیمات» بردارید.\nخالی بگذارید تا برنامه بدون سرور کار کند.")
      .setView(box)
      .setPositiveButton("ذخیره") { _, _ ->
        val value = input.text.toString().trim().trimEnd('/')
        if (value.isNotEmpty() && !value.startsWith("http://") && !value.startsWith("https://")) {
          toast("آدرس باید با http:// شروع شود")
          return@setPositiveButton
        }
        prefs.edit().putString(KEY_SERVER, value).apply()
        // برنامه آدرس را موقعِ بالا آمدن می‌خواند، پس باید دوباره بار شود
        web.reload()
        toast(if (value.isEmpty()) "آدرس پاک شد" else "ذخیره شد")
      }
      .setNegativeButton("بی‌خیال", null)
      .show()
  }

  /** آدرس را در همان کلیدی می‌گذارد که برنامه می‌خواند */
  private fun applyServerAddress(view: WebView) {
    val value = prefs.getString(KEY_SERVER, "") ?: ""
    val js = if (value.isEmpty()) {
      "try{localStorage.removeItem('tohid-license-server-url')}catch(e){}"
    } else {
      "try{localStorage.setItem('tohid-license-server-url', ${quote(value)})}catch(e){}"
    }
    view.evaluateJavascript(js, null)
  }

  private fun quote(value: String) =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

  /** انتخابِ چاپگرِ حرارتی از میانِ دستگاه‌های جفت‌شدهٔ بلوتوث */
  private fun askPrinter() {
    // اندروید ۱۲ به بعد برای دیدنِ دستگاه‌های بلوتوث اجازه می‌خواهد
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
      != PackageManager.PERMISSION_GRANTED
    ) {
      askBluetooth.launch(Manifest.permission.BLUETOOTH_CONNECT)
      return
    }

    val printers = ThermalPrinter.paired(this)
    if (printers.isEmpty()) {
      AlertDialog.Builder(this)
        .setTitle("چاپگر حرارتی")
        .setMessage("چاپگری پیدا نشد.\n\nاول در تنظیماتِ بلوتوثِ گوشی، چاپگر را جفت (pair) کنید، بعد اینجا برگردید.")
        .setPositiveButton("باشد", null)
        .show()
      return
    }

    val names = printers.map { it.name }.toTypedArray()
    val saved = prefs.getString(KEY_PRINTER, null)
    var chosen = printers.indexOfFirst { it.address == saved }.coerceAtLeast(0)

    AlertDialog.Builder(this)
      .setTitle("چاپگر حرارتی")
      .setSingleChoiceItems(ArrayAdapter(this, android.R.layout.simple_list_item_single_choice, names), chosen) { _, which ->
        chosen = which
      }
      .setPositiveButton("انتخاب") { _, _ ->
        prefs.edit().putString(KEY_PRINTER, printers[chosen].address).apply()
        askPaperWidth()
      }
      .setNeutralButton("چاپگر معمولی") { _, _ ->
        prefs.edit().remove(KEY_PRINTER).apply()
        toast("چاپ از راهِ چاپگرِ اندروید انجام می‌شود")
      }
      .setNegativeButton("بی‌خیال", null)
      .show()
  }

  private fun askPaperWidth() {
    val widths = arrayOf("۵۸ میلی‌متر", "۸۰ میلی‌متر")
    val current = if (prefs.getInt(KEY_PAPER, ThermalPrinter.WIDTH_58MM) == ThermalPrinter.WIDTH_80MM) 1 else 0
    AlertDialog.Builder(this)
      .setTitle("عرض کاغذ")
      .setSingleChoiceItems(widths, current) { dialog, which ->
        prefs.edit().putInt(
          KEY_PAPER,
          if (which == 1) ThermalPrinter.WIDTH_80MM else ThermalPrinter.WIDTH_58MM,
        ).apply()
        dialog.dismiss()
        toast("چاپگر تنظیم شد")
      }
      .show()
  }

  /** صفحه را همان‌طور که هست به تصویر می‌گیرد — با فارسیِ درست */
  private fun snapshot(): Bitmap {
    val width = if (web.width > 0) web.width else 720
    val height = (web.contentHeight * web.scale).toInt().coerceAtLeast(web.height).coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(android.graphics.Color.WHITE)
    web.draw(canvas)
    return bitmap
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

  companion object {
    private const val KEY_SERVER = "server_url"
    private const val KEY_PRINTER = "printer_address"
    private const val KEY_PAPER = "paper_width"
    const val EXTRA_OPEN = "open"
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
        val printer = prefs.getString(KEY_PRINTER, null)
        if (printer.isNullOrEmpty()) {
          // چاپگرِ حرارتی انتخاب نشده — از راهِ چاپگرِ خودِ اندروید
          val manager = getSystemService(PRINT_SERVICE) as PrintManager
          val adapter = web.createPrintDocumentAdapter("توحید")
          manager.print(
            "توحید",
            adapter,
            PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build(),
          )
          return@runOnUiThread
        }

        toast("در حال چاپ…")
        val bitmap = snapshot()
        val width = prefs.getInt(KEY_PAPER, ThermalPrinter.WIDTH_58MM)
        // شبکه و بلوتوث نباید روی نخِ رابط کاربری باشند، وگرنه برنامه یخ می‌زند
        Thread {
          val error = ThermalPrinter.print(this@MainActivity, printer, bitmap, width)
          runOnUiThread { toast(error ?: "چاپ شد") }
        }.start()
      }
    }
  }
}
