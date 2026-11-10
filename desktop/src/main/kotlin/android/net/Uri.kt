package android.net

/** Desktop stand-in: a recording part's place (a file path on the computer). */
class Uri private constructor(private val s: String) {
    override fun toString() = s
    companion object { fun parse(s: String) = Uri(s) }
}
