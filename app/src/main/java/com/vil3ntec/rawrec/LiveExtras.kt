package com.vil3ntec.rawrec

import android.content.Context
import java.util.Calendar
import java.util.TimeZone

/**
 * Settings of the live extras: the YouTube account, Twitch chat, the chat on the phone, what is
 * drawn on the stream, and the bot. The Google client secret and the refresh token are kept like
 * the stream key: encrypted with the phone's Keystore, never in a log or a report.
 */
object LiveExtras {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
    private fun b(ctx: Context, k: String, d: Boolean) = SafePrefs.bool(prefs(ctx), k, d)
    private fun i(ctx: Context, k: String, d: Int) = SafePrefs.int(prefs(ctx), k, d)
    private fun s(ctx: Context, k: String) = SafePrefs.str(prefs(ctx), k)
    fun put(ctx: Context, k: String, v: Boolean) = prefs(ctx).edit().putBoolean(k, v).apply()
    fun put(ctx: Context, k: String, v: Int) = prefs(ctx).edit().putInt(k, v).apply()
    fun put(ctx: Context, k: String, v: String) = prefs(ctx).edit().putString(k, v).apply()

    // ---- YouTube account (Google «device» sign-in with the owner's own OAuth client)
    fun ytClientId(ctx: Context) = s(ctx, "yt_client").trim()
    fun setYtClientId(ctx: Context, v: String) = put(ctx, "yt_client", v.trim())
    fun ytSecret(ctx: Context) = LiveSettings.open(s(ctx, "yt_secret"))
    fun setYtSecret(ctx: Context, v: String) {
        if (v.isBlank()) prefs(ctx).edit().remove("yt_secret").apply()
        else LiveSettings.seal(v.trim())?.let { put(ctx, "yt_secret", it) }
    }
    fun ytToken(ctx: Context) = LiveSettings.open(s(ctx, "yt_token"))
    fun setYtToken(ctx: Context, v: String?) {
        if (v.isNullOrBlank()) prefs(ctx).edit().remove("yt_token").remove("yt_channel").apply()
        else LiveSettings.seal(v)?.let { put(ctx, "yt_token", it) }
    }
    fun ytChannel(ctx: Context) = s(ctx, "yt_channel")
    fun setYtChannel(ctx: Context, v: String) = put(ctx, "yt_channel", v)
    fun ytSignedIn(ctx: Context) = ytClientId(ctx).isNotEmpty() && ytToken(ctx).isNotEmpty()

    fun youTube(ctx: Context): YouTubeApi? {
        if (!ytSignedIn(ctx)) return null
        val app = ctx.applicationContext
        return YouTubeApi(ytClientId(ctx), ytSecret(ctx), ytToken(ctx)) { Quota.spend(app, it) }
    }

    /** The stream's title and thumbnail, set on YouTube when the stream starts (empty = YouTube's own). */
    fun ytTitle(ctx: Context) = s(ctx, "yt_title").trim()
    fun ytThumbFile(ctx: Context): java.io.File? = java.io.File(ctx.filesDir, "yt_thumb.jpg").takeIf { it.isFile && it.length() > 0 }
    // ---- the live video on YouTube ("" = leave it as YouTube has it)
    /** public / unlisted / private */
    fun ytPrivacy(ctx: Context) = s(ctx, "yt_privacy")
    /** yes / no: made for kids */
    fun ytKids(ctx: Context) = s(ctx, "yt_kids")
    /** yes / no: other sites may show the video */
    fun ytEmbed(ctx: Context) = s(ctx, "yt_embed")
    /** YouTube's category number (20 = Gaming) */
    fun ytCategory(ctx: Context) = s(ctx, "yt_category")
    fun ytDesc(ctx: Context) = s(ctx, "yt_desc").trim()
    fun ytTags(ctx: Context): List<String> = s(ctx, "yt_tags").split(',', '،', '\n', '#').map { it.trim() }.filter { it.isNotEmpty() }
    /** Everything above in one string: when it changes while live, it is applied again at once. */
    fun ytChoicesStamp(ctx: Context) = listOf(ytTitle(ctx), ytPrivacy(ctx), ytKids(ctx), ytEmbed(ctx), ytCategory(ctx), ytDesc(ctx),
        ytTags(ctx).joinToString(","), ytThumbFile(ctx)?.lastModified()?.toString() ?: "").joinToString("\u0001")

