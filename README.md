# Better Bee

A userscript that enhances the NYT Spelling Bee experience.

## Features

- **Dock Hiding** -- Automatically removes the NYT promotional dock on all NYT pages
- **Visual Emoji Feedback** -- Shows large emoji reactions for correct answers, duplicates, and errors
- **Bee Buddy Hints** -- Click the bee icon to start a timed hint cycle for unfound words (first 2 letters + word length). Dismiss a hint and the next one auto-appears after 2 minutes
- **Word Explorer** -- Click any found word to see its definition, pronunciation, and a Wikipedia image in an overlay panel

## Installation

1. Install a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/))
2. Open `better_bee.user.js` and click "Raw" (or install from your manager's dashboard)
3. Navigate to the [NYT Spelling Bee](https://www.nytimes.com/puzzles/spelling-bee)

## Usage

- The bee icon appears in the bottom-right corner of the Spelling Bee page
- **Click the bee** to start the hint cycle -- a toast slides up showing a hint like `AM.. 5` (first 2 letters, word length)
- **Dismiss the hint** (click X) and the next hint auto-appears in 2 minutes
- **Click the bee again** while hints are active to stop the cycle
- **Click any found word** in the word list to open the Word Explorer overlay with definitions and images
