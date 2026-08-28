package ir.vil3ntec.tohid.print

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import java.io.OutputStream
import java.util.UUID

/**
 *  چاپ روی چاپگرِ حرارتیِ بلوتوثی — همان ۵۸ و ۸۰ میلی‌متری‌های دکان.
 *
 *  چرا جدا از چاپگرِ اندروید: این چاپگرها معمولاً در چارچوبِ چاپِ اندروید
 *  دیده نمی‌شوند. با آن‌ها باید مستقیم حرف زد: پروفایلِ SPP بلوتوث و
 *  دستورهای ESC/POS.
 *
 *  فاکتور به‌صورت تصویر فرستاده می‌شود، نه متن. دلیلش فارسی است: این
 *  چاپگرها جدولِ نویسه‌های فارسی ندارند و متنِ فارسی را به‌هم‌ریخته یا
 *  علامت سؤال چاپ می‌کنند. تصویر همان چیزی است که روی صفحه دیده می‌شود.
 */
object ThermalPrinter {

  /** پروفایل پورت سریالِ بلوتوث — همان چیزی که این چاپگرها ارائه می‌دهند */
  private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

  /** عرضِ کاغذ بر حسب نقطه: ۵۸ میلی‌متر = ۳۸۴، ۸۰ میلی‌متر = ۵۷۶ */
  const val WIDTH_58MM = 384
  const val WIDTH_80MM = 576

  data class Printer(val name: String, val address: String)

  /** چاپگرهایی که قبلاً در تنظیماتِ بلوتوثِ گوشی جفت شده‌اند */
  fun paired(context: Context): List<Printer> {
    val adapter = adapter(context) ?: return emptyList()
    return try {
      adapter.bondedDevices.orEmpty().map { Printer(it.name ?: it.address, it.address) }
    } catch (e: SecurityException) {
      emptyList()
    }
  }

  fun adapter(context: Context): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  /**
   * چاپِ یک تصویر. اگر چیزی خطا بدهد، پیامش برگردانده می‌شود تا به کاربر
   * نشان داده شود — نه اینکه بی‌صدا هیچ اتفاقی نیفتد.
   */
  fun print(context: Context, address: String, bitmap: Bitmap, paperWidth: Int): String? {
    val adapter = adapter(context) ?: return "بلوتوث روی این گوشی نیست"
    if (!adapter.isEnabled) return "بلوتوث خاموش است"

    val device: BluetoothDevice = try {
      adapter.getRemoteDevice(address)
    } catch (e: Exception) {
      return "چاپگر پیدا نشد"
    }

    var socket: android.bluetooth.BluetoothSocket? = null
    return try {
      socket = device.createRfcommSocketToServiceRecord(SPP)
      adapter.cancelDiscovery()
      socket.connect()
      socket.outputStream.use { out ->
        out.write(byteArrayOf(0x1B, 0x40))            // ESC @ — از نو
        writeImage(out, scale(bitmap, paperWidth), paperWidth)
        out.write("\n\n\n".toByteArray())             // کمی کاغذ جلو برود
        out.write(byteArrayOf(0x1D, 0x56, 0x42, 0x00)) // GS V B — بریدنِ کاغذ
        out.flush()
      }
      null
    } catch (e: SecurityException) {
      "اجازهٔ بلوتوث داده نشده"
    } catch (e: Exception) {
      "چاپ نشد: ${e.message ?: "اتصال برقرار نشد"}"
    } finally {
      try { socket?.close() } catch (e: Exception) { /* بسته شده */ }
    }
  }

  /** تصویر را به عرضِ کاغذ می‌رساند و نسبتش را نگه می‌دارد */
  private fun scale(source: Bitmap, width: Int): Bitmap {
    if (source.width == width) return source
    val height = (source.height.toFloat() * width / source.width).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(source, width, height, true)
  }

  /**
   * فرستادنِ تصویر با GS v 0 (چاپِ نقطه‌ایِ رستری).
   *
   * تصویر تکه‌تکه فرستاده می‌شود، نه یک‌جا: بافرِ این چاپگرها کوچک است و
   * فاکتورِ بلند را یک‌جا نمی‌پذیرد.
   */
  private fun writeImage(out: OutputStream, bitmap: Bitmap, paperWidth: Int) {
    val bytesPerRow = (paperWidth + 7) / 8
    val chunk = 128 // تعدادِ سطر در هر تکه

    var y = 0
    while (y < bitmap.height) {
      val rows = minOf(chunk, bitmap.height - y)
      val data = ByteArray(bytesPerRow * rows)

      for (row in 0 until rows) {
        for (x in 0 until paperWidth) {
          if (x >= bitmap.width) continue
          val pixel = bitmap.getPixel(x, y + row)
          // شفاف را سفید حساب می‌کنیم، وگرنه کلِ کاغذ سیاه در می‌آید
          val alpha = Color.alpha(pixel)
          val luminance = if (alpha < 128) 255
          else (0.299 * Color.red(pixel) + 0.587 * Color.green(pixel) + 0.114 * Color.blue(pixel)).toInt()
          if (luminance < 128) {
            data[row * bytesPerRow + x / 8] =
              (data[row * bytesPerRow + x / 8].toInt() or (0x80 shr (x % 8))).toByte()
          }
        }
      }

      out.write(byteArrayOf(0x1D, 0x76, 0x30, 0x00))            // GS v 0
      out.write(byteArrayOf((bytesPerRow and 0xFF).toByte(), (bytesPerRow shr 8).toByte()))
      out.write(byteArrayOf((rows and 0xFF).toByte(), (rows shr 8).toByte()))
      out.write(data)
      out.flush()
      y += rows
    }
  }
}
