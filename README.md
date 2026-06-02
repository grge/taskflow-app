# TaskFlow

A visual task scheduling app built around an urgency model: every task has a time-dependent "problemness" function that rises over time based on its urgency profile and importance. The scheduler minimises total accumulated problemness until all tasks are complete.

## Stack

Svelte 5 (runes) + Vite + Interact.js. No backend — state persisted to localStorage.

## Features (Phases 1 & 2)

- Task list with urgency profiles, importance levels, and live problemness display
- Week matrix with drag-and-drop scheduling and multi-day block splitting
- Auto Schedule — greedy + local search optimiser that fills unscheduled tasks around existing blocks
- Clear Schedule, sort bar (by date added, name, urgency, importance, problemness, scheduled time)

## Running

```
npm install
npm run dev
```

## Spec & implementation notes

See [`SPEC-v3.md`](./SPEC-v3.md) for the full technical specification and [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for decisions made during implementation.

## Contact

George Dickeson — [george.dickeson@gmail.com](mailto:george.dickeson@gmail.com)
