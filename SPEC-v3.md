# TaskFlow — Technical Specification v3.0

**Date:** 2026-06-02  
**Status:** Design Complete — Ready for Implementation

---

## 1. Core Concept

TaskFlow is a visual task scheduling app built on a novel urgency model: **every task has a time-dependent "problemness" function** that describes how much of a problem it is that the task isn't complete yet.

### Key Innovation

Tasks have **urgency envelopes** — continuous functions that rise over time, capturing:
- Grace period before urgency rises
- Rise rate (how quickly urgency escalates)
- Peak problemness (maximum urgency, determined by importance)

The scheduler minimizes **total accumulated problemness until task completion** by optimizing the sequence of work.

---

## 2. User-Facing Model

### Task Properties

Every task has:

1. **Description** (text)
2. **Estimated Duration** (minutes)
3. **Urgency Profile** (preset: "Next Couple Hours", "COB Today", "COB Tomorrow", "Few Days", "End of Week", "Whenever")
4. **Importance** (Low/Medium/High — directly sets peak problemness)

### Urgency Profiles (Presets)

**Presets are parameter templates** that define the shape of a task's urgency envelope. When a task is created, the preset parameters are instantiated into a time-dependent function P_i(t) where t=0 is the task's creation time.

**Next Couple Hours**
- Grace period: None
- Rise: 2 hours to peak
- Use case: Tasks that need to be done immediately or within the next few hours

**COB Today**
- Grace period: None
- Rise: Hours from creation to 17:00 today — but if the task is created after 17:00, the deadline shifts to 17:00 the next workday (computed once at task creation)
- Use case: Tasks due by end of business today

**COB Tomorrow**
- Grace period: None
- Rise: Hours from creation to 17:00 the next workday — but if created after 17:00, the deadline shifts to 17:00 the workday after that (computed once at task creation)
- Use case: Tasks due by end of business tomorrow

**Few Days**
- Grace period: None
- Rise: 72 hours to peak
- Use case: Tasks that should be done within the next few days

**End of Week**
- Grace period: None
- Rise: Hours from creation to Friday 17:00 of the current week (computed once at task creation)
- Use case: Tasks due by end of the current working week

**Whenever**
- Grace period: 168 hours (one week)
- Rise: 168 hours to peak after grace period
- Use case: Tasks that should be done eventually but aren't urgent

**Note:** Two tasks with the same preset but different creation times will have envelope functions that are shifted in calendar time. The preset defines the *shape*, each task instance has its own timeline.

**Deadline-anchored presets:** `cob-today`, `cob-tomorrow`, and `end-of-week` have `riseHours` that is **dynamically computed** at task creation time — the number of hours from `createdAt` to the relevant deadline. This value is calculated once and stored as a concrete number in the task's `EnvelopeParams`. It is not recalculated later.

### Importance Levels

Importance **directly sets** the peak problemness (`m` parameter of the envelope):

- **Low**: peak = 0.4 (annoying but not critical)
- **Medium**: peak = 0.7 (standard importance)
- **High**: peak = 1.0 (critical, major consequences)

There is no multiplier. Importance *is* the peak.

### Combined Example

"Respond to client email" with:
- Urgency: **Next Couple Hours** (no grace, 2h rise)
- Importance: **High** (peak = 1.0)

Result: Urgency rises immediately, reaching maximum problemness after 2 hours.

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
  // Note: actual minutes worked are derived from timeSessions, not stored separately
  
  // State
  isCompleted: boolean;
  isDeleted: boolean;
}

type UrgencyProfile =
  | "next-couple-hours"
  | "cob-today"
  | "cob-tomorrow"
  | "few-days"
  | "end-of-week"
  | "whenever";

type Importance = "low" | "medium" | "high";

interface EnvelopeParams {
  background: number;       // b: Initial/baseline problemness (0-1)
  graceHours: number;       // a: Delay before problemness starts rising
  riseHours: number;        // r: Time to reach peak after grace period
  peakProblemness: number;  // m: Maximum problemness (0-1), set directly by importance
}

// Importance directly maps to peakProblemness (no multiplier)
const IMPORTANCE_PEAKS: Record<Importance, number> = {
  low: 0.4,
  medium: 0.7,
  high: 1.0
};

