# breach-quota

English | [日本語](README.ja.md)

A Claude Code plugin that puts a cyberdeck-style HUD in acid yellow and salmon red into the side pane. It carries over the information and logic of [jnk0vc/netdive-quota](https://github.com/jnk0vc/netdive-quota), with the screen layout and wording rebuilt from scratch. Headings are in English; secondary labels and notes in the pane are in Japanese.

<img src="docs/screenshot.png" alt="The HUD in the side pane. From the top: the yellow header strip, RAM gauges for the five-hour and weekly limits, a hex-byte memory matrix, burn rate and other gauges, the hack trace, and the access log" width="364">

When the pane is wide, the three gauge slots sit side by side and the access log moves to the right of the hack trace.

<img src="docs/screenshot-wide.png" alt="A wide pane. The five-hour gauge, weekly gauge and memory matrix sit in one row, with the gauges below and the hack trace and access log side by side" width="740">

## What it shows

**Header strip**

- The yellow strip shows `BREACH//QUOTA` on the left, and on the right the number of tool calls (`OPS 027`) and a status: `STANDBY` (idle), `JACKED IN` (running), `LINK OK` (the last call succeeded) or `ICE HIT` (the last call was blocked or failed).

**RAM gauges (rate limit timers)**

- The five-hour and weekly limits are shown as a countdown and a row of 20 RAM blocks. Up to three reported limits are shown.
- The RAM blocks show what is left (100% − usage). The code in the top right is the window length: `RAM.05H` is the five-hour window and `RAM.07D` the weekly one. A trailing initial, as in `RAM.07D-F`, marks a per-model weekly limit.
- Hours and minutes are drawn large and seconds small. With a day or more left, the day count comes first, as in `6D`.
- There are four stages: `FLATLINE`, `COOL`, `STABLE` and `OVERDRAW`.
  - `OVERDRAW`: at the current pace the limit runs out before it resets, so the countdown shows the time until it runs out (`BURNOUT IN`).
  - `STABLE` / `COOL`: the limit lasts until the reset, so the countdown shows the time until the reset (`RECHARGE IN`). `COOL` means usage is under half of the share of the window that has elapsed.
  - `FLATLINE`: the limit is used up, and `00:00` blinks.
- Whether a limit is in `OVERDRAW` comes from the time elapsed since the window started and the usage so far: if usage keeps the same pace, when does it reach 100%? If that is before the reset, it is `OVERDRAW`. With less than a minute elapsed, or at 0% usage, there is no estimate and the countdown shows the time until the reset.
- The color of the countdown and the RAM blocks depends on what is left and on the burnout estimate. The first row that matches wins.

  | Color | When |
  |---|---|
  | Red | Less than 20% left (over 80% used), used up (`FLATLINE`), `OVERDRAW` with under 30 minutes to burnout, or 90% or more used |
  | Yellow | 50% or less left (50% or more used), or `OVERDRAW` |
  | Cyan | None of the above |

  At exactly 50% left the gauge is yellow, and at exactly 20% left it is still yellow. In red, the last remaining RAM block blinks and the percentage glitches.
- When any limit is at 90% or more, a red `RAM LOW` band appears above the prompt (see "Band above the prompt" below).

**Memory matrix (`MEMORY MATRIX`)**

- The context window is drawn as a grid of hex bytes. Each cell stands for a fixed share of the window, and used cells take the color of their category (messages, system tools, memory files and so on). Categories run from largest to smallest, followed by free space and then the autocompact buffer.
- Hatched cells are the autocompact buffer. When usage reaches it, the context is compacted automatically.
- A cyan cursor marks the next cell to fill, with a band lighting up its column.
- Lamps along the bottom show the stage: `NOMINAL` under 60% used, `CAUTION` under 80%, `CRITICAL` under 95%, and `FULL` beyond that.
- The frame is salmon red under 50% used, yellow from 50%, and red from 80%.
- The breakdown uses the same estimate as `/context`, taken again after every response without sending a token-counting request. Until a breakdown is available the grid is drawn from total usage alone, and before any usage arrives it reads `AWAITING SCAN`.
- It sits below the RAM gauges. In a wide pane it takes the free third slot, or a full-width row below when all three slots are taken.

**Gauges (below the memory matrix)**

- `BURN RATE`: the session's total cost in USD, and the average pace per hour since the session started. The pace is hidden for the first five minutes.
- `CACHE HIT`: the share of input tokens read from the prompt cache, totalled over every turn, sub-agents included.
- `BANDWIDTH`: total input and output tokens, and the number of turns.

**Hack trace and access log**

- Tool calls fall into three hacks: `SCAN` for reads such as Read, Grep and Glob; `INJECT` for edits with Edit, Write and NotebookEdit; and `EXEC` for Bash and everything else.
- Each hack has a long track, and each call is a tick in its own column, newest on the right. Successful calls (`OK`) are cyan, blocked or failed calls (`ICE`) red, and running calls (`RUN`) blink yellow. Sequence numbers are marked every ten calls under the tracks.
- Under `SUB-AGENTS`, each sub-agent gets its own track: type, model and call count on the left, its task above the track, and its calls ticked in the same columns as the three hacks. Running sub-agents come first, up to three.
- The access log records elapsed time, hack, result, tool and target on one monospaced line each. The number of rows follows the pane height.

**Band above the prompt**

- While Bash runs, a yellow band shows `EXEC 実行中` and the command.
- When a tool is blocked or fails, a red band shows `ICE 遮断` and the reason. It clears when you press `確認` or send the next prompt.
- When a limit passes 90% usage, a red band shows `RAM LOW 残量わずか`, or `FLATLINE 停止` once it is used up.
- While Claude works, a cyan band shows `JACKED IN 接続中`.

**CRT effects**

- The pane is treated like a color CRT: scanlines run across the whole pane, and every row except the header strip darkens slightly toward its corners.
- Large numbers (countdowns, percentages, gauge values) are drawn with red and cyan pulled slightly apart, like the convergence error of a color tube.
- A faint scan band sweeps down the RAM gauges every nine seconds.
- The header logo, and the percentage of a red gauge, glitch now and then.
- With the system's Reduce Motion setting on, the glitches, blinking and scan band stop.

## Install

Run these two commands in Claude Code:

```
/plugin marketplace add jnk0vc/breach-quota
/plugin install breach-quota@breach-quota
```

The pane opens on its own when there is room for it. `/breach` opens it at any time.

With netdive-quota enabled as well, both plugins compete for the band above the prompt. Enable only one of them.

## Requirements

- A Claude Code build that supports function-hook plugins (an early-access feature). Loading and tests have been checked on 2.1.288.
- On builds where the feature is off by default, start Claude Code with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- The desktop Code tab draws the panels as SVG. In the terminal the same information is listed as colored text.
- The rate limit timers need a Claude subscription. Without one, the RAM gauges are left out and the pane starts at the memory matrix.

## About the design

- The design draws on HUD conventions common in near-future games and anime: a black ground accented with yellow, red and cyan, panels with cut corners, glitches that pull colors apart, hex dumps, and the scanlines and color fringing of a color CRT. It uses no artwork, logos, characters or terms specific to any particular work.
- Numbers use DIN Condensed (falling back to Bahnschrift and Arial Narrow), English headings DIN Alternate, Japanese Hiragino Kaku Gothic (falling back to Yu Gothic and Noto Sans JP), and the log a monospaced font. No fonts are bundled.
- This project is not affiliated with any particular work or rights holder.

## License

[MIT](LICENSE). Includes the same copyright notice as [netdive-quota](https://github.com/jnk0vc/netdive-quota), which it is based on.