    // ---- Twitch chat (read only, no sign-in)
    fun twChannel(ctx: Context) = s(ctx, "tw_channel").trim().removePrefix("#").removePrefix("@").lowercase()
        .substringAfterLast("twitch.tv/").substringBefore('/').substringBefore('?')
    fun setTwChannel(ctx: Context, v: String) = put(ctx, "tw_channel", v.trim())

    // ---- the chat on the phone
    fun hud(ctx: Context) = b(ctx, "hud_on", true)
    fun hudSize(ctx: Context) = i(ctx, "hud_size", 1).coerceIn(0, 2)
    fun hudAlpha(ctx: Context) = i(ctx, "hud_alpha", 1).coerceIn(0, 2)
    /** How the chat looks over the game: 0 no background (shadowed text), 1 faint, 2 bubbles, 3 one line each. */
    fun hudStyle(ctx: Context) = i(ctx, "hud_style", 0).coerceIn(0, 3)
    /** Viewers / likes / subscribers over the game (read only, touches pass through). */
    fun hudStats(ctx: Context) = b(ctx, "hud_stats", true)
    /** How the chat looks on the stream: 0 no background, 1 one glass box, 2 a bubble per message. */
    fun chatStyle(ctx: Context) = i(ctx, "ov_chat_style", 1).coerceIn(0, 2)

    // ---- the chat translator
    /** Viewers' messages in another language shown to the owner in Persian. */
    fun trIn(ctx: Context) = b(ctx, "tr_in", true)
    /** The owner's Persian messages sent in [trTarget] (the chat panel's EN/FA button). */
    fun trOut(ctx: Context) = b(ctx, "tr_out", true)
    fun trTarget(ctx: Context): String = s(ctx, "tr_target").ifBlank { "en" }
    /** The languages picked last (newest first), shown first in the chat's language list. */
    fun trRecent(ctx: Context): List<String> = s(ctx, "tr_recent").split(',').filter { it.isNotBlank() }
    fun setTrTarget(ctx: Context, code: String) {
        put(ctx, "tr_target", code)
        put(ctx, "tr_recent", (listOf(code) + trRecent(ctx).filter { it != code }).take(6).joinToString(","))
    }

    // ---- on the stream
    const val POS_TL = 0; const val POS_TC = 1; const val POS_TR = 2; const val POS_BL = 3; const val POS_BC = 4; const val POS_BR = 5
    fun alerts(ctx: Context) = b(ctx, "ov_alerts", true)
    fun alertPos(ctx: Context) = i(ctx, "ov_alert_pos", POS_TC).coerceIn(0, 5)
    fun subsBadge(ctx: Context) = b(ctx, "ov_subs", true)
    fun viewersBadge(ctx: Context) = b(ctx, "ov_viewers", false)
    fun badgePos(ctx: Context) = i(ctx, "ov_badge_pos", POS_TL).coerceIn(0, 5)

    /** «چت در پخش»: viewers see the chat on the picture too. */
    fun chatOnStream(ctx: Context) = b(ctx, "ov_chat", false)
    fun chatPos(ctx: Context) = i(ctx, "ov_chat_pos", POS_BL).coerceIn(0, 5)

    /** The «در پخش» switches by key (ChatHud.ON_STREAM), with the same defaults as above. */
    fun onStream(ctx: Context, key: String): Boolean = when (key) {
        "ov_chat" -> chatOnStream(ctx)
        "ov_alerts" -> alerts(ctx)
        "ov_subs" -> subsBadge(ctx)
        "ov_viewers" -> viewersBadge(ctx)
        "ov_goal" -> goal(ctx)
        else -> false
    }