// Preset envelope parameter templates (timeless shapes).
// background is 0 for all presets — it is only relevant for custom envelopes.
// peakProblemness is 0 here as a placeholder; the actual peak comes from IMPORTANCE_PEAKS
// and is written into the task's EnvelopeParams at creation time.
// For cob-today, cob-tomorrow, and end-of-week the riseHours is 0 here as a placeholder;
// use computeRiseHours(profile, createdAt) at task creation to get the concrete value.
const URGENCY_ENVELOPES: Record<UrgencyProfile, Pick<EnvelopeParams, "graceHours" | "riseHours">> = {
  "next-couple-hours": { graceHours: 0,   riseHours: 2   },
  "cob-today":         { graceHours: 0,   riseHours: 0   }, // riseHours computed at creation
  "cob-tomorrow":      { graceHours: 0,   riseHours: 0   }, // riseHours computed at creation
  "few-days":          { graceHours: 0,   riseHours: 72  },
  "end-of-week":       { graceHours: 0,   riseHours: 0   }, // riseHours computed at creation
  "whenever":          { graceHours: 168, riseHours: 168 }
};

/**
 * For deadline-anchored presets (cob-today, cob-tomorrow, end-of-week),
 * compute the riseHours from createdAt to the relevant deadline.
 * For other presets, return the static riseHours from URGENCY_ENVELOPES.
 * This is called once at task creation and the result is stored in the task's EnvelopeParams.
 */
function computeRiseHours(profile: UrgencyProfile, createdAt: Date): number {
  const msPerHour = 1000 * 60 * 60;

  if (profile === "cob-today") {
    // If before 17:00, deadline is 17:00 today.
    // If at or after 17:00, shift to 17:00 the next workday (same logic as cob-tomorrow).
    const deadline = new Date(createdAt);
    deadline.setHours(17, 0, 0, 0);
    if (createdAt.getTime() >= deadline.getTime()) {
      // Past COB — advance to next workday
      deadline.setDate(deadline.getDate() + 1);
      while (deadline.getDay() === 0 || deadline.getDay() === 6) {
        deadline.setDate(deadline.getDate() + 1);
      }
      deadline.setHours(17, 0, 0, 0);
    }
    return (deadline.getTime() - createdAt.getTime()) / msPerHour;
  }

  if (profile === "cob-tomorrow") {
    // If before 17:00, deadline is 17:00 the next workday.
    // If at or after 17:00, deadline is 17:00 the workday after that.
    const eodToday = new Date(createdAt);
    eodToday.setHours(17, 0, 0, 0);
    const startDay = new Date(createdAt);
    if (createdAt.getTime() >= eodToday.getTime()) {
      // Past COB — shift the starting point forward by one day
      startDay.setDate(startDay.getDate() + 1);
    }
    const deadline = new Date(startDay);
    deadline.setDate(deadline.getDate() + 1);
    while (deadline.getDay() === 0 || deadline.getDay() === 6) {
      deadline.setDate(deadline.getDate() + 1);
    }
    deadline.setHours(17, 0, 0, 0);
    return Math.max(0, (deadline.getTime() - createdAt.getTime()) / msPerHour);
  }

  if (profile === "end-of-week") {
    // Friday 17:00 of the current week (week starting Monday)
    const deadline = new Date(createdAt);
    const day = deadline.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    // Days until Friday
    const daysUntilFriday = day <= 5 ? 5 - day : 6; // if Sunday, next Friday is 6 days away
    deadline.setDate(deadline.getDate() + daysUntilFriday);
    deadline.setHours(17, 0, 0, 0);
    return Math.max(0, (deadline.getTime() - createdAt.getTime()) / msPerHour);
  }

  return URGENCY_ENVELOPES[profile].riseHours;
}

/**
 * Build the concrete EnvelopeParams for a task at creation time.
 * This is stored on the task (or derived on the fly for non-deadline-anchored presets).
 */
