# RawRec

High-quality Android screen recorder by VIL3NTEC. Screen frames go straight from a virtual display into the hardware encoder and the compressed stream is written to MP4 with no re-encoding and no "optimise" pass afterwards.

## What's new in 1.5
- **New design**: a graphite dark theme, one recording red and one selection blue, a bottom bar on phones and a rail on tablets, one consistent line-icon set, a stats card for every «گزارشِ ضبط» and a new launcher icon (details below)
- **A visible, draggable control instead of the invisible one**: a small translucent panel with stop / pause / mic / face cam / delete / hide that sticks to the nearest screen edge and shrinks to a small dot; «hide» takes it off the screen and the notification gets a «نمایشِ دکمه» action to bring it back. No invisible window takes touches any more, and no hidden double-tap or long-press ends a recording
- **Recordings no longer cut off by themselves**: the 3.5 GB part split is seamless (no dropped frames, one continuous audio track), an encoder or file-write error is recovered and the recording goes on, the file is closed cleanly on a crash, the screen stays on while recording (Android 15 ends screen capture when the phone locks), and shake-to-stop needs several deliberate back-and-forth shakes, so walking, bumps or an intense game do not stop it
- **Why it ended**: every recording saves its stop reason (your stop button, notification, tile, shake, screen locked, Android ended the capture, storage full, encoder / write error, crash …), shown in the report in plain words; the report opens by itself when a recording ended unexpectedly
- **Fidelity first**: higher default bitrate (0.11 bpp: about 14 Mbps for 1080p60 and 36 Mbps for 1504×2400@120 HEVC) with a lower QP ceiling, BT.709 colour tags in the file, the lowest codec level that fits instead of the encoder's highest, audio timed to the recording clock, and the exact native resolution

## Features (1.5)
- Native resolution exactly as the system renders it (never upscaled), at the highest frame rate the device's hardware encoder claims for that size (60, 120, 165 … from the display modes and encoder performance points)
- Automatic codec choice: hardware AV1 (Android 14+) → HEVC Main → H.264 High, at the lowest level that carries the size, frame rate and peak bitrate (players on other devices accept the file)
- Faithful quality at capture time: VBR with 2× peak headroom, a per-frame-type QP ceiling against blockiness in small text and fast motion, B-frames, 3 s key-frame interval, variable frame rate on static screens, BT.709 colour
- Presets: «مثلِ صفحه (حداکثر)» (default), «۶۰ فریم», «سبک», «سفارشی»
- Orientation: automatic, or fixed portrait / «افقی (بازی)» (native landscape canvas, other orientation letterboxed, never stretched). «شروعِ هوشمند»: a rotation in the first 10 s restarts into one file in the new orientation; a later rotation starts a correctly sized second file
- «حالتِ بازی» (Android 14+): record only the game (system «یک برنامه» choice), so the RawRec button and the notification shade stay visible to you but out of the video
- The 1.5 design: a graphite dark theme (#0E0F12 → #16181D → #1E2128 surfaces, hairline borders), one recording red (#FF3B47) and one selection blue (#6AA6FF), a type scale (display / headline / title / label / body / caption) on a 4 dp grid, pill chips with 48 dp touch targets, ripple feedback everywhere, and one 24 dp line-icon set (1.75 stroke, round caps) on every tab, button, chip, setting row, report figure and dialog; a new launcher icon (record dot in a rounded screen frame on red)
- Five destinations: ضبط / ویدیوها / کیفیت / تنظیمات / درباره, in a bottom bar on phones and a navigation rail on tablets and in landscape (selected item in a blue pill)
- «ضبط»: a record stage with a status chip (ready / countdown / recording / paused / saving), a dial with the elapsed time (pulsing red while recording, amber and blinking while paused), one big red «شروعِ ضبط» pill that turns into «توقفِ ضبط» with a pause button beside it, and the plan line; quick settings (facecam, voice, quality, orientation, 10-second test) below it on phones and beside it on wide screens
- «ویدیوها»: the recordings from MediaStore as cards with a 16:9 thumbnail, duration badge, size • resolution • fps, a ⋮ menu (share / delete) and a friendly empty state; tap opens the gallery
- Settings in two groups (ضبط / برنامه) showing each page's current value, on/off options as switches, a storage meter, and permission rows with a clear «فعال» badge or «اجازه بده» button
- Internal game audio, microphone, or both, with separate volume (48 kHz stereo AAC)
- On-screen control that is always visible: stop, pause / resume, mic, face cam, delete (tap twice) and hide; drag to any edge, shrink to a dot (optionally from the start), plus stop from the notification, the Quick Settings tile and optional deliberate shake-to-stop
- «گزارشِ ضبط» after every recording, measured from the file (real average / max fps, frames vs expected, Mbps, MB per minute) and a 10-second test recording; shown as a stats card (duration, size, average fps, real bitrate, size per minute, frames, with a «بدونِ افتِ فریم» / long-gap / error verdict) with the full text one tap away
- Front-camera facecam bubble, countdown, low-storage warning with a clean stop before the phone is full
- Long recordings split seamlessly into ordered parts of about 3.5 GB; saves to `Movies/RawRec`; the screen stays on while recording
- Persian by default (right-to-left) even on an English phone, with an in-app «زبان» switch to English; Android 13+ per-app language is kept in sync

## Design
Colours live in `app/src/main/res/values/colors.xml`, spacing, radii and type sizes in `dimens.xml`, the type scale, chips and buttons in `styles.xml`; Kotlin uses only these resources. The icons are generated from one source, `design/icons.py` (`python3 design/icons.py`), and `design/preview.html` shows the main screens with the same colours, sizes and icons.

## Tests
`gradle :app:testDebugUnitTest` runs `LaunchTest`, `InteractionTest`, `PillTest` and `RecordingLogicTest` (app/src/test) on Robolectric for Android 10, 13, 14 and 15: launch in Persian and English, rotation and recreate, settings left by older versions, unusual encoder lists, every destination of the bottom bar / rail and every settings page on phone and tablet sizes with back navigation, right-to-left and left-to-right placement, a real touch on every chip, switch and button with a hit-test at its centre, the videos list on fake MediaStore rows, rotation decisions and part/track sizes, the floating control (every button, delete confirm, hide, start as a visible dot with no hidden tap gesture, drag-and-snap), the language switch, and every string in both languages. If the app ever cannot build its screen it shows the error with copy / share instead of closing, and a crash is shown on the next launch.

## Build
Every push builds a signed APK with GitHub Actions. Download it from the **Releases** page.

Requires Android 10+.