    const val GOAL_SUBS = 0; const val GOAL_LIKES = 1; const val GOAL_MEMBERS = 2; const val GOAL_MANUAL = 3
    fun goal(ctx: Context) = b(ctx, "ov_goal", false)
    fun goalType(ctx: Context) = i(ctx, "ov_goal_type", GOAL_SUBS).coerceIn(0, 3)
    fun goalTarget(ctx: Context) = i(ctx, "ov_goal_target", 1000).coerceAtLeast(1)
    fun goalTitle(ctx: Context) = s(ctx, "ov_goal_title")
    fun goalPos(ctx: Context) = i(ctx, "ov_goal_pos", POS_BL).coerceIn(0, 5)
    fun goalManual(ctx: Context) = i(ctx, "ov_goal_manual", 0).coerceAtLeast(0)
    fun setGoalManual(ctx: Context, v: Int) = put(ctx, "ov_goal_manual", v.coerceAtLeast(0))

    // ---- the bot
    fun botOn(ctx: Context) = b(ctx, "bot_on", false)
    fun botCommands(ctx: Context) = s(ctx, "bot_cmds")
    fun botTimers(ctx: Context) = s(ctx, "bot_timers")
    fun botWelcome(ctx: Context) = b(ctx, "bot_welcome", false)
    fun botWelcomeText(ctx: Context) = s(ctx, "bot_welcome_text")
    fun modLinks(ctx: Context) = b(ctx, "mod_links", true)
    fun modCaps(ctx: Context) = b(ctx, "mod_caps", false)
    fun modSpam(ctx: Context) = b(ctx, "mod_spam", true)
    fun modWords(ctx: Context) = s(ctx, "mod_words")
    fun joinWord(ctx: Context) = s(ctx, "give_word").trim().ifBlank { "!join" }

    fun botConfig(ctx: Context): ChatBot.Config = ChatBot.Config(
        on = botOn(ctx),
        commands = ChatBot.parseCommands(botCommands(ctx)),
        timers = ChatBot.parseTimers(botTimers(ctx)),
        welcome = botWelcome(ctx),
        welcomeText = botWelcomeText(ctx).ifBlank { ctx.getString(R.string.bot_welcome_default) },
        modLinks = modLinks(ctx), modCaps = modCaps(ctx), modSpam = modSpam(ctx),
        words = ChatBot.parseWords(modWords(ctx)),
        joinWord = joinWord(ctx),
        texts = ChatBot.Texts(
            uptime = ctx.getString(R.string.bot_t_uptime), viewers = ctx.getString(R.string.bot_t_viewers),
            subs = ctx.getString(R.string.bot_t_subs), goal = ctx.getString(R.string.bot_t_goal),
            commands = ctx.getString(R.string.bot_t_commands),
            warnLink = ctx.getString(R.string.bot_w_link), warnCaps = ctx.getString(R.string.bot_w_caps),
            warnSpam = ctx.getString(R.string.bot_w_spam), warnWord = ctx.getString(R.string.bot_w_word),
            giveawayOpen = ctx.getString(R.string.bot_g_open), giveawayWinner = ctx.getString(R.string.bot_g_winner),
            giveawayNone = ctx.getString(R.string.bot_g_none), and = ctx.getString(R.string.bot_and),
        ),
    )

    /**
     * YouTube's daily allowance for the owner's Google project: 10 000 units, renewed at midnight
     * Pacific time. Counted here so the chat is read at a pace that lasts the whole stream.
     */
    object Quota {
        const val DAILY = 10_000
        private fun day(): Int {
            val c = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"))
            return c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR)
        }
        @Synchronized
        fun spend(ctx: Context, units: Int) {
            val p = prefs(ctx)
            val d = day()
            val used = if (SafePrefs.int(p, "q_day", 0) == d) SafePrefs.int(p, "q_used", 0) else 0
            p.edit().putInt("q_day", d).putInt("q_used", used + units).apply()
        }
        fun used(ctx: Context): Int {
            val p = prefs(ctx)
            return if (SafePrefs.int(p, "q_day", 0) == day()) SafePrefs.int(p, "q_used", 0) else 0
        }
        fun left(ctx: Context) = (DAILY - used(ctx)).coerceAtLeast(0)
        /** Google said the allowance is used up: nothing more today. */
        fun exhaust(ctx: Context) {
            prefs(ctx).edit().putInt("q_day", day()).putInt("q_used", DAILY).apply()
        }
    }
}
