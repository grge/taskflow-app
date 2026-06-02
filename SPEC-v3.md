# TaskFlow — Technical Specification v3.0

**Date:** 2026-06-02  
**Status:** Design Complete — Ready for Implementation

---

## 1. Core Concept

TaskFlow is a visual task scheduling app built on a novel urgency model: **every task has a time-dependent "problemness" function** that describes how much of a problem it is that the task isn't complete yet.

### Key Innovation

Tasks have **urgency envelopes** — continuous functions that rise over time, capturing:
- Background problemness (tasks may start already problematic)
- Grace period before urgency rises
- Rise rate (how quickly urgency escalates)
- Peak problemness (maximum urgency)

The scheduler minimizes **total accumulated problemness until task completion** by optimizing the sequence of work.

---

## 2. User-Facing Model

### Task Properties

Every task has:

1. **Description** (text)
2. **Estimated Duration** (minutes)
3. **Urgency Profile** (preset: "Whenever", "Soon", "Important by Date", "Critical", "Nagging Chore")
4. **Importance** (Low/Medium/High — scales peak problemness)

### Urgency Profiles (Presets)

Presets define urgency shapes that map to common task types:

**Whenever**
- Background: Low
- Grace period: Long (days)
- Rise: Slow
- Peak: Low-Medium
- Use case: Tasks that should be done eventually but aren't urgent

**Soon**
- Background: Low
- Grace period: Moderate (hours-day)
- Rise: Moderate
- Peak: Medium
- Use case: Near-future tasks with soft deadlines

**Important by Date**
- Background: Low
- Grace period: Until near deadline
- Rise: Steep
- Peak: High
- Use case: Tasks with meaningful due dates

**Critical**
- Background: High (already problematic)
- Grace period: Short or none
- Rise: Steep
- Peak: High
- Use case: Tasks that are already costly to leave unfinished

**Nagging Chore**
- Background: Low
- Grace period: None
- Rise: Very slow but persistent
- Peak: Low-Medium
- Use case: Small tasks that become irritating over time

### Importance Levels

Importance **scales** the peak problemness:

- **Low (×0.5)**: Annoying but not critical
- **Medium (×1.0)**: Standard importance
- **High (×1.5)**: Critical, major consequences

Combined with profile peak, determines maximum problemness.

### Combined Example

"Respond to client email" with:
- Urgency: **Critical** (high background, steep rise)
- Importance: **High** (×1.5 multiplier)

Result: Starts already problematic, urgency rises steeply, reaches very high peak.

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

type UrgencyProfile = "whenever" | "soon" | "by-date" | "critical" | "chore";
type Importance = "low" | "medium" | "high";

interface EnvelopeParams {
  background: number;       // b_i: Initial/baseline problemness (0-1)
  graceHours: number;       // a_i: Delay before problemness starts rising
  riseHours: number;        // r_i: Time to reach peak after grace period
  peakProblemness: number;  // m_i: Maximum problemness (0-1, scaled by importance)
}

// Preset envelope definitions
const URGENCY_ENVELOPES: Record<UrgencyProfile, Omit<EnvelopeParams, 'peakProblemness'>> = {
  whenever: { background: 0.05, graceHours: 72, riseHours: 168, peakProblemness: 0.4 },
  soon: { background: 0.1, graceHours: 8, riseHours: 24, peakProblemness: 0.6 },
  "by-date": { background: 0.05, graceHours: 48, riseHours: 24, peakProblemness: 0.9 },
  critical: { background: 0.6, graceHours: 0, riseHours: 8, peakProblemness: 1.0 },
  chore: { background: 0.1, graceHours: 0, riseHours: 240, peakProblemness: 0.4 }
};

const IMPORTANCE_MULTIPLIERS: Record<Importance, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.5
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

**Envelope:** Delayed ramp-to-plateau (piecewise linear, monotonically increasing)

For a task with envelope params `(b, a, r, m)`, the problemness at time `t` (hours since creation) is:

```typescript
function calculateProblemness(task: Task, currentTime: Date): number {
  const profile = URGENCY_ENVELOPES[task.urgencyProfile];
  const importance = IMPORTANCE_MULTIPLIERS[task.importance];
  
  const envelope = task.customEnvelope || {
    background: profile.background,
    graceHours: profile.graceHours,
    riseHours: profile.riseHours,
    peakProblemness: profile.peakProblemness * importance
  };
  
  const hoursElapsed = (currentTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
  
  // Phase 1: Background (flat)
  if (hoursElapsed < envelope.graceHours) {
    return envelope.background;
  }
  
  // Phase 2: Rise (linear increase)
  const riseElapsed = hoursElapsed - envelope.graceHours;
  if (riseElapsed < envelope.riseHours) {
    const progress = riseElapsed / envelope.riseHours;
    return envelope.background + (envelope.peakProblemness - envelope.background) * progress;
  }
  
  // Phase 3: Plateau (sustain at peak)
  return envelope.peakProblemness;
}
```

### Accumulated Problemness (Integral)

The scheduler minimizes accumulated problemness until task *completion*:

```typescript
function accumulatedProblemness(task: Task, completionTime: Date): number {
  const envelope = getTaskEnvelope(task);
  const hoursToComplete = (completionTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
  
  // F_i(t) = ∫[0 to t] P_i(u) du
  
  const { background: b, graceHours: a, riseHours: r, peakProblemness: m } = envelope;
  
  if (hoursToComplete <= a) {
    // Only background phase
    return b * hoursToComplete;
  }
  
  if (hoursToComplete <= a + r) {
    // Background + partial rise
    const tRise = hoursToComplete - a;
    return b * a + (b * tRise + (m - b) * tRise * tRise / (2 * r));
  }
  
  // Background + full rise + plateau
  const tPlat = hoursToComplete - a - r;
  return b * a + (b * r + (m - b) * r / 2) + m * tPlat;
}
```

### Visual Representation

```
Problemness
     ↑
  m  |              __________ (plateau)
     |             /
     |            /
     |           /
  b  |__________/              (background)
   0 |______|_______|__________→ Time (hours)
            a     a+r
         (grace) (rise)
```

---

## 5. Scheduling Objective & Algorithm

### Objective Function

**Minimize total accumulated problemness until all tasks are complete:**

```
minimize: Σᵢ F_i(C_i)
```

Where:
- `F_i(C_i)` = accumulated problemness for task i from creation to completion
- `C_i` = completion time (accounting for work schedule gaps)

### Algorithm: Greedy Sequence + Local Search

**Phase 1: Dynamic Greedy Ordering**

At each step, choose the unscheduled task with the highest **avoided cost per duration**:

```typescript
function greedyScore(task: Task, currentWorkTime: Date): number {
  const completionTime = advanceWork(currentWorkTime, task.estimatedMinutes);
  const nowCost = accumulatedProblemness(task, currentWorkTime);
  const completeCost = accumulatedProblemness(task, completionTime);
  
  // Cost avoided per hour of work
  return (completeCost - nowCost) / (task.estimatedMinutes / 60);
}
```

**Intuition:** How much problemness accumulation do we avoid per hour of work by doing this task now?

**Phase 2: Local Search Improvement**

After greedy ordering, improve via:

1. **Adjacent swaps:** Try swapping neighboring tasks, accept if cost reduces
2. **Insertion moves:** Remove task from sequence, try inserting elsewhere

Stop when no local move improves the schedule.

**Full algorithm:**

