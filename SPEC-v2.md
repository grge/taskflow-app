# TaskFlow — Technical Specification v2.0

**Date:** 2026-06-02  
**Status:** Design Phase — Envelope-Based Urgency Model  
**Note:** Envelope family and optimization approach TBD (see OPTIMIZATION.md)

---

## 1. Core Concept

TaskFlow is a visual task scheduling app built on a novel urgency model: **every task has a time-dependent "problemness" function** that describes how much of a problem it is that the task isn't complete yet.

### Key Innovation

Instead of static urgency labels or fixed deadlines, tasks have **urgency envelopes** — continuous functions that rise over time, capturing:
- When urgency starts (delay)
- How quickly it escalates (rise rate)
- How bad it gets (importance/peak)
- Whether it expires (decay)

This enables:
- Automatic prioritization without manual re-triage
- Mathematically optimal scheduling (minimize total accumulated problemness)
- Natural handling of different task types (emails, meetings, projects)

---

## 2. User-Facing Model

### Task Properties

Every task has:

1. **Description** (text)
2. **Estimated Duration** (minutes)
3. **Urgency Profile** (preset: "Next Few Hours", "Today", "Tomorrow", "Next Few Days", "Next Week")
4. **Importance** (Low/Medium/High — controls peak problemness)
5. **Custom Envelope** (optional advanced mode)

### Urgency Profiles (Presets)

Presets define the **shape** of the problemness curve:

**Next Few Hours**
- Delay: 0 hours
- Rise: Steep (reaches peak in 4 hours)
- Use case: Urgent email, quick task before meeting

**Today**
- Delay: 0 hours  
- Rise: Moderate (reaches peak by end of workday, ~8 hours)
- Use case: Daily tasks, typical work items

**Tomorrow**
- Delay: Until end of today (~8 hours)
- Rise: Moderate (reaches peak by end of tomorrow)
- Use case: Can wait until tomorrow, but should be done then

**Next Few Days**
- Delay: 0-4 hours
- Rise: Gentle (reaches peak in 3-5 days)
- Use case: Tasks on radar, not urgent yet

**Next Week**
- Delay: 1-2 days
- Rise: Very gentle (reaches peak in 7 days)
- Use case: Backlog items, low urgency

### Importance Levels

Importance controls the **peak height** (maximum problemness):

- **Low (0.3)**: Annoying if missed, not critical
- **Medium (0.6)**: Matters, but recoverable
- **High (1.0)**: Critical, major consequences

### Combined Example

"Respond to client email" with:
- Urgency: **Today** (moderate rise curve)
- Importance: **High** (peak = 1.0)

Result: Problemness starts rising immediately, reaches critical level by end of day.

---

## 3. Data Model

### Task Schema

```typescript
interface Task {
  id: string;                    // UUID
  description: string;
  estimatedMinutes: number;
  
  // Urgency envelope
  urgencyProfile: UrgencyProfile;
  importance: Importance;
  customEnvelope?: EnvelopeParams;  // Overrides profile if set
  
  // Timestamps
  createdAt: Date;
  lastModifiedAt: Date;
  completedAt?: Date;
  
  // Scheduling
  scheduledBlocks: ScheduledBlock[];
  
  // Time tracking
  timeSessions: TimeSession[];
  totalActualMinutes?: number;
  
  // State
  isCompleted: boolean;
  isDeleted: boolean;
}

type UrgencyProfile = "hours" | "today" | "tomorrow" | "days" | "week" | "custom";
type Importance = "low" | "medium" | "high";

// Envelope family and parameterization is TBD (see OPTIMIZATION.md)
// Candidates: piecewise linear, logistic, exponential
// Requirements:
// - Monotonically increasing (problemness never decreases)
// - Parameterizable by urgency profile presets
// - Closed-form or tractable integral for optimization

interface EnvelopeParams {
  // Exact structure depends on chosen envelope family
  // Placeholder for specification purposes
  [key: string]: number;
}

// Preset envelope definitions (structure TBD based on chosen family)
const URGENCY_ENVELOPES: Record<UrgencyProfile, EnvelopeParams> = {
  hours: { /* TBD */ },
  today: { /* TBD */ },
  tomorrow: { /* TBD */ },
  days: { /* TBD */ },
  week: { /* TBD */ },
  custom: { /* TBD */ }
};

const IMPORTANCE_PEAKS: Record<Importance, number> = {
  low: 0.3,
  medium: 0.6,
  high: 1.0
};
```

