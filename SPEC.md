# TaskFlow App — Technical Specification

**Version:** 1.1  
**Date:** 2026-06-02  
**Status:** Design Complete, Ready for Implementation  
**Changelog:** Updated grid view (starts with Today), 15-min snap grid, overlapping blocks (stagger), improved urgency/duration controls

---

## 1. Overview

### Purpose
A short-term task management app for knowledge workers who need to manage ~10 daily tasks with fuzzy urgency and duration estimates. Focuses on visual scheduling, realistic time allocation, and estimation accuracy improvement through data collection.

### Core Philosophy
- **Fuzzy by design**: No strict deadlines, vague urgency buckets
- **Visual scheduling**: Drag-and-drop time blocks into a week matrix
- **Learning system**: Collects actual vs estimated time to improve auto-scheduling
- **Morning ritual**: Natural review flow via task list, no forced wizard

### Not In Scope (v1)
- Multi-user / collaboration
- Mobile apps (desktop web only)
- Task recurrence / templates
- Project hierarchies / dependencies
- External calendar sync

---

## 2. Data Model

### Task Schema

```typescript
interface Task {
  id: string;                    // UUID
  description: string;           // User-editable text
  urgency: UrgencyBucket;        // Enum: hours, today, tomorrow, days, week
  estimatedMinutes: number;      // User's time estimate
  
  // Timestamps
  createdAt: Date;
  lastModifiedAt: Date;
  completedAt?: Date;
  
  // Scheduling
  scheduledBlocks: ScheduledBlock[];  // Empty if unscheduled
  
  // Time tracking
  timeSessions: TimeSession[];
  totalActualMinutes?: number;   // Sum of all sessions
  
  // Metadata
  isCompleted: boolean;
  isDeleted: boolean;            // Soft delete
}

enum UrgencyBucket {
  HOURS = "hours",               // Next few hours
  TODAY = "today",               // By end of workday today
  TOMORROW = "tomorrow",         // By end of workday tomorrow
  DAYS = "days",                 // Next few days (2-5 days)
  WEEK = "week"                  // Within the week
}

interface ScheduledBlock {
  id: string;                    // UUID
  date: string;                  // ISO date string (e.g., "2026-06-04") - absolute, not relative
  startMinutes: number;          // Minutes from midnight (e.g., 540 = 9:00am)
  durationMinutes: number;       // Length of this block
  partIndex?: number;            // For multi-day splits (1/2, 2/2)
  totalParts?: number;
  zIndex?: number;               // For overlapping blocks (higher = on top)
}

interface TimeSession {
  startedAt: Date;
  pausedAt?: Date;
  finishedAt?: Date;
  durationMinutes: number;       // Calculated from timestamps
}
```

### Work Schedule Schema

```typescript
interface WorkSchedule {
  days: DaySchedule[];           // One per day of week
}

interface DaySchedule {
  dayOfWeek: number;             // 0 = Sunday, 1 = Monday, etc.
  enabled: boolean;              // Work day or not
  startMinutes: number;          // Minutes from midnight (e.g., 540 = 9:00am)
  endMinutes: number;            // Minutes from midnight (e.g., 870 = 2:30pm)
}

// Default: M-F, 9:00am - 5:00pm
```

### User Preferences Schema

```typescript
interface UserPreferences {
  workSchedule: WorkSchedule;
  showCompletedTasks: boolean;   // Default: false
  
  // Auto-allocate settings
  autoAllocateBuffer: number;    // Minutes between tasks (default: 0)
  preferContiguous: boolean;     // Keep tasks together (default: true)
  
  // Estimation adjustment
  useHistoricalAdjustment: boolean;  // Default: true after 10+ completed tasks
}
```

### Statistics Schema

```typescript
interface EstimationStats {
  totalCompleted: number;
  averageOverrunMultiplier: number;    // e.g., 1.3 = 30% over
  byUrgency: {
    [key in UrgencyBucket]: {
      count: number;
      avgMultiplier: number;
    }
  };
}
```

---

## 3. Data Persistence

### Storage Layer
- **Browser LocalStorage** for initial prototype
- Future: IndexedDB or backend API

### Storage Keys
```typescript
const STORAGE_KEYS = {
  TASKS: 'taskflow_tasks',
  PREFERENCES: 'taskflow_preferences',
  STATS: 'taskflow_stats'
};
```