```typescript
function autoAllocate(tasks: Task[], schedule: WorkSchedule): ScheduledBlock[] {
  // 1. Greedy initial ordering
  const sequence: Task[] = [];
  let currentTime = new Date();
  const remaining = [...tasks.filter(t => !t.isCompleted && t.scheduledBlocks.length === 0)];
  
  while (remaining.length > 0) {
    // Compute scores for all remaining tasks
    const scores = remaining.map(t => ({ task: t, score: greedyScore(t, currentTime) }));
    scores.sort((a, b) => b.score - a.score);
    
    // Take highest-scoring task
    const chosen = scores[0].task;
    sequence.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
    
    // Advance time
    currentTime = advanceWork(currentTime, chosen.estimatedMinutes);
  }
  
  // 2. Pack into schedule
  let blocks = packSequence(sequence, schedule);
  let cost = totalCost(blocks);
  
  // 3. Adjacent swap improvement
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < sequence.length - 1; i++) {
      // Try swapping i and i+1
      [sequence[i], sequence[i+1]] = [sequence[i+1], sequence[i]];
      const newBlocks = packSequence(sequence, schedule);
      const newCost = totalCost(newBlocks);
      
      if (newCost < cost) {
        blocks = newBlocks;
        cost = newCost;
        improved = true;
      } else {
        // Revert swap
        [sequence[i], sequence[i+1]] = [sequence[i+1], sequence[i]];
      }
    }
  }
  
  // 4. Insertion move improvement
  for (let i = 0; i < sequence.length; i++) {
    const task = sequence[i];
    sequence.splice(i, 1);
    
    let bestPos = i;
    let bestCost = cost;
    
    for (let j = 0; j <= sequence.length; j++) {
      sequence.splice(j, 0, task);
      const newBlocks = packSequence(sequence, schedule);
      const newCost = totalCost(newBlocks);
      
      if (newCost < bestCost) {
        bestPos = j;
        bestCost = newCost;
      }
      
      sequence.splice(j, 1);
    }
    
    sequence.splice(bestPos, 0, task);
    if (bestCost < cost) {
      blocks = packSequence(sequence, schedule);
      cost = bestCost;
    }
  }
  
  return blocks;
}
```

### Work Calendar Advancement

```typescript
function advanceWork(startTime: Date, durationMinutes: number): Date {
  // Returns the calendar time at which a task starting at startTime
  // with duration durationMinutes (work hours) would be complete,
  // skipping non-work periods.
  
  let currentTime = new Date(startTime);
  let remainingMinutes = durationMinutes;
  
  while (remainingMinutes > 0) {
    const daySchedule = getDaySchedule(currentTime, workSchedule);
    
    if (!daySchedule) {
      // Not a work day, skip to next
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(0, 0, 0, 0);
      continue;
    }
    
    const currentMinute = currentTime.getHours() * 60 + currentTime.getMinutes();
    
    if (currentMinute < daySchedule.startMinutes) {
      // Before work starts today
      currentTime.setHours(0, 0, 0, 0);
      currentTime.setMinutes(daySchedule.startMinutes);
      continue;
    }
    
    if (currentMinute >= daySchedule.endMinutes) {
      // After work ends today, move to next day
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(0, 0, 0, 0);
      continue;
    }
    
    // Currently in work hours
    const availableToday = daySchedule.endMinutes - currentMinute;
    const toConsume = Math.min(remainingMinutes, availableToday);
    
    currentTime.setMinutes(currentTime.getMinutes() + toConsume);
    remainingMinutes -= toConsume;
  }
  
  return currentTime;
}
```

---

## 6. UI Components

### 6.1 App Layout

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

### 6.2 Task List

**Purpose:** Master task database, sorted by current problemness

**Layout:**

```
Task List                                    [+ Add Task]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[■] 🚨 OH CRAP  Respond to client email     Critical | High | 30m
                [whenever | soon | by-date | ▼]  [L | M | H]  [⏵]

[■] 😰 Uh oh    Prepare Q2 presentation     By Date | High | 2h
                [whenever | soon | by-date | ▼]  [L | M | H]  [⏵]

[ ] 😬 Oopsie   Review metrics dashboard     Soon | Med | 1h
                Scheduled: Wed 10:00am

[■] 😌 No Problem  Update documentation      Whenever | Low | 1h
                   [whenever | soon | by-date | ▼]  [L | M | H]  [⏵]
```

**Elements per row:**

1. **Block indicator**: `[■]` unscheduled, `[ ]` scheduled
2. **Problemness label**: Emoji + phrase (see scale below)
3. **Description**: Editable text
4. **Urgency picker**: Dropdown or arrows (`< >`) to cycle presets
5. **Importance picker**: `[L | M | H]` buttons
6. **Duration**: Slider or text input
7. **Controls**: Play button or schedule indicator

