package ir.vil3ntec.tohid.scan

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 *  اسکنِ بارکد با دوربینِ خودِ اندروید.
 *
 *  چرا این‌طوری و نه مثل قبل:
 *    • موتورِ خواندن روی خودِ گوشی است (ML Kit با مدلِ داخلِ برنامه). نه
 *      اینترنت می‌خواهد نه کتابخانه‌ای که از اینترنت بار شود — دکان ممکن
 *      است نت نداشته باشد.
 *    • هر فریم **همیشه** بسته می‌شود، چه بارکد پیدا شود چه نه. باگی که
 *      گزارش شد («بعد از یک اسکن از کار می‌افتد») دقیقاً همین بود: فریمِ
 *      بسته‌نشده صف را پر می‌کند و دوربین دیگر فریمِ تازه نمی‌دهد.
 *    • فقط همان قالب‌های بارکدی خوانده می‌شود که نسخهٔ وب می‌خواند، تا
 *      کالایی که آنجا شناخته می‌شد اینجا هم شناخته شود.
 */

/** همان فهرستِ SUPPORTED_BARCODE_FORMATS نسخهٔ وب */
private const val FORMATS = Barcode.FORMAT_EAN_13 or
  Barcode.FORMAT_EAN_8 or
  Barcode.FORMAT_UPC_A or
  Barcode.FORMAT_UPC_E or
  Barcode.FORMAT_CODE_128 or
  Barcode.FORMAT_CODE_39 or
  Barcode.FORMAT_ITF

@SuppressLint("UnsafeOptInUsageError")
@Composable
fun CameraScanner(
  onCode: (String) -> Unit,
  onStatus: (String, Boolean) -> Unit,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current

  // مقدارِ تازهٔ onCode بدونِ بستنِ دوباره‌ی دوربین
  val latestCode by rememberUpdatedState(onCode)
  val latestStatus by rememberUpdatedState(onStatus)

  val executor: ExecutorService = remember { Executors.newSingleThreadExecutor() }
  val previewView = remember {
    PreviewView(context).apply {
      scaleType = PreviewView.ScaleType.FILL_CENTER
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    }
  }

  DisposableEffect(Unit) {
    val scanner = BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder().setBarcodeFormats(FORMATS).build()
    )
    var provider: ProcessCameraProvider? = null

    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      val cameraProvider = runCatching { future.get() }.getOrNull()
      if (cameraProvider == null) {
        latestStatus("دوربین در دسترس نیست", true)
        return@addListener
      }
      provider = cameraProvider

      val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }

      val analysis = ImageAnalysis.Builder()
        // فقط تازه‌ترین فریم؛ فریمِ کهنه به درد اسکن نمی‌خورد و صف را پر می‌کند
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()

      analysis.setAnalyzer(executor) { proxy ->
        val media = proxy.image
        if (media == null) {
          proxy.close()
          return@setAnalyzer
        }
        val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
        scanner.process(image)
          .addOnSuccessListener { codes ->
            val value = codes.firstOrNull()?.rawValue
            if (!value.isNullOrBlank()) latestCode(value)
          }
          .addOnFailureListener { Log.d("Tohid", "خواندن فریم ناموفق", it) }
          // هرچه پیش بیاید فریم بسته می‌شود؛ وگرنه اسکن بعدی هرگز نمی‌آید
          .addOnCompleteListener { proxy.close() }
      }

      runCatching {
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(
          lifecycleOwner,
          CameraSelector.DEFAULT_BACK_CAMERA,
          preview,
          analysis,
        )
      }.onSuccess {
        latestStatus("آماده اسکن — بارکد را جلوی دوربین بگیرید", false)
      }.onFailure {
        latestStatus("دوربین باز نشد: ${it.message ?: "دلیل نامعلوم"}", true)
      }
    }, ContextCompat.getMainExecutor(context))

    onDispose {
      runCatching { provider?.unbindAll() }
      runCatching { scanner.close() }
      executor.shutdown()
    }
  }

  AndroidView(factory = { previewView }, modifier = modifier)
}

/**
 *  جلوگیری از اسکنِ تکراری.
 *
 *  دوربین یک بارکد را در یک ثانیه ده‌ها بار می‌بیند. بدونِ این، یک بار
 *  گرفتنِ کالا جلوی دوربین ده‌ها عدد به سبد اضافه می‌کرد.
 *  پنجرهٔ زمانی همان ۱۲۰۰ میلی‌ثانیهٔ نسخهٔ وب است.
 */
class ScanGate(private val windowMs: Long = 1200) {
  private var lastCode: String? = null
  private var lastAt = 0L

  fun accept(code: String, now: Long = System.currentTimeMillis()): Boolean {
    if (code == lastCode && now - lastAt < windowMs) return false
    lastCode = code
    lastAt = now
    return true
  }

  fun reset() {
    lastCode = null
    lastAt = 0
  }
}

/** بوقِ اسکن + لرزش — بازخوردی که فروشنده بدونِ نگاه‌کردن به صفحه می‌فهمد */
object ScanFeedback {
  fun ok(context: Context) {
    beep(android.media.ToneGenerator.TONE_PROP_BEEP, 120)
    vibrate(context, 60)
  }

  fun unknown(context: Context) {
    beep(android.media.ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 200)
    vibrate(context, 200)
  }

  private fun beep(tone: Int, ms: Int) {
    runCatching {
      val gen = android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC, 85)
      gen.startTone(tone, ms)
      android.os.Handler(android.os.Looper.getMainLooper())
        .postDelayed({ runCatching { gen.release() } }, (ms + 80).toLong())
    }
  }

  @Suppress("DEPRECATION")
  private fun vibrate(context: Context, ms: Long) {
    runCatching {
      val vibrator = if (android.os.Build.VERSION.SDK_INT >= 31) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
      } else {
        context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
      }
      if (android.os.Build.VERSION.SDK_INT >= 26) {
        vibrator.vibrate(android.os.VibrationEffect.createOneShot(ms, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        vibrator.vibrate(ms)
      }
    }
  }
}
