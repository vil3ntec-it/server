#  کوچک کردنِ برنامه پیش از ساخت.
#
#  هدف فقط حجم است: کتابخانه‌هایی مثل Compose و CameraX و ML Kit بخشِ
#  بزرگی دارند که این برنامه اصلاً صدا نمی‌زند و بی‌جهت در فایلِ نصبی
#  می‌نشیند — و هر بار روی اینترنتِ کاربر دانلود می‌شود.
#
#  ولی کدِ خودِ برنامه دست‌نخورده می‌ماند. دفترِ دکان با
#  kotlinx.serialization خوانده و نوشته می‌شود و نامِ کلاس‌ها و فیلدها در
#  همان فایل معنی دارند؛ عوض‌شدنِ یک نام یعنی داده‌ای که خوانده نمی‌شود.
#  صرفه‌جویی در چند کیلوبایتِ کدِ خودمان ارزشِ آن ریسک را ندارد.
-keep class ir.vil3ntec.tohid.** { *; }

#  سریال‌سازها هم همین‌طور — این‌ها با بازتاب پیدا می‌شوند، نه با صدا زدن
-keepclassmembers class ir.vil3ntec.tohid.data.** {
  *** Companion;
  kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class ir.vil3ntec.tohid.data.**$$serializer { *; }

#  هشدارهای کتابخانه‌ها دربارهٔ کلاس‌هایی که در اندروید نیستند
-dontwarn java.lang.invoke.**
-dontwarn javax.annotation.**
