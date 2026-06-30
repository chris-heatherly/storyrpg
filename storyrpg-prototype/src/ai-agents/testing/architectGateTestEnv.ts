const ARCHITECT_CRAFT_GATE_ENV = [
  'GATE_TREATMENT_FIDELITY',
  'GATE_DRAMATIC_STRUCTURE',
  'GATE_THEME_PRESSURE',
  'GATE_SCENE_TURN_CONTRACT',
  'GATE_EPISODE_PRESSURE',
  'GATE_FINAL_CONTRACT_SCENE_REGEN',
] as const;

export function disableArchitectCraftGatesForSnapshot(): () => void {
  const previous = new Map<string, string | undefined>();

  for (const key of ARCHITECT_CRAFT_GATE_ENV) {
    previous.set(key, process.env[key]);
    process.env[key] = '0';
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
