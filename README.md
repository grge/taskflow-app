# TaskFlow

A visual task scheduling app built around an urgency model: every task has a time-dependent "pressure" that rises from its onset toward a peak value. The auto-scheduler packs tasks to minimize total accumulated pressure until everything is complete.

## Stack

Svelte 5 (runes) + Vite + Interact.js. No backend — state persisted to localStorage.

## Features

- Task list with a drag-editable onset/peak/peak-pressure envelope and a live pressure sparkline per task
- Today Planner — vertical timeline of today's scheduled blocks, drag-and-drop to reorder/move
- Outlook — ordered backlog of future tasks by day, with automatic forward-bumping on reorder
- Fixed blocks (meetings, etc.) that the scheduler treats as obstacles
- Auto Schedule — greedy packing + local-search optimizer, scaled by a learned estimation multiplier
- Time tracking timer per task, feeding the estimation multiplier
- Insights panel and selectable color themes (Warm Parchment, Sage Morning, Ember Night, Dusk)

## Running

```
npm install
npm run dev
```

## Contact

George Dickeson — [george.dickeson@gmail.com](mailto:george.dickeson@gmail.com)