### ScheduledBlock Schema

```typescript
interface ScheduledBlock {
  id: string;
  date: string;              // ISO date: "2026-06-04"
  startMinutes: number;      // Minutes from midnight (e.g., 540 = 9:00am)
  durationMinutes: number;
  partIndex?: number;        // For multi-day splits (1/2, 2/2)
  totalParts?: number;
  zIndex?: number;           // For overlapping blocks
}
```

### TimeSession Schema

```typescript
interface TimeSession {
  startedAt: Date;
  pausedAt?: Date;
  finishedAt?: Date;
  durationMinutes: number;
}
```

### Work Schedule Schema

```typescript
interface WorkSchedule {
  days: DaySchedule[];
}

interface DaySchedule {
  dayOfWeek: number;         // 0 = Sunday, 1 = Monday, etc.
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
}
```

---

## 4. Problemness Function

### Mathematical Definition

**Envelope family:** TBD (see `OPTIMIZATION.md` for detailed analysis)

**Requirements:**
1. **Monotonic:** P(t) is non-decreasing (problemness never goes down)
2. **Bounded:** 0 ≤ P(t) ≤ peak (importance-scaled)
3. **Parameterizable:** Maps cleanly to urgency profile presets
4. **Tractable:** Closed-form or efficient integral computation for optimization

**General signature:**

```typescript
function calculateProblemness(task: Task, currentTime: Date): number {
  const envelope = task.customEnvelope || URGENCY_ENVELOPES[task.urgencyProfile];
  const peak = IMPORTANCE_PEAKS[task.importance];
  const hoursElapsed = (currentTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
  
  // Implementation depends on chosen envelope family
  // See OPTIMIZATION.md for candidate families (logistic, exponential, piecewise linear)
  return evaluateEnvelope(envelope, hoursElapsed, peak);
}
```

**Concrete implementation will be specified once envelope family is chosen.**

### Visual Representation

```
Problemness
     ↑
peak |              _____ (approaches peak asymptotically or reaches exactly)
     |            /
     |          /
     |        /
     |      /
   0 |_____/_______________→ Time
       (possible delay)
```

**Note:** No decay phase — problemness is monotonically increasing until task completion.

---

## 5. UI Components

### 5.1 App Layout

```
┌────────────────────────────────────────────────────────────────┐
│ [Header: Auto-Allocate | Insights | Settings]                  │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Week Matrix]              [Task List]                        │
│  (60-70% width)             (30-40% width)                     │
│                                                                 │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│ [Active Task Timer Bar] (if task running)                     │
└────────────────────────────────────────────────────────────────┘
```

### 5.2 Task List

**Purpose:** Master task database, sorted by current problemness

**Layout:**

```
Task List                                    [+ Add Task]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[■] 0.85  Respond to client email           Today | High | 30m
          [hours | today | tomorrow | ▼]    [L | M | H]  [⏵]

[■] 0.72  Prepare Q2 presentation           Tomorrow | High | 2h
          [hours | today | tomorrow | ▼]    [L | M | H]  [⏵]

[ ] 0.45  Review metrics dashboard           Today | Med | 1h
          Scheduled: Wed 10:00am             [hours | today | ▼]

[■] 0.20  Update documentation               Next Few Days | Low | 1h
          [hours | today | tomorrow | ▼]    [L | M | H]  [⏵]
```

**Elements per row:**

1. **Block indicator**: `[■]` unscheduled, `[ ]` scheduled
2. **Problemness label**: Human-readable severity (see scale below)
3. **Description**: Editable text
4. **Urgency picker**: Inline buttons or dropdown (`< >` arrows to cycle)
5. **Importance picker**: `[L | M | H]` buttons
6. **Duration**: Slider or text input
7. **Controls**: Play button (if unscheduled), or "Scheduled: [time]" label