### Persistence Strategy
- Auto-save on every change (debounced 500ms)
- No explicit "save" button
- Export/import as JSON for backup

---

## 4. Core Components

### 4.1 App Shell

```
┌────────────────────────────────────────────────────────────────┐
│ [Header: Logo | Auto-Allocate | Insights | Settings]           │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Week Matrix]              [Task List]                        │
│  (60-70% width)             (30-40% width)                     │
│                                                                 │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│ [Active Task Timer Bar] (only visible when task running)      │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 Week Matrix

**Purpose:** Visual scheduling surface

**Structure:**
- Grid: Days (rows) × Time slots (columns)
- Days: Starts with **Today**, then shows next N work days (e.g., if work schedule is M/W/F, grid shows Today, then next M, W, F, M, W, F...)
- Time slots: Hourly columns within work hours
- Cells: 1 hour each (visual grid lines)
- **Snap grid**: 15-minute resolution (invisible snap points for precise scheduling)

**Elements:**
- **Task blocks**: Rectangles spanning time cells
  - Width = duration
  - Height = single row (one day)
  - Label: task description (truncated)
  - Color: Single neutral color (no urgency coding)
- **Grid lines**: Light borders between cells
- **Current time indicator**: Red vertical line (if viewing today)

**Interactions:**
- **Drag from task list → matrix**: Schedule task (snaps to 15-min grid)
- **Drag within matrix**: Reschedule (change day/time, snaps to 15-min grid)
- **Drag from matrix → task list**: Unschedule
- **Click block**: Highlight (no separate detail panel)
- **Resize handles**: Adjust duration (stretch block edges, snaps to 15-min increments)

**Overlapping blocks:**
- When tasks overlap in time, blocks **stack with stagger**
- Later-placed blocks appear on top (z-index)
- Slight vertical offset (8-12px per layer) so all block edges remain visible
- Uniform block height maintained (no swim lanes)
- Allows intentional double-booking without breaking grid structure

**Auto-split behavior:**
- When dragging, if task duration exceeds remaining day hours:
  - Split into consecutive blocks
  - Label each part: "Task Name (1/2)", "Task Name (2/2)"
  - All parts link to same task

### 4.3 Task List

**Purpose:** Master task database, editing surface, unscheduled queue

**Layout:** Table-like list

**Columns:**
1. **Block indicator**: `[■]` unscheduled, `[ ]` scheduled
2. **Description**: Editable text (click to edit inline)
3. **Urgency**: Badge (click to change)
4. **Duration**: Text (click to change)
5. **Status flags**: Timer, stale indicator
6. **Controls**: Play/Pause/Stop (hover-revealed)

**Row states:**
- **Normal**: Default styling
- **Stale**: Faded/grayed (age > bucket typical range)
- **Running**: Highlighted, timer visible
- **Completed**: Strike-through, hidden by default (toggle to show)

**Interactions:**
- **Click description**: Inline edit mode
- **Click urgency**: `< >` arrow buttons to cycle through buckets (hours → today → tomorrow → days → week)
- **Click duration**: Slider control (0-240 min range, snap points at 15/30/45/60/90/120/150/180 minutes)
- **Drag `[■]` block**: Schedule to matrix
- **Play button**: Start timer
- **Pause/Stop**: Pause or complete timer
- **Enter on "Add task" row**: Create new task

**Quick Add:**
- Always-present input row at bottom
- Fields: Description, Urgency (default: Today), Duration (default: 30m)
- Enter to add, immediately ready for next

### 4.4 Active Task Timer Bar

**Location:** Full-width bar at bottom of screen

**Visible:** Only when a task has an active timer

**Content:**
- Task name (truncated)
- Elapsed time (MM:SS, updates every second)
- Pause button
- Finish button

**Example:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Write quarterly report — 1h 23m 15s   [⏸ Pause] [⏹ Finish]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**State persistence:** Timer survives page refresh (stored in localStorage)

### 4.5 Settings Modal

**Trigger:** "Settings" button in header

**Content:**
- Work schedule configuration
  - Days of week (checkboxes)
  - Hours per day (start/end time pickers)
- Auto-allocate preferences
  - Buffer time between tasks (0/15/30 min)
  - Prefer contiguous blocks (checkbox)
- Show/hide completed tasks (toggle)
- Export data (download JSON)

**Actions:** Save (persist + close), Cancel (discard)

### 4.6 Insights Modal

**Trigger:** "Insights" button in header

**Content:**
- Total completed tasks
- Total time tracked
- Average estimation accuracy: "You typically take 1.3x your estimate"
- Per-urgency breakdown:
  - "Next few hours: 1.1x (close!)"
  - "Today: 1.4x (often underestimate)"
  - etc.
- Simple text stats (no graphs in v1)

**Future:** Charts, trends over time, per-task-type accuracy

---

## 5. Core Algorithms

### 5.1 Auto-Allocate Scheduler

**Input:** List of unscheduled tasks

**Output:** Scheduled blocks in matrix

**Algorithm:**

```typescript
function autoAllocate(tasks: Task[], schedule: WorkSchedule, stats: EstimationStats): ScheduledBlock[] {
  const blocks: ScheduledBlock[] = [];
  
  // 1. Adjust estimates based on history
  const adjustedTasks = tasks.map(task => ({
    ...task,
    adjustedMinutes: task.estimatedMinutes * getMultiplier(task.urgency, stats)
  }));
  
  // 2. Sort by priority
  const sorted = adjustedTasks.sort((a, b) => {
    const urgencyWeight = {
      [UrgencyBucket.HOURS]: 5,
      [UrgencyBucket.TODAY]: 4,
      [UrgencyBucket.TOMORROW]: 3,
      [UrgencyBucket.DAYS]: 2,
      [UrgencyBucket.WEEK]: 1
    };
    
    const stalenessA = getDaysSinceModified(a);
    const stalenessB = getDaysSinceModified(b);
    
    const scoreA = urgencyWeight[a.urgency] * (1 + stalenessA / 7);
    const scoreB = urgencyWeight[b.urgency] * (1 + stalenessB / 7);
    
    return scoreB - scoreA; // Higher score first
  });
  
  // 3. Pack into earliest available slots
  let currentDate = new Date(); // Start from today
  let currentMinute = getCurrentMinute(); // Current time of day
  
  for (const task of sorted) {
    const result = scheduleTask(task, currentDate, currentMinute, schedule);
    blocks.push(...result.blocks);
    currentDate = result.nextDate;
    currentMinute = result.nextMinute;
  }
  
  return blocks;
}