**Subjective Problemness Scale:**

```typescript
const PROBLEMNESS_SCALE = [
  { min: 0.00, max: 0.20, level: 1, label: "No Problem",      emoji: "😌", color: "#4CAF50" },
  { min: 0.20, max: 0.40, level: 2, label: "Oopsie",         emoji: "😬", color: "#8BC34A" },
  { min: 0.40, max: 0.65, level: 3, label: "Uh oh",          emoji: "😰", color: "#FFA726" },
  { min: 0.65, max: 0.85, level: 4, label: "OH CRAP",        emoji: "🚨", color: "#EF5350" },
  { min: 0.85, max: 1.00, level: 5, label: "I am so sorry", emoji: "💀", color: "#B71C1C" }
];
```

**Sorting:** Always sorted by current problemness, descending

**Interactions:**
- Click description → inline edit
- Click urgency → cycle through presets
- Click importance → toggle L/M/H
- Click duration → slider popup
- Drag `[■]` → schedule to matrix
- Click ⏵ → start timer

### 6.3 Week Matrix

**Purpose:** Visual scheduling canvas

**Structure:**
- **Rows:** Days (Today, Tomorrow, Day+2, etc., filtered by work schedule)
- **Columns:** Hours (work hours only)
- **Grid:** Visible 1-hour lines, invisible 15-min snap points

**Task Blocks:**
- Width = duration
- Height = single row
- Color = single neutral blue
- Label: Task description (truncated)
- Draggable, resizable (15-min snapping)

**Overlapping blocks:**
- Stack with z-index
- Slight vertical offset (8-12px per layer)
- All edges remain visible

**Interactions:**
- Drag from task list → schedule
- Drag within matrix → reschedule
- Drag to task list → unschedule
- Resize edges → adjust duration

### 6.4 Active Task Timer Bar

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

## 7. Visual Design

### Color System

**Problemness colors** (from scale above):
- Level 1-2: Green shades
- Level 3: Orange
- Level 4-5: Red shades

