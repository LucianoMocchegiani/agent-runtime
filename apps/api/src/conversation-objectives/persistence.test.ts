import assert from 'node:assert/strict';
import test from 'node:test';
import { validateObjectiveInput, type ObjectiveInput } from './persistence.js';

const valid: ObjectiveInput = {
  title: 'Preparar una propuesta',
  description: 'Entregar una propuesta revisada al cliente.',
  status: 'active',
  steps: [{ id: 'draft', description: 'Redactar el borrador', status: 'in_progress' }],
  nextStep: 'Revisar costos',
  expectedRevision: null,
};

test('accepts a bounded objective and rejects invalid states, duplicate steps and unsupported completion', () => {
  assert.equal(validateObjectiveInput(valid), null);
  assert.match(validateObjectiveInput({ ...valid, status: 'unknown' as ObjectiveInput['status'] })!, /estado/);
  assert.match(validateObjectiveInput({ ...valid, steps: [valid.steps[0]!, valid.steps[0]!] })!, /únicos/);
  assert.match(validateObjectiveInput({ ...valid, status: 'completed' })!, /evidencia/);
  assert.equal(validateObjectiveInput({ ...valid, status: 'completed', completionEvidence: 'El usuario confirmó el entregable final.' }), null);
  assert.match(validateObjectiveInput({ ...valid, expectedRevision: -1 })!, /revisión/);
});
