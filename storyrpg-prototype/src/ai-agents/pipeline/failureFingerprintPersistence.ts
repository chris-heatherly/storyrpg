import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import { episodeFailureMetadataFromError } from './episodeGenerationEvents';
import {
  computeFailureFingerprint,
  nextFailureFingerprintRecord,
  type FailureFingerprintRecord,
} from './failureFingerprint';

export async function persistTerminalFailureFingerprint(input: {
  error: unknown;
  errorMessage: string;
  outputDirectory: string;
  prior?: FailureFingerprintRecord;
  checkpoint: (record: FailureFingerprintRecord) => void;
}) {
  const failure = episodeFailureMetadataFromError(input.error);
  const fingerprint = failure
    ? computeFailureFingerprint({ ...failure, message: input.errorMessage })
    : computeFailureFingerprint({ phase: 'pipeline_abort', message: input.errorMessage });
  const record = nextFailureFingerprintRecord({ fingerprint, prior: input.prior });
  input.checkpoint(record);
  await saveEarlyDiagnostic(input.outputDirectory, 'failure-fingerprint.json', {
    ...record,
    failure,
    message: input.errorMessage,
  });
  return { failure, fingerprint, record };
}