**Subjective Problemness Scale:**

Instead of raw numbers, display human-friendly severity levels:

```typescript
const PROBLEMNESS_SCALE = [
  { min: 0.00, max: 0.20, level: 1, label: "No Problem",      emoji: "😌", color: "#4CAF50" },
  { min: 0.20, max: 0.40, level: 2, label: "Oopsie",         emoji: "😬", color: "#8BC34A" },
  { min: 0.40, max: 0.65, level: 3, label: "Uh oh",          emoji: "😰", color: "#FFA726" },
  { min: 0.65, max: 0.85, level: 4, label: "OH CRAP",        emoji: "🚨", color: "#EF5350" },
  { min: 0.85, max: 1.00, level: 5, label: "I am so sorry", emoji: "💀", color: "#B71C1C" }
];
```

**Display:** Show emoji + label (e.g., `😰 Uh oh`) with background color. Hover shows exact numeric value.

**Sorting:** Always sorted by current problemness, descending (highest urgency at top)

**Interactions:**
- Click description → inline edit
- Click urgency → cycle through presets or open dropdown
- Click importance → toggle L/M/H
- Click duration → slider popup
- Drag `[■]` → schedule to matrix
- Click ⏵ → start timer

### 5.3 Week Matrix

**Purpose:** Visual scheduling canvas

**Structure:**
- **Rows:** Days (Today, Tomorrow, Day+2, etc., filtered by work schedule)
- **Columns:** Hours (work hours only, e.g., 9am-5pm)
- **Grid:** Visible 1-hour lines, invisible 15-min snap points

**Task Blocks:**
- Width = duration
- Height = single row (one day)
- Color/shade = problemness at scheduled time (not current)
- Label: Task description (truncated)
- Draggable, resizable

**Overlapping blocks:**
- Stack with z-index
- Slight vertical offset (8-12px per layer)
- All edges remain visible

**Interactions:**
- Drag from task list → schedule
- Drag within matrix → reschedule
- Drag to task list → unschedule
- Resize edges → adjust duration (snaps to 15min)

### 5.4 Custom Envelope Editor (Advanced)

**Trigger:** "Custom" urgency preset → "Edit Curve" button

**UI:**
- Graph: Time (x-axis) vs Problemness (y-axis)
- Control points: Drag to adjust delay, rise, peak, decay
- Presets: "Start from: Email | Meeting | Project | ..."
- Live preview: Shows curve, highlights current time

**Implementation note:** Similar to DAW envelope editors (Ableton, Logic)

### 5.5 Active Task Timer Bar

**Location:** Bottom of screen, full-width

**Content:**
- Task name
- Elapsed time (updates every second)
- Pause / Finish buttons

**Example:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Respond to client email — 23m 15s   [⏸ Pause] [⏹ Finish]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 6. Core Algorithms

### 6.1 Auto-Allocate Scheduler

**Objective:** Minimize total accumulated problemness over the scheduling horizon.

**Mathematical formulation:**

Minimize: `∫[now → horizon] Σ P_i(t) dt`

Where:
- `P_i(t)` = problemness of task *i* at time *t*
- Integration is over all unscheduled tasks
- Horizon = typically next 7 days (configurable)

**Algorithm (simplified greedy approximation):**

