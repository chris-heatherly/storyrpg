/**
 * Base Validator
 * Common validation utilities and types
 */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: IssueSeverity;
  message: string;
  location?: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  score: number;
  issues: ValidationIssue[];
  suggestions: string[];
}

/**
 * Build a success validation result
 */
export function buildSuccessResult(score: number = 100, suggestions: string[] = []): ValidationResult {
  return {
    valid: true,
    score,
    issues: [],
    suggestions,
  };
}

/**
 * Build a failure validation result
 */
export function buildFailureResult(
  issues: ValidationIssue[],
  score: number = 0,
  suggestions: string[] = []
): ValidationResult {
  return {
    valid: false,
    score,
    issues,
    suggestions,
  };
}

/**
 * Validate that required input fields are present
 */
export function validateInputFields<T extends Record<string, unknown>>(
  input: T,
  requiredFields: (keyof T)[]
): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const field of requiredFields) {
    if (input[field] === undefined || input[field] === null) {
      issues.push({
        severity: 'error',
        message: `Missing required field: ${String(field)}`,
      });
    }
  }

  if (issues.length > 0) {
    return buildFailureResult(issues);
  }

  return buildSuccessResult();
}

/**
 * Base validator class that other validators can extend
 */
export abstract class BaseValidator {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  protected createIssue(
    severity: IssueSeverity,
    message: string,
    location?: string,
    suggestion?: string
  ): ValidationIssue {
    return { severity, message, location, suggestion };
  }

  protected error(message: string, location?: string, suggestion?: string): ValidationIssue {
    return this.createIssue('error', message, location, suggestion);
  }

  protected warning(message: string, location?: string, suggestion?: string): ValidationIssue {
    return this.createIssue('warning', message, location, suggestion);
  }

  protected info(message: string, location?: string, suggestion?: string): ValidationIssue {
    return this.createIssue('info', message, location, suggestion);
  }
}