function getMultiplier(urgency: UrgencyBucket, stats: EstimationStats): number {
  if (!stats || stats.totalCompleted < 10) return 1.0; // Not enough data
  
  const bucketStats = stats.byUrgency[urgency];
  return bucketStats?.avgMultiplier || stats.averageOverrunMultiplier;
}
```

### 5.2 Multi-Day Task Splitting

**When:** User drags a task block into the matrix

**Logic:**

```typescript
function scheduleTask(
  task: Task,
  startDate: Date,
  startMinute: number,
  schedule: WorkSchedule
): { blocks: ScheduledBlock[], nextDate: Date, nextMinute: number } {
  
  const blocks: ScheduledBlock[] = [];
  let remainingMinutes = task.adjustedMinutes || task.estimatedMinutes;
  let currentDate = new Date(startDate);
  let currentMinute = startMinute;
  let partIndex = 1;
  
  while (remainingMinutes > 0) {
    const dayOfWeek = currentDate.getDay();
    const daySchedule = schedule.days.find(d => d.dayOfWeek === dayOfWeek && d.enabled);
    
    if (!daySchedule) {
      // Not a work day, move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      currentMinute = 0;
      continue;
    }
    
    if (currentMinute < daySchedule.startMinutes) {
      currentMinute = daySchedule.startMinutes;
    }
    
    const availableMinutes = daySchedule.endMinutes - currentMinute;
    
    if (availableMinutes <= 0) {
      // Move to next work day
      currentDate.setDate(currentDate.getDate() + 1);
      currentMinute = 0;
      continue;
    }
    
    const blockMinutes = Math.min(remainingMinutes, availableMinutes);
    
    blocks.push({
      id: generateUUID(),
      date: currentDate.toISOString().split('T')[0], // "2026-06-04"
      startMinutes: currentMinute,
      durationMinutes: blockMinutes,
      partIndex: blocks.length > 0 ? partIndex : undefined,
      totalParts: undefined // Set after loop
    });
    
    remainingMinutes -= blockMinutes;
    currentMinute += blockMinutes;
    partIndex++;
  }
  
  // Set total parts if split
  if (blocks.length > 1) {
    blocks.forEach(b => b.totalParts = blocks.length);
  }
  
  return {
    blocks,
    nextDate: currentDate,
    nextMinute: currentMinute
  };
}
```

### 5.3 Staleness Detection

**Logic:**

```typescript
function isStale(task: Task): boolean {
  const ageInDays = (Date.now() - task.lastModifiedAt.getTime()) / (1000 * 60 * 60 * 24);
  
  const thresholds = {
    [UrgencyBucket.HOURS]: 0.5,    // 12 hours
    [UrgencyBucket.TODAY]: 1,      // 1 day
    [UrgencyBucket.TOMORROW]: 2,   // 2 days
    [UrgencyBucket.DAYS]: 5,       // 5 days
    [UrgencyBucket.WEEK]: 7        // 7 days
  };
  
  return ageInDays > thresholds[task.urgency];
}
```

### 5.4 Estimation Statistics Calculation

**Triggered:** After each task completion

```typescript
function updateStats(task: Task, stats: EstimationStats): EstimationStats {
  if (!task.totalActualMinutes || !task.estimatedMinutes) return stats;
  
  const multiplier = task.totalActualMinutes / task.estimatedMinutes;
  
  // Update global average
  const totalMultiplier = stats.averageOverrunMultiplier * stats.totalCompleted;
  stats.totalCompleted++;
  stats.averageOverrunMultiplier = (totalMultiplier + multiplier) / stats.totalCompleted;
  
  // Update per-urgency bucket
  const bucket = stats.byUrgency[task.urgency] || { count: 0, avgMultiplier: 1.0 };
  const bucketTotal = bucket.avgMultiplier * bucket.count;
  bucket.count++;
  bucket.avgMultiplier = (bucketTotal + multiplier) / bucket.count;
  stats.byUrgency[task.urgency] = bucket;
  
  return stats;
}
```

---

## 6. UI/UX Specifications

### Visual Design

**Color Palette:**
- **Primary**: Single blue/neutral for task blocks (`#4A90E2` or similar)
- **Background**: Light gray (`#F5F5F5`)
- **Grid lines**: Subtle gray (`#E0E0E0`)
- **Text**: Dark gray (`#333333`)
- **Stale indicator**: Desaturated/faded primary
- **Timer bar**: Accent color (`#FFA500` or similar)