```typescript
function autoAllocate(tasks: Task[], schedule: WorkSchedule, horizon: Date): ScheduledBlock[] {
  const blocks: ScheduledBlock[] = [];
  const unscheduled = tasks.filter(t => t.scheduledBlocks.length === 0 && !t.isCompleted);
  
  // Sort by urgency score (heuristic for integral minimization)
  const sorted = unscheduled.sort((a, b) => {
    const scoreA = calculateUrgencyScore(a);
    const scoreB = calculateUrgencyScore(b);
    return scoreB - scoreA;
  });
  
  let currentDate = new Date();
  let currentMinute = getCurrentWorkMinute(currentDate, schedule);
  
  for (const task of sorted) {
    const result = scheduleTask(task, currentDate, currentMinute, schedule, horizon);
    if (result.blocks.length > 0) {
      blocks.push(...result.blocks);
      currentDate = result.nextDate;
      currentMinute = result.nextMinute;
    }
  }
  
  return blocks;
}

function calculateUrgencyScore(task: Task): number {
  const currentProblemness = calculateProblemness(task, new Date());
  const envelope = getTaskEnvelope(task);
  
  // Heuristic: Weight by current problemness + rate of increase
  const riseRate = envelope.peakProblemness / envelope.riseHours;
  return currentProblemness + (riseRate * 0.5);
}
```

**Note:** This greedy algorithm is an approximation. For exact optimization, would need dynamic programming or constraint solver. Greedy is fast and good enough for typical workloads.

### 6.2 Multi-Day Task Splitting

```typescript
function scheduleTask(
  task: Task,
  startDate: Date,
  startMinute: number,
  schedule: WorkSchedule,
  horizon: Date
): { blocks: ScheduledBlock[], nextDate: Date, nextMinute: number } {
  
  const blocks: ScheduledBlock[] = [];
  let remainingMinutes = task.estimatedMinutes;
  let currentDate = new Date(startDate);
  let currentMinute = startMinute;
  let partIndex = 1;
  
  while (remainingMinutes > 0 && currentDate <= horizon) {
    const daySchedule = getDaySchedule(currentDate, schedule);
    
    if (!daySchedule) {
      // Not a work day, skip to next
      currentDate.setDate(currentDate.getDate() + 1);
      currentMinute = 0;
      continue;
    }
    
    if (currentMinute < daySchedule.startMinutes) {
      currentMinute = daySchedule.startMinutes;
    }
    
    const availableMinutes = daySchedule.endMinutes - currentMinute;
    
    if (availableMinutes <= 0) {
      // Day is full, move to next work day
      currentDate.setDate(currentDate.getDate() + 1);
      currentMinute = 0;
      continue;
    }
    
    const blockMinutes = Math.min(remainingMinutes, availableMinutes);
    
    blocks.push({
      id: crypto.randomUUID(),
      date: currentDate.toISOString().split('T')[0],
      startMinutes: currentMinute,
      durationMinutes: blockMinutes,
      partIndex: blocks.length > 0 ? partIndex : undefined,
      totalParts: undefined  // Set after loop
    });
    
    remainingMinutes -= blockMinutes;
    currentMinute += blockMinutes;
    partIndex++;
  }
  
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

### 6.3 Estimation Accuracy Tracking

```typescript
interface EstimationStats {
  totalCompleted: number;
  averageOverrunMultiplier: number;  // e.g., 1.3 = typically 30% over estimate
  byUrgencyProfile: {
    [key in UrgencyProfile]: {
      count: number;
      avgMultiplier: number;
    }
  };
}

