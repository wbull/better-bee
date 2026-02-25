# Better Bee

Enhancements for the [NYT Spelling Bee](https://www.nytimes.com/puzzles/spelling-bee): emoji feedback, word definitions, hints, and more.

[![Install directly](https://img.shields.io/badge/Install-Userscript-green)](https://raw.githubusercontent.com/wbull/better-bee/main/better_bee.user.js)

<!-- Replace with your screen recording: -->
<!-- ![Better Bee demo](demo.gif) -->

## Features

- **Auto-dismiss interstitials** -- Skips the Play/Resume splash screen automatically
- **Visual emoji feedback** -- Large emoji reactions for correct answers, duplicates, and errors
- **Word Explorer** -- Click any found word to see its definition, pronunciation, and Wikipedia image
- **Hint system** -- Press `?` to cycle through hints for unfound words (first 2 letters + word length)
- **Bee Buddy link** -- The bee icon opens [Spelling Bee Buddy](https://www.nytimes.com/interactive/2023/upshot/spelling-bee-buddy.html) in a new tab
- **Dock hiding** -- Removes the NYT promotional dock on all NYT pages

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. **[Click here to install Better Bee](https://raw.githubusercontent.com/wbull/better-bee/main/better_bee.user.js)**
3. Go to [NYT Spelling Bee](https://www.nytimes.com/puzzles/spelling-bee) and play

Updates are delivered automatically via Tampermonkey/Violentmonkey.

## Usage

| Action | What happens |
|--------|-------------|
| Play the game | Emoji appears on correct/duplicate/error |
| Click a found word | Word Explorer overlay with definition + image |
| Press `?` | Toggle hint cycle (e.g. `AM.. 5`) |
| Click the bee | Opens Spelling Bee Buddy in a new tab |
| Press `Escape` | Closes any open overlay |
