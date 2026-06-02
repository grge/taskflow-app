# TaskFlow Optimization Problem

**Date:** 2026-06-02  
**Status:** Mathematical formulation — envelope family TBD

---

## 1. Problem Statement

Given:
- A set of **n** uncompleted tasks with estimated durations **d₁, d₂, ..., dₙ**
- Each task has a **problemness function** P_i(t) describing urgency at time t
- A work schedule defining available time slots
- A scheduling horizon (typically next 7 days)

Find:
- Start times **x₁, x₂, ..., xₙ** for each task

To minimize:
- **Total accumulated problemness** over the scheduling horizon

Subject to:
- Tasks fit within work schedule (no scheduling outside work hours)
- Tasks don't overlap (at most one task at any moment)
- All tasks must be scheduled (or as many as possible given time constraints)

---

## 2. Mathematical Formulation

### Decision Variables

Let **x_i** = start time (in hours from now) for task i

### Objective Function

**Minimize:**

```
∫[0 to T] Σᵢ P_i(t) · I[t < x_i] dt
```

Where:
- T = scheduling horizon (e.g., 168 hours = 7 days)
- P_i(t) = problemness of task i at time t (hours since creation)
- I[condition] = indicator function (1 if condition true, 0 otherwise)
- The indicator ensures we only count problemness until the task is started

**Intuition:** Each task contributes problemness for every hour it remains unscheduled.

### Alternative Formulation (Discrete Time)

For computational purposes, discretize time into slots of Δt (e.g., 15 minutes = 0.25 hours):

**Minimize:**

```
Δt · ΣₜΣᵢ P_i(t) · I[t < x_i]
```

Or equivalently:

```
Σᵢ (Σₜ₌₀^{x_i} P_i(t) · Δt)
```

### Constraints

**1. Work schedule constraints:**

```
x_i ≥ next_available_work_time
x_i + d_i ≤ end_of_horizon
```

Tasks must start and end within available work hours.

**2. Non-overlap constraints:**

For all pairs (i, j) with i ≠ j:

```
x_i + d_i ≤ x_j  OR  x_j + d_j ≤ x_i
```

(Disjunctive constraint — either task i finishes before j starts, or vice versa)

**3. Ordering constraints (optional):**

If task dependencies exist:

```
If i depends on j: x_i ≥ x_j + d_j
```

---

## 3. Envelope Family Considerations

The choice of P_i(t) significantly affects optimization tractability.

### Option A: Piecewise Linear

**Form:**

```
P_i(t) = 0                           if t < delay_i
       = (t - delay_i) / rise_i      if delay_i ≤ t < delay_i + rise_i
       = peak_i                       if t ≥ delay_i + rise_i
```

**Integral (accumulated problemness until time x_i):**

```
∫[0 to x_i] P_i(t) dt = 0                                           if x_i < delay_i
                       = (x_i - delay_i)² / (2 · rise_i)            if delay_i ≤ x_i < delay_i + rise_i
                       = rise_i/2 + peak_i · (x_i - delay_i - rise_i)   if x_i ≥ delay_i + rise_i
```

**Properties:**
- Closed-form integral ✓
- Piecewise quadratic in x_i (non-convex but smooth within regions)
- Sharp transitions at boundaries (may cause discontinuous derivatives)

---

### Option B: Logistic (Sigmoid)

**Form:**

```
P_i(t) = peak_i / (1 + exp(-k_i · (t - t0_i)))
```

Where:
- k_i = steepness parameter
- t0_i = inflection point (where P_i = peak_i / 2)

**Integral:**

```
∫[0 to x_i] P_i(t) dt = (peak_i / k_i) · ln(1 + exp(k_i · (x_i - t0_i))) + C
```

(C is a constant depending on initial conditions)

**Properties:**
- Closed-form integral ✓
- Smooth everywhere (differentiable) ✓
- Convex integral in certain parameter ranges
- Realistic S-curve shape (slow start, acceleration, saturation)

**Advantages for optimization:**
- Gradient ∇(∫ P_i) is continuous → gradient-based methods work well
- No sharp corners → no convergence issues
- Convexity may allow efficient local search

---

### Option C: Exponential Growth

**Form:**

```
P_i(t) = peak_i · (1 - exp(-r_i · t))
```

Where r_i = growth rate

**Integral:**

```
∫[0 to x_i] P_i(t) dt = peak_i · (x_i + (exp(-r_i · x_i) - 1) / r_i)
```

**Properties:**
- Closed-form integral ✓
- Simple (only 2 parameters: peak, rate)
- Smooth and differentiable ✓
- Convex (∫ P_i is convex in x_i)

**Advantages:**
- Simplest option
- Convex objective → global optimum guaranteed (ignoring non-overlap constraints)
- Fast computation

**Disadvantages:**
- Less flexible (no delay or inflection control)
- Asymptotic (never reaches peak exactly)

---

### Option D: Delayed Logistic (Hybrid)

Combine flat delay + logistic rise:

**Form:**

```
P_i(t) = 0                                                    if t < delay_i
       = peak_i / (1 + exp(-k_i · (t - delay_i - t0_i)))     if t ≥ delay_i
```

**Integral:**