function updateStats(task: Task, stats: EstimationStats): EstimationStats {
  if (!task.totalActualMinutes || !task.estimatedMinutes) return stats;
  
  const multiplier = task.totalActualMinutes / task.estimatedMinutes;
  
  // Update global average
  const totalMultiplier = stats.averageOverrunMultiplier * stats.totalCompleted;
  stats.totalCompleted++;
  stats.averageOverrunMultiplier = (totalMultiplier + multiplier) / stats.totalCompleted;
  
  // Update per-profile
  const profile = task.urgencyProfile;
  const profileStats = stats.byUrgencyProfile[profile] || { count: 0, avgMultiplier: 1.0 };
  const profileTotal = profileStats.avgMultiplier * profileStats.count;
  profileStats.count++;
  profileStats.avgMultiplier = (profileTotal + multiplier) / profileStats.count;
  stats.byUrgencyProfile[profile] = profileStats;
  
  return stats;
}
```

---

## 7. Visual Design

### Color System

**Problemness colors** (see scale in Section 5.2):
- Level 1-2: Green shades (#4CAF50, #8BC34A)
- Level 3: Orange (#FFA726)
- Level 4-5: Red shades (#EF5350, #B71C1C)

**Task blocks:**
- Single neutral color when scheduled (blue #4A90E2)
- Or: Shade by problemness at scheduled time (optional mode)

**UI elements:**
- Background: Light gray (#F5F5F5)
- Grid lines: Subtle gray (#E0E0E0)
- Text: Dark gray (#333333)

### Typography

- Body: System font (Inter, SF Pro, Segoe UI)
- Monospace: Timer display (Menlo, Consolas)

### Spacing

- Task list row: 48px height
- Matrix cell: 80px wide × 60px tall
- Padding: 8px (small), 16px (medium), 24px (large)

---

## 8. Implementation Phases

### Phase 1: Core MVP (Week 1-2)

**Goal:** Validate envelope-based urgency model

**Features:**
- Task CRUD with urgency profiles + importance
- Problemness calculation (display current value)
- Task list sorted by problemness
- Work schedule configuration
- Week matrix rendering
- Manual drag-and-drop scheduling

**Not included:**
- Auto-allocate
- Custom envelopes
- Timers
- Insights

**Success criteria:** Can see problemness values update over time, manual scheduling works

---

### Phase 2: Auto-Allocate (Week 3)

**Goal:** Prove automated scheduling works

**Features:**
- Auto-allocate button (greedy algorithm)
- Multi-day task splitting
- Problemness-based sorting/prioritization

**Success criteria:** Auto-allocate produces reasonable schedules

---

### Phase 3: Time Tracking (Week 4)

**Goal:** Collect actual completion data

**Features:**
- Start/pause/finish timer
- Active task timer bar
- Store time sessions
- Calculate actual vs estimated

---

### Phase 4: Insights & Learning (Week 5)

**Goal:** Use data to improve estimates

**Features:**
- Insights modal (stats display)
- Adjust auto-allocate using historical multipliers
- Show adjusted estimates in UI

---

### Phase 5: Advanced Features (Week 6+)

**Goal:** Power user features

**Features:**
- Custom envelope editor (DAW-style curve)
- Export/import data
- Keyboard shortcuts
- Polish & edge cases

---

## 9. Technical Stack

**Frontend:**
- Vanilla JS or Vue 3 (decision pending)
- Interact.js or Sortable.js (drag-and-drop)
- Luxon or date-fns (date handling)

**Persistence:**
- LocalStorage (v1)
- Future: IndexedDB or backend API

**Build:**
- Vite (if using Vue)
- Or: No build step (vanilla JS)

---

## 10. Open Questions & Considerations

### Q1: Envelope family selection

**Question:** Which mathematical family for envelope functions?

**Options:**
- Piecewise linear (simple, sharp transitions)
- Logistic/sigmoid (smooth S-curve, realistic urgency acceleration)
- Exponential growth (simplest, natural acceleration)
- Custom parametric curves

**Decision deferred to:** `OPTIMIZATION.md` — choice depends on optimization tractability and UX testing.

**Constraint:** Must be monotonically increasing (no decay phase).

---

### Q2: Problemness label refinement

**Question:** Are the current labels ("Oopsie", "Uh oh", "OH CRAP", "I am so sorry") the right tone?

**Consideration:** Playful vs professional. Could offer alternate label sets (casual/professional modes).

**Current decision:** Use playful labels as default, revisit after user testing.

---

### Q3: Negative problemness?

**Question:** Can tasks have negative problemness (beneficial to do early)?

**Use case:** "Prepare for meeting next week" — doing it early reduces stress even though not urgent yet.

**Current design:** No, problemness is always ≥ 0. Early completion is implicitly beneficial (reduces future integral).

**Alternative:** Allow negative delay (task starts at low positive problemness, rises from there). Captures "nice to have done early" tasks.

---

### Q4: Multi-importance tasks

**Question:** Some tasks have variable importance depending on when they're done (e.g., "respond within 1 hour = high importance, within 1 day = medium")

**Current design:** Single importance value

**Future extension:** Piecewise importance (peak can change over time)

---

### Q5: Dependencies between tasks

**Question:** Task B can't start until Task A is done.

**Current design:** No dependencies (out of scope for v1)

**Future:** Add dependency edges, constrain auto-allocate

---

### Q6: Recurring tasks

**Question:** Weekly standup, daily email check, etc.

**Current design:** Not supported (v1 = one-off tasks only)

**Future:** Template system, envelope resets on recurrence

---

### Q7: Calendar integration

**Question:** Import meetings from Google Calendar, block out time.

**Current design:** Manual work schedule only

**Future:** Sync with external calendars, treat meetings as fixed blocks

---

## 11. Success Metrics

**For prototype validation:**

1. **Problemness makes intuitive sense:** Users can predict which tasks will have high values
2. **Auto-allocate is useful:** Schedules feel reasonable, save time vs manual
3. **Envelopes are learnable:** Users understand profiles within ~5 tasks created
4. **System reduces stress:** Fewer "what should I do next?" decisions

**Failure modes to watch for:**

- Problemness feels arbitrary or unpredictable
- Auto-allocate produces nonsensical schedules
- UI is too complex (too many knobs)
- Performance issues (recalculating problemness on every render)

---

## 12. Performance Considerations

**Problemness calculation:**
- Simple math (linear, no expensive operations)
- Cache current values, recalculate on timer tick (every 60s)
- Avoid recalculating on every render

**Auto-allocate:**
- Greedy algorithm is O(n log n) (sort + linear pack)
- For n = 20 tasks, trivial performance
- For n > 100, might need optimization (batch processing)

**Rendering:**
- Task list: Virtual scrolling if > 100 tasks
- Matrix: Canvas or SVG for smooth drag-and-drop

---

## 13. Accessibility

**Keyboard shortcuts:**
- `N`: New task
- `Space`: Start/pause selected task
- `↑↓`: Navigate task list
- `Enter`: Edit description
- `Esc`: Cancel edit

**Screen reader:**
- Announce current problemness on task focus
- Describe envelope profiles in plain language
- ARIA labels for drag-and-drop regions

**Color contrast:**
- WCAG AA minimum (4.5:1 for text)
- Don't rely solely on color (use icons + text)

---

## 14. File Structure

```
taskflow-app/
├── index.html
├── styles/
│   ├── main.css
│   ├── matrix.css
│   ├── tasklist.css
│   └── modals.css
├── scripts/
│   ├── app.js
│   ├── data.js              # Task model, persistence
│   ├── envelope.js          # Problemness calculations
│   ├── scheduler.js         # Auto-allocate
│   ├── stats.js             # Estimation tracking
│   ├── ui/
│   │   ├── matrix.js
│   │   ├── tasklist.js
│   │   ├── timer.js
│   │   ├── envelope-editor.js
│   │   └── modals.js
│   └── utils.js
├── docs/
│   ├── SPEC-v2.md           # This file
│   └── DESIGN.md            # Design decisions log
└── README.md
```

---

## 15. Example Data

### Task with envelope

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Respond to client email",
  "estimatedMinutes": 30,
  "urgencyProfile": "today",
  "importance": "high",
  "customEnvelope": null,
  "createdAt": "2026-06-02T09:00:00Z",
  "lastModifiedAt": "2026-06-02T09:00:00Z",
  "scheduledBlocks": [],
  "timeSessions": [],
  "isCompleted": false,
  "isDeleted": false
}
```

### Calculated problemness at different times

```
t = 0h (9:00am):   P = 0.00  (just created)
t = 2h (11:00am):  P = 0.25  (rising)
t = 4h (1:00pm):   P = 0.50  (halfway)
t = 6h (3:00pm):   P = 0.75  (urgent)
t = 8h (5:00pm):   P = 1.00  (peak, end of day)
t = 10h (7:00pm):  P = 1.00  (sustain, still urgent)
```

---

**End of Specification**

This document is the canonical design for TaskFlow v2.0. Implementation should follow this spec unless design changes are explicitly approved and documented.
