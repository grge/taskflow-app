# TaskFlow App

**A visual task scheduling app for knowledge workers who need to manage short-term work with fuzzy urgency.**

---

## What is this?

TaskFlow helps you:
- Manage ~10 daily tasks with realistic time estimates
- Visually schedule work into a weekly calendar grid
- Track actual completion time to improve future estimates
- Auto-allocate tasks based on urgency and historical accuracy

**Not a project manager.** Not a Gantt chart. Just a better daily to-do list.

---

## Design Philosophy

- **Fuzzy by design**: No strict deadlines, vague urgency buckets ("today", "next few days")
- **Visual scheduling**: Drag-and-drop time blocks into a week matrix
- **Learning system**: Collects actual vs estimated time to improve auto-scheduling
- **Morning ritual**: Natural review flow via task list, no forced wizard

---

## Status

**Current:** Design complete, spec written  
**Next:** Phase 1 implementation (core MVP)

See [SPEC.md](./SPEC.md) for full technical specification.

---

## Quick Start (when implemented)

```bash
git clone <repo-url>
cd taskflow-app
python -m http.server 8000
# Open http://localhost:8000
```

---

## Core Concepts

### Tasks
- Description, urgency bucket, estimated duration
- Can be scheduled (in matrix) or unscheduled (in list)
- Timer tracking for actual completion time

### Week Matrix
- Visual grid: Days (rows) × Hours (columns)
- Drag tasks from list to schedule them
- Auto-splits multi-day tasks

### Auto-Allocate
- Smart scheduler that arranges tasks based on urgency + staleness
- Adjusts estimates using historical overrun data

---

## Tech Stack

- **Frontend**: Vanilla JS or Vue 3
- **Persistence**: LocalStorage (no backend initially)
- **Libraries**: Interact.js (drag-and-drop), Luxon (dates)

---

## License

MIT (or TBD)

---

## Contact

George Dickeson — [george.dickeson@gmail.com](mailto:george.dickeson@gmail.com)