function buildEnvelopeParams(profile: UrgencyProfile, importance: Importance, createdAt: Date): EnvelopeParams {
  return {
    background: 0,
    graceHours: URGENCY_ENVELOPES[profile].graceHours,
    riseHours: computeRiseHours(profile, createdAt),
    peakProblemness: IMPORTANCE_PEAKS[importance]
  };
}
```

### ScheduledBlock Schema

```typescript
interface ScheduledBlock {
  id: string;
  taskId: string;             // References the owning task
  date: string;              // ISO date: "2026-06-04"
  startMinutes: number;      // Minutes from midnight (e.g., 540 = 9:00am)
  durationMinutes: number;
  partIndex?: number;        // For multi-day splits: 1 = first part, 2 = second part
  totalParts?: number;       // For multi-day splits: always 2 when present
  zIndex?: number;           // For overlapping blocks
}
```

**Splitting rules:**
- When a task's duration doesn't fit in the remaining time of a work day, it is split into exactly 2 parts: part 1 fills to end-of-day, part 2 starts at the beginning of the next work day.
- Splits are always atomic: both parts are created together and removed together. The two parts share the same `taskId` and are linked via `partIndex`/`totalParts`.
- Split parts cannot be moved or deleted independently.
- No further splitting of already-split parts (maximum 2 parts per task).

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

### 4.1 Envelope Instantiation

**Key concept:** Envelope presets are *parameter templates*, not functions.

When a task is created:
1. The preset's `graceHours` is read from `URGENCY_ENVELOPES`
2. For deadline-anchored presets (`cob-today`, `cob-tomorrow`, `end-of-week`), `riseHours` is computed from `createdAt` to the deadline using `computeRiseHours`; for other presets the static value is used
3. `peakProblemness` is set directly from `IMPORTANCE_PEAKS[importance]` — no scaling or multiplication
4. `background` is always 0 for preset-based tasks
5. These parameters define a function **P_i(t)** specific to task *i*
6. **t = 0** is anchored at `task.createdAt` (the task's "birth time" in calendar time)
7. **t** is measured in hours elapsed since `task.createdAt`

**Example:** Two tasks created 6 hours apart:
- Task A created at 9:00am with "Next Couple Hours" preset, High importance
- Task B created at 3:00pm with "Next Couple Hours" preset, High importance

Both use the same preset shape (rise = 2h, peak = 1.0), but:
- At 5:00pm calendar time: Task A has t=8h (plateau at 1.0), Task B has t=2h (just reached peak)
- Their P(t) curves have the same *shape* but are shifted in *calendar time*

**Calendar time vs Task time:**
- Problemness P_i(t) grows in **calendar time** (24/7, includes nights/weekends)
- Task durations consume **work time** (skips non-work periods)
- This distinction is critical for the scheduler

### 4.2 Mathematical Definition

**Envelope:** Delayed ramp-to-plateau (piecewise linear, monotonically increasing)

For a task with envelope params `(b, a, r, m)` where b=0 for preset tasks, the problemness P_i(t) at task-relative time `t` (hours since task.createdAt) is:

```typescript
function getTaskEnvelope(task: Task): EnvelopeParams {
  if (task.customEnvelope) return task.customEnvelope;
  return buildEnvelopeParams(task.urgencyProfile, task.importance, task.createdAt);
}