**Typography:**
- **Body**: System font stack (Inter, SF Pro, Segoe UI, etc.)
- **Monospace**: For timer display (Menlo, Consolas, Monaco)

**Spacing:**
- Task list row height: 48px
- Matrix cell size: 80px wide × 60px tall (adjust based on zoom)
- Padding: 8px (small), 16px (medium), 24px (large)

### Responsive Behavior

**Desktop (primary target):**
- Matrix: 60-70% width
- Task list: 30-40% width
- Minimum window width: 1024px

**Tablet (nice-to-have):**
- Matrix and list stack vertically
- Matrix above, task list below

**Mobile (out of scope v1):**
- Not supported initially

### Accessibility

**Keyboard shortcuts:**
- `N`: New task (focus quick-add row)
- `Space`: Start/pause timer on selected task
- `Enter`: Submit edits, complete actions
- `Escape`: Cancel edits, close modals
- Arrow keys: Navigate task list

**Screen reader support:**
- Semantic HTML (headings, labels, buttons)
- ARIA labels for drag-and-drop regions
- Status announcements for timer state changes

**Color contrast:**
- WCAG AA minimum (4.5:1 for text)

---

## 7. Technical Stack

### Frontend

**Framework:** Vue 3 (or framework-free HTML/JS for simplicity)

**Why Vue:**
- George's preference for web apps
- Reactive data binding (good for timers, drag-and-drop)
- Component-based (clean separation)

**Alternative (simpler):** Vanilla JS + HTML + CSS
- Pros: No build step, faster iteration
- Cons: More manual DOM manipulation

**Recommendation:** Start framework-free, migrate to Vue if complexity grows

### Libraries

**Required:**
- **Drag-and-drop**: Interact.js or Sortable.js
- **Date handling**: Luxon or date-fns (lightweight)
- **UUID generation**: `crypto.randomUUID()` (native, no library needed)

**Optional:**
- **Charts** (future): Chart.js or Recharts for insights
- **State management** (if using Vue): Pinia (only if needed)

### Build Tools

