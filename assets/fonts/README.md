# Fonts for the payslip image

The Telegram bot draws the payslip on the server, so the fonts travel with the repo.
All four families are licensed under the SIL Open Font License 1.1 and come from
https://github.com/google/fonts.

| File | From | What was done |
| --- | --- | --- |
| ArchivoBlack-Regular.ttf | Archivo Black | unchanged |
| SpaceGrotesk-Bold.ttf | Space Grotesk | weight 700 cut from the variable font |
| JetBrainsMono-Medium.ttf, JetBrainsMono-Bold.ttf | JetBrains Mono | weights 500 and 700 cut from the variable font |
| StockyardCJK-Bold.ttf | Noto Sans SC | weight 700, cut down to the 6,763 characters of GB2312, its punctuation, and the few extra characters in current stock and coin names |
| StockyardCJK-Black.ttf | Noto Sans SC | weight 900, only the characters in the titles |

The two Noto Sans SC cuts carry a different file name because the OFL reserves the original name
for unmodified copies.