```
∫[0 to x_i] P_i(t) dt = 0                                                           if x_i < delay_i
                       = (peak_i / k_i) · ln(1 + exp(k_i · (x_i - delay_i - t0_i))) + C   if x_i ≥ delay_i
```

**Properties:**
- Closed-form integral ✓
- Captures "not urgent yet, then suddenly urgent" pattern ✓
- Smooth in the rise phase
- Piecewise (delay introduces a boundary, but right-continuous)

---

## 4. Optimization Approaches

### Approach A: Mixed-Integer Linear Programming (MILP)

**Idea:** Discretize time into slots, use binary variables for task placement.

**Variables:**
- y_it ∈ {0, 1} = 1 if task i is running at time slot t

**Objective:**

```
Minimize: Σᵢ Σₜ P_i(t) · (1 - Σₛ≤ₜ y_is) · Δt
```

(Task contributes problemness at time t if not yet started)

**Constraints:**
- Σₜ y_it = d_i / Δt  (task runs for d_i hours)
- Σᵢ y_it ≤ 1  (no overlaps at time t)
- Work schedule constraints

**Solver:** GLPK.js, Gurobi.js, or similar

**Pros:** Exact solution, handles discrete constraints naturally  
**Cons:** Exponential complexity (may be slow for n > 20 tasks)

---

### Approach B: Continuous Relaxation + Rounding

**Idea:** Ignore non-overlap constraints temporarily, solve continuous problem, then fix overlaps.

**Step 1:** Solve unconstrained problem:

```
Minimize: Σᵢ ∫[0 to x_i] P_i(t) dt
```

This gives optimal ordering (ignoring overlaps).

**Step 2:** Pack tasks in that order, respecting work schedule.

**Pros:** Fast, works well if optimal ordering is close to greedy  
**Cons:** Not exact, may miss better solutions

---

### Approach C: Gradient-Based Optimization

**Idea:** Use smooth envelope (logistic or exponential), apply gradient descent.

**Method:**
1. Initialize x_i randomly (or use greedy heuristic)
2. Compute gradient ∇(Σᵢ ∫ P_i(t) dt) with respect to x_i
3. Update x_i in direction that reduces objective
4. Project to feasible region (work schedule, non-overlap)
5. Repeat until convergence

**Projection step (hard part):** Non-overlap constraints are disjunctive (not convex).

**Workaround:**
- Use penalty method: add large penalty for overlaps
- Or: Use sequential quadratic programming (SQP) with disjunctive constraints

**Pros:** Works well if envelope is smooth, can handle many tasks  
**Cons:** Local optima (no global optimality guarantee)

---

### Approach D: Greedy Heuristic (Current Plan)

**Algorithm:**

1. Compute urgency score for each task:
   ```
   score_i = P_i(now) + λ · (dP_i/dt)
   ```
   (Current problemness + weighted rate of increase)

2. Sort tasks by score (descending)

3. Pack tasks into earliest available slots (greedy)

**Pros:** Fast (O(n log n)), simple to implement, no solver needed  
**Cons:** Not optimal, but empirically good enough for most cases

---

### Approach E: Dynamic Programming (Exact)

**Idea:** Enumerate scheduling orders, memoize subproblems.

**State:** (remaining tasks, current time, accumulated problemness)

**Transition:** Pick next task to schedule, update state

**Recurrence:**

```
OPT(S, t) = min_{i ∈ S} [ ∫[t_prev to t] P_i(τ) dτ + OPT(S \ {i}, t + d_i) ]
```

**Complexity:** O(n! · T) in worst case, but memoization reduces it significantly

**Pros:** Exact solution, guaranteed optimal  
**Cons:** Exponential in n (practical for n < 15-20)

---

## 5. Recommendations

### Phase 1-2: Greedy Heuristic (Approach D)
- Fast prototype
- Good enough for validation
- No external solver dependencies

### Phase 3: Continuous Relaxation (Approach B)
- Improve upon greedy
- Still fast, slight optimality improvement

### Phase 4: Gradient-Based (Approach C) or DP (Approach E)
- If logistic envelopes are chosen → Approach C
- If n is small (< 20) → Approach E for exact solution

### Research Goal: Closed-Form Solution
- Investigate whether specific envelope + objective combinations admit analytic solutions
- Potential for publishable result if successful

---

## 6. Open Questions

**Q1:** Does the integral ∫ Σᵢ P_i(t) · I[t < x_i] dt have a closed-form minimum for logistic envelopes?

**Q2:** Can we exploit convexity properties of the objective (ignoring non-overlap constraints) to get better bounds?

**Q3:** Is there a greedy ordering that is provably optimal (or near-optimal) for certain envelope families?

**Q4:** What is the typical optimality gap between greedy and exact solutions? (Needs empirical testing)

---

## 7. Next Steps

1. **Choose envelope family** (logistic strongly preferred based on analysis)
2. **Implement greedy heuristic** (baseline)
3. **Collect empirical data** (how often does greedy produce "bad" schedules?)
4. **Prototype gradient-based solver** (if smooth envelopes chosen)
5. **Benchmark optimality gap** (compare greedy vs exact/gradient-based)

---

**End of Optimization Problem Formulation**

This document is the mathematical foundation for auto-allocate. Implementation should reference this when choosing algorithms.
