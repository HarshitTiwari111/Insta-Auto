/** DM chatbot flows: pure transition logic, shared by worker and tests. No I/O here. */

export interface FlowButton {
  title: string;
  /** Step to go to; null ends the flow */
  next: string | null;
}

export interface FlowStep {
  id: string;
  text: string;
  buttons: FlowButton[];
}

export interface FlowLike {
  id: string;
  enabled: boolean;
  keywords: string[];
  steps: FlowStep[];
}

/** Where a person currently is in a flow (kept in Redis for 24h = Meta's messaging window). */
export interface FlowState {
  flowId: string;
  stepId: string;
}

export type FlowResult = { flow: FlowLike; step: FlowStep; state: FlowState | null } | null;

const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase().trim();

/**
 * Decide the next flow message for an incoming DM.
 *  1. Person is inside a flow and tapped / typed one of the step's buttons -> that button's next step.
 *  2. Otherwise a flow whose keyword is in the message starts from its first step.
 *  3. null -> not a flow message (normal DM rules handle it).
 */
export function flowReply(flows: FlowLike[], state: FlowState | null, text: string): FlowResult {
  const t = norm(text);
  if (state) {
    const flow = flows.find((f) => f.id === state.flowId && f.enabled);
    const step = flow?.steps.find((s) => s.id === state.stepId);
    const button = step?.buttons.find((b) => norm(b.title) === t);
    if (flow && button) {
      const next = button.next ? flow.steps.find((s) => s.id === button.next) : undefined;
      if (next) return { flow, step: next, state: { flowId: flow.id, stepId: next.id } };
    }
  }
  for (const f of flows) {
    if (!f.enabled || !f.steps.length) continue;
    if (f.keywords.some((k) => norm(k) && t.includes(norm(k)))) {
      const first = f.steps[0]!;
      return { flow: f, step: first, state: first.buttons.length ? { flowId: f.id, stepId: first.id } : null };
    }
  }
  return null;
}

/** Problems that would make a flow unusable; empty array = valid. */
export function validateFlow(steps: FlowStep[]): string[] {
  const errors: string[] = [];
  const ids = new Set(steps.map((s) => s.id));
  if (!steps.length) errors.push("A flow needs at least one step");
  if (ids.size !== steps.length) errors.push("Step ids must be unique");
  steps.forEach((s, i) => {
    if (!s.text.trim()) errors.push(`Step ${i + 1}: message is empty`);
    if (s.buttons.length > 13) errors.push(`Step ${i + 1}: max 13 buttons`);
    s.buttons.forEach((b) => {
      if (!b.title.trim() || b.title.trim().length > 20) errors.push(`Step ${i + 1}: button titles must be 1-20 characters`);
      if (b.next !== null && !ids.has(b.next)) errors.push(`Step ${i + 1}: button "${b.title}" points to a missing step`);
    });
  });
  return errors;
}
