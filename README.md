# WaniKani Clip Hotkey

A userscript for [WaniKani](https://www.wanikani.com). Press a hotkey during reviews or lessons to hear the current word or kanji used in a real anime, drama or game. Each clip is a screenshot plus the audio of the line, from [Immersion Kit](https://www.immersionkit.com).

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open **[wanikani-clip-hotkey.user.js](https://raw.githubusercontent.com/Snackwrap/wanikani-clip-hotkey/main/wanikani-clip-hotkey.user.js)**. Your userscript manager will offer to install it.

The script needs no other scripts (it doesn't use WaniKani Open Framework). Updates come through your userscript manager.

## Hotkeys

Alt is Option on a Mac.

| Key | What it does |
|---|---|
| Alt+V | Open the clip panel and play a clip. Press again for the next one |
| Alt+Shift+V | Previous clip |
| Alt+R | Replay the current clip (clicking the screenshot also replays) |
| Alt+Y | Open a [YouGlish](https://youglish.com) search for the word in a new tab, for real YouTube video |
| Esc | Close the panel |

The hotkeys work while your cursor is in the answer box, and they don't type anything into it.

## How it works

- Works in reviews, lessons and extra study, and uses whatever word or kanji is on screen.
- Clips that contain the exact word come first and shorter lines come before longer ones. Conjugated forms come after those.
- The English translation is blurred until you click it, so it won't give away the meaning before you answer.
- The panel closes when the next item comes up.
- Radicals have no clips.

## Settings

Edit the constants at the top of the script:

| Setting | Default | Meaning |
|---|---|---|
| `KEYS` | V / R / Y | Keys used together with Alt |
| `BLUR_TRANSLATION` | `true` | Blur the English until clicked |
| `MAX_CLIPS` | `40` | Clips kept per item |
| `VOLUME` | `0.9` | Playback volume |

## If clips stop loading

Clip data comes from Immersion Kit's API (`apiv2.immersionkit.com`) and its media host. If Immersion Kit moves its media again, update the `MEDIA` constant at the top of the script.

## Credits

Example sentences, screenshots and audio come from [Immersion Kit](https://www.immersionkit.com). This is an unofficial third-party script, not made by the WaniKani team.

## License

[MIT](LICENSE)
