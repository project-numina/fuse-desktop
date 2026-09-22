import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missingBlueprintSourceResult, validateDeclarationStatus } from '@main/services/blueprint-service/declaration-status';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { createProject } from './test-project';

let test: TestContext;

beforeEach(() => {
  test = createTestContext();
});

afterEach(() => test.cleanup());

describe('declaration status mutation preflight', () => {
  it('accepts tool and stored status names and preserves the stable invalid-status error', () => {
    expect(() => validateDeclarationStatus('formalized')).not.toThrow();
    expect(() => validateDeclarationStatus('in_progress')).not.toThrow();
    expect(() => validateDeclarationStatus('bogus')).toThrowError(
      expect.objectContaining({ status: 400, detail: "Invalid status 'bogus'. Use proved, formalized or unformalized." }),
    );
  });

  it('reports a missing conventional source without touching the model', () => {
    const result = missingBlueprintSourceResult(createProject(test));
    expect(result).toEqual({
      ok: false,
      rewritten: [],
      reason: 'blueprint .tex not found at blueprint/src/content.tex',
      summary: 'Error: blueprint .tex not found at blueprint/src/content.tex',
    });
  });
});