**Development:**
- Local dev server: `python -m http.server` or `npx serve`
- Live reload: Browser-sync or Vite (if Vue)

**Production:**
- Static HTML/CSS/JS (no build step initially)
- Future: Vite for optimization

### Testing

**Manual testing** for v1 prototype

**Future:**
- Unit tests: Vitest or Jest
- E2E tests: Playwright
- Focus on: Auto-allocate logic, staleness detection, stats calculation

---

## 8. File Structure

```
taskflow-app/
├── index.html              # Main app shell
├── styles/
│   ├── main.css            # Global styles
│   ├── matrix.css          # Week matrix styles
│   ├── tasklist.css        # Task list styles
│   └── modals.css          # Settings/insights modals
├── scripts/
│   ├── app.js              # App initialization
│   ├── data.js             # Data model & persistence
│   ├── scheduler.js        # Auto-allocate algorithm
│   ├── stats.js            # Estimation statistics
│   ├── ui/
│   │   ├── matrix.js       # Matrix rendering & interactions
│   │   ├── tasklist.js     # Task list rendering & editing
│   │   ├── timer.js        # Active task timer bar
│   │   └── modals.js       # Settings/insights modals
│   └── utils.js            # Date helpers, UUID, etc.
├── docs/
│   ├── SPEC.md             # This file
│   └── DESIGN.md           # Design decisions log
├── README.md               # Project overview
└── package.json            # (Optional, if using npm packages)
```

---

## 9. Implementation Phases

### Phase 1: Core MVP (Week 1-2)

**Goal:** Basic task management + visual scheduling

**Features:**
- Task CRUD (add, edit, delete, complete)
- Task list view with inline editing
- Work schedule configuration (settings modal)
- Week matrix rendering (static grid)
- Drag-and-drop: task list → matrix (simple scheduling)
- LocalStorage persistence

**Not included yet:**
- Timers
- Auto-allocate
- Multi-day splitting
- Insights

**Success criteria:** Can add tasks, drag them into a week view, mark complete

---

### Phase 2: Smart Scheduling (Week 3)

**Goal:** Auto-allocate + multi-day tasks

**Features:**
- Auto-allocate button (basic algorithm without historical adjustment)
- Multi-day task splitting (when duration exceeds day capacity)
- Drag within matrix (reschedule)
- Drag back to list (unschedule)

**Success criteria:** Auto-allocate fills week reasonably, long tasks split across days

---

### Phase 3: Time Tracking (Week 4)

**Goal:** Collect actual completion data

**Features:**
- Start/pause/stop timer on tasks
- Active task timer bar (persistent overlay)
- Store time sessions in task data
- Calculate total actual time on completion

**Not included yet:**
- Using the data (just collecting)

**Success criteria:** Can track time on tasks, see elapsed time, complete with actual duration stored

---

### Phase 4: Learning System (Week 5)

**Goal:** Use data to improve scheduling

**Features:**
- Estimation statistics calculation (average overrun multiplier)
- Insights modal (show stats to user)
- Auto-allocate adjustment (multiply estimates by historical accuracy)
- Display adjusted estimates in matrix ("1h → 1h 18m")

**Success criteria:** After completing 10+ tasks, auto-allocate pads estimates based on history

---

### Phase 5: Polish (Week 6)

**Goal:** UX refinements, edge cases

**Features:**
- Staleness detection (visual flags)
- Show/hide completed tasks toggle
- Keyboard shortcuts
- Drag-and-drop polish (snap to grid, preview on hover)
- Capacity bars per day (visual slack indicators)
- Export/import data (JSON backup)

**Success criteria:** App feels smooth, handles edge cases gracefully

---

## 10. Open Questions / Future Considerations

### Questions for George:

1. **Week view scope**: Always show current week, or allow navigating to future weeks?
2. **Task colors**: Truly single-color, or allow user-defined tags/categories for color-coding?
3. **Undo/redo**: Worth implementing for drag-and-drop mistakes?
4. **Notifications**: Browser notifications for overdue tasks or timer reminders?

### Future Features (post-v1):

- **Recurring tasks**: Weekly/daily templates
- **Task notes**: Longer descriptions, attachments
- **Backend sync**: Multi-device access
- **Calendar integration**: Import meetings, block out time
- **Tags/categories**: Group tasks by project/context
- **Dark mode**: User preference toggle
- **Mobile app**: Native iOS/Android (or PWA)
- **Team features**: Shared task lists, delegation
- **AI suggestions**: "You usually do X at this time, schedule it?"