function calculateProblemness(task: Task, currentTime: Date): number {
  const envelope = getTaskEnvelope(task);
  
  // t = 0 at task.createdAt, measured in calendar time (not work time)
  const hoursElapsed = (currentTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
  
  // Phase 1: Background (flat, always 0 for preset envelopes)
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

### 4.3 Accumulated Problemness (Integral)

The scheduler minimizes accumulated problemness until task *completion*:

```typescript
function accumulatedProblemness(task: Task, completionTime: Date): number {
  const envelope = getTaskEnvelope(task);
  const hoursToComplete = (completionTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
  
  // F_i(t) = ∫[0 to t] P_i(u) du
  // For preset envelopes b = 0, simplifying to a ramp-to-plateau with no background offset.
  
  const { background: b, graceHours: a, riseHours: r, peakProblemness: m } = envelope;
  
  if (hoursToComplete <= a) {
    // Only background phase (= 0 for presets)
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

### 4.4 Visual Representation

**Single task envelope (task-relative time, preset with b=0):**

```
Problemness P_i(t)
     ↑
  m  |              __________ (plateau)
     |             /
     |            /
     |           /
   0 |__________/             
   0 |______|_______|__________→ t (hours since task.createdAt)
            a     a+r
         (grace) (rise)
```

For all preset envelopes, b=0: there is no background level. The function starts at 0, stays flat through the grace period, then rises linearly to `m` (which equals `IMPORTANCE_PEAKS[importance]`), then plateaus.

**Multiple tasks with same preset in calendar time:**

```
Problemness
     ↑
  1.0|           _____ Task A (created 9am, High)
     |          /
     |         /    _____ Task B (created 3pm, High)
 0.0 |________/____/____________________→ Calendar time
       9am  11am  1pm  3pm  5pm
```

Both tasks use "Next Couple Hours" preset (rise = 2h, peak = 1.0), but Task B's envelope is shifted 6 hours later in calendar time.

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

### `packSequence` and `totalCost`

**`packSequence(sequence: Task[], schedule: WorkSchedule): ScheduledBlock[]`**

Iterates through tasks in order, placing each starting at the earliest available work time after the previous task ends:

- "Earliest available work time" respects: (a) the work schedule and (b) any existing manually-placed blocks, which are treated as pre-blocked time.
- When a task's duration doesn't fit in the remaining work time of the current day, it is split: part 1 fills to end-of-day, part 2 starts at the beginning of the next work day. Both blocks share the same `taskId` and are linked via `partIndex`/`totalParts`.
- Never creates overlapping blocks — if a time slot is taken, advance past it.

```typescript
function packSequence(
  sequence: Task[],
  schedule: WorkSchedule,
  manualBlocks: ScheduledBlock[] = []  // pre-placed blocks to treat as opaque
): ScheduledBlock[] {
  const result: ScheduledBlock[] = [];
  let cursor = new Date(); // start from now

  for (const task of sequence) {
    // Advance cursor to the next available work time, skipping manual blocks
    cursor = nextAvailableWorkTime(cursor, schedule, manualBlocks);

    const daySchedule = getDaySchedule(cursor, schedule)!;
    const cursorMinutes = cursor.getHours() * 60 + cursor.getMinutes();
    const remainingToday = daySchedule.endMinutes - cursorMinutes;

    if (task.estimatedMinutes <= remainingToday) {
      // Fits today — single block
      result.push({
        id: crypto.randomUUID(),
        taskId: task.id,
        date: toISODate(cursor),
        startMinutes: cursorMinutes,
        durationMinutes: task.estimatedMinutes
      });
      cursor = new Date(cursor);
      cursor.setMinutes(cursor.getMinutes() + task.estimatedMinutes);
    } else {
      // Doesn't fit — split across two days
      const part1Duration = remainingToday;
      const part2Duration = task.estimatedMinutes - part1Duration;

      result.push({
        id: crypto.randomUUID(),
        taskId: task.id,
        date: toISODate(cursor),
        startMinutes: cursorMinutes,
        durationMinutes: part1Duration,
        partIndex: 1,
        totalParts: 2
      });

      // Advance to start of next work day
      const nextDay = nextWorkDayStart(cursor, schedule);

      result.push({
        id: crypto.randomUUID(),
        taskId: task.id,
        date: toISODate(nextDay),
        startMinutes: nextDay.getHours() * 60 + nextDay.getMinutes(),
        durationMinutes: part2Duration,
        partIndex: 2,
        totalParts: 2
      });

      cursor = new Date(nextDay);
      cursor.setMinutes(cursor.getMinutes() + part2Duration);
    }
  }

  return result;
}

/**
 * Advance `from` to the next minute that is:
 *   (a) within a work period, and
 *   (b) not covered by any manual block.
 * Manual blocks are treated as opaque: if `from` falls inside one, advance past its end.
 * Repeats until stable (a manual block may push into non-work time, which then pushes
 * into the next work period, which may be covered by another manual block, etc.)
 */
function nextAvailableWorkTime(
  from: Date,
  schedule: WorkSchedule,
  manualBlocks: ScheduledBlock[]
): Date {
  let cursor = new Date(from);

  let stable = false;
  while (!stable) {
    stable = true;

    // Step 1: advance to next work period if not already in one
    cursor = advanceToWorkTime(cursor, schedule);

    // Step 2: check if cursor falls inside any manual block; if so, advance past it
    const blocking = manualBlocks.find(b => blockCoversTime(b, cursor));
    if (blocking) {
      const blockEnd = new Date(blocking.date);
      blockEnd.setHours(0, blocking.startMinutes + blocking.durationMinutes, 0, 0);
      cursor = blockEnd;
      stable = false; // re-check: we may now be outside work hours or in another block
    }
  }

  return cursor;
}

/**
 * Advance `from` to the start of the next work day (the day after `from`'s date).
 * Returns a Date set to that day's startMinutes.
 */
function nextWorkDayStart(from: Date, schedule: WorkSchedule): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  // Skip non-work days
  while (!getDaySchedule(next, schedule)) {
    next.setDate(next.getDate() + 1);
  }
  const day = getDaySchedule(next, schedule)!;
  next.setHours(0, day.startMinutes, 0, 0);
  return next;
}

/**
 * Returns true if the given Date falls within the block's time range (inclusive start, exclusive end).
 */
function blockCoversTime(block: ScheduledBlock, time: Date): boolean {
  const blockDate = toISODate(time);
  if (block.date !== blockDate) return false;
  const timeMinutes = time.getHours() * 60 + time.getMinutes();
  return timeMinutes >= block.startMinutes && timeMinutes < block.startMinutes + block.durationMinutes;
}
```

**`totalCost(blocks: ScheduledBlock[], tasks: Task[]): number`**

For each task, find its last block (highest `partIndex`, or the only block when unsplit) and use its end time as the task's completion time. Sum `accumulatedProblemness(task, completionTime)` across all tasks.

```typescript
function totalCost(blocks: ScheduledBlock[], tasks: Task[]): number {
  let cost = 0;
  for (const task of tasks) {
    const taskBlocks = blocks.filter(b => b.taskId === task.id);
    if (taskBlocks.length === 0) continue;
    // Last block = highest partIndex (or only block)
    const lastBlock = taskBlocks.reduce((a, b) =>
      (b.partIndex ?? 1) > (a.partIndex ?? 1) ? b : a
    );
    const completionDate = new Date(lastBlock.date);
    completionDate.setHours(0, lastBlock.startMinutes + lastBlock.durationMinutes, 0, 0);
    cost += accumulatedProblemness(task, completionDate);
  }
  return cost;
}
```

**Auto-allocate scope:** The optimizer **only re-sequences unscheduled tasks** (tasks where `scheduledBlocks.length === 0`). Manually scheduled tasks are treated as immovable anchors that block out time and are not moved or removed by the optimizer.

### Algorithm: Greedy Sequence + Local Search

**Phase 1: Dynamic Greedy Ordering**

At each step, choose the unscheduled task with the highest **avoided cost per duration**:

```typescript
function greedyScore(task: Task, currentWorkTime: Date, schedule: WorkSchedule): number {
  const completionTime = advanceWork(currentWorkTime, task.estimatedMinutes, schedule);
  const nowCost = accumulatedProblemness(task, currentWorkTime);
  const completeCost = accumulatedProblemness(task, completionTime);
  
  // Cost avoided per hour of work
  return (completeCost - nowCost) / (task.estimatedMinutes / 60);
}
```

**Intuition:** How much problemness accumulation do we avoid per hour of work by doing this task now?

**Phase 2: Local Search Improvement**

After greedy ordering, improve via a unified improvement loop that covers both move types:

1. **Adjacent swaps:** Try swapping neighboring tasks, accept if cost reduces
2. **Insertion moves:** Remove task from sequence, try inserting elsewhere

The two phases share a single outer `while (improved)` loop — any improvement in either phase restarts both phases from scratch.

**Full algorithm:**

```typescript
function autoAllocate(tasks: Task[], schedule: WorkSchedule): ScheduledBlock[] {
  // 1. Greedy initial ordering (only unscheduled tasks)
  const sequence: Task[] = [];
  let currentTime = new Date();
  const remaining = [...tasks.filter(t => !t.isCompleted && t.scheduledBlocks.length === 0)];
  
  while (remaining.length > 0) {
    const scores = remaining.map(t => ({
      task: t,
      score: greedyScore(t, currentTime, schedule)
    }));
    scores.sort((a, b) => b.score - a.score);
    
    const chosen = scores[0].task;
    sequence.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
    
    currentTime = advanceWork(currentTime, chosen.estimatedMinutes, schedule);
  }
  
  // 2. Pack into schedule
  let blocks = packSequence(sequence, schedule);
  let cost = totalCost(blocks, sequence);
  
  // 3. Unified local search: adjacent swaps + insertion moves
  //    Any improvement in either phase restarts the outer loop from scratch.
  let improved = true;
  while (improved) {
    improved = false;
    
    // Phase A: Adjacent swaps
    for (let i = 0; i < sequence.length - 1; i++) {
      [sequence[i], sequence[i+1]] = [sequence[i+1], sequence[i]];
      const newBlocks = packSequence(sequence, schedule);
      const newCost = totalCost(newBlocks, sequence);
      
      if (newCost < cost) {
        blocks = newBlocks;
        cost = newCost;
        improved = true;
        break; // restart outer loop
      } else {
        [sequence[i], sequence[i+1]] = [sequence[i+1], sequence[i]]; // revert
      }
    }
    
    if (improved) continue; // restart outer loop
    
    // Phase B: Insertion moves
    for (let i = 0; i < sequence.length; i++) {
      const task = sequence[i];
      sequence.splice(i, 1);
      
      let bestPos = i;
      let bestCost = cost;
      
      for (let j = 0; j <= sequence.length; j++) {
        sequence.splice(j, 0, task);
        const newBlocks = packSequence(sequence, schedule);
        const newCost = totalCost(newBlocks, sequence);
        
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
        improved = true;
        break; // restart outer loop
      }
    }
  }
  
  return blocks;
}
```

### Work Calendar Advancement

```typescript
function advanceWork(startTime: Date, durationMinutes: number, schedule: WorkSchedule): Date {
  // Returns the calendar time at which a task starting at startTime
  // with duration durationMinutes (work hours) would be complete,
  // skipping non-work periods.
  
  let currentTime = new Date(startTime);
  let remainingMinutes = durationMinutes;
  
  while (remainingMinutes > 0) {
    const daySchedule = getDaySchedule(currentTime, schedule);
    
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
[■] 🚨 OH CRAP  Respond to client email     next-couple-hours | High | 30m
                [next-couple-hours | cob-today | ▼]  [L | M | H]  [⏵]

[■] 😰 Uh oh    Prepare Q2 presentation     cob-tomorrow | High | 2h
                [next-couple-hours | cob-today | ▼]  [L | M | H]  [⏵]

[ ] 😬 Oopsie   Review metrics dashboard     few-days | Med | 1h
                Scheduled: Wed 10:00am

[■] 😌 No Problem  Update documentation      whenever | Low | 1h
                   [next-couple-hours | cob-today | ▼]  [L | M | H]  [⏵]
```

**Elements per row:**

1. **Block indicator**: `[■]` unscheduled, `[ ]` scheduled — binary state only (see Section 11)
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

**Not included (deferred):** Resize edges to adjust duration

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
- Earliest-available packing (`packSequence`)
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
- Calculate actual vs estimated (derived from `timeSessions`)

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

For problem instances with at most 15 tasks, an exact DP over subsets is feasible (2^15 = 32768 states).

**Formulation:**
- State: `mask` — a bitmask where bit `i` is set if task `i` has been completed
- `endTime[mask]` — the calendar time at which the last task in `mask` finishes, given they were done in some order. Since we only care about the *total* cost, and tasks are packed sequentially, `endTime[mask]` depends only on *which* tasks are in `mask`, not their order (same total work time regardless of sequence). This lets us precompute it.
- `solve(mask)` — minimum cost to complete all tasks *not* in `mask`, given that the tasks in `mask` are already done and the clock is at `endTime[mask]`

**Key insight:** `endTime[mask]` is order-independent (same work minutes → same calendar end time when packed from a fixed start), so it can be precomputed for all 2^n masks in O(n · 2^n) time rather than re-derived inside the recursion.

```typescript
function exactDP(tasks: Task[], schedule: WorkSchedule): number {
  const n = tasks.length;
  if (n > 15) throw new Error("exactDP: too many tasks (max 15)");

  const now = new Date();

  // Precompute endTime[mask]: calendar time after completing all tasks in mask,
  // packed sequentially in index order from `now`.
  // Order doesn't affect end time (same total minutes), so index order is fine here.
  const endTime = new Array<Date>(1 << n);
  endTime[0] = now;
  for (let mask = 1; mask < (1 << n); mask++) {
    // Find the lowest set bit to determine which task was "added" to get this mask
    const i = lowestSetBit(mask);
    const prevMask = mask ^ (1 << i);
    endTime[mask] = advanceWork(endTime[prevMask], tasks[i].estimatedMinutes, schedule);
  }

  // solve(mask) = min cost to complete all tasks NOT in mask,
  // given the clock is at endTime[mask].
  const memo = new Float64Array(1 << n).fill(-1);

  function solve(mask: number): number {
    if (mask === (1 << n) - 1) return 0;
    if (memo[mask] !== -1) return memo[mask];

    const currentTime = endTime[mask];
    let minCost = Infinity;

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue; // already done

      const newMask = mask | (1 << i);
      const completionTime = endTime[newMask];

      const taskCost = accumulatedProblemness(tasks[i], completionTime);
      const remainingCost = solve(newMask);

      const total = taskCost + remainingCost;
      if (total < minCost) minCost = total;
    }

    memo[mask] = minCost;
    return minCost;
  }

  return solve(0);
}

function lowestSetBit(mask: number): number {
  return Math.log2(mask & -mask) | 0;
}
```

**Complexity:** O(n · 2^n) time, O(2^n) space. For n=15: ~500k operations, negligible in practice.

### Metrics

- **Optimality gap:** (heuristic_cost - optimal_cost) / optimal_cost
- **Runtime comparison:** Greedy vs Greedy+Swaps vs Greedy+Swaps+Insertions
- **Failure case identification:** When does heuristic perform poorly?

---

## 11. Scheduling Rules

### All-or-Nothing Scheduling

Tasks cannot be partially scheduled. A task is either **fully scheduled** (all its blocks are placed on the matrix) or **unscheduled** (no blocks). There is no partial state.

- The `[■]` / `[ ]` indicator in the task list is binary: `[■]` = unscheduled, `[ ]` = scheduled. No partial state is possible.
- If a scheduled block is removed from the matrix, **all blocks for that task are removed** and the task returns to unscheduled state in the task list.
- Split tasks (2 parts) are treated atomically: both parts are always placed or removed together.
- The auto-allocate algorithm either places all requested tasks or fails silently: if it cannot schedule all unscheduled tasks (e.g. insufficient work time in the visible window), no blocks are written, the task list is unchanged, and the failure is logged to the console.

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
  "urgencyProfile": "next-couple-hours",
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

**Task created at 9:00am on 2026-06-02**

Profile: **next-couple-hours** (background: 0, grace: 0h, rise: 2h)  
Importance: **High** (peak = 1.0)

Envelope at creation: `{ background: 0, graceHours: 0, riseHours: 2, peakProblemness: 1.0 }`

```
Calendar time     | Task time t | P_i(t) | Label
9:00am (created)  | t = 0h      | 0.00   | 😌 No Problem (start of rise)
9:30am            | t = 0.5h    | 0.25   | 😬 Oopsie (rising)
10:00am           | t = 1h      | 0.50   | 😰 Uh oh (rising)
10:30am           | t = 1.5h    | 0.75   | 🚨 OH CRAP (rising)
11:00am           | t = 2h      | 1.00   | 💀 I am so sorry (peak)
1:00pm            | t = 4h      | 1.00   | 💀 I am so sorry (plateau)
```

**If a second task with the same preset is created at 3:00pm (Medium importance):**

Profile: **next-couple-hours**, Importance: **Medium** (peak = 0.7)

Envelope: `{ background: 0, graceHours: 0, riseHours: 2, peakProblemness: 0.7 }`

```
Calendar time     | Task A (t)  | P_A(t) | Task B (t)  | P_B(t)
3:00pm            | t = 6h      | 1.00   | t = 0h      | 0.00
3:30pm            | t = 6.5h    | 1.00   | t = 0.5h    | 0.175
4:00pm            | t = 7h      | 1.00   | t = 1h      | 0.35
5:00pm            | t = 8h      | 1.00   | t = 2h      | 0.70
```

Same preset shape, different importance levels, different calendar-time trajectories.

---

**End of Specification**

This document is the canonical design for TaskFlow v3.0. Implementation should follow this spec unless design changes are explicitly approved and documented.