**Task blocks:** Single neutral blue (#4A90E2)

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

**Goal:** Validate envelope model + manual scheduling

**Features:**
- Task CRUD with urgency profiles + importance
- Problemness calculation (P(t) and F(t))
- Subjective problemness display (emoji + label)
- Task list sorted by problemness
- Work schedule configuration
- Week matrix rendering
- Manual drag-and-drop scheduling

**Not included:** Auto-allocate, timers, insights

**Success criteria:** Problemness values feel intuitive, manual scheduling works

---

### Phase 2: Auto-Allocate (Week 3)

**Goal:** Validate greedy + local search scheduler

**Features:**
- Dynamic greedy ordering (avoided cost per duration)
- Earliest-available packing
- Adjacent swap improvement
- Insertion move improvement
- Multi-day task splitting

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

### Phase 4: Insights & Benchmarking (Week 5)

**Goal:** Validate scheduler quality + improve estimates

**Features:**
- Insights modal (estimation accuracy stats)
- Exact DP solver for small problem instances
- Optimality gap measurement
- Adjust estimates using historical multipliers

---

### Phase 5: Polish (Week 6+)

**Goal:** UX refinements

**Features:**
- Show/hide completed tasks
- Keyboard shortcuts
- Custom envelope editor (advanced mode)
- Export/import data
- Edge case handling

---

## 9. Technical Stack

**Frontend:**
- Vanilla JS or Vue 3
- Interact.js (drag-and-drop)
- Luxon (date handling)

**Persistence:**
- LocalStorage (v1)
- Future: IndexedDB or backend

**Build:**
- Vite (if Vue) or no build step (vanilla)

---

## 10. Benchmarking Strategy

### Exact Solver (DP) for Small Instances

```typescript
// State: set of completed tasks
// OPT(S) = minimum cost to complete exactly tasks in S
function exactDP(tasks: Task[]): number {
  const memo = new Map<Set<Task>, number>();
  
  function solve(completed: Set<Task>): number {
    if (completed.size === tasks.length) return 0;
    
    const key = setToKey(completed);
    if (memo.has(key)) return memo.get(key);
    
    let minCost = Infinity;
    
    for (const task of tasks) {
      if (completed.has(task)) continue;
      
      const newCompleted = new Set(completed);
      newCompleted.add(task);
      
      const completionTime = getCompletionTime(newCompleted);
      const taskCost = accumulatedProblemness(task, completionTime);
      const remainingCost = solve(newCompleted);
      
      minCost = Math.min(minCost, taskCost + remainingCost);
    }
    
    memo.set(key, minCost);
    return minCost;
  }
  
  return solve(new Set());
}
```

### Metrics

- **Optimality gap:** (heuristic_cost - optimal_cost) / optimal_cost
- **Runtime comparison:** Greedy vs Greedy+Swaps vs Greedy+Swaps+Insertions
- **Failure case identification:** When does heuristic perform poorly?

---

## 11. Open Questions

### Q1: Background problemness defaults

Are the current background levels (0.05-0.6) the right starting values? Need user testing.

### Q2: Smooth vs piecewise linear

Should we use smoothstep curve for the rise phase instead of linear? Would make envelope differentiable at transition points.

**Decision:** Start with piecewise linear (simpler), swap in smoothstep later if sharp corners cause issues.

### Q3: Custom envelope editor

How much control should power users have? Full curve editor (DAW-style) or just parameter sliders?

**Decision:** Defer to Phase 5, start with presets only.

### Q4: Partial scheduling

If not all tasks fit in horizon, should we schedule a subset or reject/warn?

**Decision:** Phase 1 assumes all tasks fit. Add partial scheduling support in Phase 4+.

---

## 12. Success Metrics

**For prototype validation:**

1. **Problemness feels intuitive:** Users can predict emoji/label changes
2. **Auto-allocate is useful:** Schedules feel reasonable, save time vs manual
3. **Profiles are learnable:** Users understand presets within ~5 tasks created
4. **System reduces stress:** Fewer "what should I do next?" decisions
5. **Optimality gap is acceptable:** Heuristic is within 10-20% of optimal on benchmarks

**Failure modes to watch for:**

- Problemness feels arbitrary
- Auto-allocate produces nonsensical schedules
- Too many knobs / too complex
- Performance issues (n > 50 tasks)

---

## 13. File Structure

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
│   ├── envelope.js          # Problemness P(t) and F(t)
│   ├── scheduler.js         # Auto-allocate (greedy + local search)
│   ├── calendar.js          # Work schedule, advanceWork()
│   ├── stats.js             # Estimation tracking
│   ├── benchmark.js         # Exact DP solver
│   ├── ui/
│   │   ├── matrix.js
│   │   ├── tasklist.js
│   │   ├── timer.js
│   │   └── modals.js
│   └── utils.js
├── docs/
│   ├── SPEC-v3.md           # This file
│   ├── OPTIMIZATION.md      # Original math exploration
│   └── DESIGN.md            # Design decisions log
└── README.md
```

---

## 14. Example Data

### Task with envelope

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Respond to client email",
  "estimatedMinutes": 30,
  "urgencyProfile": "critical",
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

### Calculated values at different times

Profile: **Critical** (background: 0.6, grace: 0, rise: 8h, peak: 1.0)  
Importance: **High** (×1.5 multiplier → peak: 1.5, but capped at 1.0)

```
t = 0h (9:00am):   P = 0.60  (background, already problematic)
t = 2h (11:00am):  P = 0.70  (rising)
t = 4h (1:00pm):   P = 0.80  (rising)
t = 6h (3:00pm):   P = 0.90  (rising)
t = 8h (5:00pm):   P = 1.00  (peak)
t = 10h (7:00pm):  P = 1.00  (plateau)
```

Emoji progression: 🚨 OH CRAP → 💀 I am so sorry

---

**End of Specification**

This document is the canonical design for TaskFlow v3.0. Implementation should follow this spec unless design changes are explicitly approved and documented.
