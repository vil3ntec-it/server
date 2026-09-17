package ir.vil3ntec.admin.data

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InterfaceAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/** سروری که در شبکه پیدا شد */
data class FoundServer(
  val id: String,
  val name: String,
  /** آدرسِ محلی — سریع، ولی فقط داخلِ همین شبکه */
  val url: String,
  /** دامنهٔ اینترنتی — اگر تونل بالا باشد، هر جای دنیا کار می‌کند */
  val internet: String,
  /** آدرسِ اختصاصیِ همین برنامه روی دامنهٔ خودتان: admin.<دامنه> */
  val admin: String,
  val version: String,
) {
  /**
   *  آدرسی که باید در برنامه بنشیند.
   *
   *  ⚠️ فقط دو گزینه، و آدرسِ تونل عمداً جزوشان نیست.
   *
   *  آدرسِ تونل (مثلِ sync.example.com) به پورتِ عمومی می‌رود و آن‌جا پنل
   *  اصلاً سرو نمی‌شود — نه ورود، نه داشبورد. یک بار همین باعث شد برنامه
   *  آدرسِ تونل را بردارد، چراغ سبز شود (چون /health آن‌جا هست) و بعد
   *  ورود با «این آدرس روی سرور نیست» رد شود. بدترین حالتِ ممکن: به نظر
   *  درست، ولی کار نمی‌کند.
   *
   *  پس: آدرسِ اختصاصیِ برنامه روی دامنهٔ خودتان (که پشتش کلِ سرور است)،
   *  وگرنه آدرسِ محلی که داخلِ خانه کار می‌کند.
   */
  val best: String get() = admin.ifBlank { url }

  /** آیا سرور آدرسِ اینترنتیِ مخصوصِ برنامه دارد؟ */
  val hasInternet: Boolean get() = admin.isNotBlank()
}

/**
 *  پیدا کردنِ خودکارِ سرور در شبکهٔ خانگی.
 *
 *  ⚠️ چرا لازم شد: آدرسِ سرور دستِ هیچ‌کس نیست — با هر بار روشن شدنِ مودم
 *  عوض می‌شود و در هر خانه‌ای فرق دارد. نوشتنِ یک آدرسِ نمونه در برنامه
 *  یعنی برنامه‌ای که بارِ اول کار نمی‌کند و کاربر هم نمی‌داند چه بنویسد.
 *
 *  چطور: یک بستهٔ کوچک در شبکه پخش می‌شود و سرور خودش جواب می‌دهد «من
 *  این‌جام، آدرسم این است». همان چیزی که سمتِ سرور از قبل آماده بود
 *  (server/src/discovery.js) و تا حالا کسی از آن استفاده نمی‌کرد.
 *
 *  ⚠️ به یک آدرسِ پخشِ ثابت بسنده نمی‌کنیم: 255.255.255.255 را بعضی
 *  روترها و بعضی نسخه‌های اندروید رد می‌کنند. پس آدرسِ پخشِ خودِ هر کارتِ
 *  شبکه هم جداگانه صدا زده می‌شود.
 */
object Discovery {

  private const val PORT = 4702
  private const val PROBE = "PUMP-SERVER-DISCOVER?"
  private const val REPLY = "PUMP-SERVER-HERE"

  /**
   * چند ثانیه گوش می‌دهد و هر سروری که جواب داد را برمی‌گرداند.
   *
   * این تابع مسدودکننده است — از نخِ اصلی صدایش نزنید.
   */
  fun search(timeoutMs: Int = 2_500): List<FoundServer> {
    val found = LinkedHashMap<String, FoundServer>()
    val socket = DatagramSocket().apply {
      broadcast = true
      soTimeout = 400
    }

    try {
      val payload = PROBE.toByteArray(Charsets.UTF_8)
      for (address in broadcastAddresses()) {
        runCatching {
          socket.send(DatagramPacket(payload, payload.size, address, PORT))
        }
      }

      val buffer = ByteArray(8 * 1024)
      val deadline = System.currentTimeMillis() + timeoutMs
      while (System.currentTimeMillis() < deadline) {
        val packet = DatagramPacket(buffer, buffer.size)
        try {
          socket.receive(packet)
        } catch (_: SocketTimeoutException) {
          continue
        }

        val text = String(packet.data, 0, packet.length, Charsets.UTF_8).trim()
        if (!text.contains(REPLY)) continue

        runCatching {
          val card = JSONObject(text)
          /*
           *  آدرسی که خودِ سرور می‌دهد ممکن است کارتِ شبکهٔ دیگری باشد
           *  (مثلاً داکر یا VPN) و از گوشی باز نشود. آدرسِ فرستنده همان
           *  چیزی است که جواب از آن آمده، پس حتماً از این‌جا در دسترس است.
           */
          val port = card.optInt("port", 4700)
          val fromSender = "http://${packet.address.hostAddress}:$port"
          val url = fromSender.ifBlank { card.optString("url") }
          val id = card.optString("id").ifBlank { url }
          found[id] = FoundServer(
            id = id,
            name = card.optString("name").ifBlank { "سرور خانگی" },
            url = url,
            internet = card.optString("internet"),
            admin = card.optString("admin"),
            version = card.optString("version"),
          )
        }
      }
    } finally {
      runCatching { socket.close() }
    }

    return found.values.toList()
  }

  /** آدرسِ پخشِ هر کارتِ شبکه، به‌علاوهٔ پخشِ عمومی */
  private fun broadcastAddresses(): List<InetAddress> {
    val list = mutableListOf<InetAddress>()
    runCatching { list.add(InetAddress.getByName("255.255.255.255")) }

    runCatching {
      for (nic in NetworkInterface.getNetworkInterfaces()) {
        if (!nic.isUp || nic.isLoopback) continue
        for (address: InterfaceAddress in nic.interfaceAddresses) {
          address.broadcast?.let { list.add(it) }
        }
      }
    }
    return list.distinctBy { it.hostAddress }
  }
}