---

## 11. Success Metrics

**For prototype validation:**

- Can create and manage 10 tasks comfortably
- Auto-allocate produces reasonable schedule (subjectively useful)
- Timer tracking feels lightweight (not annoying)
- After 2 weeks of use, estimation accuracy improves (measurable multiplier decrease)
- George wants to use it daily (primary metric)

**If these fail:**
- Revisit interaction model (too much friction?)
- Simplify features (doing too much?)
- Reevaluate core value prop (solving the right problem?)

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Drag-and-drop feels clunky | Medium | High | Test with Interact.js early, iterate on feel |
| Auto-allocate produces bad schedules | Medium | High | Start with manual override, validate algorithm with real data |
| Timer tracking adds too much friction | Low | Medium | Make it optional, default to simple completion toggle |
| LocalStorage data loss | Low | High | Add export/import, clear backup instructions |
| Scope creep (adding features before core is solid) | High | Medium | Strict phase gates, no Phase 2 until Phase 1 is validated |

---

## 13. Development Setup

### Prerequisites
- Modern browser (Chrome/Edge/Firefox, latest stable)
- Text editor (VS Code, Sublime, etc.)
- Git
- (Optional) Node.js if using npm packages

### Getting Started

```bash
# Clone repo
git clone <repo-url>
cd taskflow-app

# Open in browser
python -m http.server 8000
# or: npx serve

# Navigate to http://localhost:8000
```

### Code Style

**JavaScript:**
- ES6+ features (const/let, arrow functions, template literals)
- Clear function/variable names (no abbreviations)
- One-line docstrings for complex functions
- Functional style where appropriate (pure functions, immutability)

**CSS:**
- BEM naming convention (`.task-list__item--active`)
- Mobile-first media queries (even though mobile is out of scope)
- CSS custom properties for theming (`--color-primary`)

**HTML:**
- Semantic elements (`<header>`, `<main>`, `<article>`)
- Data attributes for JS hooks (`data-task-id="123"`)
- No inline styles (separation of concerns)

---

## 14. Deployment

**Initial:** Local-only (no deployment needed)

**Future:**
- Static hosting: GitHub Pages, Netlify, Vercel
- Custom domain: taskflow.app (or similar)
- HTTPS required (for LocalStorage security)

---

## 15. License & Attribution

**License:** MIT (or George's preference)

**Credits:**
- Design: George Dickeson
- Implementation: TBD
- Inspiration: Workflowy, Notion, Linear (visual simplicity)

---

## 16. Appendix

### Example Task Data (JSON)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Write quarterly report",
  "urgency": "today",
  "estimatedMinutes": 60,
  "createdAt": "2026-06-02T08:00:00Z",
  "lastModifiedAt": "2026-06-02T08:00:00Z",
  "scheduledBlocks": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "date": "2026-06-04",
      "startMinutes": 600,
      "durationMinutes": 60
    }
  ],
  "timeSessions": [
    {
      "startedAt": "2026-06-02T10:00:00Z",
      "pausedAt": "2026-06-02T10:45:00Z",
      "durationMinutes": 45
    }
  ],
  "totalActualMinutes": 45,
  "isCompleted": false,
  "isDeleted": false
}
```

### Example Work Schedule (JSON)

```json
{
  "days": [
    { "dayOfWeek": 0, "enabled": false, "startMinutes": 0, "endMinutes": 0 },
    { "dayOfWeek": 1, "enabled": true, "startMinutes": 540, "endMinutes": 870 },
    { "dayOfWeek": 2, "enabled": true, "startMinutes": 540, "endMinutes": 870 },
    { "dayOfWeek": 3, "enabled": true, "startMinutes": 540, "endMinutes": 870 },
    { "dayOfWeek": 4, "enabled": true, "startMinutes": 540, "endMinutes": 870 },
    { "dayOfWeek": 5, "enabled": true, "startMinutes": 540, "endMinutes": 1020 },
    { "dayOfWeek": 6, "enabled": false, "startMinutes": 0, "endMinutes": 0 }
  ]
}
```
*Note: 540 = 9:00am, 870 = 2:30pm, 1020 = 5:00pm*

---

**End of Specification**

*This document is a living spec — update as design decisions evolve during implementation.*
