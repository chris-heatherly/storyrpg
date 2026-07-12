import { validateGateRegistry } from '../src/ai-agents/remediation/gateRegistry';
import {
  VALIDATOR_REGISTRY,
  validateValidatorOwnershipRegistry,
} from '../src/ai-agents/validators/validatorRegistry';

const violations = [
  ...validateGateRegistry().map((violation) => ({ surface: 'gate', id: violation.gateId, problem: violation.problem })),
  ...validateValidatorOwnershipRegistry().map((violation) => ({ surface: 'validator', id: violation.validator, problem: violation.problem })),
];

const policyIds = VALIDATOR_REGISTRY.map((entry) => entry.policyId ?? `${entry.validator}@${entry.stage}`);
if (new Set(policyIds).size !== policyIds.length) {
  violations.push({ surface: 'validator', id: 'policyId', problem: 'derived/static policy ids are not unique' });
}

if (violations.length > 0) {
  console.error(JSON.stringify({ passed: false, violations }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  passed: true,
  validatorPolicies: policyIds.length,
  uniqueValidatorPolicies: new Set(policyIds).size,
}, null, 2));

